const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'extension/health-core.js'),'utf8');
const context=vm.createContext({URL});vm.runInContext(core,context);const h=context.CVATHealth;
const BASE=Date.now();
function sample(s,id,kind,ms,code=200,error,cached=false){h.begin(s,id,kind,BASE);h.finish(s,id,BASE+ms,code,error,cached);}
test('request classification does not retain sensitive URL query/path identifiers',()=>{
  assert.equal(h.classify('http://test/api/jobs/12/annotations?secret=abc','PATCH'),'save');
  assert.equal(h.classify('http://test/api/jobs/12/data?frame=123'),'image');
  assert.equal(h.classify('http://test/api/lambda/requests/12'),'ai');
  assert.equal(h.classify('http://test/api/jobs/12'),'api');
  assert.equal(h.classify('http://test/tasks/1/jobs/12'),null);
  assert.equal(h.classify('invalid'),null);
});
test('empty and old measurements are unknown, never green',()=>{
  const s=h.create();assert.equal(h.summary(s,BASE).status,'idle');sample(s,'1','api',100);
  assert.equal(h.summary(s,BASE+200).status,'ok');assert.equal(h.summary(s,BASE+61000).status,'idle');
  assert.equal(h.summary(s,BASE+301000).count,0);
});
test('median uses successful responses and keeps request kinds separate',()=>{
  const s=h.create();[100,200,10000].forEach((ms,i)=>sample(s,String(i),'api',ms));sample(s,'im','image',7000);sample(s,'err','api',1,503);
  const view=h.summary(s,BASE+11000);assert.equal(view.groups[0].median,200);assert.equal(view.groups[0].failures,1);assert.equal(view.groups[1].median,7000);
});
test('a single latency spike is not a repeated delay',()=>{
  const s=h.create();sample(s,'a','api',3000);assert.equal(h.summary(s,BASE+3000).status,'ok');
  sample(s,'b','api',2500);assert.equal(h.summary(s,BASE+3100).status,'slow');
});
test('AI has a separate slow threshold',()=>{
  const s=h.create();sample(s,'a','ai',4000);sample(s,'b','ai',5000);assert.equal(h.summary(s,BASE+5100).status,'ok');
});
test('unfinished requests can show delay before completion without a probe',()=>{
  const s=h.create();h.begin(s,'a','api',BASE);assert.equal(h.summary(s,BASE+10001).waiting,1);assert.equal(h.summary(s,BASE+10001).status,'slow');
});
for(const [code,error,expected] of [[500,null,'error'],[502,null,'error'],[503,null,'error'],[429,null,'error'],[0,'net::ERR_CONNECTION_RESET','error'],[401,null,'auth'],[403,null,'auth'],[404,null,'request']]){
  test(`classifies ${error||code} separately`,()=>{const s=h.create();sample(s,'a','api',100,code,error);assert.equal(h.summary(s,BASE+200).status,expected);});
}
test('cancelled, cached and untracked completions do not inflate failures or green',()=>{
  const s=h.create();sample(s,'a','api',100,0,'net::ERR_ABORTED');sample(s,'b','image',20,200,null,true);h.finish(s,'unknown',BASE+20,200);
  assert.equal(h.summary(s,BASE+200).count,0);assert.equal(h.summary(s,BASE+200).status,'idle');assert.equal(Object.keys(s.pending).length,0);
});
test('sample and pending memory are bounded',()=>{
  const s=h.create();for(let i=0;i<1000;i++)sample(s,String(i),'api',100);assert.equal(s.samples.length,300);
  for(let i=0;i<1000;i++)h.begin(s,String(i),'api',BASE);assert.equal(Object.keys(s.pending).length,300);
  h.summary(s,BASE+300001);assert.equal(Object.keys(s.pending).length,0);
});

function worker(saved={},granted=true){
  const events={};const storage={...saved};const tabs={7:{id:7,url:'http://cvat.test/tasks/1/jobs/12'},8:{id:8,url:'http://cvat.test/tasks/1/jobs/13'}};
  const event=name=>({addListener(fn){events[name]=fn;},removeListener(fn){if(events[name]===fn)delete events[name];}});
  const chrome={runtime:{id:'test-extension',getURL:name=>'chrome-extension://test-extension/'+name,onMessage:event('message'),onStartup:event('startup')},
    granted,
    permissions:{async getAll(){return {permissions:chrome.granted?['webRequest']:[],origins:chrome.granted?['http://cvat.test/*']:[]};},async contains(){return chrome.granted;},async remove(){chrome.granted=false;},onAdded:event('permissionAdded'),onRemoved:event('permissionRemoved')},
    storage:{session:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(storage[key])]));},async set(values){Object.assign(storage,structuredClone(values));}},local:{async get(key){return {[key]:structuredClone(storage[key])};},async set(values){Object.assign(storage,structuredClone(values));}}},
    tabs:{async get(id){if(!tabs[id])throw Error('No tab');return tabs[id];},async query(){return Object.values(tabs);},onRemoved:event('removed'),onUpdated:event('updated')},
    scripting:{async executeScript(){if(chrome.deny)throw Error('Permission denied');return [{frameId:0,result:{visible:true}}];}},
    get webRequest(){return chrome.granted?requestAPI:undefined;}};
  const requestAPI={onBeforeRequest:event('begin'),onCompleted:event('finish'),onErrorOccurred:event('error')};
  const ctx=vm.createContext({URL,chrome,console,Date,Map});ctx.importScripts=()=>vm.runInContext(core,ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'extension/health-worker.js'),'utf8'),ctx);
  const sender={id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')};
  const send=(type,tabId=7,from=sender,extra={})=>new Promise(resolve=>events.message({type,tabId,...extra},from,resolve));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const request=(overrides={})=>({tabId:7,frameId:0,requestId:'r',url:'http://cvat.test/api/jobs/12?token=SECRET',method:'GET',timeStamp:Date.now(),...overrides});
  return {send,flush,events,storage,tabs,chrome,request};
}
test('worker captures only explicitly enabled tab, same origin, main frame API',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_START');
  for(const extra of [{tabId:8},{url:'http://other.test/api/jobs/12'},{frameId:1},{url:'http://cvat.test/pixels.jpg'}]){const req=w.request(extra);w.events.begin(req);w.events.finish({...req,statusCode:500});}
  await w.flush();assert.equal((await w.send('CVAT_HEALTH_STATUS')).count,0);
  const req=w.request();w.events.begin(req);w.events.finish({...req,timeStamp:req.timeStamp+100,statusCode:200});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).count,1);
  assert(!JSON.stringify(w.storage).includes('SECRET'));assert(!JSON.stringify(w.storage).includes('/api/jobs'));
});
test('reload, URL change, and tab closure stop and erase session',async()=>{
  for(const action of ['reload','url','close']){const w=worker();await w.send('CVAT_HEALTH_START');
    if(action==='close')w.events.removed(7);else w.events.updated(7,action==='reload'?{status:'loading'}:{url:'http://cvat.test/tasks/1/jobs/13'});
    await w.flush();assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);}
});
test('stop clears stored stats and does not affect another enabled tab',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_START');await w.send('CVAT_HEALTH_START',8);await w.send('CVAT_HEALTH_STOP');
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);assert.equal((await w.send('CVAT_HEALTH_STATUS',8)).enabled,true);
  assert.equal(w.storage.cvatHealthSessions['7'],undefined);
});
test('worker restart recovers session statistics',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_START');const req=w.request();w.events.begin(req);w.events.error({...req,error:'net::ERR_CONNECTION_RESET'});await w.flush();
  const fresh=worker(w.storage);assert.equal((await fresh.send('CVAT_HEALTH_STATUS')).network,1);
});
test('frame query and hash changes retain measurement in the same Job',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_START');w.events.updated(7,{url:'http://cvat.test/tasks/1/jobs/12?frame=123#view'});
  await w.flush();assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,true);
});
test('reload during permission validation cancels monitoring start',async()=>{
  const w=worker();const original=w.chrome.permissions.contains;let first=true;
  w.chrome.permissions.contains=async(...args)=>{if(first){first=false;w.events.updated(7,{status:'loading'});await w.flush();}return original(...args);};
  assert((await w.send('CVAT_HEALTH_START')).error);assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);
});
test('content cannot start monitoring or inspect a different tab',async()=>{
  const w=worker();const from={id:'test-extension',tab:{id:7}};
  assert((await w.send('CVAT_HEALTH_START',8,from)).error);await w.send('CVAT_HEALTH_START',8);
  assert.equal((await w.send('CVAT_HEALTH_STATUS',8,from)).enabled,false);
});
test('unsupported pages never enable capture; valid monitoring needs no page injection',async()=>{
  const w=worker();w.tabs[7].url='http://cvat.test/home';assert((await w.send('CVAT_HEALTH_START')).error);
  w.tabs[7].url='http://cvat.test/tasks/1/jobs/12';w.chrome.scripting.executeScript=async()=>assert.fail('Health must not inject into the Job page');assert.equal((await w.send('CVAT_HEALTH_START')).enabled,true);
});
test('no host grant means no webRequest registration and no enabled session',async()=>{
  const w=worker({},false);await w.flush();
  assert.equal(w.events.begin,undefined);assert.equal(w.events.finish,undefined);assert.equal(w.events.error,undefined);
  assert.match((await w.send('CVAT_HEALTH_START')).error,/권한/);
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);
});
test('granting and revoking site permission registers then removes monitoring and stored data',async()=>{
  const w=worker({},false);await w.flush();w.chrome.granted=true;w.events.permissionAdded();await w.flush();
  assert.equal(typeof w.events.begin,'function');assert.equal((await w.send('CVAT_HEALTH_START')).enabled,true);
  w.chrome.granted=false;w.events.permissionRemoved();await w.flush();
  assert.equal(w.events.begin,undefined);assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);
  assert.deepEqual(w.storage.cvatHealthSessions,{});
});
test('permission revoked during startup cannot leave an enabled session',async()=>{
  const w=worker();const original=w.chrome.tabs.get;w.chrome.tabs.get=async(id)=>{w.chrome.granted=false;return original(id);};
  assert.match((await w.send('CVAT_HEALTH_START')).error,/권한/);
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);
});
async function popup(granted=true){
  const elements=new Map(),calls=[];
  const get=id=>{if(!elements.has(id))elements.set(id,{dataset:{},hidden:true,addEventListener(type,fn){this[type]=fn;},setAttribute(){},focus(){}});return elements.get(id);};
  const button=get('health-toggle'),automatic=get('health-auto'),note=get('health-note');
  const chrome={permissions:{request(options){calls.push(['permission',options]);return Promise.resolve(granted);}},
    tabs:{async query(){calls.push(['query']);return [{id:7,url:'http://cvat.test:8080/tasks/1/jobs/12'}];}},
    runtime:{async sendMessage(message){calls.push(['message',message.type]);return {enabled:message.type==='CVAT_HEALTH_START'};}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'extension/health-popup.js'),'utf8'),{URL,chrome,setTimeout:()=>0,clearTimeout(){},window:{addEventListener(){},scrollTo(){}},document:{getElementById:get}});
  await new Promise(resolve=>setImmediate(resolve));calls.length=0;
  return {button,automatic,note,calls,chrome,get};
}
test('popup asks only for current host before the first asynchronous query, then starts',async()=>{
  const p=await popup();await p.button.click();
  assert.equal(p.calls[0][0],'permission');assert.deepEqual(Array.from(p.calls[0][1].origins),['http://cvat.test/*']);
  assert(p.calls.some(call=>call[1]==='CVAT_HEALTH_START'));
  p.calls.length=0;await p.button.click();assert(!p.calls.some(call=>call[0]==='permission'));
  assert(p.calls.some(call=>call[1]==='CVAT_HEALTH_STOP'));
});
test('popup permission refusal leaves monitoring off without sending START',async()=>{
  const p=await popup(false);await p.button.click();assert.match(p.note.textContent,/허용하지 않아/);
  assert.equal(p.calls.length,1);assert.equal(p.button.disabled,false);
});
test('popup reports missing worker in actionable Korean',async()=>{
  const p=await popup();p.chrome.runtime.sendMessage=async()=>{throw Error('Could not establish connection. Receiving end does not exist.');};
  await p.button.click();assert.match(p.note.textContent,/chrome:\/\/extensions/);assert.equal(p.button.disabled,false);
});
test('status viewing retains collected samples and removed SHOW action cannot create a panel',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_START');const r=w.request();w.events.begin(r);w.events.finish({...r,statusCode:200});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).count,1);
  assert((await w.send('CVAT_HEALTH_SHOW')).error);
});
test('automatic setting persists only the selected origin and restores without old statistics',async()=>{
  const w=worker();assert.equal((await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:true})).auto,true);await w.flush();
  assert.deepEqual(w.storage.cvatHealthAutoOrigins,['http://cvat.test']);
  const next=worker({cvatHealthAutoOrigins:w.storage.cvatHealthAutoOrigins});await next.flush();
  assert.equal((await next.send('CVAT_HEALTH_STATUS')).enabled,true);assert.equal((await next.send('CVAT_HEALTH_STATUS')).count,0);
});
test('automatic resumes on reload and Job navigation but not other hosts or non-Job pages',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:true});await w.flush();
  w.tabs[7].status='loading';w.events.updated(7,{status:'loading'});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);
  w.tabs[7].status='complete';w.events.updated(7,{status:'complete'});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,true);
  w.tabs[7].url='http://cvat.test/tasks/1/jobs/99';w.events.updated(7,{url:w.tabs[7].url});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,true);
  for(const url of ['http://other.test/tasks/1/jobs/99','http://cvat.test/home']){w.tabs[7].url=url;w.events.updated(7,{url});await w.flush();assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);}
});
test('manual stop stays paused across worker restart and frame query until next Job',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:true});await w.flush();await w.send('CVAT_HEALTH_STOP');
  const next=worker(w.storage);await next.flush();assert.equal((await next.send('CVAT_HEALTH_STATUS')).enabled,false);
  next.tabs[7].url='http://cvat.test/tasks/1/jobs/12?frame=2';next.events.updated(7,{url:next.tabs[7].url});await next.flush();
  assert.equal((await next.send('CVAT_HEALTH_STATUS')).enabled,false);
  next.tabs[7].url='http://cvat.test/tasks/1/jobs/15';next.events.updated(7,{url:next.tabs[7].url});await next.flush();
  assert.equal((await next.send('CVAT_HEALTH_STATUS')).enabled,true);
});
test('automatic off stops all matching sessions and prevents subsequent automatic start',async()=>{
  const w=worker();await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:true});await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS',8)).enabled,true);
  await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:false});await w.flush();
  for(const id of [7,8]){w.events.updated(id,{status:'complete'});await w.flush();assert.equal((await w.send('CVAT_HEALTH_STATUS',id)).enabled,false);}
  assert.deepEqual(w.storage.cvatHealthAutoOrigins,[]);
});
test('automatic opt-in requires permission and cannot be changed by page scripts',async()=>{
  const w=worker({},false);assert((await w.send('CVAT_HEALTH_AUTO',7,undefined,{enabled:true})).error);assert.equal(w.storage.cvatHealthAutoOrigins,undefined);
  const other=worker();assert((await other.send('CVAT_HEALTH_AUTO',7,{id:'test-extension',tab:{id:7}},{enabled:true})).error);
});
test('automatic startup skips discarded tabs and unavailable permissions',async()=>{
  const w=worker({cvatHealthAutoOrigins:['http://cvat.test']},false);w.tabs[8].discarded=true;await w.flush();
  assert.equal((await w.send('CVAT_HEALTH_STATUS')).enabled,false);assert.equal((await w.send('CVAT_HEALTH_STATUS',8)).enabled,false);
});
test('popup automatic checkbox requests access before saving and reverts denial',async()=>{
  const p=await popup(false);p.automatic.checked=true;await p.automatic.change();assert.equal(p.calls[0][0],'permission');assert.equal(p.calls.length,1);assert.equal(p.automatic.checked,false);
  const allowed=await popup();allowed.chrome.runtime.sendMessage=async m=>({enabled:m.enabled,auto:m.enabled});allowed.automatic.checked=true;await allowed.automatic.change();assert.equal(allowed.automatic.checked,true);assert.equal(allowed.button.textContent,'이 탭 측정 끄기');
});
