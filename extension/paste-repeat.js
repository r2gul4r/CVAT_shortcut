/* Explicit per-tab Ctrl+V -> left click -> F loop. Never writes annotation data directly. */
(() => {
  'use strict';
  if (globalThis.CVATPasteRepeat) return;
  globalThis.CVATPasteRepeat = Object.freeze({create({available, notify, isMac}) {
    let run = null, sending = false, completed = 0, message = '복사한 뒤 처음 붙여넣을 프레임에서 시작하세요.';
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    function snapshot() {
      const node = document.createElement('span'); node.hidden = true;
      node.setAttribute('data-cvat-paste-path', location.pathname); document.body.append(node);
      try {
        node.dispatchEvent(new Event('cvat-shortcuts-paste-status-v1', {bubbles: true}));
        const result = JSON.parse(node.getAttribute('data-cvat-paste-status') || 'null');
        if (!result) throw Error('반복 기능을 연결하지 못했습니다. 확장을 다시 활성화하세요.');
        if (result.error) throw Error(result.error);
        return result;
      } finally { node.remove(); }
    }
    function key(code, keyValue, number, paste = false) {
      sending = true;
      try {
        // Mousetrap binds plain letters to keypress and Ctrl/Cmd chords to keydown.
        for (const type of ['keydown', ...(paste || code === 'Escape' ? [] : ['keypress']), 'keyup']) {
          document.body.dispatchEvent(new KeyboardEvent(type, {code, key: keyValue,
            keyCode: type === 'keypress' ? keyValue.charCodeAt(0) : number,
            which: type === 'keypress' ? keyValue.charCodeAt(0) : number,
            ctrlKey: paste && !isMac(), metaKey: paste && isMac(),
            bubbles: true, cancelable: true, composed: true}));
        }
      } finally { sending = false; }
    }
    function status() { return {running: Boolean(run), completed, message}; }
    function stop(reason = '중지했습니다.') {
      const previous = run; run = null;
      if (!previous) return status();
      // Cancel only this loop's still-open paste preview, never a new manual tool.
      try {
        const state = snapshot();
        if (previous.ownsPaste && location.pathname === previous.path && state.clipboard === previous.clipboard && state.preview) key('Escape', 'Escape', 27);
      } catch { /* Unknown page state must not receive a cancel key. */ }
      message = `${completed}개 붙여넣음 · ${reason}`; notify(message); return status();
    }
    function checked(token) {
      if (run !== token) throw Error('CANCELED');
      if (!available() || location.pathname !== token.path || document.hidden || !document.hasFocus()) throw Error('작업 화면을 벗어나 중지했습니다.');
      const state = snapshot();
      if (state.clipboard !== token.clipboard) throw Error('복사한 객체가 바뀌어 중지했습니다.');
      return state;
    }
    async function until(token, accept, failure) {
      const deadline = performance.now() + 15000;
      while (run === token) {
        const state = checked(token);
        if (accept(state)) return state;
        if (performance.now() >= deadline) throw Error(failure);
        await wait(50);
      }
      throw Error('CANCELED');
    }
    function click(state) {
      const selector = state.shape === 'mask' ? '.cvat_masks_canvas_wrapper canvas.upper-canvas' : '#cvat_canvas_content';
      const nodes = [...document.querySelectorAll(selector)].filter(node => {
        const r = node.getBoundingClientRect(); return node.isConnected && r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      });
      if (nodes.length !== 1) throw Error('붙여넣기 확정 화면을 찾지 못했습니다.');
      const target = nodes[0], r = target.getBoundingClientRect();
      const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
      const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) throw Error('작업 화면이 보이지 않습니다.');
      sending = true;
      try {
        // No mousemove: confirm CVAT's native paste position without relocating it.
        for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, {
          button: 0, buttons: type === 'mousedown' ? 1 : 0, clientX: x, clientY: y,
          bubbles: true, cancelable: true, composed: true, view: window}));
      } finally { sending = false; }
    }
    async function loop(token) {
      try {
        // A popup Start closes the popup before the first paste. A shortcut starts here directly.
        const focusDeadline = performance.now() + 5000;
        while (run === token && !document.hasFocus() && performance.now() < focusDeadline) await wait(50);
        await wait(250);
        while (run === token) {
          const before = checked(token);
          if (!before.ready || before.mode !== 'idle') throw Error('작업 화면이 준비되지 않아 중지했습니다.');
          const ids = new Set(before.objects.map(object => object.id));
          token.ownsPaste = true; key('KeyV', 'v', 86, true);
          const preview = await until(token, state => {
            if (state.frame !== before.frame) throw Error('붙여넣기 중 프레임이 바뀌었습니다.');
            return state.preview && state.previewReady;
          }, '붙여넣기 준비를 확인하지 못했습니다. Ctrl+V 동작을 확인하세요.');
          click(preview);
          await until(token, state => {
            if (state.frame !== before.frame) throw Error('확정 중 프레임이 바뀌었습니다.');
            const added = state.objects.filter(object => !ids.has(object.id));
            if (added.length > 1) throw Error('예상보다 많은 객체가 추가돼 중지했습니다.');
            return state.ready && state.mode === 'idle' && added.length === 1 && state.objects.length === ids.size + 1 &&
              added[0].frame === before.frame && added[0].shape === before.shape && added[0].label === before.label;
          }, '객체 추가를 확인하지 못했습니다. 현재 프레임을 확인하세요.');
          token.ownsPaste = false; completed += 1;
          message = `${completed}개 붙여넣음 · Esc로 중지`;
          const done = checked(token);
          if (done.frame !== before.frame) throw Error('확정 뒤 프레임이 바뀌어 중지했습니다.');
          if (done.frame >= done.end) { stop('마지막 프레임입니다.'); return; }
          key('KeyF', 'f', 70);
          await until(token, state => {
            if (state.frame < before.frame) throw Error('예상과 다른 프레임으로 이동했습니다.');
            return state.frame > before.frame && state.ready && state.mode === 'idle';
          }, '다음 프레임 이동을 확인하지 못했습니다. F 동작을 확인하세요.');
          await wait(500);
        }
      } catch (error) { if (run === token) stop(error.message); }
    }
    function start() {
      if (run) return stop();
      try {
        if (!available() || document.hidden) throw Error('이 CVAT 탭에서 확장을 켜고 입력칸·대화상자를 닫으세요.');
        const state = snapshot();
        if (!state.clipboard) throw Error('반복할 객체 하나를 먼저 Ctrl+C로 복사하세요.');
        if (!state.ready || state.mode !== 'idle') throw Error('현재 그리기를 마치고 프레임 로딩이 끝난 뒤 시작하세요.');
        run = {path: location.pathname, clipboard: state.clipboard, ownsPaste: false}; completed = 0;
        message = '붙여넣기 반복 시작 · Esc로 중지'; notify(message); void loop(run);
      } catch (error) { message = error.message; notify(message); }
      return status();
    }
    function interrupt(event) {
      if (!run || sending) return;
      if (event.type === 'keydown' && ['Control','Shift','Alt','Meta'].includes(event.key)) return;
      if (event.type === 'keydown' && event.repeat) return;
      if (event.type === 'keydown' || event.isTrusted) stop(event.code === 'Escape' ? 'Esc로 중지했습니다.' : '직접 조작하여 중지했습니다.');
    }
    for (const type of ['pointerdown','mousemove','wheel']) window.addEventListener(type, interrupt, {capture: true, passive: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop('다른 탭으로 이동했습니다.'); });
    window.addEventListener('blur', () => stop('작업 화면을 벗어났습니다.'));
    window.addEventListener('pagehide', () => stop('페이지를 이동했습니다.'));
    return {start, stop, status, interrupt, isSending: () => sending};
  }});
})();
