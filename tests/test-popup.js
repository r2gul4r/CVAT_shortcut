(async () => {
  "use strict";
  const results = [];
  const S = CVATShortcuts;
  const $ = (id) => document.getElementById(id);
  const choices = () => [...$("label-color-list").querySelectorAll("button.label-color-choice")];
  const chosen = () => choices().find(button => button.getAttribute("aria-pressed") === "true");
  const choose = (name) => choices().find(button => button.value === name).click();
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  function assert(value, message) {if (!value) throw new Error(message || "Assertion failed");}
  async function test(name, fn) {
    try {await fn(); results.push({name, passed: true});}
    catch (error) {results.push({name, passed: false, error: error.message});}
  }
  function key(code, options = {}) {
    const event = new KeyboardEvent("keydown", {key: code.replace(/^Key/, ""), code, bubbles: true, cancelable: true, ...options});
    document.body.dispatchEvent(event); return event;
  }
  try {
    await delay(20);
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize(null)});
    await test("Popup starts with unassigned keys and Assign/Clear controls", () => {
      assert($("ai-key").textContent === "미지정" && $("brush-key").textContent === "미지정");
      assert($("ai-assign").textContent === "지정" && $("ai-clear").disabled);
      assert($("default-label").value === "obstacle");
    });
    await test("Popup overlay toggle saves independently from shortcuts and geometry", async () => {
      const before=JSON.stringify(fixtureAPI.read()[S.STORAGE_KEY]);
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:88,y:77,transparency:35}});
      assert($("overlay-enabled").checked && !$("overlay-enabled").disabled);
      $("overlay-enabled").click(); await delay(20);
      assert(fixtureAPI.read().cvatLabelOverlayEnabled===false && $("overlay-show").disabled);
      assert(JSON.stringify(fixtureAPI.read()[S.STORAGE_KEY])===before && fixtureAPI.read().cvatLabelOverlayV1.transparency===35);
      $("overlay-enabled").click(); await delay(20); assert(fixtureAPI.read().cvatLabelOverlayEnabled===true);
    });
    await test("Popup overlay toggle rolls back display after failed save", async () => {
      fixtureAPI.failWrite(true); $("overlay-enabled").click(); await delay(20); fixtureAPI.failWrite(false);
      assert($("overlay-enabled").checked && fixtureAPI.read().cvatLabelOverlayEnabled===true && $("notice").textContent.includes("저장하지 못"));
    });
    await test("Popup overlay toggle follows changes from other tabs", async () => {
      await chrome.storage.local.set({cvatLabelOverlayEnabled:false}); assert(!$("overlay-enabled").checked && $("overlay-show").disabled);
      await chrome.storage.local.set({cvatLabelOverlayEnabled:true}); assert($("overlay-enabled").checked);
    });
    await test("Assign captures a chosen shortcut and saves to local storage", async () => {
      $("ai-assign").click(); key("KeyJ", {altKey: true, shiftKey: true}); await delay(20);
      assert($("ai-key").textContent === "Alt + Shift + J" && $("ai-assign").textContent === "변경");
      assert(fixtureAPI.read()[S.STORAGE_KEY].shortcuts.ai.code === "KeyJ");
    });
    await test("Duplicate warning retains previous settings and capture stays open", async () => {
      $("brush-assign").click(); key("KeyJ", {altKey: true, shiftKey: true}); await delay(20);
      assert($("notice").textContent.includes("이미") && !$("recording").hidden);
      assert($("brush-key").textContent === "미지정" && fixtureAPI.read()[S.STORAGE_KEY].shortcuts.brush === null);
      key("KeyK", {altKey: true}); await delay(20); assert($("brush-key").textContent === "Alt + K");
    });
    await test("Change replaces chosen key, repeated-key recording is ignored", async () => {
      $("ai-assign").click(); key("KeyL", {repeat: true}); await delay(20);
      assert($("ai-key").textContent === "Alt + Shift + J"); key("KeyL", {ctrlKey: true}); await delay(20);
      assert($("ai-key").textContent === "Ctrl + L");
    });
    await test("Modifier-only and IME key events do not create assignments", async () => {
      $("brush-assign").click(); key("ShiftLeft", {key: "Shift", shiftKey: true}); key("KeyM", {isComposing: true});
      key("KeyM", {keyCode: 229}); await delay(20); assert($("brush-key").textContent === "Alt + K" && !$("recording").hidden);
      $("cancel").click(); assert($("recording").hidden);
    });
    await test("Escape cancels without changing bindings", () => {
      $("ai-assign").click(); key("Escape", {key: "Escape"}); assert($("recording").hidden && $("ai-key").textContent === "Ctrl + L");
    });
    await test("Popup ignores a composition session even if a key event omits isComposing", async () => {
      $("brush-assign").click(); document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
      key("KeyM"); await delay(20); assert($("brush-key").textContent === "Alt + K" && !$("recording").hidden);
      document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true})); $("cancel").click();
    });
    await test("Clear removes saved shortcut and restores Assign", async () => {
      $("ai-clear").click(); await delay(20); assert($("ai-key").textContent === "미지정" && $("ai-assign").textContent === "지정");
      assert(fixtureAPI.read()[S.STORAGE_KEY].shortcuts.ai === null && $("ai-clear").disabled);
    });
    await test("Popup enable explicitly injects the MAIN adapter before isolated controls in the same tab, and can pause", async () => {
      assert(fixtureAPI.metrics.injections === 0); $("enable").click(); await delay(20);
      assert(fixtureAPI.metrics.injections === 2 && fixtureAPI.metrics.world === "ISOLATED");
      assert(fixtureAPI.metrics.history[0].world === "MAIN" && fixtureAPI.metrics.history[0].files.join(",") === "native-repeat.js");
      assert(fixtureAPI.metrics.history.slice(0,2).every(entry => entry.tabId === 7));
      assert(fixtureAPI.metrics.files.join(",") === "common.js,overlay.js,content.js" && !$("disable").hidden);
      $("disable").click(); await delay(20); assert($("disable").hidden && !$("enable").disabled);
    });
    await test("MAIN adapter injection failure retains existing tool shortcuts and reports N limitation", async () => {
      window.testMainInjectionFailure = true; $("enable").click(); await delay(20);
      assert(!$("disable").hidden && $("notice").textContent.includes("N 연동 코드를 불러오지 못"));
      window.testMainInjectionFailure = false;
      $("disable").click(); await delay(20);
    });
    await test("Palette recovery requests geometry reset and reports verified visibility", async () => {
      $("enable").click(); await delay(20);
      $("overlay-show").click(); await delay(20);
      assert(fixtureAPI.metrics.lastMessage.type === "CVAT_SHORTCUTS_OVERLAY_SHOW" && fixtureAPI.metrics.lastMessage.recover === true);
      assert($("notice").textContent.includes("복구했습니다") && !$("notice").classList.contains("error"));
    });
    await test("A covered palette reports its failure instead of claiming recovery", async () => {
      window.testOverlayStatus = {state:"covered"};
      $("overlay-show").click(); await delay(20);
      assert($("notice").textContent.includes("확인 코드: COVERED") && $("notice").classList.contains("error"));
      window.testOverlayStatus = null;
    });
    await test("An old tab without palette status requests a page reload", async () => {
      window.testLegacyOverlay = true;
      $("overlay-show").click(); await delay(20);
      assert($("notice").textContent.includes("확인 코드: RELOAD") && $("notice").classList.contains("error"));
      window.testLegacyOverlay = false;
      $("disable").click(); await delay(20);
    });
    await test("Unsupported CVAT controls produce feedback", async () => {
      window.testUnsupportedDOM = true; $("enable").click(); await delay(20);
      assert($("notice").textContent.includes("CVAT 도구를 찾지 못했습니다")); window.testUnsupportedDOM = false;
    });
    await test("Injection failure is reported without bypassing 브라우저 정책", async () => {
      window.testInjectionFailure = true; $("enable").click(); await delay(20);
      assert($("notice").textContent.includes("브라우저 정책")); window.testInjectionFailure = false;
    });
    await test("Storage write failure preserves old binding and reports failure", async () => {
      fixtureAPI.failWrite(true); $("brush-clear").click(); await delay(20);
      assert($("brush-key").textContent === "Alt + K" && $("notice").classList.contains("error")); fixtureAPI.failWrite(false);
    });
    await test("Saving exact default label preserves hotkeys and wheel settings", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      $("default-label").value = " object "; $("label-save").click(); await delay(20);
      const after = fixtureAPI.read()[S.STORAGE_KEY];
      assert(after.defaultLabelName === "object" && $("default-label").value === "object");
      assert(JSON.stringify(after.shortcuts) === JSON.stringify(before.shortcuts) && JSON.stringify(after.brushWheel) === JSON.stringify(before.brushWheel));
    });
    await test("Empty default label is rejected without changing saved setting", async () => {
      $("default-label").value = "   "; $("label-save").click(); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "object" && $("notice").classList.contains("error"));
      $("default-label").value = "object";
    });
    await test("Failed default-label write leaves the old preference intact", async () => {
      fixtureAPI.failWrite(true); $("default-label").value = "person"; $("label-save").click(); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "object" && $("default-label").value === "object");
      assert($("notice").classList.contains("error")); fixtureAPI.failWrite(false);
    });
    await test("Brush wheel defaults to enabled Alt and modifier choice persists locally", async () => {
      assert($("wheel-enabled").checked && $("wheel-modifier").value === "alt");
      assert(JSON.stringify([...$("wheel-modifier").options].map((option) => option.value)) === JSON.stringify(["alt", "shift"]));
      $("wheel-modifier").value = "shift"; $("wheel-modifier").dispatchEvent(new Event("change", {bubbles: true})); await delay(20);
      assert($("wheel-modifier").value === "shift" && fixtureAPI.read()[S.STORAGE_KEY].brushWheel.modifier === "shift");
      assert($("notice").textContent.includes("Shift + 휠"));
      assert($("ai-key").textContent === "미지정" && $("brush-key").textContent === "Alt + K");
    });
    await test("Wheel enable/disable is saved and preserves shortcut assignments", async () => {
      $("wheel-enabled").checked = false; $("wheel-enabled").dispatchEvent(new Event("change", {bubbles: true})); await delay(20);
      assert(!fixtureAPI.read()[S.STORAGE_KEY].brushWheel.enabled && $("wheel-modifier").disabled);
      assert(fixtureAPI.read()[S.STORAGE_KEY].shortcuts.brush.code === "KeyK");
      $("wheel-enabled").checked = true; $("wheel-enabled").dispatchEvent(new Event("change", {bubbles: true})); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].brushWheel.enabled && !$("wheel-modifier").disabled);
    });
    await test("Failed wheel-option write reports failure and keeps saved preference", async () => {
      fixtureAPI.failWrite(true); $("wheel-modifier").value = "alt";
      $("wheel-modifier").dispatchEvent(new Event("change", {bubbles: true})); await delay(20);
      assert($("notice").classList.contains("error") && $("wheel-modifier").value === "shift");
      assert(fixtureAPI.read()[S.STORAGE_KEY].brushWheel.modifier === "shift"); fixtureAPI.failWrite(false);
    });
    await test("Reopening popup retains saved local settings", async () => {
      const frame = document.createElement("iframe"); frame.src = "/tests/popup-view";
      await new Promise((resolve) => {frame.onload = resolve; document.body.append(frame);}); await delay(20);
      assert(frame.contentDocument.getElementById("ai-key").textContent === "미지정");
      assert(frame.contentDocument.getElementById("brush-key").textContent === "Alt + K");
      assert(frame.contentDocument.getElementById("default-label").value === "object");
      assert(frame.contentDocument.getElementById("wheel-enabled").checked && frame.contentDocument.getElementById("wheel-modifier").value === "shift"); frame.remove();
    });
    await test("Unrelated website cannot be enabled or injected", async () => {
      const frame = document.createElement("iframe"); frame.src = "/tests/popup-unrelated";
      await new Promise((resolve) => {frame.onload = resolve; document.body.append(frame);}); await delay(20);
      assert(frame.contentDocument.getElementById("enable").disabled && frame.contentWindow.fixtureAPI.metrics.injections === 0);
      frame.contentDocument.getElementById("enable").click(); await delay(20);
      assert(frame.contentWindow.fixtureAPI.metrics.injections === 0); frame.remove();
    });
    await test("Enable lists unused classes and selects the saved name", async () => {
      $("enable").click(); await delay(20);
      assert(!chosen().disabled && chosen().value === "object");
      assert(choices().some(o => o.value === "unused-class"));
    });
    await test("One unified list shows each class color and selection", () => {
      assert(!$("label-select") && !$("label-selected-color"));
      assert(chosen().querySelector(".label-swatch").style.backgroundColor === "rgb(18, 106, 188)");
      const rows = choices();
      assert(rows.length === 2 && rows[0].getAttribute("aria-pressed") === "true");
      assert(rows[1].querySelector(".label-swatch").style.backgroundColor === "rgb(239, 128, 64)");
    });
    await test("Clicking a colored row saves the class through the same checked path", async () => {
      choices()[1].click(); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "unused-class");
      assert(chosen().value === "unused-class" && chosen().title === "#ef8040");
      assert(!fixtureAPI.read()[S.STORAGE_KEY].color);
    });
    await test("Refresh displays a changed representative color without saving it", async () => {
      window.testCatalog = {state:"ready", labels:[{name:"object", duplicate:false}, {name:"unused-class", duplicate:false, color:"#203040"}]};
      $("label-refresh").click(); await delay(20);
      assert(chosen().title === "#203040");
      assert($("label-color-list").querySelector(".label-swatch").classList.contains("unknown"));
      delete window.testCatalog;
    });
    await test("Choosing a class saves only its name and preserves other preferences", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      choose("unused-class"); await delay(20);
      const after = fixtureAPI.read()[S.STORAGE_KEY];
      assert(after.defaultLabelName === "unused-class" && $("default-label").value === "unused-class");
      assert(JSON.stringify(after.shortcuts) === JSON.stringify(before.shortcuts));
      assert(JSON.stringify(after.brushWheel) === JSON.stringify(before.brushWheel));
      assert(!after.catalog && !after.labels && !after.jobPath);
    });
    await test("Refresh marks missing saved labels and disables duplicate names", async () => {
      window.testCatalog = {state:"ready", labels:[{name:"different", duplicate:false}, {name:"duplicate", duplicate:true}]};
      $("label-refresh").click(); await delay(20);
      assert(!chosen() && fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "unused-class");
      assert(choices().length === 2 && choices()[1].disabled);
    });
    await test("A class removed after display cannot be saved", async () => {
      window.testCatalog = {state:"ready", labels:[]};
      choose("different"); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "unused-class" && $("label-colors").hidden);
    });
    await test("Catalog failure permits manual entry and pause clears the list", async () => {
      window.testCatalog = {state:"unavailable", labels:[]}; $("label-refresh").click(); await delay(20);
      assert($("label-colors").hidden && !$("label-save").disabled && $("label-status").textContent.includes("Overview"));
      $("disable").click(); await delay(20); assert($("label-refresh").disabled && choices().length === 0);
    });
    await test("Changing jobs prevents a stale selection from saving", async () => {
      delete window.testCatalog; $("enable").click(); await delay(20);
      window.testTabURL = "http://127.0.0.1/tasks/2/jobs/2";
      choose("object"); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === "unused-class" && $("label-colors").hidden);
      delete window.testTabURL;
    });
    await test("Focused manual paste survives unrelated settings updates", async () => {
      $("label-manual").open = true; $("default-label").focus(); $("default-label").value = "pasted-class";
      await chrome.storage.local.set({[S.STORAGE_KEY]: fixtureAPI.read()[S.STORAGE_KEY]});
      assert($("default-label").value === "pasted-class"); $("default-label").blur();
    });
    await test("Space pan checkbox persists without changing label or shortcut settings", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      assert($("pan-enabled").checked);
      $("pan-enabled").click(); await delay(20);
      const after = fixtureAPI.read()[S.STORAGE_KEY];
      assert(after.spacePan === false && after.defaultLabelName === before.defaultLabelName && JSON.stringify(after.shortcuts) === JSON.stringify(before.shortcuts));
      $("pan-enabled").click(); await delay(20); assert(fixtureAPI.read()[S.STORAGE_KEY].spacePan);
    });
    await test("Space tool shortcut shows pan conflict guidance", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      await chrome.storage.local.set({[S.STORAGE_KEY]: S.assign(before, "ai", {code: "Space"})});
      assert(!$("pan-warning").hidden);
      await chrome.storage.local.set({[S.STORAGE_KEY]: before}); assert($("pan-warning").hidden);
    });
    await test("Label key assign, conflict rejection, change and clear preserve other settings", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      delete window.testCatalog; $("enable").click(); await delay(20); $("label-refresh").click(); await delay(20);
      const control = (name, type) => choices().find((b) => b.value === name).parentElement.querySelector('.label-shortcut-' + type);
      control("object", "assign").click(); key("Digit1"); await delay(20);
      assert(fixtureAPI.read()[S.STORAGE_KEY].labelShortcuts[0].shortcut.code === "Digit1");
      assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName === before.defaultLabelName);
      control("unused-class", "assign").click(); key("Digit1"); await delay(20);
      assert($("notice").classList.contains("error") && fixtureAPI.read()[S.STORAGE_KEY].labelShortcuts.length === 1);
      key("KeyK", {altKey: true}); await delay(20); assert($("notice").classList.contains("error"));
      key("Digit2"); await delay(20); assert(fixtureAPI.read()[S.STORAGE_KEY].labelShortcuts.length === 2);
      $("ai-assign").click(); key("Digit1"); await delay(20); assert($("notice").classList.contains("error")); $("cancel").click();
      control("object", "assign").click(); key("Space"); await delay(20); assert(!$("pan-warning").hidden);
      window.testCatalog = {state: "ready", labels: [{name: "unused-class", duplicate: false}]};
      $("label-refresh").click(); await delay(20);
      assert(choices().find((b) => b.value === "object").disabled && !control("object", "clear").disabled);
      control("object", "clear").click(); await delay(20); assert(fixtureAPI.read()[S.STORAGE_KEY].labelShortcuts.length === 1);
      delete window.testCatalog; await chrome.storage.local.set({[S.STORAGE_KEY]: before});
      $("label-refresh").click(); await delay(20);
    });
    await test("Label key rejects stale job and failed storage writes", async () => {
      const before = JSON.stringify(fixtureAPI.read()[S.STORAGE_KEY]);
      const assign = () => choices()[0].parentElement.querySelector('.label-shortcut-assign').click();
      assign(); fixtureAPI.failWrite(true); key("Digit3"); await delay(20); fixtureAPI.failWrite(false);
      assert($("notice").classList.contains("error") && JSON.stringify(fixtureAPI.read()[S.STORAGE_KEY]) === before);
      window.testTabURL = "http://127.0.0.1/tasks/2/jobs/2"; key("Digit3"); await delay(20);
      assert($("notice").classList.contains("error") && JSON.stringify(fixtureAPI.read()[S.STORAGE_KEY]) === before);
      delete window.testTabURL; $("cancel").click();
    });
    await test("Opening popup migrates saved Ctrl wheel to Alt without changing other settings", async () => {
      const before = fixtureAPI.read()[S.STORAGE_KEY];
      const saved = {...before, brushWheel: {enabled: false, modifier: "ctrl"}, extraPreference: "preserved"};
      await chrome.storage.local.set({[S.STORAGE_KEY]: saved}); await delay(20);
      const frame = document.createElement("iframe"); frame.src = "/tests/popup-view";
      await new Promise((resolve) => {frame.onload = resolve; document.body.append(frame);}); await delay(20);
      const after = fixtureAPI.read()[S.STORAGE_KEY];
      assert(after.brushWheel.modifier === "alt" && !after.brushWheel.enabled);
      assert(JSON.stringify(after.shortcuts) === JSON.stringify(saved.shortcuts) && after.defaultLabelName === saved.defaultLabelName && after.extraPreference === "preserved");
      assert(frame.contentDocument.getElementById("wheel-modifier").value === "alt" && !frame.contentDocument.getElementById("wheel-enabled").checked); frame.remove();
    });
  } catch (error) {results.push({name: "Popup setup", passed: false, error: error.message});}
  const summary = {suite: "popup", passed: results.filter((test) => test.passed).length,
    failed: results.filter((test) => !test.passed).length, results};
  const output = document.createElement("pre"); output.id = "test-results"; output.textContent = JSON.stringify(summary, null, 2);
  document.body.append(output); window.fixtureResults = summary;
})();
