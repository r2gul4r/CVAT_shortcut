"""Only version increases on main push, or explicit main retries, can release."""
import json
import os
from pathlib import Path
import subprocess
from release_notes import load_notes, version_tuple


def should_release(event_name, ref, current, previous=None):
    version_tuple(current)
    if ref != 'refs/heads/main' or event_name not in ('push', 'workflow_dispatch'):
        return False
    if event_name == 'workflow_dispatch':
        return True
    if previous is None:
        raise ValueError('Cannot determine previous version; use a manual main run')
    if version_tuple(current) < version_tuple(previous):
        raise ValueError('Release version cannot decrease')
    return version_tuple(current) > version_tuple(previous)


def main():
    current = load_notes()[0]['version']
    name, ref = os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REF']
    previous = None
    if name == 'push' and ref == 'refs/heads/main':
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        before = event['before']
        if before and set(before) != {'0'}:
            text = subprocess.check_output(['git', 'show', f'{before}:extension/manifest.json'], text=True, encoding='utf-8')
            previous = json.loads(text)['version']
    enabled = should_release(name, ref, current, previous)
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write(f'version={current}\nrelease={str(enabled).lower()}\n')
    print(f'Version {current}; release={enabled}')


if __name__ == '__main__':
    main()
