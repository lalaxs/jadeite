// Toast / floating text / pulse FX (moved from main.js)

import { clampClient, uiText } from "./format-utils.js";

export let getEls = () => null;

const shownUiEventIds = new Set();
const floatBursts = new Map();
const floatTimers = new WeakMap();
const toastTimers = new WeakMap();
const MAX_FLOATS = 3;
const MAX_TOASTS = 3;
const FLOAT_MERGE_WINDOW = 450;
const TOAST_MERGE_WINDOW = 2000;
const TOAST_PRIORITY = { info: 0, success: 1, warn: 2, danger: 3 };

export function bindToastFxDeps(deps = {}) {
  if (typeof deps.getEls === "function") getEls = deps.getEls;
}

export function rememberUiEvent(event) {
  const id = typeof event === "string" ? event : event?.id;
  if (!id) return false;
  if (shownUiEventIds.has(id)) return true;
  shownUiEventIds.add(id);
  if (shownUiEventIds.size > 80) {
    const [oldest] = shownUiEventIds;
    shownUiEventIds.delete(oldest);
  }
  return false;
}

export function floatingPoint(payload = {}) {
  const stack = Math.max(0, Math.round(Number(payload.stack) || 0));
  const x = Number.isFinite(Number(payload.x)) ? Number(payload.x) : 50;
  const y = Number.isFinite(Number(payload.y))
    ? Number(payload.y)
    : 48 - Math.min(stack, 2) * 7;
  return {
    x: clampClient(x, 12, 88),
    y: clampClient(y, 18, 84)
  };
}

function safeTone(value, fallback = "info") {
  const tone = String(value || fallback).replace(/[^\w-]/g, "");
  return tone || fallback;
}

function normalizedFloatTone(value) {
  const tone = safeTone(value);
  if (tone === "profit") return "income";
  if (tone === "bad" || tone === "error") return "danger";
  return tone;
}

function toastTone(payload, text) {
  const explicit = safeTone(payload?.tone || payload?.kind || "", "");
  if (["danger", "bad", "error"].includes(explicit)) return "danger";
  if (["warn", "warning", "expense"].includes(explicit)) return "warn";
  if (["success", "great", "income", "profit"].includes(explicit)) return "success";
  if (/(失败|错误|异常|断开|失去连接)/.test(text)) return "danger";
  if (/(不足|无法|不能|不可|未解锁|请先|重复|忙碌)/.test(text)) return "warn";
  if (/(成功|完成|已|获得|领取|解锁)/.test(text)) return "success";
  return "info";
}

function floatAnchorSelector(payload, tone, text) {
  if (payload.anchor) return String(payload.anchor);
  if (/(声望)/.test(text)) return "#hudRepStat";
  if (/(经验|成就|\bAP\b)/i.test(text)) return "#playerCard";
  if (/[¥￥]|(income|expense|profit)/.test(tone)) return "#hudCashStat";
  return "";
}

function visibleAnchor(selector) {
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (element) {
    const rect = element.getBoundingClientRect?.();
    if (rect?.width > 0 && rect?.height > 0) return { element, rect };
  }
  if (selector === "#hudCashStat" || selector === "#hudRepStat") {
    const mobile = document.querySelector("#mobileResourcesToggle");
    const rect = mobile?.getBoundingClientRect?.();
    if (rect?.width > 0 && rect?.height > 0) return { element: mobile, rect };
  }
  return null;
}

function floatPosition(payload, selector, stack) {
  const anchor = visibleAnchor(selector);
  if (anchor) {
    const halfWidth = 72;
    const x = clampClient(anchor.rect.left + anchor.rect.width / 2, halfWidth, innerWidth - halfWidth);
    const y = clampClient(anchor.rect.bottom + 16 - Math.min(stack, 2) * 34, 44, innerHeight - 44);
    return { x: `${x}px`, y: `${y}px`, anchored: true };
  }
  const point = floatingPoint({ stack });
  return { x: `${point.x}%`, y: `${point.y}%`, anchored: false };
}

function removeFloat(node, key) {
  const timer = floatTimers.get(node);
  if (timer) clearTimeout(timer);
  floatTimers.delete(node);
  if (floatBursts.get(key)?.node === node) floatBursts.delete(key);
  node.remove();
}

function removeFloatNode(node) {
  const timer = floatTimers.get(node);
  if (timer) clearTimeout(timer);
  floatTimers.delete(node);
  for (const [key, burst] of floatBursts) {
    if (burst.node === node) {
      floatBursts.delete(key);
      break;
    }
  }
  node.remove();
}

function floatShouldBecomeToast(text, payload) {
  if (payload.forceFloat) return false;
  return Array.from(text).length > 18 || /[。！？；]/.test(text);
}

export function spawnFloatingText(payload) {
  const text = uiText(payload);
  const rawPayload = typeof payload === "object" && payload ? payload : {};
  // Balances update in the HUD; cash changes do not need another overlay.
  if (/[¥￥]\s*\d/.test(text)) {
    if (/(不足|失败|错误|无法|不能|异常)/.test(text)
      || ["warn", "warning", "danger", "bad", "error"].includes(rawPayload.tone)) {
      showToast({ ...rawPayload, text });
    }
    return;
  }
  const els = getEls();
  if (!text || !els?.floatingTextLayer) return;
  if (floatShouldBecomeToast(text, rawPayload)) {
    showToast({ ...rawPayload, text });
    return;
  }
  const tone = normalizedFloatTone(rawPayload.tone || rawPayload.kind || "info");
  const anchor = floatAnchorSelector(rawPayload, tone, text);
  const activeFloats = [...els.floatingTextLayer.querySelectorAll(".floating-text")];
  const laneCount = activeFloats.filter((entry) => entry.dataset.floatAnchor === anchor).length;
  const stack = Number.isFinite(Number(rawPayload.stack)) ? Number(rawPayload.stack) : laneCount;
  const key = `${anchor}|${tone}|${text}`;
  const now = Date.now();
  const burst = floatBursts.get(key);
  if (burst?.node?.isConnected && now - burst.at < FLOAT_MERGE_WINDOW) {
    burst.count += 1;
    burst.at = now;
    burst.node.textContent = `${text} ×${burst.count}`;
    burst.node.style.animation = "none";
    void burst.node.offsetWidth;
    burst.node.style.animation = "";
    const timer = floatTimers.get(burst.node);
    if (timer) clearTimeout(timer);
    floatTimers.set(burst.node, setTimeout(() => removeFloat(burst.node, key), 1300));
    return;
  }
  const point = floatPosition(rawPayload, anchor, stack);
  const node = document.createElement("div");
  node.className = `floating-text ${tone}${point.anchored ? " is-anchored" : ""}`;
  node.textContent = text;
  node.dataset.floatAnchor = anchor;
  node.style.setProperty("--float-x", point.x);
  node.style.setProperty("--float-y", point.y);
  els.floatingTextLayer.append(node);
  floatBursts.set(key, { node, count: 1, at: now });

  const nextFloats = [...els.floatingTextLayer.querySelectorAll(".floating-text")];
  for (const stale of nextFloats.slice(0, Math.max(0, nextFloats.length - MAX_FLOATS))) {
    removeFloatNode(stale);
  }
  node.addEventListener("animationend", () => removeFloat(node, key), { once: true });
  floatTimers.set(node, setTimeout(() => removeFloat(node, key), 1300));
  if (tone === "income" || tone === "expense") {
    pulse("#hudCashStat", tone === "expense" ? "gold" : "jade");
  }
  if (rawPayload.pulse) pulse(rawPayload.pulse, rawPayload.pulseTone || "jade");
}

// ===== 数值滚动动画 + 脉冲反馈（游戏化：让"钱变多/升级"有手感）=====
export function animateNumber(el, from, to, fmt) {
  if (!el) return;
  from = Number(from); to = Number(to);
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion || !Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const dur = 650, start = performance.now();
  (function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to);
  })(performance.now());
}

export function pulse(selector, tone = "jade") {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const cls = `pulse-${tone}`;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

function toastTitle(tone) {
  return ({
    success: "已完成",
    warn: "请注意",
    danger: "操作失败",
    info: "提示"
  })[tone] || "提示";
}

function toastIcon(tone) {
  return ({ success: "✓", warn: "!", danger: "×", info: "i" })[tone] || "i";
}

function dismissToast(node, { immediate = false } = {}) {
  if (!node?.isConnected) return;
  const timer = toastTimers.get(node);
  if (timer) clearTimeout(timer);
  toastTimers.delete(node);
  if (immediate) {
    node.remove();
    return;
  }
  node.classList.add("is-leaving");
  node.addEventListener("animationend", () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 260);
}

function scheduleToast(node, payload, tone) {
  const existing = toastTimers.get(node);
  if (existing) clearTimeout(existing);
  if (payload.sticky) return;
  const defaultDuration = tone === "danger" ? 6500 : tone === "warn" ? 5000 : 3200;
  const duration = clampClient(Number(payload.duration) || defaultDuration, 1800, 10000);
  toastTimers.set(node, setTimeout(() => dismissToast(node), duration));
}

export function showToast(message) {
  const payload = typeof message === "object" && message ? message : { text: message };
  const text = uiText(payload);
  if (!text) return;
  const host = getEls()?.toast || document.querySelector("#toast");
  if (!host) return;
  const now = Date.now();
  const tone = toastTone(payload, text);
  // Dedupe by visible meaning rather than transport id: the same action can arrive
  // once as a socket toast and once as a UI event with different ids.
  const key = String(payload.dedupeKey || `${tone}:${text}`);
  const existing = [...host.querySelectorAll(".toast-item")].find((entry) => (
    entry.dataset.toastKey === key && (payload.sticky || now - Number(entry.dataset.toastAt || 0) < TOAST_MERGE_WINDOW)
  ));
  if (existing) {
    existing.dataset.toastAt = String(now);
    if (payload.aggregate === true) {
      const count = Number(existing.dataset.toastCount || 1) + 1;
      existing.dataset.toastCount = String(count);
      const badge = existing.querySelector(".toast-count");
      if (badge) {
        badge.hidden = false;
        badge.textContent = `×${count}`;
      }
    }
    existing.classList.remove("is-leaving");
    scheduleToast(existing, payload, tone);
    return existing;
  }

  const node = document.createElement("div");
  node.className = `toast-item is-${tone}`;
  node.dataset.toastKey = key;
  node.dataset.toastCount = "1";
  node.dataset.toastAt = String(now);
  node.dataset.toastPriority = String(TOAST_PRIORITY[tone] ?? 0);
  node.dataset.toastSticky = payload.sticky ? "true" : "false";
  node.setAttribute("role", tone === "danger" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = toastIcon(tone);
  const actionable = typeof payload.onClick === "function";
  const copy = document.createElement(actionable ? "button" : "span");
  copy.className = actionable ? "toast-copy toast-action" : "toast-copy";
  if (actionable) {
    copy.type = "button";
    node.addEventListener("click", (event) => {
      if (!event.target.closest(".toast-close")) payload.onClick();
    });
  }
  const title = document.createElement("strong");
  title.textContent = payload.title && payload.title !== text ? payload.title : toastTitle(tone);
  const body = document.createElement("span");
  body.textContent = text;
  const count = document.createElement("span");
  count.className = "toast-count";
  count.hidden = true;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭提示");
  close.textContent = "×";
  close.addEventListener("click", () => dismissToast(node));
  copy.append(title, body);
  node.append(icon, copy, count);
  if (!payload.sticky || !actionable) node.append(close);
  host.append(node);

  const activeToasts = [...host.querySelectorAll(".toast-item")].filter(entry => entry.dataset.toastSticky !== "true");
  const overflow = Math.max(0, activeToasts.length - MAX_TOASTS);
  const staleToasts = [...activeToasts]
    .sort((a, b) => Number(a.dataset.toastPriority || 0) - Number(b.dataset.toastPriority || 0)
      || Number(a.dataset.toastAt || 0) - Number(b.dataset.toastAt || 0))
    .slice(0, overflow);
  for (const stale of staleToasts) {
    dismissToast(stale, { immediate: true });
  }
  scheduleToast(node, payload, tone);
  return node;
}
