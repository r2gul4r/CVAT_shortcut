const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('../extension/review-core.js');
const catalog=[{id:1,name:'A',color:'#ff0000'},{id:2,name:'B'},{id:3,name:'C'},{id:4,name:'D'}];
const job={id:12,task_id:1,dimension:'2d',start_frame:0,stop_frame:99};
const meta={start_frame:0,stop_frame:99,frame_filter:'',deleted_frames:[],size:100};
const base=()=>({version:5,tags:[],tracks:[],shapes:Array.from({length:100},(_,frame)=>catalog.map(label=>({frame,label_id:label.id,type:'polygon'}))).flat()});
const inspect=(a=base(),j=job,m=meta,selected=[1,2,3,4])=>core.inspect(j,m,a,catalog,selected);
test('100 complete frames pass without changing annotations',()=>{const a=base(),copy=JSON.stringify(a),r=inspect(a);assert.equal(r.total,100);assert.equal(r.missingCount,0);assert.equal(JSON.stringify(a),copy);});
test('D missing on frame 45 reports exactly frame 45',()=>{const a=base();a.shapes=a.shapes.filter(s=>s.frame!==45||s.label_id!==4);const r=inspect(a);assert.deepEqual(r.rows[3].missing,[[45,45]]);assert.equal(r.rows[3].count,1);assert.equal(r.missingCount,1);});
test('overlapping missing labels count distinct frames, not label occurrences',()=>{const a=base();a.shapes=a.shapes.filter(s=>s.frame!==45&&s.frame!==46);const r=inspect(a);assert.equal(r.missingCount,2);assert.deepEqual(r.missing,[[45,46]]);assert.equal(r.rows.every(row=>row.count===2),true);});
test('multiple objects of one label cannot satisfy another label',()=>{const a=base();a.shapes=a.shapes.map(s=>({...s,label_id:1}));assert.equal(inspect(a).rows[3].count,100);});
test('deleted frames are excluded even when annotations are missing',()=>{const a=base();a.shapes=a.shapes.filter(s=>s.frame!==45);const r=inspect(a,job,{...meta,deleted_frames:[45]});assert.equal(r.total,99);assert.equal(r.excluded,1);assert.equal(r.missingCount,0);});
test('UI hidden/locked/occluded objects still count',()=>{const a=base();a.shapes=a.shapes.map(s=>({...s,hidden:true,occluded:true,lock:true}));assert.equal(inspect(a).missingCount,0);});
test('tags do not satisfy drawn-object requirements',()=>{const a=base();a.tags=a.shapes.map(({frame,label_id})=>({frame,label_id}));a.shapes=[];assert.equal(inspect(a).missingCount,100);});
test('Track fills visible intervals, excludes Outside keyframe and interval, resumes',()=>{const a={version:1,tags:[],shapes:[],tracks:[{frame:10,label_id:1,shapes:[{frame:10,outside:false},{frame:20,outside:true},{frame:30,outside:false}]}]};const r=inspect(a,job,meta,[1]);assert.deepEqual(r.rows[0].missing,[[0,9],[20,29]]);});
test('Track continues after last visible keyframe and ignores keyframe input order',()=>{const a={version:1,tags:[],shapes:[],tracks:[{frame:0,label_id:1,shapes:[{frame:20,outside:false},{frame:0,outside:false}]}]};assert.equal(inspect(a,job,meta,[1]).missingCount,0);});
test('Track outside at final keyframe remains absent',()=>{const a={version:1,tags:[],shapes:[],tracks:[{frame:0,label_id:1,shapes:[{frame:0,outside:false},{frame:99,outside:true}]}]};assert.deepEqual(inspect(a,job,meta,[1]).missing,[[99,99]]);});
test('overlapping tracks and shapes combine correctly',()=>{const a={version:1,tags:[],shapes:[{frame:99,label_id:1,type:'mask'}],tracks:[{frame:0,label_id:1,shapes:[{frame:0,outside:false},{frame:50,outside:true}]},{frame:50,label_id:1,shapes:[{frame:50,outside:false},{frame:99,outside:true}]}]};assert.equal(inspect(a,job,meta,[1]).missingCount,0);});
test('step and nonzero original source offsets retain CVAT frame numbers',()=>{const j={...job,start_frame:100,stop_frame:199},m={...meta,start_frame:1200,stop_frame:1499,frame_filter:'step=3',deleted_frames:[145]};const a=base();a.shapes=a.shapes.map(s=>({...s,frame:s.frame+100})).filter(s=>s.frame!==145&&s.frame!==146);const r=inspect(a,j,m);assert.equal(r.total,99);assert.deepEqual(r.missing,[[146,146]]);});
test('included_frames map original source frames to sparse CVAT positions',()=>{const r=inspect({version:1,tags:[],shapes:[],tracks:[]},{...job,start_frame:100,stop_frame:199},{...meta,start_frame:1200,stop_frame:1499,frame_filter:'step=3',included_frames:[1200,1230,1497],deleted_frames:[110]},[1]);assert.equal(r.total,2);assert.deepEqual(r.missing,[[100,100],[199,199]]);});
for(const [name,mutate] of [
  ['missing Shape array',a=>delete a.shapes],['missing Track array',a=>delete a.tracks],['invalid version',a=>a.version='5'],
  ['invalid shape frame',a=>a.shapes[0].frame='0'],['invalid Track outside',a=>a.tracks=[{label_id:1,frame:0,shapes:[{frame:0}]}]],
  ['duplicate keyframes',a=>a.tracks=[{label_id:1,frame:0,shapes:[{frame:0,outside:false},{frame:0,outside:true}]}]],
  ['empty track',a=>a.tracks=[{label_id:1,frame:0,shapes:[]}]],['Skeleton Track',a=>a.tracks=[{label_id:1,frame:0,elements:[{}],shapes:[]}]]
])test(`${name} fails closed`,()=>{const a=base();mutate(a);assert.throws(()=>inspect(a));});
test('empty/all-deleted Job cannot claim success',()=>assert.throws(()=>inspect(base(),job,{...meta,deleted_frames:Array.from({length:100},(_,i)=>i)})));
test('unknown labels and duplicate selected labels are rejected',()=>{assert.throws(()=>inspect(base(),job,meta,[99]));assert.throws(()=>inspect(base(),job,meta,[1,1]));assert.throws(()=>inspect(base(),job,meta,[]));});
test('unknown or inconsistent frame filters are rejected',()=>{assert.throws(()=>core.frames(job,{...meta,frame_filter:'step=0'}));assert.throws(()=>core.frames(job,{...meta,frame_filter:'step=2'}));assert.throws(()=>core.frames(job,{...meta,deleted_frames:undefined}));});
test('invalid included numbers and duplicate included frames are rejected',()=>{assert.throws(()=>core.frames(job,{...meta,included_frames:[0,0]}));assert.throws(()=>core.frames(job,{...meta,included_frames:[101]}));});
test('color metadata is allowlisted and labels must have unique IDs',()=>{assert.equal(core.labels([{id:1,name:'<img>',color:'url(https://x)'}])[0].color,'#8996a8');assert.throws(()=>core.labels([{id:1,name:'A'},{id:1,name:'B'}]));});
test('range paging handles holes and large offsets',()=>{assert.deepEqual(core.page([[0,5],[45,45],[80,99]],5,4),[5,45,80,81]);assert.deepEqual(core.page([[0,5]],999),[]);});
test('next and previous start from actual CVAT frame and do not wrap',()=>{const r=[[10,12],[45,45]];assert.equal(core.adjacent(r,11,1),12);assert.equal(core.adjacent(r,40,1),45);assert.equal(core.adjacent(r,45,-1),12);assert.equal(core.adjacent(r,45,1),null);assert.equal(core.adjacent(r,10,-1),null);});
test('copied report uses label names, CVAT frame numbers and explicit saved basis',()=>{const a=base();a.shapes=a.shapes.filter(s=>s.frame!==45||s.label_id!==4);const text=core.text(inspect(a));assert.match(text,/D가 없는 프레임: 45 \(1개\)/);assert.match(text,/저장된 작업/);});
test('CSV has BOM, per-frame rows, escaped quotes, and formula protection',()=>{const r=inspect();r.rows=[{id:4,name:'=HYPERLINK("x")',count:2,missing:[[45,46]]}];const csv=core.csv(r);assert(csv.startsWith('\ufeff'));assert.match(csv,/'=HYPERLINK\(""x""\)/);assert.equal(csv.split('\r\n').length,3);});
test('oversized CSV is rejected before allocating a giant export',()=>assert.throws(()=>core.csv({rows:[{count:200001}]})));

function harness(overrides={}){
  const calls=[],storage={};const window={};window.top=window;
  const context={window,location:{origin:'https://cvat.test',protocol:'https:',pathname:'/tasks/1/jobs/12'},CVATReviewCore:core,URL,Response,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,
    chrome:{storage:{local:{async set(values){Object.assign(storage,values);}}}},fetch:async(url,options)=>{
      calls.push({url,options});if(overrides.fetch)return overrides.fetch(url,options,calls.length);
      const path=new URL(url).pathname;const data=path.endsWith('/annotations')?base():path.endsWith('/meta')?meta:path==='/api/labels'?{count:4,results:catalog}:job;
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    }};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../extension/review-api.js'),'utf8')+';globalThis.run=CVATReviewRequest;',context);
  const request={origin:'https://cvat.test',path:'/tasks/1/jobs/12',action:'scan',required:[1,2,3,4]};
  return {calls,storage,context,request,run:async extra=>context.run({...request,...extra})};
}
test('API uses only fixed same-origin GETs, credentials and no redirect following',async()=>{const h=harness(),r=await h.run();assert(!r.error,r.error);assert.equal(h.calls.length,4);for(const {url,options} of h.calls){assert.equal(new URL(url).origin,'https://cvat.test');assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');}assert(!JSON.stringify(h.storage).includes('points'));assert.equal(Object.values(h.storage)[0].state,'done');});
for(const mediaType of ['application/vnd.cvat+json','application/json'])test(`content negotiation completes all review endpoints with ${mediaType}`,async()=>{
  const h=harness({fetch:(url,options)=>{
    const accepted=options.headers.Accept.split(',').map(part=>part.trim().split(';')[0]);
    if(!accepted.includes(mediaType))return new Response('{}',{status:406,headers:{'content-type':mediaType}});
    const path=new URL(url).pathname;
    const data=path.endsWith('/annotations')?base():path.endsWith('/meta')?meta:path==='/api/labels'?{count:4,results:catalog}:job;
    return new Response(JSON.stringify(data),{headers:{'content-type':mediaType+'; charset=utf-8'}});
  }});
  const r=await h.run();assert(!r.error,r.error);assert.equal(h.calls.length,4);assert.equal(r.report.total,100);assert.equal(r.report.missingCount,0);
});
test('opening catalog reads no annotation body',async()=>{const h=harness();const r=await h.run({action:'catalog'});assert.equal(r.catalog.length,4);assert.equal(h.calls.length,2);assert.equal(Object.keys(h.storage).length,0);});
test('changed tab path or origin makes zero network requests',async()=>{for(const extra of [{path:'/tasks/1/jobs/99'},{origin:'https://other.test'}]){const h=harness();assert((await h.run(extra)).error);assert.equal(h.calls.length,0);}});
test('API rejects response Job mismatch',async()=>{const h=harness({fetch:()=>new Response(JSON.stringify({...job,id:99}),{headers:{'content-type':'application/json'}})});assert((await h.run()).error);assert.equal(h.calls.length,1);assert.equal(Object.values(h.storage)[0].state,'error');});
for(const status of [401,403,404,406,429,500])test(`HTTP ${status} is failure, never zero missing`,async()=>{const h=harness({fetch:()=>new Response('{}',{status,headers:{'content-type':'application/json'}})});const r=await h.run();assert(r.error);assert(!r.report);assert.equal(Object.values(h.storage)[0].state,'error');assert.equal(h.calls.length,1);});
test('HTML login and malformed JSON fail closed without saving server text',async()=>{for(const response of [()=>new Response('<secret-login>'),()=>new Response('secret invalid json',{headers:{'content-type':'application/json'}})]){const h=harness({fetch:response});assert((await h.run()).error);assert(!JSON.stringify(h.storage).includes('secret'));}});
test('pagination is constructed locally and does not follow an external next URL',async()=>{const h=harness({fetch:(url)=>{const u=new URL(url);let data=job;if(u.pathname==='/api/labels')data={count:2,results:[catalog[Number(u.searchParams.get('page'))-1]],next:'https://evil.test/steal'};return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}});const r=await h.run({action:'catalog'});assert.equal(r.catalog.length,2);assert.equal(h.calls.length,3);assert(h.calls.every(c=>new URL(c.url).origin==='https://cvat.test'));});
test('broken pagination and duplicate labels are not accepted as complete',async()=>{const h=harness({fetch:(url)=>new Response(JSON.stringify(new URL(url).pathname==='/api/labels'?{count:4,results:[]}:job),{headers:{'content-type':'application/json'}})});assert((await h.run()).error);});
test('navigation during an API response discards the scan',async()=>{let h;h=harness({fetch:()=>{h.context.location.pathname='/tasks/1/jobs/99';return new Response(JSON.stringify(job),{headers:{'content-type':'application/json'}});}});assert((await h.run()).error);assert.equal(Object.values(h.storage)[0].state,'error');});
test('concurrent scan is rejected, running status is observable, finally releases lock',async()=>{const h=harness();let release;const original=h.context.fetch;h.context.fetch=async(...args)=>{await new Promise(resolve=>release=resolve);h.context.fetch=original;return original(...args);};const pending=h.run();await new Promise(resolve=>setImmediate(resolve));assert.equal((await h.run({action:'status'})).running,true);assert.match((await h.run()).error,/이미 검사/);release();assert(!(await pending).error);assert.equal((await h.run({action:'status'})).running,false);});
