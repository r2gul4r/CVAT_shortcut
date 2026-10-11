(async () => {
  const S = CVATShortcuts, results = [], $ = (q) => document.querySelector(q);
  const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const host = () => $("#cvat-shortcuts-label-overlay"), root = () => host().shadowRoot;
  const button = (action) => root().querySelector(`[data-action="${action}"]`);
  const choice = (name) => [...root().querySelectorAll('.choice')].find((node) => node.value === name);
  const current = () => fixtureAPI.read()[S.STORAGE_KEY];
  let nativeMouse = 0, nativeClick = 0, nativeWheel = 0, nativeKey = 0, escapes = 0;
  const catalog = document.createElement('div'); catalog.className = 'cvat-objects-sidebar-labels-list'; document.body.append(catalog);
  function labels(names = ['person','obstacle']) {
    catalog.replaceChildren(); const header = document.createElement('div'); header.className = 'cvat-objects-sidebar-labels-list-header'; header.textContent = `Items: ${names.length}`; catalog.append(header);
    for (const name of names) {
      const row = document.createElement('div'); row.className = 'cvat-objects-sidebar-label-item';
      const text = document.createElement('span'); text.className = 'cvat-text'; text.textContent = name;
      const color = document.createElement('span'); color.className = 'cvat-label-item-color'; color.style.backgroundColor = '#126abc'; row.append(color, text); catalog.append(row);
    }
  }
  for (const type of ['mousedown','mousemove','mouseup','pointerdown','pointermove','pointerup']) document.addEventListener(type, () => nativeMouse++, true);
  document.addEventListener('click', () => nativeClick++, true);
  document.addEventListener('wheel', () => nativeWheel++, true);
  document.addEventListener('keydown', (event) => {nativeKey++; if (event.code === 'Escape') escapes++;}, true);
  const fire = (target, type, options = {}) => {
    const Ctor = type.startsWith('pointer') ? PointerEvent : type === 'wheel' ? WheelEvent : MouseEvent;
    const event = new Ctor(type, {bubbles:true, composed:true, cancelable:true, pointerType:'mouse', pointerId:9,
      button:0, buttons: type.endsWith('up') || type === 'click' ? 0 : 1, clientX:40, clientY:510, ...options});
    target.dispatchEvent(event); return event;
  };
  function key(target, code, type = 'keydown') {
    const event = new KeyboardEvent(type, {code,key:code==='Digit2'?'2':code==='Space'?' ':code,bubbles:true,composed:true,cancelable:true}); target.dispatchEvent(event); return event;
  }
  function assert(value, detail = 'Overlay assertion failed') {if (!value) throw new Error(detail);}
  async function reset() {
    fixtureAPI.failWrite(false); window.dispatchEvent(new Event('blur')); labels();
    history.replaceState({}, '', '/tasks/1/jobs/9'); $('#dialog').hidden = true; document.body.focus();
    await chrome.storage.local.set({[S.STORAGE_KEY]: S.normalize({defaultLabelName:'person',labelShortcuts:[{name:'obstacle',shortcut:{code:'Digit2'}}]}),cvatLabelOverlayV1:{x:20,y:430,view:'panel'},cvatLabelOverlayEnabled:true});
    await window.__cvatSidebarShortcutsControllerV1.enable(); await wait();
    nativeMouse = nativeClick = nativeWheel = nativeKey = escapes = 0;
  }
  async function test(name, run) { try { await reset(); await run(); results.push({name,passed:true}); } catch(error) {results.push({name,passed:false,error:error.message});} }
  try {
    fixtureAPI.clear(); const script = document.createElement('script'); script.src='/extension/content.js';
    await new Promise((r,j)=>{script.onload=r;script.onerror=j;document.head.append(script);});
    await test('Activation displays one isolated palette with colors, hotkeys and selected label', () => {
      assert(document.querySelectorAll('#cvat-shortcuts-label-overlay').length===1 && host().style.display==='block');
      assert(root().querySelectorAll('.choice').length===2 && choice('person').getAttribute('aria-pressed')==='true');
      assert(choice('obstacle').querySelector('kbd').textContent==='2' && choice('person').querySelector('.swatch').style.background.includes('18'));
    });
    await test('Mouse selection saves the shared label, leaves brush and blocks native click', async () => {
      const toolbox=$('.cvat-brush-tools-toolbox'); toolbox.hidden=false; const before=toolbox.outerHTML;
      fire(choice('obstacle'),'pointerdown'); fire(choice('obstacle'),'pointerup'); fire(choice('obstacle'),'click'); await wait(5);
      assert(current().defaultLabelName==='obstacle' && choice('obstacle').getAttribute('aria-pressed')==='true');
      assert(toolbox.outerHTML===before && escapes===0 && nativeMouse===0 && nativeClick===0);
    });
    await test('Hotkey selection immediately updates palette', async () => {
      key(document.body,'Digit2'); key(document.body,'Digit2','keyup'); await wait(5);
      assert(root().querySelector('.selected strong').textContent==='obstacle' && choice('obstacle').getAttribute('aria-pressed')==='true');
    });
    await test('Popup-style storage selection updates palette', async () => {
      await chrome.storage.local.set({[S.STORAGE_KEY]: {...current(),defaultLabelName:'obstacle'}});
      assert(choice('obstacle').getAttribute('aria-pressed')==='true');
    });
    await test('Dragging outside palette moves, saves geometry and never reaches CVAT', async () => {
      const before=host().getBoundingClientRect(); fire(button('drag'),'pointerdown',{clientX:before.x+20,clientY:before.y+15});
      fire(document.body,'pointermove',{clientX:before.x+100,clientY:before.y+35}); fire(document.body,'pointerup'); await wait();
      assert(parseFloat(host().style.left)===before.x+80 && fixtureAPI.read().cvatLabelOverlayV1.x===before.x+80);
      assert(nativeMouse===0 && !fixtureAPI.read().cvatLabelOverlayV1.labels);
    });
    await test('Stored offscreen coordinates are clamped into viewport', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:99999,y:99999,view:'panel'}});
      const rect=host().getBoundingClientRect(); assert(rect.right<=innerWidth && rect.bottom<=innerHeight && rect.left>=0);
    });
    await test('Minimize shows only launcher; click restores choices and selected label', async () => {
      fire(button('fold'),'click'); await wait(); assert(root().querySelector('.panel').hidden && !button('show').hidden);
      fire(button('show'),'pointerdown'); fire(button('show'),'pointerup'); fire(button('show'),'click'); await wait();
      assert(!root().querySelector('.list').parentElement.hidden && root().querySelector('.selected strong').textContent==='person');
    });
    await test('Close disables entire overlay, retains shortcuts and stays off until popup toggle', async () => {
      fire(button('hide'),'click'); await wait(); assert(host().style.display==='none' && fixtureAPI.read().cvatLabelOverlayEnabled===false);
      key(document.body,'Digit2'); key(document.body,'Digit2','keyup'); await wait(); assert(current().defaultLabelName==='obstacle');
      await window.__cvatSidebarShortcutsControllerV1.enable(); assert(host().style.display==='none');
      await chrome.storage.local.set({cvatLabelOverlayEnabled:true}); assert(host().style.display==='block' && !root().querySelector('.panel').hidden);
    });
    await test('Popup show message restores launcher to full panel', async () => {
      fire(button('fold'),'click'); await wait(); await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW'});
      assert(!root().querySelector('.panel').hidden && !root().querySelector('.list').parentElement.hidden);
    });
    await test('Palette preferences survive disable and re-enable', async () => {
      fire(button('fold'),'click'); await wait(); await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'}); assert(!host());
      await window.__cvatSidebarShortcutsControllerV1.enable(); assert(root().querySelector('.list').parentElement.hidden);
    });
    await test('Minimized launcher drag saves position without expanding or leaking mouse input', async () => {
      fire(button('fold'),'click'); await wait();
      const before=host().getBoundingClientRect(), prefsBefore=fixtureAPI.read().cvatLabelOverlayV1;
      fire(button('show'),'pointerdown',{clientX:before.x+10,clientY:before.y+10});
      fire(document.body,'pointermove',{clientX:before.x+90,clientY:before.y+30});
      fire(button('show'),'pointerup'); fire(button('show'),'click'); await wait();
      assert(root().querySelector('.panel').hidden && nativeMouse===0 && nativeClick===0);
      assert(host().getBoundingClientRect().x===before.x+80 && fixtureAPI.read().cvatLabelOverlayV1.x===before.x+80);
      assert(fixtureAPI.read().cvatLabelOverlayV1.width===prefsBefore.width);
      fire(button('show'),'pointerdown'); fire(button('show'),'pointerup'); fire(button('show'),'click'); await wait();
      assert(!root().querySelector('.panel').hidden);
    });
    await test('Close write failure restores usable panel', async () => {
      fixtureAPI.failWrite(true); fire(button('hide'),'click'); await wait(); fixtureAPI.failWrite(false);
      assert(host().style.display==='block' && root().querySelector('footer').textContent.includes('닫기 설정을 저장하지 못'));
    });
    await test('Legacy collapsed state maps to draggable launcher and keyboard close consumes release', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:50,y:80,view:'collapsed'}});
      assert(root().querySelector('.panel').hidden && !button('show').hidden);
      key(button('show'),'ArrowRight'); key(button('show'),'ArrowRight','keyup'); await wait(); assert(host().getBoundingClientRect().x===60);
      key(button('show'),'Enter'); key(document.body,'Enter','keyup'); await wait(); assert(!root().querySelector('.panel').hidden);
      key(button('hide'),'Space'); assert(key(document.body,'Space','keyup').defaultPrevented); await wait(); assert(host().style.display==='none');
    });
    await test('Palette wheel never reaches native zoom handler', () => {fire(root().querySelector('.list'),'wheel',{deltaY:90}); assert(nativeWheel===0);});
    await test('Resize drag changes dimensions, persists and isolates native input', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:20,y:40,width:248,height:480}});
      const before=host().getBoundingClientRect();
      fire(button('resize'),'pointerdown',{clientX:before.right-5,clientY:before.bottom-5});
      fire(document.body,'pointermove',{clientX:before.right+275,clientY:before.bottom+35});
      fire(document.body,'pointerup'); await wait();
      const rect=host().getBoundingClientRect(), saved=fixtureAPI.read().cvatLabelOverlayV1;
      assert(rect.width===before.width+280 && rect.height===before.height+40);
      assert(saved.width===rect.width && saved.height===rect.height && nativeMouse===0);
      assert(current().defaultLabelName==='person');
    });
    await test('Width switches between one, two and three label columns', async () => {
      labels(['person','obstacle','door','car','bicycle','traffic_light']);
      for(const [width,columns] of [[248,1],[390,2],[570,3]]) {
        await chrome.storage.local.set({cvatLabelOverlayV1:{width,height:480}});
        const grid=getComputedStyle(root().querySelector('.list')).gridTemplateColumns.split(' ').length;
        assert(grid===columns,'Expected '+columns+' columns at '+width+', received '+grid);
      }
    });
    await test('Short window scrolls labels while footer stays visible; taller window reveals more rows', async () => {
      labels(Array.from({length:24},(_,i)=>'class_'+i));
      await chrome.storage.local.set({cvatLabelOverlayV1:{width:248,height:320}});
      const list=root().querySelector('.list'), shortHeight=list.clientHeight, panel=root().querySelector('.panel');
      assert(list.scrollHeight>shortHeight && panel.scrollHeight<=panel.clientHeight+1,JSON.stringify({listScroll:list.scrollHeight,shortHeight,panelScroll:panel.scrollHeight,panelHeight:panel.clientHeight}));
      list.scrollTop=100;
      const footer=root().querySelector('footer').getBoundingClientRect(), rect=panel.getBoundingClientRect();
      assert(footer.bottom<=rect.bottom && footer.top>=rect.top && list.scrollTop>0,JSON.stringify({footerBottom:footer.bottom,bottom:rect.bottom,footerTop:footer.top,top:rect.top,scrollTop:list.scrollTop}));
      await chrome.storage.local.set({cvatLabelOverlayV1:{width:248,height:600}});
      assert(list.clientHeight>shortHeight+200);
    });
    await test('Fold and disable retain expanded dimensions', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{width:470,height:530}});
      fire(button('fold'),'click'); await wait(); assert(button('resize').hidden && host().getBoundingClientRect().height<530);
      fire(button('show'),'click'); await wait();
      await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'}); await window.__cvatSidebarShortcutsControllerV1.enable();
      assert(host().getBoundingClientRect().width===470 && host().getBoundingClientRect().height===530);
    });
    await test('Stored invalid and oversized dimensions remain usable within viewport', async () => {
      for (const prefs of [{width:-1,height:2},{width:99999,height:99999},{width:'invalid',height:null}]) {
        await chrome.storage.local.set({cvatLabelOverlayV1:prefs});
        const rect=host().getBoundingClientRect();
        assert(rect.width>=220 && rect.height>=320 && rect.right<=innerWidth && rect.bottom<=innerHeight);
      }
    });
    await test('Keyboard resize consumes arrows and persists size', async () => {
      const before=host().getBoundingClientRect();
      key(button('resize'),'ArrowRight'); key(button('resize'),'ArrowRight','keyup'); await wait();
      assert(host().getBoundingClientRect().width===before.width+20 && nativeKey===0);
      assert(fixtureAPI.read().cvatLabelOverlayV1.width===before.width+20);
    });
    await test('All eight edges resize only their axes with the opposite edge anchored', async () => {
      for(const edge of ['n','s','e','w','ne','nw','se','sw']) {
        await chrome.storage.local.set({cvatLabelOverlayV1:{x:220,y:150,width:390,height:400}});
        const handle=root().querySelector('[data-edge="'+edge+'"]'), before=host().getBoundingClientRect();
        assert(handle && !handle.hidden);
        fire(handle,'pointerdown',{clientX:300,clientY:250});
        fire(document.body,'pointermove',{clientX:330,clientY:270}); fire(document.body,'pointerup'); await wait();
        const after=host().getBoundingClientRect();
        assert(after.width===before.width+(edge.includes('w')?-30:edge.includes('e')?30:0),edge+' width');
        assert(after.height===before.height+(edge.includes('n')?-20:edge.includes('s')?20:0),edge+' height');
        assert(after.x===before.x+(edge.includes('w')?30:0) && after.y===before.y+(edge.includes('n')?20:0),edge+' anchor');
      }
      assert(nativeMouse===0);
    });
    await test('Northwest limits preserve bottom and right anchors and fold hides all edges', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:100,y:100,width:390,height:400}});
      const before=host().getBoundingClientRect(), nw=root().querySelector('[data-edge=nw]');
      fire(nw,'pointerdown',{clientX:100,clientY:100});
      fire(document.body,'pointermove',{clientX:5000,clientY:5000}); fire(document.body,'pointerup'); await wait();
      const small=host().getBoundingClientRect();
      assert(small.width===220 && small.height===320 && small.right===before.right && small.bottom===before.bottom);
      fire(nw,'pointerdown',{clientX:small.x,clientY:small.y});
      fire(document.body,'pointermove',{clientX:-5000,clientY:-5000}); fire(document.body,'pointerup'); await wait();
      const large=host().getBoundingClientRect(); assert(large.x===8 && large.y===8 && large.right===before.right && large.bottom===before.bottom);
      fire(button('fold'),'pointerdown'); fire(button('fold'),'pointerup'); fire(button('fold'),'click'); await wait();
      assert([...root().querySelectorAll('[data-edge]')].every(el=>el.hidden));
    });
    await test('Disabling during resize releases pointer state and preserves size', async () => {
      fire(button('resize'),'pointerdown'); fire(document.body,'pointermove',{clientX:140,clientY:530});
      const width=host().getBoundingClientRect().width;
      await chrome.storage.local.set({cvatLabelOverlayEnabled:false});
      fire(document.body,'pointermove',{buttons:0}); assert(nativeMouse===1);
      await chrome.storage.local.set({cvatLabelOverlayEnabled:true}); await wait();
      assert(host().getBoundingClientRect().width===width);
    });
    await test('Overlay toggle hides panel and launcher while keeping label shortcuts active', async () => {
      fire(button('fold'),'click'); await wait();
      await chrome.storage.local.set({cvatLabelOverlayEnabled:false});
      assert(host().style.display==='none');
      key(document.body,'Digit2'); key(document.body,'Digit2','keyup'); await wait();
      assert(current().defaultLabelName==='obstacle' && host().style.display==='none');
      await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_OVERLAY_SHOW'});
      assert(host().style.display==='none');
      await chrome.storage.local.set({cvatLabelOverlayEnabled:true});
      assert(host().style.display==='block' && root().querySelector('.selected strong').textContent==='obstacle');
    });
    await test('Overlay toggle preserves geometry transparency and persists through reactivation', async () => {
      await chrome.storage.local.set({cvatLabelOverlayV1:{x:90,y:200,transparency:35,view:'panel'},cvatLabelOverlayEnabled:false});
      await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'});
      await window.__cvatSidebarShortcutsControllerV1.enable();
      assert(!host() || host().style.display==='none');
      await chrome.storage.local.set({cvatLabelOverlayEnabled:true});
      assert(host().style.left==='90px' && Number(host().style.opacity)===.65);
    });
    await test('Popup overlay toggle releases interrupted range interaction', async () => {
      fire(root().querySelector('input[type=range]'),'pointerdown');
      await chrome.storage.local.set({cvatLabelOverlayEnabled:false});
      fire(document.body,'pointermove',{buttons:0}); fire(document.body,'mousemove',{buttons:0});
      assert(nativeMouse===2 && host().style.display==='none');
    });
    await test('Range recovers from lost release when no button is held', () => {
      fire(root().querySelector('input[type=range]'),'pointerdown');
      fire(document.body,'pointermove',{buttons:0}); fire(document.body,'mousemove',{buttons:0});
      assert(nativeMouse===2);
    });
    await test('Transparency changes immediately, saves separately and restores on enable', async () => {
      const slider=root().querySelector('input[type=range]'); const before=JSON.stringify(current());
      slider.value='45'; slider.dispatchEvent(new Event('input',{bubbles:true}));
      assert(Number(host().style.opacity)===.55 && slider.getAttribute('aria-valuetext')==='45% 투명');
      slider.dispatchEvent(new Event('change',{bubbles:true})); await wait();
      assert(fixtureAPI.read().cvatLabelOverlayV1.transparency===45 && JSON.stringify(current())===before);
      await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'}); await window.__cvatSidebarShortcutsControllerV1.enable();
      assert(Number(host().style.opacity)===.55);
    });
    await test('Transparency range keeps native input while isolating canvas and hotkeys', () => {
      const slider=root().querySelector('input[type=range]');
      assert(!fire(slider,'pointerdown').defaultPrevented); fire(document.body,'pointermove'); fire(document.body,'pointerup');
      assert(!key(slider,'ArrowRight').defaultPrevented); key(slider,'ArrowRight','keyup');
      key(slider,'Digit2'); key(slider,'Digit2','keyup');
      assert(nativeMouse===0 && nativeKey===0 && current().defaultLabelName==='person');
    });
    await test('Transparency preferences clamp malformed and old stored values', async () => {
      for (const [value,expected] of [[999,.3],[-5,1],['50',1],[undefined,1]]) {
        await chrome.storage.local.set({cvatLabelOverlayV1:{transparency:value}});
        assert(Math.abs(Number(host().style.opacity)-expected)<.001);
      }
    });
    await test('Keyboard selection consumes activation and release after rerender', async () => {
      choice('obstacle').focus(); assert(key(choice('obstacle'),'Space').defaultPrevented);
      assert(key(document.body,'Space','keyup').defaultPrevented); await wait(); assert(current().defaultLabelName==='obstacle' && nativeKey===0);
    });
    await test('Keyboard arrows move header and persist position', async () => {
      const x=host().getBoundingClientRect().x; key(button('drag'),'ArrowRight'); key(button('drag'),'ArrowRight','keyup'); await wait();
      assert(host().getBoundingClientRect().x===x+10 && fixtureAPI.read().cvatLabelOverlayV1.x===x+10);
    });
    await test('Removed labels cannot be selected from stale UI', async () => {
      const stale=choice('obstacle'); labels(['person']); fire(stale,'click'); await wait(); assert(current().defaultLabelName==='person');
      await wait(520); assert(!choice('obstacle'));
    });
    await test('Duplicate class names are disabled', async () => {labels(['person','person']); await wait(520); assert(choice('person').disabled);});
    await test('Catalog unavailable shows recovery instructions', async () => {
      catalog.firstElementChild.textContent='Items: 99'; fire(button('refresh'),'click'); assert(root().querySelector('footer').textContent.includes('Overview'));
    });
    await test('Save failure restores selection and displays failure', async () => {
      fixtureAPI.failWrite(true); fire(choice('obstacle'),'click'); await wait(); fixtureAPI.failWrite(false);
      assert(current().defaultLabelName==='person' && choice('person').getAttribute('aria-pressed')==='true');
    });
    await test('Job navigation refreshes catalog and unrelated route hides palette', async () => {
      history.replaceState({},'', '/unrelated'); await wait(520); assert(host().style.display==='none');
      history.replaceState({},'', '/tasks/1/jobs/9'); labels(['new-class']); await wait(520); assert(choice('new-class') && !choice('person'));
    });
    await test('Window blur ends dragging and future native input is released', async () => {
      fire(button('drag'),'pointerdown'); window.dispatchEvent(new Event('blur')); fire(document.body,'pointermove'); assert(nativeMouse===1);
    });
    await test('CVAT stroke released over palette still reaches native mouseup', () => {
      fire($('#mask-surface'),'mousedown'); const before=nativeMouse; fire(choice('person'),'mouseup'); assert(nativeMouse===before+1);
    });
    await test('Dialog blocks label changes from palette', async () => {
      $('#dialog').hidden=false; fire(choice('obstacle'),'click'); await wait(); assert(current().defaultLabelName==='person');
    });
    await test('Reinjection leaves one palette and one storage listener set', async () => {
      const count=fixtureAPI.listeners.storage.length; await window.__cvatSidebarShortcutsControllerV1.enable();
      assert(fixtureAPI.listeners.storage.length===count && document.querySelectorAll('#cvat-shortcuts-label-overlay').length===1);
    });

    await test('REVIEW: label shortcut resumes after mouse opacity adjustment', async () => {
      const slider=root().querySelector('input[type=range]');
      fire(slider,'pointerdown'); slider.value='30'; slider.dispatchEvent(new Event('input',{bubbles:true}));
      fire(slider,'pointerup'); slider.dispatchEvent(new Event('change',{bubbles:true})); await wait();
      const focus=host().shadowRoot.activeElement || document.activeElement;
      key(focus,'Digit2'); key(focus,'Digit2','keyup'); await wait();
      assert(current().defaultLabelName==='obstacle','Pointer adjustment leaves slider focused; label Digit2 is swallowed');
    });
    await test('REVIEW: Space pan resumes after mouse opacity adjustment', async () => {
      const slider=root().querySelector('input[type=range]');
      fire(slider,'pointerdown'); fire(slider,'pointerup'); await wait();
      const focus=host().shadowRoot.activeElement || document.activeElement;
      const space=key(focus,'Space');
      const rect=$('#mask-surface').getBoundingClientRect(); const downs=[];
      const listener=e=>downs.push(e.button); document.addEventListener('mousedown',listener,true);
      fire($('#mask-surface'),'pointerdown',{clientX:rect.x+20,clientY:rect.y+20});
      fire($('#mask-surface'),'mousedown',{clientX:rect.x+20,clientY:rect.y+20});
      fire($('#mask-surface'),'pointerup'); fire($('#mask-surface'),'mouseup'); key(focus,'Space','keyup');
      document.removeEventListener('mousedown',listener,true);
      assert(space.defaultPrevented && downs.length===1 && downs[0]===1,'Expected native middle-button pan; received native mousedown buttons: '+JSON.stringify(downs));
    });
    await test('REVIEW: disabled overlay releases unfinished slider input', async () => {
      const slider=root().querySelector('input[type=range]'); fire(slider,'pointerdown');
      await chrome.tabs.sendMessage(7,{type:'CVAT_SHORTCUTS_DISABLE'});
      fire(document.body,'pointermove',{buttons:0}); fire(document.body,'mousemove',{buttons:0});
      assert(nativeMouse===2,'Disabled overlay still intercepts pointermove/mousemove after slider interruption: '+nativeMouse);
    });
    await test('REVIEW: keyup clears native modifier held before slider focus', () => {
      let ups=0; const listener=()=>ups++; document.addEventListener('keyup',listener,true);
      key(document.body,'ControlLeft');
      const slider=root().querySelector('input[type=range]'); fire(slider,'pointerdown');fire(slider,'pointerup');
      key(slider,'ControlLeft','keyup'); document.removeEventListener('keyup',listener,true);
      assert(ups===1,'Native Control keydown received, but keyup swallowed by slider');
    });
  } catch(error) {results.push({name:'Setup',passed:false,error:error.message});}
  const report={suite:'overlay',passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
  $('#test-results').textContent=JSON.stringify(report,null,2);
})();
