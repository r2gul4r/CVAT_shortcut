/* Shared review-panel bulk editor. Targets are always previewed before confirmation. */
(() => {
  'use strict';
  function create(root,request,onApplied){
    const $=id=>root.querySelector('#'+id);
    let catalog=[],selected=[],loaded=false,busy=false,closed=false,preview=null,scan=null,page=0,epoch=0;
    const message=(text,error=false)=>{if(closed)return;$('bulk-status').textContent=text;$('bulk-status').classList.toggle('review-error',error);};
    function controls(){
      for(const node of $('bulk-editor').querySelectorAll('input,select,button'))node.disabled=busy;
      $('bulk-target-row').hidden=$('bulk-operation').value!=='relabel';
      $('bulk-range-row').hidden=$('bulk-scope').value!=='range';
      $('bulk-scan').disabled=busy||!loaded||!selected.length;
      $('bulk-preview').disabled=busy||!scan?.count;
      $('bulk-page-previous').disabled=busy||page===0;
      $('bulk-page-next').disabled=busy||!scan||((page+1)*30>=scan.frames);
      $('bulk-apply').disabled=busy||!preview?.count||!$('bulk-confirm').checked;
      $('bulk-confirm').disabled=busy||!preview?.count;
    }
    function invalidate(){epoch++;preview=null;$('bulk-confirm').checked=false;$('bulk-confirmation').hidden=true;controls();}
    function clearScan(){scan=null;page=0;$('bulk-scan-results').hidden=true;$('bulk-edit-options').hidden=true;invalidate();}
    function drawFrames(){
      const box=$('bulk-found-frames');box.replaceChildren();
      for(const frame of globalThis.CVATReviewCore.page(scan.intervals,page*30,30)){const item=document.createElement('span');item.className='bulk-frame';item.textContent=String(frame);box.append(item);}
      $('bulk-page').textContent=scan.frames?`${page+1} / ${Math.ceil(scan.frames/30)} 페이지`:'발견된 프레임 없음';controls();
    }
    function drawScan(){
      $('bulk-scan-summary').textContent=`라벨이 있는 프레임 ${scan.frames}개 · 객체 ${scan.count}개`;
      const rows=$('bulk-found-labels');rows.replaceChildren();
      for(const row of scan.rows){const item=document.createElement('p');item.className='section-note';item.textContent=`${row.name}: ${row.frames}프레임 · Shape ${row.shapes} / Track ${row.tracks}`;rows.append(item);}
      $('bulk-scan-results').hidden=false;$('bulk-edit-options').hidden=!scan.count;drawFrames();
    }
    function drawLabels(){
      const box=$('bulk-labels');box.replaceChildren();
      for(const label of catalog){
        const item=document.createElement('label');item.className='review-label';const input=document.createElement('input');input.type='checkbox';input.checked=selected.includes(label.id);input.dataset.labelId=label.id;
        const swatch=document.createElement('span');swatch.className='label-swatch';swatch.style.backgroundColor=/^#[0-9a-f]{6}$/i.test(label.color||'')?label.color:'transparent';
        const text=document.createElement('span');text.textContent=label.name;item.append(input,swatch,text);box.append(item);
        input.addEventListener('change',()=>{selected=input.checked?[...selected,label.id]:selected.filter(id=>id!==label.id);clearScan();message('라벨 선택이 바뀌었습니다. 선택 라벨을 스캔하세요.');});
      }
      const target=$('bulk-target'),old=target.value;target.replaceChildren();
      const empty=document.createElement('option');empty.value='';empty.textContent='변경 후 라벨 선택';target.append(empty);
      for(const label of catalog){const option=document.createElement('option');option.value=String(label.id);option.textContent=label.name;target.append(option);}
      if([...target.options].some(o=>o.value===old))target.value=old;
    }
    async function activate(force=false){
      if(closed||busy||loaded&&!force)return;busy=true;clearScan();message('현재 Job의 편집 가능한 라벨을 확인하는 중…');
      try{const value=await request('catalog');if(closed)return;catalog=value.catalog;selected=selected.filter(id=>catalog.some(l=>l.id===id));loaded=true;drawLabels();$('bulk-bounds').textContent=`Job ${value.jobId} · 프레임 ${value.start}~${value.stop} · CVAT 화면 번호 기준`;
        message('편집할 라벨을 고르고 선택 라벨 스캔을 누르세요.');}
      catch(error){loaded=false;message(error.message,true);}finally{busy=false;if(!closed)controls();}
    }
    async function scanLabels(){
      if(busy||!loaded||!selected.length)return;clearScan();const revision=epoch;busy=true;controls();message('선택한 라벨이 있는 프레임을 스캔하는 중…');
      try{const result=await request('scan',{labels:[...selected]});if(closed||revision!==epoch)return;scan=result;page=0;$('bulk-frames').value='';$('bulk-scope').value='range';drawScan();message(result.count?'스캔 완료. 아래에서 번호·구간 또는 검색된 전체를 고르세요.':'선택한 라벨로 그린 객체가 없습니다.');}
      catch(error){message(error.message,true);}finally{busy=false;if(!closed)controls();}
    }
    async function inspect(){
      if(busy||!scan?.count)return;invalidate();const revision=epoch;busy=true;controls();message('대상 객체를 확인하는 중…');
      try{
        const result=await request('preview',{scanToken:scan.token,labels:[...selected],operation:$('bulk-operation').value,target:$('bulk-target').value?Number($('bulk-target').value):null,scope:$('bulk-scope').value,frames:$('bulk-frames').value});
        if(closed||revision!==epoch)return;preview=result;
        $('bulk-summary').textContent=`Job ${result.jobId} · ${result.range} 프레임\n${result.labels.map(l=>l.name).join(', ')}${result.target?' → '+result.target.name:' 삭제'}\n총 ${result.count}개 (Shape ${result.shapes} · Track ${result.tracks})`;
        $('bulk-confirmation').hidden=false;$('bulk-apply').textContent=result.operation==='delete'?'확인한 객체 삭제':'확인한 객체 라벨 변경';
        message(result.count?'대상이 맞는지 확인하고 적용하세요.':'조건에 맞는 그린 객체가 없습니다.');
      }catch(error){message(error.message,true);}finally{busy=false;if(!closed)controls();}
    }
    async function apply(){
      if(busy||!preview?.count||!$('bulk-confirm').checked)return;
      const token=preview.token;busy=true;clearScan();controls();message('CVAT 작업 화면에 적용 중…');
      try{const result=await request('apply',{token,confirm:true});onApplied();message(`${result.applied}개 ${result.operation==='delete'?'삭제':'라벨 변경'} 완료. CVAT 화면을 확인하고 저장하세요.`);}
      catch(error){if(error.partial)onApplied();message(error.message,true);}finally{busy=false;if(!closed)controls();}
    }
    for(const id of ['bulk-operation','bulk-target','bulk-scope','bulk-frames'])$(id).addEventListener(id==='bulk-frames'?'input':'change',invalidate);
    $('bulk-confirm').addEventListener('change',controls);
    $('bulk-load').addEventListener('click',()=>void activate(true));
    $('bulk-scan').addEventListener('click',()=>void scanLabels());
    $('bulk-page-previous').addEventListener('click',()=>{if(!busy&&scan&&page>0){page--;drawFrames();}});
    $('bulk-page-next').addEventListener('click',()=>{if(!busy&&scan&&(page+1)*30<scan.frames){page++;drawFrames();}});
    $('bulk-preview').addEventListener('click',()=>void inspect());$('bulk-apply').addEventListener('click',()=>void apply());
    controls();
    return {activate,isBusy:()=>busy,destroy(){closed=true;clearScan();}};
  }
  globalThis.CVATBulkEditPanel=Object.freeze({create});
})();
