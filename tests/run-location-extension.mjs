/* Actual MV3 shortcut assignment/injection in disposable Chrome, synthetic CVAT only. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,cp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const base=(await readFile(path.join(root,'tests/fixture.html'),'utf8'))
 .replace(/<script src="\/(tests\/chrome-shim|extension\/common|extension\/overlay)\.js"><\/script>/g,'')
 .replace('<script src="/tests/label-fixture.js"></script>','<script src="/tests/new-shapes-fixture.js"></script><script src="/tests/label-fixture.js"></script>')
 .replace('<script src="/tests/test-content.js"></script>','<script src="/driver.js"></script>');
const driver=(await readFile(path.join(root,'tests/view-fixture.js'),'utf8'))+'\n'+(await readFile(path.join(root,'tests/location-fixture.js'),'utf8'))+'\nwindow.ready=true;';
const sourceFiles=new Map();for(const name of ['new-shapes-fixture.js','label-fixture.js'])sourceFiles.set('/tests/'+name,await readFile(path.join(root,'tests',name),'utf8'));
const server=createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');if(url.pathname==='/driver.js'){res.setHeader('Content-Type','text/javascript');res.end(driver);}else if(sourceFiles.has(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(sourceFiles.get(url.pathname));}else if(url.pathname.startsWith('/api/')){res.statusCode=404;res.end('{}');}else{res.setHeader('Content-Type','text/html');res.end(base);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(path.join(root,'tests/.browser-profiles'),{recursive:true});const profile=await mkdtemp(path.join(root,'tests/.browser-profiles/new-shapes-'));
const extension=path.join(profile,'extension');await cp(path.join(root,'extension'),extension,{recursive:true});
// Only the disposable fixture receives localhost permission. Production remains activeTab only.
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const child=spawn(process.env.CVAT_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
 '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
const sockets=[],results=[];let port,browser,popup,jobPage,jobTarget,extensionId;
async function connect(url){const socket=new WebSocket(url);sockets.push(socket);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});let n=0;const waiting=new Map();socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=waiting.get(m.id);if(p){waiting.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};return(method,params={})=>new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Timeout: '+method));},10000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function page(id){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=tabs.find(t=>t.id===id);assert(target);return connect(target.webSocketDebuggerUrl);}
async function evaluate(send,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(send,expression){for(let i=0;i<100;i++){if(await evaluate(send,expression))return;await pause(50);}throw Error('Condition not reached: '+expression);}
async function open(){await browser('Extensions.triggerAction',{id:extensionId,targetId:jobTarget.targetId});for(let i=0;i<100;i++){const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();popup=tabs.find(t=>t.url===`chrome-extension://${extensionId}/popup.html`);if(popup)break;await pause(50);}assert(popup);const send=await page(popup.id);await until(send,"document.readyState==='complete'&&document.getElementById('rectangle-assign')&&!document.getElementById('rectangle-assign').disabled");return send;}
async function key(send,code,keyName){await send('Input.dispatchKeyEvent',{type:'keyDown',key:keyName,code,windowsVirtualKeyCode:keyName.toUpperCase().charCodeAt(0)});await send('Input.dispatchKeyEvent',{type:'keyUp',key:keyName,code,windowsVirtualKeyCode:keyName.toUpperCase().charCodeAt(0)});}
async function clickOverlay(name){const p=await evaluate(jobPage,`(()=>{const s=document.getElementById('cvat-shortcuts-label-overlay').shadowRoot;const b=[...s.querySelectorAll('.choice')].find(n=>n.textContent.includes(${JSON.stringify(name)}));b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});await evaluate(jobPage,'document.body.focus()');}
const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
try{
 for(let i=0;i<100;i++){try{port=+(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}assert(port);
 const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await connect(version.webSocketDebuggerUrl);
 const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/18'});jobPage=await page(job.targetId);await until(jobPage,'window.ready');
 ({id:extensionId}=await browser('Extensions.loadUnpacked',{path:extension}));const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});jobTarget=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/18');assert(jobTarget);

 let send=await open();
 const selectedBefore=await evaluate(send,"chrome.storage.local.get('cvatSidebarShortcutsV1').then(x=>x.cvatSidebarShortcutsV1?.defaultLabelName)");
 await evaluate(send,"document.getElementById('enable').click()");
 await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('[data-location=reload]:not(:disabled)'))");
 pass('actual popup injects both display worlds and connects the Job catalog');
 await browser('Target.closeTarget',{targetId:popup.id});await pause(100);
 const shadow="document.getElementById('cvat-shortcuts-label-overlay').shadowRoot";
 async function click(selector){
   const p=await evaluate(jobPage,`(()=>{const b=${shadow}.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});
   await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});
 }


 await click('[data-action="screen-view"]');
 await until(jobPage,`${shadow}.querySelector('[data-location="value"]').options.length===3`);
 assert.deepEqual(await evaluate(jobPage,`[...${shadow}.querySelector('[data-location="value"]').options].map(o=>o.value)`),['','tag','sticker']);
 pass('screen panel loads actual location choices from the active Job');
 async function choose(value){await evaluate(jobPage,`${shadow}.querySelector('[data-location="value"]').value=${JSON.stringify(value)};${shadow}.querySelector('[data-location="value"]').dispatchEvent(new Event('change',{bubbles:true}))`);}
 await choose('sticker');await click('[data-location="scan"]');
 await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('변경 2개')`);
 assert.equal(await evaluate(jobPage,'locationFixture.count()'),0);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-location="results"]').textContent.includes('Tag → Sticker')`));
 pass('trusted preview includes all Job frames and preserves original per-label value spelling');
 const before=await evaluate(jobPage,'JSON.stringify(locationFixture.records())');
 const shot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/location-preview.png'),Buffer.from(shot.data,'base64'));
 await click('[data-location="apply"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('2개를 sticker')`);
 const after=await evaluate(jobPage,'locationFixture.records()'),original=JSON.parse(before);
 assert.equal(after[0].attributes[11],'sticker');assert.equal(after[3].attributes[31],'Sticker');
 for(const index of [0,3]){after[index].attributes=original[index].attributes;after[index].source=original[index].source;}assert.deepEqual(after,original);
 pass('trusted apply changes location only and preserves coordinates group other attributes and boxes');
 await click('[data-location="scan"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('변경 0개')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-location="apply"]').disabled`));
 pass('already equal skeletons are not saved again');
 await choose('tag');await click('[data-location="scan"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('변경 3개')`);
 await evaluate(jobPage,'locationFixture.records()[0].lock=true');await click('[data-location="apply"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('다시 검사')`);
 assert.equal(await evaluate(jobPage,'locationFixture.count()'),2);
 pass('changed locks invalidate a pending location edit without writing');
 await evaluate(jobPage,'locationFixture.records()[0].lock=false');await click('[data-location="scan"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('변경 3개')`);
 await click('[data-location="apply"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('3개를 tag')`);
 assert.deepEqual(await evaluate(jobPage,'locationFixture.records().filter(o=>o.type==="skeleton").map(o=>o.attributes[11]||o.attributes[31])'),['tag','tag','Tag']);
 pass('tag can be applied back to all three skeletons across the Job');
 await choose('sticker');await click('[data-location="scan"]');await until(jobPage,`${shadow}.querySelector('[data-location="status"]').textContent.includes('변경 3개')`);
 await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/19');locationFixture.a.job.instance={...locationFixture.job,id:19}");await pause(1000);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-location="apply"]').disabled`));
 assert.equal(await evaluate(jobPage,`${shadow}.querySelector('[data-location="value"]').value`),'');
 pass('Job navigation clears the old preview and chosen location');
}catch(error){results.push({name:'Location real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/location-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant, synthetic CVAT DOM. No company data or personal browser; deployed CVAT/OpenCV initialization not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
