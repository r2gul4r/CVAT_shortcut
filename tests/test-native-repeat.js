/* CVAT's public N and REMEMBER_OBJECT contracts, synthetic React/Redux state and real Mousetrap. */
(async () => {
  "use strict";
  const S=CVATShortcuts, results=[], $=(selector)=>document.querySelector(selector);
  const wait=(ms=0)=>new Promise((resolve)=>setTimeout(resolve,ms));
  const side=$(".cvat-canvas-controls-sidebar"), brush=$(".cvat-draw-mask-control"), ai=$(".cvat-tools-control");
  const toolbox=$(".cvat-brush-tools-toolbox");
  const catalog=document.createElement("div");catalog.className="cvat-objects-sidebar-labels-list";document.body.append(catalog);
  const labels=[{id:1,name:"person",type:"any"},{id:2,name:"obstacle",type:"any"},
    {id:3,name:"polygon-label",type:"polygon"},{id:4,name:"tag-label",type:"tag"},
    {id:5,name:"mask-label",type:"mask"},{id:6,name:"skeleton-label",type:"skeleton",structure:{svg:"<svg/>"}}];
  let mode="idle",state,actions=[],starts=[],finishes=[],escapes=0,redraws=0,ignoreDispatch=false;
  const canvas={mode:()=>mode};
  const store={getState:()=>state,dispatch(action){
    actions.push(action);if(ignoreDispatch)return;
    if(action.type==="REMEMBER_OBJECT"){
      // Like CVAT, resets drawing defaults instead of merging with the previous drawing.
      state={...state,annotation:{...state.annotation,drawing:{activeShapeType:"rectangle",activeLabelID:null,activeObjectType:"shape",activeInteractorParameters:{},...action.payload}}};
    }
  }};
  function attachStore(context=false,legacy=false){
    for(const key of Object.getOwnPropertyNames(side))if(/^__react(Fiber|InternalInstance)\$/.test(key))delete side[key];
    side[legacy?"__reactInternalInstance$fixture":"__reactFiber$fixture"]={memoizedProps:{},return:{memoizedProps:context?{value:{store}}:{store},return:null}};
  }
  function idle(){
    mode="idle";state.annotation.canvas.activeControl="cursor";toolbox.hidden=true;
    ai.classList.remove("cvat-active-canvas-control");brush.classList.remove("cvat-active-canvas-control");
    $(".cvat-tools-control-popover").hidden=true;$(".cvat-draw-mask-popover").hidden=true;
  }
  function nativeN(){
    const drawing=state.annotation.drawing;
    if(mode==="edit"){idle();return;}
    if(mode!=="idle"||!["cursor","drag_canvas","zoom_canvas"].includes(state.annotation.canvas.activeControl)){
      finishes.push(drawing.activeLabelID);idle();return;
    }
    starts.push({...drawing});mode=drawing.activeInteractor?"interact":"draw";
    state.annotation.canvas.activeControl=drawing.activeInteractor?"ai_tools":`draw_${drawing.activeShapeType}`;
    if(drawing.activeShapeType==="mask")toolbox.hidden=false;
  }
  Mousetrap.bind("n",nativeN,"keydown");Mousetrap.bind("shift+n",()=>redraws++,"keydown");
  document.addEventListener("keydown",(event)=>{if(event.code==="Escape"){escapes++;idle();}});
  brush.onclick=()=>{$(".cvat-draw-mask-popover").hidden=false;};
  ai.onclick=()=>{$(".cvat-tools-control-popover").hidden=false;};
  $(".cvat-draw-mask-shape-button").onclick=()=>{
    const name=labelFixture.byID("mask-label").root.value;
    state.annotation.drawing={activeObjectType:"shape",activeShapeType:"mask",activeLabelID:labels.find(label=>label.name===name).id};
    idle();nativeN();brush.classList.add("cvat-active-canvas-control");
  };
  $(".cvat-tools-interact-button").onclick=()=>{
    const name=labelFixture.byID("ai-label").root.value;
    state.annotation.drawing={activeObjectType:"shape",activeLabelID:labels.find(label=>label.name===name).id,
      activeInteractor:{name:"dummy-model",returnType:"mask",kind:"interactor"},activeInteractorParameters:{enabled:true,box:true}};
    idle();nativeN();ai.classList.add("cvat-active-canvas-control");
  };
  function key(type,code="KeyN",extra={},target=document.body){
    const base=code.startsWith("Key")?code.slice(3).toLowerCase():code.startsWith("Digit")?code.slice(5):"n";
    const char=extra.shiftKey?base.toUpperCase():base;
    const number=type==="keypress"?char.charCodeAt(0):char.toUpperCase().charCodeAt(0);
    const event=new KeyboardEvent(type,{code,key:char,keyCode:number,which:number,bubbles:true,cancelable:true,composed:true,...extra});
    target.dispatchEvent(event);return event;
  }
  function press(code="KeyN",extra={},target=document.body){const event=key("keydown",code,extra,target);key("keypress",code,extra,target);key("keyup",code,extra,target);return event;}
  const settings=(changes)=>chrome.storage.local.set({[S.STORAGE_KEY]:S.normalize({...fixtureAPI.read()[S.STORAGE_KEY],...changes})});
  function assert(value,why="Native N assertion failed"){if(!value)throw new Error(why);}
  async function reset(){
    window.dispatchEvent(new Event("blur"));fixtureAPI.failRead(false);fixtureAPI.failWrite(false);
    history.replaceState({},"","/tasks/1/jobs/10");$("#dialog").hidden=true;document.body.focus();
    // CVAT Workspace.STANDARD is case-sensitive: 'Standard' (cvat-ui/src/reducers/index.ts).
    state={annotation:{workspace:"Standard",canvas:{instance:canvas,activeControl:"cursor",ready:true},
      job:{instance:{id:10,dimension:"2d"},labels:[...labels],fetching:false,saving:false},player:{frame:{fetching:false}},
      drawing:{activeLabelID:1,activeObjectType:"shape",activeShapeType:"mask",activeNumOfPoints:7,
        activeRectDrawingMethod:"rotated_points",activeCuboidDrawingMethod:"corners",activeSimplifyPoly:true,
        activeInteractorParameters:{enabled:false},customOption:"preserve-me"}},
      shortcuts:{keyMap:{SWITCH_DRAW_MODE_STANDARD_CONTROLS:{sequences:["n"]}}}};
    attachStore();idle();ignoreDispatch=false;actions=[];starts=[];finishes=[];escapes=redraws=0;
    catalog.replaceChildren();const heading=document.createElement("div");heading.className="cvat-objects-sidebar-labels-list-header";heading.textContent=`Items: ${labels.length}`;catalog.append(heading);
    for(const label of labels){const row=document.createElement("div");row.className="cvat-objects-sidebar-label-item";const text=document.createElement("span");text.className="cvat-text";text.textContent=label.name;row.append(text);catalog.append(row);}
    labelFixture.reset();for(const id of ["ai-label","mask-label"])labelFixture.byID(id).options(labels.map(label=>label.name));
    await settings({defaultLabelName:"person",shortcuts:{ai:{code:"KeyV"},brush:{code:"KeyB"}},labelShortcuts:[{name:"person",shortcut:{code:"Digit1"}},{name:"obstacle",shortcut:{code:"Digit2"}}]});
    await window.__cvatSidebarShortcutsControllerV1.enable();await wait(260);
    $("#cvat-sidebar-shortcuts-feedback")?.remove();
  }
  async function test(name,run){try{await reset();await run();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}}
  async function load(src){const script=document.createElement("script");script.src=src;await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});}
  try{
    fixtureAPI.clear();await load("/extension/native-repeat.js");await load("/extension/content.js");
    await test("CVAT's real Standard workspace starts native N once with the chosen label",()=>{
      press("Digit2");assert(!press().defaultPrevented);assert(starts.length===1&&starts[0].activeLabelID===2&&escapes===0);
      assert(!document.querySelector("[data-cvat-repeat-request]"));
    });
    await test("N preserves all remembered draw options, object type and custom metadata",async()=>{
      state.annotation.drawing.activeObjectType="track";const before={...state.annotation.drawing};await settings({defaultLabelName:"obstacle"});press();
      for(const key of Object.keys(before))if(key!=="activeLabelID")assert(starts[0][key]===before[key],key);
      assert(actions.length===1&&actions[0].payload.updateCurrentControl===false);
    });
    await test("N finishes the original mask label after selecting a different next label",()=>{
      mode="draw";state.annotation.canvas.activeControl="draw_mask";toolbox.hidden=false;press("Digit2");press();
      assert(finishes.length===1&&finishes[0]===1&&actions.length===0);
      press();assert(starts.length===1&&starts[0].activeLabelID===2);
    });
    await test("Idle canvas with a drawing control keeps the native stop path",async()=>{
      state.annotation.canvas.activeControl="draw_polygon";await settings({defaultLabelName:"obstacle"});press();assert(actions.length===0&&finishes.length===1&&finishes[0]===1);
    });
    await test("N closes existing-mask EDIT without changing its label",async()=>{
      mode="edit";toolbox.hidden=false;await settings({defaultLabelName:"obstacle"});press();assert(actions.length===0&&mode==="idle"&&state.annotation.drawing.activeLabelID===1);
    });
    await test("AI N keeps the exact model and interactor options while changing label",async()=>{
      const model={kind:"interactor",returnType:"mask",name:"selected-model"},parameters={enabled:true,box:true,slider:27};
      state.annotation.drawing.activeInteractor=model;state.annotation.drawing.activeInteractorParameters=parameters;
      await settings({defaultLabelName:"obstacle"});press();assert(starts[0].activeInteractor===model&&starts[0].activeInteractorParameters===parameters&&starts[0].activeLabelID===2);
    });
    await test("AI interaction N finishes before a changed label can be used",async()=>{
      mode="interact";state.annotation.canvas.activeControl="ai_tools";await settings({defaultLabelName:"obstacle"});press();assert(actions.length===0&&finishes[0]===1);
    });
    await test("B and N use the same selected label through real tool UI controls",async()=>{
      press("Digit2");press("KeyB");await wait(80);assert(starts[0].activeLabelID===2);press();
      press("Digit1");press();assert(starts.length===2&&starts[1].activeLabelID===1&&starts[1].activeShapeType==="mask");
    });
    await test("V and N use the same selected label and preserve the chosen model",async()=>{
      press("Digit2");press("KeyV");await wait(80);assert(starts[0].activeLabelID===2&&starts[0].activeInteractor.name==="dummy-model");
      press();press("Digit1");press();assert(starts[1].activeLabelID===1&&starts[1].activeInteractor===starts[0].activeInteractor);
    });
    await test("A manually chosen polygon repeats with a compatible typed label",async()=>{
      state.annotation.drawing.activeShapeType="polygon";await settings({defaultLabelName:"polygon-label"});press();assert(starts[0].activeShapeType==="polygon"&&starts[0].activeLabelID===3);
    });
    await test("A skeleton repeat uses a compatible label and preserves drawing parameters",async()=>{
      state.annotation.drawing.activeShapeType="skeleton";await settings({defaultLabelName:"skeleton-label"});press();assert(starts[0].activeLabelID===6);
    });
    await test("Tag labels are checked before a native tag repeat",async()=>{
      state.annotation.drawing.activeObjectType="tag";state.annotation.drawing.activeShapeType=null;await settings({defaultLabelName:"tag-label"});press();assert(starts[0].activeLabelID===4);
    });
    await test("Untyped labels can also be used for a native tag repeat",async()=>{
      state.annotation.drawing.activeObjectType="tag";state.annotation.drawing.activeShapeType=null;await settings({defaultLabelName:"obstacle"});press();assert(starts[0].activeLabelID===2);
    });
    await test("Incompatible label type blocks N including its keypress",async()=>{
      await settings({defaultLabelName:"polygon-label"});assert(press().defaultPrevented);assert(starts.length===0&&actions.length===0&&$("#cvat-sidebar-shortcuts-feedback").textContent.includes("형식"));
    });
    await test("Missing and duplicate native labels block N before any dispatch",async()=>{
      await settings({defaultLabelName:"obstacle"});state.annotation.job.labels=[labels[0]];assert(press().defaultPrevented);assert(actions.length===0&&starts.length===0);
      state.annotation.job.labels=[...labels,{...labels[1],id:8}];assert(press().defaultPrevented);assert(actions.length===0&&starts.length===0);
    });
    await test("Unknown React store cannot silently start with the old label",async()=>{
      delete side.__reactFiber$fixture;await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented);assert(starts.length===0&&actions.length===0&&$("#cvat-sidebar-shortcuts-feedback").textContent.includes("N 라벨 연동을 확인하지 못"));
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: STORE"));
      press("KeyB");await wait(80);assert(starts.length===1&&starts[0].activeLabelID===2);
    });
    await test("Redux Context Provider and older React attachment are supported",async()=>{
      attachStore(true,true);await settings({defaultLabelName:"obstacle"});press();assert(starts[0].activeLabelID===2);
    });
    await test("A cyclic React ancestry is bounded and does not start an old-label tool",async()=>{
      const fiber={memoizedProps:{}};fiber.return=fiber;side.__reactFiber$fixture=fiber;await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented&&starts.length===0);
    });
    await test("Job navigation mismatch blocks store mutation",async()=>{
      state.annotation.job.instance.id=99;await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: JOB"));
    });
    await test("Frame loading blocks repeat without changing parameters",async()=>{
      state.annotation.player.frame.fetching=true;await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
    });
    await test("A deleted frame cannot change remembered label or start native N",async()=>{
      state.annotation.player.frame.data={deleted:true};await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
    });
    await test("An unknown Canvas API or nonstandard workspace is rejected",async()=>{
      state.annotation.canvas.instance={};await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented);assert(actions.length===0&&starts.length===0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: CANVAS"));
      state.annotation.canvas.instance=canvas;state.annotation.workspace="Review";assert(press().defaultPrevented&&actions.length===0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: WORKSPACE"));
    });
    await test("3D workspace and missing shortcut contracts report their own failure stage",async()=>{
      await settings({defaultLabelName:"obstacle"});state.annotation.job.instance.dimension="3d";
      assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: DIMENSION"));
      state.annotation.job.instance.dimension="2d";state.shortcuts.keyMap={};
      assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: SHORTCUTS"));
    });
    await test("Bridge exceptions show a fixed code without exposing exception contents",async()=>{
      await settings({defaultLabelName:"obstacle"});const getState=store.getState;
      try{
        store.getState=()=>{throw new Error("private-runtime-detail");};
        assert(press().defaultPrevented&&actions.length===0&&starts.length===0);
        const feedback=$("#cvat-sidebar-shortcuts-feedback").textContent;
        assert(feedback.includes("확인 코드: RUNTIME")&&!feedback.includes("private-runtime-detail")&&!feedback.includes("obstacle"));
      }finally{store.getState=getState;}
    });
    await test("A remapped native N passes through without changing remembered label",async()=>{
      state.shortcuts.keyMap.SWITCH_DRAW_MODE_STANDARD_CONTROLS.sequences=["q"];await settings({defaultLabelName:"obstacle"});assert(!press().defaultPrevented&&actions.length===0);
    });
    await test("The older native shortcut key name is supported",async()=>{
      state.shortcuts.keyMap={SWITCH_DRAW_MODE:{sequences:["n"]}};await settings({defaultLabelName:"obstacle"});press();assert(starts[0].activeLabelID===2);
    });
    await test("A legacy keypress N handler also receives exactly one selected-label start",async()=>{
      Mousetrap.unbind("n","keydown");Mousetrap.bind("n",nativeN,"keypress");
      await settings({defaultLabelName:"obstacle"});press();assert(starts.length===1&&starts[0].activeLabelID===2);
      Mousetrap.unbind("n","keypress");Mousetrap.bind("n",nativeN,"keydown");
    });
    await test("Shift+N redraw keeps its native behavior and original label",async()=>{
      await settings({defaultLabelName:"obstacle"});press("KeyN",{shiftKey:true});assert(redraws===1&&actions.length===0&&starts.length===0,JSON.stringify({redraws,actions:actions.length,starts:starts.length}));
    });
    await test("Typing, IME, modifiers and open dialogs do not mutate CVAT repeat state",async()=>{
      await settings({defaultLabelName:"obstacle"});$("#input").focus();press("KeyN",{},$("#input"));document.body.focus();
      press("KeyN",{isComposing:true});press("KeyN",{ctrlKey:true});$("#dialog").hidden=false;press();assert(actions.length===0);
    });
    await test("An extension key assigned to N takes precedence over native repeat",async()=>{
      await settings({defaultLabelName:"obstacle",shortcuts:{brush:{code:"KeyN"}}});assert(press().defaultPrevented);await wait(80);
      assert(starts.length===1&&starts[0].activeLabelID===2&&escapes===1&&actions.length===0);
    });
    await test("N held repeats do not change the label of a drawing that already started",async()=>{
      await settings({defaultLabelName:"obstacle"});key("keydown");key("keypress");const count=actions.length;
      key("keydown","KeyN",{repeat:true});key("keyup");assert(actions.length===count&&state.annotation.drawing.activeLabelID===2);
    });
    await test("Paused extension leaves native N intact",async()=>{
      await settings({defaultLabelName:"obstacle"});await chrome.tabs.sendMessage(7,{type:"CVAT_SHORTCUTS_DISABLE"});press();assert(starts[0].activeLabelID===1&&actions.length===0);
    });
    await test("An unsupported request protocol cannot dispatch Redux actions",()=>{
      const node=document.createElement("span");node.hidden=true;node.setAttribute("data-cvat-repeat-request",JSON.stringify({version:9,path:location.pathname,label:"obstacle"}));document.body.append(node);
      node.dispatchEvent(new Event("cvat-shortcuts-native-repeat-v1",{bubbles:true}));assert(actions.length===0&&node.getAttribute("data-cvat-repeat-response")==="unsupported");node.remove();
      assert(node.getAttribute("data-cvat-repeat-reason")==="REQUEST");
    });
    await test("Unexpected reducer behavior stops N and retains the original state",async()=>{
      ignoreDispatch=true;await settings({defaultLabelName:"obstacle"});assert(press().defaultPrevented);assert(starts.length===0&&state.annotation.drawing.activeLabelID===1);
      assert($("#cvat-sidebar-shortcuts-feedback").textContent.includes("확인 코드: REDUCER"));
    });
    await test("Reinjection does not register duplicate bridge listeners",async()=>{
      await load("/extension/native-repeat.js");await settings({defaultLabelName:"obstacle"});press();assert(actions.length===1&&starts.length===1);
    });
    await test("A pending V/B transition blocks native N until the tool starts",()=>{
      ai.onclick=()=>{};press("KeyV");assert(press().defaultPrevented);assert(starts.length===0&&actions.length===0);ai.onclick=()=>{$(".cvat-tools-control-popover").hidden=false;};
    });
    await test("Overlay click selects the same optimistic label used by N",()=>{
      const root=$("#cvat-shortcuts-label-overlay").shadowRoot;
      root.querySelector('.choice[value="obstacle"]').click();press();assert(starts[0].activeLabelID===2&&escapes===0);
    });
    await test("Existing annotation state is never accessed or relabeled by the bridge",async()=>{
      Object.defineProperty(state.annotation,"annotations",{get(){throw new Error("Annotation data accessed");}});
      await settings({defaultLabelName:"obstacle"});press();assert(starts.length===1&&starts[0].activeLabelID===2);
    });
  }catch(error){results.push({name:"Native repeat fixture setup",passed:false,error:error.message});}
  await chrome.tabs.sendMessage(7,{type:"CVAT_SHORTCUTS_DISABLE"}).catch(()=>{});
  const report={suite:"native N label synchronization",passed:results.filter(result=>result.passed).length,failed:results.filter(result=>!result.passed).length,results};
  $("#test-results").textContent=JSON.stringify(report);
})();
