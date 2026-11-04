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
const driver=(await readFile(path.join(root,'tests/view-fixture.js'),'utf8'))+'\n'+(await readFile(path.join(root,'tests/group-fixture.js'),'utf8'))+'\nwindow.ready=true;';
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

 // Reproduce an already-open Job after the extension has been updated.
 await evaluate(jobPage,`window.__cvatShortcutsGroupV1=true;window.staleGroupCalls=0;document.addEventListener('cvat-shortcuts-group-v1',e=>{staleGroupCalls++;e.target.setAttribute('data-response',JSON.stringify({error:'OLD GROUP HANDLER'}));},true);`);
 let send=await open();
 const selectedBefore=await evaluate(send,"chrome.storage.local.get('cvatSidebarShortcutsV1').then(x=>x.cvatSidebarShortcutsV1?.defaultLabelName)");
 await evaluate(send,"document.getElementById('enable').click()");
 await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('[data-group=scan]:not(:disabled)'))");
 pass('actual popup injects both display worlds and connects the Job catalog');
 // Duplicate injection of this build must still leave exactly one active handler.
 await evaluate(send,`chrome.tabs.query({url:${JSON.stringify(origin+'/*')}}).then(async tabs=>{await chrome.scripting.executeScript({target:{tabId:tabs[0].id},files:['group-native.js'],world:'MAIN'});})`);

 await browser('Target.closeTarget',{targetId:popup.id});await pause(100);
 const shadow="document.getElementById('cvat-shortcuts-label-overlay').shadowRoot";
 async function click(selector){
   const p=await evaluate(jobPage,`(()=>{const b=${shadow}.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});
   await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});
 }

 await click('[data-action="screen-view"]');
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="scan"]')&&!${shadow}.querySelector('[data-group="scan"]').disabled`));
 pass('screen overlay exposes automatic grouping with current-frame default');
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 1그룹')`);
 assert.equal(await evaluate(jobPage,'groupFixture.count()'),0);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="results"]').textContent.includes('박스 #1 + 스켈레톤 #2')`));
 pass('trusted scan previews box plus skeleton and leaves empty box unchanged');
 assert.equal(await evaluate(jobPage,'staleGroupCalls'),0);
 pass('updated bridge ignores the legacy sentinel and never invokes the old handler without page reload');
 const shot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/group-preview.png'),Buffer.from(shot.data,'base64'));
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('1그룹 완료')`);
 assert.deepEqual(await evaluate(jobPage,'groupFixture.records().map(o=>o.group.id)'),[100,100,0]);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="apply"]').disabled`));
 pass('trusted apply invokes native group once and never groups the empty box');
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 0그룹')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="results"]').textContent.includes('이미 같은 그룹')`));
 pass('repeated inspection preserves existing groups and disables duplicate apply');
 await evaluate(jobPage,'groupFixture.job.actions.undo()');
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 1그룹')`);
 await evaluate(jobPage,'groupFixture.records()[0].lock=true');
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('다시 검사')`);
 assert.deepEqual(await evaluate(jobPage,'groupFixture.records().map(o=>o.group.id)'),[0,0,0]);
 pass('lock change between preview and apply is blocked in actual MV3 bridge');
 await evaluate(jobPage,`groupFixture.records()[0].lock=false;groupFixture.records().push(groupFixture.box(10,undefined,{frame:2}),groupFixture.skeleton(11,undefined,{frame:2}));${shadow}.querySelector('[data-group="scope"]').value='all';${shadow}.querySelector('[data-group="scope"]').dispatchEvent(new Event('change',{bubbles:true}))`);
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 2그룹')`);
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('2그룹 완료')`);
 const ids=await evaluate(jobPage,'groupFixture.records().map(o=>o.group.id)');assert.equal(ids[0],ids[1]);assert.equal(ids[2],0);assert.equal(ids[3],ids[4]);assert.notEqual(ids[0],ids[3]);
 pass('Job-wide grouping creates independent per-box groups across frames');
 assert(await evaluate(jobPage,`!${shadow}.querySelector('[data-group="extend"]')`));
 await evaluate(jobPage,`window.previousBoxGroup=groupFixture.records()[0].group.id;window.untouchedGroup=groupFixture.records()[3].group.id;groupFixture.records().push(groupFixture.box(30,[0,0,100,0,100,100,0,100],{shapeType:'polygon'}),groupFixture.box(31,[0,0,100,0,100,100,0,100],{shapeType:'polygon',frame:4}),groupFixture.skeleton(32,undefined,{frame:4}),groupFixture.skeleton(33,undefined,{frame:4}));groupFixture.records().push(groupFixture.box(34,[200,0,300,100],{frame:8,group:{id:previousBoxGroup}}));window.beforePolygon=JSON.stringify(groupFixture.records());`);
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 2그룹')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="results"]').textContent.includes('폴리곤 #30')&&${shadow}.querySelector('[data-group="results"]').textContent.includes('기존 그룹 #')`));
 pass('preview adds polygon to existing box group and finds polygon-only frame');
 const polygonShot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/polygon-group-preview.png'),Buffer.from(polygonShot.data,'base64'));
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('2그룹 완료')`);
 assert(await evaluate(jobPage,`(()=>{const all=groupFixture.records(),get=id=>all.find(o=>o.clientID===id).group.id;return get(1)===get(2)&&get(2)===get(30)&&get(1)!==previousBoxGroup&&get(31)===get(32)&&get(32)===get(33)&&get(31)!==get(1)&&get(10)===untouchedGroup&&get(11)===untouchedGroup;})()`));
 assert(await evaluate(jobPage,`JSON.stringify(groupFixture.records(),(key,value)=>key==='group'?undefined:value)===JSON.stringify(JSON.parse(beforePolygon),(key,value)=>key==='group'?undefined:value)`));
 pass('apply preserves every object and coordinate while grouping old box plus polygon and new polygon plus two skeletons');
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 0그룹')`);
 pass('repeated polygon grouping does not replace completed groups');

 // Independent browser SVG oracle: same nonzero fill as the actual CVAT polygon.
 await evaluate(jobPage,`groupFixture.records().push(groupFixture.box(40,[0,0,100,100,0,100,100,0],{shapeType:'polygon',frame:6}),groupFixture.box(41,undefined,{frame:6}),groupFixture.skeleton(42,[[40,10],[60,30]],{frame:6}));window.crossingBefore=JSON.stringify(groupFixture.records());`);
 assert(await evaluate(jobPage,`(()=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),p=document.createElementNS(svg.namespaceURI,'polygon');p.setAttribute('points','0,0 100,100 0,100 100,0');svg.append(p);document.body.append(svg);const hit=p.isPointInFill(new DOMPoint(50,20));svg.remove();return hit;})()`));
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 1그룹')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="results"]').textContent.includes('폴리곤 #40')`));
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('1그룹 완료')`);
 assert(await evaluate(jobPage,`(()=>{const a=groupFixture.records().filter(o=>[40,41,42].includes(o.clientID));return new Set(a.map(o=>o.group.id)).size===1&&JSON.stringify(a[0].points)==='[0,0,100,100,0,100,100,0]';})()`));
 pass('self-crossing polygon agrees with native SVG fill and groups without geometry edits');
 await evaluate(jobPage,'groupFixture.job.actions.undo()');
 assert(await evaluate(jobPage,'JSON.stringify(groupFixture.records())===crossingBefore'));
 pass('native undo restores the entire self-crossing grouping snapshot');

 // Center outside; just one joint inside the clipped polygon.
 await evaluate(jobPage,`groupFixture.records().push(groupFixture.box(50,[-50,-50,100,100],{frame:7}),groupFixture.box(51,[0,0,100,0,100,100,0,100],{shapeType:'polygon',frame:7}),groupFixture.skeleton(52,[[-30,-30],[-20,-30],[-30,-20],[10,10],[-10,-20],[-10,-10]],{frame:7}));window.partialBefore=JSON.stringify(groupFixture.records());`);
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 2그룹')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="results"]').textContent.includes('박스 #50 + 폴리곤 #51 + 스켈레톤 #52')`));
 await click('[data-group="apply"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('2그룹 완료')`);
 assert(await evaluate(jobPage,`new Set(groupFixture.records().filter(o=>[50,51,52].includes(o.clientID)).map(o=>o.group.id)).size===1`));
 await click('[data-group="scan"]');await until(jobPage,`${shadow}.querySelector('[data-group="status"]').textContent.includes('매칭 0그룹')`);
 await evaluate(jobPage,'groupFixture.job.actions.undo();groupFixture.job.actions.undo()');
 assert(await evaluate(jobPage,'JSON.stringify(groupFixture.records())===partialBefore'));
 pass('partially visible skeleton joins polygon and box, repeat preserves groups and undo restores all geometry');

 await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/19');groupFixture.a.job.instance={...groupFixture.job,id:19}");await pause(950);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-group="apply"]').disabled`));
 pass('Job navigation invalidates old grouping results');
}catch(error){results.push({name:'Grouping real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/group-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant, synthetic CVAT DOM. No company data or personal browser; deployed CVAT/OpenCV initialization not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
