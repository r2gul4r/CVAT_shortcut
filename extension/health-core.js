/* Passive, bounded request statistics. No URLs, payloads or credentials retained. */
(() => {
  'use strict';
  const WINDOW = 300000, STALE = 60000, LIMIT = 300;
  const LABELS = {api:'일반 API', image:'이미지', save:'저장', ai:'AI'};
  const SLOW = {api:2000, image:5000, save:3000, ai:30000};
  function classify(url, method = 'GET') {
    let path; try { path = new URL(url).pathname; } catch { return null; }
    if (!path.startsWith('/api/')) return null;
    if (/\/(lambda|functions|models)(\/|$)/.test(path)) return 'ai';
    if (/\/annotations\/?$/.test(path) && /^(POST|PUT|PATCH)$/.test(method)) return 'save';
    if (/\/data\/?$/.test(path)) return 'image';
    return 'api';
  }
  function create() { return {pending:{}, samples:[]}; }
  function prune(state, now) {
    state.samples = state.samples.filter(s => now - s.at <= WINDOW).slice(-LIMIT);
    for (const [id, item] of Object.entries(state.pending)) if (now - item.at > WINDOW) delete state.pending[id];
  }
  function begin(state, id, kind, at) {
    prune(state, at);
    if (kind && Object.keys(state.pending).length < LIMIT) state.pending[id] = {kind, at};
  }
  function finish(state, id, at, code, error, cached) {
    const item = state.pending[id]; delete state.pending[id];
    if (!item || cached || error === 'net::ERR_ABORTED') return;
    const outcome = error ? 'network' : code === 401 || code === 403 ? 'auth' : code === 429 ? 'limited' :
      code >= 500 ? 'server' : code >= 400 ? 'request' : code >= 200 && code < 400 ? 'ok' : 'network';
    const sample = {kind:item.kind, at, ms:Math.max(0, at-item.at), outcome};
    state.samples.push(sample);
    prune(state, at);
    return sample;
  }
  function summary(state, now) {
    prune(state, now);
    const recent = state.samples.filter(s => now - s.at <= STALE);
    const waiting = Object.values(state.pending).filter(s => now-s.at > Math.max(10000, SLOW[s.kind]*2));
    const failures = recent.filter(s => ['network','server','limited'].includes(s.outcome));
    const slow = recent.filter(s => s.outcome === 'ok' && s.ms > SLOW[s.kind]);
    const status = failures.length ? 'error' : recent.some(s => s.outcome==='auth') ? 'auth' :
      recent.some(s => s.outcome==='request') ? 'request' : waiting.length || slow.length >= 2 ? 'slow' : recent.length ? 'ok' : 'idle';
    const groups = Object.entries(LABELS).map(([kind,label]) => {
      const samples = state.samples.filter(s=>s.kind===kind);
      const times = samples.filter(s=>s.outcome==='ok').map(s=>s.ms).sort((a,b)=>a-b);
      const mid = Math.floor(times.length/2);
      const median = !times.length ? null : times.length%2 ? times[mid] : (times[mid-1]+times[mid])/2;
      return {kind,label,count:samples.length,median,failures:samples.filter(s=>['network','server','limited'].includes(s.outcome)).length};
    });
    return {status,groups,waiting:waiting.length, count:state.samples.length,
      lastAt:state.samples.length ? state.samples[state.samples.length-1].at : null,
      server:recent.filter(s=>s.outcome==='server').length, network:recent.filter(s=>s.outcome==='network').length,
      limited:recent.filter(s=>s.outcome==='limited').length};
  }
  globalThis.CVATHealth = {create,begin,finish,summary,classify};
})();
