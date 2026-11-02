const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createService}=require('../extension/prefetch-native.js');
const pause=()=>new Promise(r=>setImmediate(r));
global.location={origin:'http://cvat.test',pathname:'/tasks/1/jobs/18'};
function fixture(options={}){
  const f={calls:[],time:0,fail:false};
  const original=async(index,quality)=>{f.calls.push({index,quality});if(f.block)await f.block;if(f.fail)throw Error('HTTP 503');return new Uint8Array([index,22,33,44]).buffer;};
  const job={id:18,type:'annotation',dataChunkSize:2,dataChunkType:'imageset',startFrame:10,stopFrame:19,frames:{chunk:original,frameNumbers:async()=>[10,11,12,13,14,15,16,17,18,19]}};
  const a={job:{instance:job},player:{frame:{number:14},playing:false},annotations:{saving:{}}},store={getState:()=>({annotation:a})};
  const service=createService(()=>({job:a.job.instance,store}),{now:()=>f.time,wait:pause,...options});
  const run=(action,extra={})=>service.run({version:1,origin:location.origin,path:location.pathname,action,limit:512,...extra});
  Object.assign(f,{job,a,original,service,run});return f;
}
async function complete(f){for(let i=0;i<50;i++){await pause();const s=await f.run('status');if(!s.running)return s;}throw Error('did not finish');}
test('downloads all chunks once, current chunk first, without changing frame',async()=>{
 const f=fixture();await f.run('start');const s=await complete(f);assert.equal(s.cached,10);assert.equal(s.total,10);assert.deepEqual(f.calls.map(x=>x.index),[2,3,4,0,1]);assert.equal(f.a.player.frame.number,14);f.service.dispose();
});
test('CVAT native consumer reuses cache and gets independent transferable buffers',async()=>{
 const f=fixture();await f.run('start');await complete(f);const x=await f.job.frames.chunk(2,'compressed');structuredClone(x,{transfer:[x]});assert.equal(x.byteLength,0);const y=await f.job.frames.chunk(2,'compressed');assert.equal(y.byteLength,4);assert.equal(f.calls.length,5);assert.equal((await f.run('status')).hits,2);f.service.dispose();
});
test('original quality bypasses compressed cache',async()=>{
 const f=fixture();await f.run('start');await complete(f);await f.job.frames.chunk(2,'original');assert.equal(f.calls.length,6);assert.equal(f.calls.at(-1).quality,'original');f.service.dispose();
});
test('stop retains cache and resume only gets remaining chunks',async()=>{
 const f=fixture();await f.run('start');await f.run('stop');await pause();const s=await f.run('status');assert.equal(s.running,false);const before=f.calls.length;assert.equal(before,1);await f.run('start');assert.equal((await complete(f)).cached,10);assert.equal(f.calls.length,5);f.service.dispose();
});
test('clear restores native method, late response does not refill',async()=>{
 const f=fixture();let unblock;f.block=new Promise(r=>unblock=r);await f.run('start');await f.run('clear');assert.equal(f.job.frames.chunk,f.original);unblock();await pause();assert.equal((await f.run('status')).bytes,0);
});
test('background capacity stops and foreground uses bounded eviction',async()=>{
 const f=fixture({maxBytes:8});await f.run('start');let s=await complete(f);assert.equal(s.bytes,8);assert.equal(s.cached,4);assert.match(s.message,/한도/);await f.job.frames.chunk(0,'compressed');s=await f.run('status');assert.equal(s.bytes,8);assert.equal(s.cached,4);f.service.dispose();
});
test('oversized chunk is never retained but native still receives it',async()=>{
 const f=fixture({maxBytes:2});await f.run('start');const s=await complete(f);assert.equal(s.bytes,0);assert.equal((await f.job.frames.chunk(0,'compressed')).byteLength,4);f.service.dispose();
});
test('job identity change clears cache and restores original',async()=>{
 const f=fixture();await f.run('start');await complete(f);f.a.job.instance={...f.job,id:19};f.service.tick();assert.equal(f.job.frames.chunk,f.original);assert.equal((await f.run('status')).total,0);
});
test('same Job id with new native instance does not retain cache',async()=>{
 const f=fixture();await f.run('start');await complete(f);f.a.job.instance={...f.job};f.service.tick();assert.equal(f.job.frames.chunk,f.original);
});
test('context heartbeat timeout releases hook and memory',async()=>{
 const f=fixture();await f.run('start');await complete(f);f.time=11000;f.service.tick();assert.equal(f.job.frames.chunk,f.original);assert.equal((await f.run('status')).bytes,0);
});
test('network error stops without claiming completion, retry works',async()=>{
 const f=fixture();f.fail=true;await f.run('start');let s=await complete(f);assert.match(s.message,/503/);assert.equal(s.cached,0);f.fail=false;await f.run('start');s=await complete(f);assert.equal(s.cached,10);f.service.dispose();
});
test('foreground and background share pending download but not buffers',async()=>{
 const f=fixture();let unblock;f.block=new Promise(r=>unblock=r);await f.run('start');const consumer=f.job.frames.chunk(2,'compressed');await f.run('stop');unblock();const b=await consumer;assert.equal(f.calls.length,1);new Uint8Array(b)[0]=99;assert.equal(new Uint8Array(await f.job.frames.chunk(2,'compressed'))[0],2);f.service.dispose();
});
test('native frame fetch and save take priority over background',async()=>{
 const f=fixture();f.a.player.frame.fetching=true;await f.run('start');await pause();assert.equal(f.calls.length,0);f.a.player.frame.fetching=false;f.a.job.saving=true;await pause();assert.equal(f.calls.length,0);f.a.job.saving=false;await complete(f);assert.equal(f.calls.length,5);f.service.dispose();
});
test('missing native API fails closed without replacing method',async()=>{
 const f=fixture();delete f.job.frames.frameNumbers;assert.match((await f.run('start')).error,/연결/);assert.equal(f.job.frames.chunk,f.original);
});
test('invalid frame order fails before downloads',async()=>{
 const f=fixture();f.job.frames.frameNumbers=async()=>[10,12,11];assert.match((await f.run('start')).error,/목록/);assert.equal(f.calls.length,0);
});
test('sparse frame numbers use actual count and chunk indexes',async()=>{
 const f=fixture();f.job.frames.frameNumbers=async()=>[10,12,14];await f.run('start');const s=await complete(f);assert.equal(s.cached,3);assert.equal(s.total,3);assert.deepEqual(f.calls.map(x=>x.index),[1,0]);f.service.dispose();
});
test('ground truth pools do not use cache',async()=>{
 const f=fixture();f.job.type='ground_truth';assert.match((await f.run('start')).error,/annotation/);assert.equal(f.calls.length,0);
});
test('cross origin requests and invalid memory limits rejected',async()=>{
 const f=fixture();assert((await f.run('start',{origin:'http://other.test'})).error);assert((await f.run('start',{limit:9999})).error);assert.equal(f.calls.length,0);
});
test('clear during async preparation cancels start',async()=>{
 const f=fixture();let unblock;f.job.frames.frameNumbers=()=>new Promise(r=>unblock=r);const start=f.run('start');await f.run('clear');unblock([10,11]);assert((await start).error);assert.equal(f.job.frames.chunk,f.original);
});
test('cache entry expires without extending on hits',async()=>{
 const f=fixture();await f.run('start');await complete(f);f.time=29*60000;await f.job.frames.chunk(2,'compressed');f.time=31*60000;await f.job.frames.chunk(2,'compressed');assert.equal(f.calls.length,6);f.service.dispose();
});
test('dispose does not undo a later third party wrapper',async()=>{
 const f=fixture();await f.run('start');await complete(f);const replacement=()=>{};f.job.frames.chunk=replacement;f.service.dispose();assert.equal(f.job.frames.chunk,replacement);
});
