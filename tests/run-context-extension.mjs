/* Actual MV3 reload in disposable Chrome. Run once per labels/review/health view.
 * Synthetic localhost only; never uses the personal profile or company data. */
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
await mkdir(path.join(root,'tests/.browser-profiles'),{recursive:true});const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/context-extension-'));
const fixture=path.join(profile,'extension');await cp(path.join(root,'extension'),fixture,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(fixture,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];
manifest.permissions.push('webRequest');delete manifest.optional_permissions;
await writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
const child=spawn(process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging',
  '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const screen=process.argv[2]||'labels';assert(['labels','review','health'].includes(screen));
const sockets=[],results=[],exceptions=[];let port,browser,popup,extensionId,jobTab,jobPage;
async function connect(url){
  const socket=new WebSocket(url);sockets.push(socket);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let n=0;const pending=new Map();socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  return (method,params={})=>new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
}
async function page(id){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const t=tabs.find(t=>t.id===id);assert(t);return connect(t.webSocketDebuggerUrl);}
async function evaluate(send,expression,userGesture=false){let r;try{r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});}catch(error){throw Error(error.message+' at '+expression.slice(0,160));}if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(send,expression){for(let i=0;i<100;i++){if(await evaluate(send,expression))return;await pause(60);}throw Error('Condition not reached: '+expression+'; '+await evaluate(send,'document.body.innerText'));}
async function open(){
  popup=await browser('Target.createTarget',{url:`chrome-extension://${extensionId}/popup.html`});
  popup.id=popup.targetId;const send=await page(popup.id);
  await until(send,"Boolean(document.getElementById('screen-review'))");return send;
}
async function activate(send){
  await evaluate(send,`(async()=>{const [tab]=await chrome.tabs.query({url:${JSON.stringify(origin+'/tasks/1/jobs/12')}});if(!tab)throw Error('Fixture Job not found');
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['native-repeat.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',files:['common.js','review-core.js','review-api.js','bulk-panel.js','review-popup.js','workspace-views.js','workspace-panels.js','overlay.js','paste-repeat.js','content.js']});
  })()`);
}

const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
const shadow="document.getElementById('cvat-shortcuts-label-overlay').shadowRoot";
async function clickOverlay(selector){
  const point=await evaluate(jobPage,`(()=>{const el=${shadow}.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
  await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
}
try{
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port);const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await connect(version.webSocketDebuggerUrl);
  const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/12'});jobPage=await page(job.targetId);await jobPage('Runtime.enable');await until(jobPage,'Boolean(window.state)');
  ({id:extensionId}=await browser('Extensions.loadUnpacked',{path:fixture}));const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});jobTab=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/12');assert(jobTab);
  {
    let send=await open();await activate(send);
    await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay'))");
    await browser('Target.closeTarget',{targetId:popup.id});
    await clickOverlay('[data-action=screen-'+screen+']');await pause(250);
    if(screen==='review')await until(jobPage,`${shadow}.querySelectorAll('#review-labels input').length===4`);
    if(screen==='health')await until(jobPage,`${shadow}.querySelector('#health-status').textContent==='측정 꺼짐'`);
    send=await open();await evaluate(send,"setTimeout(()=>chrome.runtime.reload(),30);true");await pause(150);
    // Old content scripts outlive an extension reload. Exercise the exact failing close call,
    // if the watchdog has not already removed the orphaned overlay.
    // Review also checks the idle timer path, without any click after reload.
    if(screen!=='review')await evaluate(jobPage,`document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('[data-action=hide]').click()`);
    await pause(650);
    assert.equal(exceptions.length,0,exceptions.join('\n'));
    assert.equal(await evaluate(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay'))"),false);
    assert.match(await evaluate(jobPage,"document.getElementById('cvat-sidebar-shortcuts-feedback')?.textContent||''"),/저장.*새로고침/);
    const count=calls.length;await pause(1100);assert.equal(calls.length,count);assert.equal(exceptions.length,0,exceptions.join('\n'));
    pass(screen+': actual extension reload retires old overlay without uncaught errors or further requests');

  }
}catch(error){results.push({name:'Extension reload lifecycle',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/context-'+screen+'-results.json'),JSON.stringify({environment:'Actual MV3 reload in disposable Chrome with synthetic localhost only.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,exceptions,results},null,2)+'\n');
