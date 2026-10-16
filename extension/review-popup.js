(() => {
  'use strict';
  function create(root=document,transport=null){
  const $=id=>root.querySelector('#'+id),core=globalThis.CVATReviewCore;
  let tab,context,key,prefsKey,catalog=[],selected=[],report=null,busy=false,initializing=false,initialized=false,closed=false,pageIndex=0,currentFrame=-1;
  let saveQueue=Promise.resolve();
  const supported=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)&&/^\/tasks\/\d+\/jobs\/\d+\/?$/.test(u.pathname);}catch{return false;}};
  const message=(text,error=false)=>{if(closed)return;$('review-status').textContent=text;$('review-status').classList.toggle('review-error',error);};
  function controls(){
    $('review-load').disabled=busy||initializing;
    $('review-run').disabled=busy||initializing||!initialized||!selected.length||!$('review-saved').checked;
    $('review-saved').disabled=busy||initializing;
    $('review-all').disabled=busy||initializing||!catalog.length;
    $('review-none').disabled=busy||initializing||!selected.length;
    for(const input of $('review-labels').querySelectorAll('input'))input.disabled=busy||initializing;
    for(const id of ['review-copy','review-csv'])$(id).disabled=busy||!report;
    for(const button of $('review-results').querySelectorAll('button[data-frame]'))button.disabled=busy;
    $('review-previous').disabled=busy||!report?.missingCount;
    $('review-next').disabled=busy||!report?.missingCount;
  }
  async function verify(){
    if(closed)throw Error('검수 화면이 닫혔습니다.');
    if(transport)return transport.verify(context);
    const [active]=await chrome.tabs.query({active:true,currentWindow:true});
    if(active?.id!==tab?.id || !supported(active.url)){throw Error('CVAT 탭이 바뀌었습니다. 팝업을 다시 열어주세요.');}
    const u=new URL(active.url);
    if(u.origin!==context.origin||u.pathname!==context.path)throw Error('Job이 바뀌었습니다. 팝업을 다시 열어주세요.');
  }
  async function call(action,extra={}) {
    await verify();
    if(transport){const value=await transport.call({...context,action,...extra});if(!value||value.error)throw Error(value?.error||'검수 응답을 받지 못했습니다.');return value;}
    const values=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:CVATReviewRequest,args:[{...context,action,...extra}]});
    const value=values?.find(item=>item.frameId===0)?.result;
    if(!value || value.error)throw Error(value?.error||'검수 응답을 받지 못했습니다.');
    return value;
  }
  async function native(action,extra={}) {
    await verify();
    if(transport){const value=await transport.native({...context,action,...extra});if(!value||value.error)throw Error(value?.error||'CVAT 화면 상태를 확인하지 못했습니다.');return value;}
    const values=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:CVATReviewNative,args:[{...context,action,...extra}]});
    const value=values?.find(item=>item.frameId===0)?.result;
    if(!value || value.error)throw Error(value?.error||'CVAT 화면 상태를 확인하지 못했습니다.');
    return value;
  }
  async function bulkRequest(action,extra={}) {
    if(!context){
      if(transport)tab=await transport.tab();else [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!supported(tab?.url))throw Error('CVAT Job 탭에서 열어주세요.');
      const url=new URL(tab.url);context={origin:url.origin,path:url.pathname};
    }
    await verify();let value;
    // Retire the saved report before starting a write: the action popup may close
    // while MAIN continues, so its eventual result callback is not guaranteed.
    if(action==='apply')await chrome.storage.local.set({[key||`cvatReviewReportV1:${context.origin}${context.path.replace(/\/$/,'')}`]:{state:'idle'}});
    if(transport)value=await transport.bulk({action,...extra});
    else{const values=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:CVATBulkEditNative,args:[{...context,action,...extra}]});value=values?.find(item=>item.frameId===0)?.result;}
    if(!value||value.error){const error=Error(value?.error||'일괄 편집 응답을 받지 못했습니다. CVAT 화면을 확인하세요.');error.partial=value?.partial;throw error;}
    return value;
  }
  const bulkPanel=globalThis.CVATBulkEditPanel?.create(root,bulkRequest,()=>{
    report=null;drawReport();$('review-saved').checked=false;
    message('일괄 편집 후에는 CVAT에서 저장하고 다시 검사하세요.');
    if(key)void Promise.resolve().then(()=>chrome.storage.local.set({[key]:{state:'idle'}})).catch(()=>{});
  });
  function mode(name){
    if(busy||initializing||bulkPanel?.isBusy())return;
    $('review-inspection').hidden=name!=='inspect';$('bulk-editor').hidden=name!=='bulk';
    for(const value of ['inspect','bulk']){const button=$('review-mode-'+value);button.setAttribute('aria-pressed',String(value===name));button.classList.toggle('secondary',value!==name);}
    if(name==='bulk')bulkPanel?.activate();
  }
  $('review-mode-inspect').addEventListener('click',()=>mode('inspect'));
  $('review-mode-bulk').addEventListener('click',()=>mode('bulk'));
  function drawLabels(){
    const list=$('review-labels');list.replaceChildren();
    for(const item of catalog){
      const label=document.createElement('label');label.className='review-label';
      const input=document.createElement('input');input.type='checkbox';input.checked=selected.includes(item.id);input.dataset.labelId=String(item.id);
      const swatch=document.createElement('span');swatch.className='label-swatch';swatch.style.backgroundColor=item.color;swatch.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=item.name;
      label.append(input,swatch,text);list.append(label);
      input.addEventListener('change',()=>{
        selected=input.checked?[...selected,item.id]:selected.filter(id=>id!==item.id);selectionChanged();
      });
    }
    $('review-selection-count').textContent=`${selected.length}개 선택 / ${catalog.length}개 라벨`;
  }
  function selectionChanged(){
    report=null;drawReport();drawLabels();controls();
    const selection=[...selected],target=prefsKey,targetReport=key;
    // Serialize writes so rapid checking/unchecking cannot restore older choices.
    saveQueue=saveQueue.then(()=>chrome.storage.local.set({[target]:selection,[targetReport]:{state:'idle'}})).catch(()=>message('필수 라벨 선택을 저장하지 못했습니다.',true));
    message('필수 라벨을 선택했어요. CVAT에서 저장한 뒤 검사하세요.');
  }
  function intervals(){const id=Number($('review-filter').value);return id?report?.rows.find(row=>row.id===id)?.missing||[]:report?.missing||[];}
  function frameButton(frame,label=String(frame)){
    const button=document.createElement('button');button.type='button';button.className='secondary review-frame';button.dataset.frame=String(frame);button.textContent=label;button.title=`${frame}번 프레임으로 이동`;
    button.addEventListener('click',()=>void navigate(frame));return button;
  }
  function drawFrames(){
    const list=$('review-frames');list.replaceChildren();
    if(!report)return;
    const values=intervals(),total=values.reduce((sum,[a,b])=>sum+b-a+1,0),lastPage=Math.max(0,Math.ceil(total/30)-1);
    pageIndex=Math.min(pageIndex,lastPage);
    for(const frame of core.page(values,pageIndex*30,30)){
      const line=document.createElement('div');line.className='review-frame-row';
      const text=document.createElement('span');text.textContent=report.rows.filter(row=>core.contains(row.missing,frame)).map(row=>row.name).join(', ');
      line.append(frameButton(frame),text);list.append(line);
    }
    $('review-page').textContent=total?`${pageIndex+1} / ${lastPage+1}쪽 · ${total}프레임`:'누락 없음';
    $('review-page-previous').disabled=busy||pageIndex===0;$('review-page-next').disabled=busy||pageIndex===lastPage;
    controls();
  }
  function drawReport(){
    $('review-results').hidden=!report;
    if(!report){controls();return;}
    $('review-summary').textContent=`${report.total}프레임 검사 · 누락 있는 프레임 ${report.missingCount}개`;
    $('review-time').textContent=`Job ${report.jobId} · ${new Date(report.checkedAt).toLocaleString('ko-KR')} · 저장된 작업 기준 · 삭제 프레임 ${report.excluded}개 제외`;
    const body=$('review-rows');body.replaceChildren();
    for(const row of report.rows){
      const tr=document.createElement('tr'),label=document.createElement('th'),count=document.createElement('td'),missing=document.createElement('td');label.scope='row';
      label.textContent=row.name;count.textContent=String(row.count);
      if(!row.count)missing.textContent='없음';
      else {for(const range of row.missing.slice(0,8))missing.append(frameButton(range[0],range[0]===range[1]?String(range[0]):`${range[0]}~${range[1]}`));if(row.missing.length>8){const more=document.createElement('span');more.textContent='… 아래 목록에서 전체 확인';missing.append(more);}}
      tr.append(label,count,missing);body.append(tr);
    }
    const filter=$('review-filter'),old=filter.value;filter.replaceChildren();
    const all=document.createElement('option');all.value='0';all.textContent='모든 누락 프레임';filter.append(all);
    for(const row of report.rows){const option=document.createElement('option');option.value=String(row.id);option.textContent=`${row.name} (${row.count})`;filter.append(option);}
    filter.value=[...filter.options].some(option=>option.value===old)?old:'0';drawFrames();
  }
  async function applyStored(value){
    if(value?.state==='running'){
      const status=await call('status');
      if(status.running){busy=true;message('저장된 라벨링을 읽고 검사 중… 팝업을 닫아도 결과를 저장합니다.');}
      else{busy=false;message('이전 검사가 완료되지 않았습니다. 다시 검사하세요.',true);}
      report=null;
    }else if(value?.state==='done' && value.report?.schema===1){
      busy=false;
      if(JSON.stringify([...selected].sort((a,b)=>a-b))===JSON.stringify(value.report.rows.map(row=>row.id).sort((a,b)=>a-b))){report=value.report;message('검사 결과를 불러왔어요. 수정·저장 후에는 다시 검사하세요.');}
      else{report=null;message('필수 라벨이 달라졌습니다. 다시 검사하세요.');}
    }else{report=null;busy=false;if(value?.state==='error')message(value.error,true);}
    drawReport();controls();
  }
  async function initialize(force=false){
    if(closed||initializing||busy||initialized&&!force)return;
    initializing=true;controls();message('현재 Job의 라벨 목록을 읽는 중…');
    try{
      if(transport)tab=await transport.tab();else [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!supported(tab?.url))throw Error('CVAT Job 탭에서 검수를 열어주세요.');
      const url=new URL(tab.url);context={origin:url.origin,path:url.pathname};
      key=`cvatReviewReportV1:${url.origin}${url.pathname.replace(/\/$/,'')}`;prefsKey=key.replace('Report','Labels');
      const savedPrefs=(await chrome.storage.local.get(prefsKey))[prefsKey];selected=Array.isArray(savedPrefs)?savedPrefs:[];
      if(!transport)await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',files:['review-core.js']});
      const running=await call('status');
      if(running.running){
        const stored=(await chrome.storage.local.get(key))[key];busy=true;initialized=true;await applyStored(stored);return;
      }
      const value=await call('catalog');catalog=value.catalog;
      if(closed)return;
      selected=selected.filter(id=>catalog.some(label=>label.id===id));
      initialized=true;drawLabels();message(catalog.length?'필수 라벨을 선택하고 CVAT에서 저장한 뒤 검사하세요.':'이 Job에 등록된 라벨이 없습니다.');
      await applyStored((await chrome.storage.local.get(key))[key]);
    }catch(error){initialized=false;message(error.message,true);}
    finally{initializing=false;controls();if(!closed&&initialized&&!busy&&!catalog.length&&report)setTimeout(()=>void initialize(true),100);}
  }
  async function scan(){
    if(busy||!selected.length||!$('review-saved').checked)return;
    const required=[...selected];
    busy=true;report=null;drawReport();controls();message('저장 상태 확인 중…');
    try{
      await saveQueue;
      let status;try{status=await native('status');}catch{/* An explicit saved confirmation still permits a server snapshot. */}
      if(status?.dirty===true){$('review-saved').checked=false;throw Error('미저장 변경 사항이 있습니다. CVAT에서 저장한 뒤 다시 검사하세요.');}
      message('저장된 라벨링을 읽고 전체 프레임 검사 중…');
      const result=await call('scan',{required});
      if(closed)return;
      pageIndex=0;$('review-saved').checked=false;
      await applyStored({state:'done',report:result.report});
    }catch(error){message(error.message,true);try{await chrome.storage.local.set({[key]:{state:'error',error:error.message}});}catch{}}
    finally{busy=false;controls();}
  }
  async function navigate(frame){
    if(busy)return;busy=true;controls();message(`${frame}번 프레임으로 이동 중…`);
    try{const result=await native('navigate',{frame});currentFrame=result.frame;message(`${currentFrame}번 프레임으로 이동했어요. 수정 후 저장하고 다시 검사하세요.`);}
    catch(error){message(error.message,true);}
    finally{busy=false;controls();}
  }
  async function move(direction){
    if(busy||!report)return;
    try{const value=await native('status');currentFrame=Number.isSafeInteger(value.frame)?value.frame:currentFrame;}
    catch(error){message(error.message,true);return;}
    const next=core.adjacent(intervals(),currentFrame,direction);
    if(next===null){message(direction>0?'이후 누락 프레임이 없습니다.':'이전 누락 프레임이 없습니다.');return;}
    await navigate(next);
  }
  const activate=()=>void initialize();
  const screenChanged=event=>{if(event.detail==='review')activate();};
  if(!transport){$('screen-review').addEventListener('click',activate);document.addEventListener('cvat-popup-screen',screenChanged);}
  $('review-load').addEventListener('click',()=>void initialize(true));
  $('review-saved').addEventListener('change',controls);
  $('review-run').addEventListener('click',()=>void scan());
  $('review-all').addEventListener('click',()=>{selected=catalog.map(label=>label.id);selectionChanged();});
  $('review-none').addEventListener('click',()=>{selected=[];selectionChanged();});
  $('review-filter').addEventListener('change',()=>{pageIndex=0;drawFrames();});
  $('review-page-previous').addEventListener('click',()=>{pageIndex--;drawFrames();});
  $('review-page-next').addEventListener('click',()=>{pageIndex++;drawFrames();});
  $('review-previous').addEventListener('click',()=>void move(-1));$('review-next').addEventListener('click',()=>void move(1));
  $('review-copy').addEventListener('click',()=>{if(report)void Promise.resolve().then(()=>transport?.copy?transport.copy(core.text(report)):navigator.clipboard.writeText(core.text(report))).then(()=>message('검사 결과를 복사했어요.'),()=>message('복사하지 못했습니다. CSV 저장을 사용하세요.',true));});
  $('review-csv').addEventListener('click',()=>{
    if(!report)return;
    try{const url=URL.createObjectURL(new Blob([core.csv(report)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`cvat-job-${report.jobId}-missing-labels.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);message('CSV 다운로드를 시작했어요.');}
    catch(error){message(error.message,true);}
  });
  const storageChanged=(changes,area)=>{
    if(area!=='local'||!key||!initialized||closed)return;
    if(changes[prefsKey]){
      const next=changes[prefsKey].newValue;
      const valid=(Array.isArray(next)?next:[]).filter(id=>catalog.some(label=>label.id===id));
      if(JSON.stringify([...valid].sort((a,b)=>a-b))!==JSON.stringify([...selected].sort((a,b)=>a-b))){selected=valid;$('review-saved').checked=false;report=null;drawLabels();drawReport();controls();}
    }
    if(!changes[key])return;
    // Result writes from the injected scan survive closing/reopening the popup.
    const value=changes[key].newValue;
    if(value?.state==='done' || value?.state==='error' || value?.state==='idle' || value?.state==='running'){
      $('review-saved').checked=false;
      void applyStored(value).then(()=>{if(!catalog.length)setTimeout(()=>void initialize(true),100);}).catch(error=>message(error.message,true));
    }
  };
  chrome.storage.onChanged.addListener(storageChanged);
  const destroy=()=>{closed=true;bulkPanel?.destroy();try{chrome.storage.onChanged.removeListener?.(storageChanged);}catch{/* Extension reload can invalidate cleanup APIs. */}document.removeEventListener('cvat-popup-screen',screenChanged);window.removeEventListener('pagehide',destroy);};
  window.addEventListener('pagehide',destroy,{once:true});controls();
  return {activate,destroy};
  }
  globalThis.CVATReviewPanel=Object.freeze({create});
  if(chrome.tabs?.query && document.getElementById('screen-review'))create();
})();
