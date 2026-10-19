/* Serialized by chrome.scripting into the Job's ISOLATED world on user action.
 * Only fixed, same-origin GET endpoints. Full annotation bodies never leave this
 * world: the popup/storage receive label metadata and compact matching frame ranges. */
async function CVATReviewRequest(request) {
  'use strict';
  const match=/^\/tasks\/(\d+)\/jobs\/(\d+)\/?$/.exec(location.pathname);
  const valid=()=>window.top===window && /^https?:$/.test(location.protocol) && match && location.origin===request.origin && location.pathname===request.path;
  if(!valid())return {error:'CVAT Job 탭이 바뀌었습니다. 팝업을 다시 열어주세요.'};
  if(!['catalog','scan','status'].includes(request.action))return {error:'지원하지 않는 검수 요청입니다.'};
  if(request.action==='scan'&&!['missing','present'].includes(request.mode??'missing'))return {error:'지원하지 않는 라벨 검사 방식입니다.'};
  const taskId=Number(match[1]),jobId=Number(match[2]), key=`cvatReviewReportV1:${location.origin}${location.pathname.replace(/\/$/,'')}`;
  const lockKey='__cvatShortcutsReviewRunV1';
  if(request.action==='status')return {running:Boolean(globalThis[lockKey]?.running),key};
  if(globalThis[lockKey]?.running)return {error:'이 탭에서 이미 검사 중입니다.'};
  const run={running:true};if(request.action==='scan')globalThis[lockKey]=run;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);
  let started=false;
  async function get(path) {
    if(!valid())throw Error('검사 도중 Job이 바뀌었습니다. 다시 검사하세요.');
    let response;
    // CVATAPIRenderer uses vendor JSON; plain application/json alone causes 406.
    // Also accept ordinary JSON for compatible deployments, without extra requests.
    try {response=await fetch(new URL(path,location.origin).href,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/vnd.cvat+json, application/json;q=0.9'}});}
    catch {throw Error(controller.signal.aborted?'조회 시간이 초과되었습니다. 연결 상태를 확인하세요.':'CVAT 조회에 실패했습니다. 연결·로그인 상태를 확인하세요.');}
    if(!response.ok)throw Error(response.status===401||response.status===403?'이 Job의 조회 권한 또는 로그인을 확인하세요.':`CVAT 조회 실패 (HTTP ${response.status}).`);
    if(!/\bjson\b/i.test(response.headers.get('content-type')||''))throw Error('CVAT가 JSON 대신 로그인 화면 또는 다른 내용을 반환했습니다.');
    // Bound memory on corrupt/very large responses, including chunked bodies.
    const reader=response.body.getReader(),chunks=[];let length=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>64*1024*1024){await reader.cancel();throw Error('라벨링 데이터가 64MB를 넘어 검사할 수 없습니다.');}chunks.push(value);}}
    catch(error){throw Error(controller.signal.aborted?'조회 시간이 초과되었습니다.':error.message);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('CVAT 응답 형식을 확인할 수 없습니다.');}
    if(!valid())throw Error('조회 도중 Job이 바뀌었습니다. 다시 검사하세요.');
    return data;
  }
  try {
    if(!globalThis.CVATReviewCore)throw Error('검수 모듈을 다시 불러와주세요.');
    if(request.action==='scan'){await chrome.storage.local.set({[key]:{state:'running',startedAt:Date.now()}});started=true;}
    const job=await get(`/api/jobs/${jobId}`);
    if(job?.id!==jobId || job.task_id!==taskId || job.dimension!=='2d')throw Error('현재 2D Job과 응답 정보가 일치하지 않습니다.');
    let raw=[];
    if(Array.isArray(job.labels))raw=job.labels;
    else {
      // Do not follow response.next URLs: page numbers are built locally.
      for(let page=1;page<=50;page++){
        const data=await get(`/api/labels?job_id=${jobId}&page_size=100&page=${page}`);
        if(!Array.isArray(data?.results) || !Number.isSafeInteger(data.count) || data.count<0 || data.count>5000)throw Error('현재 Job의 라벨 목록을 확인할 수 없습니다.');
        raw.push(...data.results);
        if(raw.length===data.count)break;
        if(!data.results.length || raw.length>data.count || page===50)throw Error('전체 라벨 목록을 받지 못했습니다.');
      }
    }
    const catalog=globalThis.CVATReviewCore.labels(raw);
    if(request.action==='catalog')return {catalog,key,jobId};
    const meta=await get(`/api/jobs/${jobId}/data/meta`);
    const annotations=await get(`/api/jobs/${jobId}/annotations`);
    const report=globalThis.CVATReviewCore.inspect(job,meta,annotations,catalog,request.required,request.mode??'missing');
    if(!valid())throw Error('검사 도중 Job이 바뀌었습니다. 다시 검사하세요.');
    if(JSON.stringify(report).length>2000000)throw Error('검사 결과가 너무 큽니다. 선택 라벨 수를 줄여 검사하세요.');
    await chrome.storage.local.set({[key]:{state:'done',report}});
    return {report,key};
  }catch(error){
    const message=error.message||'검사에 실패했습니다.';
    if(started)try{await chrome.storage.local.set({[key]:{state:'error',error:message}});}catch{/* Caller also receives the error. */}
    return {error:message};
  }finally{clearTimeout(timeout);run.running=false;}
}
