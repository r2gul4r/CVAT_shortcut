/* ISOLATED: Job-wide skeleton location chooser in the screen overlay. */
(() => {
  'use strict';
  function create(parent){
    const section=document.createElement('section');section.className='tool';section.dataset.locationPanel='';
    const add=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;section.append(n);return n;};
    add('h3','스켈레톤 location 일괄 변경');
    add('p','현재 Job 전체의 스켈레톤을 tag 또는 sticker로 지정합니다. 좌표·그룹·다른 속성은 유지합니다.').className='view-help';
    const label=add('label','변경할 location '),select=document.createElement('select');select.dataset.location='value';select.setAttribute('aria-label','스켈레톤 location');label.append(select);
    const reload=add('button','선택값 다시 읽기');reload.type='button';reload.dataset.location='reload';
    const scan=add('button','변경 대상 검사');scan.type='button';scan.dataset.location='scan';
    const status=add('p','');status.dataset.location='status';status.setAttribute('role','status');status.style.whiteSpace='pre-line';
    const list=add('div','');list.dataset.location='results';list.style.cssText='max-height:160px;overflow:auto;overflow-wrap:anywhere;font-size:12px';
    const apply=add('button','Job 전체에 적용');apply.type='button';apply.dataset.location='apply';
    add('p','스켈레톤 Shape 대상입니다. 이미 같은 값은 유지하고, 잠금·보호 객체·삭제 프레임·Track 및 해당 속성이 없는 라벨은 제외합니다. 숨김·필터에 가린 객체도 포함합니다. 적용 후 CVAT에서 저장하세요.').className='view-help';parent.prepend(section);
    let active=false,dead=false,busy=false,result=null,path='',epoch=0;const pending=new Set();
    function live(){try{return !dead&&Boolean(chrome.runtime?.id);}catch{return false;}}
    function render(){select.disabled=!active||busy;reload.disabled=!active||busy;scan.disabled=!active||busy||!select.value;apply.disabled=!active||busy||!result?.count;}
    function clear(){result=null;list.replaceChildren();render();}
    function request(action,extra={}){return new Promise((resolve,reject)=>{
      const node=document.createElement('span');node.hidden=true;node.setAttribute('data-request',JSON.stringify({version:1,origin:location.origin,path:location.pathname,action,...extra}));
      let timer;const done=(error,value)=>{clearTimeout(timer);observer.disconnect();pending.delete(cancel);node.remove();error?reject(Error(error)):resolve(value);},cancel=()=>done('작업 화면이 바뀌었습니다. 적용 중이었다면 CVAT에서 결과를 확인하세요.');
      const observer=new MutationObserver(()=>{const raw=node.getAttribute('data-response');if(raw){try{const value=JSON.parse(raw);done(value.error,value);}catch{done('응답을 읽지 못했습니다.');}}});observer.observe(node,{attributes:true,attributeFilter:['data-response']});pending.add(cancel);
      timer=setTimeout(()=>done('응답 시간이 초과됐습니다. CVAT에서 결과를 확인하세요.'),60000);document.body.append(node);node.dispatchEvent(new Event('cvat-shortcuts-location-v1',{bubbles:true}));
    });}
    function rows(value){list.replaceChildren();const texts=[...value.targets.map(t=>`프레임 ${t.frame} · #${t.id}: ${t.before} → ${t.value}`),...value.skipped.map(s=>`제외 · 프레임 ${s.frame} · #${s.id}: ${s.reason}`)];for(const text of texts.slice(0,100)){const p=document.createElement('p');p.textContent=text;list.append(p);}if(texts.length>100){const p=document.createElement('p');p.textContent=`처음 100건을 표시합니다. 적용은 변경 대상 ${value.count}개 전체입니다.`;list.append(p);}}
    async function execute(action){
      if(!active||busy||!live()||path!==location.pathname)return;
      const revision=epoch,token=result?.token;if(action==='apply'&&!token)return;
      busy=true;if(action!=='apply')clear();render();status.textContent=action==='catalog'?'location 선택값을 읽는 중…':action==='preview'?'Job 전체의 스켈레톤을 검사하는 중…':'location을 변경하는 중…';
      try{const value=await request(action,action==='preview'?{value:select.value}:action==='apply'?{token}:{});if(revision!==epoch||!active||!live())return;
        if(action==='catalog'){
          select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='tag / sticker 선택';select.append(empty);
          for(const option of value.options){const o=document.createElement('option');o.value=option;o.textContent=option;select.append(o);}
          status.textContent=value.options.length?`Job ${value.jobId} · location을 고르고 변경 대상을 검사하세요.`:'현재 Job에서 tag·sticker 선택이 가능한 location 속성을 찾지 못했습니다.';
        }else if(action==='preview'){result=value;rows(value);status.textContent=`Job ${value.jobId} 전체 → ${value.value}\n변경 ${value.count}개 · 이미 같은 값 ${value.same}개\n제외 ${value.skipped.length}개 · 삭제 프레임 객체 ${value.deleted}개 · Track ${value.tracks}개`;}
        else{clear();status.textContent=`${value.applied}개를 ${value.value}로 변경했습니다.\nCVAT에서 결과를 확인하고 저장하세요. 되돌리기는 객체별로 적용됩니다.`;}
      }catch(error){if(revision===epoch){clear();if(action==='catalog')select.replaceChildren();status.textContent=error.message;}}
      finally{if(revision===epoch){busy=false;render();}}
    }
    function reset(){epoch++;for(const cancel of [...pending])cancel();busy=false;clear();}
    select.onchange=()=>{reset();status.textContent='변경할 값을 선택했습니다. 대상을 검사하세요.';};reload.onclick=()=>void execute('catalog');scan.onclick=()=>void execute('preview');apply.onclick=()=>void execute('apply');
    const timer=setInterval(()=>{if(!live()){destroy();return;}if(active&&path!==location.pathname){reset();path=location.pathname;select.replaceChildren();void execute('catalog');}},750);
    function destroy(){if(dead)return;active=false;reset();dead=true;clearInterval(timer);}
    render();return {enable(){if(!live())return;active=true;path=location.pathname;render();void execute('catalog');},disable(){active=false;reset();select.replaceChildren();status.textContent='';},destroy};
  }
  globalThis.CVATLocationPanel=Object.freeze({create});
})();
