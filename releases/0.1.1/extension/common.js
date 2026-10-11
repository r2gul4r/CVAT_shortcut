/* Shared, dependency-free shortcut handling. Physical keys work across input layouts. */
(() => {
  "use strict";
  const ACTIONS = Object.freeze(["ai", "brush"]);
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
    for (const action of ACTIONS) shortcuts[action] = sanitizeShortcut(value?.shortcuts?.[action]);
    // Corrupt/externally edited duplicate settings never dispatch an ambiguous action.
    if (shortcuts.ai && signature(shortcuts.ai) === signature(shortcuts.brush)) {
      shortcuts.ai = null;
      shortcuts.brush = null;
    }
    const label = typeof value?.defaultLabelName === "string" ? value.defaultLabelName.trim() : "obstacle";
    const defaultLabelName = label && label.length <= 128 && !/[\u0000-\u001f\u007f]/.test(label) ? label : "";
    return {version: 1, shortcuts, defaultLabelName, brushWheel: {
      enabled: value?.brushWheel?.enabled !== false,
      modifier: value?.brushWheel?.modifier === "shift" ? "shift" : "alt"
    }};
  }

  function assign(value, action, shortcut) {
    if (!ACTIONS.includes(action)) throw new Error("Unknown action");
    const next = normalize(value);
    const candidate = sanitizeShortcut(shortcut);
    if (shortcut !== null && !candidate) throw new Error("Choose a supported non-modifier key.");
    const other = ACTIONS.find((entry) => entry !== action);
    if (candidate && signature(candidate) === signature(next.shortcuts[other])) {
      throw new Error(`Already assigned to ${other === "ai" ? "AI tool" : "New mask (Brush tool)"}. Choose another key or clear that assignment.`);
    }
    next.shortcuts[action] = candidate;
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
      "This shortcut may be used by Chrome or your operating system and may not reach CVAT. Choose another if it does not work." : "";
  }

  function format(value, platform) {
    const key = sanitizeShortcut(value);
    if (!key) return "Unassigned";
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

  globalThis.CVATShortcuts = Object.freeze({ACTIONS, STORAGE_KEY, sanitizeShortcut, signature,
    fromEvent, normalize, assign, format, isMac, wheelModifierName, shortcutWarning, supportedURL});
})();
