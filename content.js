// ===== 基本 =====
const LOG_PREFIX = "[enter-normalizer]";
const log = (...a) => console.debug(LOG_PREFIX, ...a);

const HOST = location.hostname.toLowerCase();
const SITE = (() => {
  // Grok 系 → 公式の挙動に完全に任せる（この拡張は一切触らない）
  if (HOST.includes("grok.com") || HOST.includes("x.ai")) return "grok";

  // ChatGPT 系
  if (HOST.includes("chat.openai.com") || HOST.includes("chatgpt.com")) return "chatgpt";

  // Genspark
  if (HOST === "www.genspark.ai" || HOST.endsWith(".genspark.ai")) return "genspark";

  // その他
  return "generic";
})();

log("SITE =", SITE);

// ===== 判定 =====
function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName?.toLowerCase?.();
  if (tag === "textarea") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.("role") === "textbox") return true;
  return false;
}

function getDeepActiveEditable(e) {
  const path = e?.composedPath ? e.composedPath() : [e?.target].filter(Boolean);
  for (const n of path) {
    if (isEditable(n)) return n;
    if (n?.shadowRoot?.activeElement && isEditable(n.shadowRoot.activeElement)) {
      return n.shadowRoot.activeElement;
    }
  }
  const el = document.activeElement;
  return isEditable(el) ? el : null;
}

function deepQuerySelectorAll(root, selector) {
  const out = [];
  const walk = (node) => {
    if (!node || node.nodeType !== 1) return;
    try {
      if (node.matches && node.matches(selector)) out.push(node);
    } catch {}
    if (node.shadowRoot) walk(node.shadowRoot);
    let c = node.firstElementChild;
    while (c) {
      walk(c);
      c = c.nextElementSibling;
    }
  };
  walk(root);
  return out;
}

// ===== 送信 =====
function findSendButton(contextEl) {
  const sels = [
    'button[aria-label*="send" i]',
    'button[aria-label*="送信" i]',
    'button[data-testid*="send" i]',
    'button[data-testid*="submit" i]',
    'form button[type="submit"]',
    'button[type="submit"]',
    'button[class*="send" i]',
    'button[class*="submit" i]'
  ];

  // ページ全体をざっくり探索
  for (const s of sels) {
    const btn = deepQuerySelectorAll(document, s).find(b => !b.disabled);
    if (btn) return btn;
  }

  // それでも見つからなければ、コンテキストのroot内を探索
  const root = (contextEl && contextEl.getRootNode && contextEl.getRootNode()) || document;
  for (const s of sels) {
    const btn = deepQuerySelectorAll(root, s).find(b => !b.disabled);
    if (btn) return btn;
  }

  return null;
}

function trySend(el) {
  const btn = findSendButton(el);
  if (btn) {
    btn.click();
    log("Send via button.click()");
    return true;
  }

  const form = el.closest?.("form") || document.querySelector("form");
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      log("Send via requestSubmit()");
      return true;
    }
    const sb = form.querySelector('button[type="submit"], input[type="submit"]');
    if (sb) {
      sb.click();
      log("Send via submitBtn.click()");
      return true;
    }
  }

  log("Send failed: no button/form");
  return false;
}

// ===== 改行: 共通ユーティリティ =====
function simulateShiftEnter(el) {
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    charCode: 13,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false
  };
  let handled = false;
  for (const target of [el, el.getRootNode?.() || null, document, window]) {
    if (!target || !target.dispatchEvent) continue;
    const kd = new KeyboardEvent("keydown", opts);
    const kdOk = target.dispatchEvent(kd);
    if (kdOk === false) handled = true;
    const kp = new KeyboardEvent("keypress", opts);
    const kpOk = target.dispatchEvent(kp);
    if (kpOk === false) handled = true;
    const ku = new KeyboardEvent("keyup", opts);
    target.dispatchEvent(ku);
  }
  if (handled) log("Soft break handled by synthetic Shift+Enter");
  return handled;
}

// Genspark用フォールバック: 「素の Enter」をサイト側に投げ直す
function simulatePlainEnter(el) {
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    charCode: 13,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false
  };
  let handled = false;
  for (const target of [el, el.getRootNode?.() || null, document, window]) {
    if (!target || !target.dispatchEvent) continue;
    const kd = new KeyboardEvent("keydown", opts);
    const kdOk = target.dispatchEvent(kd);
    if (kdOk === false) handled = true;
    const kp = new KeyboardEvent("keypress", opts);
    const kpOk = target.dispatchEvent(kp);
    if (kpOk === false) handled = true;
    const ku = new KeyboardEvent("keyup", opts);
    target.dispatchEvent(ku);
  }
  if (handled) log("Plain Enter handled by synthetic Enter");
  return handled;
}

function requestSoftBreakViaInputEvent(el) {
  const beforeHandled = el.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertLineBreak",
    data: null
  }));
  el.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertLineBreak",
    data: null
  }));
  log("Soft break via InputEvent", { beforeHandled });
  // beforeinput が preventDefault された（=ハンドラで処理済）なら true とみなす
  return beforeHandled === false;
}

// React制御のtextarea向け: ネイティブsetterで値反映（巻き戻り防止）
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

function insertTextInTextarea(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const val = el.value ?? "";
  const next = val.slice(0, start) + text + val.slice(end);
  setNativeValue(el, next);
  const caret = start + text.length;
  el.selectionStart = el.selectionEnd = caret;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// ===== 改行: サイト別アダプタ =====
function insertNewlineChatGPT(el) {
  // ChatGPT は textarea（React管理）が主。Enter=送信が既定なのでこちらで確実に \n を挿入する。
  if (el.tagName?.toLowerCase() === "textarea") {
    insertTextInTextarea(el, "\n"); // 巻き戻り防止
    return;
  }
  // 念のため contentEditable だった場合の保険
  if (el.isContentEditable || el.getAttribute?.("role") === "textbox") {
    if (simulateShiftEnter(el)) return;                    // ① keydown系で処理
    if (requestSoftBreakViaInputEvent(el)) return;         // ② beforeinput/input
    // ③ 最終フォールバック: テキストノードで \n
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode("\n");
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "\n"
      }));
      log("ChatGPT: soft break via literal \\n node");
    }
  }
}

function insertNewlineGeneric(el) {
  // textarea は素直に \n
  if (el.tagName?.toLowerCase() === "textarea") {
    insertTextInTextarea(el, "\n");
    return;
  }
  // contentEditable / role=textbox
  if (el.isContentEditable || el.getAttribute?.("role") === "textbox") {
    if (simulateShiftEnter(el)) return;             // ① keydown: Shift+Enter
    if (requestSoftBreakViaInputEvent(el)) return;  // ② beforeinput/input
    // ③ 最後だけ \n を文字で
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode("\n");
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "\n"
      }));
      log("Generic/Genspark: soft break via literal \\n node");
    }
  }
}

// エントリポイント
function insertNewline(el) {
  if (SITE === "chatgpt") return insertNewlineChatGPT(el);
  // Genspark / generic は共通ロジックで十分
  return insertNewlineGeneric(el);
}

// ===== Ctrl+Enter の送信ロジック =====
function sendWithCtrlEnter(el) {
  // まずは共通ロジック：ボタン / フォーム送信を試す
  if (trySend(el)) return;

  // Gensparkだけ、サイト本来のEnter送信にフォールバック
  if (SITE === "genspark") {
    const ok = simulatePlainEnter(el);
    if (ok) {
      log("Genspark: send via synthetic plain Enter");
    } else {
      log("Genspark: synthetic plain Enter had no visible effect");
    }
  }
}

// ===== キーハンドラ =====
function handleKeyDown(e) {
  // Grok では拡張は一切触らない（公式実装に任せる）
  if (SITE === "grok") return;

  if (!e.isTrusted || e.isComposing || e.key !== "Enter") return;

  const el = getDeepActiveEditable(e);
  if (!el) return;

  const platform = (navigator.userAgentData?.platform || navigator.platform || "");
  const isMac = platform.includes("Mac");
  const isCtrlLike = isMac ? e.metaKey : e.ctrlKey;

  // ユーザーの Shift+Enter はそのサイトに委ねる（ソフト改行の自然挙動を維持）
  if (e.shiftKey && !isCtrlLike) return;

  // ここから拡張主導
  e.preventDefault();
  e.stopImmediatePropagation?.();
  e.stopPropagation();

  if (isCtrlLike) {
    // Ctrl/Cmd+Enter → 送信
    sendWithCtrlEnter(el);
  } else {
    // Enter → 改行（サイト別に最適化）
    insertNewline(el);
  }
}

// ===== 取付 =====
let attached = false;
function attachKeydown() {
  if (attached) return;
  attached = true;
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  log(`Keydown listener attached. SITE=${SITE}`);
}

const mo = new MutationObserver(() => attachKeydown());
mo.observe(document.documentElement, { childList: true, subtree: true });
attachKeydown();
