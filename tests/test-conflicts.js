/* Real public Mousetrap 1.6.5 + CVAT's binding contract on synthetic controls, not actual CVAT. */
(async () => {
  "use strict";
  const results = [], S = CVATShortcuts;
  const $ = (selector) => document.querySelector(selector);
  const ai = $(".cvat-tools-control"), brush = $(".cvat-draw-mask-control");
  const panel = $(".cvat-tools-control-popover"), maskPanel = $(".cvat-draw-mask-popover");
  const interact = $(".cvat-tools-interact-button"), shape = $(".cvat-draw-mask-shape-button");
  const side = $(".cvat-canvas-controls-sidebar"), surface = $("#mask-surface");
  const toolbox = $(".cvat-brush-tools-toolbox"), size = $("#brush-size");
  const counts = {extension: 0, opens: 0, nativeDown: 0, nativeUp: 0, docCapture: 0,
    laterCapture: 0, target: 0, windowBubble: 0, nativeWheel: 0, docWheelCapture: 0,
    laterWheelCapture: 0, priorKey: 0, priorWheel: 0, updates: 0};
  let priorKeyMode = "off", priorWheelMode = "off", ctrlPressed = false;
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  function assert(value, message) {if (!value) throw new Error(message || JSON.stringify(counts));}
  function stop(event, mode) {
    if (mode === "prevent") event.preventDefault();
    if (mode === "stop") event.stopPropagation();
  }
  // These listeners are installed BEFORE the extension. Same-window capture order is deliberate.
  window.addEventListener("keydown", (event) => {
    if (priorKeyMode !== "off" && event.code === "KeyA") {counts.priorKey++; stop(event, priorKeyMode);}
  }, true);
  window.addEventListener("wheel", (event) => {
    if (priorWheelMode !== "off") {counts.priorWheel++; stop(event, priorWheelMode);}
  }, {capture: true, passive: false});
  document.addEventListener("keydown", (event) => {if (event.code === "KeyA") counts.docCapture++;}, true);
  document.addEventListener("wheel", () => {counts.docWheelCapture++;}, true);
  document.addEventListener("keydown", (event) => {if (event.code === "ControlLeft") ctrlPressed = true;});
  document.addEventListener("keyup", (event) => {
    if (event.code === "ControlLeft") ctrlPressed = false;
    if (event.code === "KeyA") counts.nativeUp++;
  });
  document.body.addEventListener("keydown", (event) => {if (event.code === "KeyA") counts.target++;});
  window.addEventListener("keydown", (event) => {if (event.code === "KeyA") counts.windowBubble++;});
  surface.addEventListener("wheel", (event) => {counts.nativeWheel++; event.preventDefault();}, {passive: false});
  size.addEventListener("input", () => {counts.updates++;});
  // Equivalent to the reviewed CVAT GlobalHotKeys keydown contract; no React/global store access.
  Mousetrap.prototype.stopCallback = (_event, element) => ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) || !$("#dialog").hidden;
  Mousetrap.bind(["a", "ctrl+a"], (event) => {
    event.preventDefault(); event.stopPropagation(); counts.nativeDown++;
  }, "keydown");
  ai.onclick = () => {counts.opens++; panel.hidden = false;};
  Mousetrap.bind("esc", () => { idle(); toolbox.hidden = true; }, "keydown");
  brush.onclick = () => {counts.opens++; maskPanel.hidden = false;};
  interact.onclick = () => {counts.extension++; panel.hidden = true; ai.classList.add("cvat-active-canvas-control");};
  shape.onclick = () => {counts.extension++; maskPanel.hidden = true; brush.classList.add("cvat-active-canvas-control");};
  function key(type, code = "KeyA", options = {}, target = document.body) {
    const letter = code.startsWith("Key") ? code.slice(3) : code === "ControlLeft" ? "Control" : code;
    const keyCode = code.startsWith("Key") ? letter.charCodeAt(0) : code === "ControlLeft" ? 17 : 91;
    const event = new KeyboardEvent(type, {key: letter.toLowerCase(), code, keyCode, which: keyCode,
      bubbles: true, composed: true, cancelable: true, ...options});
    target.dispatchEvent(event); return event;
  }
  const down = (...args) => key("keydown", ...args), up = (...args) => key("keyup", ...args);
  function wheel(options = {}, target = surface) {
    const rect = surface.getBoundingClientRect();
    const event = new WheelEvent("wheel", {deltaY: -100, deltaX: 0, altKey: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      bubbles: true, composed: true, cancelable: true, ...options});
    target.dispatchEvent(event); return event;
  }
  function idle() {
    panel.hidden = true; maskPanel.hidden = true;
    ai.classList.remove("cvat-active-canvas-control"); brush.classList.remove("cvat-active-canvas-control");
    document.body.focus();
  }
  async function settings(value = {}) {
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize({shortcuts: {ai: {code: "KeyA"}}, ...value})});
    await delay();
  }
  async function reset() {
    await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"});
    window.dispatchEvent(new Event("blur")); labelFixture.reset();
    side.append(ai, brush); side.hidden = false;
    ai.hidden = false; ai.disabled = false; ai.removeAttribute("aria-disabled");
    interact.hidden = false; interact.disabled = false;
    $("#dialog").hidden = true; toolbox.hidden = true;
    for (const button of toolbox.querySelectorAll("button")) button.classList.remove("cvat-brush-tools-active-tool");
    $(".cvat-brush-tools-brush").classList.add("cvat-brush-tools-active-tool");
    size.value = "10"; size.disabled = false; size.readOnly = false;
    priorKeyMode = priorWheelMode = "off"; ctrlPressed = false;
    idle(); history.replaceState({}, "", "/tasks/1/jobs/5");
    await settings(); await window.__cvatSidebarShortcutsControllerV1.enable(); await delay(260);
    for (const name of Object.keys(counts)) counts[name] = 0;
  }
  async function test(name, fn) {
    try {await reset(); await fn(); results.push({name, passed: true});}
    catch (error) {results.push({name, passed: false, error: error.message});}
  }
  function noNativeKey() {assert(counts.nativeDown === 0 && counts.nativeUp === 0 && counts.docCapture === 0 && counts.laterCapture === 0 && counts.target === 0 && counts.windowBubble === 0);}
  try {
    fixtureAPI.clear();
    const script = document.createElement("script"); script.src = "/extension/content.js";
    await new Promise((resolve, reject) => {script.onload = resolve; script.onerror = reject; document.head.append(script);});
    window.addEventListener("keydown", (event) => {if (event.code === "KeyA") counts.laterCapture++;}, true);
    window.addEventListener("wheel", () => {counts.laterWheelCapture++;}, {capture: true, passive: false});
    await test("Handled down/release blocks prior document capture, real Mousetrap and later listeners", () => {
      assert(down().defaultPrevented && up().defaultPrevented); assert(counts.extension === 1); noNativeKey();
    });
    await test("Held repeats cannot invoke native CVAT after extension starts drawing", () => {
      down(); for (let index = 0; index < 4; index++) assert(down("KeyA", {repeat: true}).defaultPrevented);
      assert(up().defaultPrevented && counts.extension === 1); noNativeKey();
    });
    await test("A new press during drawing runs real Mousetrap Escape then restarts without leaking its key", async () => {
      down(); up(); await delay(260); down(); up();
      assert(counts.extension === 2 && counts.nativeDown === 0 && counts.nativeUp === 0);
    });
    await test("Accepted activation with missing default label fails without native fallback", () => {
      const label = labelFixture.byID("ai-label"); label.options(["person"]); label.root.value = "person";
      assert(down().defaultPrevented && up().defaultPrevented);
      assert(counts.extension === 0 && counts.opens === 1); noNativeKey();
    });
    await test("Accepted activation timeout retains ownership through repeats and release", async () => {
      interact.hidden = true; down(); await delay(1300);
      assert(down("KeyA", {repeat: true}).defaultPrevented && up().defaultPrevented);
      assert(counts.extension === 0 && counts.opens === 1); noNativeKey();
    });
    await test("Missing or disabled tool keeps its key reserved instead of falling through to CVAT", () => {
      ai.hidden = true; down(); up();
      assert(counts.extension === 0 && counts.nativeDown === 0 && counts.nativeUp === 0);
      ai.hidden = false; ai.setAttribute("aria-disabled", "true"); down(); up();
      assert(counts.extension === 0 && counts.nativeDown === 0 && counts.nativeUp === 0);
    });
    await test("Typing and contenteditable are passed through without extension activation", () => {
      const input = $("#input"); input.focus(); down("KeyA", {}, input); up("KeyA", {}, input);
      assert(counts.extension === 0 && counts.docCapture === 1 && counts.nativeUp === 1);
      const editable = document.createElement("div"); editable.contentEditable = "true"; editable.tabIndex = 0; document.body.append(editable);
      editable.focus(); down("KeyA", {}, editable); up("KeyA", {}, editable); editable.remove();
      assert(counts.extension === 0 && counts.docCapture === 2 && counts.nativeUp === 2);
    });
    await test("IME/composition/keyCode 229 are not claimed by the extension", () => {
      down("KeyA", {isComposing: true}); up("KeyA", {isComposing: true});
      down("KeyA", {keyCode: 229, which: 229}); up("KeyA", {keyCode: 229, which: 229});
      document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
      down(); up(); document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
      assert(counts.extension === 0 && counts.docCapture === 3 && counts.nativeUp === 3);
    });
    await test("Modifier releases remain visible so native canvas Ctrl state cannot stick", async () => {
      await settings({shortcuts: {ai: {code: "KeyA", ctrl: true}}});
      down("ControlLeft", {key: "Control", ctrlKey: true}); assert(ctrlPressed);
      assert(down("KeyA", {ctrlKey: true}).defaultPrevented && up("KeyA", {ctrlKey: true}).defaultPrevented);
      up("ControlLeft", {key: "Control"}); assert(!ctrlPressed && counts.extension === 1); noNativeKey();
    });
    await test("A pre-cancelled registered key still runs the extension instead of CVAT", () => {
      priorKeyMode = "prevent"; down(); up(); assert(counts.priorKey === 1 && counts.extension === 1); noNativeKey();
    });
    await test("Earlier stopPropagation does not prevent same-window extension priority", () => {
      priorKeyMode = "stop"; down(); up(); assert(counts.priorKey === 1 && counts.extension === 1 && counts.nativeDown === 0);
    });
    await test("Documented limit: earlier unmarked window capture action cannot be undone", () => {
      priorKeyMode = "run"; down(); up(); assert(counts.priorKey === 1 && counts.extension === 1); noNativeKey();
    });
    await test("Pause after a claimed down keeps its nonediting release away from native actions", async () => {
      down(); await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"});
      assert(up().defaultPrevented && counts.extension === 1); noNativeKey();
    });
    await test("Focus/IME change passes keyup safely; blur removes stale claims", () => {
      down(); const input = $("#input"); input.focus(); assert(!up("KeyA", {}, input).defaultPrevented);
      assert(counts.extension === 1 && counts.nativeUp === 1);
      window.dispatchEvent(new Event("blur")); document.body.focus(); up(); assert(counts.nativeUp === 2);
    });
    await test("Cmd release preserves repeat ownership and fresh press recovers omitted letter keyup", async () => {
      await settings({shortcuts: {ai: {code: "KeyA", meta: true}}}); down("KeyA", {metaKey: true});
      up("MetaLeft", {key: "Meta"}); assert(down("KeyA", {repeat: true}).defaultPrevented);
      idle(); await delay(260); down("KeyA", {metaKey: true}); up("KeyA", {metaKey: true});
      assert(counts.extension === 2); noNativeKey();
    });
    await test("Clearing a binding during a press blocks old repeats, then permits native behavior", async () => {
      down(); await settings({shortcuts: {ai: null}});
      assert(down("KeyA", {repeat: true}).defaultPrevented && up().defaultPrevented); noNativeKey();
      idle(); await delay(260); down(); up(); assert(counts.extension === 1 && counts.nativeDown === 1 && counts.nativeUp === 1);
    });
    await test("Alt wheel sizing blocks prior document capture and native target zoom/scroll", () => {
      toolbox.hidden = false; const event = wheel();
      assert(event.defaultPrevented && size.value === "11" && counts.updates === 1 && counts.nativeWheel === 0 && counts.docWheelCapture === 0 && counts.laterWheelCapture === 0);
    });
    await test("Shift horizontal and vertical wheel use one size step without native zoom", async () => {
      toolbox.hidden = false; await settings({brushWheel: {enabled: true, modifier: "shift"}});
      wheel({altKey: false, shiftKey: true}); assert(size.value === "11");
      wheel({altKey: false, shiftKey: true, deltaY: 0, deltaX: 100});
      assert(size.value === "10" && counts.updates === 2 && counts.nativeWheel === 0 && counts.docWheelCapture === 0);
    });
    await test("Ordinary wheel and Ctrl/Cmd/pinch reach native handlers unchanged by extension", () => {
      toolbox.hidden = false;
      for (const options of [{altKey: false}, {ctrlKey: true}, {metaKey: true}, {altKey: false, ctrlKey: true}]) wheel(options);
      assert(size.value === "10" && counts.updates === 0 && counts.nativeWheel === 4 && counts.docWheelCapture === 4);
    });
    await test("Wheel during stroke or without active Brush/Eraser is left to native handling", () => {
      toolbox.hidden = false; wheel({buttons: 1});
      $(".cvat-brush-tools-brush").classList.remove("cvat-brush-tools-active-tool"); wheel();
      assert(size.value === "10" && counts.updates === 0 && counts.nativeWheel === 2);
    });
    await test("Earlier window wheel cancellation is respected without a size change", () => {
      toolbox.hidden = false; priorWheelMode = "prevent"; wheel();
      assert(counts.priorWheel === 1 && size.value === "10" && counts.updates === 0);
      priorWheelMode = "stop"; wheel(); assert(counts.priorWheel === 2 && size.value === "10" && counts.updates === 0);
    });
    await test("Documented wheel limit: earlier unmarked window capture cannot be undone", () => {
      toolbox.hidden = false; priorWheelMode = "run"; wheel();
      assert(counts.priorWheel === 1 && size.value === "11" && counts.nativeWheel === 0);
    });
    await test("Unrelated route and paused tab preserve source-like native shortcuts", async () => {
      history.replaceState({}, "", "/unrelated"); down(); up(); assert(counts.extension === 0 && counts.nativeDown === 1);
      history.replaceState({}, "", "/tasks/1/jobs/5"); await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"});
      down(); up(); assert(counts.extension === 0 && counts.nativeDown === 2);
    });
  } catch (error) {results.push({name: "Conflict fixture setup", passed: false, error: error.message});}
  const summary = {suite: "conflicts", passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length, results,
    evidence: "Public Mousetrap 1.6.5 and replicated CVAT keydown binding on synthetic DOM; not real CVAT or isolated-world/native OS proof"};
  document.getElementById("test-results").textContent = JSON.stringify(summary, null, 2);
})();
