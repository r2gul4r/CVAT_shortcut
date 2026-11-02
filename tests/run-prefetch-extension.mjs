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
const driver=(await readFile(path.join(root,'tests/view-fixture.js'),'utf8'))+'\n'+(await readFile(path.join(root,'tests/location-fixture.js'),'utf8'))+'\n'+"\nObject.assign(locationFixture.job,{type:'annotation',dataChunkSize:2,dataChunkType:'imageset'});\nwindow.prefetchCalls=0;\nlocationFixture.job.frames.frameNumbers=async()=>Array.from({length:10},(_,i)=>i);\nwindow.originalChunk=locationFixture.job.frames.chunk=async(index,quality)=>{prefetchCalls++;const response=await fetch('/api/jobs/18/data?type=chunk&number='+index+'&quality='+quality);if(!response.ok)throw Error('HTTP '+response.status);return response.arrayBuffer();};\nwindow.consumeFrame=async(frame)=>{locationFixture.a.player.frame.number=frame;const data=await locationFixture.job.frames.chunk(Math.floor(frame/2),'compressed');const result=[...new Uint8Array(data)];structuredClone(data,{transfer:[data]});return result;};\nwindow.ready=true;\n";;
const sourceFiles=new Map();for(const name of ['new-shapes-fixture.js','label-fixture.js'])sourceFiles.set('/tests/'+name,await readFile(path.join(root,'tests',name),'utf8'));
const server=createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');if(url.pathname==='/driver.js'){res.setHeader('Content-Type','text/javascript');res.end(driver);}else if(sourceFiles.has(url.pathname)){res.setHeader('Content-Type','text/javascript');res.end(sourceFiles.get(url.pathname));}else if(url.pathname==='/api/jobs/18/data'){res.setHeader('Content-Type','application/octet-stream');setTimeout(()=>res.end(Buffer.from([Number(url.searchParams.get('number')),22,33,44])),50);}else if(url.pathname.startsWith('/api/')){res.statusCode=404;res.end('{}');}else{res.setHeader('Content-Type','text/html');res.end(base);}});
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
 await evaluate(jobPage,'globalThis.__cvatShortcutsGroupV1=true;delete globalThis.CVATBatchNativeContext;true');
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

 await until(jobPage,`${shadow}.querySelector('[data-prefetch="start"]:not(:disabled)')`);
 pass('screen panel is injected in actual MV3 extension');
 assert.equal(await evaluate(jobPage,"typeof globalThis.CVATBatchNativeContext?.find"),'function');
 pass('old grouping sentinel without shared context is repaired during injection');
 await evaluate(jobPage,'delete globalThis.CVATBatchNativeContext;true');
 pass('prefetch runs with shared context deliberately removed');
 await click('[data-prefetch="start"]');
 await click('[data-action="screen-labels"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('준비 10 / 10')`);
 await click('[data-action="screen-view"]');
 pass('background prefetch continues while label tab is selected');
 assert.equal(await evaluate(jobPage,'prefetchCalls'),5);
 assert.equal(await evaluate(jobPage,'locationFixture.a.player.frame.number'),0);
 pass('background download prepares ten frames without navigating or editing annotations');
 assert.deepEqual(await evaluate(jobPage,'consumeFrame(8)'),[4,22,33,44]);
 assert.deepEqual(await evaluate(jobPage,'consumeFrame(8)'),[4,22,33,44]);
 assert.equal(await evaluate(jobPage,'prefetchCalls'),5);
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('재사용 2회')`);
 pass('native consumer receives retained bytes without network and may detach them safely');
 const shot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/prefetch-preview.png'),Buffer.from(shot.data,'base64'));
 await click('[data-prefetch="clear"]');
 await until(jobPage,'locationFixture.job.frames.chunk===originalChunk');
 await evaluate(jobPage,'consumeFrame(8)');assert.equal(await evaluate(jobPage,'prefetchCalls'),6);
 pass('clear restores native loading and removes only extension cache');
 await click('[data-prefetch="start"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="stop"]:not(:disabled)')`);
 await click('[data-prefetch="stop"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('중지했습니다')`);
 await pause(300);const stopped=await evaluate(jobPage,'prefetchCalls');await pause(500);assert.equal(await evaluate(jobPage,'prefetchCalls'),stopped);
 pass('stop prevents further downloads while retaining prepared chunks');
 await click('[data-prefetch="start"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('준비 10 / 10')`);
 pass('resume completes missing chunks');
 await evaluate(jobPage,"window.oldJob=locationFixture.job;history.pushState({},'', '/tasks/1/jobs/19');locationFixture.a.job.instance={...locationFixture.job,id:19}");
 await until(jobPage,'oldJob.frames.chunk===originalChunk');
 await until(jobPage,`!${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('Job 18')`);
 pass('Job navigation clears retained data and old native hook');
 assert.equal(await evaluate(jobPage,'locationFixture.count()'),0);
 pass('no annotation writes');
 await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/18');locationFixture.a.job.instance=oldJob;oldJob.frames.chunk=null");
 await pause(1100);await click('[data-prefetch="start"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('연결을 확인하지 못했습니다')`);
 await pause(1300);assert(await evaluate(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('연결을 확인하지 못했습니다')`));
 pass('unsupported API error remains visible across status polls');
 await evaluate(jobPage,'oldJob.frames.chunk=originalChunk');await click('[data-prefetch="start"]');
 await until(jobPage,`${shadow}.querySelector('[data-prefetch="status"]').textContent.includes('준비 10 / 10')`);
 send=await open();await evaluate(send,'setTimeout(()=>chrome.runtime.reload(),30);true');
 await until(jobPage,'oldJob.frames.chunk===originalChunk');
 const callsAfterReload=await evaluate(jobPage,'prefetchCalls');await pause(1100);assert.equal(await evaluate(jobPage,'prefetchCalls'),callsAfterReload);
 pass('actual extension reload releases the active native cache hook');

}catch(error){results.push({name:'Prefetch real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/prefetch-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant, synthetic CVAT DOM. No company data or personal browser; deployed CVAT/OpenCV initialization not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
