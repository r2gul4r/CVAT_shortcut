/* Dedicated ephemeral headless Chrome. Verifies real MAIN/isolated DOM communication with mocked Chrome APIs. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromePath=process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const fixture=`<!doctype html><body tabindex="-1"><div class="cvat-canvas-controls-sidebar" style="height:80px;width:60px"><span class="cvat-cursor-control cvat-active-canvas-control">Cursor</span><span class="cvat-draw-mask-control">Mask</span></div><div class="cvat-brush-tools-toolbox" hidden>Brush</div><div id="result"></div></body>`;
const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir(path.join(root,'tests','.browser-profiles'),{recursive:true});
const profile=await mkdtemp(path.join(root,'tests','.browser-profiles','worlds-'));
const child=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions',
  '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];let socket;
try{
  let port;
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port,'Ephemeral Chrome did not expose its test port');
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=tabs.find(tab=>tab.type==='page'&&tab.url==='about:blank');assert(page,'Only the new test browser is permitted');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const pending=new Map();let sequence=0;
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Test CDP timeout: ${method}`));},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async(expression,contextId,userGesture=false)=>{const response=await send('Runtime.evaluate',{expression,contextId,userGesture,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.text+': '+response.exceptionDetails.exception?.description);return response.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/tasks/1/jobs/11`});
  for(let i=0;i<50;i++){if(await evaluate('Boolean(document.querySelector(".cvat-canvas-controls-sidebar"))'))break;await pause(20);}
  await evaluate(`
    window.testMode='idle';window.testStarts=[];window.testFinishes=[];
    window.testState={annotation:{workspace:'Standard',canvas:{instance:{mode:()=>testMode},ready:true,activeControl:'cursor'},
      job:{instance:{id:11,dimension:'2d'},labels:[{id:1,name:'person',type:'any'},{id:2,name:'obstacle',type:'any'}]},player:{frame:{fetching:false}},
      drawing:{activeLabelID:1,activeShapeType:'mask',activeObjectType:'shape',activeNumOfPoints:7,activeRectDrawingMethod:'rotated_points',activeInteractorParameters:{box:true}}},
      shortcuts:{keyMap:{SWITCH_DRAW_MODE_STANDARD_CONTROLS:{sequences:['n']}}}};
    window.testStore={getState:()=>testState,dispatch:action=>{testState.annotation.drawing={activeShapeType:'rectangle',activeObjectType:'shape',activeLabelID:null,...action.payload};}};
    document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$worldTest={return:{memoizedProps:{store:testStore},return:null}};
    document.addEventListener('keydown',event=>{if(event.code!=='KeyN')return;
      if(testMode==='draw'){testFinishes.push(testState.annotation.drawing.activeLabelID);testMode='idle';testState.annotation.canvas.activeControl='cursor';document.querySelector('.cvat-brush-tools-toolbox').hidden=true;}
      else{testStarts.push({...testState.annotation.drawing});testMode='draw';testState.annotation.canvas.activeControl='draw_mask';document.querySelector('.cvat-brush-tools-toolbox').hidden=false;}});
    window.testKey=code=>{for(const type of ['keydown','keypress','keyup'])document.body.dispatchEvent(new KeyboardEvent(type,{code,key:code==='KeyN'?'n':'1',bubbles:true,cancelable:true,composed:true}));};
  `);
  await evaluate(await readFile(path.join(root,'extension','native-repeat.js'),'utf8'));
  const {frameTree}=await send('Page.getFrameTree');
  const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'CVAT extension test isolated world'});
  await evaluate(await readFile(path.join(root,'tests','chrome-shim.js'),'utf8'),executionContextId);
  for(const name of ['common.js','overlay.js'])await evaluate(await readFile(path.join(root,'extension',name),'utf8'),executionContextId);
  await evaluate(`chrome.storage.local.set({cvatSidebarShortcutsV1:CVATShortcuts.normalize({defaultLabelName:'obstacle',labelShortcuts:[{name:'person',shortcut:{code:'Digit1'}}]}),cvatLabelOverlayEnabled:false})`,executionContextId);
  await evaluate(await readFile(path.join(root,'extension','content.js'),'utf8'),executionContextId);
  async function test(name,run){try{await run();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}}
  await test('MAIN and isolated globals are distinct',async()=>{
    assert.equal(await evaluate('typeof window.__cvatSidebarShortcutsControllerV1'),'undefined');
    assert.equal(await evaluate('typeof window.__cvatShortcutsNativeRepeatV1',executionContextId),'undefined');
  });
  await test('Native N crosses isolated-to-MAIN request/ack and starts once with the selected label',async()=>{
    await evaluate('testKey("KeyN")');const starts=await evaluate('testStarts');assert.equal(starts.length,1);assert.equal(starts[0].activeLabelID,2);
  });
  await test('All remembered options survive actual world separation',async()=>{
    const drawing=await evaluate('testStarts[0]');assert.equal(drawing.activeShapeType,'mask');assert.equal(drawing.activeNumOfPoints,7);assert.equal(drawing.activeRectDrawingMethod,'rotated_points');assert.equal(drawing.activeInteractorParameters.box,true);
  });
  await test('During drawing the next label changes only extension storage and native N finishes the current label',async()=>{
    await evaluate(`chrome.storage.local.set({cvatSidebarShortcutsV1:CVATShortcuts.normalize({defaultLabelName:'person'})})`,executionContextId);
    await evaluate('testKey("KeyN")');assert.deepEqual(await evaluate('testFinishes'),[2]);
  });
  await test('The next native N starts with the new label without leftover request elements',async()=>{
    await evaluate('testKey("KeyN")');assert.equal(await evaluate('testStarts[1].activeLabelID'),1);
    assert.equal(await evaluate('document.querySelectorAll("[data-cvat-repeat-request]").length'),0);
  });
  await test('Label palette remains reachable during real element fullscreen and after exit',async()=>{
    await evaluate('chrome.storage.local.set({cvatLabelOverlayEnabled:true})',executionContextId);
    try{
      await evaluate('document.body.requestFullscreen()',undefined,true);await pause(120);
      assert.equal(await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');const rect=host.getBoundingClientRect();return document.fullscreenElement.contains(host)&&document.elementFromPoint(rect.x+40,rect.y+25)===host;})()`),true);
    }finally{await evaluate('document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()');await pause(120);}
    assert.equal(await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');const rect=host.getBoundingClientRect();return host.parentElement===document.documentElement&&document.elementFromPoint(rect.x+40,rect.y+25)===host;})()`),true);
  });
  await test('Popup recovery repairs hidden styles and restores a visible default panel',async()=>{
    await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');host.hidden=true;host.style.setProperty('visibility','hidden','important');host.style.left='-9999px';})()`);
    const status=await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW',recover:true})`,executionContextId);
    assert.equal(status.overlay.state,'visible');
    assert.equal(await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');const rect=host.getBoundingClientRect();return !host.hidden&&getComputedStyle(host).visibility==='visible'&&Number(getComputedStyle(host).opacity)===1&&rect.left>=0&&rect.right<=innerWidth;})()`),true);
    assert.equal(await evaluate('testState.annotation.drawing.activeLabelID'),1);
  });
  await test('Status distinguishes an intentionally closed palette from a visible one',async()=>{
    await evaluate('chrome.storage.local.set({cvatLabelOverlayEnabled:false})',executionContextId);
    assert.equal((await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_STATUS'})`,executionContextId)).overlay.state,'off');
    await evaluate('chrome.storage.local.set({cvatLabelOverlayEnabled:true})',executionContextId);
    assert.equal((await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_STATUS'})`,executionContextId)).overlay.state,'visible');
  });
  const assertInside=async()=>{
    const box=await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');const panel=host.shadowRoot.querySelector('.panel');const r=panel.getBoundingClientRect(),v=visualViewport;return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,vx:v.offsetLeft,vy:v.offsetTop,vw:v.width,vh:v.height};})()`);
    assert(box.left>=box.vx-1&&box.top>=box.vy-1&&box.right<=box.vx+box.vw+1&&box.bottom<=box.vy+box.vh+1,JSON.stringify(box));
  };
  await test('Recovery keeps the complete panel onscreen under inherited CSS zoom',async()=>{
    try{
      await evaluate(`document.documentElement.style.zoom='1.25'`);
      await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW',recover:true})`,executionContextId);
      await assertInside();
    }finally{await evaluate(`document.documentElement.style.zoom=''`);}
  });
  await test('Recovery accounts for a transformed fixed-position containing block',async()=>{
    try{
      await evaluate(`document.documentElement.style.transformOrigin='0 0';document.documentElement.style.transform='translate(80px, 45px) scale(1.2)'`);
      await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW',recover:true})`,executionContextId);
      await assertInside();
    }finally{await evaluate(`document.documentElement.style.transform='';document.documentElement.style.transformOrigin=''`);}
  });
  await test('A zoomed visual viewport fits the whole palette rather than just its title',async()=>{
    try{
      await send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
      await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW',recover:true})`,executionContextId);
      await pause(80);await assertInside();
    }finally{await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});}
  });
  await test('Visibility status does not call a half-clipped palette visible',async()=>{
    await evaluate(`chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW',recover:true})`,executionContextId);
    const state=await evaluate(`(()=>{const host=document.querySelector('#cvat-shortcuts-label-overlay');host.style.setProperty('left',(innerWidth-100)+'px','important');return chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_STATUS'});})()`,executionContextId);
    assert.equal(state.overlay.state,'outside');
  });
  await test('Previously saved offscreen coordinates and oversized dimensions are clamped on display',async()=>{
    for(const [x,y] of [[4000,3000],[-1000,-1000]]){
      await evaluate(`chrome.storage.local.set({cvatLabelOverlayV1:{x:${x},y:${y},width:1200,height:900}})`,executionContextId);
      await assertInside();
    }
  });
  await test('A smaller browser viewport automatically refits an already open palette',async()=>{
    try{
      await send('Emulation.setDeviceMetricsOverride',{width:480,height:360,deviceScaleFactor:1,mobile:false});
      await pause(100);await assertInside();
    }finally{await send('Emulation.clearDeviceMetricsOverride');}
  });
  await test('A later page layout scale change is corrected without reopening the palette',async()=>{
    try{
      await evaluate(`document.documentElement.style.zoom='1.5'`);
      await pause(600);await assertInside();
    }finally{await evaluate(`document.documentElement.style.zoom=''`);}
  });
}finally{socket?.close();child.kill();await new Promise(resolve=>server.close(resolve));}
const report={testedAt:new Date().toISOString(),suite:'Real Chrome MAIN/isolated world communication',
  environment:'Dedicated ephemeral headless Chrome; actual execution-world separation; Chrome APIs and CVAT/React state mocked; no user browser or company data',
  passed:results.filter(result=>result.passed).length,failed:results.filter(result=>!result.passed).length,results};
await writeFile(path.join(root,'tests','world-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed} execution-world tests passed, ${report.failed} failed`);
for(const result of results.filter(result=>!result.passed))console.log(`FAIL ${result.name}: ${result.error}`);
if(report.failed)process.exitCode=1;
