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
const driver=(await readFile(path.join(root,'tests/view-fixture.js'),'utf8'))+'\nwindow.screenSkeletonFixture=viewFixture.enableSkeleton();window.ready=true;';
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
 await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('.label-eye:not(:disabled)'))");
 pass('actual popup injects both display worlds and connects the Job catalog');
 await browser('Target.closeTarget',{targetId:popup.id});await pause(100);
 const shadow="document.getElementById('cvat-shortcuts-label-overlay').shadowRoot";
 async function click(selector){
   const p=await evaluate(jobPage,`(()=>{const b=${shadow}.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});
   await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});
 }
 await click('.label-eye[value="person"]');await until(jobPage,'viewFixture.a.annotations.states[0].hidden');
 assert.equal(await evaluate(jobPage,'viewFixture.a.drawing.activeLabelID'),2);
 pass('trusted eye click hides matching objects without changing the active skeleton label');
 await click('[data-action="screen-view"]');await click('[data-view="minus"]');
 await until(jobPage,'viewFixture.a.canvas.instance.geometry.angle===359');
 pass('trusted screen-tab rotation applies exactly one degree through MAIN');
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="angle"]').value='-17'`);await click('[data-view="apply"]');
 await until(jobPage,'viewFixture.a.canvas.instance.geometry.angle===343');
 await click('[data-view="grid"]');await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-alignment-grid'))");
 assert.equal(await evaluate(jobPage,"getComputedStyle(document.getElementById('cvat-shortcuts-alignment-grid')).pointerEvents"),'none');
 pass('angle entry and grid checkbox work with real trusted pointer events');
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="color"]').value='#000000';${shadow}.querySelector('[data-view="color"]').dispatchEvent(new Event('change',{bubbles:true}))`);
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="spacing"]').value='24';${shadow}.querySelector('[data-view="spacing"]').dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await evaluate(jobPage,"document.getElementById('cvat-shortcuts-alignment-grid').style.backgroundSize"),'24px 24px');
 pass('grid spacing and color persist while the grid stays unrotated');


 // Move the settings overlay away from the drawing area, as a user would.
 const drag=await evaluate(jobPage,`(()=>{const r=${shadow}.querySelector('[data-action="drag"]').getBoundingClientRect();return {x:r.x+30,y:r.y+10};})()`);
 await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...drag});
 await jobPage('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:40,y:drag.y});
 await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:40,y:drag.y});
 // Real trusted mouse events through the production MAIN-world adapter.
 await evaluate(jobPage, `viewFixture.a.canvas.instance.draw({enabled:true,shapeType:'skeleton',skeletonSVG:screenSkeletonFixture.template})`);
 const anchors=await evaluate(jobPage, `(()=>{const p=new DOMPoint(200,120).matrixTransform(viewFixture.svg.getScreenCTM());return [{x:p.x-45,y:p.y-35},{x:p.x+45,y:p.y+35}];})()`);
 await jobPage('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...anchors[0]});
 await jobPage('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...anchors[1]});
 const preview=await evaluate(jobPage, `(()=>{const layer=document.querySelector('[data-cvat-screen-skeleton]');return [...layer.querySelectorAll('circle')].map(n=>{const p=new DOMPoint(+n.getAttribute('cx'),+n.getAttribute('cy')).matrixTransform(layer.getScreenCTM());return {x:p.x,y:p.y};});})()`);
 assert.equal(preview.length,6);assert(preview[2].x-preview[0].x>80);assert(preview[3].y-preview[0].y>60);assert(Math.abs(preview[0].y-preview[2].y)<.001);assert(Math.abs(preview[0].x-preview[3].x)<.001);
 pass('trusted drag keeps the new six-joint skeleton preview horizontal on a rotated image');
 const skeletonShot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/screen-skeleton-preview.png'),Buffer.from(skeletonShot.data,'base64'));
 await jobPage('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...anchors[1]});
 const completion=await evaluate(jobPage, `(()=>{const data=screenSkeletonFixture.completed.at(-1);return {data,points:data.elements.map(e=>{const p=new DOMPoint(...e.points).matrixTransform(viewFixture.svg.getScreenCTM());return {x:p.x,y:p.y};}),count:screenSkeletonFixture.completed.length,remaining:!!document.querySelector('[data-cvat-screen-skeleton]')};})()`);
 assert.equal(completion.count,1);assert.equal(completion.remaining,false);assert.equal(completion.data.shapeType,'skeleton');
 for(let i=0;i<6;i++){assert(Math.abs(completion.points[i].x-preview[i].x)<1.5);assert(Math.abs(completion.points[i].y-preview[i].y)<1.5);}
 assert(Math.abs(completion.data.elements[0].points[1]-completion.data.elements[2].points[1])>1);
 pass('trusted release submits original-image joints through the native completion callback');
 await click('[data-view="reset"]');
 await until(jobPage,'viewFixture.a.canvas.instance.geometry.angle===0');
 assert.deepEqual(await evaluate(jobPage,'screenSkeletonFixture.completed.at(-1)'),completion.data);
 pass('returning to zero degrees preserves the completed original-image coordinates');
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="angle"]').value='-17'`);await click('[data-view="apply"]');
 // A local synthetic barcode only; this screenshot contains no company data.
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="minus"]').scrollIntoView({block:'start'})`);
 const shot=await jobPage('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/view-tools-preview.png'),Buffer.from(shot.data,'base64'));

 await evaluate(jobPage,"viewFixture.mode('group')");
 await until(jobPage,`${shadow}.querySelector('[data-view="reset"]').textContent.includes('취소')`);
 assert(await evaluate(jobPage,`${shadow}.querySelector('[data-view="plus"]').disabled&&!${shadow}.querySelector('[data-view="reset"]').disabled`));
 await click('[data-view="reset"]');
 assert.equal(await evaluate(jobPage,'viewFixture.a.canvas.instance.geometry.angle'),0);
 assert.equal(await evaluate(jobPage,'viewFixture.a.canvas.instance.mode()'),'idle');
 pass('trusted zero reset exits group mode and restores rotation while normal angle controls stay locked');
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="angle"]').value='5'`);await click('[data-view="apply"]');
 await evaluate(jobPage,`viewFixture.a.canvas.instance.draw({enabled:true,shapeType:'skeleton',skeletonSVG:screenSkeletonFixture.template})`);
 await until(jobPage,`${shadow}.querySelector('[data-view="reset"]').textContent.includes('취소')`);
 await click('[data-view="reset"]');
 assert.equal(await evaluate(jobPage,'screenSkeletonFixture.completed.at(-1)'),null);
 assert.equal(await evaluate(jobPage,'viewFixture.a.canvas.instance.geometry.angle'),0);
 assert.equal(await evaluate(jobPage,"Boolean(document.querySelector('[data-cvat-screen-skeleton]'))"),false);
 pass('trusted reset cancels only the unfinished skeleton preview before returning to zero');
 await evaluate(jobPage,'viewFixture.frame(1)');await until(jobPage,'viewFixture.a.annotations.states[0].hidden');
 assert.equal(await evaluate(jobPage,'viewFixture.a.canvas.instance.geometry.angle'),0);
 pass('next frame keeps label hiding while angle remains frame-specific');
 await evaluate(jobPage,`${shadow}.querySelector('[data-view="angle"]').value='17'`);await click('[data-view="apply"]');
 await until(jobPage,'viewFixture.a.canvas.instance.geometry.angle===17');
 await evaluate(jobPage,"viewFixture.a.canvas.instance.model.draw({enabled:true,shapeType:'mask'})");
 assert.equal(await evaluate(jobPage,'viewFixture.a.canvas.instance.geometry.angle'),0);await evaluate(jobPage,"viewFixture.mode('idle')");
 pass('native raster drawing resets a fine angle before its handler starts');
 await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/19');viewFixture.job(19)");await pause(950);
 assert.equal(await evaluate(jobPage,'viewFixture.a.annotations.states[0].hidden'),false);
 assert.equal(await evaluate(jobPage,"Boolean(document.getElementById('cvat-shortcuts-alignment-grid'))"),false);
 await evaluate(jobPage,"history.pushState({},'', '/tasks/1/jobs/18');viewFixture.job(18)");await until(jobPage,'viewFixture.a.annotations.states[0].hidden');
 await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-alignment-grid'))");
 pass('SPA Job changes isolate and restore each Job display preferences');
 send=await open();
 assert.equal(await evaluate(send,"chrome.storage.local.get('cvatSidebarShortcutsV1').then(x=>x.cvatSidebarShortcutsV1?.defaultLabelName)"),selectedBefore);
 await evaluate(send,"document.getElementById('disable').click()");await until(jobPage,'!viewFixture.a.annotations.states[0].hidden');
 assert.equal(await evaluate(jobPage,'viewFixture.a.annotations.states[1].hidden'),true);
 assert.equal(await evaluate(jobPage,"Boolean(document.getElementById('cvat-shortcuts-alignment-grid'))"),false);
 assert.equal(await evaluate(jobPage,'viewFixture.saveCalls'),0);
 pass('pause restores extension visibility and grid, preserves manual hiding and makes no annotation saves');
}catch(error){results.push({name:'View tools real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/view-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant, synthetic CVAT DOM. No company data or personal browser; deployed CVAT/OpenCV initialization not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
