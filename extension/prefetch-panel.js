/* ISOLATED: background chunk-cache controls; no image bytes cross the DOM bridge. */
(() => {
  'use strict';
  function create(parent){
    const section=document.createElement('section');section.className='tool';section.dataset.prefetchPanel='';
    const add=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;section.append(n);return n;};
    add('h3','이미지 미리 받기');
    add('p','현재 Job의 이미지를 백그라운드에서 받아둡니다. 다른 오버레이 탭에서 작업해도 계속됩니다.').className='view-help';
    const label=add('label','캐시 한도 '),limit=document.createElement('select');limit.dataset.prefetch='limit';limit.setAttribute('aria-label','이미지 캐시 한도');
    for(const mb of [256,512,1024]){const option=document.createElement('option');option.value=String(mb);option.textContent=mb===1024?'1 GB':`${mb} MB`;limit.append(option);}limit.value='512';label.append(limit);
    const start=add('button','이 Job 이미지 미리 받기'),stop=add('button','중지'),clear=add('button','캐시 비우기');
    for(const [name,b]of [['start',start],['stop',stop],['clear',clear]]){b.type='button';b.dataset.prefetch=name;}
    const progress=add('progress','');progress.max=1;progress.value=0;progress.style.width='100%';progress.setAttribute('aria-label','이미지 미리 받기 진행률');
    const status=add('p','');status.dataset.prefetch='status';status.setAttribute('role','status');status.style.whiteSpace='pre-line';
    add('p','압축 이미지 캐시 한도이며 CVAT의 화면 표시 메모리는 별도입니다. 한도에 도달하면 미리 받기가 멈춥니다. 중지해도 캐시는 유지하며, Job 변경·새로고침·확장 끄기 시 비웁니다. 이미지는 외부로 전송하지 않습니다.').className='view-help';
    parent.prepend(section);let active=false,dead=false,busy=false,polling=false,epoch=0,value={},path='',lastError='';const pending=new Set();
    function live(){try{return !dead&&!!chrome.runtime?.id;}catch{return false;}}
    function render(){start.disabled=!active||busy||!!value.running;limit.disabled=start.disabled;stop.disabled=!active||busy||!value.running;clear.disabled=!active||busy;progress.max=value.total||1;progress.value=value.cached||0;}
    function request(action){return new Promise((resolve,reject)=>{
      const node=document.createElement('span');node.hidden=true;node.setAttribute('data-request',JSON.stringify({version:1,origin:location.origin,path:location.pathname,action,limit:Number(limit.value)}));
      let timer,done=false;const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);observer.disconnect();pending.delete(cancel);node.remove();error?reject(Error(error)):resolve(data);},cancel=()=>finish('이미지 미리 받기 창이 종료됐습니다.');
      const observer=new MutationObserver(()=>{const raw=node.getAttribute('data-response');if(raw){try{const data=JSON.parse(raw);finish(data.error,data);}catch{finish('응답을 읽지 못했습니다.');}}});observer.observe(node,{attributes:true,attributeFilter:['data-response']});pending.add(cancel);
      timer=setTimeout(()=>finish('CVAT 이미지 연결 응답이 없습니다. 페이지를 새로고침하고 다시 시도하세요.'),15000);document.body.append(node);node.dispatchEvent(new Event('cvat-shortcuts-prefetch-v1',{bubbles:true}));
    });}
    async function execute(action){
      if(!active||!live()||(action==='status'?polling||busy:busy))return;
      const revision=epoch;if(action==='status')polling=true;else{busy=true;lastError='';}render();
      try{const result=await request(action);if(revision!==epoch||!active||(action==='status'&&(busy||lastError)))return;value=result;status.textContent=(result.total?`Job ${result.jobId} · 준비 ${result.cached} / ${result.total}프레임\n캐시 ${(result.bytes/1048576).toFixed(1)} MB · 재사용 ${result.hits}회\n`:'')+result.message;}
      catch(error){if(revision===epoch){lastError=error.message;status.textContent=error.message;}}
      finally{if(revision===epoch){if(action==='status')polling=false;else busy=false;render();}}
    }
    start.onclick=()=>void execute('start');stop.onclick=()=>void execute('stop');clear.onclick=()=>void execute('clear');
    function reset(){epoch++;for(const cancel of [...pending])cancel();busy=false;polling=false;value={};lastError='';render();}
    function release(){void request('release').catch(()=>{});}
    const timer=setInterval(()=>{if(!live()){destroy();return;}if(active){if(path!==location.pathname){reset();path=location.pathname;}void execute('status');}},1000);
    function destroy(){if(dead)return;release();active=false;reset();dead=true;clearInterval(timer);}
    render();return {enable(){if(!live())return;active=true;path=location.pathname;render();void execute('status');},disable(){release();active=false;reset();status.textContent='';},destroy};
  }
  globalThis.CVATPrefetchPanel=Object.freeze({create});
})();
