"""Render the same versioned notes for GitHub and the offline extension page."""
import argparse
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def version_tuple(value):
    if not re.fullmatch(r'(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}', value):
        raise ValueError('Expected a Chrome version with 3 or 4 numeric components')
    parts = tuple(map(int, value.split('.')))
    if any(part > 65535 for part in parts) or not any(parts):
        raise ValueError('Invalid Chrome version')
    return parts + (0,) * (4 - len(parts))


def load_notes(root=ROOT):
    notes = json.loads((root / 'release-notes.json').read_text(encoding='utf-8'))
    versions = [version_tuple(note['version']) for note in notes]
    if versions != sorted(set(versions), reverse=True):
        raise ValueError('Release notes must have unique versions, newest first')
    current = json.loads((root / 'extension/manifest.json').read_text(encoding='utf-8'))['version']
    if not notes or notes[0]['version'] != current:
        raise ValueError('Newest release notes must match manifest version')
    for note in notes:
        if not note.get('title') or not note.get('changes') or not all(isinstance(s, str) and s.strip() for s in note['changes']):
            raise ValueError('Each release needs a title and nonempty changes')
    return notes


def markdown(note):
    return f"## {note['version']} — {note['title']}\n\n" + ''.join(f'- {line}\n' for line in note['changes'])


def render(notes):
    sections = []
    for note in notes:
        title = html.escape(f"{note['version']} · {note['title']}")
        items = ''.join(f'<li>{html.escape(line)}</li>' for line in note['changes'])
        sections.append(f'<section><h2>{title}</h2><ul>{items}</ul></section>')
    return '''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>업데이트 내역 · CVAT 단축키</title><link rel="stylesheet" href="updates.css"></head><body><main>
<header><p class="eyebrow">CVAT SIDEBAR SHORTCUTS</p><h1>업데이트 내역</h1>
<p>설치한 버전까지의 변경 내용을 최신순으로 볼 수 있습니다.</p>
<nav aria-label="관련 페이지"><a href="guide.html">사용 가이드</a>
<a href="https://github.com/r2gul4r/CVAT_shortcut/releases" target="_blank" rel="noopener noreferrer">GitHub에서 최신 배포 확인 ↗</a></nav></header>
''' + '\n'.join(sections) + '\n</main></body></html>\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--body', type=Path, help='Write latest GitHub release body')
    args = parser.parse_args()
    notes = load_notes()
    expected = render(notes)
    page = ROOT / 'extension/updates.html'
    if args.check:
        if not page.exists() or page.read_text(encoding='utf-8') != expected:
            raise SystemExit('Run python tools/release_notes.py and commit the updated page')
    else:
        page.write_text(expected, encoding='utf-8', newline='\n')
    if args.body:
        args.body.parent.mkdir(parents=True, exist_ok=True)
        args.body.write_text(markdown(notes[0]), encoding='utf-8', newline='\n')
    print(f"Release notes verified: {notes[0]['version']}")


if __name__ == '__main__':
    main()
