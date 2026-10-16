/* Actual MV3 popup, same-origin fetch and MAIN navigation in disposable Chrome.
 * Synthetic HTTP hostname mapped to loopback; access is granted in test copy only. */
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
const fixtureJS=await readFile(path.join(root,'tests/bulk-fixture.js'),'utf8');
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
// A mapped HTTP hostname is intentionally NOT a secure context, unlike localhost.
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://cvat-http.test:${server.address().port}`;
await mkdir(path.join(root,'tests/.browser-profiles'),{recursive:true});const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/bulk-extension-'));
const fixture=path.join(profile,'extension');await cp(path.join(root,'extension'),fixture,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(fixture,'manifest.json'),'utf8'));manifest.host_permissions=['http://cvat-http.test/*'];
manifest.permissions.push('webRequest');delete manifest.optional_permissions;
await writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
const child=spawn(process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging',
  '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--no-proxy-server','--host-resolver-rules=MAP cvat-http.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
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
async function captureOverlay(name,scroll=0){
  await evaluate(jobPage,`${shadow}.querySelector('.workspace-content').scrollTop=${scroll}`);
  const clip=await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('.panel').getBoundingClientRect();return {x:r.x-8,y:r.y-8,width:r.width+16,height:r.height+16,scale:1};})()`);
  const shot=await jobPage('Page.captureScreenshot',{format:'png',clip});await writeFile(path.join(root,'tests',name),Buffer.from(shot.data,'base64'));
}
try{
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port);const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await connect(version.webSocketDebuggerUrl);
  const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/12'});jobPage=await page(job.targetId);await jobPage('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await until(jobPage,'Boolean(window.bulkFixture)');
  assert.deepEqual(await evaluate(jobPage,'[isSecureContext,typeof crypto.randomUUID,typeof crypto.getRandomValues]'),[false,'undefined','function']);pass('HTTP fixture reproduces LAN secure-context restrictions without mocked crypto');
  ({id:extensionId}=await browser('Extensions.loadUnpacked',{path:fixture}));const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});jobTab=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/12');assert(jobTab);
  let send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"document.querySelectorAll('#review-labels input').length===4&&!document.getElementById('review-load').disabled");
  await evaluate(send,"document.getElementById('review-all').click();document.getElementById('review-saved').click();document.getElementById('review-run').click()");
  await until(send,"!document.getElementById('review-results').hidden");assert.equal(await evaluate(send,"document.getElementById('review-edit-missing')===null"),true);await evaluate(send,"document.getElementById('review-mode-bulk').click()");await until(send,"document.querySelectorAll('#bulk-labels input').length===4");
  assert.equal(await evaluate(send,"document.getElementById('bulk-frames').value"),'');pass('missing frame results stay separate from existing-label editing');
  assert.equal(await evaluate(send,"document.getElementById('review-inspection').hidden"),true);pass('popup switches from inspection to bulk editing within the review screen');
  await evaluate(send,"document.querySelectorAll('#bulk-labels input')[0].click();document.getElementById('bulk-scan').click()");await until(send,"!document.getElementById('bulk-scan-results').hidden");
  assert.deepEqual(await evaluate(send,"Array.from(document.querySelectorAll('#bulk-found-frames span'),e=>e.textContent)"),['1','3','5']);pass('independent scan lists frames where the selected label exists on insecure HTTP');
  await evaluate(send,"document.getElementById('bulk-frames').value='1,3';document.getElementById('bulk-frames').dispatchEvent(new Event('input'));document.getElementById('bulk-preview').click()");
  await until(send,"!document.getElementById('bulk-confirmation').hidden");
  assert.match(await evaluate(send,"document.getElementById('bulk-summary').textContent"),/총 2개/);
  assert.equal(await evaluate(send,"document.getElementById('bulk-apply').disabled"),true);assert.equal(await evaluate(jobPage,'bulkFixture.mutations()'),0);pass('preview reports selected class and numbered frames without editing; confirmation required');
  await evaluate(send,"document.getElementById('bulk-confirm').click();document.getElementById('bulk-apply').click()");await until(send,"document.getElementById('bulk-status').textContent.includes('2개 삭제 완료')");
  assert.deepEqual(await evaluate(jobPage,'bulkFixture.read().filter(r=>r.removed).map(r=>r.id)'),[11,12]);assert.equal(await evaluate(jobPage,'bulkFixture.dirty()'),true);
  assert(calls.every(c=>c.method==='GET'));pass('delete changes only intended native objects and leaves CVAT save to the user');
  await evaluate(jobPage,'bulkFixture.save()');
  await evaluate(send,"document.getElementById('bulk-scan').click()");await until(send,"!document.getElementById('bulk-edit-options').hidden");
  await evaluate(send,"document.getElementById('bulk-operation').value='relabel';document.getElementById('bulk-operation').dispatchEvent(new Event('change'));document.getElementById('bulk-target').value='2';document.getElementById('bulk-target').dispatchEvent(new Event('change'));document.getElementById('bulk-scope').value='all';document.getElementById('bulk-scope').dispatchEvent(new Event('change'));document.getElementById('bulk-preview').click()");
  await until(send,"!document.getElementById('bulk-confirmation').hidden");await evaluate(send,"document.getElementById('bulk-confirm').click();document.getElementById('bulk-apply').click()");
  await until(send,"document.getElementById('bulk-status').textContent.includes('1개 라벨 변경 완료')");
  assert.deepEqual(await evaluate(jobPage,'bulkFixture.read().find(r=>r.id===14).points'),[0,0,3,0,3,3]);assert.equal(await evaluate(jobPage,'bulkFixture.read().find(r=>r.id===14).label_id'),2);pass('whole Job relabel keeps object ID and geometry');
  await evaluate(jobPage,'bulkFixture.reset()');await evaluate(send,"document.querySelector('[data-open-workspace=review]').click()");await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay'))");
  await until(jobPage,`!${shadow}.querySelector('#review-load').disabled`);
  await clickOverlay('#review-mode-bulk');await until(jobPage,`${shadow}.querySelectorAll('#bulk-labels input').length===4`);
  await clickOverlay('#bulk-labels input[data-label-id="1"]');await clickOverlay('#bulk-scan');await until(jobPage,`!${shadow}.querySelector('#bulk-edit-options').hidden`);await clickOverlay('#bulk-frames');
  await jobPage('Input.insertText',{text:'3,5'});assert.equal(await evaluate(jobPage,`${shadow}.querySelector('#bulk-frames').value`),'3,5');pass('overlay text input accepts frame lists without triggering CVAT keys');
  await clickOverlay('#bulk-preview');await until(jobPage,`!${shadow}.querySelector('#bulk-confirmation').hidden`);assert.match(await evaluate(jobPage,`${shadow}.querySelector('#bulk-summary').textContent`),/총 2개/);
  await clickOverlay('#bulk-confirm');await clickOverlay('#bulk-apply');await until(jobPage,`${shadow}.querySelector('#bulk-status').textContent.includes('2개 삭제 완료')`);
  assert.deepEqual(await evaluate(jobPage,'bulkFixture.read().filter(r=>r.removed).map(r=>r.id)'),[12,14]);pass('overlay performs confirmed range deletion through the validated MAIN bridge');
  await evaluate(jobPage,'bulkFixture.reset()');
  send=await open();const result=await evaluate(send,`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const values=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{const context={origin:location.origin,path:location.pathname};return Promise.all([{context:{...context,path:'/tasks/1/jobs/999'},request:{action:'catalog'}},{context,request:{action:'wipe'}},{context,request:{action:'apply',token:'unknown',confirm:true}}].map(value=>chrome.runtime.sendMessage({type:'CVAT_WORKSPACE_BULK',...value})));}});return values[0].result;})()`);
  assert(result.every(r=>r.error));assert.equal(await evaluate(jobPage,'bulkFixture.mutations()'),0);pass('bridge rejects wrong Job, unknown action, and forged apply token');
  await evaluate(send,"chrome.storage.local.set({cvatLabelOverlayV1:{x:400,y:30,width:600,height:750,view:'panel',screen:'review',transparency:0}})");await browser('Target.closeTarget',{targetId:popup.id});
  await clickOverlay('#bulk-scan');await until(jobPage,`!${shadow}.querySelector('#bulk-edit-options').hidden`);await clickOverlay('#bulk-frames');await jobPage('Input.insertText',{text:'3,5'});
  await clickOverlay('#bulk-preview');await until(jobPage,`!${shadow}.querySelector('#bulk-confirmation').hidden`);
  await captureOverlay('workspace-bulk-preview.png');
  await captureOverlay('workspace-bulk-confirmation.png',10000);
  await evaluate(jobPage,'bulkFixture.records()[1].label_id=2');await clickOverlay('#bulk-confirm');await clickOverlay('#bulk-apply');await until(jobPage,`${shadow}.querySelector('#bulk-status').classList.contains('review-error')`);assert.equal(await evaluate(jobPage,'bulkFixture.mutations()'),0);pass('changes after preview stop application before mutation');
  await evaluate(jobPage,'bulkFixture.reset()');send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"document.querySelectorAll('#review-labels input').length===4&&!document.getElementById('review-load').disabled");
  await evaluate(send,"document.getElementById('review-all').click();document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"!document.getElementById('review-results').hidden");
  await evaluate(send,"document.getElementById('review-mode-bulk').click()");await until(send,"document.querySelectorAll('#bulk-labels input').length===4");
  await evaluate(send,"document.querySelector('#bulk-labels input').click();document.getElementById('bulk-scan').click()");await until(send,"!document.getElementById('bulk-edit-options').hidden");
  await evaluate(send,"document.getElementById('bulk-frames').value='1';document.getElementById('bulk-frames').dispatchEvent(new Event('input'));document.getElementById('bulk-preview').click()");await until(send,"!document.getElementById('bulk-confirmation').hidden");
  await evaluate(jobPage,"bulkFixture.pauseGet=()=>new Promise(resolve=>{window.bulkRelease=()=>{bulkFixture.pauseGet=null;resolve();};})");
  await evaluate(send,"document.getElementById('bulk-confirm').click();document.getElementById('bulk-apply').click()");await until(jobPage,'Boolean(window.bulkRelease)');
  await evaluate(send,"document.getElementById('review-mode-inspect').click()");assert.equal(await evaluate(send,"document.getElementById('review-inspection').hidden"),true);
  const reportKey=`cvatReviewReportV1:${origin}/tasks/1/jobs/12`;assert.equal(await evaluate(send,`(async()=>{const data=await chrome.storage.local.get(${JSON.stringify(reportKey)});return data[${JSON.stringify(reportKey)}].state;})()`),'idle');
  await browser('Target.closeTarget',{targetId:popup.id});await evaluate(jobPage,'window.bulkRelease()');await until(jobPage,"bulkFixture.mutations()===1&&!document.getElementById('cvat-shortcuts-bulk-busy')");
  assert.deepEqual(await evaluate(jobPage,'bulkFixture.read().filter(r=>r.removed).map(r=>r.id)'),[11]);pass('closing popup during apply leaves review invalidated and completes only the confirmed object');
  await evaluate(jobPage,`bulkFixture.reset(Array.from({length:50},(_,i)=>({id:100+i,clientID:100+i,objectType:'shape',frame:10+i,label_id:1,type:'polygon',points:[0,0,1,1],attributes:[]})))`);
  send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-load').disabled");await evaluate(send,"document.getElementById('review-mode-bulk').click()");await until(send,"document.querySelectorAll('#bulk-labels input').length===4");
  await evaluate(send,"document.querySelector('#bulk-labels input').click();document.getElementById('bulk-scan').click()");await until(send,"!document.getElementById('bulk-scan-results').hidden");
  assert.equal(await evaluate(send,"document.querySelectorAll('#bulk-found-frames span').length"),30);await evaluate(send,"document.getElementById('bulk-page-next').click()");assert.equal(await evaluate(send,"document.querySelectorAll('#bulk-found-frames span').length"),23);assert.equal(await evaluate(send,"document.getElementById('bulk-page-next').disabled"),true);pass('large present-frame results paginate in groups of 30 without losing frames');
  await evaluate(send,"document.querySelector('#bulk-labels input[data-label-id=\"1\"]').click();document.querySelector('#bulk-labels input[data-label-id=\"4\"]').click()");assert.equal(await evaluate(send,"document.getElementById('bulk-edit-options').hidden"),true);assert.equal(await evaluate(send,"document.getElementById('bulk-preview').disabled"),true);pass('changing source labels invalidates scan and prevents stale preview');
  await evaluate(send,"document.getElementById('bulk-scan').click()");await until(send,"!document.getElementById('bulk-scan-results').hidden");assert.match(await evaluate(send,"document.getElementById('bulk-scan-summary').textContent"),/프레임 0개 · 객체 0개/);assert.equal(await evaluate(send,"document.getElementById('bulk-edit-options').hidden"),true);pass('empty label scan shows no matches and hides edit controls');
}catch(error){results.push({name:'Bulk real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/bulk-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3; insecure HTTP cvat-http.test resolved to 127.0.0.1, synthetic native CVAT model. No company data or actual deployed CVAT.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
