/* Test-only Chrome API shim. Uses only synthetic local fixture state. */
(() => {
  const listeners = {storage: [], message: []};
  const storageKey = "synthetic-extension-storage";
  let failRead = false;
  let failWrite = false;
  const metrics = {injections: 0, messages: 0, files: null, world: null, history: []};
  function tabStatus() {
    return {supported: !window.testUnsupportedDOM, enabled: Boolean(window.testTabEnabled) && !window.testUnsupportedDOM,
      ...(window.testLegacyOverlay ? {} : {overlay: window.testOverlayStatus || {state: read().cvatLabelOverlayEnabled === false ? "off" : "visible", view: "panel"}}),
      jobPath: new URL(window.testTabURL || "http://127.0.0.1/tasks/1/jobs/1").pathname,
      catalog: window.testCatalog || {state: "ready", labels: [{name: "object", duplicate: false, color: "#126abc"}, {name: "unused-class", duplicate: false, color: "#ef8040"}]}};
  }
  function read() { return JSON.parse(localStorage.getItem(storageKey) || "{}"); }
  const chrome = {
    permissions: {async request() {return !window.testHealthPermissionDenied;}},
    storage: {
      local: {
        async get(key) { if (failRead) throw new Error("Synthetic read failure"); return {[key]: read()[key] ?? (key === "cvatLabelOverlayV1" ? {x:20,y:500,view:"panel"} : undefined)}; },
        async set(values) {
          if (failWrite) throw new Error("Synthetic write failure");
          const current = read();
          const changes = {};
          for (const key of Object.keys(values)) changes[key] = {oldValue: current[key], newValue: values[key]};
          localStorage.setItem(storageKey, JSON.stringify({...current, ...values}));
          for (const listener of [...listeners.storage]) listener(changes, "local");
        }
      },
      onChanged: {addListener(listener) { listeners.storage.push(listener); }}
    },
    runtime: {async sendMessage(message) {
      if(message.type==='CVAT_HEALTH_AUTO'){window.testHealthAuto=message.enabled;window.testHealthEnabled=message.enabled;}
      if (message.type === 'CVAT_HEALTH_START') window.testHealthEnabled = true;
      if (message.type === 'CVAT_HEALTH_STOP') window.testHealthEnabled = false;
      if (message.type === 'CVAT_HEALTH_ALERTS') window.testHealthAlerts = message.enabled;
      if(window.testHealthFailure)throw Error('Could not establish connection. Receiving end does not exist.');
      return {...(window.testHealthEnabled?window.testHealthSnapshot||{}:{}),enabled:Boolean(window.testHealthEnabled),auto:Boolean(window.testHealthAuto),alerts:window.testHealthAlerts!==false,pageReady:true};
    },onMessage: {addListener(listener) { listeners.message.push(listener); }}},
    tabs: {
      async query() { return [{id: 7, url: window.testTabURL || "http://127.0.0.1/tasks/1/jobs/1"}]; },
      async sendMessage(_tab, message) {
        metrics.messages += 1;
        metrics.lastMessage = {...message};
        if (window.testPopupMode) {
          if (!window.testTabEnabled && message.type === "CVAT_SHORTCUTS_STATUS") throw new Error("No receiver");
          if (message.type === "CVAT_SHORTCUTS_DISABLE") window.testTabEnabled = false;
          return tabStatus();
        }
        let result;
        for (const listener of [...listeners.message]) listener(message, {}, (value) => {result = value;});
        if (!result) throw new Error("No receiver");
        return result;
      }
    },
    scripting: {async executeScript(options) {
      metrics.injections += 1; metrics.files = options.files; metrics.world = options.world;
      metrics.history.push({files:options.files,world:options.world,tabId:options.target.tabId});
      if (window.testMainInjectionFailure && options.world === "MAIN") throw new Error("Synthetic MAIN restriction");
      if (window.testInjectionFailure) throw new Error("Synthetic policy restriction");
      window.testTabEnabled = true;
      return [{frameId: 0, result: tabStatus()}];
    }}
  };
  Object.defineProperty(window, "chrome", {configurable: true, value: chrome});
  window.fixtureAPI = {
    clear() {localStorage.removeItem(storageKey);},
    read, metrics, listeners,
    failRead(value) {failRead = value;}, failWrite(value) {failWrite = value;},
    emit(changes, area) {for (const listener of [...listeners.storage]) listener(changes, area);}
  };
  window.testPopupMode = location.pathname.startsWith("/tests/popup");
})();
