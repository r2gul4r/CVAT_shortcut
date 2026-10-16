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
      startLabel: "Interact", label: "AI 도구"},
    brush: {selector: ".cvat-draw-mask-control", panel: ".cvat-draw-mask-popover",
      content: ".cvat-draw-shape-popover-content",
      start: ".cvat-draw-shape-popover-content button.cvat-draw-mask-shape-button",
      startLabel: "Shape", label: "새 마스크 (브러쉬)"},
    polygon: {selector: ".cvat-draw-polygon-control", panel: ".cvat-draw-shape-popover",
      panelMarker: ".cvat-draw-polygon-shape-button",
      content: ".cvat-draw-shape-popover-content",
      start: ".cvat-draw-shape-popover-content button.cvat-draw-polygon-shape-button",
      startLabel: "Shape", label: "새 폴리곤", configurePolygon: true}
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
  let sendingEscape = false;
  let labelChoice = null, labelSaveQueue = Promise.resolve(), labelEpoch = 0;
  let overlay = null, pasteLoop = null;
  let contextExpired = false;
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
    // Use textContent for feedback; only user-selected class names are included, never annotation data.
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

  function dialogOpen() {
    return [...document.querySelectorAll("[role='dialog'], [aria-modal='true'], .ant-modal")].some(visible);
  }

  function busy(side) {
    if (dialogOpen()) return true;
    // The shared toolbox also identifies existing-mask EDIT, whose sidebar can show Cursor.
    if ([...document.querySelectorAll(TOOLBOX)].some(visible)) return true;
    // Never click an active tool icon: wait for Escape to return the canvas to rest.
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
    } catch { notify("브러쉬 크기를 변경하지 못했습니다. CVAT의 크기 조절 도구를 직접 사용하세요."); }
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
      cancelPending("확장 팝업에 올바른 기본 라벨 이름을 먼저 입력하세요."); return false;
    }
    const content = panel.querySelector(operation.tool.content);
    const scope = button.closest("[role='tabpanel']") || content;
    if (!scope || !panel.contains(scope)) { cancelPending("라벨 선택 영역을 사용할 수 없습니다. 직접 실행하세요."); return false; }
    const selectors = [...scope.querySelectorAll(".ant-select")].filter((element) => visible(element) &&
      element.querySelector(".ant-select-selection-item .cvat-label-selector-option"));
    if (selectors.length !== 1) {
      cancelPending("라벨 선택 도구가 없거나 여러 개입니다. 직접 실행하세요."); return false;
    }
    const selector = selectors[0];
    if ((operation.labelSelector && operation.labelSelector !== selector) ||
        selector.matches(".ant-select-disabled") || selector.closest(DISABLED)) {
      cancelPending("라벨 선택 도구가 변경되었거나 비활성화되어 있습니다. 직접 실행하세요."); return false;
    }
    operation.labelSelector = selector;
    const selected = () => selector.querySelector(".ant-select-selection-item .cvat-label-selector-option")?.textContent.trim();
    const combos = [...selector.querySelectorAll("input[role='combobox']")];
    if (combos.length !== 1 || combos[0].disabled) {
      cancelPending("라벨 목록을 사용할 수 없습니다. 직접 실행하세요."); return false;
    }
    const combo = combos[0];
    if (operation.labelClicked) {
      return selected() === operation.labelName && combo.getAttribute("aria-expanded") === "false";
    }
    const listID = combo.getAttribute("aria-controls");
    if (!listID || /\s/.test(listID)) { cancelPending("이 라벨 목록 구조는 지원하지 않습니다. 직접 실행하세요."); return false; }
    if (!operation.labelOpened) {
      operation.labelOpened = true;
      if (combo.getAttribute("aria-expanded") !== "true") {
        const trigger = selector.querySelector(".ant-select-selector");
        if (!visible(trigger)) { cancelPending("라벨 목록을 사용할 수 없습니다. 직접 실행하세요."); return false; }
        // Only this popup's label selector receives the UI gesture; never a canvas target.
        trigger.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0, buttons: 1}));
        trigger.dispatchEvent(new MouseEvent("mouseup", {bubbles: true, cancelable: true, button: 0, buttons: 0}));
        trigger.click();
      }
    }
    const lists = [...document.querySelectorAll("#" + CSS.escape(listID))].filter((element) =>
      element.getAttribute("role") === "listbox" && visible(element) && visible(element.closest(".ant-select-dropdown")));
    if (lists.length > 1) { cancelPending("라벨 목록이 여러 개여서 구분할 수 없습니다. 직접 실행하세요."); return false; }
    if (!lists.length) return false;
    const options = [...lists[0].querySelectorAll(".ant-select-item-option[role='option'][data-label]")];
    const matches = options.filter((element) => element.getAttribute("data-label") === operation.labelName);
    if (matches.length !== 1) {
      cancelPending(matches.length ? "동일한 기본 라벨이 여러 개라 시작하지 않았습니다. 확장의 라벨 설정을 확인하세요." :
        "기본 라벨을 찾지 못해 시작하지 않았습니다. 확장 팝업에서 정확한 이름을 확인하세요."); return false;
    }
    const option = matches[0];
    if (option.matches(".ant-select-item-option-disabled") || option.closest(DISABLED)) {
      cancelPending("기본 라벨이 비활성화되어 시작하지 않았습니다."); return false;
    }
    // CVAT disables virtualization here, so all options are present in the owned listbox.
    option.scrollIntoView({block: "nearest", inline: "nearest"});
    if (!visible(option)) { cancelPending("기본 라벨이 화면에 표시되지 않아 시작하지 않았습니다."); return false; }
    operation.labelClicked = true;
    option.click();
    return selected() === operation.labelName && combo.getAttribute("aria-expanded") === "false";
  }

  function toolPanels(tool) {
    // CVAT shares the shape popover class across mask, polygon, polyline and other tools.
    return [...document.querySelectorAll(tool.panel)].filter((panel) => visible(panel) &&
      (!tool.panelMarker || panel.querySelector(tool.panelMarker)));
  }

  function ensurePolygonOptions(operation, panel) {
    if (!operation.tool.configurePolygon) return true;
    const inputs = [...panel.querySelectorAll(".cvat-draw-shape-popover-points-selector input, input.cvat-draw-shape-popover-points-selector")].filter(visible);
    const switches = [...panel.querySelectorAll(".cvat-draw-polygon-popover-simplify-switch[role='switch']")].filter(visible);
    if (inputs.length !== 1 || !(inputs[0] instanceof HTMLInputElement) || switches.length !== 1) {
      cancelPending("폴리곤의 Number of points / Simplify 설정을 확인하지 못했습니다. 직접 실행하세요."); return false;
    }
    const input = inputs[0], toggle = switches[0];
    if (input.readOnly || input.closest(DISABLED) ||
        (operation.pointsInput && operation.pointsInput !== input) ||
        (operation.simplifySwitch && operation.simplifySwitch !== toggle)) {
      cancelPending("폴리곤 설정이 변경되었거나 비활성화되어 있습니다. 직접 실행하세요."); return false;
    }
    operation.pointsInput = input; operation.simplifySwitch = toggle;
    if (input.value !== "") {
      if (!operation.pointsCleared) {
        operation.pointsCleared = true;
        // Use the native setter so React/rc-input-number receives an actual input change.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new Event("change", {bubbles: true}));
      }
      return false; // Wait for the controlled input and dependent switch to render.
    }
    const checked = toggle.getAttribute("aria-checked");
    if (checked !== "true" && checked !== "false") {
      cancelPending("Simplify 상태를 확인하지 못해 폴리곤을 시작하지 않았습니다."); return false;
    }
    if (checked === "true") {
      // A predefined point count disables this switch until the cleared input commits.
      if (!toggle.closest(DISABLED) && !operation.simplifyClicked) {
        operation.simplifyClicked = true; toggle.click();
      }
      return false;
    }
    return !toggle.closest(DISABLED);
  }

  function startWhenReady(operation) {
    if (pending !== operation) return;
    const {tool, side, target} = operation;
    // Re-check context before every delayed DOM action; changing settings or focus cancels it.
    const currentTargets = [...side.querySelectorAll(tool.selector)].filter(visible);
    const ownLabelFocus = operation.labelSelector?.contains(focusedElement());
    if (!enabled || generation !== operation.generation || composing || (focusedEditable() && !ownLabelFocus) ||
        location.pathname !== operation.jobPath || sidebar() !== side || busy(side) || mouseButtons || currentTargets.length !== 1 ||
        currentTargets[0] !== target || target.closest(DISABLED)) {
      cancelPending();
      return;
    }
    const panels = toolPanels(tool);
    if (panels.length > 1) {
      cancelPending(`${tool.label} 메뉴가 여러 개여서 구분할 수 없습니다. 직접 실행하세요.`);
      return;
    }
    const panel = panels[0];
    if (operation.panel && panel !== operation.panel) {
      cancelPending(`${tool.label} 메뉴가 변경되었거나 닫혔습니다. 직접 실행하세요.`);
      return;
    }
    if (panel) {
      operation.panel = panel;
      const buttons = [...panel.querySelectorAll(tool.start)].filter(visible);
      if (buttons.length > 1) {
        cancelPending(`${tool.startLabel} 버튼이 여러 개여서 구분할 수 없습니다. 직접 실행하세요.`);
        return;
      }
      if (buttons.length === 1) {
        const button = buttons[0];
        if (button.closest(DISABLED)) {
          cancelPending(`${tool.startLabel} 버튼이 비활성화되어 있습니다. CVAT 라벨·모델을 확인하고 직접 실행하세요.`);
          return;
        }
        if (!ensureDefaultLabel(operation, panel, button)) {
          if (pending !== operation) return;
          if (performance.now() >= operation.deadline) {
            cancelPending("기본 라벨 선택을 확인하지 못해 시작하지 않았습니다."); return;
          }
          operation.timer = setTimeout(() => startWhenReady(operation), READY_POLL_MS); return;
        }
        try {
          if (!ensurePolygonOptions(operation, panel)) {
            if (pending !== operation) return;
            if (performance.now() >= operation.deadline) {
              cancelPending("Number of points 공란 / Simplify OFF를 확인하지 못해 폴리곤을 시작하지 않았습니다."); return;
            }
            operation.timer = setTimeout(() => startWhenReady(operation), READY_POLL_MS); return;
          }
        } catch { cancelPending("폴리곤 옵션을 변경하지 못했습니다. 직접 실행하세요."); return; }
        // Label/model remain scoped to this menu. Only polygon has forced drawing options.
        if (operation.labelSelector?.contains(focusedElement())) {
          focusedElement()?.blur?.();
          operation.previousFocus?.focus?.({preventScroll: true});
        }
        cooldownUntil = performance.now() + START_COOLDOWN_MS;
        cancelPending();
        try { button.click(); }
        catch { notify(`${tool.startLabel}을 시작하지 못했습니다. CVAT 버튼을 직접 사용하세요.`); }
        return;
      }
    }
    if (performance.now() >= operation.deadline) {
      cancelPending(panel ? `이 메뉴에서 ${tool.startLabel}을 사용할 수 없습니다. ${tool.startLabel === "Interact" ? "AI Interactors 탭에서 모델·라벨을 확인하세요." : tool.configurePolygon ? "Draw new polygon 메뉴를 확인하세요." : "Draw new mask 메뉴를 확인하세요."} 직접 실행하세요.` :
        `${tool.label} 메뉴를 확인하지 못했습니다. 지원하지 않는 CVAT 버전일 수 있으니 직접 여세요.`);
      return;
    }
    operation.timer = setTimeout(() => startWhenReady(operation), READY_POLL_MS);
  }

  function startAfterEscape(operation) {
    if (pending !== operation) return;
    const {side, tool, target} = operation;
    if (!enabled || generation !== operation.generation || composing || focusedEditable() ||
        location.pathname !== operation.jobPath || sidebar() !== side || dialogOpen() || mouseButtons) {
      cancelPending(); return;
    }
    const targets = [...side.querySelectorAll(tool.selector)].filter(visible);
    if (targets.length !== 1 || targets[0] !== target) { cancelPending("도구 메뉴가 변경되었습니다. 다시 시도하세요."); return; }
    if (busy(side) || target.closest(DISABLED)) {
      if (performance.now() >= operation.deadline) {
        cancelPending("현재 도구가 취소되지 않아 전환하지 않았습니다. Esc를 직접 누른 뒤 다시 시도하세요."); return;
      }
      operation.timer = setTimeout(() => startAfterEscape(operation), READY_POLL_MS); return;
    }
    // Give label/menu readiness its own bound after cancellation has completed.
    operation.deadline = performance.now() + READY_TIMEOUT_MS;
    try {
      if (!toolPanels(tool).length) target.click();
      startWhenReady(operation);
    } catch { cancelPending(`${tool.label}을 활성화하지 못했습니다. 직접 실행하세요.`); }
  }

  function chosenLabel() {
    return labelChoice?.path === location.pathname ? labelChoice.name : settings.defaultLabelName;
  }

  function prepareNativeRepeat(event, side) {
    // An active drawing/edit keeps the native finish path, even when the bridge is unavailable.
    if (!pending && busy(side)) return;
    let result = "busy", reason = "BRIDGE";
    if (!pending && !mouseButtons && !event.buttons && !panDrag && !panDrain && !overlay?.isDragging()) {
      const request = document.createElement("span"); request.hidden = true;
      request.setAttribute("data-cvat-repeat-request",JSON.stringify({version:1,path:location.pathname,label:chosenLabel()}));
      try {
        document.body.append(request);
        request.dispatchEvent(new Event("cvat-shortcuts-native-repeat-v1",{bubbles:true}));
        result = request.getAttribute("data-cvat-repeat-response") || "unsupported";
        const code = request.getAttribute("data-cvat-repeat-reason");
        // Only fixed codes cross the bridge; no job IDs, image names or label values enter diagnostics.
        if (["PAGE","SIDEBAR","STORE","JOB","DIMENSION","WORKSPACE","CANVAS","SHORTCUTS","LABELS","DRAWING","INTERACTOR","REDUCER","REQUEST","RUNTIME"].includes(code)) reason = code;
        else if (result === "unsupported" && request.hasAttribute("data-cvat-repeat-response")) reason = "UNKNOWN";
      } catch { result = "unsupported"; }
      finally { request.remove(); }
    }
    if (result === "ready" || result === "native") return;
    // Prevent keypress as well as keydown on failure; never start with the old label by accident.
    event.preventDefault(); event.stopImmediatePropagation(); heldCodes.add(event.code); claimedCodes.add(event.code);
    if (result === "busy") return;
    notify(result === "label" ? "N을 시작하지 않았습니다. 이 작업에서 사용할 라벨을 다시 선택하세요." :
      result === "type" ? "선택한 라벨은 이전 도구의 도형 형식과 맞지 않습니다. 다른 라벨이나 도구를 선택하세요." :
      `N 라벨 연동을 확인하지 못했습니다. 확인 코드: ${reason}. AI·새 마스크 단축키를 사용할 수 있습니다. 업데이트 직후라면 CVAT를 새로고침하고 확장을 다시 켜세요.`);
  }

  function selectLabelShortcut(name) {
    const available = shared.readLabelCatalog();
    if (available.state !== "ready" || !available.labels.some((label) => label.name === name && !label.duplicate)) {
      notify(`라벨 '${name}'을 이 작업에서 확인하지 못했습니다. Labels 또는 Overview를 열어 목록을 확인하세요.`); return;
    }
    // Only the extension's next-object preference changes. No CVAT object, tool or Escape is touched.
    const request = {name, path: location.pathname, epoch: labelEpoch};
    labelChoice = request;
    overlay?.refresh();
    notify(`다음 객체 라벨: ${name}`);
    labelSaveQueue = labelSaveQueue.then(async () => {
      try {
        if (labelChoice !== request || !enabled || request.epoch !== labelEpoch || location.pathname !== request.path) return;
        const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
        const catalog = shared.readLabelCatalog();
        if (labelChoice !== request || !enabled || request.epoch !== labelEpoch || location.pathname !== request.path) return;
        if (catalog.state !== "ready" || !catalog.labels.some((label) => label.name === name && !label.duplicate)) throw new Error("Label changed");
        const next = shared.normalize({...shared.normalize(stored[shared.STORAGE_KEY]), defaultLabelName: name});
        await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
        // onChanged can arrive after set resolves; keep the local preference in sync too.
        if (request.epoch === labelEpoch) settings = {...settings, defaultLabelName: name};
      } catch {
        if (labelChoice === request) notify("라벨 설정을 저장하지 못했습니다. 확장 팝업에서 선택한 라벨을 확인하세요.");
      } finally { if (labelChoice === request) labelChoice = null; overlay?.refresh(); }
    });
  }

  function onKey(event) {
    if (pasteLoop?.isSending()) return;
    if (pasteLoop?.status().running) {
      pasteLoop.interrupt(event);
      if (!["Control","Alt","Meta","Shift"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); claimedCodes.add(event.code); return;
      }
    }
    if (sendingEscape) return;
    if (overlay?.handleKey(event)) return;
    if (onPanKey(event)) return;
    if (event.code === "Escape") { cancelPending(); return; }
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
    if (!enabled || composing || typing(event)) return;
    const pressed = shared.fromEvent(event);
    if (!pressed) return;
    const action = shared.ACTIONS.find((name) => settings.shortcuts[name] &&
      shared.signature(settings.shortcuts[name]) === shared.signature(pressed));
    const labelBinding = settings.labelShortcuts.find((entry) => shared.signature(entry.shortcut) === shared.signature(pressed));
    const side = sidebar();
    if (!side || dialogOpen()) return;
    if (!action && !labelBinding) {
      if (pressed.code === "KeyN" && !pressed.ctrl && !pressed.alt && !pressed.shift && !pressed.meta && !event.repeat) prepareNativeRepeat(event,side);
      return;
    }
    // Claim before readiness checks: a reserved extension key must never fall through to CVAT.
    event.preventDefault(); event.stopImmediatePropagation();
    heldCodes.add(event.code); claimedCodes.add(event.code);
    if (event.repeat || mouseButtons || event.buttons || panDrain || overlay?.isDragging()) return;
    if (labelBinding) { selectLabelShortcut(labelBinding.name); return; }
    if (pending || performance.now() < cooldownUntil) return;
    if (action === 'paste') { pasteLoop?.start(); return; }
    const tool = TOOLS[action];
    const candidates = [...side.querySelectorAll(tool.selector)].filter(visible);
    if (candidates.length !== 1) {
      notify(`이 작업 공간에서 ${tool.label}을 사용할 수 없습니다. 지원되는 도구라면 직접 여세요.`);
      return;
    }
    const target = candidates[0];
    if (target.closest(DISABLED) && !busy(side)) {
      notify(`현재 작업 상태에서 ${tool.label}이 비활성화되어 있습니다.`);
      return;
    }
    const operation = {tool, side, target, generation, deadline: performance.now() + READY_TIMEOUT_MS,
      panel: null, timer: null, labelName: chosenLabel(), previousFocus: focusedElement(), jobPath: location.pathname};
    pending = operation;
    wheelSession = null;
    try {
      // Unmodified Esc reaches CVAT's normal keyboard cancellation handler, even for Ctrl/Alt shortcuts.
      // No finish/save button, React internals, or canvas API is invoked by the extension.
      sendingEscape = true;
      for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, {
        key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true
      }));
    } catch { cancelPending("Esc를 전달하지 못했습니다. 직접 취소한 뒤 다시 시도하세요."); }
    finally { sendingEscape = false; }
    startAfterEscape(operation);
  }

  async function enable() {
    if (contextExpired) return {supported: Boolean(sidebar()), enabled: false, error: "CVAT 작업을 저장하고 페이지를 새로고침한 뒤 다시 활성화하세요."};
    pasteLoop?.stop('확장 상태가 변경됐습니다.');
    labelEpoch += 1; labelChoice = null;
    cancelPan();
    cancelPending();
    wheelSession = null;
    generation += 1;
    if (!sidebar()) { enabled = false; overlay?.disable(); return {supported: false, enabled: false}; }
    try {
      const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
      settings = shared.normalize(stored[shared.STORAGE_KEY]);
      enabled = true;
      overlay?.enable();
      return status();
    } catch {
      enabled = false;
      overlay?.disable();
      return {supported: true, enabled: false, error: "Local settings could not be read."};
    }
  }

  function onStorage(changes, area) {
    if (area === "local" && changes[shared.STORAGE_KEY]) {
      const next = shared.normalize(changes[shared.STORAGE_KEY].newValue);
      // A label-only save cannot cancel a tool start that already captured its chosen label.
      if (JSON.stringify({...settings, defaultLabelName: ""}) === JSON.stringify({...next, defaultLabelName: ""})) {
        settings = next; overlay?.refresh(); return;
      }
      labelEpoch += 1; labelChoice = null;
      cancelPan();
      settings = next;
      generation += 1;
      cancelPending();
      wheelSession = null;
      overlay?.refresh();
    }
  }

  function status() {
    const supported = Boolean(sidebar());
    return {supported, enabled, jobPath: location.pathname,
      overlay: overlay?.status?.() || {state: "missing"}, paste: pasteLoop?.status(),
      catalog: supported && enabled ? shared.readLabelCatalog() : {state: "inactive", labels: []}};
  }

  function onMessage(message, _sender, respond) {
    if (message?.type === 'CVAT_SHORTCUTS_PASTE_START' || message?.type === 'CVAT_SHORTCUTS_PASTE_STOP') {
      if (message.type.endsWith('_START')) pasteLoop?.start(); else pasteLoop?.stop();
      respond(status());
    } else if (message?.type === "CVAT_SHORTCUTS_STATUS" || message?.type === "CVAT_SHORTCUTS_LABELS") {
      respond(status());
    } else if (message?.type === "CVAT_SHORTCUTS_OVERLAY_SHOW") {
      if (enabled && sidebar()) overlay?.show({recover: message.recover === true,screen:message.screen});
      respond(status());
    } else if (message?.type === "CVAT_SHORTCUTS_DISABLE") {
      pasteLoop?.stop('확장을 일시정지했습니다.');
      labelEpoch += 1; labelChoice = null;
      cancelPan();
      enabled = false;
      overlay?.disable();
      generation += 1;
      cancelPending();
      wheelSession = null;
      clearTimeout(feedbackTimer);
      feedback?.remove();
      respond(status());
    }
  }

  // Translate an owned Space + left drag into CVAT's native middle-mouse drag.
  // Dispatch on the canvas ROOT: Fabric's brush surface must never see a fake stroke.
  let panHold = null, panDrag = null, panDrain = false, panKeyClaimed = false;
  let sendingPan = false, panTimer = null, panClickUntil = 0;
  const consumePan = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  function panCanvas() {
    const nodes = [...document.querySelectorAll(".cvat-canvas-container #cvat_canvas_wrapper")].filter(visible);
    return nodes.length === 1 ? nodes[0] : null;
  }
  function panValid() {
    return panHold && enabled && settings.spacePan && !composing && !focusedEditable() && !dialogOpen() &&
      generation === panHold.generation && location.pathname === panHold.path && sidebar() && panCanvas() === panHold.canvas;
  }
  function sendPan(type, drag, buttons) {
    sendingPan = true;
    try {
      (drag.canvas.isConnected ? drag.canvas : document).dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, composed: true, button: 1, buttons,
        clientX: drag.x, clientY: drag.y, view: window
      }));
    } finally { sendingPan = false; }
  }
  function endPan(drain) {
    if (panDrag) {
      const drag = panDrag;
      panDrag = null;
      sendPan("mouseup", drag, 0);
      panClickUntil = performance.now() + 500;
      panDrain = drain;
      mouseButtons = drain ? 1 : 0;
    }
  }
  function cancelPan() {
    endPan(true);
    panHold = null;
    clearInterval(panTimer); panTimer = null;
  }
  function onPanKey(event) {
    if (event.code !== "Space") {
      if (panHold) cancelPan();
      return false;
    }
    if (panKeyClaimed) { consumePan(event); return true; }
    if (!enabled || !settings.spacePan ||
        composing || typing(event) || !shared.fromEvent(event) || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey ||
        !sidebar() || dialogOpen()) return false;
    // Keep an existing user-assigned Space tool shortcut working unchanged.
    if (shared.ACTIONS.some((name) => shared.signature(settings.shortcuts[name]) === shared.signature({code: "Space"})) ||
        settings.labelShortcuts.some((entry) => shared.signature(entry.shortcut) === shared.signature({code: "Space"}))) return false;
    const canvas = panCanvas();
    if (!canvas) return false;
    panKeyClaimed = true;
    consumePan(event);
    // Reserve Space during an existing stroke without hijacking the stroke or starting a pan.
    if (event.repeat || mouseButtons || panDrain || pending || overlay?.isDragging()) return true;
    panHold = {canvas, path: location.pathname, generation};
    panTimer = setInterval(() => { if (!panValid()) cancelPan(); }, 100);
    return true;
  }
  function onPanMouse(event) {
    if (sendingPan || event.type.startsWith("pointer") && event.pointerType !== "mouse") return;
    if (overlay?.ownsEvent(event) && !panDrag && !panDrain) return;
    const down = /down$/.test(event.type), up = /up$/.test(event.type), move = /move$/.test(event.type);
    if (panHold && !panValid()) cancelPan();
    if (panDrain) {
      // Space released first: swallow the rest of that physical press, never resume a half stroke.
      if (down || move || up || event.type === "pointercancel") {
        consumePan(event);
        if (up && event.button === 0 || move && !(event.buttons & 1) || event.type === "pointercancel") {
          panDrain = false; mouseButtons = 0; panClickUntil = performance.now() + 500;
        }
        return;
      }
    }
    if (panDrag) {
      consumePan(event);
      if (event.pointerId !== undefined && event.pointerId !== panDrag.pointerId) return;
      panDrag.x = event.clientX; panDrag.y = event.clientY;
      if (event.type === "pointercancel" || up && event.button === 0 || move && !(event.buttons & 1)) {
        endPan(false); return;
      }
      if (move && (panDrag.pointerId === undefined ? event.type === "mousemove" : event.type === "pointermove")) {
        sendPan("mousemove", panDrag, 4);
      }
      return;
    }
    if (!down) return;
    // A new press is unrelated to the click belonging to the previous completed pan.
    panClickUntil = 0;
    if (!panHold || event.button !== 0 || event.buttons !== 1 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!(target instanceof Element) || !panHold.canvas.contains(target) || !hit || !panHold.canvas.contains(hit) ||
        editable(target) || target.closest('button, a, [role="button"], .cvat-brush-tools-toolbox, #cvat_canvas_attachment_board')) return;
    consumePan(event);
    mouseButtons = 1;
    panDrag = {canvas: panHold.canvas, pointerId: event.pointerId, x: event.clientX, y: event.clientY};
    sendPan("mousedown", panDrag, 4);
  }
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup"]) {
    window.addEventListener(type, onPanMouse, {capture: true, passive: false});
  }
  for (const type of ["click", "dblclick", "auxclick"]) window.addEventListener(type, (event) => {
    if (panDrag || panDrain || performance.now() < panClickUntil) consumePan(event);
  }, true);
  window.addEventListener("wheel", (event) => { if (panDrag || panDrain) consumePan(event); }, {capture: true, passive: false});
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelPan(); });
  document.addEventListener("focusin", () => { if (focusedEditable()) cancelPan(); }, true);
  window.addEventListener("pagehide", cancelPan);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keypress", (event) => {
    if (pasteLoop?.isSending()) return;
    if (overlay?.handleKey(event)) return;
    if ((claimedCodes.has(event.code) || panKeyClaimed && event.code === "Space") &&
        shared.supportedURL(location.href) && !composing && !typing(event)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (pasteLoop?.isSending()) return;
    if (event.code === "Space" && panKeyClaimed) {
      panKeyClaimed = false; cancelPan(); consumePan(event); return;
    }
    const claimed = claimedCodes.delete(event.code);
    heldCodes.delete(event.code);
    if (!claimed && overlay?.handleKey(event)) return;
    // A Cmd chord must recover even if the letter's keyup was not delivered.
    if (event.key === "Meta" || event.code === "MetaLeft" || event.code === "MetaRight") heldCodes.clear();
    // 보조키 releases always propagate so CVAT can clear its Ctrl/Shift/Alt state.
    if (claimed && shared.supportedURL(location.href) && !composing && !typing(event) && shared.fromEvent(event)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("wheel", onWheel, {capture: true, passive: false});
  const pressButtons = (event) => {
    // CVAT opens some popovers by dispatching mousedown with buttons=0 and no mouseup.
    // It is a UI notification, not a held stroke. Do not invent a left-button press.
    // Ignore it without clearing any real press already tracked.
    if (event.buttons) mouseButtons = event.buttons;
  };
  document.addEventListener("pointerdown", pressButtons, true);
  document.addEventListener("mousedown", pressButtons, true);
  const releaseButtons = (event) => { mouseButtons = event.buttons || 0; };
  document.addEventListener("pointerup", releaseButtons, true);
  document.addEventListener("mouseup", releaseButtons, true);
  document.addEventListener("pointercancel", () => { mouseButtons = 0; }, true);
  document.addEventListener("compositionstart", () => { composing = true; cancelPan(); cancelPending(); }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  window.addEventListener("blur", () => {
    cancelPan(); panKeyClaimed = false;
    composing = false; heldCodes.clear(); claimedCodes.clear(); mouseButtons = 0; wheelSession = null; cancelPending();
  });
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener(onMessage);
  function onInvalidated() {
    if (contextExpired) return;
    contextExpired = true; enabled = false;
    labelEpoch += 1; labelChoice = null; generation += 1;
    pasteLoop?.stop('확장 연결이 갱신되어 중지했습니다.');
    cancelPan(); cancelPending(); wheelSession = null;
    heldCodes.clear(); claimedCodes.clear();
    try { chrome.storage.onChanged.removeListener?.(onStorage); } catch {}
    try { chrome.runtime.onMessage.removeListener?.(onMessage); } catch {}
    notify('확장 연결이 종료됐습니다. CVAT 작업을 저장하고 페이지를 새로고침한 뒤 확장을 다시 켜주세요.');
  }
  overlay = globalThis.CVATLabelOverlay?.create({shared,
    onInvalidated,
    getState: () => ({supported: Boolean(sidebar()), path: location.pathname, selected: chosenLabel(),
      shortcuts: settings.labelShortcuts, catalog: shared.readLabelCatalog()}),
    onSelect: (name) => {
      if (!enabled || !sidebar() || mouseButtons || dialogOpen() || panDrag || panDrain || pending) {
        notify("마우스 버튼을 놓고 도구 전환이 끝난 뒤 라벨을 선택하세요."); return;
      }
      selectLabelShortcut(name);
    }
  });
  pasteLoop = globalThis.CVATPasteRepeat?.create({
    available: () => enabled && Boolean(sidebar()) && !dialogOpen() && !focusedEditable() && !pending && !panDrag && !panDrain,
    notify, isMac: () => shared.isMac()
  });
  globalThis[INSTANCE] = {enable};
  return enable();
})();
