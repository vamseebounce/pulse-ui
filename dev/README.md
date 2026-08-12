# Dev preview harness — rebuild recipe (no auth needed)

Pulse is magic-link gated, so headless screenshots need a mock data layer. The harness
built for v4-v7 lived in /tmp (wiped); rebuilding it is ~15 min with this recipe:

1. **mock-supabase.js** — define `window.supabase.createClient()` returning:
   - `auth`: `getSession` → fake session, `onAuthStateChange` → noop subscription,
     `signOut`/`signInWithOtp` → resolved stubs
   - `schema()` → `{ from: (view) => new Q(view), rpc: () => Promise.resolve({data:true,error:null}) }`
   - `Q` = thenable query builder: `.select()` returns this, `.eq(c,v)` collects filters,
     `.order(c,o)` records sort, `.then(resolve)` filters FIX[view] rows and resolves
     `{data, error:null}`.
   - `FIX` = fixtures object, one array per tasks.v_* view the UI reads (see the view
     contracts in ../SPEC-revenue-views.md for exact columns). Generate rows per
     (grain, period) for ~5 weeks + ~14 days. No Date.now/Math.random — seed a jitter
     fn from string hashes so output is deterministic.

2. **preview.html** — copy index.html, replace the two CDN script tags with
   `mock-supabase.js` and a vendored `chart.umd.min.js`, append a hash-hook script:
   `#riders` → switchTab('riders'), `#day` → setGrain('day'), `#pct` → flip the
   lifetime panel mode select.

3. **Screenshot**:
   ```
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
     --hide-scrollbars --virtual-time-budget=15000 --window-size=1440,8000 \
     --screenshot=out.png "file:///tmp/pulse-preview/preview.html#riders"
   ```
   Slice tall captures into ~2200px chunks (PIL) before reviewing.

Gotcha: 100%-stacked charts clip the last sliver if fixture pcts sum >100 — normalize.
