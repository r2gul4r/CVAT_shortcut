(async () => {
  "use strict";
  const results = [];
  const S = CVATShortcuts;
  const $ = (selector) => document.querySelector(selector);
  const counts = {ai: 0, brush: 0, interact: 0, shape: 0, wrong: 0, save: 0, inference: 0, optionChanges: 0};
  const totals = {...counts};
  const ai = $(".cvat-tools-control");
  const brush = $(".cvat-draw-mask-control");
  const aiPanel = $(".cvat-tools-control-popover");
  const brushPanel = $(".cvat-draw-mask-popover");
  const aiContent = $(".cvat-tools-control-popover-content");
  const maskContent = $(".cvat-draw-shape-popover-content");
  const aiPane = $("#ai-pane");
  const interact = $("button.cvat-tools-interact-button");
  const shape = $("button.cvat-draw-mask-shape-button");
  const side = $(".cvat-canvas-controls-sidebar");
  let showPopover = true;
  let openDelay = 0;
  let autoActivate = true;
  let cancelWorks = true, cancelDelay = 0, escapeDowns = 0, escapeUps = 0;
  const timers = [];
  const schedule = (fn, ms) => {const id = setTimeout(fn, ms); timers.push(id); return id;};
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Escape") return;
    escapeDowns++;
    if (!cancelWorks || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.keyCode !== 27) return;
    const cancel = () => {
      const active = side.querySelectorAll(".cvat-active-canvas-control:not(.cvat-cursor-control)");
      const toolbox = $(".cvat-brush-tools-toolbox");
      if (active.length || !toolbox.hidden) close();
      active.forEach((node) => node.classList.remove("cvat-active-canvas-control"));
      toolbox.hidden = true;
    };
    cancelDelay ? schedule(cancel, cancelDelay) : cancel();
  });
  document.addEventListener("keyup", (event) => {if (event.code === "Escape") escapeUps++;});
  const count = (name) => {counts[name] += 1; totals[name] += 1;};
  const close = () => {aiPanel.hidden = true; brushPanel.hidden = true;};
  const showAI = () => {if (showPopover) {aiPanel.hidden = !aiPanel.hidden; brushPanel.hidden = true;}};
  ai.addEventListener("click", () => {count("ai"); openDelay ? schedule(showAI, openDelay) : showAI();});
  brush.addEventListener("click", () => {count("brush"); const show = () => {if (showPopover) {aiPanel.hidden = true; brushPanel.hidden = !brushPanel.hidden;}}; openDelay ? schedule(show, openDelay) : show();});
  interact.onclick = () => {count("interact"); close(); if (autoActivate) ai.classList.add("cvat-active-canvas-control");};
  shape.onclick = () => {count("shape"); close(); if (autoActivate) brush.classList.add("cvat-active-canvas-control");};
  $("#wrong-shape").onclick = $("#wrong-interact").onclick = () => count("wrong");
  $("#wrong-save").onclick = () => count("save");
  $(".cvat-tools-detect-button").onclick = () => count("inference");
  for (const element of document.querySelectorAll("#ai-model, #ai-label, #ai-box, #mask-label")) element.addEventListener("change", () => count("optionChanges"));
  const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
  const down = (code = "KeyA", options = {}, target = document.body) => {
    const event = new KeyboardEvent("keydown", {key: code.replace(/^Key/, ""), code, bubbles: true, cancelable: true, composed: true, ...options});
    target.dispatchEvent(event); return event;
  };
  const up = (code = "KeyA", target = document.body) => target.dispatchEvent(new KeyboardEvent("keyup", {code, bubbles: true, composed: true}));
  const press = (code = "KeyA", options = {}, target = document.body) => {const event = down(code, options, target); up(code, target); return event;};
  const chord = (code, extra = {}) => S.sanitizeShortcut({code, ...extra});
  const standard = () => ({shortcuts: {ai: chord("KeyA"), brush: chord("KeyB", {ctrl: true, shift: true})}});
  async function settings(value) {await chrome.storage.local.set({[S.STORAGE_KEY]: value}); await delay();}
  const focusBody = () => document.body.focus();
  function assert(value, message) {if (!value) throw new Error(message || "Assertion failed");}
  function noStarts() {assert(counts.interact === 0 && counts.shape === 0 && counts.wrong === 0 && counts.inference === 0 && counts.save === 0, JSON.stringify(counts));}
  function extra(parent, className, hidden = false) {const button = document.createElement("button"); button.className = className + " test-extra"; button.textContent = "Dummy misleading button"; button.hidden = hidden; button.onclick = () => count("wrong"); parent.append(button); return button;}
  function idle() {ai.classList.remove("cvat-active-canvas-control"); brush.classList.remove("cvat-active-canvas-control"); close(); focusBody();}
  async function reset() {
    fixtureAPI.failRead(false); fixtureAPI.failWrite(false);
    await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"});
    window.dispatchEvent(new Event("blur"));
    for (const timer of timers.splice(0)) clearTimeout(timer);
    document.querySelectorAll(".test-extra").forEach((node) => node.remove());
    labelFixture.reset();
    side.className = "cvat-canvas-controls-sidebar"; side.hidden = false;
    if (!side.isConnected) document.body.append(side);
    for (const [element, className] of [[ai, "cvat-tools-control"], [brush, "cvat-draw-mask-control"]]) {
      side.append(element); element.className = className; element.hidden = false; element.style.cssText = "";
      for (const attribute of ["disabled", "aria-disabled", "inert"]) element.removeAttribute(attribute);
    }
    document.body.append(aiPanel, brushPanel);
    aiPanel.className = "ant-popover cvat-tools-control-popover";
    brushPanel.className = "ant-popover cvat-draw-mask-popover cvat-draw-shape-popover";
    for (const panel of [aiPanel, brushPanel]) {panel.hidden = true; panel.style.cssText = ""; panel.removeAttribute("aria-disabled");}
    aiPane.append(interact); maskContent.append(shape);
    for (const [button, className] of [[interact, "cvat-tools-interact-button"], [shape, "cvat-draw-mask-shape-button"]]) {
      button.className = className; button.hidden = false; button.disabled = false; button.style.cssText = "";
      for (const attribute of ["aria-disabled", "inert"]) button.removeAttribute(attribute);
    }
    aiPane.hidden = false; $("#detectors-pane").hidden = true; $("#dialog").hidden = true;
    showPopover = true; openDelay = 0; autoActivate = true; cancelWorks = true; cancelDelay = 0;
    escapeDowns = 0; escapeUps = 0; $(".cvat-brush-tools-toolbox").hidden = true; focusBody();
    history.replaceState({}, "", "/tasks/1/jobs/1");
    await settings(standard());
    await window.__cvatSidebarShortcutsControllerV1.enable();
    await delay(260);
    for (const name of Object.keys(counts)) counts[name] = 0;
  }
  async function test(name, fn) {
    try {await reset(); await fn(); results.push({name, passed: true});}
    catch (error) {results.push({name, passed: false, error: error.message});}
  }
  const load = async () => {
    const script = document.createElement("script"); script.src = "/extension/content.js";
    await new Promise((resolve, reject) => {script.onload = resolve; script.onerror = reject; document.head.append(script);});
    await window.__cvatSidebarShortcutsControllerV1.enable();
  };
  try {
    fixtureAPI.clear(); await load();
    await test("No fixed/default shortcuts and saved settings key remains V1", async () => {
      await settings(S.normalize(null)); assert(S.STORAGE_KEY === "cvatSidebarShortcutsV1");
      assert(S.normalize(null).shortcuts.ai === null && S.normalize(null).shortcuts.brush === null);
      assert(!press().defaultPrevented && counts.ai === 0); noStarts();
    });
    await test("Duplicate assignment rejected without replacing existing settings", () => {
      const initial = S.assign(null, "ai", chord("KeyA")); let failed = false;
      try {S.assign(initial, "brush", chord("KeyA"));} catch (error) {failed = error.message.includes("이미");}
      assert(failed && initial.shortcuts.ai.code === "KeyA" && initial.shortcuts.brush === null);
    });
    await test("Option-generated characters use physical codes and do not guess missing codes", async () => {
      await settings({shortcuts: {ai: chord("KeyA", {alt: true})}});
      assert(press("KeyA", {key: "å", altKey: true}).defaultPrevented && counts.interact === 1);
      assert(S.fromEvent({code: "", key: "a", altKey: true}) === null);
      assert(S.fromEvent({code: "Unidentified", key: "a"}) === null);
    });
    await test("Cmd stays distinct from Ctrl and recovers if letter keyup is missing", async () => {
      await settings({shortcuts: {ai: chord("KeyA", {meta: true})}});
      assert(!press("KeyA", {ctrlKey: true}).defaultPrevented);
      assert(down("KeyA", {metaKey: true}).defaultPrevented && counts.interact === 1);
      assert(down("KeyA", {metaKey: true, repeat: true}).defaultPrevented);
      document.body.dispatchEvent(new KeyboardEvent("keyup", {key: "Meta", code: "MetaLeft", bubbles: true}));
      idle(); await delay(260);
      assert(press("KeyA", {metaKey: true}).defaultPrevented && counts.interact === 2);
    });
    await test("AI opens its sidebar popup and clicks Interact exactly once", () => {
      assert(press().defaultPrevented && counts.ai === 1 && counts.interact === 1 && counts.shape === 0);
      assert(counts.wrong === 0 && counts.inference === 0 && counts.save === 0);
    });
    await test("Brush opens new-mask popup and clicks its Shape exactly once", () => {
      assert(press("KeyB", {ctrlKey: true, shiftKey: true}).defaultPrevented && counts.brush === 1 && counts.shape === 1);
      assert(counts.interact === 0 && counts.wrong === 0 && counts.save === 0);
    });
    await test("Already open AI popup starts without toggling its sidebar icon", () => {
      aiPanel.hidden = false; assert(press().defaultPrevented && counts.ai === 0 && counts.interact === 1);
    });
    await test("Already open mask popup starts without toggling its sidebar icon", () => {
      brushPanel.hidden = false; assert(press("KeyB", {ctrlKey: true, shiftKey: true}).defaultPrevented && counts.brush === 0 && counts.shape === 1);
    });
    await test("Already correct default labels, model, and bounding-box options are preserved", async () => {
      const controls = [$("#ai-model"), $("#ai-label"), $("#ai-box"), $("#mask-label")];
      const before = controls.map((element) => [element.value, element.checked]);
      press(); idle(); await delay(260); press("KeyB", {ctrlKey: true, shiftKey: true});
      assert(JSON.stringify(controls.map((element) => [element.value, element.checked])) === JSON.stringify(before));
      assert(counts.optionChanges === 0 && counts.interact === 1 && counts.shape === 1);
    });
    await test("AI switches person to exact obstacle before one Interact start", () => {
      $("#ai-label").value = "person"; press();
      assert($("#ai-label").value === "obstacle" && counts.interact === 1 && counts.optionChanges === 1);
      assert($("#mask-label").value === "obstacle" && $("#ai-model").selectedIndex === 1 && $("#ai-box").checked);
    });
    await test("Brush switches person to exact obstacle before one Shape start", () => {
      $("#mask-label").value = "person"; press("KeyB", {ctrlKey: true, shiftKey: true});
      assert($("#mask-label").value === "obstacle" && counts.shape === 1 && counts.optionChanges === 1);
    });
    await test("Configured object label is selected for both shortcuts", async () => {
      await settings({...standard(), defaultLabelName: "object"});
      press(); assert($("#ai-label").value === "object" && counts.interact === 1);
      idle(); await delay(260); press("KeyB", {ctrlKey: true, shiftKey: true});
      assert($("#mask-label").value === "object" && counts.shape === 1);
    });
    await test("Missing default label stops rather than falling back to person", () => {
      const fixture = labelFixture.byID("ai-label"); fixture.options(["person", "obstacles", "Object"]); fixture.root.value = "person";
      press(); noStarts(); assert(fixture.root.value === "person" && fixture.config.clicks === 0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("찾지 못해"));
    });
    await test("Duplicate exact label names stop without choosing either", () => {
      const fixture = labelFixture.byID("mask-label"); fixture.options(["person", "obstacle", "obstacle"]); fixture.root.value = "person";
      press("KeyB", {ctrlKey: true, shiftKey: true}); noStarts();
      assert(fixture.root.value === "person" && fixture.config.clicks === 0 && $("#cvat-sidebar-shortcuts-feedback").textContent.includes("여러 개"));
    });
    await test("Disabled matching label stops without changing label or starting", () => {
      const fixture = labelFixture.byID("ai-label"); fixture.root.value = "person";
      [...fixture.list.children].find((option) => option.getAttribute("data-label") === "obstacle").classList.add("ant-select-item-option-disabled");
      press(); noStarts(); assert(fixture.root.value === "person" && fixture.config.clicks === 0);
    });
    await test("Unrelated dropdown's obstacle cannot satisfy this popup's missing label", () => {
      const own = labelFixture.byID("ai-label"); own.options(["person"]); own.root.value = "person";
      labelFixture.byID("mask-label").dropdown.hidden = false;
      press(); noStarts(); assert(own.root.value === "person" && own.config.clicks === 0);
    });
    await test("Delayed dropdown and selection are verified before Interact", async () => {
      const fixture = labelFixture.byID("ai-label"); fixture.root.value = "person";
      fixture.config.openDelay = 100; fixture.config.selectionDelay = 150;
      press(); assert(counts.interact === 0); await delay(350);
      assert(fixture.root.value === "obstacle" && counts.interact === 1 && fixture.config.clicks === 1);
    });
    await test("A click that fails to select the label never starts and is not repeated", async () => {
      const fixture = labelFixture.byID("ai-label"); fixture.root.value = "person"; fixture.config.ignoreSelection = true;
      press(); await delay(1300); noStarts(); assert(fixture.config.clicks === 1 && fixture.root.value === "person");
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("선택을 확인하지 못해"));
    });
    await test("User typing in label dropdown cancels pending activation", async () => {
      const fixture = labelFixture.byID("ai-label"); fixture.config.openDelay = 200;
      press(); down("KeyZ", {}, fixture.combo); up("KeyZ", fixture.combo); await delay(300); noStarts();
      assert(fixture.config.clicks === 0);
    });
    await test("Invalid saved default-label setting fails closed", async () => {
      await settings({...standard(), defaultLabelName: ""}); press(); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("올바른 기본 라벨"));
    });
    await test("Repeated keydowns and competing shortcut during readiness run once", async () => {
      openDelay = 180; assert(down().defaultPrevented);
      assert(down().defaultPrevented && down("KeyA", {repeat: true}).defaultPrevented);
      assert(press("KeyB", {ctrlKey: true, shiftKey: true}).defaultPrevented); up(); await delay(300);
      assert(counts.ai === 1 && counts.interact === 1 && counts.brush === 0 && counts.shape === 0);
    });
    await test("Brief cooldown prevents duplicate execution before React marks tool active", () => {
      autoActivate = false; assert(press().defaultPrevented); assert(press().defaultPrevented);
      assert(counts.ai === 1 && counts.interact === 1);
    });
    await test("Held-key auto-repeat is ignored before opening any menu", () => {
      assert(press("KeyA", {repeat: true}).defaultPrevented && counts.ai === 0); noStarts();
    });
    await test("Exact modifiers and unrelated keys pass through; pre-cancelled registered key still runs", () => {
      assert(!press("KeyA", {ctrlKey: true}).defaultPrevented && !press("KeyZ").defaultPrevented);
      assert(!press("KeyB", {ctrlKey: true}).defaultPrevented);
      const event = new KeyboardEvent("keydown", {key: "a", code: "KeyA", bubbles: true, cancelable: true});
      event.preventDefault(); document.body.dispatchEvent(event); assert(counts.ai === 1 && counts.interact === 1);
    });
    await test("Reassigned key stops old binding and starts with new binding", async () => {
      await settings(S.assign(fixtureAPI.read()[S.STORAGE_KEY], "ai", chord("KeyC")));
      assert(!press("KeyA").defaultPrevented && press("KeyC").defaultPrevented && counts.interact === 1);
    });
    await test("Cleared binding stops interception immediately", async () => {
      await settings(S.assign(fixtureAPI.read()[S.STORAGE_KEY], "ai", null));
      assert(!press().defaultPrevented && counts.ai === 0); noStarts();
    });
    await test("Typing fields and editable descendants are ignored", () => {
      for (const id of ["input", "textarea", "select", "editable-child", "role-textbox", "role-combobox"]) {
        focusBody(); assert(!press("KeyA", {}, document.getElementById(id)).defaultPrevented, id);
      } noStarts();
    });
    await test("Focused input and open shadow-root typing field are ignored", () => {
      $("#input").focus(); assert(!press().defaultPrevented);
      const host = $("#shadow-host"); const root = host.shadowRoot || host.attachShadow({mode: "open"});
      root.innerHTML = '<input aria-label="Dummy shadow input">'; root.querySelector("input").focus();
      assert(!press().defaultPrevented && !press("KeyA", {}, root.querySelector("input")).defaultPrevented); focusBody(); noStarts();
    });
    await test("IME/composition, keyCode 229, dead keys, and AltGraph are ignored", () => {
      assert(!press("KeyA", {isComposing: true}).defaultPrevented && !press("KeyA", {keyCode: 229}).defaultPrevented);
      assert(!press("KeyA", {key: "Dead"}).defaultPrevented && !press("KeyA", {modifierAltGraph: true}).defaultPrevented);
      document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true})); assert(!press().defaultPrevented);
      document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true})); noStarts();
    });
    await test("Dialogs remain untouched and active brush switches to AI after Escape", () => {
      $("#dialog").hidden = false; assert(!press().defaultPrevented); $("#dialog").hidden = true;
      assert(escapeDowns === 0);
      brush.classList.add("cvat-active-canvas-control"); assert(press().defaultPrevented);
      assert(escapeDowns === 1 && escapeUps === 1 && counts.interact === 1 && counts.shape === 0);
      assert(!brush.classList.contains("cvat-active-canvas-control"));
    });
    await test("A fresh same-tool shortcut cancels then restarts once", async () => {
      press(); await delay(260); assert(press().defaultPrevented && ai.classList.contains("cvat-active-canvas-control"));
      assert(counts.interact === 2 && counts.ai === 2 && escapeDowns === 2 && counts.save === 0);
    });
    await test("Modified shortcut sends unmodified Escape before switching AI to brush", () => {
      ai.classList.add("cvat-active-canvas-control"); press("KeyB", {ctrlKey:true,shiftKey:true});
      assert(escapeDowns === 1 && counts.shape === 1 && !ai.classList.contains("cvat-active-canvas-control"));
    });
    await test("Delayed cancellation waits for idle before opening the next tool", async () => {
      cancelDelay = 150; brush.classList.add("cvat-active-canvas-control"); press();
      assert(counts.ai === 0); await delay(250); assert(counts.interact === 1 && escapeDowns === 1);
    });
    await test("Unresponsive Escape fails closed without clicking the active tool or saving", async () => {
      cancelWorks = false; ai.classList.add("cvat-active-canvas-control"); press(); await delay(1300);
      assert(counts.ai === 0 && escapeDowns === 1); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("취소되지"));
    });
    await test("Existing-mask editing is canceled before a new tool starts", () => {
      $(".cvat-brush-tools-toolbox").hidden = false; press();
      assert($(".cvat-brush-tools-toolbox").hidden && counts.interact === 1 && counts.save === 0);
    });
    await test("Typing, pointer-down and unmatched keys do not send Escape", () => {
      $("#input").focus(); press(); focusBody(); press("KeyZ");
      document.body.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,buttons:1})); press();
      document.body.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,buttons:0}));
      assert(escapeDowns === 0); noStarts();
    });
    await test("Job navigation during cancellation prevents a start in the new job", async () => {
      cancelDelay = 150; brush.classList.add("cvat-active-canvas-control"); press();
      history.replaceState({}, "", "/tasks/9/jobs/9"); await delay(250); noStarts();
    });
    await test("A user's Escape cancels a pending tool switch", async () => {
      cancelDelay = 150; brush.classList.add("cvat-active-canvas-control"); press();
      document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27,bubbles:true}));
      await delay(250); noStarts();
    });
    await test("CVAT's buttonless popover mousedown does not block AI Interact", () => {
      ai.addEventListener("click", () => aiPanel.dispatchEvent(new MouseEvent("mousedown", {bubbles:true})), {once:true});
      assert(press().defaultPrevented);
      assert(counts.ai === 1 && counts.interact === 1 && counts.shape === 0, "AI menu opened but Interact did not start");
    });
    await test("CVAT's buttonless popover mousedown does not block mask Shape", () => {
      brush.addEventListener("click", () => brushPanel.dispatchEvent(new MouseEvent("mousedown", {bubbles:true})), {once:true});
      assert(press("KeyB", {ctrlKey:true,shiftKey:true}).defaultPrevented);
      assert(counts.brush === 1 && counts.shape === 1 && counts.interact === 0, "Mask menu opened but Shape did not start");
    });
    await test("Disabled sidebar tool is ignored with static feedback", () => {
      ai.classList.add("cvat-disabled-canvas-control"); assert(press().defaultPrevented);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("비활성화")); noStarts();
    });
    await test("Missing, hidden, off-screen, or duplicate sidebar tools are ignored", () => {
      ai.remove(); assert(press().defaultPrevented); side.append(ai);
      ai.hidden = true; assert(press().defaultPrevented); ai.hidden = false;
      ai.style.cssText = "position:fixed;left:-2000px"; assert(press().defaultPrevented); ai.style.cssText = "";
      const clone = ai.cloneNode(true); clone.classList.add("test-extra"); side.append(clone); assert(press().defaultPrevented); noStarts();
    });
    await test("Missing sidebar or unrelated SPA route cannot intercept keys", () => {
      side.hidden = true; assert(!press().defaultPrevented); side.hidden = false;
      history.replaceState({}, "", "/unrelated"); assert(!press().defaultPrevented); noStarts();
    });
    await test("Delayed popup and delayed start button are awaited within the bound", async () => {
      openDelay = 150; interact.hidden = true; schedule(() => {interact.hidden = false;}, 350);
      press(); assert(counts.interact === 0); await delay(450); assert(counts.ai === 1 && counts.interact === 1);
    });
    await test("Missing popup times out without any follow-up or generic button click", async () => {
      showPopover = false; press(); await delay(1300); noStarts(); assert(counts.ai === 1);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("메뉴를 확인하지 못했습니다"));
    });
    await test("Hidden Interact is not replaced by visible generic/wrong-popup buttons", async () => {
      interact.hidden = true; extra(brushPanel, "cvat-tools-interact-button"); press(); await delay(1300); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("사용할 수 없습니다"));
    });
    await test("Brush selects only mask Shape, never a generic or other-shape button", () => {
      extra(maskContent, "cvat-draw-polygon-shape-button"); extra(document.body, "cvat-draw-mask-shape-button");
      press("KeyB", {ctrlKey: true, shiftKey: true}); assert(counts.shape === 1 && counts.wrong === 0);
    });
    await test("Missing mask Shape does not click a global lookalike", async () => {
      shape.remove(); extra(document.body, "cvat-draw-mask-shape-button"); press("KeyB", {ctrlKey: true, shiftKey: true});
      await delay(1300); noStarts(); assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("사용할 수 없습니다"));
    });
    await test("Disabled Interact never falls back to a different enabled button", () => {
      interact.disabled = true; extra(document.body, "cvat-tools-interact-button"); press(); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("비활성화"));
    });
    await test("Disabled or loading mask Shape is not clicked", () => {
      shape.classList.add("ant-btn-loading"); press("KeyB", {ctrlKey: true, shiftKey: true}); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("비활성화"));
    });
    await test("Disabled popup ancestor prevents starting", () => {
      aiPanel.setAttribute("aria-disabled", "true"); press(); noStarts();
    });
    await test("Duplicate visible start buttons fail safely", () => {
      extra(aiPane, "cvat-tools-interact-button"); press(); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("여러 개"));
    });
    await test("Hidden duplicate buttons are ignored; one visible matching button starts once", () => {
      extra(aiPane, "cvat-tools-interact-button", true); press(); assert(counts.interact === 1 && counts.wrong === 0);
    });
    await test("Multiple visible matching popovers fail safely", () => {
      aiPanel.hidden = false; const duplicate = aiPanel.cloneNode(true); duplicate.classList.add("test-extra");
      duplicate.querySelector("button").onclick = () => count("wrong"); document.body.append(duplicate);
      press(); noStarts(); assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("여러 개"));
    });
    await test("Hidden Interactors pane never invokes detector/automatic annotation", async () => {
      aiPane.hidden = true; $("#detectors-pane").hidden = false; press(); await delay(1300); noStarts();
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("Interactors"));
    });
    await test("Pending start cancels if settings are cleared/reassigned", async () => {
      openDelay = 180; press(); await settings(S.assign(fixtureAPI.read()[S.STORAGE_KEY], "ai", null));
      await delay(300); noStarts();
    });
    await test("Pending start cancels when popup pauses the tab", async () => {
      openDelay = 180; press(); await chrome.tabs.sendMessage(7, {type: "CVAT_SHORTCUTS_DISABLE"}); await delay(300); noStarts();
    });
    await test("Pending start cancels if typing focus changes", async () => {
      openDelay = 180; press(); $("#input").focus(); await delay(300); noStarts(); focusBody();
    });
    await test("Pending start cancels if another drawing becomes active", async () => {
      openDelay = 180; press(); brush.classList.add("cvat-active-canvas-control"); await delay(300); noStarts();
    });
    await test("Pending start cancels for a new dialog or unrelated route", async () => {
      openDelay = 180; press(); $("#dialog").hidden = false; history.replaceState({}, "", "/unrelated");
      await delay(300); noStarts();
    });
    await test("Pending start cancels on window blur or compositionstart", async () => {
      openDelay = 180; press(); window.dispatchEvent(new Event("blur"));
      document.body.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true})); await delay(300); noStarts();
      document.body.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    });
    await test("Closing a popup while awaiting its button cancels the start", async () => {
      interact.hidden = true; press(); schedule(() => {aiPanel.hidden = true;}, 70);
      schedule(() => {aiPanel.hidden = false; interact.hidden = false;}, 200); await delay(350); noStarts();
    });
    await test("Corrupt duplicate settings fail closed; non-local changes are ignored", async () => {
      await settings({shortcuts: {ai: chord("KeyA"), brush: chord("KeyA")}}); assert(!press().defaultPrevented);
      await settings(standard()); fixtureAPI.emit({[S.STORAGE_KEY]: {newValue: {shortcuts: {ai: null}}}}, "sync");
      assert(press().defaultPrevented && counts.interact === 1);
    });
    await test("Reinjection keeps one listener set and starts exactly once", async () => {
      const oldStorage = fixtureAPI.listeners.storage.length; const oldMessages = fixtureAPI.listeners.message.length;
      await load(); assert(fixtureAPI.listeners.storage.length === oldStorage && fixtureAPI.listeners.message.length === oldMessages);
      press(); assert(counts.ai === 1 && counts.interact === 1);
    });
    await test("Storage read failures keep shortcuts paused; re-enable recovers", async () => {
      fixtureAPI.failRead(true); const status = await window.__cvatSidebarShortcutsControllerV1.enable();
      assert(!status.enabled && !press().defaultPrevented); noStarts(); fixtureAPI.failRead(false);
      await window.__cvatSidebarShortcutsControllerV1.enable(); press(); assert(counts.interact === 1);
    });
    await test("Catalog includes unused classes and rejects incomplete lists", () => {
      const root = document.createElement("div");
      root.innerHTML = '<div class="cvat-objects-sidebar-labels-list"><div class="cvat-objects-sidebar-labels-list-header">Items: 2</div><div class="cvat-objects-sidebar-label-item"><span class="cvat-text">class-a</span></div><div class="cvat-objects-sidebar-label-item cvat-objects-sidebar-label-item-disabled"><span class="cvat-text">unused</span></div></div>';
      assert(JSON.stringify(S.readLabelCatalog(root)) === JSON.stringify({state:"ready", labels:[{name:"class-a",duplicate:false},{name:"unused",duplicate:false}]}));
      root.querySelector(".cvat-objects-sidebar-labels-list-header").textContent = "Items: 3";
      assert(S.readLabelCatalog(root).state === "unavailable");
    });
    await test("Overview excludes its total row and flags duplicate names", () => {
      const root = document.createElement("div");
      root.innerHTML = '<div class="cvat-job-info-statistics"><table><tbody><tr class="ant-table-measure-row"><td></td></tr><tr data-row-key="a"><td>class-a</td><td>0</td></tr><tr data-row-key="b"><td>class-a</td><td>1</td></tr><tr data-row-key="Total"><td>Total</td></tr><tr data-row-key="___total"><td>Total</td><td>1</td></tr></tbody></table></div>';
      assert(JSON.stringify(S.readLabelCatalog(root)) === JSON.stringify({state:"ready", labels:[{name:"class-a",duplicate:true},{name:"Total",duplicate:false}]}));
      root.querySelector('[data-row-key="___total"]').remove();
      assert(S.readLabelCatalog(root).state === "unavailable");
    });
    await test("Catalog names remain text and empty names fail closed", () => {
      const root = document.createElement("div");
      root.innerHTML = '<div class="cvat-objects-sidebar-labels-list"><div class="cvat-objects-sidebar-labels-list-header">Items: 1</div><div class="cvat-objects-sidebar-label-item"><span class="cvat-text">&lt;img src=x&gt;</span></div></div>';
      assert(S.readLabelCatalog(root).labels[0].name === '<img src=x>');
      root.querySelector(".cvat-text").textContent = ""; assert(S.readLabelCatalog(root).state === "unavailable");
    });
    await test("Catalog reads CVAT representative colors from the class swatch", () => {
      const root = document.createElement("div");
      root.innerHTML = '<div class="cvat-objects-sidebar-labels-list"><div class="cvat-objects-sidebar-labels-list-header">Items: 2</div><div class="cvat-objects-sidebar-label-item"><div class="cvat-label-item-color" style="background: #126abc"></div><span class="cvat-text">class-a</span></div><div class="cvat-objects-sidebar-label-item cvat-objects-sidebar-label-item-disabled"><div class="cvat-label-item-color" style="background: rgb(239, 128, 64)"></div><span class="cvat-text">unused</span></div></div>';
      assert(S.readLabelCatalog(root).labels[0].color === "#126abc");
      assert(S.readLabelCatalog(root).labels[1].color === "#ef8040");
      root.querySelector(".cvat-label-item-color").style.background = "transparent";
      assert(!S.readLabelCatalog(root).labels[0].color);
    });
    await test("Color parsing accepts literal RGB and rejects URLs and invalid values", () => {
      assert(S.normalizeLabelColor("#AbC") === "#aabbcc");
      assert(S.normalizeLabelColor("rgb(0, 255, 16)") === "#00ff10");
      for (const color of ["url(https://example.test/x)", "rgb(256,0,0)", "var(--label)", "transparent", null]) assert(S.normalizeLabelColor(color) === null);
    });
    await test("Only HTTP(S) CVAT job paths are eligible", () => {
      assert(S.supportedURL("https://example.test/tasks/23/jobs/45?frame=1"));
      for (const url of ["https://example.test/", "https://example.test/tasks/1", "file:///tasks/1/jobs/1", "chrome://extensions", "https://example.test/tasks/x/jobs/1", "https://example.test/tasks/1/jobs/1/other"]) assert(!S.supportedURL(url), url);
    });
  } catch (error) {results.push({name: "Fixture setup", passed: false, error: error.message});}
  const summary = {suite: "content", passed: results.filter((test) => test.passed).length,
    failed: results.filter((test) => !test.passed).length, results, totalClicks: totals};
  document.getElementById("test-results").textContent = JSON.stringify(summary, null, 2); window.fixtureResults = summary;
})();
