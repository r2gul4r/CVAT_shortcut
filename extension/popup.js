(() => {
  "use strict";
  const shared = globalThis.CVATShortcuts;
  const $ = (id) => document.getElementById(id);
  let settings = shared.normalize(null);
  let recording = null;
  let composing = false;
  let saving = false;
  let noticeTimer;
  let activeTab;
  let loaded = false;
  let tabEnabled = false;
  let refreshing = false;
  const OVERLAY_ENABLED_KEY = "cvatLabelOverlayEnabled";
  let overlayEnabled = true, overlayLoaded = false, overlaySaving = false;
  let catalog = {state: "inactive", labels: []};

  function renderLabels() {
    const ready = tabEnabled && catalog.state === "ready";
    const available = ready ? catalog.labels : [];
    const displayed = ready ? [...available, ...settings.labelShortcuts.filter((entry) => !available.some((label) => label.name === entry.name))
      .map((entry) => ({name: entry.name, unavailable: true}))] : [];
    const selected = available.some((label) => !label.duplicate && label.name === settings.defaultLabelName);
    const disabled = !loaded || saving || refreshing || Boolean(recording) || !ready;
    $("label-colors").hidden = !ready || !displayed.length;
    $("label-color-list").replaceChildren();
    for (const label of displayed) {
      const binding = settings.labelShortcuts.find((entry) => entry.name === label.name);
      const row = document.createElement("div"); row.className = "label-shortcut-row";
      const color = shared.normalizeLabelColor(label.color);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "label-color-choice secondary";
      button.disabled = disabled || label.duplicate || label.unavailable;
      button.value = label.name;
      button.setAttribute("aria-pressed", String(selected && label.name === settings.defaultLabelName));
      button.title = color || "색상 정보 없음";
      const swatch = document.createElement("span");
      swatch.className = "label-swatch" + (color ? "" : " unknown");
      swatch.style.backgroundColor = color || "transparent";
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = label.name + (label.duplicate ? " (이름 중복)" : label.unavailable ? " (이 작업에 없음)" : "");
      button.append(swatch, name);
      button.addEventListener("click", () => { if (!saving && !refreshing) saveLabel(label.name, true); });
      const controls = document.createElement("div"); controls.className = "label-shortcut-controls";
      const shortcut = document.createElement("output"); shortcut.className = "label-shortcut-key";
      shortcut.textContent = shared.format(binding?.shortcut);
      const assign = document.createElement("button"); assign.type = "button"; assign.className = "secondary label-shortcut-assign";
      assign.textContent = binding ? "변경" : "키 지정";
      assign.setAttribute("aria-label", `${label.name} 단축키 ${binding ? "변경" : "지정"}`);
      assign.disabled = disabled || label.duplicate || label.unavailable;
      assign.addEventListener("click", () => { recording = {name: label.name}; notice(""); render(); $("cancel").focus(); });
      const clear = document.createElement("button"); clear.type = "button"; clear.className = "secondary label-shortcut-clear";
      clear.textContent = "해제"; clear.setAttribute("aria-label", `${label.name} 단축키 해제`);
      clear.disabled = !binding || disabled;
      clear.addEventListener("click", () => saveLabelBinding(label.name, null));
      controls.append(shortcut, assign, clear); row.append(button, controls);
      $("label-color-list").append(row);
    }
    $("label-refresh").disabled = !tabEnabled || saving || refreshing || Boolean(recording);
    $("label-status").textContent = refreshing ? "이 탭의 라벨을 읽는 중입니다…" : !tabEnabled ?
      "위의 사용 버튼을 누르면 이 작업의 전체 클래스 목록을 읽습니다." : !ready ?
      "CVAT의 Info → Overview를 열고 목록 새로고침을 눌러주세요. 계속 안 되면 직접 입력할 수 있습니다." : !available.length ?
      "이 작업에 등록된 라벨이 없습니다." : selected ?
      `${available.length}개 클래스 · 선택하면 자동 저장됩니다.` :
      `${available.length}개 클래스 · 저장된 라벨을 이 탭에서 선택할 수 없습니다. 사용할 라벨을 골라주세요.`;
  }

  async function currentStatus() {
    const [before] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!activeTab || before?.id !== activeTab.id || before?.url !== activeTab.url) throw new Error("Tab changed");
    const status = await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_LABELS"});
    const [after] = await chrome.tabs.query({active: true, currentWindow: true});
    if (after?.id !== before.id || after?.url !== before.url || status?.jobPath !== new URL(before.url).pathname) throw new Error("Job changed");
    return status;
  }

  function notice(text, error = false) {
    clearTimeout(noticeTimer);
    $("notice").textContent = text;
    $("notice").classList.toggle("error", error);
    if (text && !error) noticeTimer = setTimeout(() => { $("notice").textContent = ""; }, 3500);
  }

  function render() {
    $("overlay-enabled").checked = overlayEnabled;
    $("overlay-enabled").disabled = !overlayLoaded || overlaySaving || Boolean(recording);
    $("overlay-show").disabled = !tabEnabled || !overlayLoaded || !overlayEnabled || overlaySaving;
    for (const action of shared.ACTIONS) {
      $(action + "-key").textContent = shared.format(settings.shortcuts[action]);
      $(action + "-assign").textContent = settings.shortcuts[action] ? "변경" : "지정";
      $(action + "-assign").disabled = !loaded || saving;
      $(action + "-clear").disabled = !loaded || saving || !settings.shortcuts[action];
    }
    const warnings = [...shared.ACTIONS.map((action) => ({name: shared.ACTION_LABELS[action], shortcut: settings.shortcuts[action]})),
      ...settings.labelShortcuts].filter((entry) => shared.shortcutWarning(entry.shortcut));
    $("shortcut-warning").hidden = warnings.length === 0;
    $("shortcut-warning").textContent = warnings.length ?
      `${warnings.map((entry) => entry.name).join(" / ")}: ${shared.shortcutWarning(warnings[0].shortcut)}` : "";
    $("recording").hidden = !recording;
    if (recording) $("recording-text").textContent = `${typeof recording === "object" ? "라벨 " + recording.name : shared.ACTION_LABELS[recording]}에 사용할 키 또는 키 조합을 누르세요. Esc로 취소합니다.`;
    $("wheel-enabled").checked = settings.brushWheel.enabled;
    $("pan-enabled").checked = settings.spacePan;
    $("pan-enabled").disabled = !loaded || saving || Boolean(recording);
    $("pan-warning").hidden = !settings.spacePan || ![...shared.ACTIONS.map((name) => settings.shortcuts[name]), ...settings.labelShortcuts.map((entry) => entry.shortcut)]
      .some((shortcut) => shared.signature(shortcut) === shared.signature({code: "Space"}));
    $("wheel-enabled").disabled = !loaded || saving;
    $("wheel-modifier").value = settings.brushWheel.modifier;
    $("wheel-modifier").disabled = !loaded || saving || !settings.brushWheel.enabled;
    if (document.activeElement !== $("default-label")) $("default-label").value = settings.defaultLabelName;
    $("default-label").disabled = !loaded || saving || Boolean(recording);
    $("label-save").disabled = !loaded || saving || Boolean(recording);
    renderLabels();
  }

  async function save(action, shortcut) {
    saving = true;
    render();
    try {
      // Read the latest stored settings so another popup cannot silently create a duplicate.
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.assign(current[shared.STORAGE_KEY], action, shortcut);
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
      settings = next;
      recording = null;
      notice(shortcut ? `저장됨: ${shared.format(shortcut)}` : "단축키를 해제했습니다.");
    } catch (error) {
      notice(error.message || "설정을 저장하지 못했습니다.", true);
    } finally {
      saving = false;
      render();
    }
  }

  async function saveLabelBinding(name, shortcut) {
    if (saving) return;
    saving = true; render();
    try {
      if (shortcut) {
        const status = await currentStatus(); showTabStatus(status);
        if (!status.enabled || status.catalog?.state !== "ready" || !status.catalog.labels.some((label) => label.name === name && !label.duplicate)) {
          throw new Error("현재 탭의 라벨 목록이 바뀌었습니다. 목록을 새로고침하세요.");
        }
      }
      const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.assignLabel(stored[shared.STORAGE_KEY], name, shortcut);
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next}); settings = next; recording = null;
      notice(shortcut ? `${name}: ${shared.format(shortcut)} 저장됨` : `${name} 단축키를 해제했습니다.`);
    } catch (error) { notice(error.message || "라벨 단축키를 저장하지 못했습니다.", true); }
    finally { saving = false; render(); }
  }

  function showTabStatus(status) {
    const on = status?.supported && status?.enabled;
    tabEnabled = Boolean(on);
    $('paste-start').disabled = !on || Boolean(status?.paste?.running);
    $('paste-stop').disabled = !on || !status?.paste?.running;
    if (status?.paste?.message) $('paste-status').textContent = status.paste.message;
    catalog = on && status.catalog ? status.catalog : {state: "inactive", labels: []};
    $("enable").disabled = !activeTab || !shared.supportedURL(activeTab.url) || on;
    $("enable").hidden = Boolean(on);
    $("disable").hidden = !on;
    $("overlay-show").disabled = !on || !overlayLoaded || !overlayEnabled || overlaySaving;
    $("tab-status").textContent = on ? "이 탭에서 사용 중입니다." :
      shared.supportedURL(activeTab?.url) ? "CVAT 왼쪽 도구 메뉴가 표시되면 사용 버튼을 누르세요." : "CVAT의 라벨링 작업(Job)을 연 뒤 사용하세요.";
    renderLabels();
  }

  $("pan-enabled").addEventListener("change", async () => {
    const spacePan = $("pan-enabled").checked;
    saving = true; render();
    try {
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.normalize({...shared.normalize(current[shared.STORAGE_KEY]), spacePan});
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
      settings = next;
      notice(spacePan ? "Space를 누른 채 왼쪽 드래그로 화면을 이동하세요." : "스페이스로 화면 이동을 껐습니다.");
    } catch { notice("화면 이동 설정을 저장하지 못했습니다.", true); }
    finally { saving = false; render(); }
  });

  async function saveWheel() {
    const wheel = {enabled: $("wheel-enabled").checked, modifier: $("wheel-modifier").value};
    saving = true; render();
    try {
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.normalize({...shared.normalize(current[shared.STORAGE_KEY]), brushWheel: wheel});
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next});
      settings = next;
      notice(wheel.enabled ? `브러쉬 크기: ${shared.wheelModifierName(settings.brushWheel.modifier)} + 휠.` : "휠을 이용한 브러쉬 크기 조절을 껐습니다.");
    } catch { notice("브러쉬 크기 설정을 저장하지 못했습니다.", true); }
    finally { saving = false; render(); }
  }
  $("wheel-enabled").addEventListener("change", saveWheel);
  $("wheel-modifier").addEventListener("change", saveWheel);
  async function saveLabel(name, fromList = false) {
    if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
      notice("정확한 라벨 이름을 입력하세요. (1–128자)", true); return;
    }
    saving = true; render();
    try {
      if (fromList) {
        const status = await currentStatus();
        showTabStatus(status);
        if (!status.enabled || status.catalog?.state !== "ready" || !status.catalog.labels.some((label) => label.name === name && !label.duplicate)) {
          notice("라벨 목록이 바뀌었습니다. 목록을 확인하고 다시 선택하세요.", true); return;
        }
      }
      const current = await chrome.storage.local.get(shared.STORAGE_KEY);
      const next = shared.normalize({...shared.normalize(current[shared.STORAGE_KEY]), defaultLabelName: name});
      await chrome.storage.local.set({[shared.STORAGE_KEY]: next}); settings = next;
      notice("AI·새 마스크·폴리곤에 사용할 기본 라벨을 저장했습니다.");
    } catch { if (fromList) showTabStatus(null); notice("저장하지 못했습니다. 탭과 라벨 목록을 확인하고 다시 시도하세요.", true); }
    finally { saving = false; render(); }
  }
  $("label-save").addEventListener("click", () => saveLabel($("default-label").value.trim()));
  $("label-refresh").addEventListener("click", async () => {
    refreshing = true; renderLabels();
    try { showTabStatus(await currentStatus()); }
    catch { showTabStatus(null); notice("탭이 변경되었거나 확장 연결이 끊겼습니다. 팝업을 다시 열어주세요.", true); }
    finally { refreshing = false; renderLabels(); }
  });

  for (const action of shared.ACTIONS) {
    $(action + "-assign").addEventListener("click", () => {
      recording = action;
      notice("");
      render();
      $("cancel").focus();
    });
    $(action + "-clear").addEventListener("click", () => save(action, null));
  }
  $("cancel").addEventListener("click", () => { recording = null; notice("단축키 지정을 취소했습니다."); render(); });
  document.addEventListener("compositionstart", () => { composing = true; }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  window.addEventListener("blur", () => { composing = false; });
  document.addEventListener("keydown", (event) => {
    if (!recording || saving || composing || event.repeat || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation();
      recording = null; notice("단축키 지정을 취소했습니다."); render(); return;
    }
    const candidate = shared.fromEvent(event);
    if (!candidate) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (typeof recording === "object") saveLabelBinding(recording.name, candidate);
    else save(recording, candidate);
  }, true);

  $("enable").addEventListener("click", async () => {
    if (!activeTab || !shared.supportedURL(activeTab.url)) return;
    $("enable").disabled = true;
    try {
      let repeatBridgeLoaded = true;
      try {
        await chrome.scripting.executeScript({target:{tabId:activeTab.id},files:["native-repeat.js"],world:"MAIN"});
      } catch { repeatBridgeLoaded = false; }
      const results = await chrome.scripting.executeScript({
        target: {tabId: activeTab.id}, files: ["common.js", "overlay.js", "paste-repeat.js", "content.js"], world: "ISOLATED"
      });
      const status = results.find((entry) => entry.frameId === 0)?.result;
      showTabStatus(status);
      if (!status?.supported) notice("CVAT 도구를 찾지 못했습니다. 왼쪽 도구 메뉴가 표시될 때까지 기다리거나 직접 실행하세요.", true);
      else if (!status.enabled) notice("설정을 읽지 못해 단축키가 일시정지 상태입니다.", true);
      else notice(repeatBridgeLoaded ? "이 탭에서 단축키를 사용할 수 있습니다. N도 선택한 라벨로 시작합니다." :
        "도구 단축키는 활성화됐지만 N 연동 코드를 불러오지 못했습니다. 페이지를 새로고침하고 다시 켜세요.", !repeatBridgeLoaded);
    } catch {
      showTabStatus(null);
      notice("단축키를 활성화하지 못했습니다. 작업 페이지를 새로고침한 뒤 다시 시도하세요. 브라우저 정책으로 확장 사용이 제한될 수 있습니다.", true);
    }
  });
  for (const action of ['start','stop']) $('paste-'+action).addEventListener('click', async () => {
    try {
      const [current] = await chrome.tabs.query({active:true,currentWindow:true});
      if (current?.id !== activeTab?.id || current?.url !== activeTab?.url) throw Error('탭이 바뀌었습니다. 팝업을 다시 열어주세요.');
      const status = await chrome.tabs.sendMessage(activeTab.id, {type:'CVAT_SHORTCUTS_PASTE_'+action.toUpperCase()});
      showTabStatus(status);
      if (!status?.paste) notice('반복 기능을 불러오지 못했습니다. CVAT 페이지를 새로고침하고 확장을 다시 켜세요.', true);
      else if (action === 'start' && status.paste.running) window.close();
    } catch (error) { notice(error.message || '반복 상태 확인 실패', true); }
  });
  $("disable").addEventListener("click", async () => {
    try {
      const status = await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_DISABLE"});
      showTabStatus(status);
    } catch { showTabStatus(null); notice("탭이 변경되었습니다. 팝업을 다시 열어 확인하세요.", true); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[OVERLAY_ENABLED_KEY]) {
      overlayEnabled = changes[OVERLAY_ENABLED_KEY].newValue !== false; render();
    }
    if (area === "local" && changes[shared.STORAGE_KEY]) {
      settings = shared.normalize(changes[shared.STORAGE_KEY].newValue);
      render();
    }
  });
  $("overlay-enabled").addEventListener("change", async () => {
    if (!overlayLoaded || overlaySaving) return;
    const next = $("overlay-enabled").checked;
    overlaySaving = true; render();
    try {
      await chrome.storage.local.set({[OVERLAY_ENABLED_KEY]: next});
      overlayEnabled = next;
      notice(next ? "라벨 선택창을 켰습니다. 활성화된 CVAT 탭에 표시됩니다." : "라벨 선택창을 껐습니다. 단축키는 계속 사용할 수 있습니다.");
    } catch { notice("라벨 선택창 설정을 저장하지 못했습니다. 다시 시도하세요.", true); }
    finally { overlaySaving = false; render(); }
  });
  $("overlay-show").addEventListener("click", async () => {
    try {
      await currentStatus();
      const status = await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_OVERLAY_SHOW", recover: true});
      showTabStatus(status);
      if (!status?.supported || !status?.enabled) notice("작업 탭에서 ‘이 CVAT 탭에서 사용’을 먼저 눌러주세요.", true);
      else if (!status.overlay || status.overlay.state === "missing") notice("라벨 선택창 코드가 연결되지 않았습니다. CVAT 작업을 저장하고 페이지를 새로고침한 뒤 확장을 다시 켜세요. 확인 코드: RELOAD", true);
      else if (status.overlay.state === "visible") notice("라벨 선택창을 기본 위치·크기·투명도로 복구했습니다.");
      else {
        const state = status.overlay.state;
        const code = ["paused","loading","off","unsupported","detached","hidden","outside","covered"].includes(state) ? state.toUpperCase() : "UNKNOWN";
        notice(`라벨 선택창을 표시하지 못했습니다. 확인 코드: ${code}. 이 문구를 알려주세요.`, true);
      }
    } catch { notice("작업 탭을 확인하고 확장을 다시 켜주세요.", true); }
  });

  async function init() {
    render();
    try {
      const value = await chrome.storage.local.get(OVERLAY_ENABLED_KEY);
      overlayEnabled = value[OVERLAY_ENABLED_KEY] !== false; overlayLoaded = true;
    } catch { notice("라벨 선택창 설정을 읽지 못했습니다. 팝업을 다시 열어주세요.", true); }
    try {
      const stored = await chrome.storage.local.get(shared.STORAGE_KEY);
      settings = shared.normalize(stored[shared.STORAGE_KEY]);
      loaded = true;
      const saved = stored[shared.STORAGE_KEY];
      if (saved?.brushWheel?.modifier === "ctrl") {
        try {
          await chrome.storage.local.set({[shared.STORAGE_KEY]: {
            ...saved, brushWheel: {...saved.brushWheel, modifier: "alt"}
          }});
        } catch { notice(`이전 Ctrl + 휠 설정을 갱신하지 못했습니다. 브러쉬 크기는 ${shared.wheelModifierName("alt")}로 조절합니다.`, true); }
      }
    } catch { notice("설정을 읽지 못했습니다. 팝업을 다시 열어주세요.", true); }
    render();
    try {
      [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      const status = shared.supportedURL(activeTab?.url) ?
        await chrome.tabs.sendMessage(activeTab.id, {type: "CVAT_SHORTCUTS_STATUS"}).catch(() => null) : null;
      showTabStatus(status);
    } catch { showTabStatus(null); }
  }
  $("wheel-modifier").querySelector('[value="alt"]').textContent = `${shared.wheelModifierName("alt")} + 휠 (권장)`;
  $("platform-note").textContent = shared.isMac() ?
    "Mac: Option은 Alt에 해당하며 Cmd와 Ctrl은 별개입니다. 단축키는 키보드의 물리적 위치를 기준으로 합니다. Chrome/macOS 단축키가 우선할 수 있습니다." :
    "단축키는 키보드의 물리적 위치를 기준으로 합니다. Chrome 또는 운영체제 단축키가 우선할 수 있습니다.";
  init();
})();
