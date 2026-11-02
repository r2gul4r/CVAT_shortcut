/* MAIN: compressed Job chunks only. Native CVAT remains responsible for decoding. */
(() => {
  'use strict';
  const EVENT='cvat-shortcuts-prefetch-v1',MiB=1024*1024;
  // Resolve independently: a previous MAIN-world module can survive extension reload.
  function resolveContext(){
    const match=/^\/tasks\/(\d+)\/jobs\/(\d+)\/?$/.exec(location.pathname);
    if(window.top!==window||!match||!/^https?:$/.test(location.protocol))throw Error('CVAT Job 화면에서 이미지 미리 받기를 사용하세요.');
    const sides=document.querySelectorAll('.cvat-canvas-controls-sidebar');
    if(sides.length!==1)throw Error('CVAT 작업 화면을 확인하지 못했습니다. Job을 연 뒤 다시 시도하세요.');
    for(let node=sides[0];node instanceof Element;node=node.parentElement){
      const key=Object.getOwnPropertyNames(node).find(k=>/^__react(Fiber|InternalInstance)\$/.test(k)),seen=new Set();
      for(let fiber=key&&node[key];fiber&&!seen.has(fiber)&&seen.size<200;fiber=fiber.return){
        seen.add(fiber);
        for(const store of [fiber.memoizedProps?.store,fiber.memoizedProps?.value?.store]){
          const job=store?.getState?.()?.annotation?.job?.instance;
          if(typeof store?.dispatch==='function'&&String(job?.id)===match[2]&&String(job?.taskId)===match[1]&&job.dimension==='2d'&&Number.isSafeInteger(job.startFrame)&&Number.isSafeInteger(job.stopFrame))return {store,job};
        }
      }
    }
    throw Error('현재 CVAT Job의 이미지 연결을 확인하지 못했습니다. 작업을 저장하고 페이지를 새로고침한 뒤 다시 시도하세요.');
  }
  function createService(resolve,{now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxBytes=null}={}){
    let session=null,serial=0,preparing=false;
    function current(s){try{return session===s&&s.path===location.pathname&&s.origin===location.origin&&resolve().job===s.job;}catch{return false;}}
    function dispose(){
      const s=session;if(!s)return;session=null;s.run++;s.generation++;s.running=false;s.cache.clear();s.bytes=0;
      if(s.job.frames.chunk===s.wrapper)s.job.frames.chunk=s.original;
    }
    function trim(s){for(const [key,row]of s.cache)if(now()-row.at>30*60*1000){s.cache.delete(key);s.bytes-=row.data.byteLength;}}
    function snapshot(){
      const s=session;if(!s)return {running:false,cached:0,total:0,bytes:0,hits:0,message:'현재 Job의 이미지를 미리 받아 프레임 이동에 재사용합니다.'};
      trim(s);let cached=0;for(const index of s.cache.keys())cached+=Math.min(s.chunkSize,s.numbers.length-index*s.chunkSize);
      return {jobId:s.job.id,running:s.running,cached,total:s.numbers.length,bytes:s.bytes,limit:s.limit,hits:s.hits,message:s.message};
    }
    async function load(s,index,background=false){
      trim(s);
      const hit=s.cache.get(index);
      if(hit){s.cache.delete(index);s.cache.set(index,hit);if(!background)s.hits++;return hit.data.slice(0);}
      let promise=s.pending.get(index);
      if(!promise){
        const generation=s.generation;
        promise=(async()=>{
          const data=await s.original.call(s.job.frames,index,'compressed');
          if(!(data instanceof ArrayBuffer)||!data.byteLength)throw Error('CVAT 이미지 묶음 응답을 확인하지 못했습니다.');
          if(current(s)&&generation===s.generation){
            if(data.byteLength>s.limit||(background&&s.bytes+data.byteLength>s.limit)){
              s.message='캐시 한도에 도달했습니다. 받은 이미지는 재사용합니다. 더 받으려면 한도를 늘리세요.';
              s.running=false;s.run++;
            }else{
              while(s.bytes+data.byteLength>s.limit&&s.cache.size){const key=s.cache.keys().next().value;s.bytes-=s.cache.get(key).data.byteLength;s.cache.delete(key);}
              // CVAT's decoder transfers/detaches buffers: never lend the retained buffer.
              const copy=data.slice(0);s.cache.set(index,{data:copy,at:now()});s.bytes+=copy.byteLength;
            }
          }
          return data;
        })();
        s.pending.set(index,promise);
        void promise.finally(()=>{if(s.pending.get(index)===promise)s.pending.delete(index);}).catch(()=>{});
      }
      return (await promise).slice(0);
    }
    async function pump(s,run){
      try{
        const count=Math.ceil(s.numbers.length/s.chunkSize),visited=new Set();
        while(current(s)&&s.running&&run===s.run){
          const a=s.store.getState().annotation;
          if(a.job.fetching||a.job.saving||a.annotations?.saving?.uploading||a.player.frame.fetching||a.player.playing){s.message='현재 프레임·저장 작업이 끝나면 이어서 받습니다.';await wait(500);continue;}
          trim(s);
          const pos=s.numbers.indexOf(a.player.frame.number),first=pos<0?0:Math.floor(pos/s.chunkSize);
          let next=-1;for(let offset=0;offset<count;offset++){const index=(first+offset)%count;if(!s.cache.has(index)&&!visited.has(index)){next=index;break;}}
          if(next<0){s.running=false;s.message='미리 받기를 완료했습니다. 프레임 이동 시 캐시를 재사용합니다.';break;}
          s.message='백그라운드에서 이미지를 받는 중…';visited.add(next);
          await load(s,next,true);
          await wait(150);
        }
      }catch(error){if(current(s)&&run===s.run){s.running=false;s.message=`미리 받기 중단: ${error.message||'이미지 요청 실패'}. 다시 시작하면 남은 부분을 받습니다.`;}}
    }
    async function start(limit){
      if(preparing)throw Error('미리 받기를 준비 중입니다.');
      if(![256,512,1024].includes(limit))throw Error('캐시 한도를 선택하세요.');
      preparing=true;
      try{
        const ctx=resolve(),job=ctx.job,path=location.pathname,origin=location.origin;
        if(session&&!current(session))dispose();
        if(session){
          const s=session;if(s.running)return snapshot();
          s.limit=maxBytes??limit*MiB;while(s.bytes>s.limit&&s.cache.size){const key=s.cache.keys().next().value;s.bytes-=s.cache.get(key).data.byteLength;s.cache.delete(key);}
          s.running=true;s.lease=now();void pump(s,++s.run);return snapshot();
        }
        if(typeof job.frames?.chunk!=='function'||typeof job.frames?.frameNumbers!=='function'||!Number.isSafeInteger(job.dataChunkSize)||job.dataChunkSize<1||!['imageset','video'].includes(job.dataChunkType))throw Error('이 CVAT 버전의 이미지 미리 받기 연결을 확인하지 못했습니다.');
        // Ground-truth pools can substitute source frames during a session.
        if(job.type&&job.type!=='annotation')throw Error('이미지 미리 받기는 일반 annotation Job에서 사용하세요.');
        const generation=serial,numbers=await job.frames.frameNumbers();
        if(generation!==serial||resolve().job!==job||location.pathname!==path||location.origin!==origin)throw Error('Job이 바뀌었습니다. 다시 시작하세요.');
        if(!Array.isArray(numbers)||!numbers.length||numbers.length>1000000||numbers.some((n,i)=>!Number.isSafeInteger(n)||n<job.startFrame||n>job.stopFrame||(i&&n<=numbers[i-1])))throw Error('Job 프레임 목록을 확인하지 못했습니다.');
        const s={...ctx,path,origin,numbers:[...numbers],chunkSize:job.dataChunkSize,original:job.frames.chunk,cache:new Map(),pending:new Map(),bytes:0,hits:0,limit:maxBytes??limit*MiB,run:1,generation:0,running:true,lease:now(),message:'준비 중…'};
        s.wrapper=function(index,quality,...rest){
          if(!current(s)){if(session===s)dispose();return s.original.call(this,index,quality,...rest);}
          if(quality!=='compressed'||rest.length||!Number.isSafeInteger(index)||index<0||index>=Math.ceil(s.numbers.length/s.chunkSize))return s.original.call(this,index,quality,...rest);
          return load(s,index);
        };
        job.frames.chunk=s.wrapper;
        if(job.frames.chunk!==s.wrapper)throw Error('CVAT 이미지 캐시를 연결하지 못했습니다.');
        session=s;void pump(s,s.run);return snapshot();
      }finally{preparing=false;}
    }
    function tick(){if(session&&(!current(session)||now()-session.lease>10000))dispose();}
    async function run(req){
      try{
        if(req?.version!==1||req.origin!==location.origin||req.path!==location.pathname)throw Error('현재 Job의 요청이 아닙니다.');
        tick();if(session)session.lease=now();
        if(req.action==='start')return await start(req.limit);
        if(req.action==='stop'){serial++;if(session){session.running=false;session.run++;session.message='중지했습니다. 이미 받은 이미지는 계속 재사용합니다.';}}
        else if(req.action==='clear'||req.action==='release'){serial++;dispose();}
        else if(req.action!=='status')throw Error('올바른 이미지 미리 받기 요청이 아닙니다.');
        return snapshot();
      }catch(error){return {...snapshot(),error:error.message||'이미지 미리 받기 실패'};}
    }
    return {run,tick,dispose};
  }
  if(typeof module==='object'&&module.exports){module.exports={createService,resolveContext};return;}
  if(globalThis.__cvatShortcutsPrefetchV1)return;globalThis.__cvatShortcutsPrefetchV1=true;
  const service=createService(resolveContext);
  setInterval(service.tick,1000);window.addEventListener('pagehide',service.dispose);
  document.addEventListener(EVENT,async event=>{
    const node=event.target;if(!(node instanceof HTMLSpanElement)||!node.hidden||node.parentElement!==document.body)return;
    const raw=node.getAttribute('data-request');if(!raw||raw.length>1000)return;
    let value;try{value=await service.run(JSON.parse(raw));}catch{value={error:'미리 받기 요청을 읽지 못했습니다.'};}
    if(node.isConnected)node.setAttribute('data-response',JSON.stringify(value));
  },true);
})();
