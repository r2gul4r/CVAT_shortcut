/* Views share the existing local review result and passive worker statistics. */
(() => {
  'use strict';
  function create(container){
    let current=null,bound='',review=null,health=null,dead=false,positions={};
    const context=()=>({origin:location.origin,path:location.pathname});
    function verify(value){if(dead || value.origin!==location.origin || value.path!==location.pathname)throw Error('Job이 바뀌었습니다. 오버레이에서 다시 검사하세요.');}
    function reset(){review?.destroy();health?.destroy();review=null;health=null;container.replaceChildren();current=null;positions={};}
    function makeReview(){
      const view=globalThis.CVATWorkspaceViews.mount(container,'review'),target=context();
      const controller=globalThis.CVATReviewPanel.create(view,{
        async tab(){verify(target);return {url:target.origin+target.path};},verify,
        call:request=>globalThis.CVATReviewRequest(request),
        native:request=>chrome.runtime.sendMessage({type:'CVAT_WORKSPACE_NATIVE',context:target,action:request.action,frame:request.frame}),
        bulk:request=>{verify(target);return chrome.runtime.sendMessage({type:'CVAT_WORKSPACE_BULK',context:target,request});},
        copy(text){
          verify(target);const input=document.createElement('textarea'),active=view.getRootNode().activeElement;
          input.value=text;input.style.cssText='position:absolute;width:1px;height:1px;opacity:0';view.append(input);input.select();
          try{if(!document.execCommand('copy'))throw Error('복사 실패');}finally{input.remove();active?.focus({preventScroll:true});}
        }
      });
      return {...controller,view};
    }
    function makeHealth(){
      const view=globalThis.CVATWorkspaceViews.mount(container,'health'),target=context(),$=id=>view.querySelector('#'+id);
      const main=$('health-state').closest('.tool');main.classList.add('workspace-health-main');view.prepend(main);
      let shown=false,closed=false,busy=false,timer=null,sequence=0,enabled=false,auto=false;
      const names={ok:'응답 정상',slow:'응답 지연',error:'오류 감지',auth:'로그인·권한 확인',request:'요청 오류 확인',idle:'최근 측정 없음'};
      const descriptions={ok:'최근 요청이 정상적으로 완료됐습니다.',slow:'응답 지연 또는 오래 기다리는 요청이 있습니다.',error:'서버·연결 오류가 감지됐습니다. 원인은 확정할 수 없습니다.',auth:'로그인 또는 접근 권한을 확인하세요.',request:'요청 오류(4xx)가 있습니다.',idle:'최근 1분 동안 완료된 요청이 없습니다.'};
      $('health-note').textContent='처음 사용하는 서버는 확장 팝업 → 연결 상태 → 측정 시작에서 사이트 권한을 허용하세요.';
      const message=(text,error=false)=>{if(!closed){$('health-note').textContent=text;$('health-note').classList.toggle('review-error',error);}};
      function controls(){for(const id of ['health-toggle','health-auto','health-alerts'])$(id).disabled=busy;$('health-toggle').textContent=enabled?'이 탭 측정 끄기':'측정 시작';$('health-auto').checked=auto;}
      function connection(){const online=navigator.onLine;$('health-network').dataset.state=online===false?'offline':'online';$('health-network-status').textContent=online===false?'Chrome: 연결 끊김 감지':'Chrome: 네트워크 연결 감지';}
      function render(data){
        enabled=Boolean(data.enabled);auto=Boolean(data.auto);controls();connection();$('health-alerts').checked=data.alerts!==false;
        $('health-alert-warning').hidden=!(enabled&&data.alerts!==false&&data.pageReady===false);
        const state=enabled?(data.status||'idle'):'idle';$('health-state').dataset.state=state;$('health-status').textContent=enabled?names[state]:'측정 꺼짐';
        $('health-description').textContent=enabled?descriptions[state]:'측정을 켜면 이 탭의 기존 요청부터 확인합니다.';
        $('health-count').textContent=String(data.count||0);$('health-waiting').textContent=String(data.waiting||0);
        for(const kind of ['api','image','save','ai']){
          const g=data.groups?.find(item=>item.kind===kind);
          $('health-'+kind+'-median').textContent=g?.median==null?'—':g.median<1000?Math.round(g.median)+'ms':(g.median/1000).toFixed(1)+'초';
          $('health-'+kind+'-count').textContent=String(g?.count||0);$('health-'+kind+'-errors').textContent=String(g?.failures||0);
        }
        $('health-last').textContent=data.lastAt?`마지막 완료 ${Math.max(0,Math.floor((Date.now()-data.lastAt)/1000))}초 전`:'아직 측정된 요청이 없습니다.';
        $('health-errors').textContent=enabled?`최근 1분 · 서버 ${data.server||0} / 연결 ${data.network||0} / 요청 제한 ${data.limited||0}`:'';
      }
      async function send(type,extra={}){verify(target);const value=await chrome.runtime.sendMessage({type,context:target,...extra});verify(target);if(!value||value.error)throw Error(value?.error||'연결 상태를 받지 못했습니다.');return value;}
      function failure(error){message(error.message,true);$('health-status').textContent='상태 확인 실패';$('health-state').dataset.state='idle';$('health-description').textContent='최신 상태를 받지 못했습니다. 통계는 이전 조회 결과입니다.';}
      async function refresh(){const n=++sequence;try{const value=await send('CVAT_HEALTH_STATUS');if(!closed&&shown&&!busy&&n===sequence)render(value);}catch(error){if(!closed&&shown&&n===sequence)failure(error);}}
      function schedule(){clearTimeout(timer);if(shown&&!closed)timer=setTimeout(async()=>{if(!busy)await refresh();schedule();},2000);}
      async function change(type,extra){
        if(busy)return;busy=true;++sequence;controls();
        try{const result=await send(type,extra);if(closed)return;if(type==='CVAT_HEALTH_ALERTS')$('health-alerts').checked=result.alerts!==false;else render(result);message('설정을 적용했어요. 창을 닫아도 켜진 측정은 계속됩니다.');}
        catch(error){if(!closed){failure(error);if(/권한|permission|grant/i.test(error.message))message('사이트 권한이 필요합니다. 확장 팝업 → 연결 상태 → 측정 시작에서 허용한 뒤 다시 사용하세요.',true);}}
        finally{busy=false;controls();if(shown)await refresh();schedule();}
      }
      $('health-toggle').addEventListener('click',()=>void change(enabled?'CVAT_HEALTH_STOP':'CVAT_HEALTH_START'));
      $('health-auto').addEventListener('change',()=>void change('CVAT_HEALTH_AUTO',{enabled:$('health-auto').checked}));
      $('health-alerts').addEventListener('change',()=>void change('CVAT_HEALTH_ALERTS',{enabled:$('health-alerts').checked}));
      window.addEventListener('online',connection);window.addEventListener('offline',connection);
      return {view,setVisible(value){if(shown===value)return;shown=value;++sequence;if(value)void refresh();schedule();},destroy(){closed=true;shown=false;++sequence;clearTimeout(timer);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);}};
    }
    return {
      setView(name){
        if(dead)return;
        const identity=location.origin+location.pathname;if(bound!==identity){reset();bound=identity;}
        if(current===name)return;
        if(current==='review'||current==='health')positions[current]=container.scrollTop;
        current=name;
        if(name==='review'&&!review)review=makeReview();
        if(name==='health'&&!health)health=makeHealth();
        if(review){review.view.hidden=name!=='review';if(name==='review')review.activate();}
        if(health){health.view.hidden=name!=='health';health.setVisible(name==='health');}
        container.scrollTop=positions[name]||0;
      },destroy(){dead=true;reset();}
    };
  }
  globalThis.CVATWorkspacePanels=Object.freeze({create});
})();
