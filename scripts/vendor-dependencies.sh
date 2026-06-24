#!/usr/bin/env bash
set -euo pipefail

mkdir -p vendor

curl -fsSL "https://raw.githubusercontent.com/SheetJS/sheetjs/v0.18.5/dist/xlsx.full.min.js" -o "vendor/xlsx-0.18.5.full.min.js"
curl -fsSL "https://raw.githubusercontent.com/krisk/Fuse/v6.6.2/dist/fuse.min.js" -o "vendor/fuse-6.6.2.min.js"

python3 - <<'PY'
from pathlib import Path
p = Path('index.html')
text = p.read_text(encoding='utf-8')
text = text.replace("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", "script-src 'self' 'unsafe-inline'")
text = text.replace('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'vendor/xlsx-0.18.5.full.min.js')
text = text.replace('https://cdn.jsdelivr.net/npm/fuse.js@6.6.2', 'vendor/fuse-6.6.2.min.js')
p.write_text(text, encoding='utf-8')
PY

sha256sum vendor/xlsx-0.18.5.full.min.js vendor/fuse-6.6.2.min.js > vendor/DEPENDENCY_HASHES.txt
