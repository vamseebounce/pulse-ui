#!/bin/bash
# Regenerate preview.html from the real index.html with CDN scripts swapped for local
# copies (mock supabase + vendored chart.js), plus a #day-hash hook to open the Day tab.
set -e
cd /tmp/pulse-preview
SRC="${PULSE_SRC:-/Users/vamsee/Desktop/Scalability/Bounce/pulse-ui/index.html}"
[ -f chart.umd.min.js ] || curl -sL https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js -o chart.umd.min.js
python3 - "$SRC" <<'EOF'
import re, sys
html = open(sys.argv[1]).read()
html = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/[^"]*"></script>',
              '<script src="mock-supabase.js"></script>', html)
html = re.sub(r'<script src="https://cdn\.jsdelivr\.net/npm/chart\.js[^"]*"></script>',
              '<script src="chart.umd.min.js"></script>', html)
hook = '<script>setTimeout(function(){if(location.hash.indexOf("riders")>-1)switchTab("riders");if(location.hash.indexOf("day")>-1)setGrain("day");if(location.hash.indexOf("pct")>-1){setTimeout(function(){var s=document.getElementById("order-lifetime-mode-orders");if(s){s.value="pct";renderPanel("order-lifetime","orders");}},700);}},900);</script>'
html = html.replace('</body>', hook + '\n</body>')
open('preview.html', 'w').write(html)
print('preview.html written', len(html), 'bytes')
EOF
