(async () => {
  const S = CVATShortcuts, results = [], $ = s => document.querySelector(s);
  const side = $('.cvat-canvas-controls-sidebar'), icon = $('.cvat-draw-polygon-control');
  const panel = $('#polygon-panel'), content = panel.firstElementChild, points = $('#polygon-points');
  const toggle = $('.cvat-draw-polygon-popover-simplify-switch'), shape = $('.cvat-draw-polygon-shape-button');
  const label = labelFixture.byID('polygon-label');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message = 'Assertion failed') => { if (!value) throw Error(message); };
  let starts, wrong, escapes, clicks, state, cfg;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function render() { points.value = state.points; toggle.disabled = state.points !== ''; toggle.setAttribute('aria-checked', String(state.simplify)); }
  points.addEventListener('input', () => {
    const value = points.value;
    if (cfg.rejectPoints) { render(); return; }
    const commit = () => { state.points = value; render(); };
    cfg.delay ? later(commit, cfg.delay) : commit();
  });
  toggle.onclick = () => {
    clicks++;
    if (!cfg.rejectSwitch) {
      const commit = () => { state.simplify = !state.simplify; render(); };
      cfg.delay ? later(commit, cfg.delay) : commit();
    }
  };
  icon.onclick = () => { panel.hidden = false; };
  shape.onclick = () => {
    starts.push({label: label.root.value, points: state.points, simplify: state.simplify});
    panel.hidden = true; icon.classList.add('cvat-active-canvas-control');
  };
  for (const button of [$('.cvat-draw-polygon-track-button'), $('#wrong-shape'), $('.cvat-draw-mask-shape-button')]) button.onclick = () => wrong++;
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    escapes++;
    const active = side.querySelector('.cvat-active-canvas-control:not(.cvat-cursor-control)');
    side.querySelectorAll('.cvat-active-canvas-control').forEach(n => n.classList.remove('cvat-active-canvas-control'));
    $('.cvat-brush-tools-toolbox').hidden = true; if (active) panel.hidden = true;
  });
  const press = (code = 'KeyP', options = {}, target = document.body) => {
    const event = new KeyboardEvent('keydown', {key: code.replace('Key',''), code, bubbles:true, cancelable:true, ...options});
    target.dispatchEvent(event); target.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true})); return event;
  };
  const setting = () => S.normalize({shortcuts:{ai:{code:'KeyV'},brush:{code:'KeyB'},polygon:{code:'KeyP'}},defaultLabelName:'person'});
  async function reset() {
    await chrome.tabs.sendMessage(7, {type:'CVAT_SHORTCUTS_DISABLE'});
    window.dispatchEvent(new Event('blur')); timers.splice(0).forEach(clearTimeout);
    document.querySelectorAll('.polygon-extra').forEach(n => n.remove());
    content.append(points.parentElement, toggle, shape); shape.disabled = false; points.readOnly = false;
    labelFixture.reset(); label.root.value = 'obstacle';
    $('.cvat-draw-mask-popover').hidden = true; $('.cvat-brush-tools-toolbox').hidden = true;
    $('#dialog').hidden = true; icon.classList.remove('cvat-active-canvas-control'); panel.hidden = true;
    cfg = {}; state = {points:'8',simplify:true}; starts = []; wrong = escapes = clicks = 0; render();
    await chrome.storage.local.set({[S.STORAGE_KEY]:setting(),cvatLabelOverlayEnabled:true});
    await window.__cvatSidebarShortcutsControllerV1.enable(); document.body.focus(); await delay(280);
  }
  async function test(name, fn) {
    try { await reset(); await fn(); assert(wrong === 0,'Clicked Track or unrelated Shape'); results.push({name,passed:true}); }
    catch (e) { results.push({name,passed:false,error:e.message}); }
  }
  try {
    fixtureAPI.clear();
    const script = document.createElement('script'); script.src = '/extension/content.js';
    await new Promise((resolve,reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
    await test('Old settings retain AI/brush keys; polygon starts unassigned', () => {
      const old = S.normalize({shortcuts:{ai:{code:'KeyV'},brush:{code:'KeyB'}},defaultLabelName:'person'});
      assert(old.shortcuts.polygon === null && old.shortcuts.ai.code === 'KeyV' && old.shortcuts.brush.code === 'KeyB' && old.defaultLabelName === 'person');
    });
    await test('Early 2.2.0 polyline key migrates to polygon without reviving an explicitly cleared key', () => {
      const prior = {shortcuts:{ai:{code:'KeyV'},brush:{code:'KeyB'},polyline:{code:'KeyM'}},defaultLabelName:'person'};
      const migrated = S.normalize(prior);
      assert(migrated.shortcuts.polygon.code === 'KeyM' && !('polyline' in migrated.shortcuts));
      assert(migrated.shortcuts.ai.code === 'KeyV' && migrated.defaultLabelName === 'person');
      const cleared = S.assign(prior,'polygon',null);
      assert(S.normalize(cleared).shortcuts.polygon === null);
      assert(S.normalize({...prior,shortcuts:{...prior.shortcuts,polygon:null}}).shortcuts.polygon === null);
      assert(S.normalize({...prior,shortcuts:{...prior.shortcuts,polygon:{code:'KeyP'}}}).shortcuts.polygon.code === 'KeyP');
    });
    await test('Every ordered pair of tool keys rejects duplicate assignment', () => {
      for (const a of S.ACTIONS) for (const b of S.ACTIONS) if (a !== b) {
        let rejected = false; try { S.assign(S.assign(null,a,{code:'KeyP'}),b,{code:'KeyP'}); } catch { rejected = true; }
        assert(rejected,`${a}/${b}`);
      }
    });
    await test('Corrupt two-way and three-way tool duplicates are all disabled', () => {
      for (const pair of [['ai','brush'],['ai','polygon'],['brush','polygon'],S.ACTIONS]) {
        const data = S.normalize({shortcuts:Object.fromEntries(pair.map(a => [a,{code:'KeyP'}]))});
        assert(pair.every(a => data.shortcuts[a] === null));
      }
    });
    await test('Label shortcuts cannot reuse polygon keys in either direction', () => {
      let blocked = 0;
      try { S.assignLabel(setting(),'person',{code:'KeyP'}); } catch { blocked++; }
      try { S.assign(S.assignLabel(null,'person',{code:'KeyP'}),'polygon',{code:'KeyP'}); } catch { blocked++; }
      assert(blocked === 2);
    });
    await test('Single press clears point count, disables Simplify and starts Shape with selected label', async () => {
      assert(press().defaultPrevented); await delay(220);
      assert(JSON.stringify(starts) === JSON.stringify([{label:'person',points:'',simplify:false}]),JSON.stringify(starts));
      assert(escapes === 1 && clicks === 1);
    });
    await test('Already blank / OFF settings start without toggling Simplify ON', async () => {
      state = {points:'',simplify:false}; render(); press(); await delay(150);
      assert(starts.length === 1 && clicks === 0 && starts[0].simplify === false);
    });
    await test('Existing point limit with Simplify OFF is still cleared', async () => {
      state.simplify = false; render(); press(); await delay(180); assert(starts.length === 1 && starts[0].points === '' && clicks === 0);
    });
    await test('Controlled settings and label render delays are awaited before Shape', async () => {
      cfg.delay = 120; label.config.selectionDelay = 100; press(); await delay(60); assert(starts.length === 0);
      await delay(480); assert(starts.length === 1 && starts[0].points === '' && !starts[0].simplify && starts[0].label === 'person' && clicks === 1);
    });
    await test('Overlay-selected label is used by polygon immediately', async () => {
      const catalog = document.createElement('div'); catalog.className = 'cvat-objects-sidebar-labels-list polygon-extra';
      catalog.innerHTML = '<div class="cvat-objects-sidebar-labels-list-header">Items: 2</div><div class="cvat-objects-sidebar-label-item"><span class="cvat-text">person</span></div><div class="cvat-objects-sidebar-label-item"><span class="cvat-text">obstacle</span></div>';
      document.body.append(catalog); await delay(550);
      const root = document.querySelector('#cvat-label-overlay')?.shadowRoot || [...document.querySelectorAll('*')].map(n => n.shadowRoot).find(r => r?.querySelector('.choice'));
      const choice = [...root.querySelectorAll('.choice')].find(n => n.textContent.includes('obstacle'));
      choice.click(); document.body.focus(); press(); await delay(240);
      assert(starts.length === 1 && starts[0].label === 'obstacle');
    });
    await test('Switching from active brush sends Escape then completes polygon setup', async () => {
      $('.cvat-draw-mask-control').classList.add('cvat-active-canvas-control'); $('.cvat-brush-tools-toolbox').hidden = false;
      press(); await delay(220); assert(escapes === 1 && starts.length === 1);
    });
    await test('Unrelated visible shape popover is not used as the polygon menu', async () => {
      $('.cvat-draw-mask-popover').hidden = false; press(); await delay(220); assert(starts.length === 1);
    });
    await test('Polyline icon and popover cannot be mistaken for polygon', async () => {
      const lineIcon = document.createElement('span'); lineIcon.className = 'cvat-draw-polyline-control polygon-extra'; lineIcon.textContent = 'Polyline'; lineIcon.onclick = () => wrong++; side.append(lineIcon);
      const linePanel = document.createElement('div'); linePanel.className = 'ant-popover cvat-draw-shape-popover polygon-extra';
      linePanel.innerHTML = '<div class="cvat-draw-shape-popover-content"><button class="cvat-draw-polyline-shape-button">Shape</button></div>';
      linePanel.querySelector('button').onclick = () => wrong++; document.body.append(linePanel);
      press(); await delay(220); assert(starts.length === 1 && wrong === 0);
    });
    await test('Missing label stops before changing options or starting', async () => {
      label.options(['obstacle']); press(); await delay(180); assert(starts.length === 0 && points.value === '8' && clicks === 0);
    });
    await test('Missing Simplify control stops instead of guessing its state', async () => {
      toggle.remove(); press(); await delay(180); assert(starts.length === 0 && $('#cvat-sidebar-shortcuts-feedback').textContent.includes('Simplify'));
    });
    await test('Rejected point change times out without starting', async () => {
      cfg.rejectPoints = true; press(); await delay(1350); assert(starts.length === 0 && points.value === '8');
    });
    await test('Rejected Simplify toggle never retries ON/OFF or starts', async () => {
      cfg.rejectSwitch = true; press(); await delay(1350); assert(starts.length === 0 && clicks === 1);
    });
    await test('Disabled points input stops without starting', async () => {
      points.readOnly = true; press(); await delay(180); assert(starts.length === 0);
    });
    await test('Disabled Shape button stops without changing options', async () => {
      shape.disabled = true; press(); await delay(180); assert(starts.length === 0 && points.value === '8');
    });
    await test('Duplicate own popovers are rejected', async () => {
      const other = panel.cloneNode(true); other.classList.add('polygon-extra'); other.hidden = false; panel.hidden = false; document.body.append(other);
      press(); await delay(180); assert(starts.length === 0);
    });
    await test('Typing and dialog keep the key native', async () => {
      $('#input').focus(); assert(!press('KeyP',{},$('#input')).defaultPrevented);
      document.body.focus(); $('#dialog').hidden = false; assert(!press().defaultPrevented); assert(starts.length === 0 && escapes === 0);
    });
    await test('Explicit Escape during delayed setup prevents later Shape', async () => {
      cfg.delay = 150; press(); await delay(30); press('Escape',{key:'Escape'}); await delay(350); assert(starts.length === 0);
    });
  } catch (e) { results.push({name:'Setup',passed:false,error:e.message}); }
  const summary = {suite:'polygon',passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};
  $('#test-results').textContent = JSON.stringify(summary); window.fixtureResults = summary;
})();
