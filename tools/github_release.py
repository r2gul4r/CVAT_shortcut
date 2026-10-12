"""Create/resume one immutable GitHub release using the runner's gh CLI."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from release_notes import ROOT, load_notes, markdown
from publish_store import verified_package


def gh(*args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('GitHub request failed; check repository Actions permissions and workflow logs')
    return result.stdout


def main():
    note = load_notes()[0]
    version, tag = note['version'], 'v' + note['version']
    folder = ROOT / 'releases' / version
    archive = folder / f'cvat-sidebar-shortcuts-{version}-ko.zip'
    verified_package(archive)
    repo, sha = os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA']
    # A ref lookup distinguishes an absent tag from network/auth failures.
    refs = json.loads(gh('api', f'repos/{repo}/git/matching-refs/tags/{tag}'))
    exact = [ref for ref in refs if ref['ref'] == f'refs/tags/{tag}']
    if exact:
        obj = exact[0]['object']
        while obj['type'] == 'tag':
            obj = json.loads(gh('api', f'repos/{repo}/git/tags/{obj["sha"]}'))['object']
        if obj['type'] != 'commit' or obj['sha'] != sha:
            raise RuntimeError('Version tag belongs to another commit. Bump version or rerun the original workflow')
    else:
        gh('api', f'repos/{repo}/git/refs', '-X', 'POST', '-f', f'ref=refs/tags/{tag}', '-f', f'sha={sha}')
    # Include drafts and paginate, so a partial earlier run can resume safely.
    pages = json.loads(gh('api', f'repos/{repo}/releases?per_page=100', '--paginate', '--slurp'))
    matches = [release for page in pages for release in page if release['tag_name'] == tag]
    body_path = folder / 'github-release.md'
    body_path.write_text(markdown(note), encoding='utf-8', newline='\n')
    if not matches:
        gh('release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', f'{version} — {note["title"]}', '--notes-file', str(body_path))
    info = json.loads(gh('release', 'view', tag, '--repo', repo, '--json', 'assets,isDraft,body'))
    if info['body'].replace('\r\n', '\n').strip() != markdown(note).strip():
        raise RuntimeError('Existing release notes differ. Released versions must not be overwritten')
    assets = {asset['name'] for asset in info['assets']}
    for source in (archive, folder / 'build-audit.json'):
        if source.name in assets:
            with tempfile.TemporaryDirectory() as temp:
                gh('release', 'download', tag, '--repo', repo, '--pattern', source.name, '--dir', temp)
                existing = Path(temp, source.name).read_bytes()
                if hashlib.sha256(existing).digest() != hashlib.sha256(source.read_bytes()).digest():
                    raise RuntimeError('Existing release asset differs; refusing to overwrite')
        else:
            if not info['isDraft']:
                raise RuntimeError('Published release is missing an expected asset; inspect it manually')
            gh('release', 'upload', tag, str(source), '--repo', repo)
    if info['isDraft']:
        gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest')
    url = f'https://github.com/{repo}/releases/tag/{tag}'
    print(url)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(f'### GitHub release\n[{version}]({url})\n\nGitHub release does not indicate Web Store approval.\n')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
