// Preview-only example data. This script is never included in the extension ZIP.
window.testTabEnabled = true;
window.testCatalog = {state: "ready", labels: [
  ["person", "#ff6a4d"], ["obstacle", "#df17cb"],
  ["psd_door_left", "#20b468"], ["psd_door_right", "#c2e53d"],
  ["emergency_door_left", "#4941eb"], ["emergency_door_right", "#f3af24"]
].map(([name, color]) => ({name, color, duplicate: false}))};
if (!fixtureAPI.read().cvatSidebarShortcutsV1) {
  chrome.storage.local.set({cvatSidebarShortcutsV1: {
    shortcuts: {ai: {code: "KeyV"}, brush: {code: "KeyB"}, polygon: {code: "KeyP"}},
    defaultLabelName: "person"
  }});
}
