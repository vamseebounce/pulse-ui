# Pulse v5 — data-side spec (for Cowork / Supabase MCP)

The v5 UI (Orders / Riders perspective tabs) is already wired for two NEW views and two
CHANGES to existing views. The UI degrades gracefully — panels show "Awaiting data —
needs tasks.v_…" until the views exist. Nothing breaks if this ships later.

The DDL below is a **sketch**: written against the raw pipeline tables documented in
`Tasks/CLAUDE.md` §6j (`tasks.all_orders`, `tasks.rider_sessions`, `tasks.rider_order_pings`,
`tasks.delivered_orders`). Adapt column names to the actual schema, and **reuse the exact
same city derivation and rider-accept definition the existing `v_*` views use** so numbers
reconcile across panels. All views: `WITH (security_invoker = true)`, member-read via RLS,
same `grain`/`period_start` convention as the existing analysis views (grain in
('week','day'); week period_start = Monday).

---

## 1. ✅ LIVE (06-Aug, Cowork) — `tasks.v_order_lifetime_summary`

Built to the refined framing below, wired into the nightly refresh. Live data confirms the
bimodal shape: a 55-60s spike of ~190-290k orders/week right before the terminal bucket,
which itself runs 82-89% assigned.

**Framing (Vamsee, 06-Aug): an order that is never assigned is BOUND to cancel.** So the
time-to-cancel histogram at 5s resolution IS the decay curve of the unassigned pool.
Reading it cumulatively from a cutoff t answers: how many orders are still alive
(= winnable) at t, and of those survivors, how many did we actually assign. The 0-5s
spike is unwinnable junk (merchant auto-rejects / instant SLA kills); survivors past the
cutoff are the true serviceable pool.

**Bucket scheme: 5-second intervals through the first minute** (matching
`v_cancel_distribution`), coarser tail after, and one explicit terminal bucket for orders
that never cancelled (assigned → delivered/still live) so cumulative survivor math
includes them:

`'0-5s','5-10s','10-15s','15-20s','20-25s','25-30s','30-35s','35-40s','40-45s','45-50s',
'50-55s','55-60s','60-90s','90s-2m','2-5m','5m+','never cancelled (assigned/live)'`
→ bucket_order 1..17.

Contract (UI reads exactly these columns; it is bucket-agnostic — any bucket list with a
consistent bucket_order renders, and the cutoff selector computes cumulative survivors):

| column | type | notes |
|---|---|---|
| grain | text | 'week' \| 'day' |
| period_start | date | week Monday or the day |
| dimension_type | text | 'overall' \| 'integration' \| 'city' \| 'account' |
| dimension_value | text | 'All' for overall |
| lifetime_bucket | text | see scheme above (bucketed on time-to-CANCEL) |
| bucket_order | int | 1..17 |
| orders | bigint | orders whose cancel time falls in this bucket (last bucket: never cancelled) |
| assigned_orders | bigint | of those, ever reached an assigned state (mostly the tail + cancelled-after-assign) |
| delivered_orders | bigint | of those, delivered |

Sketch:

```sql
create or replace view tasks.v_order_lifetime_summary
with (security_invoker = true) as
with base as (
  select
    o.network_order_id,
    o.created_at,
    o.integration,                      -- adapt: buyer-app / integration column
    <city_derivation> as city,          -- SAME derivation as existing 'zone' dim
    o.account,                          -- adapt
    -- time-to-cancel; NULL = never cancelled (assigned/delivered/live)
    extract(epoch from o.cancelled_at - o.created_at) as cancel_s,
    (o.order_state in ('ASSIGNED','ARRIVED','REACHED','PICKED_UP','DELIVERED')
       or o.cancelled_after_assign) as was_assigned,   -- match v_cancel_summary's definition
    (o.order_state = 'DELIVERED') as was_delivered
  from tasks.all_orders o
),
bucketed as (
  select *,
    case
      when cancel_s is null then 'never cancelled (assigned/live)'
      when cancel_s < 60  then (floor(cancel_s/5)*5)::int || '-' || (floor(cancel_s/5)*5+5)::int || 's'
      when cancel_s < 90  then '60-90s'
      when cancel_s < 120 then '90s-2m'
      when cancel_s < 300 then '2-5m'
      else '5m+' end as lifetime_bucket,
    case
      when cancel_s is null then 17
      when cancel_s < 60  then floor(cancel_s/5)::int + 1
      when cancel_s < 90  then 13
      when cancel_s < 120 then 14
      when cancel_s < 300 then 15
      else 16 end as bucket_order
  from base
)
-- then the same (grain × dimension grouping-set) expansion pattern used by
-- v_cancel_distribution: overall + integration + city + account, week + day grains,
-- count(*) as orders, count(*) filter (where was_assigned) as assigned_orders,
-- count(*) filter (where was_delivered) as delivered_orders.
```

Survivor math the UI does per cutoff t: survivors(t) = Σ orders in buckets ≥ t (the
'never cancelled' bucket always counts as a survivor); assigned-of-survivors = Σ
assigned_orders over the same range. That is the conversion ceiling per cutoff.

Materialize if the raw scan is slow (all_orders is ~1.4M rows and growing) — matview +
refresh in the hourly tick, like the weekly matviews.

## 2. ✅ LIVE (06-Aug, Cowork) — `tasks.v_rider_login_summary`

Built on mv_rider_daily login-hours pairing + the v_accept_factors_summary accept
definition. Live read: 6h+ login rider-days convert to accepts ~95% vs ~3% for <15-min days.

**Question:** how long do riders stay online per day, and does longer login convert to
accepted orders. UI shows rider-days per login-duration bucket vs. rider-days with ≥1
accepted order, with a minutes cutoff selector.

Contract:

| column | type | notes |
|---|---|---|
| grain / period_start | | as above |
| dimension_type | text | 'overall' \| 'city' |
| dimension_value | text | 'All' for overall |
| login_bucket | text | '<15m','15-30m','30-60m','1-2h','2-4h','4-6h','6h+' |
| bucket_order | int | 1..7 |
| riders | bigint | rider-days in bucket |
| riders_with_accept | bigint | of those, rider accepted ≥1 order that day |
| accepted_orders | bigint | total accepted orders by those rider-days |

Sketch: pair `tasks.rider_sessions` online/offline events per (rider_username, day) into
total online minutes (cap unpaired online events at midnight); join accepts per rider-day
from `tasks.rider_order_pings` using the SAME "accepted" definition as
`v_accept_factors_summary` (pinged rider ends up assigned & delivering). City for a rider-day:
modal city of their pings/orders that day, else 'Other'. Same grouping-set expansion.

**Caveat history:** the old "stalled since 27 Jul" warning is RESOLVED (pipeline bug fixed
and backfilled 06-Aug). The remaining boundary is ordinary Metabase-source lag (~few days);
the UI now says "check Sync status" instead of hardcoding dates.

## 3. ✅ DONE (06-Aug, Cowork) — account dimension → top 10 by volume

Applied to all 4 account-exposing views (`v_cancel_distribution`, `v_accept_factors_summary`,
`v_fulfillment_dwell_summary`, `v_order_lifetime_summary`). The first two were quietly
ProSquad-only before; real accounts (bigbasket, instamart, zepto, apollo, …) now appear,
remainder folds into 'Other' per period.

Pattern:

```sql
top10 as (
  select account from base
  group by account order by count(*) desc limit 10
)
-- dimension_value = case when account in (select account from top10)
--                        then account else 'Other' end
```

Note: top-10 membership is per (grain, period) — an account can appear one week and fold
into 'Other' the next. That's intended (revenue lens: who matters *now*).

The UI already labels the cut plainly "By account" — no UI change needed when this lands.

## 4. NEW (pending) — `tasks.v_rider_funnel` (Riders tab hero funnel)

The v6 UI renders a 5-stage rider funnel with a login-cutoff selector (15/30/60 min).
Stages 1 and 5 fall back to `v_weekly_summary` at week grain; stages 2-4 show "awaiting
data" until this view exists.

Contract — one row per (grain, period_start, login_cutoff_min):

| column | type | notes |
|---|---|---|
| grain / period_start | | week + day |
| login_cutoff_min | int | 15, 30, 60 |
| riders_total | bigint | engaged: any session or ping in period |
| riders_logged | bigint | total online duration ≥ cutoff (mv_rider_daily pairing) |
| riders_pinged | bigint | received ≥1 order ping (NOT conditioned on cutoff) |
| riders_accepted | bigint | accepted ≥1 (same definition as v_accept_factors_summary) |
| riders_delivered | bigint | delivered ≥1 order |

Note: only stage 2 is conditioned on the cutoff; stages 3-5 are unconditional rider counts
(matches the standardized definitions shown in the UI). Tiny output (3 rows per period per
grain) — plain view or matview, either is fine.

## 6. Disk growth — checks + retention design (Vamsee, 06-Aug: "disk space is increasing")

The `v_*` views are NOT the consumer: plain views cost 0 bytes; the matviews hold only
aggregate rows (thousands per period). The growth is the RAW mirror tables — `all_orders`
above all (~9k rows/hr at peak, unbounded since the id-sync went live), plus upsert bloat
(all_orders/delivered_orders use ON CONFLICT DO UPDATE → dead tuples).

Diagnose first (run in Supabase SQL editor):

```sql
select relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid)) as heap,
       n_live_tup, n_dead_tup
from pg_class c join pg_stat_user_tables t on t.relid=c.oid
where t.schemaname='tasks' order by pg_total_relation_size(c.oid) desc;
```

Levers, in order of impact:
1. **Retention prune on raw tables** — dashboards read only the aggregate views, so raw
   rows older than the re-derivation window are dead weight. Keep a rolling ~90 days of
   `all_orders` / `rider_order_pings` / `daily_rider_pings`; aggregates (matviews) keep
   full history. Monthly pg_cron: `delete from tasks.all_orders where created_at < now()-interval '90 days'`
   followed by autovacuum (or pg_repack if bloat is bad). daily_rider_pings is likely the
   sneaky-big one (205k rows for just 15-20 Jul backfill).
2. **Vacuum/bloat check** — if n_dead_tup is a large share on the upsert tables, schedule
   `vacuum (analyze)`; consider lowering autovacuum_vacuum_scale_factor for all_orders.
3. **Column prune** — the mirrors copy every Metabase column; wide text columns nobody
   reads (raw payload/address fields) can be dropped from the target tables + adapter.
4. Do NOT materialize anything at raw grain (the new views aggregate before storing —
   keep it that way).

## 7. Revenue dashboard roadmap (rethink, 06-Aug — what a revenue owner still can't see)

Current Pulse answers volume + conversion. Missing, in priority order:

1. **Money view — unit economics** (biggest gap): net take per delivered order,
   contribution per rider-day, PnL by partner. Data exists in ProRouting cards
   1624 (EPH/OPH), 1629/1630/1635 (partner/rider/rider×partner PnL) — needs a 6th
   pipeline source + a v_unit_economics view. Without this, capture-% growth can be
   margin-negative and we would not see it.
2. **Win-rate vs network**: our deliveries ÷ network-winnable in our zones (pending the
   TSP ask on zero-LSP-assignment share). This is the pilot's gate metric (target ≥10%).
3. **Rider cohort retention**: D7/D30 active-rider retention by signup cohort, from
   sessions/pings history. Supply-building spend is blind without it.
4. **Zone capture vs deployment plan**: delivered ÷ demand per top-30% zone
   (deployment_plan_5week.md) — turns the shortlist tool's plan into a scoreboard.
5. **Incentive efficiency** (once incentives launch): ₹ incentive per incremental
   delivered order, by cohort.

## 5. PHASE 2 — global City × Integration × Account filters (bigger change, don't rush)

Vamsee wants page-level filters (City, Integration, Account) that scope EVERY panel
simultaneously. Current views pre-aggregate one dimension at a time, so cross-filtering
(City=Bangalore AND Integration=BigBasket) is impossible without new data shapes.

Cheapest viable shape: rebuild each analysis view keyed by the full combination —

```
(grain, period_start, city, integration, account_top10, <panel-specific dims…>, metrics…)
```

with 'All' rows for each dimension via `grouping sets` (so single-dim queries stay cheap and
the UI's current queries keep working: `eq('city','All')` etc.). Cardinality stays sane:
~4 cities × ~6 integrations × 11 accounts × buckets ≈ a few thousand rows per period per view.
Materialize + refresh hourly. UI work (filter bar in the scope bar, wiring every panel's
query) lands after the views exist — don't build the UI first.

## 8. Reconciliation note (analyst comparison, 04-Aug)

The analyst's "riders pinged per tracking ID" table (285,442 IDs, 80.3% → 1 rider) is
conditional on ≥1 ping and counts tracking IDs; Pulse's notification coverage is per order
over ALL broadcast orders (zero bucket visible). When comparing: Pulse's equivalent
conditional share = bucket % ÷ (100 − '0 riders' %). Ask the analyst for the share of
order IDs with NO tracking ID — that's Pulse's red bucket in their source.
