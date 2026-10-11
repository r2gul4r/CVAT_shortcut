(async () => {
  "use strict";
  const S = CVATShortcuts, results = [], $ = (s) => document.querySelector(s);
  const canvas = $("#cvat_canvas_wrapper"), surface = $("#mask-surface"), container = canvas.parentElement;
  const toolbox = $(".cvat-brush-tools-toolbox"), brush = $(".cvat-brush-tools-brush");
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  let nativeDrag = false, origin, offset, downs, ups, brushEvents, esc, clicks;
  // Public canvasView.ts contract: middle down enables drag, root move drags, document up disables.
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1) { nativeDrag = true; origin = [e.clientX, e.clientY]; downs++; }
  });
  canvas.addEventListener("mousemove", (e) => {
    if (nativeDrag) offset = [e.clientX - origin[0], e.clientY - origin[1]];
  });
  document.addEventListener("mouseup", (e) => { if (e.button === 1) { nativeDrag = false; ups++; } });
  for (const type of ["pointerdown", "pointermove", "mousedown", "mousemove"]) surface.addEventListener(type, (e) => {
    if (e.buttons & 1) brushEvents++;
  });
  surface.addEventListener("click", () => clicks++);
  document.addEventListener("keydown", (e) => { if (e.code === "Escape") esc++; });
  function assert(value, message = "Unexpected pan or brush state") { if (!value) throw new Error(message); }
  function key(type = "keydown", opts = {}, target = document.body) {
    const event = new KeyboardEvent(type, {bubbles: true, cancelable: true, code: "Space", key: " ", ...opts});
    target.dispatchEvent(event); return event;
  }
  function mouse(type, opts = {}, target = surface) {
    const rect = surface.getBoundingClientRect();
    const Constructor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    const event = new Constructor(type, {bubbles: true, cancelable: true, composed: true,
      button: 0, buttons: /up$|cancel$|click$/.test(type) ? 0 : 1,
      pointerType: "mouse", pointerId: 1, clientX: rect.left + 80, clientY: rect.top + 80, ...opts});
    target.dispatchEvent(event); return event;
  }
  const begin = () => { key(); mouse("pointerdown"); };
  const finish = () => { mouse("pointerup"); key("keyup"); };
  async function setting(value) {
    const old = await chrome.storage.local.get(S.STORAGE_KEY);
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize({...old[S.STORAGE_KEY], ...value})});
  }
  async function reset() {
    container.append(canvas);
    window.dispatchEvent(new Event("blur")); mouse("pointerup"); key("keyup");
    canvas.hidden = false; container.hidden = false;
    $(".cvat-canvas-controls-sidebar").hidden = false; $("#dialog").hidden = true;
    document.querySelectorAll(".pan-test-extra").forEach((el) => el.remove());
    document.dispatchEvent(new CompositionEvent("compositionend"));
    history.replaceState({}, "", "/tasks/1/jobs/6"); document.body.focus();
    toolbox.hidden = false; brush.classList.add("cvat-brush-tools-active-tool");
    await setting({spacePan: true, shortcuts: {ai: null, brush: null}});
    await window.__cvatSidebarShortcutsControllerV1.enable();
    nativeDrag = false; offset = [0, 0]; downs = ups = brushEvents = esc = clicks = 0;
  }
  async function test(name, run) {
    try { await reset(); await run(); results.push({name, passed: true}); }
    catch (error) { results.push({name, passed: false, error: error.message}); }
  }
  try {
    fixtureAPI.clear();
    const script = document.createElement("script"); script.src = "/extension/content.js";
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
    await test("Existing settings migrate to enabled pan, preserving keys, label and wheel", () => {
      const old = {shortcuts: {ai: {code: "KeyV"}}, defaultLabelName: "example", brushWheel: {enabled: false, modifier: "shift"}};
      const next = S.normalize(old);
      assert(next.spacePan && next.shortcuts.ai.code === "KeyV" && next.defaultLabelName === "example" && !next.brushWheel.enabled);
    });
    await test("Space pointer drag moves native canvas without brush events, Escape or tool changes", () => {
      const before = toolbox.outerHTML; begin();
      const rect = surface.getBoundingClientRect();
      mouse("pointermove", {clientX: rect.left + 120, clientY: rect.top + 100});
      assert(nativeDrag && offset[0] === 40 && offset[1] === 20 && downs === 1);
      finish(); assert(!nativeDrag && ups === 1 && brushEvents === 0 && esc === 0 && toolbox.outerHTML === before);
    });
    await test("Compatibility mouse events do not duplicate pointer-driven panning", () => {
      begin(); mouse("mousedown"); mouse("pointermove"); mouse("mousemove"); finish(); mouse("mouseup");
      assert(downs === 1 && ups === 1 && brushEvents === 0);
    });
    await test("Mouse-only fallback pans and releases", () => {
      key(); mouse("mousedown"); mouse("mousemove"); mouse("mouseup"); key("keyup");
      assert(downs === 1 && ups === 1 && !nativeDrag && brushEvents === 0);
    });
    await test("Releasing Space first drains left movement and trailing click", () => {
      begin(); key("keyup"); assert(!nativeDrag && ups === 1);
      mouse("pointermove"); mouse("mousemove"); mouse("pointerup"); mouse("click");
      assert(brushEvents === 0 && clicks === 0);
      mouse("pointerdown"); assert(brushEvents === 1, "A new stroke must work after release"); mouse("pointerup");
    });
    await test("Multiple drags work during one held Space", () => {
      begin(); mouse("pointerup"); mouse("pointerdown"); mouse("pointermove"); finish();
      assert(downs === 2 && ups === 2 && brushEvents === 0);
    });
    await test("Ordinary left brush drag passes through", () => {
      mouse("pointerdown"); mouse("pointermove"); mouse("pointerup"); assert(brushEvents === 2 && downs === 0);
    });
    await test("Native middle mouse still passes through", () => {
      mouse("mousedown", {button: 1, buttons: 4}); mouse("mousemove", {button: 1, buttons: 4}); mouse("mouseup", {button: 1});
      assert(downs === 1 && ups === 1 && brushEvents === 0);
    });
    await test("Space pressed mid-stroke never hijacks that stroke", () => {
      mouse("pointerdown"); assert(key().defaultPrevented); mouse("pointermove"); mouse("pointerup");
      assert(key("keydown", {repeat: true}).defaultPrevented); key("keyup"); assert(brushEvents === 2 && downs === 0);
    });
    await test("Text field Space is left to text editing", () => {
      $("#input").focus(); assert(!key("keydown", {}, $("#input")).defaultPrevented); assert(downs === 0);
    });
    await test("IME Space passes through", () => {
      document.dispatchEvent(new CompositionEvent("compositionstart")); assert(!key().defaultPrevented);
    });
    await test("Modified Space passes through", () => {
      for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) assert(!key("keydown", {[modifier]: true}).defaultPrevented);
    });
    await test("Dialog blocks Space pan", () => { $("#dialog").hidden = false; assert(!key().defaultPrevented); });
    await test("Feature toggle restores native Space", async () => { await setting({spacePan: false}); assert(!key().defaultPrevented); });
    await test("Paused tab restores native Space", async () => {
      await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"}); assert(!key().defaultPrevented);
    });
    await test("Saved tool Space has priority over pan", async () => {
      await setting({shortcuts: {ai: {code: "Space"}}}); key(); mouse("pointerdown"); assert(downs === 0); mouse("pointerup"); key("keyup");
    });
    await test("Controls within canvas are never treated as pan surfaces", () => {
      const button = document.createElement("button"); button.className = "pan-test-extra"; canvas.append(button);
      key(); assert(!mouse("pointerdown", {}, button).defaultPrevented); mouse("pointerup", {}, button); key("keyup"); assert(downs === 0);
    });
    await test("Outside-canvas presses pass through", () => {
      key(); assert(!mouse("pointerdown", {}, document.body).defaultPrevented); mouse("pointerup", {}, document.body); key("keyup"); assert(downs === 0);
    });
    await test("CVAT attachment board is excluded from pan", () => {
      const board = document.createElement("div"); board.id = "cvat_canvas_attachment_board"; board.className = "pan-test-extra"; canvas.append(board);
      key(); assert(!mouse("pointerdown", {}, board).defaultPrevented); mouse("pointerup", {}, board); key("keyup"); assert(downs === 0);
    });
    await test("Touch input is not converted into mouse pan", () => {
      key(); mouse("pointerdown", {pointerType: "touch"}); mouse("pointerup", {pointerType: "touch"}); key("keyup"); assert(downs === 0);
    });
    await test("Release outside canvas ends drag", () => { begin(); mouse("pointerup", {}, document.body); key("keyup"); assert(!nativeDrag && ups === 1); });
    await test("Window blur releases native drag and drains old stroke", () => {
      begin(); window.dispatchEvent(new Event("blur")); mouse("pointermove"); mouse("pointerup"); assert(!nativeDrag && ups === 1 && brushEvents === 0);
    });
    await test("Pointer cancellation releases native drag", () => { begin(); mouse("pointercancel"); key("keyup"); assert(!nativeDrag && ups === 1); });
    await test("Losing left button state recovers from a missed mouseup", () => {
      begin(); mouse("pointermove", {buttons: 0}); key("keyup"); assert(!nativeDrag && ups === 1);
    });
    await test("Settings change during pan releases and drains", async () => {
      begin(); await setting({spacePan: false}); mouse("pointermove"); mouse("pointerup"); assert(!nativeDrag && ups === 1 && brushEvents === 0);
    });
    await test("Tab pause during pan releases and drains", async () => {
      begin(); await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"}); mouse("pointermove"); mouse("pointerup"); assert(!nativeDrag && ups === 1 && brushEvents === 0);
    });
    await test("Job navigation releases native drag without further movement", async () => {
      begin(); history.replaceState({}, "", "/tasks/1/jobs/99"); await wait(130); assert(!nativeDrag && ups === 1);
    });
    await test("Detached canvas releases at document", async () => { begin(); canvas.remove(); await wait(130); assert(!nativeDrag && ups === 1); });
    await test("Focus moving into text cancels and drains pan", () => {
      begin(); $("#input").focus(); mouse("pointermove"); mouse("pointerup");
      assert(!nativeDrag && ups === 1 && brushEvents === 0, JSON.stringify({nativeDrag, downs, ups, brushEvents, focus: document.activeElement.id}));
    });
    await test("Wheel is swallowed during drag", () => {
      begin(); const e = new WheelEvent("wheel", {bubbles: true, cancelable: true}); surface.dispatchEvent(e);
      assert(e.defaultPrevented); finish();
    });
    await test("Held Space repeats and release never reach native shortcuts", () => {
      assert(key().defaultPrevented && key("keydown", {repeat: true}).defaultPrevented && key("keyup").defaultPrevented);
    });
    await test("Hidden canvas does not claim Space", () => { canvas.hidden = true; assert(!key().defaultPrevented); });
  } catch (error) { results.push({name: "Setup", passed: false, error: error.message}); }
  window.dispatchEvent(new Event("blur"));
  const summary = {suite: "space-pan", passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, results};
  $("#test-results").textContent = JSON.stringify(summary, null, 2);
})();
