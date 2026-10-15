(() => {
  'use strict';
  const $=id=>document.getElementById(id), button=$('health-toggle'), note=$('health-note'), automatic=$('health-auto');
  let tab,enabled=false,busy=false,auto=false,currentScreen='shortcuts',timer,closed=false,requestNumber=0;
  const supported=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)&&/^\/tasks\/\d+\/jobs\/\d+\/?$/.test(u.pathname);}catch{return false;}};
  const texts={ok:'응답 정상',slow:'응답 지연',error:'오류 감지',auth:'로그인·권한 확인',request:'요청 오류 확인',idle:'최근 측정 없음'};
  const descriptions={ok:'최근 요청이 정상적으로 완료됐습니다.',slow:'느린 응답이 반복되거나 오래 기다리는 요청이 있습니다.',error:'서버 오류·연결 실패·요청 제한이 감지됐습니다. 원인은 확정할 수 없습니다.',auth:'로그인 만료 또는 접근 권한 문제일 수 있습니다.',request:'요청 오류(4xx)가 있습니다. 서버 장애와 구분해서 확인하세요.',idle:'최근 1분 동안 측정 가능한 완료 요청이 없습니다.'};
  function controls(){
    button.textContent=enabled?'이 탭 측정 끄기':'측정 시작';button.disabled=busy||!supported(tab?.url);
    automatic.checked=auto;automatic.disabled=busy||!supported(tab?.url);
  }
  function render(data){
    enabled=Boolean(data.enabled);auto=Boolean(data.auto);controls();
    const state=enabled?(data.status||'idle'):'idle';$('health-state').dataset.state=state;
    $('health-status').textContent=enabled?texts[state]:'측정 꺼짐';
    $('health-description').textContent=!supported(tab?.url)?'CVAT Job 탭에서 열어주세요.':enabled?descriptions[state]:'측정을 켜면 이 탭의 기존 요청부터 확인합니다.';
    $('health-count').textContent=String(data.count||0);$('health-waiting').textContent=String(data.waiting||0);
    for(const kind of ['api','image','save','ai']){
      const g=data.groups?.find(item=>item.kind===kind);
      $('health-'+kind+'-median').textContent=g?.median==null?'—':g.median<1000?Math.round(g.median)+'ms':(g.median/1000).toFixed(1)+'초';
      $('health-'+kind+'-count').textContent=String(g?.count||0);$('health-'+kind+'-errors').textContent=String(g?.failures||0);
    }
    $('health-last').textContent=data.lastAt?`마지막 완료 ${Math.max(0,Math.floor((Date.now()-data.lastAt)/1000))}초 전`:'아직 측정된 요청이 없습니다.';
    $('health-errors').textContent=enabled?`최근 1분 · 서버 ${data.server||0} / 연결 ${data.network||0} / 요청 제한 ${data.limited||0}`:'';
  }
  function failure(error){
    note.textContent=/Receiving end does not exist|Could not establish connection/i.test(error.message||'')?'확장 연결을 준비하지 못했습니다. chrome://extensions에서 이 확장을 새로고침한 뒤 팝업을 다시 여세요.':error.message||'상태 확인 실패';
    $('health-state').dataset.state='idle';$('health-status').textContent='상태 확인 실패';
    $('health-description').textContent='최신 상태를 받지 못했습니다. 표시된 통계는 이전 조회 결과입니다.';
  }
  async function refresh(){
    const sequence=++requestNumber;
    if(!supported(tab?.url)){render({enabled:false});return;}
    try{
      const data=await chrome.runtime.sendMessage({type:'CVAT_HEALTH_STATUS',tabId:tab.id});
      if(closed||busy||sequence!==requestNumber)return;
      if(!data||data.error)throw new Error(data?.error||'측정 상태를 받지 못했습니다.');
      render(data);
    }catch(error){if(!closed&&!busy&&sequence===requestNumber)failure(error);}
  }
  function schedule(){clearTimeout(timer);if(!closed&&currentScreen==='health')timer=setTimeout(async()=>{if(!busy)await refresh();schedule();},2000);}
  function selectScreen(name,focus=false){
    if(name==='health'&&!$('recording').hidden)$('cancel').click();
    currentScreen=name;
    for(const value of ['shortcuts','health']){
      const active=value===name,control=$('screen-'+value);
      control.setAttribute('aria-selected',String(active));control.tabIndex=active?0:-1;$(value+'-screen').hidden=!active;
    }
    if(focus)$('screen-'+name).focus();
    window.scrollTo(0,0);
    if(name==='health'&&!busy)void refresh();
    schedule();
  }
  for(const name of ['shortcuts','health']){
    $('screen-'+name).addEventListener('click',()=>selectScreen(name));
    $('screen-'+name).addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();selectScreen(event.key==='Home'?'shortcuts':event.key==='End'?'health':name==='health'?'shortcuts':'health',true);
    });
  }
  function grant(){const u=new URL(tab.url);return chrome.permissions.request({permissions:['webRequest'],origins:[`${u.protocol}//${u.hostname}/*`]});}
  async function verifyTab(){const [current]=await chrome.tabs.query({active:true,currentWindow:true});if(current?.id!==tab?.id||current?.url!==tab?.url)throw new Error('탭이 바뀌었습니다. 팝업을 다시 열어주세요.');}
  automatic.addEventListener('change',async()=>{
    if(busy)return;
    const desired=automatic.checked;busy=true;++requestNumber;controls();
    try{
      if(desired&&!await grant())throw new Error('사이트 권한을 허용하지 않아 자동 측정을 켜지 않았습니다.');
      await verifyTab();
      const data=await chrome.runtime.sendMessage({type:'CVAT_HEALTH_AUTO',tabId:tab.id,enabled:desired});
      if(!data||data.error)throw new Error(data?.error||'자동 측정 설정 실패');
      render(data);note.textContent=auto?'자동 측정을 켰습니다. 팝업을 닫아도 계속 측정하며, 다음 접속에도 자동으로 시작합니다.':'이 서버의 자동 측정과 현재 측정을 껐습니다.';
    }catch(error){failure(error);}
    finally{busy=false;controls();schedule();}
  });
  button.addEventListener('click',async()=>{
    if(busy)return;busy=true;++requestNumber;controls();
    try{
      if(!enabled&&!await grant()){note.textContent='사이트 권한을 허용하지 않아 측정을 시작하지 않았습니다. 단축키는 계속 사용할 수 있습니다.';return;}
      await verifyTab();
      const data=await chrome.runtime.sendMessage({type:enabled?'CVAT_HEALTH_STOP':'CVAT_HEALTH_START',tabId:tab.id});
      if(!data||data.error)throw new Error(data?.error||'측정 설정 실패');
      render(data);note.textContent=enabled?'측정 중입니다. 팝업을 닫아도 계속 집계합니다.':auto?'이 탭을 잠시 껐습니다. 새로고침이나 다른 Job으로 이동하면 다시 켜집니다.':'측정을 껐습니다. 이 탭의 기록을 지웠습니다.';
    }catch(error){failure(error);}
    finally{busy=false;controls();schedule();}
  });
  window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);++requestNumber;},{once:true});
  void(async()=>{
    try{[tab]=await chrome.tabs.query({active:true,currentWindow:true});await refresh();}
    catch(error){failure(error);}controls();
  })();
})();
