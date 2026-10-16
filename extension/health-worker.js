/* Observes existing requests only, after an explicit optional host grant. */
importScripts('health-core.js','review-native.js','bulk-native.js');
const health = globalThis.CVATHealth;
const sessions = new Map();
const starts = new Map();
const KEY = 'cvatHealthSessions';
const AUTO_KEY='cvatHealthAutoOrigins', PAUSE_KEY='cvatHealthPausedTabs';
const ALERT_KEY='cvatHealthAlertsEnabled';
let alertsEnabled=true, alertsWrite=Promise.resolve();
const autoOrigins=new Set(), paused=new Map(), autoPending=new Set();
let writeQueue = Promise.resolve();
const ready = Promise.all([chrome.storage.session.get([KEY,PAUSE_KEY]),chrome.storage.local.get(AUTO_KEY),chrome.storage.local.get(ALERT_KEY)]).then(([data,local,alerts]) => {
  for (const [id, value] of Object.entries(data[KEY] || {})) sessions.set(Number(id), value);
  for(const [id,value] of Object.entries(data[PAUSE_KEY]||{}))paused.set(Number(id),value);
  for(const origin of local[AUTO_KEY]||[]){try{const u=new URL(origin);if(/^https?:$/.test(u.protocol)&&u.origin===origin)autoOrigins.add(origin);}catch{}}
  alertsEnabled=alerts[ALERT_KEY]!==false;
});
function persist() {
  // Serialize writes so disabling cannot be undone by an older write completing late.
  writeQueue = writeQueue.catch(()=>{}).then(()=>chrome.storage.session.set({[KEY]:Object.fromEntries(sessions),[PAUSE_KEY]:Object.fromEntries(paused)}));
  return writeQueue;
}
function supported(url) { try { const u=new URL(url); return /^https?:$/.test(u.protocol) && /^\/tasks\/\d+\/jobs\/\d+\/?$/.test(u.pathname); } catch { return false; } }
async function verifyOverlay(sender,context){
  if(sender.id!==chrome.runtime.id || sender.frameId!==0 || !Number.isInteger(sender.tab?.id) || sender.documentLifecycle&&sender.documentLifecycle!=='active')throw Error('CVAT 작업 오버레이에서 사용하세요.');
  const source=new URL(sender.url),tab=await chrome.tabs.get(sender.tab.id),current=new URL(tab.url);
  // A content-script context can retain its original sender.url after pushState.
  // Bind to the live top document instead of treating that old pathname as the Job.
  if(!context || !/^https?:$/.test(source.protocol) || !supported(tab.url) || source.origin!==current.origin || current.origin!==context.origin || current.pathname!==context.path)throw Error('Job이 바뀌었습니다. 현재 Job에서 다시 시도하세요.');
  const values=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'ISOLATED',func:()=>({origin:location.origin,path:location.pathname})});
  const top=values.find(value=>value.frameId===0),live=top?.result;
  if(!live || live.origin!==context.origin || live.path!==context.path || sender.documentId&&sender.documentId!==top.documentId)throw Error('페이지 연결이 바뀌었습니다. 현재 Job에서 다시 시도하세요.');
  return sender.tab.id;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='CVAT_WORKSPACE_BULK' && sender.id===chrome.runtime.id){
    void(async()=>{
      const tabId=await verifyOverlay(sender,message.context),value=message.request;
      if(!value||!['catalog','scan','preview','apply'].includes(value.action))throw Error('잘못된 일괄 편집 요청입니다.');
      const request={...message.context,action:value.action,operation:value.operation,labels:value.labels,target:value.target,scope:value.scope,frames:value.frames,scanToken:value.scanToken,token:value.token,confirm:value.confirm};
      const values=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func:CVATBulkEditNative,args:[request]});
      return values?.find(item=>item.frameId===0)?.result||{error:'일괄 편집 결과를 확인하지 못했습니다.'};
    })().then(respond,error=>respond({error:error.message||'일괄 편집 실패'}));return true;
  }
  if(message?.type!=='CVAT_WORKSPACE_NATIVE' || sender.id!==chrome.runtime.id)return;
  void(async()=>{
    const tabId=await verifyOverlay(sender,message.context);
    if(!['status','navigate'].includes(message.action) || message.action==='navigate'&&!Number.isSafeInteger(message.frame))throw Error('잘못된 검수 화면 요청입니다.');
    const values=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func:CVATReviewNative,args:[{...message.context,action:message.action,frame:message.frame}]});
    return values.find(value=>value.frameId===0)?.result || {error:'CVAT 화면 응답을 받지 못했습니다.'};
  })().then(respond,error=>respond({error:error.message}));
  return true;
});
async function pageMessage(id,session,message){
  return chrome.tabs.sendMessage(id,{...message,pageId:session.pageId,origin:session.origin,jobPath:session.jobPath},{frameId:0});
}
async function stop(id) {
  const session=sessions.get(id);starts.delete(id);sessions.delete(id);
  if(session?.pageId)void pageMessage(id,session,{type:'CVAT_HEALTH_PAGE_STOP'}).catch(()=>{});
  await persist();
}
async function attachPage(id,session){
  if(sessions.get(id)!==session)return;
  try{
    const config={type:'CVAT_HEALTH_PAGE_START',alerts:alertsEnabled};
    let response;
    try{response=await pageMessage(id,session,config);}catch{/* No receiver yet. */}
    // Other extension content handlers can keep sendMessage connected while the
    // health listener was disposed on a Job change. An empty reply also needs setup.
    if(response?.ready!==true){
      if(sessions.get(id)!==session)return;
      await chrome.scripting.executeScript({target:{tabId:id},files:['health-page.js']});
      if(sessions.get(id)!==session)return;
      response=await pageMessage(id,session,{...config,alerts:alertsEnabled});
    }
    if(sessions.get(id)!==session){void pageMessage(id,session,{type:'CVAT_HEALTH_PAGE_STOP'}).catch(()=>{});return;}
    session.pageReady=response?.ready===true;
    if(session.pageReady&&response.online===false)void notify(id,session,'offline');
    const pending=session.pendingNotice;delete session.pendingNotice;
    if(session.pageReady&&pending&&Date.now()-pending.at<10000)void notify(id,session,pending.category,pending.kind);
  }catch{session.pageReady=false;}
  if(sessions.get(id)===session)await persist();
}
async function notify(id,session,category,kind){
  if(!alertsEnabled||sessions.get(id)!==session||!session.pageId)return;
  if(!session.pageReady){session.pendingNotice={category,kind,at:Date.now()};return;}
  const now=Date.now();session.noticeTimes??={};
  if(now-(session.noticeTimes[category]||0)<60000||now-(session.lastNoticeAt||0)<4000)return;
  session.noticeTimes[category]=now;session.lastNoticeAt=now;void persist();
  try{
    const tab=await chrome.tabs.get(id),url=new URL(tab.url);
    if(!alertsEnabled||sessions.get(id)!==session||url.origin!==session.origin||url.pathname!==session.jobPath)return;
    await pageMessage(id,session,{type:'CVAT_HEALTH_PAGE_NOTICE',category,kind});
  }catch{/* Measurement remains available when the page cannot show a notice. */}
}
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
    const sample=health.finish(session.data, details.requestId, details.timeStamp, details.statusCode, details.error, details.fromCache);
    if(sample&&sample.outcome!=='ok')void notify(details.tabId,session,sample.outcome,sample.kind);
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
    if(!listeningAPI||!await chrome.permissions.contains({permissions:['webRequest'],origins:[hostPattern(origin)]}))throw new Error('이 CVAT 사이트의 접근 권한이 필요합니다. 팝업에서 측정 시작을 눌러 허용하세요.');
    if(starts.get(id)!==token||(automatic&&(!autoOrigins.has(origin)||paused.has(id))))throw new Error('자동 측정이 취소됐습니다.');
    const current=await chrome.tabs.get(id),currentURL=new URL(current.url);
    if(!await chrome.permissions.contains({permissions:['webRequest'],origins:[hostPattern(origin)]}))throw new Error('사이트 권한이 해제됐습니다. 다시 켜주세요.');
    if(starts.get(id)!==token||currentURL.origin!==origin||currentURL.pathname!==jobPath)throw new Error('탭이 이동했습니다. 다시 켜주세요.');
    if(automatic&&(!autoOrigins.has(origin)||paused.has(id)))throw new Error('자동 측정이 취소됐습니다.');
    const previous=sessions.get(id);
    paused.delete(id);
    const session=previous?.origin===origin&&previous?.jobPath===jobPath?previous:{origin,jobPath,data:health.create()};
    session.pageId??=`${Date.now()}-${Math.random()}`;
    sessions.set(id,session);await persist();await attachPage(id,session);
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
    let fromOverlay=false;
    if(!fromPopup&&message.type!=='CVAT_HEALTH_NETWORK'){await verifyOverlay(sender,message.context);fromOverlay=true;}
    if(message.type==='CVAT_HEALTH_ALERTS'){
      if((!fromPopup&&!fromOverlay)||typeof message.enabled!=='boolean')throw new Error('Popup required');
      alertsWrite=alertsWrite.catch(()=>{}).then(async()=>{
        await chrome.storage.local.set({[ALERT_KEY]:message.enabled});alertsEnabled=message.enabled;
        await Promise.all([...sessions].map(([tabId,value])=>pageMessage(tabId,value,{type:'CVAT_HEALTH_PAGE_SETTINGS',alerts:alertsEnabled}).catch(()=>{})));
      });
      await alertsWrite;
      return {alerts:alertsEnabled};
    }
    const id = sender.tab?.id ?? (fromPopup ? message.tabId : undefined);
    if (!Number.isInteger(id)) throw new Error('Invalid tab');
    if(message.type==='CVAT_HEALTH_NETWORK'){
      const session=sessions.get(id);
      if(!session||message.pageId!==session.pageId||typeof message.online!=='boolean')throw new Error('Inactive page');
      await verifyOverlay(sender,{origin:session.origin,path:session.jobPath});
      if(sessions.get(id)!==session)throw new Error('Inactive page');
      if(message.online===false)void notify(id,session,'offline');
      return {accepted:true};
    }else if (message.type==='CVAT_HEALTH_START') {
      if (!fromPopup&&!fromOverlay) throw new Error('Popup required');
      await startTab(id);
    } else if(message.type==='CVAT_HEALTH_AUTO'){
      if(!fromPopup&&!fromOverlay)throw new Error('Popup required');
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
    return session ? {enabled:true,auto,alerts:alertsEnabled,pageReady:session.pageReady===true,...health.summary(session.data,Date.now())} : {enabled:false,auto,alerts:alertsEnabled};
  }).then(respond,error=>respond({enabled:false,alerts:alertsEnabled,error:error.message || '상태 확인 실패'}));
  return true;
});
