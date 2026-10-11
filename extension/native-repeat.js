/* MAIN-world adapter, injected only on explicit activation. The native trusted N event is never replayed. */
(() => {
  "use strict";
  const INSTANCE = "__cvatShortcutsNativeRepeatV1";
  if (globalThis[INSTANCE]) return;
  const EVENT = "cvat-shortcuts-native-repeat-v1";
  const REQUEST = "data-cvat-repeat-request", RESPONSE = "data-cvat-repeat-response", REASON = "data-cvat-repeat-reason";
  const SHAPES = new Set(["rectangle","polygon","polyline","points","ellipse","cuboid","skeleton","mask"]);

  function findStore(side) {
    // Walk only the active sidebar's React ancestry to its Redux Provider. No image/object tree is traversed.
    for (let element = side; element instanceof Element; element = element.parentElement) {
      const key = Object.getOwnPropertyNames(element).find((name) => /^__react(Fiber|InternalInstance)\$/.test(name));
      if (!key) continue;
      const seen = new Set();
      for (let fiber = element[key]; fiber && seen.size < 200 && !seen.has(fiber); fiber = fiber.return) {
        seen.add(fiber);
        const props = fiber.memoizedProps;
        for (const store of [props?.store, props?.value?.store]) {
          if (typeof store?.getState !== "function" || typeof store?.dispatch !== "function") continue;
          const state = store.getState();
          if (state?.annotation?.drawing && state.annotation.canvas && state.annotation.job) return {store,state};
        }
      }
    }
    return null;
  }

  function prepare(request, unsupported) {
    const match = /^\/tasks\/\d+\/jobs\/(\d+)\/?$/.exec(location.pathname);
    if (window.top !== window || !match || !/^https?:$/.test(location.protocol) || request.path !== location.pathname) return unsupported("PAGE");
    const sides = document.querySelectorAll(".cvat-canvas-controls-sidebar");
    if (sides.length !== 1) return unsupported("SIDEBAR");
    const found = findStore(sides[0]);
    if (!found) return unsupported("STORE");
    const {store,state} = found, annotation = state.annotation;
    const {canvas,job,drawing} = annotation;
    if (String(job.instance?.id) !== match[1]) return unsupported("JOB");
    if (job.instance?.dimension !== "2d") return unsupported("DIMENSION");
    // CVAT Workspace.STANDARD = 'Standard', not a lower-case identifier.
    if (annotation.workspace !== "Standard") return unsupported("WORKSPACE");
    if (typeof canvas.instance?.mode !== "function") return unsupported("CANVAS");
    // N during DRAW/INTERACT/EDIT retains CVAT's completion/cancellation behavior and the current label.
    if (canvas.instance.mode() !== "idle" || !["cursor","drag_canvas","zoom_canvas"].includes(canvas.activeControl)) return "native";
    const keyMap = state.shortcuts?.keyMap;
    const binding = keyMap?.SWITCH_DRAW_MODE_STANDARD_CONTROLS || keyMap?.SWITCH_DRAW_MODE;
    if (!Array.isArray(binding?.sequences)) return unsupported("SHORTCUTS");
    if (binding.nonActive || !binding.sequences.some((value) => typeof value === "string" && value.toLowerCase() === "n")) return "native";
    if (canvas.ready !== true || job.fetching || job.saving || annotation.player?.frame?.fetching || annotation.player?.frame?.data?.deleted) return "busy";
    if (!Array.isArray(job.labels)) return unsupported("LABELS");
    const matches = job.labels.filter((label) => label.name === request.label);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) return "label";
    const label = matches[0];
    if (drawing.activeLabelID === label.id) return "ready";
    if (!["shape","track","tag"].includes(drawing.activeObjectType)) return unsupported("DRAWING");
    const shape = drawing.activeInteractor ? drawing.activeInteractor.returnType : drawing.activeShapeType;
    if (!drawing.activeInteractor && drawing.activeObjectType !== "tag" && !SHAPES.has(shape)) return unsupported("DRAWING");
    if (drawing.activeInteractor && (!drawing.activeInteractorParameters || typeof drawing.activeInteractorParameters !== "object")) return unsupported("INTERACTOR");
    if (drawing.activeObjectType === "tag" ? !["any","tag"].includes(label.type) :
      label.type !== "any" && (!SHAPES.has(shape) || label.type !== shape)) return "type";
    if (shape === "skeleton" && typeof label.structure?.svg !== "string") return "type";

    // CVAT's REMEMBER_OBJECT reducer resets drawing defaults. Preserve the complete remembered options,
    // including interactor/model references, and explicitly keep the canvas control unchanged.
    store.dispatch({type:"REMEMBER_OBJECT",payload:{...drawing,activeLabelID:label.id,updateCurrentControl:false}});
    const updated = store.getState().annotation;
    const preserved = updated?.drawing?.activeLabelID === label.id &&
      Object.keys(drawing).every((key) => ["activeLabelID","updateCurrentControl"].includes(key) || updated.drawing[key] === drawing[key]) &&
      updated.canvas?.instance === canvas.instance && updated.canvas.activeControl === canvas.activeControl;
    if (!preserved) {
      // An unknown reducer must not let N start with silently reset parameters.
      store.dispatch({type:"REMEMBER_OBJECT",payload:{...drawing,updateCurrentControl:false}});
      return unsupported("REDUCER");
    }
    return "ready";
  }

  document.addEventListener(EVENT,(event) => {
    const node = event.target;
    if (!(node instanceof HTMLSpanElement) || !node.isConnected || !node.hidden || node.parentElement !== document.body) return;
    const encoded = node.getAttribute(REQUEST);
    if (!encoded || encoded.length > 512) return;
    let result = "unsupported", reason = "REQUEST";
    try {
      const request = JSON.parse(encoded);
      if (request?.version === 1 && typeof request.path === "string" && typeof request.label === "string" &&
          request.label.length > 0 && request.label.length <= 128 && !/[\u0000-\u001f\u007f]/.test(request.label)) {
        result = prepare(request,(code) => { reason = code; return "unsupported"; });
      }
    } catch { reason = "RUNTIME"; /* A missing/changed private API never starts a tool or sends annotation data. */ }
    node.setAttribute(RESPONSE,result);
    if (result === "unsupported") node.setAttribute(REASON,reason);
    else node.removeAttribute(REASON);
  },true);
  globalThis[INSTANCE] = Object.freeze({version:1});
})();
