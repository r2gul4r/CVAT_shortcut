(() => {
  "use strict";
  const shared = globalThis.CVATShortcuts;
  const $ = (id) => document.getElementById(id);
  let settings = shared.normalize(null);
  let recording = null;
  let composing = false;
  let saving = false;
  let activeTab;
  let loaded = false;

  function notice(text, error = false) {
    $("notice").textContent = text;
    $("notice").classList.toggle("error", error);
  }

  function render() {
    for (const action of shared.ACTIONS) {
      $(action + "-key").textContent = shared.format(settings.shortcuts[action]);
      $(action + "-assign").textContent = settings.shortcuts[action] ? "Change" : "Assign";
      $(action + "-assign").disabled = !loaded || saving;
      $(action + "-clear").disabled = !loaded || saving || !settings.shortcuts[action];
    }
    const warnings = shared.ACTIONS.filter((action) => shared.shortcutWarning(settings.shortcuts[action]));
    $("shortcut-warning").hidden = warnings.length === 0;
    $("shortcut-warning").textContent = warnings.length ?
      `${warnings.map((action) => action === "ai" ? "AI tool" : "New mask").join(" / ")}: ${shared.shortcutWarning(settings.shortcuts[warnings[0]])}` : "";
    $("recording").hidden = !recording;
    if (recording) $("recording-text").textContent = `Press a key or combination for ${recording === "ai" ? "AI tool" : "New mask (Brush tool)"}. Escape cancels.`;
    $("wheel-enabled").checked = settings.brushWheel.enabled;
    $("wheel-enabled").disabled = !loaded || saving;
    $("wheel-modifier").value = settings.brushWheel.modifier;
    $("wheel-modifier").disabled = !loaded || saving || !settings.brushWheel.enabled;
    $("default-label").value = settings.defaultLabelName;
    $("default-label").disabled = !loaded || saving || Boolean(recording);
    $("label-save").disabled = !loaded || saving || Boolean(recording);
  }

  async function save(action, shortcut) {
    saving = true;
    render();
    try {
      // Read the latest stored settings so another popup cannot silently create a duplicate.
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.assign(current[shared.STORAGE_KEY], action, shortcut);
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
      settings = next;
      recording = null;
      notice(shortcut ? `Saved: ${shared.format(shortcut)}` : "Shortcut cleared.");
    } catch (error) {
      notice(error.message || "Local settings could not be saved.", true);
    } finally {
      saving = false;
      render();
    }
  }

  function showTabStatus(status) {
    const on = status?.supported && status?.enabled;
    $("enable").disabled = !activeTab || !shared.supportedURL(activeTab.url) || on;
    $("disable").hidden = !on;
    $("tab-status").textContent = on ? "Enabled in this tab." :
      shared.supportedURL(activeTab?.url) ? "Click Enable when the CVAT sidebar is ready." : "Open a CVAT annotation job to enable shortcuts.";
  }

  async function saveWheel() {
    const wheel = {enabled: $("wheel-enabled").checked, modifier: $("wheel-modifier").value};
    saving = true; render();
    try {
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.normalize({...shared.normalize(current[shared.STORAGE_KEY]), brushWheel: wheel});
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
      settings = next;
      notice(wheel.enabled ? `Brush size: ${shared.wheelModifierName(settings.brushWheel.modifier)} + wheel.` : "Brush-size wheel adjustment disabled.");
    } catch { notice("Brush-size setting could not be saved.", true); }
    finally { saving = false; render(); }
  }
  $("wheel-enabled").addEventListener("change", saveWheel);
  $("wheel-modifier").addEventListener("change", saveWheel);
  $("label-save").addEventListener("click", async () => {
    const name = $("default-label").value.trim();
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
      notice("Enter an exact label name (1–128 characters).", true); return;
    }
    saving = true; render();
    try {
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.normalize({...shared.normalize(current[shared.STORAGE_KEY]), defaultLabelName: name});
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next}); settings = next;
      notice("Default label saved for both new-object shortcuts.");
    } catch { notice("Default label could not be saved.", true); }
    finally { saving = false; render(); }
  });

  for (const action of shared.ACTIONS) {
    $(action + "-assign").addEventListener("click", () => {
      recording = action;
      notice("");
      render();
      $("cancel").focus();
    });
    $(action + "-clear").addEventListener("click", () => save(action, null));
  }
  $("cancel").addEventListener("click", () => { recording = null; notice("Assignment cancelled."); render(); });
  document.addEventListener("compositionstart", () => { composing = true; }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  window.addEventListener("blur", () => { composing = false; });
  document.addEventListener("keydown", (event) => {
    if (!recording || saving || composing || event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation();
      recording = null; notice("Assignment cancelled."); render(); return;
    }
    const candidate = shared.fromEvent(event);
    if (!candidate) return;
    event.preventDefault(); event.stopImmediatePropagation();
    save(recording, candidate);
  }, true);

  $("enable").addEventListener("click", async () => {
    if (!activeTab || !shared.supportedURL(activeTab.url)) return;
    $("enable").disabled = true;
    try {
      const results = await chrome.scripting.executeScript({
        target: {tabId: activeTab.id}, files: ["common.js", "content.js"], world: "ISOLATED"
      });
      const status = results.find((entry) => entry.frameId === 0)?.result;
      showTabStatus(status);
      if (!status?.supported) notice("CVAT controls were not found. Wait for the job sidebar or use the tool manually.", true);
      else if (!status.enabled) notice("Local settings could not be read; shortcuts remain paused.", true);
      else notice("Shortcuts enabled for this tab.");
    } catch {
      showTabStatus(null);
      notice("Chrome could not enable shortcuts. Reload the job and try again; browser policy may restrict extensions.", true);
    }
  });
  $("disable").addEventListener("click", async () => {
    try {
      const status = await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_DISABLE"});
      showTabStatus(status);
    } catch { showTabStatus(null); notice("The tab changed. Reopen this popup to check it.", true); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[shared.STORAGE_KEY]) {
      settings = shared.normalize(changes[shared.STORAGE_KEY].newValue);
      render();
    }
  });

  async function init() {
    render();
    try {
      const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
      settings = shared.normalize(stored[shared.STORAGE_KEY]);
      loaded = true;
      const saved = stored[shared.STORAGE_KEY];
      if (saved?.brushWheel?.modifier === "ctrl") {
        try {
          await chrome.storage.local.set({[shared.STORAGE_KEY]: {
            ...saved, brushWheel: {...saved.brushWheel, modifier: "alt"}
          }});
        } catch { notice(`Saved Ctrl wheel preference could not be updated. ${shared.wheelModifierName("alt")} is used for brush sizing.`, true); }
      }
    } catch { notice("Local settings could not be read. Reopen the popup to try again.", true); }
    render();
    try {
      [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      const status = shared.supportedURL(activeTab?.url) ?
        await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_STATUS"}).catch(() => null) : null;
      showTabStatus(status);
    } catch { showTabStatus(null); }
  }
  $("wheel-modifier").querySelector('[value="alt"]').textContent = `${shared.wheelModifierName("alt")} + wheel (recommended)`;
  $("platform-note").textContent = shared.isMac() ?
    "Mac: Option is Alt; Cmd is separate from Ctrl. Shortcuts use physical key positions. Chrome/macOS shortcuts may take priority." :
    "Shortcuts use physical key positions. Chrome or operating-system shortcuts may take priority.";
  init();
})();
