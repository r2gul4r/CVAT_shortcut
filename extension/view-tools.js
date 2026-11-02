/* Isolated-world controller: local Job display preferences and overlay controls. */
(() => {
  'use strict';
  const defaults=()=>({hidden:[],grid:{enabled:false,spacing:32,opacity:35,color:'#00bcd4'}});
  const validPath=()=>/^\/tasks\/\d+\/jobs\/\d+\/?$/.test(location.pathname);
  function normalize(value){
    const d=defaults(),g=value?.grid;
    return {hidden:Array.isArray(value?.hidden)?[...new Set(value.hidden.filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,10000):[],grid:{
      enabled:g?.enabled===true,spacing:Number.isInteger(g?.spacing)?Math.min(160,Math.max(8,g.spacing)):d.grid.spacing,
      opacity:Number.isInteger(g?.opacity)?Math.min(80,Math.max(5,g.opacity)):d.grid.opacity,color:/^#[0-9a-f]{6}$/i.test(g?.color)?g.color:d.grid.color}};
  }
  function create(container,onChange){
    const markup = [["section",{"class":"tool"},[["h3",{},["이미지 기울기"]],["p",{},["바코드를 격자에 맞춰 돌리세요. 새 스켈레톤 틀은 화면 수평을 유지합니다."]],"\n      ",["div",{"class":"view-angle-buttons"},[["button",{"type":"button","data-view":"minus","aria-label":"이미지 반시계 방향 1도 회전"},["−1°"]],["output",{"data-view":"angle-value"},["0°"]],["button",{"type":"button","data-view":"plus","aria-label":"이미지 시계 방향 1도 회전"},["+1°"]]]],"\n      ",["div",{"class":"view-angle-input"},[["input",{"type":"number","min":"-360","max":"360","step":"1","aria-label":"이미지 회전 각도","data-view":"angle"},[]],["button",{"type":"button","data-view":"apply"},["적용"]],["button",{"type":"button","data-view":"reset"},["0° 복귀"]]]],"\n      ",["p",{"class":"view-help"},["현재 프레임만 회전합니다. 원본 이미지와 라벨 좌표는 유지됩니다. 그리기를 마친 뒤 각도를 바꾸세요."]],"\n      ",["p",{"class":"view-help"},["브러쉬·AI 도구로 전환하면 좌표 호환을 위해 0°로 돌아갑니다."]]]],"\n      ",["section",{"class":"tool"},[["h3",{},["수평·수직 격자"]],["label",{},[["input",{"type":"checkbox","data-view":"grid"},[]]," 격자 표시"]],["p",{"class":"view-help"},["화면에 고정된 선입니다. 이미지를 돌리거나 확대해도 선은 수평·수직을 유지합니다."]],"\n      ",["label",{"class":"view-field"},["간격 ",["select",{"data-view":"spacing","aria-label":"격자 간격"},[["option",{"value":"16"},["16 px"]],["option",{"value":"24"},["24 px"]],["option",{"value":"32"},["32 px"]],["option",{"value":"48"},["48 px"]],["option",{"value":"64"},["64 px"]],["option",{"value":"96"},["96 px"]]]]]],"\n      ",["label",{"class":"view-field"},["선명도 ",["select",{"data-view":"opacity","aria-label":"격자 선명도"},[["option",{"value":"20"},["20%"]],["option",{"value":"35"},["35%"]],["option",{"value":"50"},["50%"]],["option",{"value":"70"},["70%"]]]]]],"\n      ",["label",{"class":"view-field"},["색상 ",["select",{"data-view":"color","aria-label":"격자 색상"},[["option",{"value":"#00bcd4"},["청록"]],["option",{"value":"#ffffff"},["흰색"]],["option",{"value":"#000000"},["검정"]],["option",{"value":"#ffeb3b"},["노랑"]]]]]]]],"\n      ",["section",{"class":"tool"},[["h3",{},["라벨 숨김"]],["p",{"data-view":"hidden-count"},["숨긴 라벨 0개"]],["button",{"type":"button","data-view":"show-all"},["숨김 모두 해제"]],["p",{"class":"view-help"},["라벨 선택 탭의 눈 버튼으로 숨깁니다. 현재 Job의 모든 프레임에 적용되고 이 브라우저에 기억됩니다."]]]],"\n      ",["p",{"class":"view-status","data-view":"message","role":"status"},[]]];
    const build=value=>{if(typeof value==='string')return document.createTextNode(value);const [tag,attrs,children]=value,node=document.createElement(tag);for(const [name,text]of Object.entries(attrs))node.setAttribute(name,text??'');node.append(...children.map(build));return node;};
    container.replaceChildren(...markup.map(build));
    const rotationStatus=document.createElement('p');rotationStatus.className='view-help';rotationStatus.dataset.view='rotation-status';rotationStatus.setAttribute('role','status');container.querySelector('.view-angle-input').after(rotationStatus);
    const grouping=globalThis.CVATGroupPanel?.create(container);
    const locationPanel=globalThis.CVATLocationPanel?.create(container);
    const prefetchPanel=globalThis.CVATPrefetchPanel?.create(container);
    const $=name=>container.querySelector(`[data-view="${name}"]`);
    let active=false,dead=false,bound='',key='',loaded=false,prefs=defaults(),snapshot=null,timer=null,epoch=0,saved=Promise.resolve(),message='';
    function bridge(action,extra={}){
      const node=document.createElement('span');node.hidden=true;
      node.setAttribute('data-request',JSON.stringify({version:1,origin:location.origin,path:location.pathname,action,...extra}));
      try{document.body.append(node);node.dispatchEvent(new Event('cvat-shortcuts-view-v1',{bubbles:true}));const raw=node.getAttribute('data-response');if(!raw)throw Error('화면 기능을 연결하지 못했습니다. CVAT를 새로고침하고 확장을 다시 켜세요.');return JSON.parse(raw);}finally{node.remove();}
    }
    function live(){try{if(!dead&&chrome.runtime?.id)return true;}catch{}destroy();return false;}
    function stop(){try{bridge('stop');}catch{}}
    function render(){
      const available=active&&loaded&&snapshot&&!snapshot.error,angle=snapshot?.angle||0;
      $('angle-value').textContent=(angle>180?angle-360:angle)+'°';
      if(container.getRootNode().activeElement!==$('angle'))$('angle').value=String(angle>180?angle-360:angle);
      for(const name of ['minus','plus','apply','angle'])$(name).disabled=!available||!snapshot.rotationSupported||snapshot.busy;
      $('reset').disabled=!active||!loaded||!snapshot?.resetSupported;
      $('reset').textContent=snapshot?.resetCancelsTool?'도구 취소 후 0°':'0° 복귀';
      $('reset').title=snapshot?.resetReason||'현재 프레임을 원래 방향으로 복구합니다.';
      rotationStatus.textContent=message||snapshot?.resetReason||snapshot?.error||'';
      for(const name of ['grid','spacing','opacity','color','show-all'])$(name).disabled=!active||!loaded||!available;
      $('grid').checked=prefs.grid.enabled;for(const name of ['spacing','opacity','color'])$(name).value=String(prefs.grid[name]);
      $('hidden-count').textContent=`숨긴 라벨 ${prefs.hidden.length}개`;
      $('message').textContent=message||snapshot?.error||snapshot?.notice||(!loaded?'Job 화면 설정을 불러오는 중입니다.':!snapshot?.rotationSupported?'이 CVAT 버전의 1도 회전 연결을 확인하지 못했습니다.':'각도와 격자는 작업 화면에만 적용됩니다.');
    }
    async function bind(){
      const path=location.pathname,n=++epoch;bound=path;key='cvatViewToolsV1:'+location.origin+path;loaded=false;snapshot=null;prefs=defaults();message='';render();onChange?.();
      try{const value=await chrome.storage.local.get(key);if(n!==epoch||!active||path!==location.pathname)return;prefs=normalize(value[key]);loaded=true;sync();}
      catch{if(n===epoch){message='Job 화면 설정을 읽지 못했습니다. 다시 활성화하세요.';render();}}
    }
    function sync(){
      if(!active||!loaded||!live())return;
      if(bound!==location.pathname||!validPath())return;
      try{snapshot=bridge('sync',prefs);if(!snapshot.error&&Array.isArray(snapshot.hidden))prefs={...prefs,hidden:snapshot.hidden};}catch(error){snapshot={error:error.message};}
      render();onChange?.();
    }
    function tick(){if(!active||!live())return;if(!validPath()){if(bound){stop();bound='';loaded=false;snapshot=null;render();onChange?.();}return;}if(bound!==location.pathname){void bind();return;}sync();}
    function save(){
      const target=key,value=structuredClone(prefs);
      saved=saved.catch(()=>{}).then(()=>live()?chrome.storage.local.set({[target]:value}):undefined).catch(()=>{message='화면 설정을 저장하지 못했습니다.';render();});
    }
    function update(change){
      if(!active||!loaded||bound!==location.pathname||!snapshot||snapshot.error)return;
      const old=prefs;prefs=normalize(change(prefs));message='';sync();
      if(snapshot?.error){prefs=old;render();return;}save();
    }
    function toggle(name){
      const matches=snapshot?.labels?.filter(l=>l.name===name&&l.type!=='tag')||[];
      if(matches.length!==1)return;
      const id=matches[0].id;update(p=>({...p,hidden:p.hidden.includes(id)?p.hidden.filter(x=>x!==id):[...p.hidden,id]}));
    }
    function rotate(value,reset=false){
      if(!active||!loaded||bound!==location.pathname)return;
      message='';
      try{const result=bridge(reset?'reset':'angle',{angle:value});if(result.error)message=result.error;else snapshot=result;}catch(error){message=error.message;}
      render();onChange?.();
    }
    $('minus').onclick=()=>rotate(((snapshot?.angle||0)+359)%360);
    $('plus').onclick=()=>rotate(((snapshot?.angle||0)+1)%360);
    $('reset').onclick=()=>rotate(0,true);
    $('apply').onclick=()=>{const raw=$('angle').value;if(!raw.trim()||!Number.isInteger(Number(raw))||Number(raw)<-360||Number(raw)>360){message='-360~360 사이의 정수 각도를 입력하세요.';render();return;}rotate(Number(raw));};
    $('show-all').onclick=()=>update(p=>({...p,hidden:[]}));
    for(const name of ['grid','spacing','opacity','color'])$(name).onchange=()=>update(p=>({...p,grid:{...p.grid,[name==='grid'?'enabled':name]:name==='grid'?$('grid').checked:name==='color'?$(name).value:Number($(name).value)}}));
    function destroy(){if(dead)return;prefetchPanel?.destroy();locationPanel?.destroy();grouping?.destroy();stop();dead=true;active=false;epoch++;clearInterval(timer);try{chrome.storage.onChanged.removeListener(storage);}catch{}}
    const storage=(changes,area)=>{if(area==='local'&&loaded&&changes[key]){prefs=normalize(changes[key].newValue);sync();}};
    chrome.storage.onChanged.addListener(storage);
    render();
    return {toggle,showAll:()=>update(p=>({...p,hidden:[]})),getState:()=>({ready:active&&loaded&&!!snapshot&&!snapshot.error,labels:snapshot?.labels||[],hidden:prefs.hidden,job:bound}),
      enable(){if(!live())return;active=true;prefetchPanel?.enable();locationPanel?.enable();grouping?.enable();clearInterval(timer);timer=setInterval(tick,750);if(bound!==location.pathname||!loaded)void bind();else sync();},
      disable(){prefetchPanel?.disable();locationPanel?.disable();grouping?.disable();stop();active=false;epoch++;loaded=false;bound='';snapshot=null;clearInterval(timer);render();},destroy};
  }
  globalThis.CVATViewTools=Object.freeze({create});
})();
