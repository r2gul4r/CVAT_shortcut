/* Shared movable shell for labels, required-label review and connection status. */
(() => {
  "use strict";
  const KEY = "cvatLabelOverlayV1";
  const ENABLED_KEY = "cvatLabelOverlayEnabled";
  const HOST_STYLE = "all:initial;position:fixed!important;z-index:2147483646!important;display:none!important;visibility:visible!important;pointer-events:auto!important;transform:none!important;margin:0!important;padding:0!important;border:0!important;width:max-content!important;height:max-content!important;right:auto!important;bottom:auto!important;";
  const normalize = (value) => ({
    x: Number.isFinite(value?.x) ? value.x : null,
    y: Number.isFinite(value?.y) ? value.y : null,
    width: Number.isFinite(value?.width) ? Math.max(220, Math.min(2400, value.width)) : 248,
    height: Number.isFinite(value?.height) ? Math.max(320, Math.min(2400, value.height)) : 480,
    view: ["collapsed", "launcher"].includes(value?.view) ? "launcher" : "panel",
    screen: ["review", "health"].includes(value?.screen) ? value.screen : "labels",
    transparency: Number.isFinite(value?.transparency) ? Math.max(0, Math.min(70, Math.round(value.transparency / 5) * 5)) : 0
  });
  function create({shared, getState, onSelect, onInvalidated}) {
    const host = document.createElement("div");
    host.id = "cvat-shortcuts-label-overlay";
    host.style.cssText = HOST_STYLE;
    const root = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme:light; } * {box-sizing:border-box;} [hidden]{display:none!important;}
      .panel {position:relative;display:flex;flex-direction:column;width:248px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:hidden;font:13px/1.45 system-ui,sans-serif;color:#263449;background:#fff;border:1px solid #c9d5e4;border-radius:13px;box-shadow:0 8px 30px #172c4533;}
      header {flex-shrink:0;display:flex;align-items:center;gap:4px;background:#203c61;color:#fff;padding:7px;border-radius:12px 12px 0 0;}
      button {font:inherit;cursor:pointer;border:0;border-radius:6px;}
      button:focus-visible {outline:3px solid #70aaff;outline-offset:-2px;}
      .drag {flex:1;min-width:0;text-align:left;cursor:grab;touch-action:none;user-select:none;font-weight:650;color:inherit;background:transparent;padding:5px;}
      .icon {background:#ffffff18;color:inherit;padding:4px 7px;}
      .selected {flex-shrink:0;padding:10px 12px;border-bottom:1px solid #e5ebf3;overflow-wrap:anywhere;}
      .caption {display:block;color:#61748c;font-size:11px;margin-bottom:3px;}
      .selected strong {color:#204e8c;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .body {flex:1;min-height:0;display:flex;flex-direction:column;}
      .list {flex:1;min-height:0;overflow:auto;padding:7px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(160px,100%),1fr));grid-auto-rows:minmax(38px,max-content);align-content:start;gap:6px;overscroll-behavior:contain;scrollbar-gutter:stable;}
      .choice {min-width:0;display:flex;align-items:center;gap:8px;text-align:left;padding:8px;background:#fff;color:#263449;border:1px solid #d8e1eb;}
      .choice[aria-pressed=true] {border-color:#3979cf;background:#edf4ff;box-shadow:inset 0 0 0 1px #3979cf;}
      .choice:disabled {opacity:.5;cursor:default;} .swatch {width:14px;height:14px;border:1px solid #6b7a8c;border-radius:4px;flex-shrink:0;}
      .name {flex:1;min-width:0;overflow-wrap:anywhere;} kbd {max-width:82px;font:11px system-ui;color:#526982;background:#f1f4f8;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere;}
      footer {flex-shrink:0;padding:8px 11px 20px;border-top:1px solid #e5ebf3;color:#61748c;font-size:11px;}
      .resize {position:absolute;right:2px;bottom:2px;width:19px;height:19px;padding:0;background:transparent;color:#61748c;cursor:nwse-resize;touch-action:none;user-select:none;font-size:17px;line-height:19px;}
      .resize-edge {position:absolute;z-index:2;padding:0;background:transparent;border-radius:0;touch-action:none;user-select:none;}
      .resize-edge[data-edge=n], .resize-edge[data-edge=s] {left:16px;right:16px;height:6px;cursor:ns-resize;}
      .resize-edge[data-edge=n] {top:0;} .resize-edge[data-edge=s] {bottom:0;}
      .resize-edge[data-edge=e], .resize-edge[data-edge=w] {top:16px;bottom:16px;width:6px;cursor:ew-resize;}
      .resize-edge[data-edge=e] {right:0;} .resize-edge[data-edge=w] {left:0;}
      .resize-edge[data-edge=nw], .resize-edge[data-edge=ne], .resize-edge[data-edge=sw] {width:16px;height:16px;}
      .resize-edge[data-edge=nw] {top:0;left:0;cursor:nwse-resize;}
      .resize-edge[data-edge=ne] {top:0;right:0;cursor:nesw-resize;}
      .resize-edge[data-edge=sw] {bottom:0;left:0;cursor:nesw-resize;}
      .resize {z-index:3;right:0;bottom:0;} .resize, .resize-edge {overflow:hidden;}
      .refresh {margin-top:6px;padding:4px 7px;background:#edf3fa;color:#284f80;}
      .transparency {display:block;margin-top:10px;padding-top:9px;border-top:1px solid #e5ebf3;}
      .transparency-title {display:flex;justify-content:space-between;color:#425a76;}
      input[type=range] {display:block;width:100%;margin:8px 0 4px;accent-color:#3979cf;cursor:pointer;}
      .range-ends {display:flex;justify-content:space-between;font-size:10px;}
      .launcher {font:13px system-ui;color:#fff;background:#203c61;border:1px solid #6982a2;border-radius:20px;padding:9px 13px;box-shadow:0 4px 15px #172c4530;max-width:calc(100vw - 16px);cursor:grab;touch-action:none;user-select:none;}
      .workspace-tabs {display:flex;gap:3px;flex-shrink:0;padding:6px;background:#eef3f9;border-bottom:1px solid #dce5ef;}
      .workspace-tabs button {flex:1;min-width:0;padding:7px 2px;background:transparent;color:#536578;font-size:12px;white-space:nowrap;}
      .workspace-tabs [aria-selected=true] {background:#fff;color:#204e8c;font-weight:650;box-shadow:0 1px 4px #20304418;}
      .workspace-content {flex:1;min-height:0;overflow:auto;padding:9px;overscroll-behavior:contain;scrollbar-gutter:stable;color:#203044;}
      ${globalThis.CVATWorkspaceViews?.css || ''}
      .workspace-content .section-heading,.workspace-content .review-label-actions,.workspace-content .health-actions,.workspace-content .buttons {flex-wrap:wrap;}
      .workspace-content .tool {padding:9px;}
      .workspace-content .review-labels {grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),1fr));}
      .workspace-content .review-label {min-width:0;}
      .workspace-content .review-pagination {flex-wrap:wrap;}
      .workspace-content #health-screen {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));align-items:start;gap:8px;}
      .workspace-content .workspace-health-main {grid-column:1/-1;}
      .workspace-content select {max-width:100%;}
    `;
    const el = (tag, cls, text) => {const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node;};
    const control = (text, action, cls, label) => {
      const node = el("button", cls, text); node.type = "button"; node.dataset.action = action;
      if (label) node.setAttribute("aria-label", label); return node;
    };
    const panel = el("section", "panel"); panel.setAttribute("aria-label", "CVAT 작업 오버레이");
    const header = el("header"), dragHandle = control("⠿ 라벨 선택", "drag", "drag", "라벨창 이동: 드래그 또는 방향키");
    const fold = control("−", "fold", "icon", "라벨창 최소화");
    const hide = control("×", "hide", "icon", "라벨 선택창 끄기"); header.append(dragHandle, fold, hide);
    const screenNames={labels:'라벨 선택',review:'검수',health:'연결 상태'};
    const tabs=el('nav','workspace-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','작업 화면');
    const tabButtons=Object.entries(screenNames).map(([name,text])=>{const button=control(text,'screen-'+name);button.setAttribute('role','tab');button.id='workspace-tab-'+name;button.setAttribute('aria-controls',name==='labels'?'workspace-labels':name+'-screen');tabs.append(button);return button;});
    const selected = el("div", "selected"), selectedName = el("strong");
    selected.append(el("span", "caption", "다음 객체의 기본 라벨"), selectedName);
    const body = el("div", "body"), list = el("div", "list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "사용할 수 있는 라벨");
    list.id='workspace-labels';
    const workspaceContent=el('div','workspace-content');workspaceContent.hidden=true;
    const workspace=globalThis.CVATWorkspacePanels?.create(workspaceContent);
    const footer = el("footer"), hint = el("div", null, "현재 그리는 객체는 그대로 유지됩니다.");
    const refresh = control("목록 새로고침", "refresh", "refresh"); footer.append(hint, refresh); body.append(list, workspaceContent, footer);
    const transparency = el("label", "transparency"), transparencyTitle = el("span", "transparency-title"), transparencyValue = el("span");
    const slider = el("input"); slider.type = "range"; slider.min = "0"; slider.max = "70"; slider.step = "5"; slider.setAttribute("aria-label", "오버레이 투명도");
    transparencyTitle.append(el("span", null, "오버레이 투명도"), transparencyValue);
    const ends = el("span", "range-ends"); ends.append(el("span", null, "선명하게"), el("span", null, "투명하게"));
    transparency.append(transparencyTitle, slider, ends); footer.append(transparency);
    const resizeHandle = control("◢", "resize", "resize", "라벨창 크기 조절: 드래그 또는 방향키");
    resizeHandle.dataset.edge = "se";
    resizeHandle.title = "드래그해서 크기 조절";
    panel.append(header, tabs, selected, body, resizeHandle);
    const resizeHandles = [resizeHandle];
    for (const [edge, name] of Object.entries({n:"위",s:"아래",e:"오른쪽",w:"왼쪽",nw:"왼쪽 위",ne:"오른쪽 위",sw:"왼쪽 아래"})) {
      const handle = control("", "resize", "resize-edge", name + " 가장자리 크기 조절");
      handle.dataset.edge = edge; handle.tabIndex = -1; handle.title = name + " 가장자리를 드래그해서 크기 조절";
      resizeHandles.push(handle); panel.append(handle);
    }
    const launcher = control("라벨 선택", "show", "launcher", "라벨 선택창 펼치기");
    launcher.title = "클릭하여 펼치기 · 드래그 또는 방향키로 이동";
    root.append(style, panel, launcher);
    let prefs = normalize(null), enabled = false, timer = null, drag = null, signature = "", saved = Promise.resolve();
    let ready = false, suppressClick = false, dead = false, externalPress = false, adjusting = false, overlayEnabled = true;
    const listeners = [];
    const heldControls = new Set();
    function destroy() {
      if (dead) return;
      dead = true; enabled = false; clearInterval(timer);
      workspace?.destroy(); resetInteraction(false); host.remove();
      for (const remove of listeners) remove();
      // Chrome also rejects listener cleanup after extension reload/unload.
      try { chrome.storage.onChanged.removeListener?.(storage); } catch {}
    }
    function live() {
      if (dead) return false;
      try { if (chrome.runtime?.id) return true; } catch {}
      destroy(); onInvalidated?.(); return false;
    }
    const on = (target, type, listener, options) => { target.addEventListener(type, listener, options); listeners.push(() => target.removeEventListener(type, listener, options)); };
    const ownsEvent = (event) => event.composedPath().includes(host);
    function applyTransparency() {
      host.style.setProperty("opacity", String(1 - prefs.transparency / 100), "important");
      slider.value = String(prefs.transparency);
      transparencyValue.textContent = prefs.transparency + "%";
      slider.setAttribute("aria-valuetext", prefs.transparency + "% 투명");
    }
    on(slider, "input", () => { prefs.transparency = Number(slider.value); applyTransparency(); });
    on(slider, "change", save);
    function viewport() {
      const view = window.visualViewport;
      const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
      const width = view?.width || innerWidth, height = view?.height || innerHeight;
      return {left, top, width, height, right: left + width, bottom: top + height};
    }
    const visibleElement = () => prefs.view === "panel" ? panel : launcher;
    function place() {
      if (!host.isConnected || host.style.display === "none") return {x: prefs.x, y: prefs.y};
      if (!Number.isFinite(parseFloat(host.style.left))) host.style.setProperty("left", "0px", "important");
      if (!Number.isFinite(parseFloat(host.style.top))) host.style.setProperty("top", "0px", "important");
      // Preferences and pointer positions use viewport coordinates. CSS left/top may
      // use a scaled containing block (page CSS zoom or a fullscreen ancestor).
      const view = viewport(), element = visibleElement();
      const initial = element.getBoundingClientRect(), css = getComputedStyle(element);
      // Computed CSS serializes fractional widths with fewer digits than DOMRect.
      const sx = Math.round(initial.width / parseFloat(css.width) * 10000) / 10000 || 1;
      const sy = Math.round(initial.height / parseFloat(css.height) * 10000) / 10000 || 1;
      const width = Math.max(1, view.width - 16), height = Math.max(1, view.height - 16);
      element.style.maxWidth = width / sx + "px";
      element.style.maxHeight = height / sy + "px";
      if (element === panel) {
        panel.style.width = Math.min(prefs.width, width) / sx + "px";
        panel.style.height = Math.min(prefs.height, height) / sy + "px";
      }
      const rect = element.getBoundingClientRect();
      const x = Math.max(view.left + 8, Math.min(prefs.x ?? view.right - 270, view.right - rect.width - 8));
      const y = Math.max(view.top + 8, Math.min(prefs.y ?? view.top + 90, view.bottom - rect.height - 8));
      const left = parseFloat(host.style.left) || 0, top = parseFloat(host.style.top) || 0;
      host.style.setProperty("left", left + (x - rect.left) / sx + "px", "important");
      host.style.setProperty("top", top + (y - rect.top) / sy + "px", "important");
      return {x, y};
    }
    function save() {
      const snapshot = {...prefs};
      saved = saved.catch(() => {}).then(() => live() ? chrome.storage.local.set({[KEY]: snapshot}) : undefined).catch(() => {
        if (live()) hint.textContent = "라벨창 설정을 저장하지 못했습니다. 다시 조절해 주세요.";
      });
    }
    function resizeFrom(origin, edge, dx, dy) {
      const view = viewport();
      const right = origin.left + origin.width, bottom = origin.top + origin.height;
      const clamp = (value, min, max) => Math.min(Math.max(value, Math.min(min, max)), max);
      prefs.x = origin.left; prefs.y = origin.top;
      prefs.width = origin.width; prefs.height = origin.height;
      if (edge.includes("w")) {
        prefs.width = clamp(origin.width - dx, 220, right - view.left - 8); prefs.x = right - prefs.width;
      } else if (edge.includes("e")) prefs.width = clamp(origin.width + dx, 220, view.right - origin.left - 8);
      if (edge.includes("n")) {
        prefs.height = clamp(origin.height - dy, 320, bottom - view.top - 8); prefs.y = bottom - prefs.height;
      } else if (edge.includes("s")) prefs.height = clamp(origin.height + dy, 320, view.bottom - origin.top - 8);
      Object.assign(prefs, place());
    }
    function render(force = false) {
      if (!live() || !ready) return;
      const state = getState();
      const show = enabled && overlayEnabled && state.supported;
      host.style.setProperty("display", show ? "block" : "none", "important");
      if (!show) { workspace?.setView(null);resetInteraction(false); return; }
      // Elements outside an element-fullscreen subtree are not painted, regardless of z-index.
      const container = document.fullscreenElement || document.documentElement;
      if (host.parentElement !== container) { container.append(host); force = true; }
      applyTransparency();
      const catalog = state.catalog;
      workspace?.setView(prefs.view==='panel'&&!document.hidden?prefs.screen:null);
      const nextSignature = JSON.stringify([state.path, state.selected, state.shortcuts, catalog, prefs.view,prefs.screen]);
      if (!force && nextSignature === signature) { if (!drag) place(); return; }
      signature = nextSignature;
      panel.hidden = prefs.view === "launcher"; launcher.hidden = !panel.hidden;
      body.hidden = prefs.view !== "panel";
      selected.hidden=prefs.screen!=='labels';list.hidden=prefs.screen!=='labels';workspaceContent.hidden=prefs.screen==='labels';
      hint.hidden=refresh.hidden=prefs.screen!=='labels';
      dragHandle.textContent='⠿ '+screenNames[prefs.screen];launcher.textContent=screenNames[prefs.screen];
      dragHandle.setAttribute('aria-label','작업창 이동: 드래그 또는 방향키');fold.setAttribute('aria-label','작업창 최소화');hide.setAttribute('aria-label','작업창 끄기');launcher.setAttribute('aria-label',screenNames[prefs.screen]+' 작업창 펼치기');
      for(const button of tabButtons){const active=button.dataset.action==='screen-'+prefs.screen;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
      for (const handle of resizeHandles) handle.hidden = body.hidden;
      selectedName.textContent = state.selected || "라벨을 선택하세요";
      selectedName.title = state.selected || "라벨을 선택하세요";
      const available = catalog.state === "ready" ? catalog.labels : [];
      list.replaceChildren();
      for (const label of available) {
        const button = control("", "select", "choice"); button.value = label.name;
        button.disabled = label.duplicate; button.setAttribute("aria-pressed", String(!label.duplicate && label.name === state.selected));
        const swatch = el("span", "swatch"); swatch.setAttribute("aria-hidden", "true");
        swatch.style.background = shared.normalizeLabelColor(label.color) || "transparent";
        const name = el("span", "name", label.name + (label.duplicate ? " (이름 중복)" : "")); button.append(swatch, name);
        const binding = state.shortcuts.find((entry) => entry.name === label.name);
        if (binding) button.append(el("kbd", null, shared.format(binding.shortcut)));
        list.append(button);
      }
      hint.textContent = catalog.state !== "ready" ? "CVAT의 Labels 또는 Overview를 열고 새로고침하세요." :
        !available.length ? "이 작업에 등록된 라벨이 없습니다." :
        !available.some((label) => !label.duplicate && label.name === state.selected) ? "이 작업에서 사용할 라벨을 선택하세요." : "현재 그리는 객체는 그대로 유지됩니다.";
      place();
    }
    function status() {
      let state;
      if (dead || !enabled) state = "paused";
      else if (!ready) state = "loading";
      else if (!overlayEnabled) state = "off";
      else if (!getState().supported) state = "unsupported";
      else if (!host.isConnected) state = "detached";
      else {
        const rect = visibleElement().getBoundingClientRect(), view = viewport();
        const style = getComputedStyle(host);
        if (host.hidden || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) state = "hidden";
        else if (!rect.width || !rect.height || rect.left < view.left - 1 || rect.top < view.top - 1 || rect.right > view.right + 1 || rect.bottom > view.bottom + 1) state = "outside";
        else {
          const x = Math.max(0, Math.min(innerWidth - 1, rect.left + Math.min(40, rect.width / 2)));
          const y = Math.max(0, Math.min(innerHeight - 1, rect.top + Math.min(25, rect.height / 2)));
          state = document.elementFromPoint(x, y) === host ? "visible" : "covered";
        }
      }
      return {state, view: prefs.view,screen:prefs.screen};
    }
    function action(button) {
      if (!live() || button.disabled || !enabled || !overlayEnabled || !getState().supported) return;
      if (button.dataset.action === "select") { onSelect(button.value); render(true); return; }
      if (button.dataset.action === "refresh") { render(true); return; }
      if(button.dataset.action.startsWith('screen-')){prefs.screen=button.dataset.action.slice(7);render(true);save();return;}
      if (button.dataset.action === "fold") prefs.view = "launcher";
      else if (button.dataset.action === "hide") {
        overlayEnabled = false; render(true);
        Promise.resolve().then(() => live() ? chrome.storage.local.set({[ENABLED_KEY]: false}) : undefined).catch(() => {
          if (!live()) return;
          overlayEnabled = true; render(true); hint.textContent = "닫기 설정을 저장하지 못했습니다. 다시 시도하세요.";
        });
        return;
      }
      else if (button.dataset.action === "show") prefs.view = "panel";
      else return;
      render(true); save();
    }
    function finishDrag(persist) {
      if (!drag) return;
      const previous = drag; drag = null;
      try { previous.capture.releasePointerCapture(previous.id); } catch { /* Pointer may already have been cancelled. */ }
      if (persist) save();
    }
    function finishAdjustment(persist) {
      const wasAdjusting = adjusting;
      adjusting = false;
      if (root.activeElement === slider) slider.blur();
      if (persist && wasAdjusting) save();
    }
    function resetInteraction(persist) {
      finishDrag(persist); finishAdjustment(persist);
      externalPress = false; suppressClick = false; heldControls.clear();
      root.activeElement?.blur();
    }
    function pointer(event) {
      if (!enabled || !overlayEnabled || !live()) return;
      if (adjusting && /move$/.test(event.type) && !(event.buttons & 1)) finishAdjustment(true);
      const own = ownsEvent(event);
      if (["pointerdown", "mousedown"].includes(event.type) && !own && !drag && event.buttons) externalPress = true;
      // A stroke begun on CVAT must still receive its release when it ends over the palette.
      if (externalPress && ["pointerup", "mouseup", "pointercancel"].includes(event.type)) {
        if (event.type !== "pointerup") externalPress = false;
        return;
      }
      if (!own && !drag && !adjusting) return;
      if (drag && event.pointerId !== undefined && event.pointerId !== drag.id) return;
      event.stopImmediatePropagation();
      const rangeEvent = event.composedPath().includes(slider);
      if (rangeEvent || adjusting) {
        if (event.type === "pointerdown" && event.button === 0) { adjusting = true; slider.focus({preventScroll: true}); }
        if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type)) finishAdjustment(true);
        if (event.type === "click") { event.preventDefault(); slider.blur(); }
        // Keep native range dragging; capture prevents CVAT from receiving the pointer.
        return;
      }
      if(!drag && event.composedPath().includes(workspaceContent)){
        const target=event.composedPath().find(node=>node instanceof Element && workspaceContent.contains(node));
        const nativeInput=target?.closest('select,textarea,input:not([type=checkbox]):not([type=range])');
        if(nativeInput){if(event.type==='pointerdown')nativeInput.focus({preventScroll:true});return;}
        // A checkbox is already toggled by the browser before its click listener.
        // Let its native change fire; cancelling or clicking again would undo it.
        if(event.type==='click'&&target?.matches('input[type=checkbox]')){target.focus({preventScroll:true});return;}
        if(event.type!=='wheel')event.preventDefault();
        if(event.type==='click'&&event.button===0){
          const control=target?.closest('button,input,summary,label');
          const input=control?.tagName==='LABEL'?control.querySelector('input'):control;
          if(input&&!input.disabled){input.focus({preventScroll:true});if(input.tagName==='SUMMARY')input.parentElement.open=!input.parentElement.open;else input.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:false,cancelable:true}));}
        }
        return;
      }
      if (event.type !== "wheel") event.preventDefault();
      const button = event.composedPath().find((node) => node instanceof HTMLButtonElement && root.contains(node));
      if (event.type === "pointerdown" && event.button === 0) {
        suppressClick = false;
        if (["drag", "resize", "show"].includes(button?.dataset.action)) {
          const rect = host.getBoundingClientRect(); drag = {id: event.pointerId, kind: button === launcher ? "drag" : button.dataset.action, capture: button === launcher ? launcher : host, edge: button.dataset.edge, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height};
          try { drag.capture.setPointerCapture(event.pointerId); } catch { /* Synthetic tests do not own an active pointer. */ }
        }
      } else if (event.type === "pointermove" && drag) {
        if (!(event.buttons & 1)) { finishDrag(true); return; }
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 3) suppressClick = true;
        if (drag.kind === "resize") {
          resizeFrom(drag, drag.edge, dx, dy);
        } else { prefs.x = drag.left + dx; prefs.y = drag.top + dy; }
        Object.assign(prefs, place());
      } else if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type)) finishDrag(true);
      else if (event.type === "click" && !suppressClick && button && event.button === 0) {
        button.focus({preventScroll: true}); action(button);
      }
    }
    function handleKey(event) {
      if (!live()) return false;
      // CVAT must receive modifier releases even if focus moved into the overlay.
      if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code)) return false;
      if (heldControls.has(event.code)) {
        if (event.type === "keyup") heldControls.delete(event.code);
        event.preventDefault(); event.stopImmediatePropagation(); return true;
      }
      if (!ownsEvent(event)) return false;
      if(event.composedPath().includes(workspaceContent)){
        event.stopImmediatePropagation();
        const target=event.composedPath().find(node=>node instanceof Element && workspaceContent.contains(node));
        if(target?.matches('button,input[type=checkbox],summary')&&['Space','Enter'].includes(event.code)){
          event.preventDefault();
          if(event.type==='keydown'&&!event.repeat&&!target.disabled){if(target.tagName==='SUMMARY')target.parentElement.open=!target.parentElement.open;else target.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:false,cancelable:true}));}
        }
        return true;
      }
      if (event.composedPath().includes(slider)) {
        event.stopImmediatePropagation();
        if (event.type === "keyup") save();
        return true;
      }
      const button = event.composedPath().find((node) => node instanceof HTMLButtonElement && root.contains(node));
      if(button?.dataset.action.startsWith('screen-')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.code)){
        event.preventDefault();event.stopImmediatePropagation();if(event.type==='keydown'){const index=tabButtons.indexOf(button),next=event.code==='Home'?0:event.code==='End'?2:(index+(event.code==='ArrowRight'?1:2))%3;action(tabButtons[next]);tabButtons[next].focus({preventScroll:true});}return true;
      }
      if (!button || !["Space", "Enter", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) return false;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === "keydown" && !event.repeat) {
        heldControls.add(event.code);
        if (["Enter", "Space"].includes(event.code)) { action(button); heldControls.add(event.code); }
        else if (event.code === "Escape") { prefs.view = "launcher"; render(true); save(); }
        else if (button.dataset.action === "resize") {
          const rect = panel.getBoundingClientRect();
          const delta = {ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20]}[event.code];
          resizeFrom(rect, button.dataset.edge, delta[0], delta[1]); save();
        }
        else if (button === dragHandle || button === launcher) {
          const delta = {ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10]}[event.code];
          const position = place(); prefs.x = position.x + delta[0]; prefs.y = position.y + delta[1]; Object.assign(prefs, place()); save();
        }
      }
      return true;
    }
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "mousedown", "mouseup", "mousemove", "click", "dblclick", "auxclick", "contextmenu", "wheel"]) on(window, type, pointer, {capture: true, passive: false});
    on(window, "resize", () => { if (!drag) place(); });
    if (window.visualViewport) {
      on(window.visualViewport, "resize", () => { if (!drag) place(); });
      on(window.visualViewport, "scroll", () => { if (!drag) place(); });
    }
    on(window, "blur", () => resetInteraction(true));
    on(document, "visibilitychange", () => { if (document.hidden) resetInteraction(true);render(); });
    on(document, "fullscreenchange", () => { resetInteraction(true); render(true); });
    const storage = (changes, area) => {
      if (area !== "local") return;
      if (changes[ENABLED_KEY]) { overlayEnabled = changes[ENABLED_KEY].newValue !== false; if (!overlayEnabled) resetInteraction(true); }
      // Geometry is shared, but changing another tab's screen must not start a review here.
      if (changes[KEY] && !drag && !adjusting) prefs = {...normalize(changes[KEY].newValue),screen:prefs.screen};
      if (changes[ENABLED_KEY] || changes[KEY]) render(true);
    };
    if (live()) chrome.storage.onChanged.addListener(storage);
    Promise.resolve().then(() => live() ? Promise.all([chrome.storage.local.get(KEY), chrome.storage.local.get(ENABLED_KEY)]) : [{}, {}]).then(([value, toggle]) => {
      prefs = normalize(value[KEY]); overlayEnabled = toggle[ENABLED_KEY] !== false;
    }).catch(() => {}).finally(() => { ready = true; render(true); });
    return {
      ownsEvent, handleKey, status, isDragging: () => Boolean(drag),
      refresh: () => render(),
      enable() { if (!live()) return; enabled = true; clearInterval(timer); timer = setInterval(render, 500); render(true); },
      disable() { enabled = false; clearInterval(timer); workspace?.setView(null);resetInteraction(true); host.remove(); },
      show({recover = false,screen} = {}) {
        if (!live()) return;
        if (recover) {
          resetInteraction(true);
          prefs = normalize(null);
          host.hidden = false; host.style.cssText = HOST_STYLE;
        }
        if(Object.hasOwn(screenNames,screen))prefs.screen=screen;
        prefs.view = "panel"; render(true); save();
      },
      destroy
    };
  }
  globalThis.CVATLabelOverlay = Object.freeze({create});
})();
