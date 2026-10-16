/* Serialized into MAIN. Only typed label edits on the current Job's native objects.
 * No HTTP writes, automatic save, object geometry transfer or persistent snapshots. */
async function CVATBulkEditNative(request) {
  'use strict';
  const slot='__cvatShortcutsBulkEditV1';
  let session,job,store,processed=0,mutating=false,shield=null;
  const valid=()=>window.top===window && /^https?:$/.test(location.protocol) && location.origin===request.origin && location.pathname===request.path;
  function state(){
    if(!valid())throw Error('Job이 바뀌었습니다. 편집 화면을 다시 열어주세요.');
    const a=store?.getState()?.annotation;
    if(a?.job?.instance!==job)throw Error('Job 연결이 바뀌었습니다. 다시 확인하세요.');
    return a;
  }
  function idle(){
    const a=state();
    if(a.workspace!=='Standard' || a.canvas?.ready!==true || a.canvas.instance?.mode?.()!=='idle' || a.job.fetching || a.job.saving || a.annotations?.saving?.uploading || a.player?.playing || a.player?.frame?.fetching || a.player?.navigationBlocked)throw Error('그리기·재생·저장을 마친 뒤 실행하세요.');
    return a;
  }
  function ranges(value,start,stop){
    if(value.scope==='all')return [[start,stop]];
    if(value.scope!=='range'||typeof value.frames!=='string'||value.frames.length>5000||!value.frames.trim())throw Error('프레임 번호 또는 구간을 입력하세요. 예: 3, 7, 20~40');
    const entries=value.frames.split(/[,;\n]/).map(part=>part.trim());
    if(entries.length>200)throw Error('한 번에 최대 200개 구간까지 지정할 수 있습니다.');
    const result=entries.map(part=>{
      const m=/^(\d+)(?:\s*[~\-–]\s*(\d+))?$/.exec(part);
      if(!m)throw Error('프레임 형식을 확인하세요. 예: 3, 7, 20~40');
      const a=Number(m[1]),b=Number(m[2]??m[1]);
      if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>b||a<start||b>stop)throw Error(`현재 Job의 ${start}~${stop} 범위 안에서 시작 ≤ 끝으로 입력하세요.`);
      return [a,b];
    }).sort((a,b)=>a[0]-b[0]);
    const merged=[];for(const pair of result){const last=merged.at(-1);if(last&&pair[0]<=last[1]+1)last[1]=Math.max(last[1],pair[1]);else merged.push(pair);}
    return merged;
  }
  async function snapshot(){
    const data=await job.annotations.export();state();
    if(!Array.isArray(data?.shapes)||!Array.isArray(data.tracks)||!Array.isArray(data.tags))throw Error('라벨링 데이터 형식을 확인할 수 없습니다.');
    const json=JSON.stringify(data);if(json.length>32*1024*1024)throw Error('라벨링 데이터가 커서 일괄 편집할 수 없습니다.');
    return {data,json};
  }
  async function refresh(){
    const a=state(),frame=a.player.frame.number,filters=a.annotations.filters;
    if(!Array.isArray(filters))throw Error('현재 CVAT 화면 갱신 방식을 확인할 수 없습니다.');
    const states=await job.annotations.get(frame,false,filters),history=await job.actions.get();
    if(state().player.frame.number!==frame)return;
    store.dispatch({type:'FETCH_ANNOTATIONS_SUCCESS',payload:{states,history,intervals:[]}});
    if(state().annotations.states!==states)throw Error('이 CVAT 버전의 화면 갱신을 확인하지 못했습니다.');
  }
  function labels(){
    if(!Array.isArray(job.labels)||job.labels.some(label=>!Number.isSafeInteger(label.id)||typeof label.name!=='string'))throw Error('현재 Job의 클래스 목록을 확인할 수 없습니다.');
    return job.labels.filter(label=>!label.hasParent);
  }
  function describeLabel(label){return {id:label.id,name:label.name,color:label.color,type:label.type};}
  function newToken(){
    // randomUUID is secure-context-only; LAN CVAT commonly uses plain HTTP.
    if(typeof globalThis.crypto?.getRandomValues!=='function')throw Error('확인용 ID를 만들 수 없습니다. Chrome을 업데이트하고 다시 시도하세요.');
    return Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  }
  function labelState(catalog){return JSON.stringify(catalog.map(l=>({id:l.id,type:l.type,attributes:l.attributes})));}
  function selectedLabels(catalog){
    if(!Array.isArray(request.labels)||!request.labels.length||request.labels.length>5000||request.labels.some(id=>!Number.isSafeInteger(id)||!catalog.some(label=>label.id===id)))throw Error('대상 라벨을 선택하세요.');
    return [...new Set(request.labels)].sort((a,b)=>a-b);
  }
  function merge(values){
    const result=[];for(const [a,b] of values.sort((x,y)=>x[0]-y[0])){const last=result.at(-1);if(last&&a<=last[1]+1)last[1]=Math.max(last[1],b);else result.push([a,b]);}return result;
  }
  function presence(data,ids,catalog){
    const rows=ids.map(id=>({...describeLabel(catalog.find(l=>l.id===id)),intervals:[],shapes:0,tracks:0})),byId=new Map(rows.map(r=>[r.id,r]));
    for(const shape of data.shapes){
      const row=byId.get(shape.label_id);if(!row)continue;
      if(!Number.isSafeInteger(shape.frame)||shape.frame<job.startFrame||shape.frame>job.stopFrame)throw Error('객체의 프레임 정보를 확인하지 못했습니다.');
      if(shape.type==='skeleton'||shape.elements?.length)throw Error('Skeleton은 일괄 편집을 지원하지 않습니다.');
      row.shapes++;row.intervals.push([shape.frame,shape.frame]);
    }
    for(const track of data.tracks){
      const row=byId.get(track.label_id);if(!row)continue;
      if(!Array.isArray(track.shapes)||!track.shapes.length)throw Error('Track의 키프레임을 확인하지 못했습니다.');
      const keys=track.shapes.slice().sort((a,b)=>a.frame-b.frame);row.tracks++;
      if(track.elements?.length||keys.some(k=>k.type==='skeleton'))throw Error('Skeleton은 일괄 편집을 지원하지 않습니다.');
      keys.forEach((key,i)=>{
        if(!Number.isSafeInteger(key.frame)||typeof key.outside!=='boolean'||i&&keys[i-1].frame===key.frame)throw Error('Track의 Outside·키프레임을 확인하지 못했습니다.');
        const a=Math.max(job.startFrame,key.frame),b=Math.min(job.stopFrame,i+1<keys.length?keys[i+1].frame-1:job.stopFrame);
        if(!key.outside&&a<=b)row.intervals.push([a,b]);
      });
    }
    const count=rows.reduce((n,r)=>n+r.shapes+r.tracks,0);
    if(count>20000)throw Error('한 번에 최대 20,000개 객체까지 스캔할 수 있습니다. 선택한 라벨 수를 줄이세요.');
    for(const row of rows){row.intervals=merge(row.intervals);row.frames=row.intervals.reduce((n,[a,b])=>n+b-a+1,0);}
    const intervals=merge(rows.flatMap(r=>r.intervals));
    return {rows,intervals,count,frames:intervals.reduce((n,[a,b])=>n+b-a+1,0)};
  }
  function verifyResult(plan,after){
    const before=JSON.parse(plan.json);
    if(JSON.stringify(before.tags)!==JSON.stringify(after.tags))throw Error('대상이 아닌 Tag의 변경을 감지했습니다.');
    for(const kind of ['shapes','tracks']){
      const selected=new Set(plan.identities[kind]);
      const expected=before[kind].filter(item=>plan.operation!=='delete'||!selected.has(item.id));
      if(after[kind].length!==expected.length)throw Error('적용 후 객체 수가 예상과 다릅니다.');
      for(let i=0;i<expected.length;i++){
        let original=expected[i],actual=after[kind][i];
        if(plan.operation==='relabel'&&selected.has(original.id)){
          if(actual.id!==original.id||actual.label_id!==plan.target.id)throw Error('객체의 새 라벨 적용을 확인하지 못했습니다.');
          // Native CVAT may reset class attributes and change source to manual.
          const structural=item=>JSON.parse(JSON.stringify(item,(key,value)=>key==='attributes'||key==='source'?undefined:value));
          original=structural(original);actual=structural(actual);original.label_id=plan.target.id;
        }
        if(JSON.stringify(original)!==JSON.stringify(actual))throw Error('적용 후 객체 모양 또는 대상 밖의 변경을 감지했습니다.');
      }
    }
  }
  function lockInput(){
    const host=document.createElement('div');host.id='cvat-shortcuts-bulk-busy';host.setAttribute('role','status');
    host.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#10223b88;color:white;display:grid;place-items:center;font:600 16px system-ui;';
    host.textContent='일괄 편집 중… 잠시 기다려주세요.';document.documentElement.append(host);
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
    const events=['keydown','keyup','keypress','pointerdown','pointerup','mousedown','mouseup','click','wheel'];
    for(const type of events)window.addEventListener(type,stop,{capture:true,passive:false});
    return ()=>{host.remove();for(const type of events)window.removeEventListener(type,stop,true);};
  }
  try{
    if(!valid()||!/^\/tasks\/\d+\/jobs\/\d+\/?$/.test(location.pathname)||!['catalog','scan','preview','apply'].includes(request.action))throw Error('올바른 CVAT 일괄 편집 요청이 아닙니다.');
    const side=document.querySelector('.cvat-canvas-controls-sidebar');
    for(let element=side;element instanceof Element&&!store;element=element.parentElement){
      const key=Object.getOwnPropertyNames(element).find(name=>/^__react(Fiber|InternalInstance)\$/.test(name));if(!key)continue;
      const seen=new Set();for(let f=element[key];f&&!seen.has(f)&&seen.size<200;f=f.return){seen.add(f);for(const candidate of [f.memoizedProps?.store,f.memoizedProps?.value?.store])if(typeof candidate?.getState==='function'&&typeof candidate.dispatch==='function'&&candidate.getState()?.annotation?.job){store=candidate;break;}if(store)break;}
    }
    job=store?.getState()?.annotation?.job?.instance;
    if(!job||String(job.id)!==location.pathname.match(/\/jobs\/(\d+)/)[1]||String(job.taskId)!==location.pathname.match(/\/tasks\/(\d+)/)[1]||job.dimension!=='2d'||!Number.isSafeInteger(job.startFrame)||!Number.isSafeInteger(job.stopFrame)||job.startFrame>job.stopFrame)throw Error('현재 2D Job의 편집 연결을 확인할 수 없습니다.');
    for(const name of ['export','get','hasUnsavedChanges'])if(typeof job.annotations?.[name]!=='function')throw Error('이 CVAT 버전에서는 일괄 편집을 사용할 수 없습니다.');
    if(typeof job.actions?.get!=='function')throw Error('CVAT 변경 이력을 확인할 수 없습니다.');
    const catalog=labels();
    if(globalThis[slot]?.busy)throw Error('이미 일괄 편집 중입니다.');
    if(request.action==='catalog')return {catalog:catalog.map(describeLabel),start:job.startFrame,stop:job.stopFrame,jobId:job.id};
    // Claim before the first await so two popup/overlay requests cannot interleave.
    if(request.action==='scan')globalThis[slot]=session={busy:true,scan:null,plan:null};
    else{session=globalThis[slot];if(!session)throw Error('먼저 선택 라벨을 스캔하세요.');session.busy=true;if(request.action==='preview')session.plan=null;}
    idle();
    if(await job.annotations.hasUnsavedChanges()!==false)throw Error('먼저 CVAT에서 작업을 저장한 뒤 대상을 다시 확인하세요.');
    idle();
    if(request.action==='scan'){
      const ids=selectedLabels(catalog),{data,json}=await snapshot(),result=presence(data,ids,catalog),token=newToken();idle();
      session.scan={token,created:Date.now(),job,origin:request.origin,path:request.path,json,ids,labelState:labelState(catalog)};
      const owner=session;setTimeout(()=>{if(owner.scan?.token===token)owner.scan=null;},300000);
      return {...result,token,jobId:job.id};
    }
    if(request.action==='preview'){
      if(!['delete','relabel'].includes(request.operation))throw Error('삭제 또는 라벨 변경을 선택하세요.');
      const ids=selectedLabels(catalog),scan=session.scan;
      if(!scan||scan.token!==request.scanToken||scan.job!==job||scan.origin!==request.origin||scan.path!==request.path||Date.now()-scan.created>300000||JSON.stringify(ids)!==JSON.stringify(scan.ids))throw Error('스캔 결과가 없거나 만료됐습니다. 선택 라벨을 다시 스캔하세요.');
      const chosen=new Set(ids),target=request.operation==='relabel'?catalog.find(label=>label.id===request.target):null;
      if(request.operation==='relabel'&&(!target||chosen.has(target.id)))throw Error('대상 라벨과 다른 변경 후 라벨을 선택하세요.');
      const intervals=ranges(request,job.startFrame,job.stopFrame),contains=f=>intervals.some(([a,b])=>f>=a&&f<=b);
      const {data,json}=await snapshot();
      if(json!==scan.json||labelState(catalog)!==scan.labelState)throw Error('스캔 후 라벨링·클래스가 바뀌었습니다. 저장하고 다시 스캔하세요.');
      const shapes=data.shapes.filter(s=>chosen.has(s.label_id)&&contains(s.frame));
      const tracks=data.tracks.filter(t=>chosen.has(t.label_id));
      if(shapes.some(s=>!Number.isSafeInteger(s.frame))||tracks.some(t=>!Array.isArray(t.shapes)||t.shapes.some(s=>!Number.isSafeInteger(s.frame))))throw Error('객체의 프레임 정보를 확인하지 못했습니다.');
      if(tracks.length&&request.scope!=='all')throw Error('선택한 라벨에 Track이 있습니다. Track은 구간 밖에도 연결되어 있어 현재 Job 전체 범위에서만 편집할 수 있습니다.');
      if(shapes.some(s=>s.type==='skeleton')||tracks.some(t=>t.shapes?.some(s=>s.type==='skeleton')))throw Error('Skeleton은 일괄 편집을 지원하지 않습니다.');
      const frameSet=new Set(shapes.map(s=>s.frame));
      for(const track of tracks){frameSet.add(job.stopFrame);for(const s of track.shapes||[])if(s.frame>=job.startFrame&&s.frame<=job.stopFrame)frameSet.add(s.frame);}
      if(frameSet.size>20000||shapes.length+tracks.length>20000)throw Error('한 번에 최대 20,000개 객체·프레임까지 확인할 수 있습니다. 범위를 줄이세요.');
      const objects=new Map();
      for(const frame of [...frameSet].sort((a,b)=>a-b)){
        idle();const values=await job.annotations.get(frame,true,[]);idle();
        if(!Array.isArray(values))throw Error('객체 목록을 확인할 수 없습니다.');
        for(const object of values){
          if(!chosen.has(object.label?.id)||!['shape','track'].includes(object.objectType)||object.objectType==='shape'&&!contains(object.frame))continue;
          if(!Number.isSafeInteger(object.clientID)||object.parentID!=null||object.isGroundTruth||object.lock)throw Error('잠금·보호 객체가 포함되어 있습니다. CVAT에서 확인하고 잠금을 해제한 뒤 다시 시도하세요.');
          if(object.shapeType==='skeleton'||typeof object.delete!=='function'||typeof object.save!=='function')throw Error('지원하지 않는 객체 형식이 포함되어 있습니다.');
          if(target&&target.type!=='any'&&target.type!==object.shapeType)throw Error(`변경 후 라벨 '${target.name}'은 ${object.shapeType} 객체에 사용할 수 없습니다.`);
          objects.set(object.clientID,object);
        }
      }
      if(objects.size!==shapes.length+tracks.length)throw Error('전체 대상 객체를 확인하지 못했습니다. 삭제된 프레임 또는 CVAT 버전을 확인하세요. 아무것도 변경하지 않았습니다.');
      const identities={shapes:shapes.map(s=>s.id),tracks:tracks.map(t=>t.id)};
      for(const [kind,ids] of Object.entries(identities)){
        const idSet=new Set(ids);
        const native=[...objects.values()].filter(o=>o.objectType===(kind==='shapes'?'shape':'track')).map(o=>o.serverID);
        if(ids.some(id=>!Number.isSafeInteger(id))||idSet.size!==ids.length||native.length!==ids.length||new Set(native).size!==native.length||native.some(id=>!idSet.has(id)))throw Error('저장된 객체 ID와 편집 대상을 일치시킬 수 없습니다.');
      }
      if((await snapshot()).json!==json)throw Error('확인 중 라벨링이 바뀌었습니다. 다시 확인하세요.');
      await refresh();idle();
      const token=newToken(),summary={token,operation:request.operation,jobId:job.id,range:intervals.map(([a,b])=>a===b?String(a):`${a}~${b}`).join(', '),count:objects.size,shapes:shapes.length,tracks:tracks.length,labels:catalog.filter(l=>chosen.has(l.id)).map(describeLabel),target:target?describeLabel(target):null};
      if(objects.size)session.plan={token,created:Date.now(),origin:request.origin,path:request.path,job,json,identities,objects:[...objects.values()],target,operation:request.operation,summary,labelState:labelState(catalog)};
      const owner=session;setTimeout(()=>{if(owner.plan?.token===token)owner.plan=null;},300000);
      return summary;
    }
    session=globalThis[slot];const plan=session?.plan;
    if(!plan||typeof request.token!=='string'||plan.token!==request.token||request.confirm!==true||plan.job!==job||plan.origin!==request.origin||plan.path!==request.path||Date.now()-plan.created>300000)throw Error('대상 확인이 만료됐습니다. 다시 확인한 뒤 적용하세요.');
    session.busy=true;session.plan=null;session.scan=null;
    if((await snapshot()).json!==plan.json||labelState(catalog)!==plan.labelState)throw Error('대상 확인 후 라벨링·클래스가 바뀌었습니다. 다시 확인하세요.');
    idle();shield=lockInput();
    // Re-read states to catch lock changes, which do not appear in annotation exports.
    const fresh=new Map();for(const frame of new Set(plan.objects.map(o=>o.frame))){const values=await job.annotations.get(frame,true,[]);for(const object of values)fresh.set(object.clientID,object);}
    const objects=plan.objects.map(old=>{const object=fresh.get(old.clientID);if(!object||object.lock||object.isGroundTruth||object.label.id!==old.label.id)throw Error('대상 객체 상태가 바뀌었습니다. 다시 확인하세요.');return object;});
    idle();
    if((await snapshot()).json!==plan.json||await job.annotations.hasUnsavedChanges()!==false)throw Error('확인 중 라벨링이 바뀌었습니다. 다시 확인하세요.');
    mutating=true;
    for(const object of objects){
      idle();
      if(plan.operation==='delete'){if(await object.delete(object.frame,false)!==true)throw Error('객체 삭제를 확인하지 못했습니다.');}
      else{object.label=plan.target;await object.save();}
      processed++;
    }
    verifyResult(plan,(await snapshot()).data);
    await refresh();
    return {applied:processed,operation:plan.operation,needsSave:true,jobId:job.id};
  }catch(error){
    let refreshError='';if(mutating)try{await refresh();}catch{refreshError=' 화면 갱신도 확인하지 못했습니다.';}
    return {error:(mutating?`완료를 확정하지 못했습니다(처리 응답 ${processed}개). CVAT에서 결과와 되돌리기를 확인하세요. `:'')+(error.message||'일괄 편집 실패')+refreshError,partial:mutating,applied:processed};
  }finally{shield?.();if(session)session.busy=false;}
}
