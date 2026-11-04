/* MAIN: native CVAT grouping, original-coordinate containment; no HTTP writes. */
(() => {
  'use strict';
  // Keep new requests separate from anonymous handlers left by older extensions.
  const EVENT='cvat-shortcuts-group-2.15.4';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const groupID=o=>o.group?.id;
  function boxValid(b){return Array.isArray(b.points)&&b.points.length===4&&b.points.every(Number.isFinite)&&b.points[2]>b.points[0]&&b.points[3]>b.points[1]&&Number.isFinite(b.rotation);}
  function inside(box,point){
    const [x1,y1,x2,y2]=box.points,cx=(x1+x2)/2,cy=(y1+y2)/2,r=-box.rotation*Math.PI/180;
    const dx=point[0]-cx,dy=point[1]-cy,x=cx+dx*Math.cos(r)-dy*Math.sin(r),y=cy+dx*Math.sin(r)+dy*Math.cos(r),eps=1e-7;
    return x>=x1-eps&&x<=x2+eps&&y>=y1-eps&&y<=y2+eps;
  }
  function joints(s){
    if(!Array.isArray(s.elements)||!s.elements.length||s.elements.length>1000)return null;
    if(s.elements.some(e=>e.shapeType!=='points'||e.outside!==false||!Array.isArray(e.points)||e.points.length!==2||!e.points.every(Number.isFinite)))return null;
    return s.elements.map(e=>e.points);
  }
  function protectedObject(o){return o.lock||o.isGroundTruth||o.elements?.some(e=>e.lock||e.isGroundTruth);}
  const EPS=1e-7;
  function segment(a,b,p){const cross=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);return Math.abs(cross)<=EPS*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
  function polygonPoints(o){
    const p=o.points;
    if(!Array.isArray(p)||p.length<6||p.length%2||!p.every(Number.isFinite))return {reason:'폴리곤 좌표를 읽을 수 없음'};
    if(p.length>2002)return {reason:'폴리곤 꼭짓점 수가 1,001개를 초과함'};
    if(o.rotation!=null&&o.rotation!==0)return {reason:'폴리곤 회전 미지원'};
    // Normalize only the temporary membership geometry; never edit annotations.
    const v=[];for(let i=0;i<p.length;i+=2){const last=v.at(-1);if(!last||last[0]!==p[i]||last[1]!==p[i+1])v.push([p[i],p[i+1]]);}
    while(v.length>1&&v[0][0]===v.at(-1)[0]&&v[0][1]===v.at(-1)[1])v.pop();
    if(v.length<3)return {reason:'폴리곤의 서로 다른 꼭짓점이 부족함'};
    const a=v[0],b=v[1];
    if(!v.slice(2).some(c=>Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>EPS*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))))return {reason:'폴리곤 꼭짓점이 한 직선에 있음'};
    return {vertices:v};
  }
  function insidePolygon(vertices,p){
    // CVAT SVG polygons use nonzero fill, including self-crossing contours.
    let winding=0;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
      const a=vertices[j],b=vertices[i];if(segment(a,b,p))return true;
      const side=(b[0]-a[0])*(p[1]-a[1])-(p[0]-a[0])*(b[1]-a[1]);
      if(a[1]<=p[1]){if(b[1]>p[1]&&side>0)winding++;}
      else if(b[1]<=p[1]&&side<0)winding--;
    }return winding!==0;
  }
  function planFrame(states,frame){
    if(!Array.isArray(states)||states.length>20000)throw Error('한 프레임의 객체 목록이 너무 크거나 읽을 수 없습니다.');
    const objects=states.filter(o=>o.parentID==null&&o.outside!==true&&['rectangle','polygon','skeleton'].includes(o.shapeType));
    if(objects.some(o=>!Number.isSafeInteger(o.clientID)||o.frame!==frame)||new Set(objects.map(o=>o.clientID)).size!==objects.length)throw Error('객체 ID 또는 프레임을 확인하지 못했습니다.');
    const allContainers=objects.filter(o=>o.shapeType!=='skeleton'),containers=[],skeletons=objects.filter(o=>o.shapeType==='skeleton'),groups=[],skipped=[],invalid=[],occupied=new Set();
    let work=0;const spend=n=>{work+=n;if(work>5000000)throw Error('포함 관계가 너무 많습니다. 프레임의 객체 수나 폴리곤 꼭짓점 수를 줄여서 실행하세요.');};
    const polygons=new Map(),note=(o,reason)=>skipped.push({frame,id:o.clientID,reason});
    for(const c of allContainers){
      let reason='';
      if(c.shapeType==='polygon'){const parsed=polygonPoints(c);reason=parsed.reason||'';if(parsed.vertices)polygons.set(c,parsed.vertices);}
      else if(!boxValid(c))reason='박스 좌표 오류';
      if(reason){invalid.push({frame,id:c.clientID,reason});continue;}
      containers.push(c);
    }
    const byContainer=new Map(),hitsBySkeleton=new Map();
    for(const s of skeletons){
      const points=joints(s);if(!points){note(s,'관절 좌표·Outside 확인 필요');continue;}
      const center=[0,1].map(axis=>(Math.min(...points.map(p=>p[axis]))+Math.max(...points.map(p=>p[axis])))/2);
      const hits=containers.filter(c=>{
        const poly=polygons.get(c),contains=p=>{spend(poly?.length||1);return poly?insidePolygon(poly,p):inside(c,p);};
        // A partially visible barcode can have its center outside the container.
        return contains(center)||points.some(contains);
      });
      if(!hits.length){note(s,'스켈레톤 중심·모든 관절이 박스·폴리곤 밖');continue;}
      hitsBySkeleton.set(s,hits);for(const c of hits){occupied.add(c);const list=byContainer.get(c)||[];list.push(s);byContainer.set(c,list);}
    }
    const seen=new Set();
    for(const first of containers){
      if(seen.has(first)||!byContainer.has(first))continue;
      const cs=[],children=new Set(),queue=[first];seen.add(first);
      for(let cursor=0;cursor<queue.length;cursor++){
        const c=queue[cursor];cs.push(c);for(const s of byContainer.get(c)||[]){children.add(s);for(const next of hitsBySkeleton.get(s)){if(!seen.has(next)){seen.add(next);queue.push(next);}}}
      }
      const boxes=cs.filter(c=>c.shapeType==='rectangle'),polys=cs.filter(c=>c.shapeType==='polygon'),members=[...cs,...children];
      let reason=members.some(o=>o.objectType!=='shape')?'Track 제외':members.some(protectedObject)?'잠금·보호 객체':'';
      const existing=[...new Set(members.map(groupID).filter(id=>id>0))];
      if(!reason&&members.some(o=>!Number.isSafeInteger(groupID(o))||groupID(o)<0))reason='그룹 번호 확인 필요';
      // Existing membership elsewhere does not block regrouping the matched objects.
      if(!reason&&existing.length===1&&members.every(o=>groupID(o)===existing[0]))reason='이미 같은 그룹';
      if(reason){for(const s of children)note(s,reason);continue;}
      const group={frame,
        ...(boxes.length===1?{box:boxes[0].clientID}:boxes.length?{boxes:boxes.map(o=>o.clientID)}:{}),
        ...(polys.length===1?{polygon:polys[0].clientID}:polys.length?{polygons:polys.map(o=>o.clientID)}:{}),
        skeletons:[...children].map(s=>s.clientID)};
      if(existing.length)group.previousGroups=existing;
      groups.push(group);
    }
    return {groups,skipped,invalid,empty:containers.filter(c=>!occupied.has(c)).length,boxes:allContainers.length,skeletons:skeletons.length};
  }

  function signature(states){
    const describe=o=>({id:o.clientID,server:o.serverID,parent:o.parentID,type:o.objectType,shape:o.shapeType,frame:o.frame,label:o.label?.id,points:o.points,rotation:o.rotation,outside:o.outside,lock:o.lock,gt:o.isGroundTruth,group:groupID(o),elements:o.elements?.map(describe)});
    return JSON.stringify(states.map(describe));
  }
  function createService(resolve,lockInput){
    let busy=false,plan=null;
    return async function run(req,alive=()=>true){
      if(busy)return {error:'이미 그룹화 작업 중입니다.'};
      busy=true;let unlock,changed=0,started=false,ctx,initial,originalPath;
      const state=()=>ctx.store.getState().annotation;
      function check(){
        const a=state();
        if(!alive()||location.origin!==req.origin||location.pathname!==originalPath||a.job.instance!==ctx.job||a.player.frame.number!==initial)throw Error('Job·프레임 또는 실행 창이 바뀌었습니다. 다시 검사하세요.');
        if(a.workspace!=='Standard'||a.canvas?.ready!==true||a.canvas.instance?.mode?.()!=='idle'||a.job.fetching||a.job.saving||a.annotations?.saving?.uploading||a.player.playing||a.player.frame.fetching||a.player.navigationBlocked)throw Error('그리기·재생·저장을 마친 뒤 실행하세요.');
        if(a.player.frame.data?.deleted)throw Error('삭제된 프레임에서는 실행할 수 없습니다.');
      }
      async function snapshot(){const value=await ctx.job.annotations.export();check();if(!Array.isArray(value?.shapes)||!Array.isArray(value.tracks)||!Array.isArray(value.tags))throw Error('주석 데이터를 확인하지 못했습니다.');const json=JSON.stringify(value);if(json.length>32*1024*1024)throw Error('주석 데이터가 너무 커서 그룹화할 수 없습니다.');return {value,json};}
      async function read(frame){
        check();const meta=await ctx.job.frames.get(frame);check();
        if(typeof meta?.deleted!=='boolean')throw Error('삭제 프레임 정보를 확인하지 못했습니다.');
        if(meta.deleted)return null;
        const objects=await ctx.job.annotations.get(frame,false,[]);check();return objects;
      }
      async function refresh(){
        check();const a=state();if(!Array.isArray(a.annotations.filters))throw Error('화면 필터를 확인하지 못했습니다.');
        const states=await ctx.job.annotations.get(initial,false,a.annotations.filters),history=await ctx.job.actions.get();check();
        ctx.store.dispatch({type:'FETCH_ANNOTATIONS_SUCCESS',payload:{states,history,intervals:[]}});
        if(state().annotations.states!==states)throw Error('이 CVAT 버전의 화면 갱신을 확인하지 못했습니다.');
      }
      try{
        if(!req||req.version!==1||!['preview','apply','cancel'].includes(req.action)||req.origin!==location.origin||req.path!==location.pathname)throw Error('올바른 그룹화 요청이 아닙니다.');
        if(req.action==='cancel'){plan=null;return {cancelled:true};}
        ctx=resolve();originalPath=req.path;initial=state().player.frame.number;
        for(const key of ['export','get','group'])if(typeof ctx.job.annotations?.[key]!=='function')throw Error('이 CVAT 버전의 그룹 기능을 확인하지 못했습니다.');
        if(typeof ctx.job.frames?.get!=='function'||typeof ctx.job.actions?.get!=='function')throw Error('이 CVAT 버전의 프레임·이력 연결을 확인하지 못했습니다.');
        check();
        if(req.action==='preview'){
          plan=null;if(!['current','all'].includes(req.scope))throw Error('현재 프레임 또는 Job 전체를 선택하세요.');
          const before=await snapshot();
          const frames=req.scope==='current'?[initial]:[...new Set(before.value.shapes.filter(o=>['rectangle','polygon','skeleton'].includes(o.type)).map(o=>o.frame))].sort((a,b)=>a-b);
          if(frames.length>2000||frames.some(f=>!Number.isSafeInteger(f)||f<ctx.job.startFrame||f>ctx.job.stopFrame))throw Error('프레임 범위를 확인하지 못했거나 2,000프레임을 초과했습니다. 현재 프레임으로 실행하세요.');
          const groups=[],skipped=[],invalid=[],records=[];let empty=0,deleted=0;
          for(const frame of frames){
            const objects=await read(frame);if(!objects){deleted++;continue;}
            const row=planFrame(objects,frame);groups.push(...row.groups);skipped.push(...row.skipped);invalid.push(...row.invalid);empty+=row.empty;records.push({frame,signature:signature(objects)});
            if(groups.length>5000||skipped.length+invalid.length>20000)throw Error('검사 결과가 너무 많습니다. 현재 프레임으로 실행하세요.');
          }
          if((await snapshot()).json!==before.json)throw Error('검사 중 주석이 바뀌었습니다. 다시 검사하세요.');
          await refresh();check();
          const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
          plan={token,at:Date.now(),job:ctx.job,path:originalPath,frame:initial,before:before.json,records,groups};
          const owner=plan;const expiry=setTimeout(()=>{if(plan===owner)plan=null;},300000);expiry.unref?.();
          return {token,jobId:ctx.job.id,frame:initial,scope:req.scope,groups,skipped,invalid,empty,deleted,tracks:before.value.tracks.filter(t=>t.elements?.length||t.shapes?.some(s=>['rectangle','polygon','skeleton'].includes(s.type))).length};
        }
        const p=plan;
        if(!p||req.token!==p.token||p.job!==ctx.job||p.path!==originalPath||p.frame!==initial||Date.now()-p.at>300000)throw Error('검사 결과가 만료되었거나 화면이 바뀌었습니다. 다시 검사하세요.');
        plan=null;if(!p.groups.length)throw Error('그룹화할 대상이 없습니다.');
        unlock=lockInput();
        if((await snapshot()).json!==p.before)throw Error('검사 후 주석이 바뀌었습니다. 다시 검사하세요.');
        const byFrame=new Map();
        for(const record of p.records){const objects=await read(record.frame);if(!objects||signature(objects)!==record.signature)throw Error('검사 후 객체·잠금·그룹 상태가 바뀌었습니다. 다시 검사하세요.');byFrame.set(record.frame,objects);}
        await refresh();check();
        if((await snapshot()).json!==p.before)throw Error('적용 전 주석이 바뀌었습니다. 다시 검사하세요.');
        const assigned=new Map(),usedGroups=new Set();
        const remember=o=>{if(Number.isSafeInteger(o.group)&&o.group>0)usedGroups.add(o.group);for(const e of o.elements||[])remember(e);};
        const original=JSON.parse(p.before);for(const kind of ['shapes','tracks','tags'])original[kind].forEach(remember);
        for(const group of p.groups){
          check();const ids=[group.box,...(group.boxes||[]),group.polygon,...(group.polygons||[]),...group.skeletons].filter(Number.isSafeInteger),objects=byFrame.get(group.frame),members=ids.map(id=>objects.find(o=>o.clientID===id));
          if(members.some(o=>!o||protectedObject(o)))throw Error('대상 상태를 확인하지 못했습니다.');
          started=true;const id=await ctx.job.annotations.group(members,false);check();
          if(!Number.isSafeInteger(id)||id<=0||usedGroups.has(id))throw Error('새 그룹 번호를 확인하지 못했습니다.');
          usedGroups.add(id);for(const member of members)assigned.set(member.clientID,id);changed++;
        }
        // Native group() can update backing objects without updating old ObjectStates.
        for(const [frame,old]of byFrame){
          const fresh=await read(frame);if(!fresh||fresh.length!==old.length)throw Error('적용 후 객체 수가 달라졌습니다.');
          const expected=JSON.parse(p.records.find(r=>r.frame===frame).signature);for(const o of expected)if(assigned.has(o.id))o.group=assigned.get(o.id);
          if(JSON.stringify(expected)!==signature(fresh))throw Error('그룹 외 객체 변경 또는 그룹 적용 실패를 감지했습니다.');
        }
        const after=(await snapshot()).value,before=JSON.parse(p.before);
        const withoutGroups=value=>JSON.stringify(value,(key,val)=>key==='group'?undefined:val);
        if(JSON.stringify(before.tracks)!==JSON.stringify(after.tracks)||JSON.stringify(before.tags)!==JSON.stringify(after.tags)||before.shapes.some((o,i)=>!byFrame.has(o.frame)&&JSON.stringify(o)!==JSON.stringify(after.shapes[i]))||withoutGroups(before)!==withoutGroups(after))throw Error('적용 후 주석의 모양·라벨 변경을 감지했습니다.');
        await refresh();return {applied:changed,skeletons:p.groups.reduce((n,g)=>n+g.skeletons.length,0),needsSave:true};
      }catch(error){
        if(started&&ctx)try{await refresh();}catch{}
        return {error:(started?`일부 적용됐을 수 있습니다(확인된 그룹 ${changed}개). CVAT에서 결과와 되돌리기를 확인하세요. `:'')+(error.message||'그룹화 실패'),partial:started,applied:changed};
      }finally{unlock?.();busy=false;}
    };
  }
  function find(){
    const match=/^\/tasks\/(\d+)\/jobs\/(\d+)\/?$/.exec(location.pathname);
    if(window.top!==window||!match||!/^https?:$/.test(location.protocol))throw Error('CVAT Job에서 사용하세요.');
    const sides=document.querySelectorAll('.cvat-canvas-controls-sidebar');if(sides.length!==1)throw Error('CVAT 작업 화면을 확인하지 못했습니다.');
    for(let node=sides[0];node instanceof Element;node=node.parentElement){
      const key=Object.getOwnPropertyNames(node).find(k=>/^__react(Fiber|InternalInstance)\$/.test(k));const seen=new Set();
      for(let f=key&&node[key];f&&!seen.has(f)&&seen.size<200;f=f.return){seen.add(f);for(const store of [f.memoizedProps?.store,f.memoizedProps?.value?.store]){
        const job=store?.getState?.()?.annotation?.job?.instance;
        if(typeof store?.dispatch==='function'&&String(job?.id)===match[2]&&String(job?.taskId)===match[1]&&job.dimension==='2d'&&Number.isSafeInteger(job.startFrame)&&Number.isSafeInteger(job.stopFrame))return {store,job};
      }}
    }
    throw Error('현재 Job의 그룹 연결을 확인하지 못했습니다.');
  }
  let inputLocked=false;
  function lockInput(message='박스·폴리곤·스켈레톤 그룹화 중…'){
    if(inputLocked)throw Error('다른 일괄 편집이 진행 중입니다.');inputLocked=true;
    const node=document.createElement('div');node.textContent=message;node.setAttribute('role','status');node.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#10223b88;color:white;display:grid;place-items:center;font:600 16px system-ui';document.documentElement.append(node);
    const types=['keydown','keyup','pointerdown','pointerup','mousedown','mouseup','click','wheel'],stop=e=>{e.preventDefault();e.stopImmediatePropagation();};for(const type of types)window.addEventListener(type,stop,{capture:true,passive:false});
    return ()=>{inputLocked=false;node.remove();for(const type of types)window.removeEventListener(type,stop,true);};
  }
  if(typeof module==='object'&&module.exports){module.exports={inside,planFrame,signature,createService};return;}
  // Older injected grouping handlers may exist without the newer shared context.
  if(typeof globalThis.CVATBatchNativeContext?.find!=='function')globalThis.CVATBatchNativeContext=Object.freeze({find,lockInput});
  const registrationKey='__'+EVENT;
  if(globalThis[registrationKey])return;
  globalThis[registrationKey]=true;
  const run=createService(find,lockInput);
  document.addEventListener(EVENT,async event=>{
    const node=event.target;if(!(node instanceof HTMLSpanElement)||!node.hidden||node.parentElement!==document.body)return;
    const raw=node.getAttribute('data-request');if(!raw||raw.length>2000)return;
    let result;try{result=await run(JSON.parse(raw),()=>node.isConnected&&node.getAttribute('data-request')===raw);}catch{result={error:'그룹화 요청을 읽지 못했습니다.'};}
    if(node.isConnected)node.setAttribute('data-response',JSON.stringify(result));
  },true);
})();
