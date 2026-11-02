(async()=>{
  const S=CVATShortcuts,$=s=>document.querySelector(s),side=$('.cvat-canvas-controls-sidebar'),results=[];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
  const labels={rectangle:labelFixture.byID('rectangle-label'),skeleton:labelFixture.byID('skeleton-label')};
  const group=$('.cvat-draw-shape-popover-drawing-method-selector');
  const rotated=group.querySelector('input[value="Rotated points"]');
  let cfg={},method,starts,wrong,escapes,radioClicks,iconClicks,labelTouches,timers=[];
  for(const label of Object.values(labels))for(const event of ['mousedown','click'])label.root.addEventListener(event,()=>labelTouches++);
  const later=(f,ms)=>timers.push(setTimeout(f,ms));
  function render(){for(const radio of group.querySelectorAll('input[type=radio]')){radio.checked=radio.value===method;radio.closest('label').classList.toggle('ant-radio-button-wrapper-checked',radio.checked);}}
  group.addEventListener('change',e=>{
    radioClicks++;
    if(cfg.reject){render();return;}
    const selected=e.target.value,commit=()=>{method=selected;render();};
    if(cfg.delay)later(commit,cfg.delay);else commit();
  });
  for(const type of ['rectangle','skeleton']){
    const icon=$('.cvat-draw-'+type+'-control'),panel=$('#'+type+'-panel');
    icon.onclick=()=>{iconClicks++;panel.hidden=false;};
    $('.cvat-draw-'+type+'-shape-button').onclick=()=>{starts.push({type,label:labels[type].root.value,method:type==='rectangle'?method:null});panel.hidden=true;icon.classList.add('cvat-active-canvas-control');};
    $('.cvat-draw-'+type+'-track-button').onclick=()=>wrong++;
  }
  for(const button of [$('#wrong-shape'),$('.cvat-draw-mask-shape-button')])button.onclick=()=>wrong++;
  document.addEventListener('keydown',e=>{
    if(e.code!=='Escape')return;escapes++;
    const active=side.querySelector('.cvat-active-canvas-control:not(.cvat-cursor-control)');
    side.querySelectorAll('.cvat-active-canvas-control').forEach(n=>n.classList.remove('cvat-active-canvas-control'));
    $('.cvat-brush-tools-toolbox').hidden=true;
    if(active)for(const type of ['rectangle','skeleton'])$('#'+type+'-panel').hidden=true;
  });
  function press(code='KeyR',options={},target=document.body){const event=new KeyboardEvent('keydown',{key:code.replace('Key',''),code,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);target.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));return event;}
  async function choose(name){await chrome.storage.local.set({[S.STORAGE_KEY]:{...S.normalize(fixtureAPI.read()[S.STORAGE_KEY]),defaultLabelName:name}});document.body.focus();await delay(20);}
  async function reset(){
    await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'});window.dispatchEvent(new Event('blur'));timers.splice(0).forEach(clearTimeout);
    document.querySelectorAll('.shape-extra').forEach(n=>n.remove());labelFixture.reset();
    labels.rectangle.options(['polybag','parcel']);labels.rectangle.root.value='parcel';labels.skeleton.options(['barcode_6pt','barcode_4pt']);labels.skeleton.root.value='barcode_4pt';
    for(const type of ['rectangle','skeleton']){
      const panel=$('#'+type+'-panel'),icon=$('.cvat-draw-'+type+'-control');panel.hidden=true;icon.hidden=false;icon.classList.remove('cvat-disabled-canvas-control','cvat-active-canvas-control');
      $('.cvat-draw-'+type+'-shape-button').disabled=false;
    }
    $('#rectangle-panel .cvat-draw-shape-popover-content').insertBefore(group,$('.cvat-draw-rectangle-shape-button'));
    for(const input of group.querySelectorAll('input')){input.disabled=false;input.closest('label').hidden=false;input.closest('label').classList.remove('ant-radio-button-wrapper-disabled');}
    rotated.value='Rotated points';group.hidden=false;group.removeAttribute('aria-disabled');
    $('.cvat-draw-mask-popover').hidden=true;$('.cvat-brush-tools-toolbox').hidden=true;$('#dialog').hidden=true;
    cfg={};method='By 2 points';starts=[];wrong=escapes=radioClicks=iconClicks=labelTouches=0;render();
    await chrome.storage.local.set({[S.STORAGE_KEY]:S.normalize({shortcuts:{ai:{code:'KeyV'},brush:{code:'KeyB'},polygon:{code:'KeyP'},rectangle:{code:'KeyR'},skeleton:{code:'KeyK'}},defaultLabelName:'polybag'}),cvatLabelOverlayEnabled:true});
    await window.__cvatSidebarShortcutsControllerV1.enable();document.body.focus();await delay(280);
  }
  async function test(name,fn){try{await reset();await fn();assert(wrong===0,'Clicked Track or unrelated Shape');assert(labelTouches===0&&Object.values(labels).every(label=>label.config.clicks===0),'Fixed-label selector was touched');results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
  try{
    fixtureAPI.clear();const script=document.createElement('script');script.src='/extension/content.js';await new Promise((r,j)=>{script.onload=r;script.onerror=j;document.head.append(script);});
    await test('Old settings retain existing shortcuts and leave both new tools unassigned',()=>{const old=S.normalize({shortcuts:{ai:{code:'KeyV'},polygon:{code:'KeyP'}},defaultLabelName:'polybag'});assert(old.shortcuts.rectangle===null&&old.shortcuts.skeleton===null&&old.shortcuts.ai.code==='KeyV'&&old.shortcuts.polygon.code==='KeyP');});
    await test('Both new shortcuts reject collisions with every existing tool and label binding',()=>{
      for(const action of ['rectangle','skeleton']){
        for(const other of S.ACTIONS.filter(x=>x!==action)){let rejected=false;try{S.assign(S.assign(null,other,{code:'KeyR'}),action,{code:'KeyR'});}catch{rejected=true;}assert(rejected,other);}
        let rejected=0;try{S.assignLabel(S.assign(null,action,{code:'KeyR'}),'polybag',{code:'KeyR'});}catch{rejected++;}try{S.assign(S.assignLabel(null,'polybag',{code:'KeyR'}),action,{code:'KeyR'});}catch{rejected++;}assert(rejected===2);
      }
    });
    await test('Rectangle preserves its CVAT label then commits Rotated and starts only Shape once',async()=>{assert(press().defaultPrevented);await delay(230);assert(JSON.stringify(starts)===JSON.stringify([{type:'rectangle',label:'parcel',method:'Rotated points'}]),JSON.stringify(starts));assert(escapes===1&&radioClicks===1);});
    await test('An existing 4 Points setting is replaced with Rotated',async()=>{method='By 4 points';render();press();await delay(230);assert(starts.length===1&&starts[0].method==='Rotated points');});
    await test('Already Rotated starts without toggling or touching other methods',async()=>{method='Rotated points';render();press();await delay(180);assert(starts.length===1&&radioClicks===0);});
    await test('Rotated waits for controlled wrapper state, not transient native checked',async()=>{cfg.delay=180;press();await delay(70);assert(rotated.checked&&starts.length===0);await delay(250);assert(starts.length===1&&starts[0].method==='Rotated points'&&radioClicks===1);});
    await test('Rejected Rotated selection times out without fallback or repeated clicks',async()=>{cfg.reject=true;press();await delay(1350);assert(starts.length===0&&radioClicks===1&&method==='By 2 points');});
    await test('Missing Rotated value stops instead of guessing by display text',async()=>{rotated.value='unsupported';press();await delay(180);assert(starts.length===0&&radioClicks===0);});
    await test('Disabled Rotated control never starts another drawing method',async()=>{rotated.disabled=true;press();await delay(180);assert(starts.length===0&&radioClicks===0);});
    await test('Hidden Rotated wrapper is not actionable',async()=>{rotated.closest('label').hidden=true;press();await delay(180);assert(starts.length===0);});
    await test('Duplicate method groups are rejected',async()=>{const copy=group.cloneNode(true);copy.classList.add('shape-extra');group.after(copy);press();await delay(180);assert(starts.length===0);});
    await test('Duplicate Rotated options are rejected',async()=>{const copy=rotated.closest('label').cloneNode(true);copy.classList.add('shape-extra');group.append(copy);press();await delay(180);assert(starts.length===0);});
    await test('Skeleton preserves its existing CVAT label and starts Shape',async()=>{await choose('barcode_6pt');press('KeyK');await delay(220);assert(JSON.stringify(starts)===JSON.stringify([{type:'skeleton',label:'barcode_4pt',method:null}]));assert(escapes===1&&radioClicks===0);});
    await test('Skeleton does not wait for or change the overlay label',async()=>{await choose('barcode_6pt');labels.skeleton.config.ignoreSelection=true;press('KeyK');await delay(180);assert(starts.length===1&&starts[0].label==='barcode_4pt');});
    await test('An unrelated rectangle overlay label does not block skeleton',async()=>{press('KeyK');await delay(200);assert(starts.length===1&&starts[0].label==='barcode_4pt');});
    await test('An unrelated skeleton overlay label does not block rectangle',async()=>{await choose('barcode_6pt');press();await delay(200);assert(starts.length===1&&starts[0].label==='parcel'&&radioClicks===1);});
    for(const type of ['rectangle','skeleton']){
      await test(`${type} ignores overlay label changes without changing the saved overlay choice`,async()=>{
        const catalog=document.createElement('div');catalog.className='cvat-objects-sidebar-labels-list shape-extra';
        catalog.innerHTML='<div class="cvat-objects-sidebar-labels-list-header">Items: 4</div>'+['polybag','parcel','barcode_6pt','barcode_4pt'].map(n=>`<div class="cvat-objects-sidebar-label-item"><span class="cvat-text">${n}</span></div>`).join('');document.body.append(catalog);await delay(550);
        const desired=type==='rectangle'?'barcode_6pt':'polybag',shadow=document.getElementById('cvat-shortcuts-label-overlay').shadowRoot;
        [...shadow.querySelectorAll('.choice')].find(n=>n.textContent.includes(desired)).click();document.body.focus();press(type==='rectangle'?'KeyR':'KeyK');await delay(250);assert(starts.length===1&&starts[0].label===(type==='rectangle'?'parcel':'barcode_4pt'));assert(fixtureAPI.read()[S.STORAGE_KEY].defaultLabelName===desired);
      });
      await test(`${type} starts with an empty overlay label`,async()=>{await choose('');press(type==='rectangle'?'KeyR':'KeyK');await delay(230);assert(starts.length===1);});
      await test(`${type} starts with a single disabled fixed-label selector`,async()=>{const label=labels[type];label.options([label.root.value]);label.combo.disabled=true;label.root.classList.add('ant-select-disabled');press(type==='rectangle'?'KeyR':'KeyK');await delay(230);assert(starts.length===1&&starts[0].label===label.root.value);});
      await test(`${type} starts even without a label selector in the menu`,async()=>{const label=labels[type],parent=label.root.parentElement,next=label.root.nextSibling;label.root.remove();try{press(type==='rectangle'?'KeyR':'KeyK');await delay(230);assert(starts.length===1&&starts[0].label===label.root.value);}finally{parent.insertBefore(label.root,next);}});
      await test(`${type} cancels an active brush before selecting its own Shape`,async()=>{if(type==='skeleton')await choose('barcode_6pt');$('.cvat-draw-mask-control').classList.add('cvat-active-canvas-control');$('.cvat-brush-tools-toolbox').hidden=false;press(type==='rectangle'?'KeyR':'KeyK');await delay(230);assert(starts.length===1&&escapes===1);});
      await test(`${type} ignores another tool's visible Shape popover`,async()=>{if(type==='skeleton')await choose('barcode_6pt');$('.cvat-draw-mask-popover').hidden=false;press(type==='rectangle'?'KeyR':'KeyK');await delay(230);assert(starts.length===1);});
      await test(`${type} refuses disabled Shape`,async()=>{if(type==='skeleton')await choose('barcode_6pt');$('.cvat-draw-'+type+'-shape-button').disabled=true;press(type==='rectangle'?'KeyR':'KeyK');await delay(200);assert(starts.length===0&&radioClicks===0);});
      await test(`${type} refuses multiple matching popovers`,async()=>{if(type==='skeleton')await choose('barcode_6pt');const panel=$('#'+type+'-panel'),copy=panel.cloneNode(true);copy.classList.add('shape-extra');copy.hidden=false;panel.hidden=false;document.body.append(copy);press(type==='rectangle'?'KeyR':'KeyK');await delay(200);assert(starts.length===0);});
    }
    await test('Unknown skeleton toolbar support leaves existing work untouched',async()=>{$('.cvat-draw-skeleton-control').hidden=true;press('KeyK');await delay(120);assert(starts.length===0&&escapes===0&&iconClicks===0);});
    await test('Typing and modal dialogs preserve native keys for both tools',()=>{$('#input').focus();assert(!press('KeyR',{},$('#input')).defaultPrevented);assert(!press('KeyK',{},$('#input')).defaultPrevented);document.body.focus();$('#dialog').hidden=false;assert(!press().defaultPrevented&&!press('KeyK').defaultPrevented&&escapes===0);});
    await test('Escape cancels a pending rotated setup before it starts',async()=>{cfg.delay=250;press();await delay(60);press('Escape',{key:'Escape'});await delay(400);assert(starts.length===0);});
    await test('Job navigation cancels pending rotation without starting in the next Job',async()=>{cfg.delay=250;const url=location.href;press();await delay(60);history.pushState({},'', '/tasks/1/jobs/99');await delay(400);assert(starts.length===0);history.replaceState({},'',url);});
  }catch(e){results.push({name:'Setup',passed:false,error:e.message});}
  const summary={suite:'rotated rectangle and skeleton',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};$('#test-results').textContent=JSON.stringify(summary);window.fixtureResults=summary;
})();
