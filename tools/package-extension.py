"""Package the current runtime without test fixtures, profiles or historical files."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent.parent
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
assert re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', version)
assert manifest['manifest_version'] == 3
assert sorted(manifest['permissions']) == ['activeTab', 'scripting', 'storage']
expected = {'manifest.json', 'common.js', 'content.js', 'native-repeat.js',
            'overlay.js', 'popup.js', 'popup.html', 'popup.css', 'guide.html', 'guide.css'}
expected.update(f'icons/icon{size}.png' for size in [16, 32, 48, 128])
expected.update(f'guide-images/{name}.jpg' for name in [
    '01-enable', '02-label', '03-ai-key', '04-brush-key',
    '05-wheel', '06-space-pan', '07-label-keys', '08-overlay-demo'])
files = {path.relative_to(extension).as_posix(): path for path in extension.rglob('*') if path.is_file()}
assert set(files) == expected, 'Review the runtime allowlist before adding package files'
output = root / 'releases' / version
output.mkdir(parents=True, exist_ok=True)
archive = output / f'cvat-sidebar-shortcuts-{version}-ko.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for name, path in sorted(files.items()):
        bundle.write(path, name)
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert all(bundle.read(name) == path.read_bytes() for name, path in files.items())
audit = {'version': version, 'zip': archive.name,
         'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
         'files': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(files.items())}}
(output / 'build-audit.json').write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
print(f'Validated {len(files)} runtime files: {archive}')
