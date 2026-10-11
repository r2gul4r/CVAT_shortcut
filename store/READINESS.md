# 1.4.1 local release handoff

The Store-format ZIP is prepared locally; no upload, account creation, payment, publishing, browser setting change, or company-page access was performed.

## Ready

- `cvat-sidebar-shortcuts-1.4.1-store.zip` has root-level manifest.json and only 10 allowlisted files: six runtime files and four generated generic PNG icons.
- Icons cover 16/32/48/128 pixels. They contain no captured imagery, company assets, or CVAT logo.
- Permissions remain exactly activeTab, scripting, storage. No host permissions, auto content scripts, background worker, remote code, network requests, hardcoded URLs, capture/image-reading APIs, secrets, tests, reference snapshots, or user settings are bundled. See [package-audit.json](package-audit.json).
- Windows physical-code bindings/settings remain intact. On Mac, Alt displays as Option, Meta as Cmd, and Ctrl stays distinct. Known likely browser/OS conflicts get an advisory; this is not an exhaustive OS shortcut detector. Missing/unknown code and IME/Dead key input stay ignored rather than guessed.
- Option/Alt or Shift sizing remains +/-1 per normalized step. Ctrl/Cmd gestures stay native and clear partial sizing accumulation; Shift horizontal deltas use the dominant axis once. Releasing Meta recovers a chord even if its letter keyup was absent.
- [Korean instructions](INSTALL-KO.md), [listing/permission text](STORE-LISTING-KO.md), and [privacy draft](PRIVACY-KO.md) are prepared outside the ZIP.

## Evidence and limits

1.4.1 conflict hardening claims handled presses/repeats/releases at window capture while allowing modifier cleanup and preserving input/IME/unsupported-context pass-through. It respects earlier event cancellation. An earlier unmarked same-window capture action cannot be undone. No CVAT custom map is read. See [public source audit](../reference/shortcut-conflicts.md) and [Korean pilot checklist](PILOT-KO.md). The 23 added tests use real public Mousetrap 1.6.5 and a replicated CVAT bind contract with synthetic controls; they do not prove the actual installed CVAT, isolated-world install, or OS/default zoom behavior.

232 synthetic checks passed, zero failed: 134 in Windows Chrome (57 activation + 21 popup + 33 wheel + 23 event-conflict), plus 98 macOS metadata/input simulation checks (57 activation + 8 Mac popup + 33 wheel), all executed by Windows Chrome 154.0.8037.93. The Mac runs override only basic platform metadata and generate DOM input events. They are not macOS browser/hardware tests. Chrome extension APIs and CVAT controls are mocked; native OS-reserved shortcuts and real touchpad delivery cannot be validated through these dispatched events. [Detailed results](../tests/test-results.json).

The parent reports actual Windows user confirmation of menus opening and wheel adjustment in earlier versions. The complete 1.4.1 behavior, real CVAT label selection, installed-extension API calls, current CVAT version compatibility, and Mac installation/input remain unverified in a real user session. No company pages, images, DOM, desktop capture, or screenshots were used.

## Remaining before a Store submission

1. Solo-test on a Mac with self-created, nonconfidential CVAT examples: Option/Cmd capture, assign/change/clear/reopen, exact default class for both starts, +/-1 in draw/edit, Shift horizontal input, ordinary scrolling/pinch, and focus/IME guards. Recheck the current Windows build too. Chrome recommends [local production testing before upload](https://developer.chrome.com/docs/webstore/prepare).
2. Fill the actual publisher identity/contact in PRIVACY-KO.md and host it at a publicly accessible URL. [Local-only data handling still needs disclosure](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq). Nothing is hosted yet.
3. Prepare at least one safe listing screenshot of actual functionality using only self-created/demo data, 1280x800 or 640x400. None is captured here. [Chrome image requirements](https://developer.chrome.com/docs/webstore/images). The generated 128px icon is ready.
4. Provide reviewer test instructions or an accessible nonconfidential CVAT demo without company credentials/data. A developer account, dashboard disclosures, and review remain to be done by the user after separate authorization. No new CVAT account/demo was created here.
5. Set Unlisted when ready and share the eventual Store link with the approximately five intended users. This is not company-restricted access: [anyone who has the URL can install an Unlisted item](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

Reload the existing local extension card, refresh the CVAT tab, reopen the popup, then Enable. Preserve the existing extension/profile to keep settings. Loading the extracted Store ZIP as a separate unpacked extension can create a different extension identity and empty local settings; do not remove the existing installation to update in place. Future Store installation also has its own identity; reassign settings manually there. No fixed key or silent settings export is added.
