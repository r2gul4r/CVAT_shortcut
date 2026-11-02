/* MAIN: bulk parent-skeleton location attributes, native undo, no server writes. */
(() => {
  'use strict';
  const EVENT='cvat-shortcuts-location-v1',norm=s=>typeof s==='string'?s.trim().toLowerCase():'';
  function definitions(labels){
    if(!Array.isArray(labels))throw Error('Job의 라벨 정의를 읽지 못했습니다.');
    return labels.filter(l=>!l.hasParent&&['skeleton','any'].includes(l.type)).map(l=>{
      const attrs=Array.isArray(l.attributes)?l.attributes.filter(a=>norm(a.name)==='location'):[],attr=attrs.length===1?attrs[0]:null,values={};
      if(attr&&Number.isSafeInteger(attr.id)&&['radio','select'].includes(attr.inputType)&&Array.isArray(attr.values))for(const value of attr.values){const key=norm(value);if(['tag','sticker'].includes(key)){if(values[key]!==undefined)return {id:l.id,name:l.name,error:'location 선택값 중복'};values[key]=value;}}
      return {id:l.id,name:l.name,attribute:attr?.id,values,error:!Object.keys(values).length?'location 선택 속성 없음':''};
    });
  }
  function describe(o){return {id:o.clientID,server:o.serverID,frame:o.frame,type:o.objectType,shape:o.shapeType,label:o.label?.id,group:o.group?.id,points:o.points,rotation:o.rotation,outside:o.outside,occluded:o.occluded,lock:o.lock,gt:o.isGroundTruth,attributes:o.attributes,elements:o.elements?.map(describe)};}
  const signature=states=>JSON.stringify(states.map(describe));
  const protectedObject=o=>o.lock||o.isGroundTruth||o.elements?.some(protectedObject);
  function createService(resolve,lockInput){
    let busy=false,plan=null;
    return async function run(req,alive=()=>true){
      if(busy)return {error:'이미 location 작업 중입니다.'};busy=true;
      let ctx,frame,path,unlock,started=false,applied=0;
      const state=()=>ctx.store.getState().annotation;
      function check(){
        const a=state();
        if(!alive()||location.origin!==req.origin||location.pathname!==path||a.job.instance!==ctx.job||a.player.frame.number!==frame)throw Error('Job·프레임 또는 실행 창이 바뀌었습니다. 다시 검사하세요.');
        if(a.workspace!=='Standard'||!a.canvas.ready||a.canvas.instance.mode()!=='idle'||a.job.fetching||a.job.saving||a.annotations?.saving?.uploading||a.player.playing||a.player.frame.fetching||a.player.navigationBlocked)throw Error('그리기·재생·저장을 마친 뒤 실행하세요.');
        if(a.player.frame.data?.deleted)throw Error('삭제된 프레임에서는 실행할 수 없습니다.');
      }
      async function snapshot(){const value=await ctx.job.annotations.export();check();if(!Array.isArray(value?.shapes)||!Array.isArray(value.tracks)||!Array.isArray(value.tags))throw Error('주석 데이터를 읽지 못했습니다.');const json=JSON.stringify(value);if(json.length>32*1024*1024)throw Error('일괄 변경하기에는 주석 데이터가 너무 큽니다.');return {value,json};}
      async function read(number){check();const meta=await ctx.job.frames.get(number);check();if(typeof meta?.deleted!=='boolean')throw Error('프레임 상태를 읽지 못했습니다.');if(meta.deleted)return null;const values=await ctx.job.annotations.get(number,false,[]);check();if(!Array.isArray(values))throw Error('객체 목록을 읽지 못했습니다.');return values;}
      async function refresh(){check();const a=state();if(!Array.isArray(a.annotations.filters))throw Error('화면 필터를 읽지 못했습니다.');const values=await ctx.job.annotations.get(frame,false,a.annotations.filters),history=await ctx.job.actions.get();check();ctx.store.dispatch({type:'FETCH_ANNOTATIONS_SUCCESS',payload:{states:values,history,intervals:[]}});if(state().annotations.states!==values)throw Error('이 CVAT 버전의 화면 갱신을 확인하지 못했습니다.');}
      try{
        if(!req||req.version!==1||!['catalog','preview','apply'].includes(req.action)||req.origin!==location.origin||req.path!==location.pathname)throw Error('올바른 location 요청이 아닙니다.');
        ctx=resolve();frame=state().player.frame.number;path=req.path;
        const defs=definitions(ctx.job.labels),catalog=JSON.stringify(defs);
        if(req.action==='catalog')return {jobId:ctx.job.id,options:['tag','sticker'].filter(key=>defs.some(d=>d.values?.[key]!==undefined)),labels:defs.map(d=>({id:d.id,name:d.name,error:d.error}))};
        for(const key of ['get','export'])if(typeof ctx.job.annotations?.[key]!=='function')throw Error('주석 편집 연결을 확인하지 못했습니다.');
        if(typeof ctx.job.frames?.get!=='function'||typeof ctx.job.actions?.get!=='function')throw Error('프레임·이력 연결을 확인하지 못했습니다.');check();
        if(req.action==='preview'){
          plan=null;if(!['tag','sticker'].includes(req.value))throw Error('tag 또는 sticker를 선택하세요.');
          const before=await snapshot(),raw=before.value.shapes.filter(s=>s.type==='skeleton'),frames=[...new Set(raw.map(s=>s.frame))].sort((a,b)=>a-b);
          if(frames.length>2000||raw.length>20000||frames.some(f=>!Number.isSafeInteger(f)||f<ctx.job.startFrame||f>ctx.job.stopFrame))throw Error('대상 범위를 확인하지 못했거나 2,000프레임·20,000객체 제한을 초과했습니다.');
          const targets=[],records=[],skipped=[],counts={same:0,deleted:0,tracks:before.value.tracks.filter(t=>t.elements?.length||t.shapes?.some(s=>s.type==='skeleton')).length};
          for(const number of frames){
            const values=await read(number);if(!values){counts.deleted+=raw.filter(s=>s.frame===number).length;continue;}
            const skeletons=values.filter(o=>o.parentID==null&&o.objectType==='shape'&&o.shapeType==='skeleton');
            if(skeletons.length!==raw.filter(s=>s.frame===number).length)throw Error('Job의 스켈레톤 전체를 확인하지 못했습니다.');
            records.push({frame:number,signature:signature(values)});
            for(const o of skeletons){
              const def=defs.find(d=>d.id===o.label?.id),value=def?.values?.[req.value];let reason='';
              if(!Number.isSafeInteger(o.clientID)||o.frame!==number)throw Error('스켈레톤 ID 또는 프레임이 잘못되었습니다.');
              if(!def||def.error||value===undefined)reason=def?.error||'선택한 location 값 없음';
              else if(protectedObject(o))reason='잠금·보호 객체';
              else if(typeof o.save!=='function'||!o.attributes||typeof o.attributes!=='object')reason='속성 편집 미지원';
              if(reason){skipped.push({frame:number,id:o.clientID,reason});continue;}
              if(o.attributes[def.attribute]===value){counts.same++;continue;}
              targets.push({frame:number,id:o.clientID,label:o.label.id,attribute:def.attribute,value,before:o.attributes[def.attribute]??'(미지정)'});
            }
          }
          if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('중복된 스켈레톤 ID를 확인했습니다.');
          if((await snapshot()).json!==before.json||JSON.stringify(definitions(ctx.job.labels))!==catalog)throw Error('검사 중 주석·속성 정의가 바뀌었습니다. 다시 검사하세요.');
          await refresh();
          const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
          plan={token,at:Date.now(),job:ctx.job,path,frame,before:before.json,catalog,records,targets,value:req.value};
          const owner=plan,expiry=setTimeout(()=>{if(plan===owner)plan=null;},300000);expiry.unref?.();
          return {token,jobId:ctx.job.id,value:req.value,total:raw.length,count:targets.length,...counts,skipped,targets};
        }
        const p=plan;if(!p||p.token!==req.token||p.job!==ctx.job||p.path!==path||p.frame!==frame||Date.now()-p.at>300000)throw Error('검사 결과가 만료되었거나 화면이 바뀌었습니다. 다시 검사하세요.');
        plan=null;if(!p.targets.length)throw Error('변경할 스켈레톤이 없습니다.');unlock=lockInput();
        if((await snapshot()).json!==p.before||catalog!==p.catalog)throw Error('검사 후 주석·속성 정의가 바뀌었습니다. 다시 검사하세요.');
        const valuesByFrame=new Map();
        for(const record of p.records){const values=await read(record.frame);if(!values||signature(values)!==record.signature)throw Error('검사 후 객체·잠금·속성이 바뀌었습니다. 다시 검사하세요.');valuesByFrame.set(record.frame,values);}
        await refresh();if((await snapshot()).json!==p.before)throw Error('적용 전 주석이 바뀌었습니다. 다시 검사하세요.');
        const updated=new Map();
        for(const t of p.targets){
          check();const o=valuesByFrame.get(t.frame).find(o=>o.clientID===t.id);
          if(!o||protectedObject(o)||o.label.id!==t.label)throw Error('변경 대상 상태를 확인하지 못했습니다.');
          // Assign only this attribute. CVAT merges attribute setters and records undo.
          o.attributes={[t.attribute]:t.value};started=true;await o.save();check();applied++;updated.set(t.id,t);
        }
        for(const record of p.records){
          const values=await read(record.frame),expected=JSON.parse(record.signature);
          for(const o of expected){const t=updated.get(o.id);if(t)o.attributes={...o.attributes,[t.attribute]:t.value};}
          if(!values||JSON.stringify(expected)!==signature(values))throw Error('location 적용 실패 또는 다른 객체 값 변경을 감지했습니다.');
        }
        const after=(await snapshot()).value,before=JSON.parse(p.before);
        const targetAttributes=new Map(p.targets.map(t=>[`${t.frame}:${t.label}`,t]));
        const normalize=data=>({...data,shapes:data.shapes.map(o=>{
          const t=o.type==='skeleton'?targetAttributes.get(`${o.frame}:${o.label_id}`):null;if(!t)return o;
          const {source,...rest}=o;return {...rest,attributes:o.attributes.filter(a=>a.spec_id!==t.attribute)};
        })});
        if(JSON.stringify(normalize(before))!==JSON.stringify(normalize(after)))throw Error('location 외 주석·좌표·그룹 변경을 감지했습니다.');
        await refresh();return {applied,value:p.value,needsSave:true};
      }catch(error){if(started&&ctx)try{await refresh();}catch{}return {error:(started?`일부 변경됐을 수 있습니다(처리 응답 ${applied}개). CVAT에서 결과와 되돌리기를 확인하세요. `:'')+(error.message||'location 변경 실패'),partial:started,applied};}
      finally{unlock?.();busy=false;}
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={definitions,describe,signature,createService};return;}
  if(globalThis.__cvatShortcutsLocationV1)return;globalThis.__cvatShortcutsLocationV1=true;
  const run=createService(()=>{const helper=globalThis.CVATBatchNativeContext;if(!helper)throw Error('편집 연결을 불러오지 못했습니다. 새로고침 후 확장을 켜세요.');return helper.find();},()=>globalThis.CVATBatchNativeContext.lockInput('스켈레톤 location 변경 중…'));
  document.addEventListener(EVENT,async event=>{
    const node=event.target;if(!(node instanceof HTMLSpanElement)||!node.hidden||node.parentElement!==document.body)return;
    const raw=node.getAttribute('data-request');if(!raw||raw.length>2000)return;
    let result;try{result=await run(JSON.parse(raw),()=>node.isConnected&&node.getAttribute('data-request')===raw);}catch{result={error:'location 요청을 읽지 못했습니다.'};}
    if(node.isConnected)node.setAttribute('data-response',JSON.stringify(result));
  },true);
})();
