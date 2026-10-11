/* Exploratory QA: dedicated Chrome and synthetic CVAT only. Runtime files are never patched. */
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'reports', 'qa-2.1.4');
await mkdir(output, {recursive:true});
const chromePath = process.env.CVAT_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sourceCommit = execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim();
const nativeTests = await readFile(path.join(root,'tests/test-native-repeat.js'),'utf8');
const bootstrap = nativeTests.split('  async function test(name,run)')[0] + `
  async function load(src){const s=document.createElement('script');s.src=src;await new Promise((r,j)=>{s.onload=r;s.onerror=j;document.head.append(s);});}
  fixtureAPI.clear();await load('/extension/native-repeat.js');await load('/extension/content.js');await reset();
  window.qa={reset,press,settings,catalog,labels,get:()=>({mode,starts,finishes,escapes,actions}),
    overlay:()=>document.querySelector('#cvat-shortcuts-label-overlay').shadowRoot,
    setIdle:idle};
})().catch(error=>window.qaError=error.message);`;
const fixture = (await readFile(path.join(root,'tests/fixture.html'),'utf8'))
  .replace('<script src="/extension/common.js">','<script src="/reference/mousetrap-1.6.5.js"></script><script src="/extension/common.js">')
  .replace('/tests/test-content.js','/qa-bootstrap.js');
const popup = (await readFile(path.join(root,'extension/popup.html'),'utf8'))
  .replace('href="popup.css"','href="/extension/popup.css"')
  .replace('<script src="common.js" defer>', '<script src="/tests/chrome-shim.js"></script><script>window.testTabEnabled=true;</script><script src="/extension/common.js" defer>')
  .replace('src="popup.js"','src="/extension/popup.js"');
const server = createServer(async(req,res)=>{
  const route = new URL(req.url,'http://127.0.0.1').pathname;
  try{
    let data;
    if(route==='/tasks/1/jobs/10')data=fixture;
    else if(route==='/tests/popup-qa')data=popup;
    else if(route==='/qa-bootstrap.js')data=bootstrap;
    else if(/^\/(extension|tests|reference)\/[a-zA-Z0-9.-]+$/.test(route))data=await readFile(path.join(root,route.slice(1)));
    else{res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':route.endsWith('.css')?'text/css':'text/html');res.end(data);
  }catch{res.writeHead(500);res.end('Fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/qa-'));
const child=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync',
  '--disable-default-apps','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];let socket, browser;
try{
  let port;
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port,'Chrome did not start');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=tabs.find(tab=>tab.type==='page'&&tab.url==='about:blank');assert(page);
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  const pending=new Map();let sequence=0;
  socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data)),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async(expression,userGesture=false)=>{const r=await send('Runtime.evaluate',{expression,userGesture,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  browser=await send('Browser.getVersion');await send('Page.enable');await send('Runtime.enable');
  async function navigate(route='/tasks/1/jobs/10'){
    await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
    await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${route}`});
    for(let i=0;i<100;i++){
      if(await evaluate(route.includes('popup')?'Boolean(window.fixtureAPI && !document.querySelector("#ai-assign").disabled)':'Boolean(window.qa)'))return;
      await pause(30);
    }
    throw new Error('Fixture not ready: '+await evaluate('window.qaError'));
  }
  const rect=selector=>evaluate(`(()=>{const e=qa.overlay().querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
  async function click(selector){const r=await rect(selector),x=r.x+r.width/2,y=r.y+r.height/2;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await pause(30);}
  async function drag(selector,dx,dy){const r=await rect(selector),x=r.x+r.width/2,y=r.y+r.height/2;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1});await pause(30);}
  async function test(id,name,run){try{await navigate();const evidence=await run();results.push({id,name,passed:true,evidence});}catch(error){results.push({id,name,passed:false,error:error.message});}console.log(`${results.at(-1).passed?'PASS':'FAIL'} ${id}: ${name}`);}
  async function screenshot(name){const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,name),Buffer.from(data,'base64'));}

  await test('E01','Real mouse selection and drag retain the selected next-object label',async()=>{
    await click('.choice[value="obstacle"]');
    assert.equal(await evaluate('fixtureAPI.read().cvatSidebarShortcutsV1.defaultLabelName'),'obstacle');
    const before=await rect('.panel');await drag('.drag',120,-70);const after=await rect('.panel');
    assert(Math.abs(after.x-before.x-120)<2&&Math.abs(after.y-before.y+70)<2);
    return {before,after};
  });
  await test('E02','Minimized launcher moves with real mouse input and restores its panel',async()=>{
    await click('[data-action="fold"]');const before=await rect('.launcher');await drag('.launcher',100,-40);const after=await rect('.launcher');
    assert(Math.abs(after.x-before.x-100)<2);assert(await evaluate('qa.overlay().querySelector(".panel").hidden'));
    await click('.launcher');assert(!(await evaluate('qa.overlay().querySelector(".panel").hidden')));return {before,after};
  });
  await test('E03','Real opacity-slider input persists across the refresh timer',async()=>{
    await click('input[type="range"]');await pause(650);
    const value=await evaluate('({stored:fixtureAPI.read().cvatLabelOverlayV1.transparency,slider:Number(qa.overlay().querySelector("input").value),opacity:getComputedStyle(document.querySelector("#cvat-shortcuts-label-overlay")).opacity})');
    assert(value.stored>0&&value.slider===value.stored);assert(Math.abs(Number(value.opacity)-(1-value.stored/100))<.001);return value;
  });
  await test('E04','A large catalog scrolls inside the palette and selects its last entry',async()=>{
    const timing=await evaluate(`(()=>{const start=performance.now();qa.catalog.innerHTML='<div class="cvat-objects-sidebar-labels-list-header">Items: 1000</div>';for(let i=0;i<1000;i++){const row=document.createElement('div');row.className='cvat-objects-sidebar-label-item';const t=document.createElement('span');t.className='cvat-text';t.textContent='label-'+i;row.append(t);qa.catalog.append(row);}return performance.now()-start;})()`);
    await pause(650);assert.equal(await evaluate('qa.overlay().querySelectorAll(".choice").length'),1000);
    await evaluate('qa.overlay().querySelector(".list").scrollTop=100000');await click('.choice[value="label-999"]');
    assert.equal(await evaluate('fixtureAPI.read().cvatSidebarShortcutsV1.defaultLabelName'),'label-999');return {labelCount:1000,fixtureConstructionMs:timing};
  });
  await test('E05','A short visible viewport retains a usable label-list area',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:800,height:240,deviceScaleFactor:1,mobile:false});await pause(650);
    const evidence=await evaluate(`(()=>{const r=qa.overlay(),list=r.querySelector('.list'),p=r.querySelector('.panel').getBoundingClientRect();return {viewportHeight:visualViewport.height,panelHeight:p.height,listHeight:list.clientHeight,choices:list.children.length};})()`);
    await screenshot('short-viewport.png');assert(evidence.listHeight>=30,JSON.stringify(evidence));return evidence;
  });
  await test('E06','A transient overlay preference read error preserves the saved off switch',async()=>{
    const evidence=await evaluate(`(async()=>{await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'});await chrome.storage.local.set({cvatLabelOverlayEnabled:false});const original=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=async key=>{if(key==='cvatLabelOverlayV1')throw new Error('Injected geometry read failure');return original(key);};const temp=CVATLabelOverlay.create({shared:CVATShortcuts,getState:()=>({supported:true,path:location.pathname,selected:'person',shortcuts:[],catalog:{state:'ready',labels:[{name:'person',duplicate:false}]}}),onSelect:()=>{}});temp.enable();await new Promise(r=>setTimeout(r,20));chrome.storage.local.get=original;const result={savedEnabled:fixtureAPI.read().cvatLabelOverlayEnabled,status:temp.status()};temp.destroy();return result;})()`);
    assert.equal(evidence.status.state,'off',JSON.stringify(evidence));return evidence;
  });
  await test('E07','Concurrent settings updates do not overwrite another context shortcut change',async()=>{
    await navigate('/tests/popup-qa');
    const evidence=await evaluate(`(async()=>{const original=chrome.storage.local.get.bind(chrome.storage.local);let release;const gate=new Promise(r=>release=r);chrome.storage.local.get=async key=>{const snapshot=await original(key);if(key==='cvatSidebarShortcutsV1')await gate;return snapshot;};const pan=document.querySelector('#pan-enabled');pan.checked=false;pan.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));const latest=fixtureAPI.read().cvatSidebarShortcutsV1;await chrome.storage.local.set({cvatSidebarShortcutsV1:{...latest,shortcuts:{...latest.shortcuts,ai:{code:'KeyQ'}}}});release();await new Promise(r=>setTimeout(r,30));chrome.storage.local.get=original;return {requestedShortcut:'KeyQ',savedShortcut:fixtureAPI.read().cvatSidebarShortcutsV1.shortcuts.ai.code,spacePan:fixtureAPI.read().cvatSidebarShortcutsV1.spacePan};})()`);
    assert.equal(evidence.savedShortcut,'KeyQ',JSON.stringify(evidence));return evidence;
  });
  await test('E08','Known deferred N assignment completes the active AI rather than restarting it',async()=>{
    await evaluate('qa.settings({shortcuts:{ai:{code:"KeyN"},brush:{code:"KeyB"}}})');
    await evaluate('qa.press("KeyN")');await pause(350);
    await evaluate('qa.press("KeyN")');await pause(350);
    const evidence=await evaluate('qa.get()');assert.equal(evidence.finishes.length,1,JSON.stringify(evidence));return evidence;
  });
  await test('E09','Popup displays a storage-write failure without claiming a saved shortcut',async()=>{
    await navigate('/tests/popup-qa');
    const evidence=await evaluate(`(async()=>{const before=fixtureAPI.read().cvatSidebarShortcutsV1?.shortcuts?.ai||null;fixtureAPI.failWrite(true);document.querySelector('#ai-assign').click();document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyQ',key:'q',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,30));return {before,notice:document.querySelector('#notice').textContent,error:document.querySelector('#notice').classList.contains('error'),saved:fixtureAPI.read().cvatSidebarShortcutsV1?.shortcuts?.ai||null};})()`);
    assert(evidence.error,JSON.stringify(evidence));assert.deepEqual(evidence.saved,evidence.before);return evidence;
  });
  await test('E10','Labels remain available when their source tab unmounts within the same job',async()=>{
    const before=await evaluate('qa.overlay().querySelectorAll(".choice").length');await evaluate('qa.catalog.remove()');await pause(650);
    const evidence=await evaluate(`({choices:qa.overlay().querySelectorAll('.choice').length,hint:qa.overlay().querySelector('footer').textContent})`);
    assert.equal(evidence.choices,before,JSON.stringify(evidence));return evidence;
  });
  await test('E11','Real edge drag changes width without triggering a tool or annotation action',async()=>{
    const before=await rect('.panel');await drag('[data-edge="e"]',190,0);const after=await rect('.panel');
    assert(Math.abs(after.width-before.width-190)<2);const state=await evaluate('qa.get()');assert.equal(state.starts.length,0);return {before,after};
  });
  await test('E12','Clicking close hides the launcher and persists the off switch',async()=>{
    await click('[data-action="hide"]');
    const evidence=await evaluate(`({enabled:fixtureAPI.read().cvatLabelOverlayEnabled,display:getComputedStyle(document.querySelector('#cvat-shortcuts-label-overlay')).display})`);
    assert.equal(evidence.enabled,false);assert.equal(evidence.display,'none');return evidence;
  });
  await test('E13','Route change to an unsupported page hides the palette and leaves tool keys native',async()=>{
    await evaluate(`history.replaceState({},'', '/tasks');qa.press('KeyV')`);await pause(650);
    const evidence=await evaluate(`({display:getComputedStyle(document.querySelector('#cvat-shortcuts-label-overlay')).display,starts:qa.get().starts.length})`);
    assert.equal(evidence.display,'none');assert.equal(evidence.starts,0);return evidence;
  });
  await test('E14','Label names are rendered as literal text instead of HTML',async()=>{
    await evaluate(`qa.catalog.querySelector('.cvat-text').textContent='<img src=x onerror=alert(1)>'`);await pause(650);
    const evidence=await evaluate(`({name:qa.overlay().querySelector('.choice .name').textContent,images:qa.overlay().querySelectorAll('img').length})`);
    assert.equal(evidence.name,'<img src=x onerror=alert(1)>');assert.equal(evidence.images,0);return evidence;
  });
  await test('E15','Failure feedback remains inside the active element-fullscreen subtree',async()=>{
    try{
      await evaluate(`(()=>{const stage=document.createElement('div');stage.id='fullscreen-stage';stage.style.background='white';while(document.body.firstChild)stage.append(document.body.firstChild);document.body.append(stage);return stage.requestFullscreen();})()`,true);
      await pause(100);await evaluate(`qa.settings({labelShortcuts:[{name:'missing-label',shortcut:{code:'KeyX'}}]})`);await evaluate(`qa.press('KeyX')`);
      const evidence=await evaluate(`(()=>{const toast=document.querySelector('#cvat-sidebar-shortcuts-feedback');return {fullscreen:document.fullscreenElement?.id,toastExists:Boolean(toast),toastInsideFullscreen:document.fullscreenElement.contains(toast),message:toast?.textContent};})()`);
      await screenshot('fullscreen-feedback.png');assert(evidence.toastInsideFullscreen,JSON.stringify(evidence));return evidence;
    }finally{await evaluate('document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()');}
  });
}finally{socket?.close();child.kill();await new Promise(resolve=>server.close(resolve));}
const report={version:'2.1.4',sourceCommit,testedAt:new Date().toISOString(),browser,
  scope:'Separate headless Chrome, real mouse input for E01-E04/E11/E12, synthetic CVAT and Chrome APIs. No company data or installed-extension integration.',
  passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
await writeFile(path.join(output,'exploratory-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.passed} passed, ${report.failed} failed`);
if(report.failed)process.exitCode=1;
