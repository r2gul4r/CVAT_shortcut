# Installation / update handoff - 1.4.1

Source updated in place at extension/. Store ZIP: cvat-sidebar-shortcuts-1.4.1-store.zip, with manifest at root and only runtime files/icons. No additional permissions.

Event-conflict patch: handled presses/repeats/releases use window capture; modifiers still release normally. CVAT custom bindings are not detected. Earlier unmarked same-window capture actions remain a documented limit. [Korean manual pilot checklist](store/PILOT-KO.md) and [public source audit](reference/shortcut-conflicts.md) explain key selection and ignored-context native behavior.

232 synthetic checks passed: 134 Windows and 98 Mac metadata/input simulation checks. No actual Mac, installed-extension, or current complete CVAT validation was performed. Earlier Windows menus/wheel were confirmed by the user. No company data, screenshots, desktop capture, or browser settings were accessed or changed.

Update existing installation: finish/save work normally, Reload the existing extension card in chrome://extensions, refresh the CVAT tab, then reopen the popup and Enable for this CVAT tab. Keep the existing source folder/profile to preserve identity and settings.

Fresh Mac test: extract the Store ZIP and load the folder containing manifest.json. Developer mode is a user-controlled prerequisite of unpacked loading; this task did not change it. Do not bypass managed policy. A new extension identity/profile has separate local settings.

[Korean instructions](store/INSTALL-KO.md) | [Listing and permissions](store/STORE-LISTING-KO.md) | [Privacy draft](store/PRIVACY-KO.md) | [Readiness and blockers](store/READINESS.md) | [Package audit](store/package-audit.json)

Before Store submission: actual Mac/current Windows solo test with nonconfidential data, public privacy URL with publisher/contact, safe listing screenshot and reviewer instructions, then separately authorized account/submission work. Unlisted permits anyone with the Store URL to install. Nothing uploaded, published, paid, or registered.

Agent-assisted visible Chrome work still needs confirmation that confidential images are closed. Supported computer-use runtime remains unavailable here; installation/reload is a parent/user handoff.
