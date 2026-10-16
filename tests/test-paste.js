/* Synthetic CVAT state and real Mousetrap. No company data or server. */
(async () => {
  'use strict';
  const results=[], wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const assert=(value,message='assertion failed')=>{if(!value)throw Error(message);};
  let state, mode='idle', events=[], nextID=100, previewDelay=0, frameDelay=0, acceptClick=true;
  const store={getState:()=>state,dispatch:()=>{throw Error('Macro must not dispatch Redux actions');}};
  document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$paste={memoizedProps:{store}};
  const next=document.createElement('button');next.className='cvat-player-next-button';document.body.append(next);
  const mask=document.createElement('canvas');mask.id='mask-surface';mask.className='upper-canvas';document.querySelector('#mask-surface').replaceWith(mask);
  const polygon=document.createElement('div');polygon.id='cvat_canvas_content';polygon.style.cssText='position:fixed;top:350px;left:500px;width:400px;height:180px';document.body.append(polygon);
  Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  function reset(shape='mask',end=3){
    mode='idle';events=[];previewDelay=0;frameDelay=0;acceptClick=true;next.className='cvat-player-next-button';
    const copied={objectType:'shape',shapeType:shape,label:{id:7}};
    const handler={drawData:{initialState:copied},isInsertion:false,drawnObjects:[],initialized:false,drawInstance:null};
    state={annotation:{workspace:'Standard',canvas:{ready:true,instance:{mode:()=>mode,view:{masksHandler:handler,drawHandler:handler}}},
      job:{instance:{id:16,dimension:'2d',stopFrame:end}},player:{frame:{number:1,fetching:false}},drawing:{activeInitialState:copied},
      annotations:{states:[],filters:[]}},shortcuts:{keyMap:{PASTE_SHAPE:{sequences:['ctrl+v','command+v']},NEXT_FRAME:{sequences:['f']}}}};
  }
  function paste(){
    events.push('paste');mode='draw';const h=state.annotation.canvas.instance.view.masksHandler;
    h.isInsertion=true;setTimeout(()=>{if(mode==='draw'){h.drawnObjects=[{}];h.initialized=true;h.drawInstance={};}},previewDelay);
  }
  function confirm(){
    if(mode!=='draw')return;
    const a=state.annotation,h=a.canvas.instance.view.masksHandler;
    if(!h.drawnObjects.length)throw Error('clicked before asynchronous preview was ready');
    events.push('click');if(!acceptClick)return;
    a.annotations.states.push({clientID:++nextID,frame:a.player.frame.number,shapeType:a.drawing.activeInitialState.shapeType,label:{id:7}});
    mode='idle';h.isInsertion=false;h.drawnObjects=[];h.initialized=false;h.drawInstance=null;
  }
  function advance(){
    events.push('next');const a=state.annotation;a.player.frame.fetching=true;
    setTimeout(()=>{a.player.frame.number++;a.annotations.states=[];a.player.frame.fetching=false;},frameDelay);
  }
  Mousetrap.bind(['ctrl+v','command+v'],paste);Mousetrap.bind('f',advance);
  Mousetrap.bind('esc',()=>{mode='idle';events.push('escape');});
  mask.addEventListener('mousedown',confirm);polygon.addEventListener('mousedown',confirm);
  let macro,available=true,feedback=[];
  async function test(name,run){try{reset();available=true;feedback=[];await run();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}finally{macro?.stop();await wait(20);}}
  async function load(name){const script=document.createElement('script');script.src='/extension/'+name;await new Promise(resolve=>{script.onload=resolve;document.body.append(script);});}
  await load('native-repeat.js');await load('paste-repeat.js');
  macro=CVATPasteRepeat.create({available:()=>available,notify:text=>feedback.push(text),isMac:()=>false});
  // Unit tests send keyboard events through the same interruption hook used by content.js.
  window.addEventListener('keydown',event=>macro.interrupt(event),true);
  async function done(){for(let i=0;i<100&&macro.status().running;i++)await wait(50);assert(!macro.status().running,'loop did not stop');}
  await test('Repeats paste, one confirmation and next frame in order until the last frame',async()=>{
    macro.start();await done();assert(events.join(',')==='paste,click,next,paste,click,next,paste,click',events.join(','));assert(macro.status().completed===3);
    assert(feedback.length===2&&feedback[0].includes('시작')&&feedback[1].includes('마지막 프레임'),'only start and stop should notify');
  });
  await test('Does not click a mask before its asynchronous preview is ready',async()=>{
    reset('mask',1);previewDelay=650;macro.start();await wait(500);assert(events.join(',')==='paste');await done();assert(macro.status().completed===1);
  });
  await test('Waits for the next frame load before pasting again',async()=>{
    reset('mask',2);frameDelay=700;macro.start();await wait(700);assert(events.filter(e=>e==='paste').length===1);await done();assert(macro.status().completed===2);
  });
  await test('Polygon uses the SVG content confirmation target',async()=>{reset('polygon',1);macro.start();await done();assert(macro.status().completed===1);});
  await test('Esc during preview cancels without confirming or moving',async()=>{
    previewDelay=900;macro.start();await wait(400);document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));await wait(1000);
    assert(!macro.status().running&&events.includes('escape')&&!events.includes('click')&&!events.includes('next'));
  });
  await test('Stop during frame loading never pastes in the following frame',async()=>{
    frameDelay=800;macro.start();await wait(500);macro.stop();await wait(1100);assert(events.filter(e=>e==='paste').length===1&&macro.status().completed===1);
  });
  await test('Starting again while running stops rather than creating two loops',async()=>{macro.start();macro.start();await wait(400);assert(events.length===0&&!macro.status().running);});
  await test('Missing clipboard prevents all input',async()=>{state.annotation.drawing.activeInitialState=null;macro.start();await wait(300);assert(!macro.status().running&&events.length===0);});
  await test('Tracks are rejected to avoid propagating a track as independent shapes',async()=>{state.annotation.drawing.activeInitialState.objectType='track';macro.start();assert(!macro.status().running);});
  await test('An already active drawing is not canceled by Start',async()=>{mode='draw';macro.start();assert(!macro.status().running&&events.length===0);});
  await test('Modified native F binding prevents the macro from starting',async()=>{state.shortcuts.keyMap.NEXT_FRAME.sequences=['g'];macro.start();assert(!macro.status().running);});
  await test('Filtered frame navigation prevents the macro from starting',async()=>{next.className='cvat-player-next-button-filtered';macro.start();assert(!macro.status().running);});
  await test('Unknown canvas implementation fails without fake clicks',async()=>{delete state.annotation.canvas.instance.view;macro.start();assert(!macro.status().running&&events.length===0);});
  await test('Missing frame boundary fails closed',async()=>{delete state.annotation.job.instance.stopFrame;macro.start();assert(!macro.status().running);});
  await test('Changing the clipboard stops instead of silently switching objects',async()=>{
    previewDelay=800;macro.start();await wait(400);state.annotation.drawing.activeInitialState={...state.annotation.drawing.activeInitialState};await done();assert(!events.includes('click'));
  });
  await test('A changed job stops before confirmation',async()=>{previewDelay=800;macro.start();await wait(400);state.annotation.job.instance.id=99;await done();assert(!events.includes('click'));});
  await test('An unrelated key stops the loop during preview',async()=>{
    previewDelay=800;macro.start();await wait(400);document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true}));await done();assert(!events.includes('click'));
  });
  await test('Page blur stops the loop',async()=>{macro.start();window.dispatchEvent(new Event('blur'));await wait(400);assert(!macro.status().running&&events.length===0);});
  await test('Disabled extension prevents all input',async()=>{available=false;macro.start();assert(!macro.status().running&&events.length===0);});
  await test('Failed confirmation times out without moving or retrying the same frame',async()=>{
    acceptClick=false;macro.start();await wait(16000);assert(!macro.status().running&&events.filter(e=>e==='paste').length===1&&events.filter(e=>e==='click').length===1&&!events.includes('next'));
    assert(feedback.length===2&&feedback[1].includes('확인하지 못했습니다'),'failure remains visible without progress notices');
  });
  await test('Paste settings conflict with tool and label keys',async()=>{
    const S=CVATShortcuts;let threw=false;
    try{S.assign(S.normalize({shortcuts:{ai:{code:'F8'}}}),'paste',{code:'F8'});}catch{threw=true;}assert(threw);
    assert(S.assign(S.normalize({}),'paste',{code:'F8'}).shortcuts.paste.code==='F8');
  });
  const report=document.getElementById('test-results');report.textContent=JSON.stringify({suite:'Paste repeat',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results});
})();
