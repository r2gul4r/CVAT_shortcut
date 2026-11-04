/* ISOLATED: group preview and apply controls in the shared screen overlay. */
(() => {
  'use strict';
  function create(parent){
    const section=document.createElement('section');section.className='tool';section.dataset.groupPanel='';
    const add=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;section.append(n);return n;};
    add('h3','박스·폴리곤·스켈레톤 자동 그룹화');
    add('p','스켈레톤 중심이나 관절 하나 이상이 들어간 폴리곤·박스를 함께 묶습니다. 기존 그룹과 관계없이 폴리곤 + 박스 + 스켈레톤을 새 그룹으로 묶고, 박스가 없으면 폴리곤 + 스켈레톤을 묶습니다.').className='view-help';
    const label=add('label','검사 범위 '),scope=document.createElement('select');scope.dataset.group='scope';scope.setAttribute('aria-label','자동 그룹화 범위');
    for(const [value,text]of [['current','현재 프레임'],['all','현재 Job 전체']]){const o=document.createElement('option');o.value=value;o.textContent=text;scope.append(o);}label.append(scope);
    const scan=add('button','그룹 대상 검사');scan.type='button';scan.dataset.group='scan';
    const status=add('p','');status.dataset.group='status';status.setAttribute('role','status');status.style.whiteSpace='pre-line';
    const list=add('div','');list.dataset.group='results';list.style.cssText='max-height:180px;overflow:auto;overflow-wrap:anywhere;font-size:12px;';
    const apply=add('button','매칭된 대상 그룹화');apply.type='button';apply.dataset.group='apply';
    add('p','이미지 가장자리에 일부만 보이는 스켈레톤도 포함합니다. 같은 스켈레톤의 중심이나 관절이 들어간 여러 도형은 함께 묶이므로 검사 목록을 확인하세요. 매칭된 객체만 새 그룹으로 이동하고, 다른 프레임·비대상 객체의 그룹 번호는 유지합니다. 이미 같은 그룹이면 건너뜁니다. 자기 교차 폴리곤도 화면의 채워진 영역으로 판정합니다. 좌표를 읽을 수 없는 도형만 제외하고 나머지는 검사합니다. 잠금·보호·Track은 제외합니다. 적용 후 CVAT에서 저장하세요.').className='view-help';
    parent.prepend(section);
    let active=false,dead=false,busy=false,result=null,path='',epoch=0;
    const pending=new Set();
    function live(){try{return !dead&&Boolean(chrome.runtime?.id);}catch{return false;}}
    function render(){scope.disabled=!active||busy;scan.disabled=!active||busy;apply.disabled=!active||busy||!result?.groups?.length;}
    function clear(){result=null;list.replaceChildren();render();}
    function request(action,extra={}){
      return new Promise((resolve,reject)=>{
        const node=document.createElement('span');node.hidden=true;node.setAttribute('data-request',JSON.stringify({version:1,origin:location.origin,path:location.pathname,action,...extra}));
        let timer;const done=(error,value)=>{clearTimeout(timer);observer.disconnect();pending.delete(cancel);node.remove();error?reject(Error(error)):resolve(value);};
        const cancel=()=>done('실행 창이 닫혔습니다. 적용 중이었다면 CVAT에서 결과를 확인하세요.');
        const observer=new MutationObserver(()=>{const raw=node.getAttribute('data-response');if(raw){try{const value=JSON.parse(raw);done(value.error,value);}catch{done('그룹 결과를 읽지 못했습니다.');}}});
        observer.observe(node,{attributes:true,attributeFilter:['data-response']});pending.add(cancel);
        timer=setTimeout(()=>done('응답 시간이 초과됐습니다. 적용 중이었다면 CVAT에서 결과를 확인하세요.'),60000);
        document.body.append(node);node.dispatchEvent(new Event('cvat-shortcuts-group-2.15.4',{bubbles:true}));
      });
    }
    function rows(value){
      list.replaceChildren();
      const all=[...value.groups.map(g=>`프레임 ${g.frame}: ${[[g.box,...(g.boxes||[])].filter(Number.isSafeInteger).map(id=>'박스 #'+id).join(' + '),[g.polygon,...(g.polygons||[])].filter(Number.isSafeInteger).map(id=>'폴리곤 #'+id).join(' + '),'스켈레톤 '+g.skeletons.map(id=>'#'+id).join(', ')].filter(Boolean).join(' + ')}${g.previousGroups?.length?' (기존 그룹 '+g.previousGroups.map(id=>'#'+id).join(', ')+' → 함께 새 번호)':''}`),...(value.invalid||[]).map(s=>`도형 제외 · 프레임 ${s.frame} · #${s.id}: ${s.reason}`),...value.skipped.map(s=>`제외 · 프레임 ${s.frame} · #${s.id}: ${s.reason}`)];
      for(const text of all.slice(0,100)){const p=document.createElement('p');p.textContent=text;list.append(p);}
      if(all.length>100){const p=document.createElement('p');p.textContent=`목록은 처음 100건을 표시합니다. 적용은 매칭된 ${value.groups.length}그룹 전체에 수행됩니다.`;list.append(p);}
    }
    async function execute(action){
      if(!active||busy||!live()||path!==location.pathname)return;
      const version=epoch,token=result?.token;if(action==='apply'&&!token)return;
      busy=true;if(action==='preview')clear();render();status.textContent=action==='preview'?'포함 관계를 검사하는 중…':'매칭된 도형별로 그룹화하는 중…';
      try{
        const value=await request(action,action==='preview'?{scope:scope.value}:{token});
        if(version!==epoch||!active||!live())return;
        if(action==='preview'){result=value;rows(value);status.textContent=`Job ${value.jobId} · ${value.scope==='all'?'Job 전체':`프레임 ${value.frame}`}\n매칭 ${value.groups.length}그룹 · 제외 스켈레톤 ${value.skipped.length}개 · 빈 도형 ${value.empty}개 · 좌표 확인 도형 ${value.invalid?.length||0}개\n삭제 프레임 ${value.deleted}개 제외${value.tracks?' · Track은 자동 그룹화하지 않습니다.':''}`;}
        else{clear();status.textContent=`${value.applied}그룹 완료 · 스켈레톤 ${value.skeletons}개\nCVAT에서 결과를 확인하고 저장하세요. 되돌리기는 그룹별로 적용됩니다.`;}
      }catch(error){if(version===epoch){clear();status.textContent=error.message;}}
      finally{if(version===epoch){busy=false;render();}}
    }
    function reset(){epoch++;for(const cancel of [...pending])cancel();busy=false;clear();}
    scope.onchange=()=>{reset();status.textContent='범위가 바뀌었습니다. 그룹 대상을 다시 검사하세요.';};
    scan.onclick=()=>void execute('preview');apply.onclick=()=>void execute('apply');
    const timer=setInterval(()=>{
      if(!live()){destroy();return;}
      if(active&&path!==location.pathname){reset();path=location.pathname;status.textContent='Job이 바뀌었습니다. 그룹 대상을 다시 검사하세요.';}
    },750);
    function destroy(){if(dead)return;active=false;reset();dead=true;clearInterval(timer);}
    render();
    return {enable(){if(!live())return;active=true;path=location.pathname;render();},disable(){active=false;reset();status.textContent='';},destroy};
  }
  globalThis.CVATGroupPanel=Object.freeze({create});
})();
