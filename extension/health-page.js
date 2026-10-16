/* Local connection events and a temporary notice. No probes, polling or page data. */
(() => {
  'use strict';
  const KEY='__cvatHealthPageV231';
  if(globalThis[KEY])return;
  let config=null,host=null,timer=null,noticeCategory=null;
  const titles={server:'서버 오류 응답',network:'요청 연결 실패',limited:'요청 제한',auth:'로그인·권한 확인',request:'요청 오류',offline:'네트워크 연결 끊김 감지'};
  const descriptions={server:'CVAT 요청에 서버 오류 응답(5xx)이 왔습니다.',network:'요청을 완료하지 못했습니다. 서버와 네트워크 중 원인은 아직 알 수 없습니다.',limited:'CVAT가 요청을 제한했습니다(429). 잠시 후 상태를 확인하세요.',auth:'로그인 상태 또는 작업 접근 권한을 확인하세요(401/403).',request:'CVAT 요청이 거절됐습니다(4xx). 팝업에서 연결 상태를 확인하세요.',offline:'Chrome이 오프라인 상태를 감지했습니다. Wi-Fi 신호 세기나 정확한 원인은 확인할 수 없습니다.'};
  const labels={api:'일반 API',image:'이미지',save:'저장',ai:'AI'};
  const active=()=>config&&location.origin===config.origin&&location.pathname===config.jobPath;
  function clearNotice(){clearTimeout(timer);timer=null;host?.remove();host=null;noticeCategory=null;}
  function show(category,kind){
    if(!active()||!config.alerts||!Object.hasOwn(titles,category))return;
    clearNotice();
    noticeCategory=category;
    host=document.createElement('div');host.id='cvat-shortcuts-health-notice';
    host.style.cssText='all:initial;position:fixed;top:72px;right:16px;width:min(340px,calc(100vw - 32px));z-index:2147483647;pointer-events:none;';
    const root=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent=':host{color-scheme:light}*{box-sizing:border-box}.notice{pointer-events:auto;background:#fff7f4;color:#422b27;border:1px solid #e8afa1;border-left:4px solid #c34129;border-radius:10px;padding:14px 38px 14px 14px;box-shadow:0 6px 24px #0002;font:13px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}strong{display:block;font-size:14px;margin:0 0 5px}p{margin:0}small{display:block;margin-top:7px;color:#74554d;font-size:11px}button{position:absolute;top:8px;right:8px;border:0;background:transparent;color:#74554d;font:20px/24px system-ui;cursor:pointer;width:26px;height:26px;border-radius:5px}button:focus-visible{outline:2px solid #1d5ab5}';
    const card=document.createElement('div');card.className='notice';card.setAttribute('role','alert');
    const title=document.createElement('strong');title.textContent=(Object.hasOwn(labels,kind)?labels[kind]+' · ':'')+titles[category];
    const text=document.createElement('p');text.textContent=descriptions[category]+(kind==='save'?' 저장 완료 여부를 확인하세요.':'');
    const help=document.createElement('small');help.textContent='CVAT 단축키 · 자세한 내용은 팝업의 연결 상태';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','연결 상태 알림 닫기');
    close.addEventListener('click',clearNotice);
    // Notice controls must not activate CVAT or extension drawing shortcuts.
    for(const type of ['keydown','keyup','keypress','pointerdown','pointerup','click','wheel'])card.addEventListener(type,event=>event.stopPropagation());
    card.append(title,text,help,close);root.append(style,card);document.documentElement.append(host);
    timer=setTimeout(clearNotice,8000);
  }
  function connectionChanged(){
    if(!active())return;
    if(navigator.onLine===true&&noticeCategory==='offline')clearNotice();
    try{void chrome.runtime.sendMessage({type:'CVAT_HEALTH_NETWORK',pageId:config.pageId,online:navigator.onLine}).catch(dispose);}catch{dispose();}
  }
  function noticeKey(event){if(host&&event.composedPath().includes(host))event.stopImmediatePropagation();}
  function dispose(){
    config=null;clearNotice();window.removeEventListener('online',connectionChanged);window.removeEventListener('offline',connectionChanged);
    for(const type of ['keydown','keyup','keypress'])window.removeEventListener(type,noticeKey,true);
    window.removeEventListener('pagehide',dispose);try{chrome.runtime.onMessage.removeListener(message);}catch{}delete globalThis[KEY];
  }
  function message(value,sender,respond){
    if(sender.id!==chrome.runtime.id||!value?.type?.startsWith('CVAT_HEALTH_PAGE_'))return;
    if(value.type==='CVAT_HEALTH_PAGE_START'){
      if(value.origin!==location.origin||value.jobPath!==location.pathname||!/^\/tasks\/\d+\/jobs\/\d+\/?$/.test(location.pathname)||typeof value.pageId!=='string')return;
      if(config?.pageId!==value.pageId)clearNotice();
      config={pageId:value.pageId,origin:value.origin,jobPath:value.jobPath,alerts:value.alerts===true};
      if(!config.alerts)clearNotice();
      respond({ready:true,online:navigator.onLine});return;
    }
    if(!config||value.pageId!==config.pageId)return;
    if(value.type==='CVAT_HEALTH_PAGE_STOP'){dispose();respond({stopped:true});return;}
    if(!active())return;
    if(value.type==='CVAT_HEALTH_PAGE_SETTINGS'){config.alerts=value.alerts===true;if(!config.alerts)clearNotice();respond({ready:true});}
    else if(value.type==='CVAT_HEALTH_PAGE_NOTICE'){show(value.category,value.kind);respond({shown:Boolean(host)});}
  }
  globalThis[KEY]=true;
  chrome.runtime.onMessage.addListener(message);
  window.addEventListener('online',connectionChanged);window.addEventListener('offline',connectionChanged);window.addEventListener('pagehide',dispose);
  for(const type of ['keydown','keyup','keypress'])window.addEventListener(type,noticeKey,true);
})();
