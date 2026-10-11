(async () => {
  const S = CVATShortcuts, $ = (s) => document.querySelector(s), results = [];
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  let nativeDown = 0, nativePress = 0, nativeUp = 0, escapes = 0, starts = 0, startedLabel = "", setDelay = 0;
  const toolbox = $(".cvat-brush-tools-toolbox");
  const list = document.createElement("div"); list.className = "cvat-objects-sidebar-labels-list"; document.body.append(list);
  function labels(names = ["person", "obstacle"]) {
    list.replaceChildren();
    const header = document.createElement("div"); header.className = "cvat-objects-sidebar-labels-list-header"; header.textContent = `Items: ${names.length}`; list.append(header);
    for (const name of names) {
      const row = document.createElement("div"); row.className = "cvat-objects-sidebar-label-item";
      const text = document.createElement("span"); text.className = "cvat-text"; text.textContent = name; row.append(text); list.append(row);
    }
  }
  // Native handlers predate injection; include keypress and keyup, not just keydown.
  Mousetrap.bind(["1", "2"], () => { nativeDown++; }, "keydown");
  Mousetrap.bind(["1", "2"], () => { nativePress++; }, "keypress");
  document.addEventListener("keyup", (e) => { if (/^Digit[12]$/.test(e.code)) nativeUp++; });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") { escapes++; toolbox.hidden = true; $(".cvat-draw-mask-control").classList.remove("cvat-active-canvas-control"); }
  });
  $(".cvat-draw-mask-control").onclick = () => { $(".cvat-draw-mask-popover").hidden = false; };
  $(".cvat-draw-mask-shape-button").onclick = () => {
    starts++; startedLabel = labelFixture.byID("mask-label").root.value;
    $(".cvat-draw-mask-popover").hidden = true; toolbox.hidden = false;
  };
  const originalSet = chrome.storage.local.set;
  chrome.storage.local.set = async (value) => { if (setDelay) await wait(setDelay); return originalSet(value); };
  function key(type, code = "Digit1", extra = {}, target = document.body) {
    const text = code.startsWith("Digit") ? code.slice(5) : code.startsWith("Key") ? code.slice(3).toLowerCase() : " ";
    const e = new KeyboardEvent(type, {code, key: text, keyCode: text.toUpperCase().charCodeAt(0), which: text.charCodeAt(0), bubbles: true, cancelable: true, ...extra});
    target.dispatchEvent(e); return e;
  }
  function press(code = "Digit1", extra = {}, target = document.body) {
    const e = key("keydown", code, extra, target); key("keypress", code, extra, target); key("keyup", code, extra, target); return e;
  }
  function assert(value, why = "Label shortcut assertion failed") { if (!value) throw new Error(why); }
  const current = () => fixtureAPI.read()[S.STORAGE_KEY];
  const update = (changes) => chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize({...current(), ...changes})});
  async function reset() {
    setDelay = 0; fixtureAPI.failWrite(false); fixtureAPI.failRead(false);
    window.dispatchEvent(new Event("blur")); await wait(70);
    labels(); history.replaceState({}, "", "/tasks/1/jobs/8"); $("#dialog").hidden = true;
    document.body.focus(); toolbox.hidden = false; $(".cvat-draw-mask-popover").hidden = true;
    labelFixture.byID("mask-label").options(["person", "obstacle"]);
    await update({defaultLabelName: "person", shortcuts: {brush: {code: "KeyB"}}, labelShortcuts: [
      {name: "person", shortcut: {code: "Digit1"}}, {name: "obstacle", shortcut: {code: "Digit2"}}]});
    await window.__cvatSidebarShortcutsControllerV1.enable();
    nativeDown = nativePress = nativeUp = escapes = starts = 0; startedLabel = "";
  }
  async function test(name, run) {
    try { await reset(); await run(); results.push({name, passed: true}); }
    catch (e) { results.push({name, passed: false, error: e.message}); }
  }
  try {
    fixtureAPI.clear(); const script = document.createElement("script"); script.src = "/extension/content.js";
    await new Promise((r, j) => { script.onload = r; script.onerror = j; document.head.append(script); });
    await test("Label key changes next label and leaves brush/model/objects untouched", async () => {
      const before = toolbox.outerHTML; assert(press("Digit2").defaultPrevented); await wait(10);
      assert(current().defaultLabelName === "obstacle" && toolbox.outerHTML === before && escapes === 0 && starts === 0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("obstacle"));
    });
    await test("Label down, keypress, repeat and keyup all block native CVAT handlers", async () => {
      assert(key("keydown", "Digit2").defaultPrevented);
      assert(key("keypress", "Digit2").defaultPrevented);
      assert(key("keydown", "Digit2", {repeat: true}).defaultPrevented);
      assert(key("keyup", "Digit2").defaultPrevented); await wait();
      assert(nativeDown === 0 && nativePress === 0 && nativeUp === 0);
    });
    await test("Missing label stays reserved and reports failure without changing preference", async () => {
      labels(["person"]); assert(press("Digit2").defaultPrevented); await wait();
      assert(current().defaultLabelName === "person" && nativeDown === 0 && nativePress === 0 && nativeUp === 0 && escapes === 0);
    });
    await test("Duplicate label name is not selected", async () => {
      labels(["person", "obstacle", "obstacle"]); press("Digit2"); await wait(); assert(current().defaultLabelName === "person");
    });
    await test("Incomplete class catalog fails safely", async () => {
      list.firstElementChild.textContent = "Items: 9"; press("Digit2"); await wait(); assert(current().defaultLabelName === "person");
    });
    await test("Typing keeps number keys available", async () => {
      $("#input").focus(); assert(!press("Digit2", {}, $("#input")).defaultPrevented); await wait(); assert(current().defaultLabelName === "person");
    });
    await test("Dialog keeps its key behavior", () => { $("#dialog").hidden = false; assert(!press("Digit2").defaultPrevented); });
    await test("IME events do not change label", async () => {
      assert(!press("Digit2", {isComposing: true}).defaultPrevented); await wait(); assert(current().defaultLabelName === "person");
    });
    await test("Wrong modifiers and unassigned keys pass through", () => {
      assert(!press("Digit2", {ctrlKey: true}).defaultPrevented && !press("Digit3").defaultPrevented);
    });
    await test("Paused extension restores native number key behavior", async () => {
      await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"}); assert(!press("Digit2").defaultPrevented);
      assert(nativeDown === 1 && nativePress === 1 && nativeUp === 1);
    });
    await test("Mid-stroke key is reserved but does not interrupt or change the drawing", async () => {
      $("#mask-surface").dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0, buttons: 1}));
      assert(press("Digit2").defaultPrevented); await wait();
      document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true, button: 0, buttons: 0}));
      assert(current().defaultLabelName === "person" && escapes === 0 && nativeDown === 0 && nativeUp === 0);
    });
    await test("Class then brush immediately uses new label before async storage finishes", async () => {
      setDelay = 40; press("Digit2"); press("KeyB"); await wait(65);
      assert(starts === 1 && startedLabel === "obstacle", JSON.stringify({starts, startedLabel}));
      assert(current().defaultLabelName === "obstacle");
    });
    await test("Rapid changes serialize writes and last selection wins", async () => {
      setDelay = 20; press("Digit2"); await wait(5); press("Digit1"); await wait(55);
      assert(current().defaultLabelName === "person" && escapes === 0);
    });
    await test("Async label save cannot cancel a waiting tool start", async () => {
      const shape = $(".cvat-draw-mask-shape-button"); shape.hidden = true; setDelay = 20;
      press("Digit2"); press("KeyB"); await wait(30); shape.hidden = false; await wait(100);
      assert(starts === 1 && startedLabel === "obstacle" && current().defaultLabelName === "obstacle");
    });
    await test("Write failure keeps saved label and reports error", async () => {
      fixtureAPI.failWrite(true); press("Digit2"); await wait(10); fixtureAPI.failWrite(false);
      assert(current().defaultLabelName === "person" && $("#cvat-sidebar-shortcuts-feedback").textContent.includes("저장하지 못했습니다"));
    });
    await test("Synchronous job change prevents queued selection from saving", async () => {
      press("Digit2"); history.replaceState({}, "", "/tasks/1/jobs/99"); await wait(10); assert(current().defaultLabelName === "person");
    });
    await test("Space label binding overrides Space pan", async () => {
      await update({labelShortcuts: [{name: "obstacle", shortcut: {code: "Space"}}]});
      assert(press("Space").defaultPrevented); await wait(); assert(current().defaultLabelName === "obstacle");
    });
    await test("Plain number native handler returns after binding is removed", async () => {
      await update({labelShortcuts: []}); assert(!press("Digit2").defaultPrevented); assert(nativeDown === 1 && nativePress === 1);
    });
    await test("Tools and labels reject duplicate assignments in both directions", () => {
      let rejected = 0;
      for (const run of [() => S.assign(current(), "ai", {code: "Digit2"}), () => S.assignLabel(current(), "person", {code: "KeyB"}), () => S.assignLabel(current(), "person", {code: "Digit2"})]) {
        try { run(); } catch { rejected++; }
      }
      assert(rejected === 3);
    });
    await test("Malformed or ambiguous imported label bindings cannot dispatch", () => {
      const normalized = S.normalize({labelShortcuts: [{name: "person", shortcut: {code: "Digit1"}}, {name: "obstacle", shortcut: {code: "Digit1"}}, {name: "x", shortcut: {code: "Escape"}}]});
      assert(normalized.labelShortcuts.length === 0);
    });
  } catch (e) { results.push({name: "Setup", passed: false, error: e.message}); }
  const report = {suite: "label-shortcuts", passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results};
  $("#test-results").textContent = JSON.stringify(report, null, 2);
})();
