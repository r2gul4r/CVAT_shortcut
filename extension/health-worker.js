/* Observes existing requests only, after an explicit optional host grant. */
importScripts('health-core.js');
const health = globalThis.CVATHealth;
const sessions = new Map();
const starts = new Map();
const KEY = 'cvatHealthSessions';
const AUTO_KEY='cvatHealthAutoOrigins', PAUSE_KEY='cvatHealthPausedTabs';
const autoOrigins=new Set(), paused=new Map(), autoPending=new Set();
let writeQueue = Promise.resolve();
const ready = Promise.all([chrome.storage.session.get([KEY,PAUSE_KEY]),chrome.storage.local.get(AUTO_KEY)]).then(([data,local]) => {
  for (const [id, value] of Object.entries(data[KEY] || {})) sessions.set(Number(id), value);
  for(const [id,value] of Object.entries(data[PAUSE_KEY]||{}))paused.set(Number(id),value);
  for(const origin of local[AUTO_KEY]||[]){try{const u=new URL(origin);if(/^https?:$/.test(u.protocol)&&u.origin===origin)autoOrigins.add(origin);}catch{}}
});
function persist() {
  // Serialize writes so disabling cannot be undone by an older write completing late.
  writeQueue = writeQueue.catch(()=>{}).then(()=>chrome.storage.session.set({[KEY]:Object.fromEntries(sessions),[PAUSE_KEY]:Object.fromEntries(paused)}));
  return writeQueue;
}
function supported(url) { try { const u=new URL(url); return /^https?:$/.test(u.protocol) && /^\/tasks\/\d+\/jobs\/\d+\/?$/.test(u.pathname); } catch { return false; } }
async function stop(id) { starts.delete(id); sessions.delete(id); await persist(); }
function begin(details) {
  void ready.then(()=>{
    const session=sessions.get(details.tabId);
    if (!session || details.frameId!==0) return;
    const url=new URL(details.url);
    if (url.origin!==session.origin) return;
    health.begin(session.data, details.requestId, health.classify(details.url, details.method), details.timeStamp);
    void persist();
  });
}
function complete(details) {
  void ready.then(()=>{
    const session=sessions.get(details.tabId);
    if (!session || !session.data.pending[details.requestId]) return;
    health.finish(session.data, details.requestId, details.timeStamp, details.statusCode, details.error, details.fromCache);
    void persist();
  });
}
let listeningAPI=null, permissionQueue=Promise.resolve();
const hostPattern=url=>{const u=new URL(url);return `${u.protocol}//${u.hostname}/*`;};
function registerListeners(){
  if(listeningAPI||!chrome.webRequest)return;
  listeningAPI=chrome.webRequest;
  const filter={urls:['http://*/*','https://*/*']};
  listeningAPI.onBeforeRequest.addListener(begin,filter);
  listeningAPI.onCompleted.addListener(complete,filter);
  listeningAPI.onErrorOccurred.addListener(complete,filter);
}
function removeListeners(){
  if(!listeningAPI)return;
  listeningAPI.onBeforeRequest.removeListener(begin);
  listeningAPI.onCompleted.removeListener(complete);
  listeningAPI.onErrorOccurred.removeListener(complete);
  listeningAPI=null;
}
// Optional API is absent before the combined API+host grant. Once granted,
// register synchronously so Chrome delivers the event that wakes this worker.
registerListeners();
function refreshPermissions(){
  permissionQueue=permissionQueue.catch(()=>{}).then(async()=>{
    await ready;
    const {origins=[],permissions=[]}=await chrome.permissions.getAll();
    const urls=origins.filter(value=>/^https?:\/\//.test(value)||value==='*://*/*'||value==='<all_urls>').sort();
    if(urls.length&&permissions.includes('webRequest'))registerListeners();
    else{
      removeListeners();
      if(!urls.length&&permissions.includes('webRequest'))await chrome.permissions.remove({permissions:['webRequest']});
    }
    for(const [id,value] of [...sessions,...starts]){
      if(!await chrome.permissions.contains({permissions:['webRequest'],origins:[hostPattern(value.origin)]})) await stop(id);
    }
  });
  return permissionQueue;
}
chrome.permissions.onAdded.addListener(()=>{void refreshPermissions().catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{void refreshPermissions().catch(()=>{});});
void refreshPermissions().catch(()=>{});
chrome.tabs.onRemoved.addListener(id=>{void ready.then(()=>{paused.delete(id);return stop(id);});});
chrome.tabs.onUpdated.addListener((id,change)=>{
  if (change.status==='loading') { starts.delete(id); void ready.then(()=>{paused.delete(id);return stop(id);}); }
  else if (change.url) void ready.then(()=>{
    const session=sessions.get(id), starting=starts.get(id), expected=session||starting||paused.get(id);
    if (!expected) return;
    const url=new URL(change.url);
    // CVAT can update ?frame= without leaving the current Job.
    if (url.origin!==expected.origin || url.pathname!==expected.jobPath) {paused.delete(id);return stop(id);}
  });
  if(change.status==='complete'||change.url)void ready.then(()=>autoStart(id)).catch(()=>{});
});
async function startTab(id,automatic=false){
  const tab=await chrome.tabs.get(id);
  if(!supported(tab.url))throw new Error('CVAT Job 탭에서 사용하세요.');
  const url=new URL(tab.url),origin=url.origin,jobPath=url.pathname;
  const token={origin,jobPath};starts.set(id,token);
  try{
    await refreshPermissions();
    if(!listeningAPI||!await chrome.permissions.contains({permissions:['webRequest'],origins:[hostPattern(origin)]}))throw new Error('이 CVAT 사이트의 접근 권한이 필요합니다. 팝업에서 이 탭 상태 보기를 눌러 허용하세요.');
    if(starts.get(id)!==token||(automatic&&(!autoOrigins.has(origin)||paused.has(id))))throw new Error('자동 측정이 취소됐습니다.');
    const current=await chrome.tabs.get(id),currentURL=new URL(current.url);
    if(!await chrome.permissions.contains({permissions:['webRequest'],origins:[hostPattern(origin)]}))throw new Error('사이트 권한이 해제됐습니다. 다시 켜주세요.');
    if(starts.get(id)!==token||currentURL.origin!==origin||currentURL.pathname!==jobPath)throw new Error('탭이 이동했습니다. 다시 켜주세요.');
    if(automatic&&(!autoOrigins.has(origin)||paused.has(id)))throw new Error('자동 측정이 취소됐습니다.');
    const previous=sessions.get(id);
    paused.delete(id);
    sessions.set(id,{origin,jobPath,data:previous?.origin===origin&&previous?.jobPath===jobPath?previous.data:health.create()});await persist();
  }catch(error){if(starts.get(id)===token)await stop(id);throw error;}
  finally{if(starts.get(id)===token)starts.delete(id);}
}
async function autoStart(id){
  await ready;
  if(sessions.has(id)||starts.has(id)||paused.has(id)||autoPending.has(id))return;
  autoPending.add(id);
  try{
    const tab=await chrome.tabs.get(id);
    if(tab.status==='loading'||tab.discarded||!supported(tab.url)||!autoOrigins.has(new URL(tab.url).origin))return;
    await startTab(id,true);
  }catch{/* A closed/restricted tab must not enable capture or trigger permission prompts. */}
  finally{autoPending.delete(id);}
}
async function restoreAutomatic(){
  await ready;
  if(!autoOrigins.size)return;
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.map(tab=>autoStart(tab.id)));
}
chrome.runtime.onStartup.addListener(()=>{void restoreAutomatic().catch(()=>{});});
void restoreAutomatic().catch(()=>{});
let autoWrite=Promise.resolve();
function saveAutomatic(){autoWrite=autoWrite.catch(()=>{}).then(()=>chrome.storage.local.set({[AUTO_KEY]:[...autoOrigins]}));return autoWrite;}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (!message?.type?.startsWith('CVAT_HEALTH_') || sender.id!==chrome.runtime.id) return;
  void ready.then(async()=>{
    const fromPopup = !sender.tab && sender.url===chrome.runtime.getURL('popup.html');
    const id = sender.tab?.id ?? (fromPopup ? message.tabId : undefined);
    if (!Number.isInteger(id)) throw new Error('Invalid tab');
    if (message.type==='CVAT_HEALTH_START') {
      if (!fromPopup) throw new Error('Popup required');
      await startTab(id);
    } else if(message.type==='CVAT_HEALTH_AUTO'){
      if(!fromPopup)throw new Error('Popup required');
      const tab=await chrome.tabs.get(id);
      if(!supported(tab.url))throw new Error('CVAT Job 탭에서 사용하세요.');
      const origin=new URL(tab.url).origin;
      if(message.enabled===true){await startTab(id);autoOrigins.add(origin);await saveAutomatic();void restoreAutomatic().catch(()=>{});}
      else{
        autoOrigins.delete(origin);await saveAutomatic();
        for(const [tabId,value] of [...sessions,...starts])if(value.origin===origin)await stop(tabId);
      }
    } else if (message.type==='CVAT_HEALTH_STOP') {
      const value=sessions.get(id)||starts.get(id);if(value)paused.set(id,{origin:value.origin,jobPath:value.jobPath});await stop(id);
    }
    else if (message.type!=='CVAT_HEALTH_STATUS') throw new Error('Unknown message');
    const session=sessions.get(id);
    let auto=false;try{auto=autoOrigins.has(new URL((await chrome.tabs.get(id)).url).origin);}catch{}
    return session ? {enabled:true,auto,...health.summary(session.data,Date.now())} : {enabled:false,auto};
  }).then(respond,error=>respond({enabled:false,error:error.message || '상태 확인 실패'}));
  return true;
});
