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
const manifest=JSON.parse(await readFile(path.join(fixture,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];
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
  await browser('Extensions.triggerAction',{id:extensionId,targetId:jobTab.targetId});
  for(let i=0;i<50;i++){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();popup=tabs.find(t=>t.url===`chrome-extension://${extensionId}/popup.html`);if(popup)break;await pause(50);}
  assert(popup,'Popup missing');const send=await page(popup.id);await until(send,"Boolean(document.getElementById('screen-review'))");await pause(100);return send;
}
const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
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
  await browser('Target.closeTarget',{targetId:popup.id});send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-results').hidden");assert.equal(await evaluate(send,"document.querySelectorAll('#review-labels input:checked').length"),4);pass('Job-specific selection and last result survive closing popup');
  await evaluate(jobPage,'window.dirty=true');await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('미저장')");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('detected unsaved changes block scan instead of showing a fresh success');await evaluate(jobPage,'window.dirty=false');
  failed=true;await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('HTTP 503')");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('HTTP error hides previous success and explains failed inspection');failed=false;
  delay=1800;await evaluate(send,"document.getElementById('review-saved').click();document.getElementById('review-run').click()");await until(send,"document.getElementById('review-status').textContent.includes('전체 프레임 검사 중')");await pause(300);await browser('Target.closeTarget',{targetId:popup.id});
  send=await open();await evaluate(send,"document.getElementById('screen-review').click()");await until(send,"!document.getElementById('review-results').hidden");pass('scan finishes and saves result while popup is closed, including reopen during scan');delay=0;
  await evaluate(send,"document.getElementById('review-load').click()");await until(send,"document.querySelectorAll('#review-labels input').length===4");await pause(200);
  await evaluate(send,"document.querySelector('#review-labels input').click()");assert.equal(await evaluate(send,"document.getElementById('review-results').hidden"),true);pass('changing required labels invalidates old result');
  await browser('Target.closeTarget',{targetId:popup.id});
}catch(error){results.push({name:'Review real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/review-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant and synthetic CVAT Redux/input. No company data or personal browser. Permission prompt and deployed CVAT are not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
