"""Build a reproducible extension ZIP and its SHA256 digest (stdlib only)."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'extension/manifest.json').read_text())
version = manifest['version']
assert version == json.loads((root / 'package.json').read_text())['version']
out = root / 'dist'
out.mkdir(exist_ok=True)
target = out / f'PrivetFlow-v{version}-Chrome.zip'
entries = [(p.relative_to(root / 'extension').as_posix(), p) for p in (root / 'extension').rglob('*') if p.is_file()]
entries += [(name, root / name) for name in ['README.md', 'LICENSE', 'PRIVACY.md']]
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, path in sorted(entries):
        entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, path.read_bytes())
digest = hashlib.sha256(target.read_bytes()).hexdigest()
(out / 'SHA256SUMS.txt').write_text(f'{digest}  {target.name}\n')
print(f'{target.name}: {target.stat().st_size} bytes\nSHA256 {digest}')
