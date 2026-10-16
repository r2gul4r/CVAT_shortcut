/* Shared, dependency-free shortcut handling. Physical keys work across input layouts. */
(() => {
  "use strict";
  const ACTIONS = Object.freeze(["ai", "brush", "polygon", "paste"]);
  const ACTION_LABELS = Object.freeze({ai: "AI 도구", brush: "새 마스크 (브러쉬)", polygon: "새 폴리곤", paste: "붙여넣기 반복"});
  const STORAGE_KEY = "cvatSidebarShortcutsV1";
  const VALID_CODE = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)|Arrow(Up|Down|Left|Right)|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Tab|Enter|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/;

  function sanitizeShortcut(value) {
    if (!value || typeof value !== "object" || !VALID_CODE.test(value.code)) return null;
    return { code: value.code, ctrl: value.ctrl === true, alt: value.alt === true,
      shift: value.shift === true, meta: value.meta === true };
  }

  function signature(value) {
    const key = sanitizeShortcut(value);
    return key ? [key.ctrl ? "C" : "", key.alt ? "A" : "", key.shift ? "S" : "",
      key.meta ? "M" : "", key.code].join(":") : "";
  }

  function fromEvent(event) {
    if (event.isComposing || event.keyCode === 229 ||
      ["Dead", "Process", "Unidentified"].includes(event.key) ||
      event.getModifierState?.("AltGraph")) return null;
    return sanitizeShortcut({code: event.code, ctrl: event.ctrlKey, alt: event.altKey,
      shift: event.shiftKey, meta: event.metaKey});
  }

  function normalize(value) {
    const shortcuts = {};
    for (const action of ACTIONS) {
      // The early 2.2.0 local build named this slot polyline. Carry its saved key forward
      // only when polygon is absent; an explicit polygon:null must stay cleared.
      const stored = action === "polygon" && !Object.prototype.hasOwnProperty.call(value?.shortcuts || {}, "polygon") ?
        value?.shortcuts?.polyline : value?.shortcuts?.[action];
      shortcuts[action] = sanitizeShortcut(stored);
    }
    // Corrupt/externally edited duplicate settings never dispatch an ambiguous action.
    const duplicates = ACTIONS.filter((action) => shortcuts[action] && ACTIONS.some((other) =>
      other !== action && signature(shortcuts[other]) === signature(shortcuts[action])));
    for (const action of duplicates) shortcuts[action] = null;
    const label = typeof value?.defaultLabelName === "string" ? value.defaultLabelName.trim() : "obstacle";
    const defaultLabelName = label && label.length <= 128 && !/[\u0000-\u001f\u007f]/.test(label) ? label : "";
    const bindings = (Array.isArray(value?.labelShortcuts) ? value.labelShortcuts : []).filter((entry) =>
      typeof entry?.name === "string" && entry.name.trim() === entry.name && entry.name.length > 0 && entry.name.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(entry.name) && sanitizeShortcut(entry.shortcut));
    const labelShortcuts = bindings.filter((entry) =>
      !ACTIONS.some((action) => signature(shortcuts[action]) === signature(entry.shortcut)) &&
      bindings.filter((other) => other.name === entry.name || signature(other.shortcut) === signature(entry.shortcut)).length === 1)
      .map((entry) => ({name: entry.name, shortcut: sanitizeShortcut(entry.shortcut)}));
    return {version: 1, shortcuts, labelShortcuts, defaultLabelName, spacePan: value?.spacePan !== false, brushWheel: {
      enabled: value?.brushWheel?.enabled !== false,
      modifier: value?.brushWheel?.modifier === "shift" ? "shift" : "alt"
    }};
  }

  function assign(value, action, shortcut) {
    if (!ACTIONS.includes(action)) throw new Error("알 수 없는 기능입니다.");
    const next = normalize(value);
    const candidate = sanitizeShortcut(shortcut);
    if (shortcut !== null && !candidate) throw new Error("Ctrl·Alt·Shift 같은 보조키 외에 사용할 키를 함께 누르세요.");
    const other = candidate && ACTIONS.find((entry) => entry !== action && signature(candidate) === signature(next.shortcuts[entry]));
    if (other) {
      throw new Error(`이미 ${ACTION_LABELS[other]}에 지정된 키입니다. 다른 키를 선택하거나 기존 지정을 해제하세요.`);
    }
    const conflict = candidate && next.labelShortcuts.find((entry) => signature(entry.shortcut) === signature(candidate));
    if (conflict) throw new Error(`이미 라벨 '${conflict.name}'에 지정된 키입니다. 기존 지정을 해제하거나 다른 키를 선택하세요.`);
    next.shortcuts[action] = candidate;
    return next;
  }

  function assignLabel(value, name, shortcut) {
    if (typeof name !== "string" || !name || name !== name.trim() || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("올바른 라벨 이름이 아닙니다.");
    const next = normalize(value), candidate = sanitizeShortcut(shortcut);
    if (shortcut !== null && !candidate) throw new Error("사용할 키 또는 키 조합을 누르세요.");
    if (candidate && ACTIONS.some((action) => signature(next.shortcuts[action]) === signature(candidate))) throw new Error("도구 단축키에 지정된 키입니다. 다른 키를 선택하세요.");
    if (candidate && next.labelShortcuts.some((entry) => entry.name !== name && signature(entry.shortcut) === signature(candidate))) throw new Error("다른 라벨에 지정된 키입니다. 다른 키를 선택하세요.");
    next.labelShortcuts = next.labelShortcuts.filter((entry) => entry.name !== name);
    if (candidate) next.labelShortcuts.push({name, shortcut: candidate});
    return next;
  }

  function isMac(platform = navigator.userAgentData?.platform || navigator.platform || "") {
    return /mac/i.test(platform);
  }

  function wheelModifierName(modifier, platform) {
    return modifier === "shift" ? "Shift" : isMac(platform) ? "Option" : "Alt";
  }

  function shortcutWarning(value, platform) {
    const key = sanitizeShortcut(value);
    if (!key) return "";
    const mac = isMac(platform);
    const primary = mac ? key.meta && !key.ctrl : key.ctrl && !key.meta;
    const browserKey = primary && !key.alt &&
      /^(Key[LTRWNOFPDSHJB]|Digit[0-9]|Equal|Minus|Tab|BracketLeft|BracketRight)$/.test(key.code);
    const systemKey = mac ? key.meta && /^(KeyQ|Space)$/.test(key.code) :
      key.meta || key.alt && /^(F4|Tab|Space)$/.test(key.code);
    const devtoolsKey = key.code === "F12" ||
      (mac ? key.meta && key.alt : key.ctrl && key.shift) && /^(KeyI|KeyJ|KeyC)$/.test(key.code);
    return browserKey || systemKey || devtoolsKey ?
      "Chrome 또는 운영체제가 사용하는 단축키라 CVAT에 전달되지 않을 수 있습니다. 작동하지 않으면 다른 키를 선택하세요." : "";
  }

  function format(value, platform) {
    const key = sanitizeShortcut(value);
    if (!key) return "미지정";
    const labels = {Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[",
      BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/"};
    const name = labels[key.code] || key.code.replace(/^Key|^Digit/, "").replace(/^Arrow/, "");
    return [key.ctrl && "Ctrl", key.alt && (isMac(platform) ? "Option" : "Alt"), key.shift && "Shift",
      key.meta && (isMac(platform) ? "Cmd" : "Meta"), name]
      .filter(Boolean).join(" + ");
  }

  function supportedURL(url) {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) &&
        /^\/tasks\/\d+\/jobs\/\d+\/?$/.test(parsed.pathname);
    } catch { return false; }
  }

  function normalizeLabelColor(value) {
    if (typeof value !== "string") return null;
    const color = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) return "#" + [...color.slice(1)].map((c) => c + c).join("");
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color);
    if (rgb && rgb.slice(1).every((n) => +n <= 255)) return "#" + rgb.slice(1).map((n) => (+n).toString(16).padStart(2, "0")).join("");
    return null;
  }

  function readLabelCatalog(root = document) {
    // Job-level classes, including classes with zero annotations. Never read object rows.
    const lists = [...root.querySelectorAll(".cvat-objects-sidebar-labels-list")];
    let names = null;
    const colors = new Map();
    if (lists.length === 1) {
      const rows = [...lists[0].querySelectorAll(".cvat-objects-sidebar-label-item")];
      const entries = rows.map((row) => {
        const nodes = row.querySelectorAll(".cvat-text");
        const name = nodes.length === 1 ? nodes[0].textContent.trim() : null;
        const swatch = row.querySelector?.(".cvat-label-item-color");
        const color = normalizeLabelColor(swatch?.style?.backgroundColor || swatch?.style?.background);
        if (name && color) colors.set(name, color);
        return name;
      });
      const header = lists[0].querySelector(".cvat-objects-sidebar-labels-list-header")?.textContent.trim();
      const expected = /^Items:\s*(\d+)$/.exec(header || "");
      if (expected && +expected[1] === rows.length && entries.every((name) => name !== null)) names = entries;
    }
    if (names === null) {
      // Overview has a synthetic total row; its key is distinct from a real class named Total.
      const sections = [...root.querySelectorAll(".cvat-job-info-statistics")];
      if (sections.length === 1) {
        const rows = [...sections[0].querySelectorAll("tbody tr[data-row-key]")];
        if (rows.filter((row) => row.getAttribute("data-row-key") === "___total").length === 1) {
          names = rows.filter((row) => row.getAttribute("data-row-key") !== "___total")
            .map((row) => row.querySelector("td")?.textContent.trim() ?? null);
        }
      }
    }
    if (names === null || names.some((name) => typeof name !== "string" || !name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name))) {
      return {state: "unavailable", labels: []};
    }
    const counts = new Map();
    for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
    return {state: "ready", labels: [...counts].map(([name, count]) => ({name, duplicate: count > 1,
      ...(count === 1 && colors.has(name) ? {color: colors.get(name)} : {})}))};
  }

  globalThis.CVATShortcuts = Object.freeze({ACTIONS, ACTION_LABELS, STORAGE_KEY, sanitizeShortcut, signature, assignLabel,
    fromEvent, normalize, assign, format, isMac, wheelModifierName, shortcutWarning, supportedURL, readLabelCatalog, normalizeLabelColor});
})();
