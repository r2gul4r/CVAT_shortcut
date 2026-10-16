/* MAIN-world read-only state access and normal CVAT frame-input navigation.
 * No annotation mutation, Redux action, arbitrary URL or reload navigation. */
async function CVATReviewNative(request) {
  'use strict';
  try {
    const valid=()=>window.top===window && location.origin===request.origin && location.pathname===request.path;
    const match=/^\/tasks\/\d+\/jobs\/(\d+)\/?$/.exec(location.pathname);
    if(!valid() || !match)throw Error('CVAT Job 탭이 바뀌었습니다.');
    const side=document.querySelector('.cvat-canvas-controls-sidebar');let store;
    for(let element=side;element instanceof Element && !store;element=element.parentElement){
      const key=Object.getOwnPropertyNames(element).find(name=>/^__react(Fiber|InternalInstance)\$/.test(name));
      if(!key)continue;
      const seen=new Set();
      for(let fiber=element[key];fiber && seen.size<200 && !seen.has(fiber);fiber=fiber.return){
        seen.add(fiber);for(const candidate of [fiber.memoizedProps?.store,fiber.memoizedProps?.value?.store]){
          if(typeof candidate?.getState==='function' && candidate.getState()?.annotation?.job){store=candidate;break;}
        }
        if(store)break;
      }
    }
    const state=()=>{
      if(!valid())throw Error('CVAT Job 탭이 바뀌었습니다.');
      const a=store?.getState()?.annotation;
      if(String(a?.job?.instance?.id)!==match[1])throw Error('이 CVAT 버전의 프레임 연결을 확인할 수 없습니다. 번호를 직접 입력해 이동하세요.');
      return a;
    };
    let a=state();
    if(request.action==='status'){
      let dirty=null;try{const value=await a.job.instance.annotations?.hasUnsavedChanges?.();if(typeof value==='boolean')dirty=value;}catch{}
      return {frame:a.player?.frame?.number,dirty};
    }
    if(request.action!=='navigate' || !Number.isSafeInteger(request.frame) || !Number.isSafeInteger(a.job.instance.startFrame) || !Number.isSafeInteger(a.job.instance.stopFrame) || request.frame<a.job.instance.startFrame || request.frame>a.job.instance.stopFrame)throw Error('이동할 프레임 번호가 올바르지 않습니다.');
    if(a.workspace!=='Standard' || a.canvas?.instance?.mode?.()!=='idle' || a.canvas.ready!==true || a.job.fetching || a.job.saving || a.annotations?.saving?.uploading || a.player?.frame?.fetching || a.player?.playing || a.player?.navigationBlocked)throw Error('그리기·재생·저장을 마친 뒤 이동하세요.');
    if(a.player.frame.number===request.frame)return {frame:request.frame};
    const inputs=[...document.querySelectorAll('.cvat-player-frame-selector input, input.cvat-player-frame-selector')];
    if(inputs.length!==1 || inputs[0].disabled)throw Error('프레임 입력칸을 찾지 못했습니다. 번호를 직접 입력해 이동하세요.');
    const input=inputs[0];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(request.frame));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,80));
    a=state();if(a.canvas?.instance?.mode?.()!=='idle' || a.player?.playing || a.player?.navigationBlocked)throw Error('작업 상태가 바뀌어 이동을 중단했습니다.');
    for(const type of ['keydown','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    for(let i=0;i<80;i++){
      a=state();if(a.player?.frame?.number===request.frame && !a.player.frame.fetching && a.canvas.ready)return {frame:request.frame};
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('프레임 이동 완료를 확인하지 못했습니다. CVAT 화면을 확인하세요.');
  }catch(error){return {error:error.message||'프레임 이동 실패'};}
}
