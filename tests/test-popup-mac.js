(async () => {
  "use strict";
  const results = [];
  const S = CVATShortcuts;
  const $ = (id) => document.getElementById(id);
  const delay = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
  function assert(value) {if (!value) throw new Error("Assertion failed");}
  async function test(name, fn) {
    try {await fn(); results.push({name, passed: true});}
    catch (error) {results.push({name, passed: false, error: error.message});}
  }
  function key(code, options = {}) {
    document.body.dispatchEvent(new KeyboardEvent("keydown", {code, key: code.replace(/^Key/, ""), bubbles: true, cancelable: true, ...options}));
  }
  try {
    await delay();
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize(null)}); await delay();
    await test("Simulated Mac labels Option/Cmd without remapping saved modifier bits", () => {
      assert(S.isMac() && $("wheel-modifier").options[0].textContent === "Option + 휠 (권장)");
      assert($("platform-note").textContent.includes("Cmd와 Ctrl은 별개"));
      assert(S.format({code: "KeyZ", alt: true, meta: true}) === "Option + Cmd + Z");
      assert(S.format({code: "KeyZ", alt: true, meta: true}, "Win32") === "Alt + Meta + Z");
    });
    await test("Option character capture stores its physical key code", async () => {
      $("ai-assign").click(); key("KeyA", {key: "å", altKey: true}); await delay();
      assert($("ai-key").textContent === "Option + A");
      const saved = fixtureAPI.read()[S.STORAGE_KEY].shortcuts.ai;
      assert(saved.code === "KeyA" && saved.alt && !saved.meta && !saved.ctrl);
    });
    await test("Cmd capture and duplicate warning preserve exact bindings", async () => {
      $("ai-assign").click(); key("KeyZ", {metaKey: true}); await delay();
      assert($("ai-key").textContent === "Cmd + Z" && fixtureAPI.read()[S.STORAGE_KEY].shortcuts.ai.meta);
      $("brush-assign").click(); key("KeyZ", {metaKey: true}); await delay();
      assert($("notice").textContent.includes("이미") && !$("recording").hidden);
      $("cancel").click();
    });
    await test("Ctrl stays separate from Cmd on simulated Mac", async () => {
      $("brush-assign").click(); key("KeyZ", {ctrlKey: true}); await delay();
      assert($("brush-key").textContent === "Ctrl + Z");
      assert(!fixtureAPI.read()[S.STORAGE_KEY].shortcuts.brush.meta && fixtureAPI.read()[S.STORAGE_KEY].shortcuts.brush.ctrl);
    });
    await test("Saved Chrome/macOS shortcut shows advisory without deleting it", async () => {
      $("ai-assign").click(); key("KeyR", {metaKey: true}); await delay();
      assert($("ai-key").textContent === "Cmd + R" && !$("shortcut-warning").hidden);
      assert($("shortcut-warning").textContent.includes("CVAT에 전달되지"));
      assert(S.shortcutWarning({code: "KeyQ", meta: true}) && S.shortcutWarning({code: "KeyL", ctrl: true}, "Win32"));
      assert(!S.shortcutWarning({code: "KeyA", alt: true}));
    });
    await test("Shift wheel preference and Option status are saved normally", async () => {
      for (const [modifier, name] of [["shift", "Shift"], ["alt", "Option"]]) {
        $("wheel-modifier").value = modifier;
        $("wheel-modifier").dispatchEvent(new Event("change", {bubbles: true})); await delay();
        assert(fixtureAPI.read()[S.STORAGE_KEY].brushWheel.modifier === modifier && $("notice").textContent.includes(name + " + 휠"));
      }
    });
    await test("Saved Cmd choice and conflict advisory survive reopening", async () => {
      const frame = document.createElement("iframe"); frame.src = "/tests/popup-mac-view";
      await new Promise((resolve) => {frame.onload = resolve; document.body.append(frame);}); await delay();
      assert(frame.contentDocument.getElementById("ai-key").textContent === "Cmd + R");
      assert(!frame.contentDocument.getElementById("shortcut-warning").hidden); frame.remove();
    });
    await test("Clearing Cmd binding keeps other settings and removes its advisory", async () => {
      $("ai-clear").click(); await delay();
      assert($("ai-key").textContent === "미지정" && $("shortcut-warning").hidden);
      const saved = fixtureAPI.read()[S.STORAGE_KEY];
      assert(saved.shortcuts.brush.ctrl && saved.brushWheel.modifier === "alt" && saved.defaultLabelName === "obstacle");
    });
  } catch (error) {results.push({name: "Mac metadata simulation setup", passed: false, error: error.message});}
  const summary = {suite: "popup-mac", passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length, results};
  const output = document.createElement("pre"); output.id = "test-results"; output.textContent = JSON.stringify(summary, null, 2);
  document.body.append(output);
})();
