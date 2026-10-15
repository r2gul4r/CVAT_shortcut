/* Actual extension APIs in a new, disposable Chrome profile; localhost fixtures only.
 * A separate fixture copy pregrants localhost to avoid automating permission approval.
 * The production copy is also loaded unchanged to test startup without a host grant.
 */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.statusCode=req.url.includes('failure')?503:200;res.end('{}');}
  else{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"require-trusted-types-for 'script'");res.end('<!doctype html><title>Synthetic Job</title><h1>Local health test</h1>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(path.join(root,'tests/.browser-profiles'),{recursive:true});
const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/health-extension-'));
const fixture=path.join(profile,'extension-fixture');await cp(path.join(root,'extension'),fixture,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(fixture,'manifest.json'),'utf8'));
manifest.host_permissions=['http://127.0.0.1/*'];
manifest.permissions.push('webRequest');delete manifest.optional_permissions;
await writeFile(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
const child=spawn(process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging',
  '--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps',
  '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const sockets=[],results=[];
async function connect(url){
  const socket=new WebSocket(url);sockets.push(socket);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let n=0;const pending=new Map();socket.onmessage=event=>{const m=JSON.parse(String(event.data)),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  return (method,params={})=>new Promise((resolve,reject)=>{const id=++n;const timer=setTimeout(()=>reject(Error(`Timeout: ${method}`)),10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
}
let port;
async function page(targetId){
  const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=list.find(t=>t.id===targetId);assert(target);return connect(target.webSocketDebuggerUrl);
}
async function evaluate(send,expression,userGesture=false){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
}
function pass(name){results.push({name,passed:true});console.log('PASS '+name);}
try{
  for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert(port,'Test Chrome did not start');
  const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser=await connect(version.webSocketDebuggerUrl);
  const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/12'}),jobPage=await page(job.targetId);
  for(const [directory,granted] of [[path.join(root,'extension'),false],[fixture,true]]){
    const {id}=await browser('Extensions.loadUnpacked',{path:directory});
    const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});
    const jobTab=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/12');assert(jobTab,'Synthetic tab target missing');
    await browser('Extensions.triggerAction',{id,targetId:jobTab.targetId});
    let popup;
    for(let i=0;i<40;i++){const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();popup=list.find(t=>t.url===`chrome-extension://${id}/popup.html`);if(popup)break;await pause(50);}
    assert(popup,'Action popup did not open');const popupPage=await page(popup.id);
    await popupPage('Runtime.enable');await pause(300);
    const tabId=await evaluate(popupPage,`chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url===${JSON.stringify(origin+'/tasks/1/jobs/12')})?.id)`);
    // Without a host grant the real tabs API hides the Job URL. Use a harmless arbitrary tab ID for STATUS.
    const status=await evaluate(popupPage,`chrome.runtime.sendMessage({type:'CVAT_HEALTH_STATUS',tabId:${tabId??999}})`);
    assert.equal(status.enabled,false);assert(!status.error);pass(granted?'granted extension worker responds':'unchanged manifest starts without host grant and responds');
    if(granted){
      let healthPage=popupPage;
      async function reopen(){
        await browser('Extensions.triggerAction',{id,targetId:jobTab.targetId});
        for(let i=0;i<30;i++){const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();popup=list.find(t=>t.url===`chrome-extension://${id}/popup.html`);if(popup)break;await pause(50);}
        assert(popup);healthPage=await page(popup.id);await pause(150);
        await evaluate(healthPage,"document.getElementById('screen-health').click()");await pause(150);
      }
      const statusNow=()=>evaluate(healthPage,`chrome.runtime.sendMessage({type:'CVAT_HEALTH_STATUS',tabId:${tabId}})`);
      await evaluate(healthPage,"document.getElementById('screen-health').click();document.getElementById('health-toggle').click()",true);await pause(200);
      assert.equal((await statusNow()).enabled,true);
      assert.equal(await evaluate(jobPage,"Boolean(document.getElementById('cvat-shortcuts-health'))"),false);pass('real popup starts monitoring without injecting an overlay');
      await evaluate(jobPage,"fetch('/api/jobs/12/annotations',{method:'PATCH'}).then(()=>fetch('/api/lambda/requests',{method:'POST'})).then(()=>fetch('/api/failure')).then(()=>true)");await pause(2300);
      const measured=await statusNow();assert.equal(measured.count,3);assert.equal(measured.groups.find(g=>g.kind==='save').count,1);assert.equal(measured.groups.find(g=>g.kind==='ai').count,1);
      assert.equal(await evaluate(healthPage,"document.getElementById('health-count').textContent"),'3');assert.equal(await evaluate(healthPage,"document.getElementById('health-status').textContent"),'오류 감지');pass('real save, AI and HTTP 503 requests refresh inside health popup');
      await evaluate(healthPage,"document.getElementById('screen-shortcuts').click()");assert.equal((await statusNow()).count,3);pass('switching to shortcuts keeps measurement active');
      await browser('Target.closeTarget',{targetId:popup.id});
      await evaluate(jobPage,"fetch('/api/jobs/12/annotations',{method:'PATCH'}).then(()=>true)");await pause(200);
      await reopen();assert.equal(await evaluate(healthPage,"document.getElementById('health-count').textContent"),'4');pass('requests while popup is closed appear on reopening');
      const screenshot=await healthPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/health-popup-preview.png'),Buffer.from(screenshot.data,'base64'));
      await jobPage('ServiceWorker.enable');await jobPage('ServiceWorker.stopAllWorkers');
      await evaluate(jobPage,"fetch('/api/jobs/12?after=worker-stop').then(()=>true)");await pause(300);
      assert.equal((await statusNow()).count,5);pass('webRequest wakes stopped worker without a page-side polling timer');
      await evaluate(healthPage,"document.getElementById('health-auto').click()",true);await pause(200);assert.equal((await statusNow()).auto,true);
      await browser('Target.closeTarget',{targetId:popup.id});
      await jobPage('Page.reload');await pause(600);
      await evaluate(jobPage,"fetch('/api/jobs/12/annotations',{method:'PATCH'}).then(()=>true)");await pause(200);
      await reopen();assert.equal((await statusNow()).groups.find(g=>g.kind==='save').count,1);
      assert.equal(await evaluate(jobPage,"Boolean(document.getElementById('cvat-shortcuts-health'))"),false);pass('automatic reload monitors in background without page UI');
      await jobPage('Page.navigate',{url:origin+'/tasks/1/jobs/19'});await pause(600);
      assert.equal((await statusNow()).enabled,true);pass('automatic monitoring resumes in another Job');
      const disabled=await evaluate(healthPage,`chrome.runtime.sendMessage({type:'CVAT_HEALTH_AUTO',tabId:${tabId},enabled:false})`);assert.equal(disabled.auto,false);assert.equal(disabled.enabled,false);
      await jobPage('Page.reload');await pause(600);assert.equal((await statusNow()).enabled,false);pass('automatic off remains off after real reload');
      await browser('Target.closeTarget',{targetId:popup.id});
    }
    if(!granted)await browser('Target.closeTarget',{targetId:popup.id});
    await browser('Extensions.uninstall',{id});
  }
}catch(error){results.push({name:'Real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/health-extension-results.json'),JSON.stringify({
  environment:'Dedicated real Chrome extension APIs; unchanged production manifest without grant, plus fixture-only localhost pregrant; no personal browser or company data; permission dialog not automated',
  passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results
},null,2)+'\n');
