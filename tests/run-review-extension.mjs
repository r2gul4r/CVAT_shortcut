/* Actual MV3 popup, same-origin fetch and MAIN navigation in disposable Chrome.
 * Synthetic localhost only; host access is pregranted only in the test copy. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const labels=[{id:1,name:'A',color:'#fa7868'},{id:2,name:'B',color:'#22b573'},{id:3,name:'C',color:'#3558ed'},{id:4,name:'D',color:'#dc39d7'}];
const annotations={version:10,tags:[],tracks:[],shapes:Array.from({length:100},(_,frame)=>labels.filter(l=>!(l.id===4&&frame===45)&&!(l.id===2&&frame===12)).map(l=>({frame,label_id:l.id,type:'polygon',points:[1,2,3,4],attributes:[{value:'private-fixture-value'}]}))).flat()};
let failed=false,delay=0;const calls=[];
const html='<!doctype html><title>Review fixture</title><div class="cvat-canvas-controls-sidebar">Synthetic CVAT</div><div class="cvat-player-frame-selector"><input type="number" value="0"></div><script src="/fixture.js"></script>';
const fixtureJS=`window.state={annotation:{workspace:'Standard',drawing:{},canvas:{ready:true,instance:{mode:()=>window.mode||'idle'}},job:{instance:{id:12,dimension:'2d',startFrame:0,stopFrame:99,annotations:{hasUnsavedChanges:()=>Boolean(window.dirty)}}},player:{frame:{number:0,fetching:false}}}};
document.querySelector('.cvat-canvas-controls-sidebar').__reactFiber$fixture={memoizedProps:{store:{getState:()=>window.state}},return:null};
document.querySelector('input').addEventListener('keydown',e=>{if(e.key==='Enter')window.state.annotation.player.frame.number=Number(e.target.value);});`;
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
    calls.push({method:req.method,path:url.pathname,query:url.search,accept:req.headers.accept});res.setHeader('Content-Type','application/vnd.cvat+json');
    if(!(req.headers.accept||'').split(',').some(part=>part.trim().split(';')[0]==='application/vnd.cvat+json')){res.statusCode=406;res.end('{}');return;}
    if(failed&&url.pathname.endsWith('/annotations')){res.statusCode=503;res.end('{}');return;}
    const data=url.pathname==='/api/jobs/12'?{id:12,task_id:1,start_frame:0,stop_frame:99,dimension:'2d'}:
      url.pathname==='/api/labels'?{count:4,results:labels}:
      url.pathname.endsWith('/meta')?{start_frame:0,stop_frame:99,frame_filter:'',deleted_frames:[88],size:100}:
      url.pathname.endsWith('/annotations')?annotations:null;
    if(!data){res.statusCode=404;res.end('{}');return;}
    if(delay&&url.pathname.endsWith('/annotations'))setTimeout(()=>res.end(JSON.stringify(data)),delay);else res.end(JSON.stringify(data));
  }else if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fixtureJS);}
  else{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"require-trusted-types-for 'script'");res.end(html);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(path.join(root,'tests/.browser-profiles'),{recursive:true});const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/review-extension-'));
const fixture=path.join(profile,'extension');await cp(path.join(root,'extension'),fixture,{recursive:true});
// Diagnostics in the disposable test copy only; no new production message route.
const workerFile=path.join(fixture,'health-worker.js');
await writeFile(workerFile,(await readFile(workerFile,'utf8'))+`\nchrome.runtime.onMessage.addListener((m,s,r)=>{if(m.type!=='TEST_NAVIGATION_IDENTITY')return;chrome.tabs.get(s.tab.id).then(t=>r({senderUrl:s.url,tabUrl:t.url,documentId:s.documentId}));return true;});\n`);
const manifest=JSON.parse(await readFile(path.join(fixture,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];
manifest.permissions.push('webRequest');delete manifest.optional_permissions;
await writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
const child=spawn(process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging',
  '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const sockets=[],results=[];let port,browser,popup,extensionId,jobTab,jobPage;
async function connect(url){
  const socket=new WebSocket(url);sockets.push(socket);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let n=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  return (method,params={})=>new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
}
async function page(id){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const t=tabs.find(t=>t.id===id);assert(t);return connect(t.webSocketDebuggerUrl);}
async function evaluate(send,expression,userGesture=false){let r;try{r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});}catch(error){throw Error(error.message+' at '+expression.slice(0,160));}if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(send,expression){for(let i=0;i<100;i++){if(await evaluate(send,expression))return;await pause(60);}throw Error('Condition not reached: '+expression+'; '+await evaluate(send,'document.body.innerText'));}
async function open(){
  popup=null;
  // A closed action popup can linger in the target inventory briefly. Never attach
  // to that stale renderer when opening the next popup in the same test session.
  const previous=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t=>t.url===`chrome-extension://${extensionId}/popup.html`);
  const previousIds=new Set(previous.map(t=>t.id));
  for(const target of previous)await browser('Target.closeTarget',{targetId:target.id}).catch(()=>{});
  await browser('Extensions.triggerAction',{id:extensionId,targetId:jobTab.targetId});
  for(let i=0;i<50;i++){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();popup=tabs.find(t=>t.url===`chrome-extension://${extensionId}/popup.html`&&!previousIds.has(t.id));if(popup)break;await pause(50);}
  assert(popup,'Popup missing');const send=await page(popup.id);
  await until(send,"Boolean(document.getElementById('screen-review'))");await pause(100);return send;
}
const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
const shadow="document.getElementById('cvat-shortcuts-label-overlay').shadowRoot";
async function clickOverlay(selector){
  const point=await evaluate(jobPage,`(()=>{const el=${shadow}.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
  await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
}
async function captureOverlay(name){
  await evaluate(jobPage,`${shadow}.querySelector('.workspace-content').scrollTop=0`);
  const clip=await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('.panel').getBoundingClientRect();return {x:r.x-8,y:r.y-8,width:r.width+16,height:r.height+16,scale:1};})()`);
  const shot=await jobPage('Page.captureScreenshot',{format:'png',clip});await writeFile(path.join(root,'tests',name),Buffer.from(shot.data,'base64'));
}
try{
  const rejected=await fetch(origin+'/api/jobs/12',{headers:{Accept:'application/json'}});assert.equal(rejected.status,406);await rejected.text();calls.length=0;pass('CVAT vendor JSON fixture reproduces HTTP 406 for the old plain JSON request');
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port);const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await connect(version.webSocketDebuggerUrl);
  const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/12'});jobPage=await page(job.targetId);await until(jobPage,'Boolean(window.state)');
  ({id:extensionId}=await browser('Extensions.loadUnpacked',{path:fixture}));const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});jobTab=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/12');assert(jobTab);
  let send=await open();assert.equal(calls.length,0);pass('opening ordinary popup performs no review requests');
  await evaluate(send,"document.getElementById('screen-review').click()");
  await until(send,"document.querySelectorAll('#review-labels input').length===4");
  assert.equal(calls.length,2);assert.equal(await evaluate(send,"document.getElementById('review-run').disabled"),true);pass('review tab loads current Job label IDs and colors only on demand');
  await evaluate(send,"document.getElementById('review-all').click()");await pause(100);
  assert.equal(await evaluate(send,"document.getElementById('review-run').disabled"),true);pass('scan requires selected labels and explicit saved-work confirmation');
  await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");
  await until(send,"!document.getElementById('review-results').hidden");await pause(120);
  assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/99프레임.*2개/);
  assert.match(await evaluate(send,"document.getElementById('review-rows').innerText"),/D\s+1\s+45/);pass('real same-origin MV3 fetch reports D=45 and B=12 excluding deleted frame');
  assert(calls.every(c=>c.accept.split(',').some(part=>part.trim().split(';')[0]==='application/vnd.cvat+json')));pass('catalog and scan negotiate vendor JSON in actual Chrome extension requests');
  const stored=await evaluate(send,'chrome.storage.local.get(null)');const serialized=JSON.stringify(stored);
  assert(!serialized.includes('private-fixture-value'));assert(!serialized.includes('points'));pass('only missing summaries and chosen IDs persist; geometry and attributes do not');
  assert(calls.every(c=>c.method==='GET'));assert(calls.every(c=>['/api/jobs/12','/api/labels','/api/jobs/12/data/meta','/api/jobs/12/annotations'].includes(c.path)));pass('requests are GET metadata/annotations only; no image or write requests');
  const bounds=await evaluate(send,"(()=>{const r=document.getElementById('review-screen').getBoundingClientRect();return {left:r.left,right:r.right,width:document.documentElement.scrollWidth};})()");assert.equal(bounds.width,400);assert(bounds.right<=400);pass('review panel fits the 400px Chrome action popup');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/review-popup-preview.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate(send,"document.getElementById('review-results').scrollIntoView({block:'start'})");
  const resultImage=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/review-results-preview.png'),Buffer.from(resultImage.data,'base64'));
  await evaluate(send,"document.querySelector('#review-frames [data-frame=\"45\"]').click()");
  await until(jobPage,'window.state.annotation.player.frame.number===45');await until(send,"document.getElementById('review-status').textContent.includes('이동했어요')");pass('frame button uses normal CVAT input and confirms actual frame change across worlds');
  await evaluate(send,"document.getElementById('review-previous').click()");await until(jobPage,'window.state.annotation.player.frame.number===12');await until(send,"document.getElementById('review-status').textContent.includes('이동했어요')");pass('previous missing navigation follows actual current CVAT frame');
  await evaluate(jobPage,"window.mode='draw'");await evaluate(send,"document.getElementById('review-next').click()");await until(send,"document.getElementById('review-status').classList.contains('review-error')");assert.equal(await evaluate(jobPage,'window.state.annotation.player.frame.number'),12);pass('navigation during drawing is blocked without cancelling the tool');await evaluate(jobPage,"window.mode='idle'");

  await evaluate(send,"document.getElementById('review-none').click();document.querySelector('#review-labels input[data-label-id=\"4\"]').click()");
  assert.equal(await evaluate(send,"document.getElementById('review-find').disabled"),true);
  await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-find').click()");
  await until(send,"!document.getElementById('review-results').hidden");
  assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/찾은 프레임 98개/);
  assert.equal(await evaluate(send,"document.getElementById('review-filter-heading').textContent"),'확인할 라벨 프레임');
  assert.equal(await evaluate(send,"document.querySelectorAll('#review-frames [data-frame]').length"),30);pass('single label search shows only saved present frames with paged navigation');
  await evaluate(send,"document.getElementById('review-page-next').click()");
  assert.equal(await evaluate(send,"document.querySelector('#review-frames [data-frame=\"45\"]')===null"),true);
  await evaluate(send,"document.querySelector('#review-frames [data-frame=\"46\"]').click()");await until(jobPage,'window.state.annotation.player.frame.number===46');
  await until(send,"document.getElementById('review-status').textContent.includes('이동했어요')");
  await evaluate(send,"document.getElementById('review-previous').click()");await until(jobPage,'window.state.annotation.player.frame.number===44');
  await until(send,"document.getElementById('review-status').textContent.includes('이동했어요')");
  await evaluate(send,"document.getElementById('review-next').click()");await until(jobPage,'window.state.annotation.player.frame.number===46');
  await until(send,"document.getElementById('review-status').textContent.includes('이동했어요')");pass('presence frame click and previous/next navigation skip missing frames');
  await browser('Target.closeTarget',{targetId:popup.id});send=await open();await evaluate(send,"document.getElementById('screen-review').click()");
  await until(send,"!document.getElementById('review-results').hidden");assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/찾은 프레임 98개/);
  pass('presence result mode and chosen label survive reopening the popup');
  await evaluate(send,"document.querySelector('#review-labels input[data-label-id=\"2\"]').click();document.getElementById('review-saved').click();document.getElementById('review-find').click()");
  await until(send,"!document.getElementById('review-results').hidden");assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/찾은 프레임 99개/);
  await evaluate(send,"const filter=document.getElementById('review-filter');filter.value='2';filter.dispatchEvent(new Event('change'))");
  assert.equal(await evaluate(send,"document.querySelector('#review-frames [data-frame=\"12\"]')===null"),true);
  assert.match(await evaluate(send,"document.getElementById('review-page').textContent"),/98프레임/);pass('multiple labels use union while filter shows each label separately');
  const oldShapes=annotations.shapes;annotations.shapes=[];
  await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-find').click()");await until(send,"!document.getElementById('review-results').hidden");
  assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/찾은 프레임 0개/);
  assert.equal(await evaluate(send,"document.getElementById('review-next').disabled&&document.getElementById('review-previous').disabled"),true);
  assert.equal(await evaluate(send,"document.getElementById('review-page').textContent"),'찾은 프레임 없음');pass('empty presence result clears old frames and disables navigation');annotations.shapes=oldShapes;
  await evaluate(send,"document.getElementById('review-all').click();document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"!document.getElementById('review-results').hidden");
  assert.equal(await evaluate(send,"document.getElementById('review-filter-heading').textContent"),'확인할 누락 프레임');pass('returning to missing inspection restores missing-only result labels and counts');
  await browser('Target.closeTarget',{targetId:popup.id});send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-results').hidden");assert.equal(await evaluate(send,"document.querySelectorAll('#review-labels input:checked').length"),4);pass('Job-specific selection and last result survive closing popup');
  await evaluate(jobPage,'window.dirty=true');await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('미저장')");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('detected unsaved changes block scan instead of showing a fresh success');await evaluate(jobPage,'window.dirty=false');
  failed=true;await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('HTTP 503')");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('HTTP error hides previous success and explains failed inspection');failed=false;
  delay=1800;await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('검사 중')");await pause(300);await browser('Target.closeTarget',{targetId:popup.id});
  send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-results').hidden");pass('scan finishes and saves result while popup is closed, including reopen during scan');delay=0;
  await evaluate(send,"document.getElementById('review-load').click()");await until(send,"document.querySelectorAll('#review-labels input').length===4");await pause(200);
  await evaluate(send,"document.querySelector('#review-labels input').click()");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('changing required labels invalidates old result');
  await jobPage('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
  await evaluate(send,"document.querySelector('[data-open-workspace=review]').click()");
  await until(jobPage,`Boolean(document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('#review-labels input'))`);
  await until(jobPage,`${shadow}.querySelectorAll('#review-labels input').length===4`);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelectorAll('#review-labels input:checked').length`),3);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('[data-action=screen-review]').getAttribute('aria-selected')`),'true');pass('popup opens review in existing movable shell and preserves Job selection');
  await evaluate(jobPage,"window.overlayLeaks=0;document.addEventListener('click',()=>window.overlayLeaks++);document.addEventListener('keydown',()=>window.overlayLeaks++)");
  await clickOverlay('#review-all');await until(jobPage,`${shadow}.querySelectorAll('#review-labels input:checked').length===4`);
  await clickOverlay('#review-saved');assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#review-saved').checked`),true);
  assert.equal(await evaluate(jobPage,'window.overlayLeaks'),0);pass('trusted clicks operate review buttons and checkboxes without reaching CVAT');
  await clickOverlay('#review-run');await until(jobPage,`!${shadow}.querySelector('#review-results').hidden`);
  assert.match(await evaluate(jobPage,`${shadow}.querySelector('#review-summary').textContent`),/99프레임.*2개/);pass('overlay executes vendor JSON review and displays the same missing results');
  await clickOverlay('#review-frames [data-frame="45"]');await until(jobPage,'window.state.annotation.player.frame.number===45');
  await until(jobPage,`${shadow}.querySelector('#review-status').textContent.includes('이동했어요')`);pass('overlay frame navigation uses validated service worker MAIN bridge');
  const beforeKeys=await evaluate(jobPage,'window.overlayLeaks');
  await evaluate(jobPage,`${shadow}.querySelector('#review-filter').scrollIntoView({block:'nearest'});${shadow}.querySelector('#review-filter').focus()`);
  await jobPage('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await jobPage('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  assert.notEqual(await evaluate(jobPage,`${shadow}.querySelector('#review-filter').value`),'0');
  assert.equal(await evaluate(jobPage,'window.overlayLeaks'),beforeKeys);pass('native select keyboard changes the filter without leaking shortcuts to CVAT');
  await jobPage('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await jobPage('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await evaluate(jobPage,`(()=>{const s=${shadow}.querySelector('#review-filter');s.blur();s.value='0';s.dispatchEvent(new Event('change'));})()`);
  send=await open();await evaluate(send,"chrome.storage.local.set({cvatLabelOverlayV1:{x:450,y:45,width:600,height:650,screen:'review',view:'panel',transparency:15}})");
  const bridgeChecks=await evaluate(send,`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const values=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{const context={origin:location.origin,path:location.pathname};return Promise.all([{action:'navigate',frame:99,context:{...context,path:'/tasks/1/jobs/99'}},{action:'arbitrary',context},{action:'navigate',frame:-1,context},{action:'status',context,tabId:999999}].map(value=>chrome.runtime.sendMessage({type:'CVAT_WORKSPACE_NATIVE',...value})));}});return values[0].result;})()`);
  assert(bridgeChecks.slice(0,3).every(value=>value.error));assert.equal(bridgeChecks[3].frame,45);pass('native bridge rejects another Job, unknown actions and invalid frames, ignoring a spoofed target tab');
  await browser('Target.closeTarget',{targetId:popup.id});await pause(180);
  assert.equal(await evaluate(jobPage,`getComputedStyle(${shadow}.querySelector('#review-labels')).gridTemplateColumns.split(' ').length>=2`),true);

  await clickOverlay('#review-saved');await clickOverlay('#review-find');
  await until(jobPage,`!${shadow}.querySelector('#review-results').hidden`);
  assert.match(await evaluate(jobPage,`${shadow}.querySelector('#review-summary').textContent`),/찾은 프레임 99개/);
  await captureOverlay('workspace-label-search-preview.png');
  await evaluate(jobPage,`${shadow}.querySelector('#review-results').scrollIntoView({block:'start'})`);
  const foundShot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/workspace-label-search-results.png'),Buffer.from(foundShot.data,'base64'));
  await clickOverlay('#review-frames [data-frame="0"]');await until(jobPage,'window.state.annotation.player.frame.number===0');
  await until(jobPage,`${shadow}.querySelector('#review-status').textContent.includes('이동했어요')`);
  await clickOverlay('#review-next');await until(jobPage,'window.state.annotation.player.frame.number===1');
  await until(jobPage,`${shadow}.querySelector('#review-status').textContent.includes('이동했어요')`);
  pass('real overlay supports presence search, frame zero and next-result navigation');
  send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-results').hidden");
  assert.match(await evaluate(send,"document.getElementById('review-summary').textContent"),/찾은 프레임 99개/);pass('popup displays presence result produced in overlay');
  await browser('Target.closeTarget',{targetId:popup.id});
  await clickOverlay('#review-saved');await clickOverlay('#review-run');await until(jobPage,`!${shadow}.querySelector('#review-results').hidden`);
  await clickOverlay('#review-frames [data-frame="45"]');await until(jobPage,'window.state.annotation.player.frame.number===45');
  await until(jobPage,`${shadow}.querySelector('#review-status').textContent.includes('이동했어요')`);
  await captureOverlay('workspace-review-preview.png');
  const geometry=await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('.panel').getBoundingClientRect();return [r.x,r.y,r.width,r.height,document.getElementById('cvat-shortcuts-label-overlay').style.opacity];})()`);
  await clickOverlay('[data-action=screen-health]');await until(jobPage,`${shadow}.querySelector('#health-toggle')&&!${shadow}.querySelector('#health-toggle').disabled`);
  assert.deepEqual(await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('.panel').getBoundingClientRect();return [r.x,r.y,r.width,r.height,document.getElementById('cvat-shortcuts-label-overlay').style.opacity];})()`),geometry);pass('review grid adapts to width; switching views retains position, size and transparency');
  const beforeMonitoring=calls.length;
  await clickOverlay('#health-toggle');await until(jobPage,`${shadow}.querySelector('#health-toggle').textContent.includes('끄기')`);
  await evaluate(jobPage,"fetch('/api/jobs/12',{headers:{Accept:'application/vnd.cvat+json'}}).then(r=>r.json())");
  failed=true;await evaluate(jobPage,"fetch('/api/jobs/12/annotations',{headers:{Accept:'application/vnd.cvat+json'}}).then(r=>r.json())");failed=false;
  await until(jobPage,`${shadow}.querySelector('#health-count').textContent==='2'`);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#health-status').textContent`),'오류 감지');
  assert.equal(calls.length,beforeMonitoring+2);pass('overlay observes actual existing requests with no network probes');
  await clickOverlay('#health-alerts');await pause(150);
  send=await open();await evaluate(send,"document.getElementById('screen-health').click()");await until(send,"document.getElementById('health-count').textContent==='2'");
  assert.equal(await evaluate(send,"document.getElementById('health-alerts').checked"),false);pass('popup and overlay share monitoring statistics and alert settings');
  await browser('Target.closeTarget',{targetId:popup.id});
  await captureOverlay('workspace-health-preview.png');
  await clickOverlay('[data-action=fold]');assert.equal(await evaluate(jobPage,`${shadow}.querySelector('.launcher').hidden`),false);
  const launcher=await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('.launcher').getBoundingClientRect();return {x:r.x+15,y:r.y+15};})()`);
  await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...launcher});
  await jobPage('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:launcher.x-80,y:launcher.y+50});
  await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:launcher.x-80,y:launcher.y+50});
  await clickOverlay('.launcher');assert.equal(await evaluate(jobPage,`${shadow}.querySelector('[data-action=screen-health]').getAttribute('aria-selected')`),'true');pass('minimized launcher remains draggable and restores the active view');
  await clickOverlay('[data-action=hide]');assert.equal(await evaluate(jobPage,"document.getElementById('cvat-shortcuts-label-overlay').style.display"),'none');
  send=await open();await evaluate(send,"document.getElementById('screen-health').click()");await until(send,"document.getElementById('health-toggle').textContent.includes('끄기')");pass('close removes the whole overlay while passive monitoring continues');
  await evaluate(send,"document.querySelector('[data-open-workspace=health]').click()");await until(jobPage,"document.getElementById('cvat-shortcuts-label-overlay').style.display==='block'");
  await clickOverlay('[data-action=screen-review]');await until(jobPage,`!${shadow}.querySelector('#review-results').hidden`);pass('popup can reopen closed overlay directly into a chosen view without losing review');
  await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/99')");await pause(750);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#review-results').hidden`),true);pass('Job navigation discards the old visible report instead of showing it for another Job');
  await clickOverlay('[data-action=screen-health]');await pause(300);
  const movedHealth=await evaluate(jobPage,`${shadow}.querySelector('#health-status').textContent+' / '+${shadow}.querySelector('#health-note').textContent`);
  console.log('Health after SPA Job change:',movedHealth);
  await clickOverlay('[data-action=hide]');send=await open();
  // Opening the workspace closes the action popup. Finish popup-side diagnostics
  // first; evaluating a pending promise in its destroyed renderer can time out.
  console.log('SPA identity:',await evaluate(send,"(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const values=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>chrome.runtime.sendMessage({type:'TEST_NAVIGATION_IDENTITY'})});return values[0].result;})()"));
  await evaluate(send,"document.querySelector('[data-open-workspace=health]').click()");
  await until(jobPage,"document.getElementById('cvat-shortcuts-label-overlay').style.display==='block'");
  let popupClosed=false;
  for(let i=0;i<100;i++){const {targetInfos}=await browser('Target.getTargets');if(!targetInfos.some(t=>t.targetId===popup.id)){popupClosed=true;break;}await pause(60);}
  assert(popupClosed,'Opening workspace must close its popup');pass('workspace reopen closes popup before further checks use the live Job renderer');
  const reopenedHealth=await evaluate(jobPage,`${shadow}.querySelector('#health-status').textContent+' / '+${shadow}.querySelector('#health-note').textContent`);
  assert(!reopenedHealth.includes('상태 확인 실패'),reopenedHealth);pass('health remains available after SPA Job change and closing/reopening the overlay');
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#health-count').textContent`),'0');
  await clickOverlay('#health-toggle');await until(jobPage,`${shadow}.querySelector('#health-toggle').textContent.includes('끄기')`);
  await evaluate(jobPage,"fetch('/api/jobs/99/data/meta',{headers:{Accept:'application/vnd.cvat+json'}}).then(r=>r.json())");
  await until(jobPage,`${shadow}.querySelector('#health-count').textContent==='1'`);pass('manual monitoring starts and counts only new requests after changing Job');
  await clickOverlay('#health-alerts');await until(jobPage,`${shadow}.querySelector('#health-alerts').checked&&!${shadow}.querySelector('#health-auto').disabled`);
  await clickOverlay('#health-auto');await until(jobPage,`${shadow}.querySelector('#health-auto').checked&&!${shadow}.querySelector('#health-auto').disabled`);
  await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/42')");await pause(750);
  await until(jobPage,`${shadow}.querySelector('#health-toggle')?.textContent.includes('끄기')`);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#health-count').textContent`),'0');
  await evaluate(jobPage,"fetch('/api/jobs/42/data/meta',{headers:{Accept:'application/vnd.cvat+json'}}).then(r=>r.json())");
  await until(jobPage,`${shadow}.querySelector('#health-count').textContent==='1'`);pass('automatic monitoring follows another SPA Job while health overlay stays open');
  const beforeOffline=calls.length;await jobPage('Network.enable');
  await jobPage('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await until(jobPage,"document.getElementById('cvat-shortcuts-health-notice')?.shadowRoot.textContent.includes('네트워크 연결 끊김 감지')");
  await jobPage('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await until(jobPage,"!document.getElementById('cvat-shortcuts-health-notice')");assert.equal(calls.length,beforeOffline);pass('offline and reconnection notices still work after SPA navigation without probes');
  await evaluate(jobPage,"history.pushState({},'', '/tasks')");await pause(750);
  assert.equal(await evaluate(jobPage,"document.getElementById('cvat-shortcuts-label-overlay').style.display"),'none');
  await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/77');window.state.annotation.job.instance.id=77");await pause(750);
  await until(jobPage,`${shadow}.querySelector('#health-toggle')?.textContent.includes('끄기')`);
  assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#health-count').textContent`),'0');pass('returning through the task list restores the health overlay on the current Job');
  send=await open();const currentBridge=await evaluate(send,"(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const values=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>chrome.runtime.sendMessage({type:'CVAT_WORKSPACE_NATIVE',context:{origin:location.origin,path:location.pathname},action:'status'})});return values[0].result;})()");
  assert.equal(currentBridge.error,undefined);assert.equal(currentBridge.frame,45);pass('native review bridge accepts the current Job after multiple SPA route changes');
}catch(error){results.push({name:'Review real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/review-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant and synthetic CVAT Redux/input. No company data or personal browser. Permission prompt and deployed CVAT are not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
