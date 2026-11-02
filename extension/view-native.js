/* MAIN-world local display adapter. No HTTP, annotation save, or image extraction. */
(() => {
  'use strict';
  const SLOT='__cvatShortcutsViewV1',EVENT='cvat-shortcuts-view-v1';
  if(globalThis[SLOT])return;
  let session=null;
  const wrap=angle=>((angle%360)+360)%360;
  const fine=angle=>Math.abs(wrap(angle)%90)>1e-8;
  function find(){
    const match=/^\/tasks\/\d+\/jobs\/(\d+)\/?$/.exec(location.pathname);
    if(window.top!==window||!match||!/^https?:$/.test(location.protocol))throw Error('CVAT Job 화면에서 사용하세요.');
    const sides=document.querySelectorAll('.cvat-canvas-controls-sidebar');
    if(sides.length!==1)throw Error('CVAT 도구 화면을 확인할 수 없습니다.');
    for(let node=sides[0];node instanceof Element;node=node.parentElement){
      const key=Object.getOwnPropertyNames(node).find(k=>/^__react(Fiber|InternalInstance)\$/.test(k));
      const seen=new Set();
      for(let fiber=key&&node[key];fiber&&!seen.has(fiber)&&seen.size<200;fiber=fiber.return){
        seen.add(fiber);
        for(const store of [fiber.memoizedProps?.store,fiber.memoizedProps?.value?.store]){
          if(typeof store?.getState!=='function'||typeof store.dispatch!=='function')continue;
          const a=store.getState()?.annotation,job=a?.job?.instance,canvas=a?.canvas?.instance;
          if(String(job?.id)!==match[1]||job.dimension!=='2d'||a.workspace!=='Standard')continue;
          const root=canvas?.html?.();
          if(!(root instanceof HTMLElement)||!root.isConnected||typeof canvas.mode!=='function')continue;
          return {store,job,canvas,root,path:location.pathname};
        }
      }
    }
    throw Error('이 CVAT 버전의 화면 연결을 확인하지 못했습니다.');
  }
  const state=s=>s.store.getState().annotation;
  const same=s=>location.pathname===s.path&&state(s)?.job?.instance===s.job&&state(s)?.canvas?.instance===s.canvas;
  const idle=s=>same(s)&&state(s).canvas.ready===true&&s.canvas.mode()==='idle'&&!state(s).job.fetching&&!state(s).job.saving&&!state(s).player?.playing&&!state(s).player?.frame?.fetching&&!state(s).player?.frame?.data?.deleted;
  // Rotation changes need idle. Explicit zero reset may cancel a tool through
  // CVAT's public cancel path, but never interrupt loading, saving or a live drag.
  const cancellableModes=new Set(['draw','edit','interact','group','merge','split','join','slice','select','select_region','drag_canvas','zoom_canvas']);
  function blocked(s){
    if(!same(s))return 'Job이 바뀌었습니다. 다시 연결하세요.';
    const a=state(s);
    if(a.job.saving||a.annotations?.saving?.uploading)return '저장이 끝난 뒤 0°로 복귀할 수 있습니다.';
    if(a.job.fetching||a.player?.frame?.fetching||a.canvas.ready!==true)return '프레임을 불러오는 중입니다.';
    if(a.player?.playing)return '재생을 멈춘 뒤 0°로 복귀할 수 있습니다.';
    if(a.player?.frame?.data?.deleted)return '삭제된 프레임에서는 각도를 바꿀 수 없습니다.';
    if(a.player?.navigationBlocked)return '현재 작업이 끝난 뒤 각도를 바꿀 수 있습니다.';
    return '';
  }
  function resetState(s){
    const mode=s.canvas.mode(),reason=blocked(s);
    if(reason)return {resetSupported:false,resetReason:reason};
    try{frameInfo(s);}catch(error){return {resetSupported:false,resetReason:error.message};}
    if(typeof s.canvas.rotate!=='function')return {resetSupported:false,resetReason:'회전 복귀 연결을 확인하지 못했습니다.'};
    const cancel=mode!=='idle';
    if(cancel&&(!cancellableModes.has(mode)||typeof s.canvas.cancel!=='function'))return {resetSupported:false,resetReason:'마우스 조작을 마치고 Esc를 누른 뒤 다시 시도하세요.'};
    return {resetSupported:true,resetCancelsTool:cancel,resetReason:cancel?'0° 복귀를 누르면 진행 중인 도구를 취소합니다. 완성 전의 그리기는 취소됩니다.':''};
  }
  function resetAngle(s){
    const ready=resetState(s);if(!ready.resetSupported)throw Error(ready.resetReason);
    const frame=state(s).player.frame.number;
    if(ready.resetCancelsTool)s.canvas.cancel();
    if(!same(s)||state(s).player.frame.number!==frame)throw Error('취소 중 Job·프레임이 바뀌었습니다. 다시 시도하세요.');
    if(blocked(s)||s.canvas.mode()!=='idle')throw Error(blocked(s)||'도구 취소를 확인하지 못했습니다. Esc를 누른 뒤 다시 시도하세요.');
    // Zero uses native quarter-turn support even when the fine-angle adapter is unavailable.
    setAngle(s,0);s.notice='화면 각도를 0°로 복구했습니다.';
  }
  function labels(s){
    const list=state(s).job.labels;
    if(!Array.isArray(list))throw Error('Job 라벨 목록을 확인하지 못했습니다.');
    return list.filter(l=>!l.hasParent&&Number.isSafeInteger(l.id)&&l.id>0&&typeof l.name==='string'&&l.name.length<=128)
      .map(l=>({id:l.id,name:l.name,color:typeof l.color==='string'?l.color:'',type:l.type}));
  }
  function redraw(s,changed){
    if(!changed.length||!same(s))return;
    const a=state(s),previous=a.annotations.states;
    s.store.dispatch({type:'UPDATE_ANNOTATIONS_SUCCESS',payload:{states:changed,history:a.annotations.history}});
    if(state(s).annotations.states===previous)throw Error('이 CVAT 버전의 표시 갱신을 확인하지 못했습니다.');
  }
  function leaves(object){return object.shapeType==='skeleton'&&Array.isArray(object.elements)?object.elements.flatMap(leaves):[object];}
  function visibility(s,restore=false){
    const a=state(s),states=a.annotations?.states;
    if(!Array.isArray(states))throw Error('객체 표시 상태를 확인하지 못했습니다.');
    const desired=new Set(),changed=new Set(),roots=new Map();
    for(const object of states){
      if(object.objectType==='tag')continue;
      for(const leaf of leaves(object)){
        roots.set(leaf,object);
        if(!restore&&s.hidden.has(object.label?.id))desired.add(leaf);
      }
    }
    for(const [leaf,previous] of s.originalHidden){
      if(!desired.has(leaf)){
        if(leaf.hidden===true&&leaf.hidden!==previous){leaf.hidden=previous;if(roots.has(leaf))changed.add(roots.get(leaf));}
        s.originalHidden.delete(leaf);
      }
    }
    for(const leaf of desired){
      if(typeof leaf.hidden!=='boolean')throw Error('지원하지 않는 객체 숨김 형식입니다.');
      if(leaf.hidden!==true){if(!s.originalHidden.has(leaf))s.originalHidden.set(leaf,leaf.hidden);leaf.hidden=true;changed.add(roots.get(leaf));}
    }
    redraw(s,[...changed]);
  }
  function geometryOK(s){
    const m=s.canvas.model,g=m?.geometry,d=m?.data;
    return g&&d&&['angle','scale','left','top','offset'].every(k=>Number.isFinite(g[k]))&&g.scale>0&&
      ['image','canvas'].every(k=>g[k]&&g[k].width>0&&g[k].height>0)&&g.grid&&
      ['rotate','zoom','resetScale','notify','draw','edit','interact'].every(k=>typeof m[k]==='function')&&
      Number.isFinite(d.fittedScale)&&d.configuration&&typeof d.configuration==='object'&&
      typeof s.canvas.view?.transformCanvas==='function';
  }
  function frameInfo(s){
    const a=state(s),offset=a.player?.frame?.number-s.job.startFrame,angles=a.player?.frameAngles;
    if(!Number.isSafeInteger(offset)||offset<0||!Array.isArray(angles)||!Number.isFinite(angles[offset]))throw Error('프레임 회전 상태를 확인하지 못했습니다.');
    return {offset,angles};
  }
  function patch(s,target,key,fn){
    const own=Object.getOwnPropertyDescriptor(target,key),original=target[key];
    const next=fn(original);
    target[key]=next;
    if(target[key]!==next)throw Error('CVAT 회전 연결을 변경할 수 없습니다.');
    s.patches.push(()=>{if(target[key]===next){if(own)Object.defineProperty(target,key,own);else delete target[key];}});
  }
  function setAngle(s,angle,remember=true){
    const {offset,angles}=frameInfo(s),value=wrap(angle),before=angles[offset],geometry=s.canvas.geometry;
    const previous=s.angles.has(offset)?{...s.angles.get(offset)}:null;
    if(remember&&!previous)s.angles.set(offset,{before,after:value});
    try{
      s.store.dispatch({type:'ROTATE_FRAME',payload:{offset,angle:value,rotateAll:false}});
      if(state(s).player.frameAngles[offset]!==value)throw Error('프레임 회전 연결이 지원되지 않습니다.');
      s.canvas.rotate(value);
      if(Math.abs(wrap(s.canvas.geometry.angle)-value)>1e-6)throw Error('1도 회전이 반영되지 않았습니다.');
      if(s.angles.has(offset))s.angles.get(offset).after=value;
    }catch(error){
      try{s.store.dispatch({type:'ROTATE_FRAME',payload:{offset,angle:before,rotateAll:false}});}catch{}
      try{s.canvas.model.geometry=geometry;s.canvas.model.notify('image_rotated');}catch{}
      if(previous)s.angles.set(offset,previous);else s.angles.delete(offset);
      throw error;
    }
  }
  // New skeletons are laid out in screen axes, then mapped back through CVAT's
  // actual SVG CTM. Existing annotations and pasted/redrawn skeletons stay native.
  function installSkeleton(s){
    const h=s.canvas.view?.drawHandler,source=h?.canvas?.node;
    if(!h||!(source instanceof SVGElement)||!['draw','cancel','transform','onDrawDoneDefault'].every(k=>typeof h[k]==='function'))return false;
    let active=null;
    const svgNode=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
    const point=(x,y,m)=>new DOMPoint(x,y).matrixTransform(m);
    function clear(){const a=active;if(!a)return;active=null;a.layer.remove();for(const off of a.listeners)off();}
    function emit(data){const a=active;if(!a)return;clear();const fn=a.data.onDrawDone||h.onDrawDoneDefault;fn.call(h,data,Date.now()-a.started);}
    function valid(a){return same(s)&&state(s).player?.frame?.number===a.frame&&source.isConnected;}
    function local(client){return point(client.x,client.y,active.layer.getScreenCTM().inverse());}
    function imagePoint(client){const p=point(client.x,client.y,source.getScreenCTM().inverse()),offset=s.canvas.geometry.offset;return {x:p.x-offset,y:p.y-offset};}
    function template(data){
      const svg=data.skeletonSVG;
      if(!(svg instanceof SVGElement))throw Error('스켈레톤 템플릿을 확인하지 못했습니다.');
      const nodes=[...svg.querySelectorAll('circle[data-label-id]')].map(n=>({id:Number(n.getAttribute('data-label-id')),node:n.getAttribute('data-node-id'),x:Number(n.getAttribute('cx')),y:Number(n.getAttribute('cy'))}));
      if(!nodes.length||nodes.length>1000||nodes.some(n=>!Number.isSafeInteger(n.id)||n.id<=0||!Number.isFinite(n.x)||!Number.isFinite(n.y))||new Set(nodes.map(n=>n.id)).size!==nodes.length)throw Error('스켈레톤 관절 정보를 확인하지 못했습니다.');
      const xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,v=Math.max(...ys)-minY;
      const points=nodes.map(n=>({...n,x:w?(n.x-minX)/w:.5,y:v?(n.y-minY)/v:.5}));
      const edges=[...svg.querySelectorAll('line[data-node-from][data-node-to]')].map(n=>[nodes.findIndex(p=>p.node===n.getAttribute('data-node-from')),nodes.findIndex(p=>p.node===n.getAttribute('data-node-to'))]).filter(([a,b])=>a>=0&&b>=0);
      return {points,edges};
    }
    function layout(){
      const a=active;if(!a)return null;
      if(!valid(a)){emit(null);return null;}
      if(!s.root.clientWidth||!s.root.clientHeight||!source.getScreenCTM()||!a.layer.getScreenCTM()){emit(null);return null;}
      a.layer.setAttribute('viewBox',`0 0 ${s.root.clientWidth} ${s.root.clientHeight}`);
      if(!a.cursor)return null;
      const end=local(a.cursor),g=s.canvas.geometry;
      const start=a.anchor?local(point(a.anchor.x+g.offset,a.anchor.y+g.offset,source.getScreenCTM())):{x:end.x-60,y:end.y-60};
      const left=Math.min(start.x,end.x),top=Math.min(start.y,end.y),width=Math.abs(start.x-end.x),height=Math.abs(start.y-end.y);
      return {left,top,width,height,points:a.template.points.map(n=>({...n,x:left+n.x*width,y:top+n.y*height}))};
    }
    function render(){
      const a=active,b=layout();if(!a||!b)return;
      a.layer.setAttribute('viewBox',`0 0 ${s.root.clientWidth} ${s.root.clientHeight}`);
      a.group.replaceChildren();
      a.group.append(svgNode('rect',{x:b.left,y:b.top,width:b.width,height:b.height,fill:'none',stroke:'#f73587','stroke-width':1,'stroke-dasharray':'4 3'}));
      for(const [i,j]of a.template.edges){const p=b.points[i],q=b.points[j];a.group.append(svgNode('line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:'#f73587','stroke-width':1.5}));}
      for(const p of b.points)a.group.append(svgNode('circle',{cx:p.x,cy:p.y,r:3,fill:'#fff',stroke:'#f73587','stroke-width':1.5,'data-label-id':p.id}));
    }
    function finish(){
      const a=active,b=layout();if(!a||!active)return;
      if(!a.anchor||!b||b.width<2||b.height<2){emit(null);return;}
      const matrix=a.layer.getScreenCTM(),g=s.canvas.geometry;
      const elements=b.points.map(n=>{const p=imagePoint(point(n.x,n.y,matrix));return {shapeType:'points',points:[p.x,p.y],labelID:n.id};});
      // No axis-aligned clipping: it would deform the skeleton on a rotated image.
      if(elements.some(e=>e.points.some(x=>!Number.isFinite(x))||e.points[0]<-1e-6||e.points[1]<-1e-6||e.points[0]>g.image.width+1e-6||e.points[1]>g.image.height+1e-6)){
        s.notice='스켈레톤 관절이 이미지 밖에 있어 생성하지 않았습니다. 이미지 안에서 다시 그리세요.';emit(null);return;
      }
      emit({shapeType:'skeleton',elements});
    }
    function start(data){
      const shape=template(data),layer=svgNode('svg',{'aria-hidden':'true','data-cvat-screen-skeleton':'',width:'100%',height:'100%',viewBox:`0 0 ${s.root.clientWidth} ${s.root.clientHeight}`});
      layer.style.cssText='position:absolute;inset:0;z-index:1001;pointer-events:none!important;overflow:hidden;transform:none!important;';
      const group=svgNode('g');layer.append(group);s.root.append(layer);
      active={data,template:shape,layer,group,frame:state(s).player.frame.number,started:Date.now(),cursor:null,anchor:null,down:null,listeners:[]};
      const on=(target,event,fn)=>{target.addEventListener(event,fn,true);active.listeners.push(()=>target.removeEventListener(event,fn,true));};
      on(s.root,'mousedown',event=>{
        if(event.button!==0||event.altKey||!active)return;
        event.preventDefault();event.stopImmediatePropagation();active.cursor={x:event.clientX,y:event.clientY};
        if(active.anchor){finish();return;}
        active.anchor=imagePoint(active.cursor);active.down={...active.cursor};render();
      });
      on(s.root,'mousemove',event=>{if(active){active.cursor={x:event.clientX,y:event.clientY};render();}});
      on(window,'mouseup',event=>{
        if(event.button!==0||!active?.down)return;
        const down=active.down;active.down=null;
        if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>4){active.cursor={x:event.clientX,y:event.clientY};finish();}
      });
    }
    patch(s,h,'draw',original=>function(data,geometry){
      if(active){if(!data.enabled){finish();return;}emit(null);}
      if(data.enabled&&data.shapeType==='skeleton'&&!data.initialState&&!data.initialStates?.length&&typeof data.redraw!=='number'&&wrap(geometry.angle)!==0){start(data);return;}
      return original.call(this,data,geometry);
    });
    patch(s,h,'cancel',original=>function(...args){if(active){emit(null);return;}return original.apply(this,args);});
    patch(s,h,'transform',original=>function(...args){const result=original.apply(this,args);if(active)render();return result;});
    s.screenSkeleton={tick:()=>{if(active&&!valid(active))emit(null);},dispose:clear};
    return true;
  }

  function installRotation(s){
    if(s.patches.length)return;
    if(!geometryOK(s))throw Error('이 CVAT 버전은 1도 회전을 지원하지 않습니다.');
    frameInfo(s);
    const m=s.canvas.model;
    try{
      patch(s,m,'rotate',original=>function(angle){
        if(!Number.isFinite(angle))return;
        // Also track CVAT's own +90/-90 controls while a fine-angle session is active.
        if(same(s)){const {offset,angles}=frameInfo(s),entry=s.angles.get(offset);if(entry&&angles[offset]===wrap(angle))entry.after=wrap(angle);}
        if(!fine(angle))return original.call(this,angle);
        if(this.imageIsDeleted)return;
        this.geometry={...this.geometry,angle:wrap(angle)};
        this.notify('image_rotated');
      });
      // CVAT's quarter-turn zoom formula is not valid at arbitrary angles.
      patch(s,m,'zoom',original=>function(x,y,delta){
        const g=this.geometry;if(!fine(g.angle))return original.call(this,x,y,delta);
        const factor=(6/5)**(this.configuration?.adaptiveZoom?-delta/10:Math.sign(-delta));
        const scale=Math.min(10,Math.max(.1,g.scale*factor)),r=g.angle*Math.PI/180;
        const dx=x-g.image.width/2,dy=y-g.image.height/2,diff=g.scale-scale;
        this.geometry={...g,scale,left:g.left+diff*(Math.cos(r)*dx-Math.sin(r)*dy),top:g.top+diff*(Math.sin(r)*dx+Math.cos(r)*dy)};
        this.notify('image_zoomed');
      });
      patch(s,m,'resetScale',original=>function(){
        const g=this.geometry;if(!fine(g.angle))return original.call(this);
        const r=g.angle*Math.PI/180,c=Math.abs(Math.cos(r)),v=Math.abs(Math.sin(r));
        const scale=Math.max(.1,Math.min(10,g.canvas.width/(g.image.width*c+g.image.height*v),g.canvas.height/(g.image.width*v+g.image.height*c)));
        const left=(g.canvas.width-g.image.width)/2,top=(g.canvas.height-g.image.height)/2;
        if(scale===g.scale&&left===g.left&&top===g.top)return false;
        this.geometry={...g,scale,left,top};this.data.fittedScale=scale;return true;
      });
      // Raster/Fabric mask tools only map 0/90/180/270 degrees. Restore an exact
      // quarter turn before their handlers start; vector/skeleton tools use SVG CTM.
      const raster=()=>{if(fine(m.geometry.angle)){setAngle(s,0);s.notice='브러쉬·AI 도구의 좌표를 유지하기 위해 화면 각도를 0°로 되돌렸습니다.';}};
      patch(s,m,'draw',original=>function(data,...rest){
        if(data?.enabled&&data.shapeType==='skeleton'&&!data.initialState&&!data.initialStates?.length&&typeof data.redraw!=='number'&&wrap(m.geometry.angle)!==0&&!s.screenSkeleton){
          s.notice='이 CVAT 버전의 수평 스켈레톤 생성을 지원하지 않습니다. 0° 복귀 후 그리세요.';throw Error(s.notice);
        }
        if(data?.enabled&&((data.shapeType||data.initialState?.shapeType)==='mask'||data.initialStates?.some(x=>x.shapeType==='mask')))raster();return original.call(this,data,...rest);
      });
      patch(s,m,'edit',original=>function(data,...rest){if(data?.enabled&&(data.state?.shapeType==='mask'||data.brushTool))raster();return original.call(this,data,...rest);});
      patch(s,m,'interact',original=>function(data,...rest){if(data?.enabled||['draw_points','draw_box','put_shapes','refine'].includes(data?.command))raster();return original.call(this,data,...rest);});
      installSkeleton(s);
    }catch(error){s.patches.splice(0).reverse().forEach(undo=>undo());throw error;}
  }
  function grid(s){
    if(!s.grid.enabled||!s.root.isConnected){s.gridNode?.remove();return;}
    if(!s.gridNode){
      const node=document.createElement('div');node.id='cvat-shortcuts-alignment-grid';node.setAttribute('aria-hidden','true');s.gridNode=node;
    }
    const n=s.gridNode;
    n.style.cssText=`position:absolute;inset:0;z-index:1000;pointer-events:none!important;transform:none!important;overflow:hidden;opacity:${s.grid.opacity/100};background-image:linear-gradient(to right,${s.grid.color} 1px,transparent 1px),linear-gradient(to bottom,${s.grid.color} 1px,transparent 1px);background-size:${s.grid.spacing}px ${s.grid.spacing}px;`;
    if(n.parentElement!==s.root)s.root.append(n);
  }
  function clean(s,force=false){
    if(!force&&same(s)&&s.canvas.mode()!=='idle'){s.closing=true;return false;}
    s.unsubscribe?.();s.screenSkeleton?.dispose();s.gridNode?.remove();
    try{visibility(s,true);}catch{for(const [leaf,value]of s.originalHidden)try{leaf.hidden=value;}catch{}}
    if(same(s)){
      for(const [offset,value]of s.angles){
        try{if(state(s).player.frameAngles[offset]===value.after)s.store.dispatch({type:'ROTATE_FRAME',payload:{offset,angle:value.before,rotateAll:false}});}catch{}
      }
      try{s.canvas.rotate(frameInfo(s).angles[frameInfo(s).offset]);}catch{}
    }
    s.patches.splice(0).reverse().forEach(undo=>{try{undo();}catch{}});
    // Some CVAT builds reuse the canvas instance between Jobs. Its new Job angle
    // must replace the retired fine angle before the native 90-degree code resumes.
    if(!same(s)&&state(s)?.canvas?.instance===s.canvas){
      const a=state(s),offset=a.player?.frame?.number-a.job?.instance?.startFrame,angle=a.player?.frameAngles?.[offset];
      if(Number.isFinite(angle))try{s.canvas.rotate(angle);}catch{}
    }
    if(session===s)session=null;
    return true;
  }
  function sweep(s){
    if(s!==session||s.running)return;
    if(!same(s)){clean(s,true);return;}
    if(s.closing){clean(s);return;}
    s.running=true;
    try{s.screenSkeleton?.tick();if(idle(s))visibility(s);grid(s);}catch(error){s.error=error.message;}finally{s.running=false;}
  }
  function connect(){
    const found=find();
    if(session&&(session.job!==found.job||session.canvas!==found.canvas||session.path!==found.path))clean(session,true);
    if(!session){
      session={...found,hidden:new Set(),originalHidden:new Map(),angles:new Map(),patches:[],grid:{enabled:false,spacing:32,opacity:35,color:'#00bcd4'},lease:Date.now(),error:'',notice:'',running:false,closing:false};
      const s=session;
      if(typeof s.store.subscribe==='function')s.unsubscribe=s.store.subscribe(()=>{if(!s.running)queueMicrotask(()=>sweep(s));});
    }
    session.lease=Date.now();session.closing=false;return session;
  }
  function status(s){return {labels:labels(s),hidden:[...s.hidden],angle:s.canvas.geometry?.angle??0,rotationSupported:!!geometryOK(s),busy:!idle(s),mode:s.canvas.mode(),...resetState(s),grid:s.grid,notice:s.notice,error:s.error};}
  function handle(req){
    if(req.origin!==location.origin||req.path!==location.pathname)throw Error('Job이 바뀌었습니다. 다시 실행하세요.');
    if(req.action==='stop'){if(session)clean(session);return {stopped:true};}
    const s=connect();s.error='';
    if(req.action==='sync'){
      if(!Array.isArray(req.hidden)||req.hidden.length>10000||req.hidden.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('숨김 라벨 형식을 확인하세요.');
      const allowed=new Set(labels(s).filter(l=>l.type!=='tag').map(l=>l.id));s.hidden=new Set(req.hidden.filter(id=>allowed.has(id)));
      const g=req.grid;
      if(g&&typeof g.enabled==='boolean'&&Number.isInteger(g.spacing)&&g.spacing>=8&&g.spacing<=160&&Number.isInteger(g.opacity)&&g.opacity>=5&&g.opacity<=80&&/^#[0-9a-f]{6}$/i.test(g.color))s.grid={...g};
    }else if(req.action==='reset'){
      resetAngle(s);
    }else if(req.action==='angle'){
      if(!idle(s)||blocked(s))throw Error(blocked(s)||'그리기·편집·재생을 마친 뒤 각도를 조절하세요.');
      if(!Number.isInteger(req.angle)||req.angle< -360||req.angle>360)throw Error('각도는 -360~360 사이의 정수로 입력하세요.');
      installRotation(s);setAngle(s,req.angle);s.notice='';
    }else if(req.action!=='status')throw Error('지원하지 않는 화면 요청입니다.');
    sweep(s);return status(s);
  }
  document.addEventListener(EVENT,event=>{
    const node=event.target;
    if(!(node instanceof HTMLSpanElement)||!node.hidden||node.parentElement!==document.body)return;
    const raw=node.getAttribute('data-request');if(!raw||raw.length>100000)return;
    let result;
    try{const req=JSON.parse(raw);if(req.version!==1)throw Error('지원하지 않는 화면 요청입니다.');result=handle(req);}catch(error){result={error:error.message||'화면 설정 실패'};}
    node.setAttribute('data-response',JSON.stringify(result));
  },true);
  document.addEventListener('visibilitychange',()=>{if(session&&!document.hidden)session.lease=Date.now();});
  setInterval(()=>{const s=session;if(!s)return;if(!document.hidden&&Date.now()-s.lease>10000)clean(s);else sweep(s);},500);
  globalThis[SLOT]=Object.freeze({version:1});
})();
