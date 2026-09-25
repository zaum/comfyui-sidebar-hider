import { app } from "../../scripts/app.js";

// ComfyUI Sidebar Hider: right-click menu to hide toolbar icons + auto-hide mode.

const STYLE_ID = "sidebar-hider-style";
const MENU_ID = "sidebar-hider-menu";
const BACKDROP_ID = "sidebar-hider-backdrop";
const TOOLBAR_SELECTOR = 'nav[data-testid="side-toolbar"]';
const ITEM_SELECTOR = ".side-bar-button, .comfy-menu-button-wrapper";
const ID_ATTR = "data-hider-id";
const COLLAPSED_ATTR = "data-hider-collapsed";

const SETTING_ITEMS = "SidebarHider.hiddenItems";
const SETTING_AUTO_HIDE = "SidebarHider.autoHide";
const SETTING_ORDER = "SidebarHider.itemOrder";
const SIDEBAR_LOCATION_SETTING = "Comfy.Sidebar.Location";

const state = {
  hidden: new Set(),
  autoHide: false,
  collapsed: false,
  menu: null,
  pendingFrame: false,
  pendingEvent: null,
  order: { top: [], bottom: [] },
  natural: null,
  drag: null,
};

function getToolbar() {
  return document.querySelector(TOOLBAR_SELECTOR);
}

function sanitizeId(raw) {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}

function iconClassOf(el) {
  const icon = el.querySelector(".side-bar-button-icon");
  if (!icon) return null;
  for (const cls of icon.classList) {
    if (cls === "side-bar-button-icon" || cls === "pi") continue;
    return cls;
  }
  return null;
}

// Stable id, best source first. data-testid and icon classes do not
// depend on the UI language, aria-label is only a last resort.
function computeId(el, index) {
  const testid = el.getAttribute("data-testid");
  if (testid) return testid.toLowerCase();
  if (el.classList.contains("comfy-menu-button-wrapper")) return "comfy-menu-button";
  if (el.classList.contains("templates-tab-button")) return "templates-tab-button";
  const icon = iconClassOf(el);
  if (icon) return sanitizeId(icon);
  const aria = el.getAttribute("aria-label");
  if (aria) return sanitizeId(aria.replace(/\s*\([^)]*\)\s*$/, ""));
  return `item-${index}`;
}

function prettify(raw) {
  return String(raw || "")
    .replace(/-tab-button$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelFor(el) {
  const labelEl = el.querySelector(".side-bar-button-label");
  const visible = labelEl && labelEl.textContent ? labelEl.textContent.trim() : "";
  if (visible) return visible;
  const aria = el.getAttribute("aria-label");
  if (aria) {
    const cleaned = aria.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (cleaned) return cleaned;
  }
  const testid = el.getAttribute("data-testid");
  if (testid) return prettify(testid);
  if (el.classList.contains("comfy-menu-button-wrapper")) return "Menu";
  return prettify(el.getAttribute(ID_ATTR) || "Item");
}

function collectItems() {
  const nav = getToolbar();
  if (!nav) return [];
  const out = [];
  const seen = new Set();
  nav.querySelectorAll(ITEM_SELECTOR).forEach((el, index) => {
    let id = el.getAttribute(ID_ATTR) || computeId(el, index);
    if (seen.has(id)) return;
    seen.add(id);
    // Mirror the toolbar layout: top icon group vs bottom icon group
    // (the bottom group container carries the "mt-auto" class).
    const group = el.closest(".mt-auto") ? "bottom" : "top";
    out.push({ el, id, label: labelFor(el), group });
  });
  return out;
}

function stampIds() {
  const nav = getToolbar();
  if (!nav) return;
  const seen = new Set();
  nav.querySelectorAll(ITEM_SELECTOR).forEach((el, index) => {
    let id = computeId(el, index);
    if (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);
    if (el.getAttribute(ID_ATTR) !== id) el.setAttribute(ID_ATTR, id);
  });
  if (state.collapsed) nav.setAttribute(COLLAPSED_ATTR, "1");
}

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  return style;
}

function applyStyles() {
  const style = ensureStyle();
  const lines = [];
  lines.push(`${TOOLBAR_SELECTOR} { transition: max-width 0.25s ease, opacity 0.25s ease !important; }`);
  for (const id of state.hidden) {
    lines.push(`[${ID_ATTR}="${id}"] { display: none !important; }`);
  }
  lines.push(
    `${TOOLBAR_SELECTOR}[${COLLAPSED_ATTR}] { max-width: 0px !important; min-width: 0px !important; ` +
      `margin-left: 0px !important; margin-right: 0px !important; padding-left: 0px !important; ` +
      `padding-right: 0px !important; border: none !important; opacity: 0 !important; ` +
      `overflow: hidden !important; pointer-events: none !important; }`
  );
  lines.push(`#${BACKDROP_ID} { position: fixed; inset: 0; z-index: 10000; background: transparent; }`);
  lines.push(`#${MENU_ID} .sh-grip { flex: none; font-size: 13px; color: #fff; ` +
    `opacity: 0.8; cursor: grab; touch-action: none; }`);
  lines.push(`#${MENU_ID} .sh-row:hover .sh-grip { opacity: 1; }`);
  lines.push(`#${MENU_ID} .sh-row.sh-drag-src { opacity: 0.55; }`);
  lines.push(`body.sh-dragging, body.sh-dragging * { cursor: grabbing !important; user-select: none !important; }`);
  lines.push(`#${MENU_ID} { position: fixed; z-index: 10001; min-width: 230px; max-width: 300px; ` +
    `max-height: 70vh; overflow-y: auto; background: var(--comfy-menu-bg); color: var(--fg-color); ` +
    `border: 1px solid var(--border-color); border-radius: 8px; ` +
    `box-shadow: 0 8px 24px rgba(0,0,0,0.35); padding: 4px; font-size: 13px; }`);
  lines.push(`#${MENU_ID} .sh-action { display: block; width: 100%; text-align: left; font: inherit; font-weight: 400; color: inherit; ` +
    `background: transparent; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; }`);
  lines.push(`#${MENU_ID} .sh-action .sh-dim { opacity: 0.55; }`);
  lines.push(`#${MENU_ID} .sh-action:hover { background: var(--interface-panel-hover-surface); }`);
  lines.push(`#${MENU_ID} .sh-row { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 6px; cursor: grab; font-weight: 400; }`);
  lines.push(`#${MENU_ID} .sh-row:hover { background: var(--interface-panel-hover-surface); }`);
  lines.push(`#${MENU_ID} .sh-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`);
  lines.push(`#${MENU_ID} .sh-switch { flex: none; width: 24px; height: 14px; border-radius: 999px; background: var(--border-color); position: relative; transition: background 0.18s ease; cursor: pointer; }`);
  lines.push(`#${MENU_ID} .sh-switch.on { background: var(--fg-color); }`);
  lines.push(`#${MENU_ID} .sh-knob { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #8e8e8e; transition: left 0.18s ease; }`);
  lines.push(`#${MENU_ID} .sh-switch.on .sh-knob { left: 10px; background: var(--comfy-menu-bg); }`);
  lines.push(`#${MENU_ID} .sh-sep { height: 1px; margin: 4px; background: var(--border-color); opacity: 0.6; }`);
  lines.push(`#${MENU_ID} .sh-gap { height: 14px; }`);
  lines.push(`#${MENU_ID} .sh-reset { display: block; width: 100%; text-align: left; font: inherit; font-weight: 400; color: inherit; ` +
    `background: transparent; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; opacity: 0.55; }`);
  lines.push(`#${MENU_ID} .sh-reset:hover { background: var(--interface-panel-hover-surface); }`);
  style.textContent = lines.join("\n");
}

function getSetting(id, fallback) {
  try {
    const value = app.extensionManager?.setting?.get?.(id);
    return value === undefined || value === null ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

async function setSetting(id, value) {
  try {
    await app.extensionManager?.setting?.set?.(id, value);
  } catch (err) {
    console.warn("[SidebarHider] Could not save setting", id, err);
  }
}

function parseHidden(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch (err) {
    return [];
  }
}

async function setHidden(next) {
  state.hidden = new Set(next);
  applyStyles();
  await setSetting(SETTING_ITEMS, JSON.stringify([...state.hidden]));
}

async function setAutoHide(value) {
  state.autoHide = !!value;
  if (!state.autoHide) setCollapsed(false);
  await setSetting(SETTING_AUTO_HIDE, state.autoHide);
}

function setCollapsed(value) {
  state.collapsed = !!value;
  const nav = getToolbar();
  if (!nav) return;
  if (state.collapsed) nav.setAttribute(COLLAPSED_ATTR, "1");
  else nav.removeAttribute(COLLAPSED_ATTR);
}

function groupContainers() {
  const nav = getToolbar();
  if (!nav) return {};
  return {
    top: nav.querySelector(".sidebar-item-group:not(.mt-auto)"),
    bottom: nav.querySelector(".sidebar-item-group.mt-auto"),
  };
}

function parseOrder(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    const clean = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return { top: clean(parsed.top), bottom: clean(parsed.bottom) };
  } catch (err) {
    return { top: [], bottom: [] };
  }
}

// Remember the natural order once, before we ever move anything,
// so "Reset to defaults" can restore it.
function captureNatural() {
  if (state.natural) return;
  const items = collectItems();
  if (items.length === 0) return;
  state.natural = {
    top: items.filter((i) => i.group === "top").map((i) => i.id),
    bottom: items.filter((i) => i.group === "bottom").map((i) => i.id),
  };
}

// Enforce the stored order by moving DOM nodes. Compared first so a
// settled layout costs nothing (and cannot loop with the observer).
function applyOrder() {
  if (state.drag && state.drag.active) return;
  const { top, bottom } = groupContainers();
  if (!top || !bottom) return;
  const items = collectItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  // An id stored in EITHER group has a defined home already; only truly
  // unknown ids keep their current group. Checking just this group's array
  // would also claim items that are moving away, and the move would be
  // immediately undone by the other container.
  const known = new Set([...(state.order.top || []), ...(state.order.bottom || [])]);
  for (const [name, container] of [["top", top], ["bottom", bottom]]) {
    const stored = state.order[name] || [];
    const currentIds = items.filter((i) => i.group === name).map((i) => i.id);
    const desired = [
      ...stored.filter((id) => byId.has(id)),
      ...currentIds.filter((id) => !known.has(id)),
    ];
    const domOrder = [...container.querySelectorAll(`:scope > [${ID_ATTR}]`)]
      .map((el) => el.getAttribute(ID_ATTR));
    const same = desired.length === domOrder.length &&
      desired.every((id, k) => domOrder[k] === id);
    if (same) continue;
    for (const id of desired) {
      const entry = byId.get(id);
      if (entry) container.appendChild(entry.el);
    }
  }
}

async function resetAll() {
  closeMenu();
  await setHidden([]);
  await setAutoHide(false);
  if (state.natural) {
    state.order = { top: [...state.natural.top], bottom: [...state.natural.bottom] };
  } else {
    state.order = { top: [], bottom: [] };
  }
  await setSetting(SETTING_ORDER, JSON.stringify(state.order));
  applyOrder();
}

function menuItemRows(menu) {
  return [...menu.children].filter((el) => el.classList && el.classList.contains("sh-item"));
}

// Groups come from the divider: rows above .sh-gap belong to the top
// toolbar group, rows below it to the bottom group.
function readMenuOrder(menu) {
  const order = { top: [], bottom: [] };
  let side = "top";
  for (const child of menu.children) {
    if (child.classList.contains("sh-gap")) {
      side = "bottom";
      continue;
    }
    if (child.classList.contains("sh-item") && child.dataset.id) {
      order[side].push(child.dataset.id);
    }
  }
  return order;
}

async function persistOrderOnly() {
  await setSetting(SETTING_ORDER, JSON.stringify(state.order));
}

function onRowDragStart(event, row) {
  if (!state.menu || !state.menu.contains(row)) return;
  event.preventDefault();
  state.drag = {
    row,
    menu: state.menu,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  window.addEventListener("pointermove", onMenuDragMove, { passive: false });
  window.addEventListener("pointerup", onMenuDragEnd, { once: true });
  window.addEventListener("pointercancel", onMenuDragCancel, { once: true });
}

// Animate siblings from their old to their new position (FLIP:
// First, Last, Invert, Play). The dragged item and the gap itself
// are skipped so only the siblings slide.
function flipAnimate(container, mutator, skipEl) {
  const items = [...container.children].filter(
    (k) => k.hasAttribute && (k.hasAttribute(ID_ATTR) || k.classList.contains("sh-item")) && k !== skipEl
  );
  const before = new Map();
  for (const el of items) before.set(el, el.getBoundingClientRect().top);
  mutator();
  for (const el of items) {
    if (!el.isConnected) continue;
    const was = before.get(el);
    const now = el.getBoundingClientRect().top;
    const dy = was - now;
    if (!dy) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.style.transition = "transform 0.2s ease";
      el.style.transform = "";
      setTimeout(() => {
        if (el.isConnected) el.style.transition = "";
      }, 220);
    });
  }
}

function onMenuDragMove(event) {
  const d = state.drag;
  if (!d || !d.menu.isConnected) return;
  if (!d.active) {
    if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 5) return;
    d.active = true;
    d.row.classList.add("sh-drag-src");
    document.body.classList.add("sh-dragging");
  }
  if (event.cancelable) event.preventDefault();
  const rows = menuItemRows(d.menu).filter((r) => r !== d.row);
  let ref = null;
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      ref = r;
      break;
    }
  }
  // Skip moves that would not change the item sequence.
  const movingId = d.row.dataset.id;
  const currentIds = menuItemRows(d.menu).map((r) => r.dataset.id);
  const rest = currentIds.filter((id) => id !== movingId);
  const refId = ref ? ref.dataset.id : null;
  const at = refId === null ? rest.length : rest.indexOf(refId);
  const desired = [...rest.slice(0, at), movingId, ...rest.slice(at)];
  if (desired.join("|") === currentIds.join("|")) return;
  flipAnimate(d.menu, () => {
    d.menu.insertBefore(d.row, ref);
  });
  // Mirror the new order live on the toolbar behind the menu.
  state.order = readMenuOrder(d.menu);
  applyOrder();
}

function finishMenuDrop() {
  const d = state.drag;
  if (!d) return;
  window.removeEventListener("pointermove", onMenuDragMove);
  window.removeEventListener("pointerup", onMenuDragEnd);
  window.removeEventListener("pointercancel", onMenuDragCancel);
  state.drag = null;
  document.body.classList.remove("sh-dragging");
  if (d.row.isConnected) d.row.classList.remove("sh-drag-src");
  // Plain click on the grip (no movement): the row click handler
  // consumes the armed flag and ignores this click.
  if (!d.active) return;
  // Swallow the click that follows a real drag.
  const stop = (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", stop, true);
  setTimeout(() => window.removeEventListener("click", stop, true), 50);
  if (d.menu.isConnected) {
    state.order = readMenuOrder(d.menu);
    applyOrder();
    persistOrderOnly();
  }
}

function onMenuDragEnd() {
  finishMenuDrop();
}

function onMenuDragCancel() {
  finishMenuDrop();
}

// The content panel only exists while a sidebar tab is open.
function isPanelOpen() {
  const panel = document.querySelector(".sidebar-content-container");
  if (!panel) return false;
  if (panel.childElementCount === 0) return false;
  return panel.getBoundingClientRect().width > 0;
}

function sidebarSide() {
  try {
    const side = getSetting(SIDEBAR_LOCATION_SETTING, "left");
    return side === "right" ? "right" : "left";
  } catch (err) {
    return "left";
  }
}

function updateAutoHide(event) {
  if (!state.autoHide) {
    setCollapsed(false);
    return;
  }
  if (isPanelOpen() || state.menu) {
    setCollapsed(false);
    return;
  }
  const side = sidebarSide();
  const nearEdge = side === "right"
    ? event.clientX >= window.innerWidth - 6
    : event.clientX <= 6;
  if (nearEdge) {
    setCollapsed(false);
    return;
  }
  const nav = getToolbar();
  if (nav && nav.matches(":hover")) {
    setCollapsed(false);
    return;
  }
  setCollapsed(true);
}

function onMouseMove(event) {
  state.pendingEvent = event;
  if (state.pendingFrame) return;
  state.pendingFrame = true;
  requestAnimationFrame(() => {
    state.pendingFrame = false;
    const evt = state.pendingEvent;
    if (evt) updateAutoHide(evt);
  });
}

function closeMenu() {
  if (state.menu) {
    state.menu.remove();
    state.menu = null;
  }
  const backdrop = document.getElementById(BACKDROP_ID);
  if (backdrop) backdrop.remove();
}

function addSeparator(menu) {
  const sep = document.createElement("div");
  sep.className = "sh-sep";
  menu.appendChild(sep);
}

function addToggleRow(menu, label, checked, onChange, options) {
  const row = document.createElement("div");
  row.className = "sh-row";
  row.setAttribute("role", "menuitemcheckbox");
  if (options && options.id) {
    row.classList.add("sh-item");
    row.dataset.id = options.id;
  }
  let on = !!checked;
  const text = document.createElement("span");
  text.className = "sh-text";
  text.textContent = label;
  const track = document.createElement("span");
  track.className = "sh-switch";
  const knob = document.createElement("span");
  knob.className = "sh-knob";
  track.appendChild(knob);
  const paint = () => {
    track.classList.toggle("on", on);
    row.setAttribute("aria-checked", on ? "true" : "false");
  };
  paint();
  if (options && options.draggable) {
    const grip = document.createElement("i");
    grip.className = "sh-grip icon-[lucide--grip-vertical]";
    grip.setAttribute("aria-hidden", "true");
    row.prepend(grip);
    // The whole row (except the switch) starts a drag.
    row.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest(".sh-switch")) return;
      onRowDragStart(e, row);
    });
  }
  row.appendChild(text);
  row.appendChild(track);
  row.addEventListener("click", () => {
    on = !on;
    paint();
    onChange(on, () => {
      on = !on;
      paint();
    });
  });
  menu.appendChild(row);
  return row;
}

function openMenu(x, y, targetId) {
  closeMenu();
  const items = collectItems();
  const target = items.find((i) => i.id === targetId) || null;
  const visibleCount = items.filter((i) => !state.hidden.has(i.id)).length;

  // Transparent layer behind the menu: any click outside reliably closes it.
  const backdrop = document.createElement("div");
  backdrop.id = BACKDROP_ID;
  backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closeMenu();
  });
  backdrop.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeMenu();
  });
  document.body.appendChild(backdrop);

  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.setAttribute("role", "menu");
  menu.addEventListener("contextmenu", (e) => e.preventDefault());

  // Only offer hiding when at least one other icon stays visible.
  if (target && visibleCount > 1) {
    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "sh-action";
    const dimWord = document.createElement("span");
    dimWord.className = "sh-dim";
    dimWord.textContent = "Hide ";
    hideBtn.appendChild(dimWord);
    hideBtn.appendChild(document.createTextNode(target.label));
    hideBtn.addEventListener("click", async () => {
      closeMenu();
      await setHidden([...state.hidden, target.id]);
    });
    menu.appendChild(hideBtn);
    addSeparator(menu);
  }

  let lastGroup = null;
  for (const item of items) {
    if (lastGroup !== null && item.group !== lastGroup) {
      const gap = document.createElement("div");
      gap.className = "sh-gap";
      menu.appendChild(gap);
    }
    lastGroup = item.group;
    addToggleRow(menu, item.label, !state.hidden.has(item.id), (checked, revert) => {
      const next = new Set(state.hidden);
      if (checked) {
        next.delete(item.id);
      } else {
        next.add(item.id);
        // Always keep at least one icon visible.
        if (!items.some((it) => !next.has(it.id))) {
          revert();
          return;
        }
      }
      setHidden([...next]);
    }, { id: item.id, draggable: true });
  }

  addSeparator(menu);
  addToggleRow(menu, "Auto-hide toolbar", state.autoHide, (checked) => {
    setAutoHide(checked);
  });
  addSeparator(menu);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "sh-reset";
  resetBtn.textContent = "Reset to defaults";
  resetBtn.addEventListener("click", resetAll);
  menu.appendChild(resetBtn);

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  state.menu = menu;
}

function onContextMenu(event) {
  if (state.menu && state.menu.contains(event.target)) return;
  const nav = event.target && event.target.closest ? event.target.closest(TOOLBAR_SELECTOR) : null;
  if (!nav) {
    if (state.menu) closeMenu();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const btn = event.target && event.target.closest ? event.target.closest(ITEM_SELECTOR) : null;
  const targetId = btn ? btn.getAttribute(ID_ATTR) : null;
  openMenu(event.clientX, event.clientY, targetId);
}

function onPointerDown(event) {
  if (state.menu && !state.menu.contains(event.target)) closeMenu();
}

function onKeyDown(event) {
  if (event.key === "Escape") closeMenu();
}

let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    stampIds();
    // Late renders can bring the first real toolbar: capture the natural
    // order then, so Reset always has something to restore.
    captureNatural();
    applyOrder();
  }, 120);
}

let initialized = false;
function init() {
  if (initialized) return;
  initialized = true;
  state.hidden = new Set(parseHidden(getSetting(SETTING_ITEMS, "[]")));
  state.order = parseOrder(getSetting(SETTING_ORDER, "{}"));
  state.autoHide = !!getSetting(SETTING_AUTO_HIDE, false);
  ensureStyle();
  applyStyles();
  stampIds();
  captureNatural();
  applyOrder();

  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("mousedown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  document.addEventListener("mousemove", onMouseMove, { passive: true });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

app.registerExtension({
  name: "SidebarHider",
  settings: [
    {
      id: SETTING_AUTO_HIDE,
      name: "Auto-hide toolbar",
      type: "boolean",
      defaultValue: false,
      category: ["Sidebar Hider", "General", "Auto-hide toolbar"],
      tooltip: "Slide the left toolbar off-screen; it returns when the mouse reaches the screen edge.",
      onChange: (value) => {
        state.autoHide = !!value;
        if (!state.autoHide) setCollapsed(false);
      },
    },
    {
      id: SETTING_ITEMS,
      name: "Hidden sidebar icons",
      type: "hidden",
      defaultValue: "[]",
      onChange: (value) => {
        state.hidden = new Set(parseHidden(value));
        applyStyles();
      },
    },
    {
      id: SETTING_ORDER,
      name: "Sidebar icon order",
      type: "hidden",
      defaultValue: "{}",
      onChange: (value) => {
        state.order = parseOrder(value);
        applyOrder();
      },
    },
  ],
  async setup() {
    init();
  },
});
