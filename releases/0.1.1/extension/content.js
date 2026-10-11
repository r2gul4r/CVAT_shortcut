/* Runs in Chrome's isolated world only after explicit per-tab activation. */
(() => {
  "use strict";
  const shared = globalThis.CVATShortcuts;
  const INSTANCE = "__cvatSidebarShortcutsControllerV1";
  if (globalThis[INSTANCE]) return globalThis[INSTANCE].enable();

  const TOOLS = Object.freeze({
    ai: {selector: ".cvat-tools-control", panel: ".cvat-tools-control-popover",
      content: ".cvat-tools-control-popover-content",
      start: ".cvat-tools-control-popover-content button.cvat-tools-interact-button",
      startLabel: "Interact", label: "AI tool"},
    brush: {selector: ".cvat-draw-mask-control", panel: ".cvat-draw-mask-popover",
      content: ".cvat-draw-shape-popover-content",
      start: ".cvat-draw-shape-popover-content button.cvat-draw-mask-shape-button",
      startLabel: "Shape", label: "New mask (Brush tool)"}
  });
  const SIDEBAR = ".cvat-canvas-controls-sidebar";
  const DISABLED = "[disabled], [aria-disabled='true'], [inert], .cvat-disabled-canvas-control, .ant-btn-loading";
  let enabled = false;
  let composing = false;
  let settings = shared.normalize(null);
  let feedback;
  let feedbackTimer;
  let generation = 0;
  let pending = null;
  const heldCodes = new Set();
  const claimedCodes = new Set();
  let cooldownUntil = 0;
  const READY_TIMEOUT_MS = 1200;
  const READY_POLL_MS = 50;
  const START_COOLDOWN_MS = 250;
  let mouseButtons = 0;
  let wheelSession = null;
  const TOOLBOX = ".cvat-brush-tools-toolbox";
  const MAX_BRUSH_SIZE = 500;
  const BRUSH_STEP = 1;

  function visible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === "none" || style.visibility !== "visible" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth;
  }

  function sidebar() {
    if (!shared.supportedURL(location.href) || window.top !== window) return null;
    const candidates = [...document.querySelectorAll(SIDEBAR)].filter(visible);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function notify(message) {
    // Static extension-generated feedback only. Never copy page data into feedback/storage/logs.
    clearTimeout(feedbackTimer);
    if (!feedback?.isConnected) {
      feedback = document.createElement("div");
      feedback.id = "cvat-sidebar-shortcuts-feedback";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      feedback.style.cssText = "position:fixed;bottom:20px;left:64px;z-index:2147483647;max-width:380px;padding:12px 16px;border-radius:8px;background:#17324d;color:white;font:14px/1.5 system-ui;box-shadow:0 3px 12px #0003;pointer-events:none;";
      document.body.append(feedback);
    }
    feedback.textContent = message;
    feedbackTimer = setTimeout(() => feedback?.remove(), 3800);
  }

  function editable(node) {
    return node instanceof Element && (node.isContentEditable ||
      Boolean(node.closest("input, textarea, select, [role='textbox'], [role='searchbox'], [role='combobox'], [role='spinbutton']")));
  }

  function typing(event) {
    if (event.composedPath().some(editable)) return true;
    return focusedEditable();
  }

  function focusedEditable() {
    return editable(focusedElement());
  }

  function focusedElement() {
    let focus = document.activeElement;
    while (focus?.shadowRoot?.activeElement) focus = focus.shadowRoot.activeElement;
    return focus;
  }

  function busy(side) {
    if ([...document.querySelectorAll("[role='dialog'], [aria-modal='true'], .ant-modal")].some(visible)) return true;
    // The shared toolbox also identifies existing-mask EDIT, whose sidebar can show Cursor.
    if ([...document.querySelectorAll(TOOLBOX)].some(visible)) return true;
    // CVAT's active tool icon click can stop/save a drawing. Only open initial sidebar tools at rest.
    return [...side.querySelectorAll(".cvat-active-canvas-control")].some((element) =>
      visible(element) && !element.matches(".cvat-cursor-control, .cvat-move-control"));
  }

  function onWheel(event) {
    // Pinch/zoom gestures and Cmd-wheel stay native; do not retain a sizing fraction across them.
    if (event.ctrlKey || event.metaKey) { wheelSession = null; return; }
    if (!enabled || !settings.brushWheel.enabled || event.defaultPrevented || event.cancelBubble || !event.cancelable ||
        composing || typing(event) || mouseButtons || event.buttons || pending || !sidebar() ||
        !Number.isFinite(event.deltaY) || !Number.isFinite(event.deltaX) ||
        event.getModifierState?.("AltGraph")) return;
    const modifier = settings.brushWheel.modifier;
    if (modifier === "alt" ? (!event.altKey || event.shiftKey) :
      (!event.shiftKey || event.altKey)) return;
    // Some browsers map Shift + wheel onto deltaX. Use its dominant axis once.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (modifier === "alt" && horizontal) return;
    const delta = horizontal ? event.deltaX : event.deltaY;
    if (!delta) return;
    if ([...document.querySelectorAll("[role='dialog'], [aria-modal='true'], .ant-modal")].some(visible)) return;
    const target = event.target instanceof Element ? event.target : null;
    const canvas = target?.closest(".cvat_masks_canvas_wrapper");
    if (!canvas || !visible(canvas) || !canvas.closest(".cvat-canvas-container #cvat_canvas_wrapper")) return;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!hit || hit.closest(".cvat_masks_canvas_wrapper") !== canvas) return;
    const toolboxes = [...document.querySelectorAll(TOOLBOX)].filter(visible);
    if (toolboxes.length !== 1) return;
    const toolbox = toolboxes[0];
    const activeTools = [...toolbox.querySelectorAll("button.cvat-brush-tools-active-tool")].filter((element) =>
      visible(element) && element.matches(".cvat-brush-tools-brush, .cvat-brush-tools-eraser, .cvat-brush-tools-polygon-plus, .cvat-brush-tools-polygon-minus"));
    if (activeTools.length !== 1 || !activeTools[0].matches(".cvat-brush-tools-brush, .cvat-brush-tools-eraser") ||
        activeTools[0].closest(DISABLED)) return;
    const inputs = [...toolbox.querySelectorAll(".cvat-brush-tools-brush-size input, input.cvat-brush-tools-brush-size")].filter(visible);
    if (inputs.length !== 1) return;
    const input = inputs[0];
    if (!(input instanceof HTMLInputElement) || input.readOnly || input.closest(DISABLED) || !/^\d+$/.test(input.value)) return;
    const current = Number(input.value);
    const declaredMin = Number(input.getAttribute("min") ?? input.getAttribute("aria-valuemin") ?? 1);
    const declaredMax = Number(input.getAttribute("max") ?? input.getAttribute("aria-valuemax") ?? MAX_BRUSH_SIZE);
    const min = Math.max(1, Number.isFinite(declaredMin) ? Math.ceil(declaredMin) : 1);
    const max = Math.min(MAX_BRUSH_SIZE, Number.isFinite(declaredMax) ? Math.floor(declaredMax) : MAX_BRUSH_SIZE);
    if (!Number.isSafeInteger(current) || min > max || current < min || current > max) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return;
    const now = performance.now();
    if (!wheelSession || wheelSession.input !== input || wheelSession.modifier !== modifier || now - wheelSession.at > 350) {
      wheelSession = {input, modifier, remainder: 0, at: now};
    }
    wheelSession.at = now;
    wheelSession.remainder += delta / (event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100);
    const whole = Math.trunc(wheelSession.remainder);
    wheelSession.remainder -= whole;
    const ticks = Math.max(-10, Math.min(10, whole));
    const next = Math.max(min, Math.min(max, current - ticks * BRUSH_STEP));
    // Intercept only this verified active size-control context, including fractional deltas/limits.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (next === current) return;
    try {
      // Native setter bypasses a controlled-input value tracker; normal input events update CVAT.
      // No pointer/mouse events or canvas APIs are synthesized, so this cannot paint a stroke.
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", {bubbles: true}));
      input.dispatchEvent(new Event("change", {bubbles: true}));
    } catch { notify("Brush size could not be updated. Use CVAT's size control manually."); }
  }

  function cancelPending(message) {
    if (!pending) return;
    const operation = pending;
    clearTimeout(operation.timer);
    pending = null;
    // A failed extension-owned label selection restores only the focus it took itself.
    // User typing/IME and ordinary cancellation pass no message and retain their focus.
    if (message && operation.labelSelector?.contains(focusedElement())) {
      focusedElement()?.blur?.();
      operation.previousFocus?.focus?.({preventScroll: true});
    }
    if (message) notify(message);
  }

  function ensureDefaultLabel(operation, panel, button) {
    if (!operation.labelName) {
      cancelPending("Set a valid default label name in the extension popup before starting."); return false;
    }
    const content = panel.querySelector(operation.tool.content);
    const scope = button.closest("[role='tabpanel']") || content;
    if (!scope || !panel.contains(scope)) { cancelPending("Label selector context is unavailable. Start manually."); return false; }
    const selectors = [...scope.querySelectorAll(".ant-select")].filter((element) => visible(element) &&
      element.querySelector(".ant-select-selection-item .cvat-label-selector-option"));
    if (selectors.length !== 1) {
      cancelPending("Label selector is missing or ambiguous. Start manually."); return false;
    }
    const selector = selectors[0];
    if ((operation.labelSelector && operation.labelSelector !== selector) ||
        selector.matches(".ant-select-disabled") || selector.closest(DISABLED)) {
      cancelPending("Label selector changed or is disabled. Start manually."); return false;
    }
    operation.labelSelector = selector;
    const selected = () => selector.querySelector(".ant-select-selection-item .cvat-label-selector-option")?.textContent.trim();
    const combos = [...selector.querySelectorAll("input[role='combobox']")];
    if (combos.length !== 1 || combos[0].disabled) {
      cancelPending("Label dropdown is unavailable. Start manually."); return false;
    }
    const combo = combos[0];
    if (operation.labelClicked) {
      return selected() === operation.labelName && combo.getAttribute("aria-expanded") === "false";
    }
    const listID = combo.getAttribute("aria-controls");
    if (!listID || /\s/.test(listID)) { cancelPending("Label dropdown ownership is unsupported. Start manually."); return false; }
    if (!operation.labelOpened) {
      operation.labelOpened = true;
      if (combo.getAttribute("aria-expanded") !== "true") {
        const trigger = selector.querySelector(".ant-select-selector");
        if (!visible(trigger)) { cancelPending("Label dropdown is unavailable. Start manually."); return false; }
        // Only this popup's label selector receives the UI gesture; never a canvas target.
        trigger.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0, buttons: 1}));
        trigger.dispatchEvent(new MouseEvent("mouseup", {bubbles: true, cancelable: true, button: 0, buttons: 0}));
        trigger.click();
      }
    }
    const lists = [...document.querySelectorAll("#" + CSS.escape(listID))].filter((element) =>
      element.getAttribute("role") === "listbox" && visible(element) && visible(element.closest(".ant-select-dropdown")));
    if (lists.length > 1) { cancelPending("Label dropdown is ambiguous. Start manually."); return false; }
    if (!lists.length) return false;
    const options = [...lists[0].querySelectorAll(".ant-select-item-option[role='option'][data-label]")];
    const matches = options.filter((element) => element.getAttribute("data-label") === operation.labelName);
    if (matches.length !== 1) {
      cancelPending(matches.length ? "Default label name is ambiguous. No tool was started; check the extension label setting." :
        "Default label was not found. No tool was started; check its exact name in the extension popup."); return false;
    }
    const option = matches[0];
    if (option.matches(".ant-select-item-option-disabled") || option.closest(DISABLED)) {
      cancelPending("Default label is disabled. No tool was started."); return false;
    }
    // CVAT disables virtualization here, so all options are present in the owned listbox.
    option.scrollIntoView({block: "nearest", inline: "nearest"});
    if (!visible(option)) { cancelPending("Default label is not visible. No tool was started."); return false; }
    operation.labelClicked = true;
    option.click();
    return selected() === operation.labelName && combo.getAttribute("aria-expanded") === "false";
  }

  function startWhenReady(operation) {
    if (pending !== operation) return;
    const {tool, side, target} = operation;
    // Re-check context before every delayed DOM action; changing settings or focus cancels it.
    const currentTargets = [...side.querySelectorAll(tool.selector)].filter(visible);
    const ownLabelFocus = operation.labelSelector?.contains(focusedElement());
    if (!enabled || generation !== operation.generation || composing || (focusedEditable() && !ownLabelFocus) ||
        sidebar() !== side || busy(side) || currentTargets.length !== 1 ||
        currentTargets[0] !== target || target.closest(DISABLED)) {
      cancelPending();
      return;
    }
    const panels = [...document.querySelectorAll(tool.panel)].filter(visible);
    if (panels.length > 1) {
      cancelPending(`${tool.label} menu is ambiguous. Start the tool manually.`);
      return;
    }
    const panel = panels[0];
    if (operation.panel && panel !== operation.panel) {
      cancelPending(`${tool.label} menu changed or closed. Start the tool manually.`);
      return;
    }
    if (panel) {
      operation.panel = panel;
      const buttons = [...panel.querySelectorAll(tool.start)].filter(visible);
      if (buttons.length > 1) {
        cancelPending(`${tool.startLabel} button is ambiguous. Start the tool manually.`);
        return;
      }
      if (buttons.length === 1) {
        const button = buttons[0];
        if (button.closest(DISABLED)) {
          cancelPending(`${tool.startLabel} is disabled. Check your current CVAT label/model and start it manually.`);
          return;
        }
        if (!ensureDefaultLabel(operation, panel, button)) {
          if (pending !== operation) return;
          if (performance.now() >= operation.deadline) {
            cancelPending("Default label selection could not be verified. No tool was started."); return;
          }
          operation.timer = setTimeout(() => startWhenReady(operation), READY_POLL_MS); return;
        }
        // Verify again immediately before starting; keep the model and other options intact.
        if (operation.labelSelector?.contains(focusedElement())) {
          focusedElement()?.blur?.();
          operation.previousFocus?.focus?.({preventScroll: true});
        }
        cooldownUntil = performance.now() + START_COOLDOWN_MS;
        cancelPending();
        try { button.click(); }
        catch { notify(`${tool.startLabel} could not be started. Use the CVAT button manually.`); }
        return;
      }
    }
    if (performance.now() >= operation.deadline) {
      cancelPending(panel ? `${tool.startLabel} is unavailable in this menu. ${tool.startLabel === "Interact" ? "Choose the AI Interactors tab and check its model/label." : "Check the Draw new mask menu."} Start it manually.` :
        `${tool.label} menu could not be confirmed. This CVAT version may be unsupported; open it manually.`);
      return;
    }
    operation.timer = setTimeout(() => startWhenReady(operation), READY_POLL_MS);
  }

  function onKey(event) {
    if (pending && typing(event)) cancelPending();
    // Own a claimed physical press through repeat/release so CVAT cannot receive its later events.
    // A fresh press also drops a stale Cmd claim if Chrome omitted its letter keyup.
    if (!event.repeat && !heldCodes.has(event.code)) claimedCodes.delete(event.code);
    if (claimedCodes.has(event.code)) {
      if (shared.supportedURL(location.href) && !composing && !typing(event) && shared.fromEvent(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (!enabled || event.defaultPrevented || event.cancelBubble || event.repeat || composing || typing(event) ||
        pending || performance.now() < cooldownUntil) return;
    const pressed = shared.fromEvent(event);
    if (!pressed) return;
    const action = shared.ACTIONS.find((name) => settings.shortcuts[name] &&
      shared.signature(settings.shortcuts[name]) === shared.signature(pressed));
    if (!action) return;
    const side = sidebar();
    if (!side || busy(side)) return;
    const tool = TOOLS[action];
    const candidates = [...side.querySelectorAll(tool.selector)].filter(visible);
    if (candidates.length !== 1) {
      notify(`${tool.label} is unavailable in this CVAT workspace. Open the tool manually if supported.`);
      return;
    }
    const target = candidates[0];
    if (target.closest(DISABLED)) {
      notify(`${tool.label} is disabled in this CVAT context.`);
      return;
    }
    // Ignore unsupported/disabled keys above without consuming the event.
    event.preventDefault();
    event.stopImmediatePropagation();
    heldCodes.add(event.code);
    claimedCodes.add(event.code);
    const operation = {tool, side, target, generation, deadline: performance.now() + READY_TIMEOUT_MS,
      panel: null, timer: null, labelName: settings.defaultLabelName, previousFocus: focusedElement()};
    pending = operation;
    try {
      if (![...document.querySelectorAll(tool.panel)].some(visible)) target.click();
      startWhenReady(operation);
    } catch { cancelPending(`${tool.label} could not be activated. Start it manually.`); }
  }

  async function enable() {
    cancelPending();
    wheelSession = null;
    generation += 1;
    if (!sidebar()) { enabled = false; return {supported: false, enabled: false}; }
    try {
      const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
      settings = shared.normalize(stored[shared.STORAGE_KEY]);
      enabled = true;
      return {supported: true, enabled: true};
    } catch {
      enabled = false;
      return {supported: true, enabled: false, error: "Local settings could not be read."};
    }
  }

  function onStorage(changes, area) {
    if (area === "local" && changes[shared.STORAGE_KEY]) {
      settings = shared.normalize(changes[shared.STORAGE_KEY].newValue);
      generation += 1;
      cancelPending();
      wheelSession = null;
    }
  }

  function onMessage(message, _sender, respond) {
    if (message?.type === "CVAT_SHORTCUTS_STATUS") {
      respond({supported: Boolean(sidebar()), enabled});
    } else if (message?.type === "CVAT_SHORTCUTS_DISABLE") {
      enabled = false;
      generation += 1;
      cancelPending();
      wheelSession = null;
      clearTimeout(feedbackTimer);
      feedback?.remove();
      respond({supported: Boolean(sidebar()), enabled});
    }
  }

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", (event) => {
    const claimed = claimedCodes.delete(event.code);
    heldCodes.delete(event.code);
    // A Cmd chord must recover even if the letter's keyup was not delivered.
    if (event.key === "Meta" || event.code === "MetaLeft" || event.code === "MetaRight") heldCodes.clear();
    // Modifier releases always propagate so CVAT can clear its Ctrl/Shift/Alt state.
    if (claimed && shared.supportedURL(location.href) && !composing && !typing(event) && shared.fromEvent(event)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("wheel", onWheel, {capture: true, passive: false});
  document.addEventListener("pointerdown", (event) => { mouseButtons = event.buttons || 1; }, true);
  document.addEventListener("mousedown", (event) => { mouseButtons = event.buttons || 1; }, true);
  const releaseButtons = (event) => { mouseButtons = event.buttons || 0; };
  document.addEventListener("pointerup", releaseButtons, true);
  document.addEventListener("mouseup", releaseButtons, true);
  document.addEventListener("pointercancel", () => { mouseButtons = 0; }, true);
  document.addEventListener("compositionstart", () => { composing = true; cancelPending(); }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  window.addEventListener("blur", () => {
    composing = false; heldCodes.clear(); claimedCodes.clear(); mouseButtons = 0; wheelSession = null; cancelPending();
  });
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis[INSTANCE] = {enable};
  return enable();
})();
