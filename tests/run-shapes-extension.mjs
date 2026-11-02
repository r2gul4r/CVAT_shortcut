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
const driver=`window.starts=[];window.wrongStarts=0;window.labelTouches=0;window.rectMethod='By 2 points';window.rectDelay=120;window.rectangleMissing=false;
const group=document.querySelector('.cvat-draw-shape-popover-drawing-method-selector');
function renderMethod(){for(const input of group.querySelectorAll('input')){input.checked=input.value===rectMethod;input.closest('label').classList.toggle('ant-radio-button-wrapper-checked',input.checked);}}
renderMethod();group.addEventListener('change',e=>{const value=e.target.value;setTimeout(()=>{rectMethod=value;renderMethod();},rectDelay);});
for(const type of ['rectangle','skeleton']){const panel=document.getElementById(type+'-panel'),label=labelFixture.byID(type+'-label'),icon=document.querySelector('.cvat-draw-'+type+'-control');
 label.options(type==='rectangle'?['polybag']:['barcode_6pt']);label.root.value=type==='rectangle'?'polybag':'barcode_6pt';label.combo.disabled=true;label.root.classList.add('ant-select-disabled');for(const event of ['mousedown','click'])label.root.addEventListener(event,()=>labelTouches++);
 icon.onclick=()=>{panel.hidden=false;};
 document.querySelector('.cvat-draw-'+type+'-shape-button').onclick=()=>{starts.push({type,label:label.root.value,method:type==='rectangle'?rectMethod:null});panel.hidden=true;icon.classList.add('cvat-active-canvas-control');};
 document.querySelector('.cvat-draw-'+type+'-track-button').onclick=()=>wrongStarts++;
}
document.addEventListener('keydown',e=>{if(e.code==='Escape'){document.querySelectorAll('.cvat-active-canvas-control').forEach(n=>n.classList.remove('cvat-active-canvas-control'));document.querySelector('.cvat-brush-tools-toolbox').hidden=true;}});
const catalog=document.createElement('div');catalog.className='cvat-objects-sidebar-labels-list';catalog.innerHTML='<div class="cvat-objects-sidebar-labels-list-header">Items: 4</div>'+['polybag','parcel','barcode_6pt','barcode_4pt'].map(n=>'<div class="cvat-objects-sidebar-label-item"><span class="cvat-text">'+n+'</span></div>').join('');document.body.append(catalog);window.ready=true;`;
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
 const job=await browser('Target.createTarget',{url:origin+'/tasks/1/jobs/17'});jobPage=await page(job.targetId);await until(jobPage,'window.ready');
 ({id:extensionId}=await browser('Extensions.loadUnpacked',{path:extension}));const {targetInfos}=await browser('Target.getTargets',{filter:[{type:'tab'}]});jobTarget=targetInfos.find(t=>t.url===origin+'/tasks/1/jobs/17');assert(jobTarget);
 let send=await open();assert.equal(await evaluate(send,"document.getElementById('rectangle-key').textContent"),'미지정');assert.equal(await evaluate(send,"document.getElementById('skeleton-key').textContent"),'미지정');
 for(const [action,code,k] of [['rectangle','KeyR','r'],['skeleton','KeyK','k']]){await evaluate(send,`document.getElementById('${action}-assign').click()`);await key(send,code,k);await until(send,`document.getElementById('${action}-key').textContent==='${k.toUpperCase()}'`);}
 pass('real action popup assigns and persists both new shortcuts');
 await evaluate(send,"document.getElementById('enable').click()");await until(jobPage,"Boolean(document.getElementById('cvat-shortcuts-label-overlay')?.shadowRoot.querySelector('.choice'))");pass('popup activation injects new tools into isolated extension world');
 await evaluate(send,"document.getElementById('skeleton-title').scrollIntoView({block:'center'})");
 const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'tests/new-shapes-popup-preview.png'),Buffer.from(shot.data,'base64'));
 await browser('Target.closeTarget',{targetId:popup.id});await pause(150);
 await clickOverlay('barcode_4pt');await key(jobPage,'KeyR','r');await until(jobPage,'window.starts.length===1');
 assert.deepEqual(await evaluate(jobPage,'window.starts[0]'),{type:'rectangle',label:'polybag',method:'Rotated points'});pass('trusted rectangle shortcut preserves the single fixed label and selects Rotated before Shape');
 await pause(300);await clickOverlay('parcel');await key(jobPage,'KeyK','k');await until(jobPage,'window.starts.length===2');
 assert.deepEqual(await evaluate(jobPage,'window.starts[1]'),{type:'skeleton',label:'barcode_6pt',method:null});pass('trusted skeleton key cancels rectangle and starts Shape with its fixed label');
 await pause(300);await clickOverlay('polybag');await key(jobPage,'KeyK','k');await until(jobPage,'window.starts.length===3');assert.equal(await evaluate(jobPage,'window.starts[2].label'),'barcode_6pt');assert.equal(await evaluate(jobPage,'window.labelTouches'),0);pass('changing overlay labels never touches fixed-label selectors or blocks skeleton');
 await evaluate(jobPage,"document.body.focus();document.querySelector('input[value=\"Rotated points\"]').disabled=true");await pause(300);await key(jobPage,'KeyR','r');await until(jobPage,"document.getElementById('cvat-sidebar-shortcuts-feedback')?.textContent.includes('비활성화')");assert.equal(await evaluate(jobPage,'window.starts.length'),3);pass('disabled Rotated cannot fall back to classic Shape');
 send=await open();assert.equal(await evaluate(send,"document.getElementById('rectangle-key').textContent"),'R');assert.equal(await evaluate(send,"document.getElementById('skeleton-key').textContent"),'K');assert.equal(await evaluate(jobPage,'window.wrongStarts'),0);pass('reopened popup preserves keys and no Track or unrelated Shape was clicked');
}catch(error){results.push({name:'New shape real extension integration',passed:false,error:error.message});console.error(error);process.exitCode=1;}
finally{for(const socket of sockets)socket.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
await writeFile(path.join(root,'tests/new-shapes-extension-results.json'),JSON.stringify({environment:'Disposable Chrome MV3 with localhost-only pregrant, synthetic CVAT DOM. No company data or personal browser; deployed CVAT/OpenCV initialization not tested.',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results},null,2)+'\n');
