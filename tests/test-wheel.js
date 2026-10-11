(async () => {
  "use strict";
  const results = [];
  const S = CVATShortcuts;
  const $ = (selector) => document.querySelector(selector);
  const toolbox = $(".cvat-brush-tools-toolbox");
  const size = $("#brush-size");
  const surface = $("#mask-surface");
  const canvas = $(".cvat_masks_canvas_wrapper");
  const brush = $(".cvat-brush-tools-brush");
  const eraser = $(".cvat-brush-tools-eraser");
  const polygon = $(".cvat-brush-tools-polygon-plus");
  const counts = {updates: 0, ordinaryWheel: 0, pointerEvents: 0, saves: 0, starts: 0};
  const totals = {...counts};
  const count = (name) => {counts[name] += 1; totals[name] += 1;};
  let modelSize = 10;
  // A controlled-input fixture with an own value setter, like a React value tracker.
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  let trackedValue = size.value;
  Object.defineProperty(size, "value", {configurable: true,
    get() {return native.get.call(this);},
    set(value) {trackedValue = String(value); native.set.call(this, String(value));}
  });
  size.addEventListener("input", () => {
    if (size.value !== trackedValue) {
      modelSize = Number(size.value); size.value = String(modelSize); count("updates");
    }
  });
  surface.addEventListener("wheel", () => count("ordinaryWheel"));
  for (const name of ["mousedown", "mousemove", "pointerdown", "pointermove"]) surface.addEventListener(name, () => count("pointerEvents"));
  for (const selector of [".cvat-brush-tools-finish", ".cvat-brush-tools-continue", "#wrong-save"]) $(selector).onclick = () => count("saves");
  for (const selector of [".cvat-tools-control", ".cvat-draw-mask-control", ".cvat-tools-interact-button", ".cvat-draw-mask-shape-button"]) $(selector).onclick = () => count("starts");
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const focusBody = () => document.body.focus();
  const setSize = (value) => {size.value = String(value); modelSize = Number(value);};
  function assert(value, message) {if (!value) throw new Error(message || "Assertion failed: " + JSON.stringify(counts));}
  const wheel = (deltaY = -100, options = {}, target = surface) => {
    const rect = surface.getBoundingClientRect();
    const event = new WheelEvent("wheel", {bubbles: true, composed: true, cancelable: true,
      deltaY, deltaX: 0, deltaMode: 0, altKey: true, clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2, ...options});
    target.dispatchEvent(event); return event;
  };
  const controlDown = () => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Control", code: "ControlLeft", ctrlKey: true, bubbles: true}));
  const controlUp = () => document.body.dispatchEvent(new KeyboardEvent("keyup", {key: "Control", code: "ControlLeft", bubbles: true}));
  async function settings(wheelValue) {
    const current = await chrome.storage.local.get(S.STORAGE_KEY);
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize({...current[S.STORAGE_KEY], brushWheel: wheelValue})});
    await delay();
  }
  async function reset() {
    window.dispatchEvent(new Event("blur"));
    document.querySelectorAll(".test-extra").forEach((node) => node.remove());
    toolbox.hidden = false; toolbox.style.cssText = ""; toolbox.removeAttribute("aria-disabled");
    if (!toolbox.isConnected) document.body.append(toolbox);
    canvas.style.cssText = ""; canvas.hidden = false;
    $("#cvat_canvas_wrapper").id = "cvat_canvas_wrapper";
    $(".cvat-canvas-container").hidden = false;
    $(".cvat-canvas-controls-sidebar").hidden = false;
    $(".cvat-draw-mask-control").classList.add("cvat-active-canvas-control");
    $(".cvat-tools-control").classList.remove("cvat-active-canvas-control");
    for (const element of [brush, eraser, polygon]) {
      element.classList.remove("cvat-brush-tools-active-tool"); element.disabled = false;
    }
    brush.classList.add("cvat-brush-tools-active-tool");
    size.hidden = false; size.disabled = false; size.readOnly = false; size.style.cssText = "";
    for (const attribute of ["min", "max", "aria-valuemax", "aria-disabled"]) size.removeAttribute(attribute);
    size.setAttribute("aria-valuemin", "1");
    size.closest(".cvat-brush-tools-brush-size").classList.remove("ant-btn-loading");
    $("#dialog").hidden = true; focusBody(); setSize(10);
    history.replaceState({}, "", "/tasks/1/jobs/2");
    await settings({enabled: true, modifier: "alt"}); await window.__cvatSidebarShortcutsControllerV1.enable();
    for (const name of Object.keys(counts)) counts[name] = 0;
  }
  async function test(name, fn) {
    try {await reset(); await fn(); results.push({name, passed: true});}
    catch (error) {results.push({name, passed: false, error: error.message});}
  }
  const untouched = () => assert(counts.updates === 0 && modelSize === 10 && counts.pointerEvents === 0 && counts.saves === 0 && counts.starts === 0);
  try {
    fixtureAPI.clear();
    const script = document.createElement("script"); script.src = "/extension/content.js";
    await new Promise((resolve, reject) => {script.onload = resolve; script.onerror = reject; document.head.append(script);});
    await window.__cvatSidebarShortcutsControllerV1.enable();
    await test("Old saved settings migrate to enabled Alt wheel without losing chosen hotkeys", () => {
      const old = {version: 1, defaultLabelName: "object", shortcuts: {ai: {code: "KeyJ", alt: true}, brush: {code: "KeyK", ctrl: true}}};
      const next = S.normalize(old); assert(next.shortcuts.ai.code === "KeyJ" && next.shortcuts.brush.code === "KeyK");
      assert(next.brushWheel.enabled && next.brushWheel.modifier === "alt");
      const migrated = S.normalize({...old, brushWheel: {enabled: false, modifier: "ctrl"}});
      assert(!migrated.brushWheel.enabled && migrated.brushWheel.modifier === "alt" && migrated.defaultLabelName === "object");
      assert(JSON.stringify(migrated.shortcuts) === JSON.stringify(next.shortcuts));
      const reassigned = S.assign({...next, brushWheel: {enabled: false, modifier: "shift"}}, "ai", {code: "KeyL"});
      assert(!reassigned.brushWheel.enabled && reassigned.brushWheel.modifier === "shift" && reassigned.defaultLabelName === "object");
    });
    await test("Alt wheel up/down adjusts shared controlled size by one without zoom", () => {
      assert(wheel(-100).defaultPrevented && modelSize === 11 && counts.updates === 1);
      assert(wheel(100).defaultPrevented && modelSize === 10 && counts.updates === 2 && counts.ordinaryWheel === 0);
      assert(counts.pointerEvents === 0 && counts.saves === 0 && counts.starts === 0);
    });
    await test("Existing-mask editing with Cursor uses the same size control", () => {
      $(".cvat-draw-mask-control").classList.remove("cvat-active-canvas-control");
      $(".cvat-brush-tools-continue").hidden = true;
      assert(wheel().defaultPrevented && modelSize === 11);
      assert(wheel(100).defaultPrevented && modelSize === 10); $(".cvat-brush-tools-continue").hidden = false;
    });
    await test("The shared size control also works for active Eraser", () => {
      brush.classList.remove("cvat-brush-tools-active-tool"); eraser.classList.add("cvat-brush-tools-active-tool");
      assert(wheel().defaultPrevented && modelSize === 11);
    });
    await test("Ctrl wheel and pinch remain native under either supported modifier", async () => {
      await settings({enabled: true, modifier: "ctrl"});
      for (const modifier of ["alt", "shift"]) {
        await settings({enabled: true, modifier});
        for (const options of [{altKey: false, ctrlKey: true}, {ctrlKey: true}, {altKey: false, shiftKey: true, ctrlKey: true}]) {
          assert(!wheel(-100, options).defaultPrevented);
        }
        controlDown(); assert(!wheel(-100, {altKey: false, ctrlKey: true}).defaultPrevented); controlUp();
      }
      assert(counts.ordinaryWheel === 8); untouched();
    });
    await test("Cmd wheel, unmodified trackpad scroll, and horizontal Option swipe stay native", async () => {
      for (const modifier of ["alt", "shift"]) {
        await settings({enabled: true, modifier});
        for (const options of [{metaKey: true}, {altKey: false, shiftKey: true, metaKey: true}, {altKey: false}]) {
          assert(!wheel(-100, options).defaultPrevented);
        }
      }
      await settings({enabled: true, modifier: "alt"});
      assert(!wheel(0, {deltaX: -100}).defaultPrevented); untouched();
    });
    await test("Native pinch or Cmd gesture clears a partial size step", () => {
      for (const modifier of [{ctrlKey: true}, {metaKey: true}]) {
        assert(wheel(-40).defaultPrevented && modelSize === 10);
        assert(!wheel(-100, modifier).defaultPrevented);
        assert(wheel(-60).defaultPrevented && modelSize === 10);
        window.dispatchEvent(new Event("blur"));
      }
      untouched();
    });
    await test("Shift vertical wheel changes creation and editing sizes by exactly one", async () => {
      await settings({enabled: true, modifier: "shift"});
      const shift = {altKey: false, shiftKey: true};
      assert(wheel(-100, shift).defaultPrevented && modelSize === 11);
      assert(wheel(100, shift).defaultPrevented && modelSize === 10);
      $(".cvat-draw-mask-control").classList.remove("cvat-active-canvas-control");
      assert(wheel(-100, shift).defaultPrevented && modelSize === 11);
      assert(wheel(100, shift).defaultPrevented && modelSize === 10 && counts.updates === 4 && counts.ordinaryWheel === 0);
    });
    await test("Shift horizontal wheel uses the dominant direction once, including Eraser", async () => {
      await settings({enabled: true, modifier: "shift"});
      const shift = {altKey: false, shiftKey: true};
      assert(wheel(0, {...shift, deltaX: -100}).defaultPrevented && modelSize === 11);
      assert(wheel(0, {...shift, deltaX: 100}).defaultPrevented && modelSize === 10);
      assert(wheel(10, {...shift, deltaX: -100}).defaultPrevented && modelSize === 11);
      assert(wheel(-100, {...shift, deltaX: 10}).defaultPrevented && modelSize === 12);
      brush.classList.remove("cvat-brush-tools-active-tool"); eraser.classList.add("cvat-brush-tools-active-tool");
      assert(wheel(0, {...shift, deltaX: 100}).defaultPrevented && modelSize === 11 && counts.updates === 5);
      assert(counts.pointerEvents === 0 && counts.saves === 0 && counts.starts === 0);
    });
    await test("Shift horizontal fractional, line, page, and bounded steps normalize consistently", async () => {
      await settings({enabled: true, modifier: "shift"});
      const shift = {altKey: false, shiftKey: true};
      for (let index = 0; index < 4; index++) assert(wheel(0, {...shift, deltaX: -20}).defaultPrevented && modelSize === 10);
      wheel(0, {...shift, deltaX: -20}); assert(modelSize === 11 && counts.updates === 1);
      wheel(0, {...shift, deltaX: -3, deltaMode: 1}); assert(modelSize === 12);
      wheel(0, {...shift, deltaX: 1, deltaMode: 2}); assert(modelSize === 11);
      wheel(0, {...shift, deltaX: -2000}); assert(modelSize === 21);
      setSize(499); wheel(0, {...shift, deltaX: -100}); assert(modelSize === 500);
      setSize(1); wheel(0, {...shift, deltaX: 100}); assert(modelSize === 1);
    });
    await test("Shift horizontal scrolling remains native outside an active eligible canvas", async () => {
      await settings({enabled: true, modifier: "shift"});
      const shift = {altKey: false, shiftKey: true, deltaX: -100};
      assert(!wheel(0, shift, toolbox).defaultPrevented && !wheel(0, shift, document.body).defaultPrevented);
      assert(!wheel(0, {...shift, shiftKey: false}).defaultPrevented && !wheel(0, {...shift, altKey: true}).defaultPrevented);
      toolbox.hidden = true; assert(!wheel(0, shift).defaultPrevented); toolbox.hidden = false;
      brush.classList.remove("cvat-brush-tools-active-tool"); assert(!wheel(0, shift).defaultPrevented); brush.classList.add("cvat-brush-tools-active-tool");
      $("#input").focus(); assert(!wheel(0, shift).defaultPrevented); focusBody();
      assert(!wheel(0, {...shift, buttons: 1}).defaultPrevented);
      history.replaceState({}, "", "/unrelated"); assert(!wheel(0, shift).defaultPrevented); untouched();
    });
    await test("Ordinary wheel, wrong modifier, and extra modifiers preserve zoom/scroll", () => {
      for (const options of [{altKey: false}, {altKey: false, ctrlKey: true}, {shiftKey: true}, {metaKey: true}, {ctrlKey: true}, {modifierAltGraph: true}]) assert(!wheel(-100, options).defaultPrevented);
      assert(counts.ordinaryWheel === 6); untouched();
    });
    await test("Disabled wheel setting preserves normal wheel immediately", async () => {
      await settings({enabled: false, modifier: "alt"}); assert(!wheel().defaultPrevented && counts.ordinaryWheel === 1); untouched();
    });
    await test("No visible brush toolbox leaves normal wheel alone", () => {
      toolbox.hidden = true; assert(!wheel().defaultPrevented && counts.ordinaryWheel === 1); untouched();
    });
    await test("Polygon/ambiguous active tools do not change brush size", () => {
      brush.classList.remove("cvat-brush-tools-active-tool"); polygon.classList.add("cvat-brush-tools-active-tool");
      assert(!wheel().defaultPrevented); brush.classList.add("cvat-brush-tools-active-tool"); assert(!wheel().defaultPrevented); untouched();
    });
    await test("Wheel outside mask surface or over toolbox preserves normal scrolling", () => {
      assert(!wheel(-100, {}, toolbox).defaultPrevented && !wheel(-100, {}, document.body).defaultPrevented); untouched();
    });
    await test("Pointer coordinates outside canvas or covered by a panel fail safely", () => {
      assert(!wheel(-100, {clientX: 0, clientY: 0}).defaultPrevented);
      const overlay = document.createElement("div"); overlay.className = "test-extra";
      overlay.style.cssText = "position:fixed;right:24px;top:24px;width:420px;height:250px;z-index:10;background:white";
      document.body.append(overlay); assert(!wheel().defaultPrevented); untouched();
    });
    await test("Hidden canvas or missing CVAT canvas ancestry is ignored", () => {
      canvas.hidden = true; assert(!wheel().defaultPrevented); canvas.hidden = false;
      $("#cvat_canvas_wrapper").id = "test-wrong-wrapper"; assert(!wheel().defaultPrevented);
      $("#test-wrong-wrapper").id = "cvat_canvas_wrapper"; untouched();
    });
    await test("Typing fields and focused input prevent wheel resizing", () => {
      assert(!wheel(-100, {}, size).defaultPrevented);
      $("#input").focus(); assert(!wheel().defaultPrevented); focusBody(); untouched();
    });
    await test("Composition/IME and modal context prevent wheel resizing", () => {
      document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true})); assert(!wheel().defaultPrevented);
      document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
      $("#dialog").hidden = false; assert(!wheel().defaultPrevented); untouched();
    });
    await test("A pressed mouse button blocks size changes during painting", () => {
      assert(!wheel(-100, {buttons: 1}).defaultPrevented);
      document.body.dispatchEvent(new PointerEvent("pointerdown", {buttons: 1, bubbles: true}));
      assert(!wheel().defaultPrevented); document.body.dispatchEvent(new PointerEvent("pointerup", {buttons: 0, bubbles: true}));
      untouched(); assert(wheel().defaultPrevented && modelSize === 11);
    });
    await test("Wheel never synthesizes pointer/mouse strokes or save/continue clicks", () => {
      wheel(-100); wheel(100); assert(counts.updates === 2 && counts.pointerEvents === 0 && counts.saves === 0 && counts.starts === 0);
    });
    await test("Extension range clamps to 1–500 and preserves active context at limits", () => {
      setSize(1); assert(wheel(100).defaultPrevented && modelSize === 1);
      setSize(2); assert(wheel(100).defaultPrevented && modelSize === 1);
      setSize(499); assert(wheel(-100).defaultPrevented && modelSize === 500);
      assert(wheel(-100).defaultPrevented && modelSize === 500);
    });
    await test("Narrower DOM min/max bounds are respected", () => {
      size.setAttribute("aria-valuemin", "5"); size.setAttribute("aria-valuemax", "20");
      setSize(6); wheel(100); assert(modelSize === 5); setSize(19); wheel(-100); assert(modelSize === 20);
    });
    await test("Malformed or manually out-of-range sizes are left unchanged", () => {
      for (const value of ["", "oops", "1.5", "1e2", "0", "1000"]) {size.value = value; assert(!wheel().defaultPrevented && size.value === value);}
      assert(counts.updates === 0);
    });
    await test("Trackpad fractional deltas accumulate; line/page wheel modes work", () => {
      for (let index = 0; index < 4; index++) assert(wheel(-20).defaultPrevented && modelSize === 10);
      wheel(-20); assert(modelSize === 11 && counts.updates === 1);
      wheel(-3, {deltaMode: 1}); assert(modelSize === 12); wheel(1, {deltaMode: 2}); assert(modelSize === 11);
    });
    await test("Horizontal/zero/noncancelable/already handled wheel events are preserved", () => {
      assert(!wheel(-10, {deltaX: 100}).defaultPrevented && !wheel(0).defaultPrevented);
      assert(!wheel(-100, {cancelable: false}).defaultPrevented);
      const event = new WheelEvent("wheel", {deltaY: -100, altKey: true, bubbles: true, cancelable: true});
      event.preventDefault(); surface.dispatchEvent(event); untouched();
    });
    await test("Disabled, readonly, and hidden size controls are ignored", () => {
      size.disabled = true; assert(!wheel().defaultPrevented); size.disabled = false;
      size.readOnly = true; assert(!wheel().defaultPrevented); size.readOnly = false;
      size.hidden = true; assert(!wheel().defaultPrevented); size.hidden = false;
      toolbox.setAttribute("aria-disabled", "true"); assert(!wheel().defaultPrevented); untouched();
    });
    await test("Duplicate visible size inputs/toolboxes fail safely", () => {
      const extra = size.cloneNode(true); extra.className = "test-extra"; size.parentElement.append(extra);
      assert(!wheel().defaultPrevented); extra.remove();
      const duplicate = toolbox.cloneNode(true); duplicate.classList.add("test-extra"); document.body.append(duplicate);
      assert(!wheel().defaultPrevented); untouched();
    });
    await test("Hidden duplicate size input is ignored", () => {
      const extra = size.cloneNode(true); extra.className = "test-extra"; extra.hidden = true; size.parentElement.append(extra);
      assert(wheel().defaultPrevented && modelSize === 11);
    });
    await test("Paused tab and unrelated CVAT route do not resize", async () => {
      await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"}); assert(!wheel().defaultPrevented);
      await window.__cvatSidebarShortcutsControllerV1.enable(); history.replaceState({}, "", "/unrelated");
      assert(!wheel().defaultPrevented); untouched();
    });
    await test("Uncanceled existing-mask toolbox blocks AI/Shape starts after Escape request", async () => {
      $(".cvat-draw-mask-control").classList.remove("cvat-active-canvas-control");
      const current = S.normalize(null); current.shortcuts.ai = S.sanitizeShortcut({code: "KeyA"});
      await chrome.storage.local.set({[S.STORAGE_KEY]: current});
      const event = new KeyboardEvent("keydown", {key: "a", code: "KeyA", bubbles: true, cancelable: true});
      document.body.dispatchEvent(event); assert(event.defaultPrevented && counts.starts === 0);
      await delay(1300); assert(counts.starts === 0); untouched();
    });
    await test("Blur clears the fractional wheel session", () => {
      assert(wheel(-40).defaultPrevented && modelSize === 10); window.dispatchEvent(new Event("blur"));
      assert(wheel(-60).defaultPrevented && modelSize === 10); untouched();
      assert(wheel(-40).defaultPrevented && modelSize === 11);
    });
  } catch (error) {results.push({name: "Wheel fixture setup", passed: false, error: error.message});}
  const summary = {suite: "wheel", passed: results.filter((test) => test.passed).length,
    failed: results.filter((test) => !test.passed).length, results, totalEvents: totals};
  document.getElementById("test-results").textContent = JSON.stringify(summary, null, 2); window.fixtureResults = summary;
})();
