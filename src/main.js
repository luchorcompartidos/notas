import './styles.css';
import { hydrateIcons, icon } from './icons.js';
import { requestPersistence } from './store.js';
import {
  createEditor, runCommand, isActive, summarize, compressImage, makeThumb,
  refreshReminderMarks, currentTaskItem, taskItems, checkTaskItem, compressDataUrl, noteLinks, contentExtensions,
  tableContext, setCellsAttrs, insertTable, runTableCommand, ALIGN_H, ALIGN_V,
  tableSizes, setColumnWidth, setColumnsMode, setRowHeight, setRowsMode,
  copyTablePart, insertCopied, duplicateTablePart, getTableClip, CELL_BG, sortTable, placeCursorAt,
  needsTrailingParagraph, writeAtEnd, needsLeadingParagraph, writeAtStart,
  selState, cellAtDom, startSelection, endSelection, updateSelection, selectionInfo, selApplyAttrs, selCommonAttrs,
  selToggleMark, selClear, selCopy, selPaste, selDeleteLines, getCellClip,
} from './editor.js';
import { colName, listText } from './seleccion.js';
import * as Y from 'yjs';
import { generateHTML, generateJSON } from '@tiptap/core';
import {
  toText, toMarkdown, toDocx, toPdf, toBackup, deliverFile, safeName, readImport, resolveImages,
  toWhatsApp, noteImages, shareMessage, shareFile,
} from './transfer.js';
import { verifyUser } from './lock.js';
import { notifyNow } from './reminders.js';
import { getPreview, domainOf, previewsEnabled, setPreviewsEnabled } from './links.js';
import {
  REPEATS, SNOOZE_MIN, nextOccurrence, formatWhen, initNativeReminders, ensureNativePermissions,
  syncNative, syncWeb, askWebNotifications, showWebNotification,
} from './reminders.js';
import { initNative, setStatusBar, haptic, minimizeApp, isNative, listenIntents, clipboardWrite, clipboardRead, hideKeyboard } from './native.js';
import { APP_VERSION, CHANGELOG_URL, getLatestRelease, isNewer, formatDate } from './version.js';
import { applyTextDiff, pendingList, flushNote, lastVerified } from './sync.js';
import { CloudRepo, LocalRepo, orgId } from './repo.js';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import {
  fb, watchAuth, signInGoogle, signOutUser, authErrorMessage, errorDetail, reauthUser,
  signInEmail, signUpEmail, sendVerification, resetPassword, refreshUser, setDisplayName, linkPassword, unlinkPassword,
  finishPasswordOnly, relinkGoogle, googleSessionBlocked, changePassword, passwordProblem, hasGoogle, hasPassword, passwordEmail, passwordVerified,
} from './firebase.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

const COLORS = [
  ['default', 'Predeterminado'], ['coral', 'Coral'], ['peach', 'Durazno'], ['sand', 'Arena'],
  ['mint', 'Menta'], ['sage', 'Salvia'], ['fog', 'Niebla'], ['storm', 'Tormenta'],
  ['dusk', 'Atardecer'], ['blossom', 'Flor'],
];

const state = {
  mode: null, user: null, repo: null, notes: [], current: null,
  view: 'login', pushed: false, release: null, firstList: true,
  org: { folders: [], labels: [], settings: { trashDays: 30 }, settingsLoaded: false },
  filter: { kind: 'notes' },
  selection: new Set(),
  expanded: new Set(JSON.parse(localStorage.getItem('notas-expanded') || '[]')),
  purged: false,
  search: { active: false, q: '', folder: null, label: null, color: null, checks: null, days: null, archived: false, noHidden: false },
  layout: localStorage.getItem('notas-layout') || 'grid',
  reminders: [],
  invites: [],
  unlocked: new Set(),
  requests: [],
};

const SORTS = [['updated', 'Fecha de modificación'], ['created', 'Fecha de creación'], ['title', 'Título (A-Z)'], ['manual', 'Manual (arrastrar)']];

const LABEL_COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#6D4C41', '#757575'];
const TRASH_OPTIONS = [[7, '7 días'], [15, '15 días'], [30, '30 días'], [60, '60 días'], [90, '90 días'], [0, 'Nunca (vaciar a mano)']];
let editor = null;
let summaryTimer;
let openToken = 0;
let lockTimer;

/* ---------- Tema (sistema / claro / oscuro) ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const themePref = () => localStorage.getItem('notas-theme') || 'system';

function applyTheme() {
  const pref = themePref();
  const dark = pref === 'dark' || (pref === 'system' && mq.matches);
  root.dataset.scheme = dark ? 'dark' : 'light';
  syncBars();
}
mq.addEventListener?.('change', applyTheme);

function toHex(rgb) {
  const m = rgb.match(/\d+/g);
  if (!m) return '#000000';
  return `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function syncBars() {
  const view = $(`#view-${state.view}`) || $('#view-list');
  const hex = toHex(getComputedStyle(view).backgroundColor);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', hex);
  setStatusBar(hex, root.dataset.scheme === 'dark');
}

/* ---------- Efecto "ripple" de Material ---------- */
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ripple');
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const w = document.createElement('span');
  w.className = 'ripple-wave';
  w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(w);
  setTimeout(() => w.remove(), 550);
});

/* ---------- Snackbar ---------- */
let snackTimer;
function snackbar(text, actionLabel, onAction) {
  $('#snack-text').textContent = text;
  const btn = $('#snack-action');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideSnack(); onAction?.(); };
  $('#snackbar').classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, actionLabel ? 5000 : 3200);
}
function hideSnack() { $('#snackbar').classList.remove('show'); }

/* ---------- Menú, hoja inferior y fondo oscuro ---------- */
function openMenu(anchor, items) {
  const menu = $('#menu');
  menu.classList.remove('cell-menu');
  menu.innerHTML = '';
  items.forEach((it) => {
    if (it.divider) { menu.insertAdjacentHTML('beforeend', '<div class="menu-divider"></div>'); return; }
    const b = document.createElement('button');
    b.className = 'menu-item ripple';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    b.innerHTML = `<span class="menu-check">${it.checked ? icon('check') : ''}</span><span>${it.label}</span>`;
    b.onclick = () => { closeOverlays(); it.onClick?.(); };
    menu.appendChild(b);
  });
  menu.hidden = false;
  placePopup(menu, anchor.getBoundingClientRect());
  requestAnimationFrame(() => menu.classList.add('open'));
  $('#scrim').classList.add('show', 'clear');
}

// Ubica un menú junto a su botón sin salirse nunca de la pantalla (ni por los costados ni abajo).
function placePopup(el, r) {
  const m = 8;
  const vw = window.innerWidth; const vh = window.innerHeight;
  Object.assign(el.style, { left: '0px', top: '0px', right: 'auto', bottom: 'auto', maxWidth: `${vw - m * 2}px`, maxHeight: `${Math.min(vh * 0.7, vh - m * 2)}px` });
  const w = el.offsetWidth; const h = el.offsetHeight;
  // Alineado al lado del botón que queda más cerca del centro de la pantalla
  let left = (r.left + r.width / 2) < vw / 2 ? r.left : r.right - w;
  left = Math.max(m, Math.min(left, vw - w - m));
  let top = r.bottom + 4;
  let fromTop = true;
  if (top + h > vh - m) {
    if (r.top - h - 4 >= m) { top = r.top - h - 4; fromTop = false; } else top = Math.max(m, vh - h - m);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transformOrigin = `${left <= r.left + 1 ? 'left' : 'right'} ${fromTop ? 'top' : 'bottom'}`;
}

function openSheet(html, onReady) {
  $('#sheet-body').innerHTML = html;
  hydrateIcons($('#sheet-body'));
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.remove('clear');
  $('#scrim').classList.add('show');
  onReady?.($('#sheet-body'));
}

function closeOverlays() {
  let closed = false;
  const menu = $('#menu');
  if (!menu.hidden) { menu.classList.remove('open'); menu.hidden = true; closed = true; }
  if ($('#sheet').classList.contains('open')) {
    $('#sheet').classList.remove('open');
    $('#sheet').setAttribute('aria-hidden', 'true');
    closed = true;
  }
  if ($('#drawer').classList.contains('open')) {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    closed = true;
  }
  if (!$('#dialog').hidden) { closeDialog(null); closed = true; }
  $('#scrim').classList.remove('show', 'clear');
  return closed;
}
$('#scrim').addEventListener('click', () => { if (Date.now() - cellMenuAt > 400) closeOverlays(); });

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Vistas ---------- */
function setView(view) {
  state.view = view;
  ['login', 'list', 'editor'].forEach((v) => $(`#view-${v}`).classList.toggle('active', v === view));
  $('#view-list').classList.toggle('behind', view === 'editor');
  document.body.classList.toggle('editor-open', view === 'editor'); // respaldo de :has() en WebView viejas
  syncBars();
}

/* ---------- Estado de sincronización ---------- */
// Estado general: conexión real con el servidor, cambios sin subir y errores
function syncSummary() {
  const repo = state.repo;
  if (state.mode !== 'cloud' || !repo) return { kind: 'local' };
  const pendingNotes = pendingList(state.user.uid).length;
  const writing = (repo.pending || 0) + (state.current?.status?.pending || 0);
  const offline = !navigator.onLine || (!repo.connected && Date.now() - (state.startedAt || 0) > 6000);
  if (repo.error && repo.failed?.size) return { kind: 'error', code: repo.error.code, pendingNotes };
  if (offline) return { kind: 'offline', pendingNotes, lastServerAt: repo.lastServerAt };
  if (writing || pendingNotes) return { kind: 'syncing', pendingNotes };
  return { kind: 'ok', lastServerAt: repo.lastServerAt };
}

const ago = (t) => {
  if (!t) return 'nunca';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'hace instantes';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return formatDate(new Date(t).toISOString());
};

function updateSyncIcon() {
  const btn = $('#btn-sync');
  const st = syncSummary();
  const map = {
    local: ['phone', 'Sin cuenta: notas solo en este dispositivo'],
    error: ['error', `Error de sincronización (${st.code || 'desconocido'})`],
    offline: ['cloudOff', st.pendingNotes ? `Sin conexión: ${st.pendingNotes} nota${st.pendingNotes > 1 ? 's' : ''} con cambios por subir` : 'Sin conexión con el servidor'],
    syncing: ['cloudUp', st.pendingNotes ? `Subiendo cambios de ${st.pendingNotes} nota${st.pendingNotes > 1 ? 's' : ''}…` : 'Sincronizando…'],
    ok: ['cloudDone', 'Todo sincronizado'],
  };
  const [name, label] = map[st.kind];
  btn.innerHTML = icon(name);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.classList.toggle('warn', st.kind === 'error' || st.kind === 'offline');

  // Aviso visible en la lista cuando no hay conexión real o hay un error
  const banner = $('#sync-banner');
  if (st.kind === 'offline' || st.kind === 'error') {
    $('#sync-banner-text').textContent = st.kind === 'error'
      ? `Error de sincronización (${st.code || 'desconocido'}). Lo que ves puede no estar actualizado.`
      : `Sin conexión con el servidor: lo que ves puede no estar actualizado${st.pendingNotes ? ` y hay cambios de ${st.pendingNotes} nota${st.pendingNotes > 1 ? 's' : ''} por subir` : ''}.`;
    banner.hidden = false;
  } else banner.hidden = true;
}

// Al pie de la nota: si lo que se ve está verificado con el servidor, y si tus cambios ya se subieron
function updateNoteStatus() {
  const c = state.current;
  if (!c) return;
  const el = $('#sync-state');
  let text = 'Guardado en este dispositivo'; let warn = false;
  if (state.mode === 'cloud') {
    const st = c.status || {};
    const general = syncSummary();
    const offline = general.kind === 'offline' || (st.verified && st.fromCache && !navigator.onLine);
    if (st.error) { text = `⚠️ Error de sincronización (${st.error.code || 'desconocido'}) · Reintentar`; warn = true; }
    else if (offline || (st.fromCache && st.verified)) {
      warn = true;
      text = st.verified
        ? `⚠️ Sin conexión: puede haber cambios de otros dispositivos que todavía no ves${st.pending ? '; los tuyos se suben al reconectar' : ''}`
        : `⚠️ Sin conexión: estás viendo la copia de este dispositivo (verificada ${ago(st.lastServerAt || lastVerified(c.id))})`;
    } else if (!st.verified) text = 'Verificando la última versión…';
    else if (st.pending) text = 'Subiendo tus cambios…';
    else text = 'Actualizada con el servidor ✓';
  }
  el.textContent = text;
  el.classList.toggle('warn', warn);
  el.disabled = state.mode !== 'cloud';
  const by = c.updatedByName && c.updatedBy && c.updatedBy !== state.user?.uid ? ` por ${c.updatedByName}` : '';
  $('#edited').textContent = c.updated && !c.isNew ? ` · Editado ${formatDate(new Date(c.updated).toISOString())}${by}` : '';
  updateSyncIcon();
}
window.addEventListener('online', () => { updateSyncIcon(); updateNoteStatus(); });
window.addEventListener('offline', () => { updateSyncIcon(); updateNoteStatus(); });

/* ---------- Carpetas y etiquetas: ayudas ---------- */
const noteById = (id) => state.notes.find((n) => n.id === id);
const folderById = (id) => state.org.folders.find((f) => f.id === id);
const labelById = (id) => state.org.labels.find((l) => l.id === id);
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
const childrenOf = (parentId) => state.org.folders.filter((f) => (f.parentId || null) === (parentId || null)).sort(byName);

function descendantsOf(id, seen = new Set()) {
  childrenOf(id).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); descendantsOf(c.id, seen); } });
  return [...seen];
}

function folderPath(id) {
  const parts = []; const seen = new Set();
  let f = folderById(id);
  while (f && !seen.has(f.id)) { seen.add(f.id); parts.unshift(f.name || 'Sin nombre'); f = f.parentId ? folderById(f.parentId) : null; }
  return parts.join(' › ');
}

// Árbol de carpetas aplanado (para listas con sangría)
function folderTree(parentId = null, depth = 0, out = []) {
  childrenOf(parentId).forEach((f) => { out.push({ ...f, depth }); folderTree(f.id, depth + 1, out); });
  return out;
}

const noteFolders = (n) => (n?.folders || []).filter((id) => folderById(id));
const noteLabels = (n) => (n?.labels || []).filter((id) => labelById(id));

/* ---------- Vistas de la lista (Notas, carpeta, etiqueta, Archivo, Papelera) ---------- */
function matchesFilter(n, f = state.filter) {
  if (f.kind === 'templates') return !!n.template && !n.trashed;
  if (n.template && f.kind !== 'trash') return false;
  switch (f.kind) {
    case 'reminders': return !n.trashed && activeReminders(n.id).length > 0;
    case 'shared': return !n.trashed && !n.archived && !!n.owner && n.owner !== state.user?.uid;
    case 'archive': return n.archived && !n.trashed;
    case 'trash': return n.trashed;
    case 'folder': return !n.trashed && !n.archived && (n.folders || []).includes(f.id);
    case 'label': return !n.trashed && !n.archived && (n.labels || []).includes(f.id);
    // Las notas ocultas (a mano o por reglas) solo faltan en la vista principal de Notas
    default: return !n.trashed && !n.archived && !n.hidden && (rulesPeek || !hiddenByRules(n));
  }
}

/* ---------- Ocultar/mostrar por reglas (solo la pantalla principal) ----------
 * settings/prefs.hideRules = { on, mode: 'hide'|'show', combine: 'any'|'all', keepPinned, rules: [...] }
 * Se guarda siempre el objeto entero (rules es un arreglo: Firestore lo reemplaza, no lo fusiona). */
const RULE_TYPES = [
  ['label', 'Etiqueta', 'label'], ['folder', 'Carpeta', 'folder'], ['color', 'Color de la nota', 'palette'],
  ['shared', 'Compartidas', 'people'], ['unorg', 'Sin organizar', 'removeFolder'], ['complete', 'Listas completas', 'checklist'],
  ['age', 'Antigüedad', 'history'], ['locked', 'Bloqueadas con huella', 'lock'], ['template', 'Creadas desde una plantilla', 'template'],
];
const RULES_DEFAULT = { on: true, mode: 'hide', combine: 'any', keepPinned: true, rules: [], view: null, loose: null };
let rulesMemo = null;
// «Mostrar» del aviso de la pantalla principal: se ven las ocultas por reglas hasta tocar «Ocultar» (no se guarda)
let rulesPeek = false;

function rulesCfg() {
  const r = state.org.settings.hideRules || {};
  return { ...RULES_DEFAULT, ...r, rules: Array.isArray(r.rules) ? r.rules : [] };
}

/* Vistas con nombre (v0.3.3): settings/prefs.hideViews = [{ id, name, cfg: { mode, combine, keepPinned, rules } }]
 * hideRules.view = id de la vista elegida (sus cambios se guardan solos en la vista);
 * hideRules.loose = las reglas sin nombre, guardadas al elegir una vista, para volver con «Sin vista». */
const ruleCore = (c) => {
  const x = { ...RULES_DEFAULT, ...(c || {}) };
  return { mode: x.mode === 'show' ? 'show' : 'hide', combine: x.combine === 'all' ? 'all' : 'any', keepPinned: !!x.keepPinned, rules: Array.isArray(x.rules) ? x.rules : [] };
};
function hideViewsList() {
  const v = state.org.settings.hideViews;
  return Array.isArray(v) ? v.filter((x) => x && x.id) : [];
}
const activeView = (cfg = rulesCfg()) => (cfg.view ? hideViewsList().find((v) => v.id === cfg.view) || null : null);
const newViewId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Guarda las reglas (y las vistas). Con una vista elegida, sus reglas se copian solas en esa vista.
function saveRules(c, views = hideViewsList()) {
  const v = { on: !!c.on, ...ruleCore(c), view: c.view || null, loose: c.loose ? ruleCore(c.loose) : null };
  if (v.view && !views.some((x) => x.id === v.view)) v.view = null; // la borraron en otro dispositivo
  const list = views.map((x) => (x.id === v.view ? { ...x, cfg: ruleCore(v) } : x));
  state.repo.saveSettings({ hideRules: v, hideViews: list });
  state.org.settings.hideRules = v;
  state.org.settings.hideViews = list;
  rulesMemo = null;
  renderList(); renderDrawer();
}

// Elegir una vista (id) o volver a las reglas sin nombre (null)
function applyView(id, { undo = true } = {}) {
  const c = rulesCfg();
  if ((c.view || null) === (id || null)) return;
  const prev = JSON.parse(JSON.stringify(c));
  let next;
  if (id) {
    const v = hideViewsList().find((x) => x.id === id);
    if (!v) return;
    next = { ...ruleCore(v.cfg), on: true, view: id, loose: c.view ? c.loose : ruleCore(c) };
  } else next = { ...ruleCore(c.loose), on: c.on, view: null, loose: null };
  saveRules(next);
  const name = activeView()?.name;
  if (undo) snackbar(name ? `Vista «${name}»` : 'Sin vista: reglas sin nombre', 'Deshacer', () => saveRules(prev));
}

// La regla tiene efecto (las etiquetas/carpetas borradas no cuentan)
function ruleActive(r) {
  switch (r?.type) {
    case 'label': return (r.ids || []).some((id) => labelById(id));
    case 'folder': return (r.ids || []).some((id) => folderById(id));
    case 'color': return !!r.colors?.length;
    case 'shared': return state.mode === 'cloud' && (r.who !== 'owner' || !!r.owner);
    case 'unorg': return ['folder', 'label', 'both'].includes(r.what);
    case 'age': return Number(r.days) > 0;
    case 'complete': case 'locked': case 'template': return true;
    default: return false;
  }
}

// Carpeta: conjunto con las elegidas (y sus subcarpetas, si se pidió)
const withSet = (r) => (r.type === 'folder'
  ? { ...r, set: new Set((r.ids || []).filter((id) => folderById(id)).flatMap((id) => (r.sub ? [id, ...descendantsOf(id)] : [id]))) }
  : r);

function rulesCtx() {
  const cfg = rulesCfg();
  const key = `${JSON.stringify(cfg)}|${state.org.folders.length}|${state.org.labels.length}|${state.user?.uid || ''}|${state.mode}`;
  if (rulesMemo?.key === key) return rulesMemo;
  const rules = cfg.on ? cfg.rules.filter(ruleActive).map(withSet) : [];
  rulesMemo = { key, cfg, rules, now: Date.now() };
  return rulesMemo;
}

function ruleMatch(r, n, now = Date.now()) {
  switch (r.type) {
    case 'label': return (n.labels || []).some((id) => r.ids.includes(id));
    case 'folder': return (n.folders || []).some((id) => (r.set ? r.set.has(id) : r.ids.includes(id)));
    case 'color': return r.colors.includes(n.color || 'default');
    case 'shared': {
      const other = !!n.owner && n.owner !== state.user?.uid;
      if (r.who === 'withMe') return other;
      if (r.who === 'owner') return n.owner === r.owner;
      if (r.who === 'byMe') return !other && (n.memberIds || []).length > 1;
      return !other; // 'mine': solo las mías
    }
    case 'unorg': {
      const nf = !noteFolders(n).length; const nl = !noteLabels(n).length;
      return r.what === 'folder' ? nf : r.what === 'label' ? nl : nf && nl;
    }
    case 'complete': return !!n.checks?.total && n.checks.done === n.checks.total;
    case 'age': return (n.updated || n.created || 0) < now - Number(r.days) * 86400000;
    case 'locked': return !!n.locked;
    case 'template': return !!n.fromTemplate && (!r.ids?.length || r.ids.includes(n.fromTemplate));
    default: return false;
  }
}

// ¿La regla (o el conjunto) la saca de la pantalla principal?
function hiddenByRules(n, c = rulesCtx()) {
  if (!c.rules.length) return false;
  if (c.cfg.keepPinned && n.pinned) return false;
  const hit = c.cfg.combine === 'all' ? c.rules.every((r) => ruleMatch(r, n, c.now)) : c.rules.some((r) => ruleMatch(r, n, c.now));
  return c.cfg.mode === 'show' ? !hit : hit;
}

// Notas que irían a la pantalla principal si no hubiera reglas
const mainCandidates = () => state.notes.filter((n) => !n.trashed && !n.archived && !n.hidden && !n.template);

function filterTitle(f = state.filter) {
  if (f.kind === 'archive') return 'Archivo';
  if (f.kind === 'templates') return 'Plantillas';
  if (f.kind === 'reminders') return 'Recordatorios';
  if (f.kind === 'shared') return 'Compartidas conmigo';
  if (f.kind === 'trash') return 'Papelera';
  if (f.kind === 'folder') return folderPath(f.id) || 'Carpeta';
  if (f.kind === 'label') return labelById(f.id)?.name || 'Etiqueta';
  return 'Notas';
}

function setFilter(f) {
  if (f.kind === 'folder' && !folderById(f.id)) f = { kind: 'notes' };
  if (f.kind === 'label' && !labelById(f.id)) f = { kind: 'notes' };
  state.filter = f;
  clearSelection();
  closeOverlays();
  $('#list-scroll').scrollTop = 0;
  renderList();
  renderDrawer();
}

/* ---------- Lista ---------- */
function onList(list) {
  state.notes = list;
  const c = state.current;
  if (c) {
    const n = list.find((x) => x.id === c.id);
    if (n) {
      Object.assign(c, {
        color: n.color, pinned: n.pinned, updated: n.updated, folders: n.folders || [], labels: n.labels || [],
        archived: !!n.archived, trashed: !!n.trashed, hidden: !!n.hidden, updatedBy: n.updatedBy, updatedByName: n.updatedByName,
      });
      paintEditorChrome();
    }
  }
  renderList();
  if (state.firstList && state.repo?.serverLoaded) {
    state.firstList = false;
    maybeWelcome();
    openFromHash();
  }
  checkGranted(list);
  maybePurge();
  scheduleReminders();
  if (pendingOpenNote && list.some((n) => n.id === pendingOpenNote)) { const id = pendingOpenNote; pendingOpenNote = null; openNote(id); }
  if (pendingIntents.length && state.repo?.serverLoaded) setTimeout(flushIntents, 50);
  if (state.repo?.serverLoaded && !state.pendingFlushed) { state.pendingFlushed = true; setTimeout(() => flushPendingNotes(), 1500); }
}

function onOrg(org) {
  state.org = org;
  if (state.filter.kind === 'folder' && !folderById(state.filter.id)) state.filter = { kind: 'notes' };
  if (state.filter.kind === 'label' && !labelById(state.filter.id)) state.filter = { kind: 'notes' };
  renderDrawer();
  renderList();
  paintEditorChrome();
  maybePurge();
  maybeSecurityTip();
}

function sortNotes(list) {
  if (state.filter.kind === 'reminders' && !state.search.active) {
    return [...list].sort((a, b) => (nextOf(a.id)?.t || Infinity) - (nextOf(b.id)?.t || Infinity));
  }
  const mode = state.org.settings.sort || 'updated';
  const title = (n) => (n.title || n.preview || '').trim();
  const cmp = {
    updated: (a, b) => (b.updated || 0) - (a.updated || 0),
    created: (a, b) => (b.created || 0) - (a.created || 0),
    title: (a, b) => title(a).localeCompare(title(b), 'es', { sensitivity: 'base', numeric: true }),
    // Las notas sin orden manual (nuevas) van primero, de la más nueva a la más vieja
    manual: (a, b) => (a.order ?? -(a.created || 0)) - (b.order ?? -(b.created || 0)),
  }[mode] || ((a, b) => (b.updated || 0) - (a.updated || 0));
  return [...list].sort(cmp);
}

const manualMode = () => (state.org.settings.sort === 'manual') && !state.search.active && !['trash', 'reminders'].includes(state.filter.kind);

// Cuadrícula tipo "mosaico": columnas que se llenan de izquierda a derecha (el orden se lee por filas)
function columnCount() {
  const w = $('#list-scroll').clientWidth || window.innerWidth;
  if (state.layout === 'list') return 1;
  return w >= 1100 ? 4 : w >= 760 ? 3 : 2;
}

function fillGrid(grid, notes) {
  const n = columnCount();
  grid.classList.toggle('list', state.layout === 'list');
  const cols = Array.from({ length: n }, () => { const c = document.createElement('div'); c.className = 'grid-col'; return c; });
  notes.forEach((note, i) => cols[i % n].appendChild(cardEl(note)));
  grid.replaceChildren(...cols);
  grid.dataset.ids = notes.map((x) => x.id).join(',');
}

function renderList() {
  const f = state.filter;
  const searching = state.search.active;
  rulesMemo = null; // la antigüedad depende de la hora
  const visible = sortNotes(state.notes.filter((n) => (searching ? matchesSearch(n) : matchesFilter(n))));
  const usePinned = !searching && !['archive', 'trash', 'templates', 'reminders'].includes(f.kind);
  const pinned = usePinned ? visible.filter((n) => n.pinned) : [];
  const others = usePinned ? visible.filter((n) => !n.pinned) : visible;

  if (!searching && f.kind === 'notes') $('#list-title').innerHTML = BRAND; else $('#list-title').textContent = filterTitle();
  fillGrid($('#grid-pinned'), pinned);
  fillGrid($('#grid-others'), others);
  $('#pinned-wrap').hidden = pinned.length === 0;
  $('#others-label').hidden = pinned.length === 0 || others.length === 0;
  $('#fab').hidden = searching || ['archive', 'trash', 'reminders', 'shared'].includes(f.kind);
  $('#btn-layout').innerHTML = icon(state.layout === 'list' ? 'viewGrid' : 'viewList');
  $('#btn-layout').setAttribute('aria-label', state.layout === 'list' ? 'Ver en cuadrícula' : 'Ver en lista');

  // Aviso de la vista
  const note = $('#view-note');
  if (searching) {
    note.textContent = visible.length === 1 ? '1 resultado' : `${visible.length} resultados`;
    note.hidden = false;
  } else if (f.kind === 'trash') {
    const d = state.org.settings.trashDays;
    note.textContent = d > 0 ? `Las notas de la papelera se eliminan definitivamente a los ${d} días.` : 'La papelera no se vacía sola: se vacía a mano.';
    note.hidden = false;
  } else if (f.kind === 'templates') {
    note.textContent = 'Las plantillas no aparecen en tus notas. Para usar una, mantenela presionada o abrila y elegí «Usar esta plantilla».';
    note.hidden = false;
  } else if (manualMode() && visible.length > 1) {
    note.textContent = 'Orden manual: arrastrá cada nota desde su manija.';
    note.hidden = false;
  } else note.hidden = true;
  renderRulesBar(!searching && f.kind === 'notes');

  // Subcarpetas de la carpeta actual
  const chips = $('#folder-children');
  if (f.kind === 'folder' && !searching) {
    chips.innerHTML = childrenOf(f.id).map((c) => `<button class="chip ripple" data-folder="${esc(c.id)}">${icon('folder')}<span>${esc(c.name)}</span></button>`).join('')
      + `<button class="chip chip-outline ripple" data-new-sub="1">${icon('folderAdd')}<span>Subcarpeta</span></button>`;
    chips.hidden = false;
    chips.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => setFilter({ kind: 'folder', id: b.dataset.folder })));
    chips.querySelector('[data-new-sub]').addEventListener('click', () => newFolder(f.id));
  } else chips.hidden = true;

  const emptyTexts = {
    notes: 'Las notas que crees aparecen acá', archive: 'Las notas archivadas aparecen acá',
    trash: 'No hay notas en la papelera', folder: 'Esta carpeta no tiene notas', label: 'No hay notas con esta etiqueta',
    shared: 'Cuando alguien te comparta una nota y la aceptes, aparece acá.',
    reminders: 'No hay recordatorios pendientes. Para crear uno, abrí una nota y tocá la campana.',
    templates: 'Todavía no hay plantillas. Creá una con el botón +, o desde una nota: menú ⋮ → «Guardar como plantilla».',
  };
  const byRules = !searching && f.kind === 'notes' && !visible.length && mainCandidates().some((n) => hiddenByRules(n));
  $('#empty-text').textContent = searching ? 'No se encontraron notas'
    : byRules ? 'Las reglas de ocultar/mostrar dejan sin notas la pantalla principal. Cambialas desde ⋮ Menú → «Ocultar/mostrar por reglas».'
      : (emptyTexts[f.kind] || emptyTexts.notes);
  $('#empty').hidden = visible.length > 0;

  // La selección solo conserva notas visibles
  [...state.selection].forEach((id) => { if (!visible.some((n) => n.id === id)) state.selection.delete(id); });
  updateSelectionUi();
  requestAnimationFrame(() => { markClamped(); updateMoreBelow(); });
}

/* Aviso de la pantalla principal (v0.3.3): «N notas ocultas por reglas · Mostrar», con la vista elegida
 * e interruptor rápido para apagar o prender todas las reglas. */
function renderRulesBar(show) {
  const bar = $('#rules-bar');
  const cfg = rulesCfg();
  const view = activeView(cfg);
  const views = hideViewsList();
  if (!show || (!cfg.rules.some(ruleActive) && !view)) { bar.hidden = true; return; }
  const n = cfg.on ? mainCandidates().filter((x) => hiddenByRules(x)).length : 0;
  if (cfg.on && !n && !view) { bar.hidden = true; return; }
  const text = !cfg.on ? 'Reglas apagadas: se ven todas las notas'
    : !n ? 'Las reglas no ocultan ninguna nota'
      : rulesPeek ? (n === 1 ? 'Se ve la nota oculta por reglas' : `Se ven las ${n} notas ocultas por reglas`)
        : `${plural(n, 'nota oculta', 'notas ocultas')} por reglas`;
  bar.innerHTML = `${views.length ? `<button class="chip ripple rb-view" id="rb-view" aria-label="Elegir vista">${icon('visibility')}<span>${esc(view ? view.name : 'Sin vista')}</span>${icon('dropdown')}</button>` : ''}
    <button class="rb-text" id="rb-text">${text}</button>
    ${cfg.on && n ? `<button class="text-btn ripple" id="rb-peek">${rulesPeek ? 'Ocultar' : 'Mostrar'}</button>` : ''}
    <button class="rb-switch ripple" id="rb-on" role="switch" aria-checked="${cfg.on}" aria-label="${cfg.on ? 'Apagar las reglas' : 'Prender las reglas'}"><span class="switch${cfg.on ? ' on' : ''}"></span></button>`;
  bar.classList.toggle('off', !cfg.on);
  bar.classList.toggle('peek', cfg.on && rulesPeek && n > 0);
  bar.hidden = false;
  $('#rb-text').addEventListener('click', showRulesSettings);
  $('#rb-peek')?.addEventListener('click', () => { rulesPeek = !rulesPeek; renderList(); });
  $('#rb-on').addEventListener('click', () => {
    const on = !rulesCfg().on;
    rulesPeek = false;
    saveRules({ ...rulesCfg(), on });
    snackbar(on ? 'Reglas activadas' : 'Reglas apagadas: se ven todas las notas', 'Deshacer', () => saveRules({ ...rulesCfg(), on: !on }));
  });
  $('#rb-view')?.addEventListener('click', (e) => openViewMenu(e.currentTarget));
}

// Menú para cambiar de vista (desde el aviso)
function openViewMenu(anchor) {
  const cur = rulesCfg().view || null;
  openMenu(anchor, [
    ...hideViewsList().map((v) => ({ label: esc(v.name), checked: v.id === cur, onClick: () => applyView(v.id) })),
    { label: 'Sin vista (reglas sin nombre)', checked: !cur, onClick: () => applyView(null) },
    { divider: true },
    { label: 'Ocultar/mostrar por reglas…', onClick: () => showRulesSettings() },
  ]);
}

function cardEl(n) {
  const el = document.createElement('article');
  el.className = 'card ripple';
  el.tabIndex = 0;
  el.dataset.id = n.id;
  if (state.selection.has(n.id)) el.classList.add('selected');
  if (n.color && n.color !== 'default') el.dataset.color = n.color;

  const check = document.createElement('button');
  check.className = 'card-check';
  check.setAttribute('aria-label', 'Seleccionar');
  check.innerHTML = icon('checkCircle');
  check.addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(n.id); });
  el.appendChild(check);

  const hidden = n.locked && !state.unlocked.has(n.id);
  if (hidden) {
    el.classList.add('locked');
    const t = document.createElement('h3'); t.className = 'card-title'; t.textContent = n.title || 'Nota bloqueada'; el.appendChild(t);
    const p = document.createElement('p'); p.className = 'card-meta'; p.innerHTML = `${icon('lock')}<span>Bloqueada</span>`; el.appendChild(p);
  }
  if (n.thumb && !hidden) {
    const img = document.createElement('img');
    img.className = 'card-img'; img.src = n.thumb; img.alt = ''; img.loading = 'lazy';
    el.appendChild(img);
  }
  if (n.title && !hidden) {
    const t = document.createElement('h3'); t.className = 'card-title'; t.textContent = n.title; el.appendChild(t);
  }
  if (n.preview && !hidden) {
    const p = document.createElement('p'); p.className = 'card-text'; p.textContent = n.preview; el.appendChild(p);
  }
  if (n.checks?.total && !hidden) {
    const m = document.createElement('p'); m.className = 'card-meta';
    m.innerHTML = `${icon('checklist')}<span>${n.checks.done}/${n.checks.total}</span>`;
    el.appendChild(m);
  }

  // Recordatorio, etiquetas y carpetas de la nota
  const labels = noteLabels(n);
  const folders = noteFolders(n);
  const next = n.trashed ? null : nextOf(n.id);
  const shared = isShared(n);
  if (labels.length || folders.length || next || shared) {
    const row = document.createElement('div');
    row.className = 'card-chips';
    if (shared) {
      const sc = document.createElement('span');
      sc.className = 'mini-chip';
      sc.title = n.owner === state.user?.uid ? 'La compartiste' : 'Compartida con vos';
      sc.innerHTML = `${icon('people')}<span>${n.memberIds.length}</span>`;
      row.appendChild(sc);
    }
    if (next) {
      const overdue = !next.r.repeat && next.t < Date.now();
      const b = document.createElement('button');
      b.className = `mini-chip mini-chip-btn${overdue ? ' overdue' : ''}`;
      b.innerHTML = `${icon(next.r.repeat ? 'repeat' : 'bell')}<span>${esc(formatWhen(next.t))}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); openReminderSheet(n.id); });
      row.appendChild(b);
    }
    labels.slice(0, 3).forEach((id) => {
      const l = labelById(id);
      const c = document.createElement('span');
      c.className = 'mini-chip';
      c.innerHTML = `<i class="dot" style="background:${esc(l.color || '#757575')}"></i>${esc(l.name)}`;
      row.appendChild(c);
    });
    if (labels.length > 3) row.insertAdjacentHTML('beforeend', `<span class="mini-chip">+${labels.length - 3}</span>`);
    if (folders.length) {
      const b = document.createElement('button');
      b.className = 'mini-chip mini-chip-btn';
      b.title = folders.length === 1 ? 'En 1 carpeta' : `En ${folders.length} carpetas`;
      b.innerHTML = `${icon('folder')}<span>${folders.length}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); showOccurrences(n.id); });
      row.appendChild(b);
    }
    el.appendChild(row);
  }

  // Marca [Oculta] a la derecha del título (o arriba del texto si no tiene título)
  // Con «Mostrar» del aviso, las ocultas por reglas llevan «[Oculta por reglas]» en la pantalla principal
  const peekTag = !n.hidden && rulesPeek && state.filter.kind === 'notes' && !state.search.active && hiddenByRules(n);
  if ((n.hidden && !n.trashed) || peekTag) {
    const tag = document.createElement('span');
    tag.className = 'hidden-tag';
    tag.textContent = peekTag ? '[Oculta por reglas]' : '[Oculta]';
    tag.title = peekTag ? 'Oculta por reglas en la pantalla principal (se ve porque tocaste «Mostrar»)' : 'Oculta en la pantalla principal';
    const t = el.querySelector('.card-title');
    if (t) t.append(' ', tag);
    else { const p = document.createElement('p'); p.className = 'card-title card-title-tag'; p.appendChild(tag); el.insertBefore(p, el.querySelector('.card-img')?.nextSibling || check.nextSibling); }
  }

  // Contenido de la tarjeta (se recorta en la vista estándar o compacta)
  const body = document.createElement('div');
  body.className = 'card-body';
  [...el.children].forEach((ch) => { if (!ch.classList.contains('card-check')) body.appendChild(ch); });
  el.appendChild(body);

  if (manualMode()) {
    const h = document.createElement('button');
    h.className = 'card-drag';
    el.classList.add('with-drag'); // respaldo de :has() en WebView viejas
    h.setAttribute('aria-label', 'Arrastrar para ordenar');
    h.innerHTML = icon('drag');
    el.appendChild(h);
    attachDrag(h, el, n);
  }
  attachPress(el, n);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(n.id); });
  return el;
}

// Toque: abrir (o seleccionar si hay selección). Mantener presionado o clic derecho: seleccionar.
function attachPress(el, n) {
  let timer; let long = false; let sx = 0; let sy = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    long = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { long = true; haptic(); toggleSelect(n.id); }, 450);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) clearTimeout(timer);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => clearTimeout(timer)));
  el.addEventListener('click', (e) => {
    if (long) { e.preventDefault(); long = false; return; }
    if (state.selection.size) toggleSelect(n.id); else openNote(n.id);
  });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!long) toggleSelect(n.id); });
}

/* ---------- Editor ---------- */
function paintEditorChrome() {
  const c = state.current;
  if (!c) return;
  const v = $('#view-editor');
  if (c.color && c.color !== 'default') v.dataset.color = c.color; else delete v.dataset.color;
  $('#btn-pin').classList.toggle('active', !!c.pinned);
  $('#btn-pin').setAttribute('aria-label', c.pinned ? 'Dejar de fijar' : 'Fijar nota');

  // Papelera o "solo puede ver": solo lectura
  const trashed = !!c.trashed;
  const viewOnly = myRole(noteById(c.id) || c) === 'view';
  const readOnly = trashed || viewOnly;
  $('#trash-banner').hidden = !readOnly;
  $('#banner-text').textContent = trashed ? 'Esta nota está en la papelera.' : 'Solo lectura: te compartieron esta nota para ver.';
  $('#btn-restore').hidden = !trashed;
  $('#toolbar').hidden = readOnly;
  if (readOnly) { $('#table-bar').hidden = true; $('#view-editor').classList.remove('in-table'); hideSelBars(); }
  $('#btn-share').hidden = trashed;
  $('#btn-share').classList.toggle('active', isShared(noteById(c.id)));
  $('#btn-pin').hidden = trashed;
  $('#btn-reminder').hidden = trashed;
  $('#btn-reminder').classList.toggle('active', activeReminders(c.id).length > 0);
  $('#btn-color').hidden = trashed;
  $('#note-title').readOnly = readOnly;
  if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly);

  // Carpetas y etiquetas de la nota
  const fs = noteFolders(c);
  const ls = noteLabels(c);
  const chips = $('#note-chips');
  chips.innerHTML = (fs.length ? `<button class="chip ripple" id="chip-folders">${icon('folder')}<span>${fs.length === 1 ? esc(folderPath(fs[0])) : `En ${fs.length} carpetas`}</span></button>` : '')
    + ls.map((id) => { const l = labelById(id); return `<button class="chip ripple" data-label-chip="1"><i class="dot" style="background:${esc(l.color || '#757575')}"></i><span>${esc(l.name)}</span></button>`; }).join('');
  chips.hidden = !fs.length && !ls.length;
  chips.querySelector('#chip-folders')?.addEventListener('click', () => showOccurrences(c.id));
  chips.querySelectorAll('[data-label-chip]').forEach((b) => b.addEventListener('click', () => openPicker([c.id], 'labels')));

  updateNoteStatus();
  syncBars();
}

async function openNote(id, { push = true, isNew = false, meta = {} } = {}) {
  const n = state.notes.find((x) => x.id === id);
  if (!n && !isNew) return;
  if (n?.locked && !state.unlocked.has(id) && !(await unlockNote(n))) {
    if (!push && location.hash) history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  await closeSession();
  const token = ++openToken;
  const c = {
    id, isNew, dirty: false, status: { pending: 0, error: null },
    color: n?.color || 'default', pinned: !!n?.pinned, updated: n?.updated,
    legacy: n?.legacy || null, seedTitle: n?.title || '',
    folders: n?.folders || [], labels: n?.labels || [], archived: !!n?.archived, trashed: !!n?.trashed,
    template: !!n?.template, updatedBy: n?.updatedBy, updatedByName: n?.updatedByName,
    ...meta,
  };
  state.current = c;
  $('#table-bar').hidden = true;
  $('#view-editor').classList.remove('in-table');
  hideSelBars();
  $('#note-title').value = n?.title || '';
  $('#editor-scroll').scrollTop = 0;
  paintEditorChrome();
  setView('editor');
  if (push) {
    history.pushState({ note: id }, '', `#/nota/${id}`);
    state.pushed = true;
  }

  const session = state.repo.session(id, (st) => { c.status = st; updateNoteStatus(); });
  c.session = session;
  await session.ready();
  if (token !== openToken) { session.destroy(); return; }

  // Notas creadas antes de la sincronización (o la de bienvenida): su contenido pasa a Yjs.
  const needsSeed = session.isEmpty && (c.legacy || c.seedTitle);
  if (needsSeed && c.seedTitle) applyTextDiff(session.titleText, c.seedTitle);
  if (document.activeElement !== $('#note-title')) $('#note-title').value = session.titleText.toString();
  else applyTextDiff(session.titleText, $('#note-title').value);

  // El título se sincroniza también; si cambia en otro dispositivo, se actualiza acá.
  c.titleObserver = (ev, tr) => {
    if (tr.local) return;
    const input = $('#note-title');
    const pos = input.selectionStart;
    input.value = session.titleText.toString();
    if (document.activeElement === input && pos != null) input.setSelectionRange(pos, pos);
  };
  session.titleText.observe(c.titleObserver);

  editor = createEditor($('#editor'), {
    ydoc: session.ydoc,
    onUpdate: (ed, remote) => { if (!remote) { markDirty(); checkCasillaReminders(); } scheduleLinkPreviews(); },
    reminderIds: reminderItemIds,
    resolveImage,
    onState: (ed) => updateToolbar(ed),
    onCreate: (ed) => {
      if (needsSeed && c.legacy) {
        setTimeout(() => {
          if (token === openToken && session.fragment.length === 0) ed.commands.setContent(c.legacy, true);
        }, 60);
      }
    },
  });
  if (c.trashed || myRole(noteById(c.id)) === 'view') editor.setEditable(false);
  $('#link-previews').dataset.urls = '';
  scheduleLinkPreviews(400);
  setTimeout(() => migrateInlineImages(id), 1500);
  setTimeout(() => repairSummary(id), 2500);
  updateToolbar(editor);
}

async function closeSession() {
  const c = state.current;
  if (!c) return;
  clearTimeout(summaryTimer);
  let empty = c.isNew && !editor && !$('#note-title').value.trim();
  if (editor) {
    const title = $('#note-title').value;
    const s = summarize(editor.getJSON(), editor.getText({ blockSeparator: '\n' }));
    empty = !title.trim() && !s.preview && !s.thumb && !s.checks.total && !s.tables;
    // Título automático: nota nueva que se cierra sin título (si la opción está activada)
    if (c.isNew && !empty && !title.trim() && c.session && myRole(noteById(c.id)) !== 'view') {
      const auto = autoTitleFor(s.text);
      if (auto) { $('#note-title').value = auto; applyTextDiff(c.session.titleText, auto); c.dirty = true; }
    }
    if (c.dirty && !(empty && c.isNew)) await saveSummaryNow();
    editor.destroy();
    editor = null;
  }
  $('#editor').innerHTML = '';
  $('#link-previews').innerHTML = '';
  $('#link-previews').dataset.urls = '';
  clearTimeout(linkTimer);
  if (c.titleObserver) c.session?.titleText.unobserve(c.titleObserver);
  if (c.session && !(empty && c.isNew)) maybeSaveVersion(c, c.session);
  c.session?.destroy();
  state.current = null;
  if (empty && c.isNew) state.repo.removeCompletely(c.id);
}

async function closeEditor() {
  if (state.view !== 'editor') return;
  // Aviso al salir si quedaron cambios de esta nota sin subir
  const leaving = state.current;
  if (state.mode === 'cloud' && leaving && pendingList(state.user.uid).includes(leaving.id)
      && (leaving.status?.pending || syncSummary().kind === 'offline')) {
    setTimeout(() => snackbar('Hay cambios que todavía no se subieron: se suben solos cuando vuelva la conexión', 'Reintentar', () => syncNow()), 350);
  }
  closeOverlays();
  $('#note-title').blur();
  editor?.commands.blur();
  await closeSession();
  setView('list');
  renderList();
}

function goBack() {
  if (closeOverlays()) return;
  if (state.view === 'editor' && isSelecting()) { finishSelection(); return; }
  if (state.view === 'editor') {
    if (state.pushed) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); closeEditor(); }
    return;
  }
  if (state.selection.size) { clearSelection(); return; }
  if (state.search.active) { closeSearch(); return; }
  if (state.view === 'list' && state.filter.kind !== 'notes') {
    const f = state.filter;
    const parent = f.kind === 'folder' ? folderById(f.id)?.parentId : null;
    setFilter(parent ? { kind: 'folder', id: parent } : { kind: 'notes' });
    return;
  }
  minimizeApp();
}

function markDirty() {
  const c = state.current;
  if (!c) return;
  c.dirty = true;
  c.versionDirty = true;
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(saveSummaryNow, 1200);
}

// Guarda el resumen que se ve en la lista (título, vista previa, casillas, miniatura).
async function saveSummaryNow() {
  clearTimeout(summaryTimer);
  const c = state.current;
  if (!c || !c.dirty || !editor) return;
  c.dirty = false;
  const s = summarize(editor.getJSON(), editor.getText({ blockSeparator: '\n' }));
  const thumbSrc = s.thumb?.startsWith('img:') ? await resolveImage(s.thumb) : s.thumb;
  const thumb = await makeThumb(thumbSrc);
  const patch = {
    title: $('#note-title').value, preview: s.preview, text: s.text, checks: s.checks, thumb, updated: Date.now(),
  };
  if (c.legacy) { patch.legacy = null; c.legacy = null; }
  c.updated = patch.updated;
  state.repo.saveSummary(c.id, patch);
}

function updateToolbar(ed) {
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
    const cmd = b.dataset.cmd;
    b.classList.toggle('active', isActive(ed, cmd));
    if (cmd === 'undo') b.disabled = !ed.can().undo();
    if (cmd === 'redo') b.disabled = !ed.can().redo();
  });
  updateTableBar(ed);
}

/* ---------- Tablas ---------- */
const H_LABEL = { left: 'Izquierda', center: 'Centro', right: 'Derecha', justify: 'Justificado' };
const V_LABEL = { top: 'Arriba', middle: 'Medio', bottom: 'Abajo' };
const SCOPE_LABEL = { cell: 'Celda', row: 'Fila', col: 'Columna', table: 'Tabla' };
const tableUi = { cols: 3, rows: 3, header: true, scope: 'cell' };

// Barra de tabla (arriba de la barra de formato): se ve solo con el cursor dentro de una tabla.
function updateTableBar(ed) {
  const bar = $('#table-bar');
  if (updateSelBars(ed)) { bar.hidden = true; $('#view-editor').classList.add('in-table'); return; }
  const ctx = ed.isEditable && !$('#toolbar').hidden ? tableContext(ed.state) : null;
  bar.hidden = !ctx;
  $('#view-editor').classList.toggle('in-table', !!ctx);
  if (!ctx) return;
  $('#tbl-pos').textContent = `F${ctx.row} · C${ctx.col}`;
  const setIcon = (sel, name, label) => {
    const b = bar.querySelector(sel);
    if (b.dataset.cur === name) return;
    b.dataset.cur = name;
    b.innerHTML = icon(name);
    b.setAttribute('aria-label', label);
    b.title = label;
  };
  setIcon('[data-tbl="alignH"]', `align${ctx.align}`, `Alineación horizontal: ${H_LABEL[ctx.align]} (tocá para cambiar)`);
  setIcon('[data-tbl="alignV"]', `valign${ctx.valign}`, `Alineación vertical: ${V_LABEL[ctx.valign]} (tocá para cambiar)`);
  const cb = bar.querySelector('[data-tbl="color"]');
  if (cb) { if (ctx.bg) cb.dataset.bg = ctx.bg; else delete cb.dataset.bg; }
}

function bindTableBar() {
  document.querySelectorAll('#table-bar [data-tbl]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (!editor) return;
      const cmd = b.dataset.tbl;
      const ctx = tableContext(editor.state);
      if (!ctx) return;
      if (cmd === 'menu') { openTableSheet(); return; }
      if (cmd === 'select') { beginSelection(); return; }
      if (cmd === 'size') { openTableSheet({ scrollTo: 'size' }); return; }
      if (cmd === 'color') { openTableSheet({ scrollTo: 'cells' }); return; }
      if (cmd === 'alignH') {
        const next = ALIGN_H[(ALIGN_H.indexOf(ctx.align) + 1) % ALIGN_H.length];
        setCellsAttrs(editor, 'cell', { align: next });
        snackbar(`Alineación horizontal: ${H_LABEL[next]}`);
        return;
      }
      if (cmd === 'alignV') {
        const next = ALIGN_V[(ALIGN_V.indexOf(ctx.valign) + 1) % ALIGN_V.length];
        setCellsAttrs(editor, 'cell', { valign: next });
        snackbar(`Alineación vertical: ${V_LABEL[next]}`);
        return;
      }
      runTableCommand(editor, cmd);
    });
  });
}

// Botón "Tabla" de la barra de formato: inserta una tabla o, si el cursor ya está en una, abre sus opciones.
function openTableUi() {
  if (!editor) return;
  if (tableContext(editor.state)) openTableSheet(); else openInsertTableSheet();
}

function openInsertTableSheet() {
  const MAXC = 20; const MAXR = 200; const G = 8;
  const cells = [];
  for (let r = 1; r <= G; r++) for (let c = 1; c <= G; c++) cells.push(`<button class="tbl-pick-cell" data-c="${c}" data-r="${r}" aria-label="${c} columnas × ${r} filas"></button>`);
  openSheet(`
    <h2 class="sheet-title">Insertar tabla</h2>
    <p class="sheet-text">Tocá el tamaño en la grilla o escribí la cantidad (podés subirla o bajarla con − y +).</p>
    <div class="tbl-picker" id="tbl-picker" style="--g:${G}">${cells.join('')}</div>
    <p class="tbl-size" id="tbl-size"></p>
    <div class="tbl-steppers">
      <div class="tbl-stepper"><span>Columnas</span><button class="step-btn ripple" data-step="cols" data-d="-1" aria-label="Menos columnas">−</button><input id="tbl-cols" type="number" min="1" max="${MAXC}" inputmode="numeric"><button class="step-btn ripple" data-step="cols" data-d="1" aria-label="Más columnas">+</button></div>
      <div class="tbl-stepper"><span>Filas</span><button class="step-btn ripple" data-step="rows" data-d="-1" aria-label="Menos filas">−</button><input id="tbl-rows" type="number" min="1" max="${MAXR}" inputmode="numeric"><button class="step-btn ripple" data-step="rows" data-d="1" aria-label="Más filas">+</button></div>
    </div>
    <label class="tbl-check"><input type="checkbox" id="tbl-header"> Primera fila como encabezado</label>
    <div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="tbl-cancel">Cancelar</button><button class="filled-btn ripple" id="tbl-insert">Insertar</button></div>
  `, (body) => {
    const clamp = (v, max) => Math.max(1, Math.min(max, Math.round(Number(v) || 1)));
    const paint = (hc = tableUi.cols, hr = tableUi.rows) => {
      body.querySelectorAll('.tbl-pick-cell').forEach((el) => el.classList.toggle('on', +el.dataset.c <= hc && +el.dataset.r <= hr));
      body.querySelector('#tbl-size').textContent = `${hc} ${hc === 1 ? 'columna' : 'columnas'} × ${hr} ${hr === 1 ? 'fila' : 'filas'}`;
    };
    const sync = () => { body.querySelector('#tbl-cols').value = tableUi.cols; body.querySelector('#tbl-rows').value = tableUi.rows; paint(); };
    body.querySelector('#tbl-header').checked = tableUi.header;
    const picker = body.querySelector('#tbl-picker');
    picker.addEventListener('pointerover', (e) => { const t = e.target.closest('.tbl-pick-cell'); if (t && e.pointerType === 'mouse') paint(+t.dataset.c, +t.dataset.r); });
    picker.addEventListener('pointerleave', () => paint());
    picker.addEventListener('click', (e) => {
      const t = e.target.closest('.tbl-pick-cell');
      if (!t) return;
      tableUi.cols = +t.dataset.c; tableUi.rows = +t.dataset.r; sync();
    });
    body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.step;
      tableUi[k] = clamp(tableUi[k] + Number(b.dataset.d), k === 'cols' ? MAXC : MAXR);
      sync();
    }));
    [['#tbl-cols', 'cols', MAXC], ['#tbl-rows', 'rows', MAXR]].forEach(([sel, k, max]) => {
      const inp = body.querySelector(sel);
      inp.addEventListener('input', () => { if (inp.value !== '') { tableUi[k] = clamp(inp.value, max); paint(); } });
      inp.addEventListener('change', () => { tableUi[k] = clamp(inp.value, max); sync(); });
    });
    body.querySelector('#tbl-cancel').addEventListener('click', closeOverlays);
    body.querySelector('#tbl-insert').addEventListener('click', () => {
      tableUi.cols = clamp(body.querySelector('#tbl-cols').value, MAXC);
      tableUi.rows = clamp(body.querySelector('#tbl-rows').value, MAXR);
      tableUi.header = body.querySelector('#tbl-header').checked;
      closeOverlays();
      if (editor) insertTable(editor, tableUi);
    });
    sync();
  });
}

// Panel "Tabla": todas las opciones de la tabla en la que está el cursor.
const SIZE_LABEL = { auto: 'Automático', equal: 'Iguales', manual: 'Manual' };
const SIZE_TIP = {
  col: { auto: 'Cada columna toma el ancho que pide su contenido.', equal: 'Todas las columnas miden lo mismo.', manual: 'Cada columna tiene su ancho: cambialo con − y + (o arrastrando el borde con el mouse).' },
  row: { auto: 'Cada fila toma el alto de su contenido.', equal: 'Todas las filas miden lo mismo que la más alta.', manual: 'Cada fila tiene su alto: cambialo con − y +. Una fila nunca queda más baja que su contenido.' },
};
const COL_STEP = 16; const ROW_STEP = 8;

function openTableSheet({ scrollTo = null, keepScroll = false } = {}) {
  if (!editor) return;
  const ctx = tableContext(editor.state);
  if (!ctx) { closeOverlays(); return; }
  const prevScroll = $('#sheet').scrollTop;
  const sz = tableSizes(editor);
  const clip = getTableClip();
  const scopes = Object.entries(SCOPE_LABEL).map(([k, l]) => `<button class="seg-btn ripple${tableUi.scope === k ? ' on' : ''}" data-scope="${k}">${l}</button>`).join('');
  const hBtns = ALIGN_H.map((a) => `<button class="tool ripple${ctx.align === a ? ' active' : ''}" data-align="${a}" aria-label="${H_LABEL[a]}" title="${H_LABEL[a]}">${icon(`align${a}`)}</button>`).join('');
  const vBtns = ALIGN_V.map((a) => `<button class="tool ripple${ctx.valign === a ? ' active' : ''}" data-valign="${a}" aria-label="${V_LABEL[a]}" title="${V_LABEL[a]}">${icon(`valign${a}`)}</button>`).join('');
  const act = (cmd, label, extra = '') => `<button class="chip ripple tbl-act${extra}" data-act="${cmd}"><span>${label}</span></button>`;
  const seg = (kind, cur) => Object.entries(SIZE_LABEL).map(([k, l]) => `<button class="seg-btn ripple${cur === k ? ' on' : ''}" data-size="${kind}" data-mode="${k}">${l}</button>`).join('');
  const stepper = (kind, value, label) => `<div class="tbl-stepper tbl-size-step"><span>${label}</span><button class="step-btn ripple" data-sstep="${kind}" data-d="-1" aria-label="Menos">−</button><input data-sval="${kind}" type="number" inputmode="numeric" value="${value}"><button class="step-btn ripple" data-sstep="${kind}" data-d="1" aria-label="Más">+</button><em>px</em></div>`;
  const bgBtns = `<button class="tbl-swatch tbl-swatch-none ripple${!ctx.bg ? ' on' : ''}" data-bgset="" aria-label="Sin color" title="Sin color">${icon('block')}</button>`
    + CELL_BG.map(([k, l]) => `<button class="tbl-swatch ripple${ctx.bg === k ? ' on' : ''}" data-bg="${k}" data-bgset="${k}" aria-label="${l}" title="${l}">${ctx.bg === k ? icon('check') : ''}</button>`).join('');
  const clipRow = clip?.kind === 'row'; const clipCol = clip?.kind === 'col';
  const clipNote = clip ? `<p class="sheet-text tbl-clip">${icon('copy')} Copiada: ${clipRow ? `fila ${clip.index}` : `columna ${clip.index}`} (${clip.cells.length} celdas). Se puede insertar en esta tabla o en otra, también de otra nota.</p>` : '';
  openSheet(`
    <h2 class="sheet-title">${icon('table')} Tabla <small class="ver">${ctx.cols} ${ctx.cols === 1 ? 'columna' : 'columnas'} × ${ctx.rows} ${ctx.rows === 1 ? 'fila' : 'filas'} · estás en la fila ${ctx.row}, columna ${ctx.col}</small></h2>
    <div class="tbl-group"><h3>Selección</h3><div class="chips-row">${act('select', 'Seleccionar celdas, filas o columnas…', ' chip-on')}</div></div>
    <div class="tbl-group"><h3>Filas</h3><div class="chips-row">${act('rowBefore', '+ Insertar arriba')}${act('rowAfter', '+ Insertar abajo')}${act('copyRow', `Copiar fila ${ctx.row}`)}${act('dupRow', 'Duplicar fila')}${clipRow ? act('pasteRowBefore', '⤒ Insertar copiada arriba', ' chip-on') + act('pasteRowAfter', '⤓ Insertar copiada abajo', ' chip-on') : ''}${act('deleteRow', '− Eliminar fila', ' danger')}</div></div>
    <div class="tbl-group"><h3>Columnas</h3><div class="chips-row">${act('colBefore', '+ Insertar a la izquierda')}${act('colAfter', '+ Insertar a la derecha')}${act('copyCol', `Copiar columna ${ctx.col}`)}${act('dupCol', 'Duplicar columna')}${clipCol ? act('pasteColBefore', '⇤ Insertar copiada a la izquierda', ' chip-on') + act('pasteColAfter', '⇥ Insertar copiada a la derecha', ' chip-on') : ''}${act('deleteCol', '− Eliminar columna', ' danger')}</div></div>
    ${clipNote}
    <div class="tbl-group" id="tbl-size-group"><h3>Tamaño</h3>
      <div class="tbl-size-row"><span>Ancho de columnas</span><div class="seg" role="group" aria-label="Ancho de columnas">${seg('col', sz.colMode)}</div></div>
      <p class="sheet-text tbl-size-tip">${SIZE_TIP.col[sz.colMode]}</p>
      ${stepper('col', sz.colWidth, `Columna ${ctx.col}`)}
      <div class="tbl-size-row"><span>Alto de filas</span><div class="seg" role="group" aria-label="Alto de filas">${seg('row', sz.rowMode)}</div></div>
      <p class="sheet-text tbl-size-tip">${SIZE_TIP.row[sz.rowMode]}</p>
      ${stepper('row', sz.rowHeight, `Fila ${ctx.row}`)}
    </div>
    <div class="tbl-group" id="tbl-cells-group"><h3>Color de fondo y alineación</h3>
      <div class="tbl-size-row"><span>Aplicar a</span><div class="seg" role="group" aria-label="Aplicar a">${scopes}</div></div>
      <div class="tbl-swatches" role="group" aria-label="Color de fondo">${bgBtns}</div>
      <div class="tbl-align-row"><span>Horizontal</span>${hBtns}</div>
      <div class="tbl-align-row"><span>Vertical</span>${vBtns}</div>
    </div>
    <div class="tbl-group" id="tbl-sort-group"><h3>Ordenar las filas por la columna ${ctx.col}</h3><div class="chips-row">${act('sortTextAsc', 'A → Z')}${act('sortTextDesc', 'Z → A')}${act('sortNumAsc', '1 → 9 (números)')}${act('sortNumDesc', '9 → 1 (números)')}</div>
      <p class="sheet-text tbl-size-tip">${ctx.headerRow ? 'La fila de encabezado queda arriba, sin moverse.' : 'Se ordenan todas las filas (no hay fila de encabezado).'} Las celdas vacías van al final. Para elegir otra columna, ubicá el cursor en ella.</p>
    </div>
    <div class="tbl-group"><h3>Encabezado</h3><div class="chips-row">${act('headerRow', `${ctx.headerRow ? '✓ ' : ''}Fila de encabezado`, ctx.headerRow ? ' chip-on' : '')}${act('headerCol', `${ctx.headerCol ? '✓ ' : ''}Columna de encabezado`, ctx.headerCol ? ' chip-on' : '')}</div></div>
    <div class="tbl-group"><h3>Tabla</h3><div class="chips-row">${act('textBefore', 'Escribir arriba de la tabla')}${act('textAfter', 'Escribir debajo de la tabla')}${act('duplicate', 'Duplicar tabla')}${act('deleteTable', 'Eliminar tabla', ' danger')}</div></div>
    <p class="sheet-text tbl-tip">Con teclado: Tab pasa a la celda siguiente y, en la última, agrega una fila. Podés pegar celdas copiadas de Excel o Google Sheets y se arma la tabla. Dentro de una celda podés usar casillas, listas y formato. En la PC, el ancho de una columna también se cambia arrastrando su borde. En el celular, mantené apretada una celda para ver su menú (en la PC, clic derecho; Shift + clic derecho abre el menú del navegador). Para elegir varias celdas sueltas, filas o columnas: «Seleccionar» (en la PC también Ctrl + clic).</p>
  `, (body) => {
    // Al volver a dibujar el panel se mantiene el desplazamiento (si no, salta arriba en cada toque).
    const reopen = () => {
      if (!editor || !tableContext(editor.state)) { closeOverlays(); return; }
      // Se espera un cuadro para medir la tabla ya redibujada.
      requestAnimationFrame(() => openTableSheet({ keepScroll: true }));
    };
    body.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { tableUi.scope = b.dataset.scope; reopen(); }));
    body.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => {
      setCellsAttrs(editor, tableUi.scope, { align: b.dataset.align }); reopen();
      snackbar(`${SCOPE_LABEL[tableUi.scope]}: alineación ${H_LABEL[b.dataset.align].toLowerCase()}`);
    }));
    body.querySelectorAll('[data-valign]').forEach((b) => b.addEventListener('click', () => {
      setCellsAttrs(editor, tableUi.scope, { valign: b.dataset.valign }); reopen();
      snackbar(`${SCOPE_LABEL[tableUi.scope]}: alineación ${V_LABEL[b.dataset.valign].toLowerCase()}`);
    }));
    body.querySelectorAll('[data-bgset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.bgset || null;
      setCellsAttrs(editor, tableUi.scope, { bg: k }); reopen();
      snackbar(`${SCOPE_LABEL[tableUi.scope]}: ${k ? `fondo ${BG_LABEL[k].toLowerCase()}` : 'sin color de fondo'}`);
    }));
    // Tamaño: modo de ancho y de alto, y − / + (o número) para la columna y la fila actuales.
    body.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
      const { size, mode } = b.dataset;
      if (size === 'col') setColumnsMode(editor, mode); else setRowsMode(editor, mode);
      snackbar(`${size === 'col' ? 'Ancho de columnas' : 'Alto de filas'}: ${SIZE_LABEL[mode].toLowerCase()}`);
      reopen();
    }));
    const applySize = (kind, v) => { if (kind === 'col') setColumnWidth(editor, v); else setRowHeight(editor, v); reopen(); };
    body.querySelectorAll('[data-sstep]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.sstep;
      const cur = Number(body.querySelector(`[data-sval="${kind}"]`).value) || 0;
      applySize(kind, cur + Number(b.dataset.d) * (kind === 'col' ? COL_STEP : ROW_STEP));
    }));
    body.querySelectorAll('[data-sval]').forEach((inp) => inp.addEventListener('change', () => { if (inp.value !== '') applySize(inp.dataset.sval, inp.value); }));
    body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const cmd = b.dataset.act;
      if (cmd === 'select') { closeOverlays(); beginSelection(); return; }
      if (cmd === 'deleteTable') {
        closeOverlays();
        runTableCommand(editor, cmd, { focus: false });
        snackbar('Tabla eliminada', 'Deshacer', () => editor?.chain().focus().undo().run());
        return;
      }
      if (cmd === 'textBefore' || cmd === 'textAfter') { closeOverlays(); runTableCommand(editor, cmd); return; }
      if (cmd === 'copyRow' || cmd === 'copyCol') {
        const c = copyTablePart(editor, cmd === 'copyRow' ? 'row' : 'col');
        if (c) snackbar(`${c.kind === 'row' ? 'Fila' : 'Columna'} ${c.index} copiada. Ubicate donde quieras y tocá "Insertar copiada".`);
        reopen();
        return;
      }
      if (cmd === 'dupRow' || cmd === 'dupCol') {
        duplicateTablePart(editor, cmd === 'dupRow' ? 'row' : 'col', { focus: false });
        snackbar(cmd === 'dupRow' ? 'Fila duplicada debajo' : 'Columna duplicada a la derecha');
        reopen();
        return;
      }
      if (cmd.startsWith('paste')) {
        insertCopied(editor, cmd.endsWith('Before') ? 'before' : 'after', { focus: false });
        snackbar(cmd.startsWith('pasteRow') ? 'Fila copiada insertada' : 'Columna copiada insertada');
        reopen();
        return;
      }
      if (cmd.startsWith('sort')) { doSort(cmd); reopen(); return; }
      runTableCommand(editor, cmd, { focus: false });
      if (cmd === 'duplicate') snackbar('Tabla duplicada debajo');
      reopen();
    }));
  });
  if (keepScroll) $('#sheet').scrollTop = prevScroll;
  else if (scrollTo === 'size') $('#tbl-size-group')?.scrollIntoView({ block: 'start' });
  else if (scrollTo === 'cells') $('#tbl-cells-group')?.scrollIntoView({ block: 'start' });
  else if (scrollTo === 'sort') $('#tbl-sort-group')?.scrollIntoView({ block: 'start' });
  else $('#sheet').scrollTop = 0;
}

const BG_LABEL = {};
CELL_BG.forEach(([k, l]) => { BG_LABEL[k] = l; });
const SORT_CMDS = {
  sortTextAsc: ['asc', 'text', 'A → Z'], sortTextDesc: ['desc', 'text', 'Z → A'],
  sortNumAsc: ['asc', 'number', 'de menor a mayor'], sortNumDesc: ['desc', 'number', 'de mayor a menor'],
};
function doSort(cmd) {
  const [dir, kind, label] = SORT_CMDS[cmd];
  const col = tableContext(editor.state)?.col;
  const r = sortTable(editor, dir, kind);
  if (r.reason === 'merged') snackbar('No se puede ordenar: la tabla tiene celdas combinadas');
  else if (r.reason === 'few') snackbar('No hay filas suficientes para ordenar');
  else if (r.ok && !r.moved) snackbar('La tabla ya estaba en ese orden');
  else if (r.ok) snackbar(`Filas ordenadas por la columna ${col} (${label})`, 'Deshacer', () => editor?.chain().focus().undo().run());
}

// Menú de la celda: al mantener apretada una celda (celular) o con clic derecho (PC; Shift + clic derecho = menú del navegador).
function openCellMenu(x, y) {
  if (!editor) return;
  const ctx = tableContext(editor.state);
  if (!ctx) return;
  haptic();
  const clip = getTableClip();
  const run = (fn) => () => { if (editor && tableContext(editor.state)) fn(); };
  const items = [
    { label: `${icon('selectAll')} Seleccionar celdas, filas o columnas…`, onClick: run(() => beginSelection()) },
    { divider: true },
    { label: '↑ Escribir arriba de la tabla', onClick: run(() => runTableCommand(editor, 'textBefore')) },
    { label: '↓ Escribir debajo de la tabla', onClick: run(() => runTableCommand(editor, 'textAfter')) },
    { divider: true },
    { label: `${icon('palette')} Color de fondo…`, onClick: run(() => openTableSheet({ scrollTo: 'cells' })) },
    { divider: true },
    { label: `Copiar fila ${ctx.row}`, onClick: run(() => { const c = copyTablePart(editor, 'row'); if (c) snackbar(`Fila ${c.index} copiada`); }) },
    { label: `Copiar columna ${ctx.col}`, onClick: run(() => { const c = copyTablePart(editor, 'col'); if (c) snackbar(`Columna ${c.index} copiada`); }) },
  ];
  if (clip?.kind === 'row') {
    items.push({ label: '⤒ Insertar fila copiada arriba', onClick: run(() => { insertCopied(editor, 'before', { focus: false }); snackbar('Fila copiada insertada'); }) });
    items.push({ label: '⤓ Insertar fila copiada abajo', onClick: run(() => { insertCopied(editor, 'after', { focus: false }); snackbar('Fila copiada insertada'); }) });
  } else if (clip?.kind === 'col') {
    items.push({ label: '⇤ Insertar columna copiada a la izquierda', onClick: run(() => { insertCopied(editor, 'before', { focus: false }); snackbar('Columna copiada insertada'); }) });
    items.push({ label: '⇥ Insertar columna copiada a la derecha', onClick: run(() => { insertCopied(editor, 'after', { focus: false }); snackbar('Columna copiada insertada'); }) });
  }
  items.push(
    { label: 'Duplicar fila', onClick: run(() => { duplicateTablePart(editor, 'row', { focus: false }); snackbar('Fila duplicada debajo'); }) },
    { label: 'Duplicar columna', onClick: run(() => { duplicateTablePart(editor, 'col', { focus: false }); snackbar('Columna duplicada a la derecha'); }) },
    { divider: true },
    { label: `Ordenar por la columna ${ctx.col}: A → Z`, onClick: run(() => doSort('sortTextAsc')) },
    { label: `Ordenar por la columna ${ctx.col}: Z → A`, onClick: run(() => doSort('sortTextDesc')) },
    { label: 'Ordenar con números…', onClick: run(() => openTableSheet({ scrollTo: 'sort' })) },
    { divider: true },
    { label: '↔ Tamaño…', onClick: run(() => openTableSheet({ scrollTo: 'size' })) },
    { label: `${icon('table')} Todas las opciones de la tabla…`, onClick: run(() => openTableSheet()) },
    { divider: true },
    { label: '− Eliminar fila', onClick: run(() => { runTableCommand(editor, 'deleteRow', { focus: false }); snackbar('Fila eliminada', 'Deshacer', () => editor?.chain().focus().undo().run()); }) },
    { label: '− Eliminar columna', onClick: run(() => { runTableCommand(editor, 'deleteCol', { focus: false }); snackbar('Columna eliminada', 'Deshacer', () => editor?.chain().focus().undo().run()); }) },
  );
  openMenu({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) }, items);
  $('#menu').classList.add('cell-menu');
  cellMenuAt = Date.now();
}
let cellMenuAt = 0;

function bindCellPress() {
  const host = $('#editor');
  const canUse = (target) => editor && editor.isEditable && !$('#toolbar').hidden && target.closest?.('td, th');
  let timer = null; let sx = 0; let sy = 0; let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const open = (x, y, target) => {
    if (Date.now() - cellMenuAt < 700) return; // ya se abrió (touch + contextmenu)
    if (isSelecting()) {
      // Seleccionando: la celda apretada se suma a la selección (si no estaba) y se abre el menú de la selección.
      const hit = cellAtDom(editor, target || document.elementFromPoint(x, y));
      const s = selState(editor);
      if (hit && (hit.tablePos !== s.tablePos || !s.cells.has(`${hit.r},${hit.c}`))) updateSelection(editor, 'toggle', hit);
      openSelMenu({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) }, true);
      return;
    }
    if (placeCursorAt(editor, x, y)) openCellMenu(x, y);
  };
  // Celular: mantener apretado ~0,5 s sin mover el dedo.
  host.addEventListener('touchstart', (e) => {
    fired = false;
    if (e.touches.length !== 1 || !canUse(e.target)) { cancel(); return; }
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
    cancel();
    const target = e.target;
    timer = setTimeout(() => { timer = null; fired = true; open(sx, sy, target); }, 520);
  }, { passive: true });
  host.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t && (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10)) cancel();
  }, { passive: true });
  // Al soltar después de abrir el menú, se evita el "clic" (cerraría el menú al instante).
  host.addEventListener('touchend', (e) => { cancel(); if (fired) { e.preventDefault(); fired = false; } });
  host.addEventListener('touchcancel', cancel);
  // Android también dispara "contextmenu" al mantener apretado (y la PC con el clic derecho).
  host.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || !canUse(e.target)) return;
    e.preventDefault();
    cancel();
    open(e.clientX, e.clientY, e.target);
  });
}

/* ---------- Tablas: selección de celdas sueltas, filas y columnas ---------- */
// Se entra con «Seleccionar» (barra de tabla, menú de la celda o panel) o, en la PC, con Ctrl + clic.
// Mientras tanto: tocar una celda la suma o la quita; las letras (arriba) y los números (a la izquierda)
// seleccionan columnas y filas enteras; la barra de abajo tiene las acciones. Atrás o «Listo» termina.
const selUi = { range: false };
const COPY_MODE_LABEL = { block: 'como bloque', list: 'como lista' };
const copyModeDefault = () => (state.org.settings.cellCopyMode === 'list' ? 'list' : 'block');
const isSelecting = () => !!(editor && !editor.isDestroyed && selState(editor));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const undoQuiet = () => editor?.chain().undo().run();

function hideSelBars() {
  $('#sel-bar').hidden = true;
  $('#sel-actions').hidden = true;
  $('#view-editor').classList.remove('selecting');
  drawSelHandles();
}

function beginSelection(hit = null) {
  if (!editor || !editor.isEditable || $('#toolbar').hidden) return;
  if (!startSelection(editor, hit)) return;
  selUi.range = false;
  // Se cierra el teclado: mientras se selecciona, tocar una celda no pone el cursor.
  editor.view.dom.blur();
  try { window.getSelection()?.removeAllRanges(); } catch { /* nada */ }
  hideKeyboard();
  haptic();
  if (!localStorage.getItem('notas-sel-ayuda')) {
    localStorage.setItem('notas-sel-ayuda', '1');
    snackbar('Tocá celdas para sumarlas o quitarlas. Las letras y los números seleccionan columnas y filas enteras.');
  }
}
function finishSelection() {
  selUi.range = false;
  if (editor && !editor.isDestroyed) endSelection(editor);
  hideSelBars();
}

// Devuelve true si se está seleccionando (y deja las barras al día).
function updateSelBars(ed) {
  const info = ed && ed.isEditable && !$('#toolbar').hidden ? selectionInfo(ed) : null;
  if (!info) {
    if (!$('#sel-bar').hidden || $('#view-editor').classList.contains('selecting')) hideSelBars();
    return false;
  }
  $('#sel-bar').hidden = false;
  $('#sel-actions').hidden = false;
  $('#view-editor').classList.add('selecting');
  $('#sel-count').textContent = plural(info.count, 'celda', 'celdas');
  const a = info.anchor;
  $('#sel-row').textContent = a ? `Fila ${a.r + 1}` : 'Fila';
  $('#sel-col').textContent = a ? `Columna ${colName(a.c)}` : 'Columna';
  $('#sel-range').classList.toggle('on', selUi.range);
  document.querySelectorAll('#sel-actions [data-sel]').forEach((b) => { b.disabled = !info.count; });
  scheduleSelHandles();
  return true;
}

// Letras de columna y números de fila alrededor de la tabla (como en una planilla), para tocar filas o columnas enteras.
let handlesRaf = 0;
function scheduleSelHandles() { cancelAnimationFrame(handlesRaf); handlesRaf = requestAnimationFrame(drawSelHandles); }
function drawSelHandles() {
  const layer = $('#sel-handles');
  const s = editor && !editor.isDestroyed && !$('#sel-bar').hidden ? selState(editor) : null;
  let wrap = null;
  try { wrap = s ? editor.view.nodeDOM(s.tablePos) : null; } catch { wrap = null; }
  const tableEl = wrap?.querySelector ? wrap.querySelector('table') : null;
  if (!s || !tableEl || !tableEl.rows.length) { layer.hidden = true; layer.innerHTML = ''; return; }
  const info = selectionInfo(editor);
  const full = { r: new Set(info.fullRows), c: new Set(info.fullCols) };
  const part = { r: new Set(info.rows), c: new Set(info.cols) };
  const base = layer.parentElement.getBoundingClientRect();
  const vis = wrap.getBoundingClientRect();
  const H = 26; const W = 32;
  const rows = Array.from(tableEl.rows);
  const tTop = rows[0].getBoundingClientRect().top;
  const cols = [];
  Array.from(rows[0].cells).forEach((cell) => {
    const r = cell.getBoundingClientRect(); const n = cell.colSpan || 1;
    for (let i = 0; i < n; i++) cols.push({ left: r.left + (r.width * i) / n, right: r.left + (r.width * (i + 1)) / n });
  });
  const cls = (kind, i) => (full[kind].has(i) ? ' on' : part[kind].has(i) ? ' part' : '');
  const html = [];
  const minLeft = vis.left + W + 4;
  cols.forEach((cr, c) => {
    const l = Math.max(cr.left, minLeft); const r = Math.min(cr.right, vis.right);
    if (r - l < 14) return;
    html.push(`<button class="sel-handle${cls('c', c)}" data-hcol="${c}" aria-label="Columna ${colName(c)}" style="left:${Math.round(l - base.left + 1)}px;top:${Math.round(tTop - base.top - H - 3)}px;width:${Math.round(r - l - 2)}px;height:${H}px">${colName(c)}</button>`);
  });
  rows.forEach((tr, i) => {
    const rr = tr.getBoundingClientRect();
    html.push(`<button class="sel-handle${cls('r', i)}" data-hrow="${i}" aria-label="Fila ${i + 1}" style="left:${Math.round(vis.left - base.left + 1)}px;top:${Math.round(rr.top - base.top + 1)}px;width:${W}px;height:${Math.max(18, Math.round(rr.height - 2))}px">${i + 1}</button>`);
  });
  const allOn = info.count === s.rows * s.cols;
  html.push(`<button class="sel-handle corner${allOn ? ' on' : ''}" data-hall="1" aria-label="${allOn ? 'Quitar la selección' : 'Seleccionar toda la tabla'}" style="left:${Math.round(vis.left - base.left + 1)}px;top:${Math.round(tTop - base.top - H - 3)}px;width:${W}px;height:${H}px">${icon('selectAll')}</button>`);
  layer.innerHTML = html.join('');
  layer.hidden = false;
}

function selDoLine(kind, index) {
  const s = selState(editor);
  if (!s) return;
  const hit = kind === 'row' ? { tablePos: s.tablePos, r: index, c: s.anchor?.c ?? 0 } : { tablePos: s.tablePos, r: s.anchor?.r ?? 0, c: index };
  updateSelection(editor, kind, hit);
  haptic();
}

async function selDoCopy(mode = copyModeDefault(), cut = false) {
  const r = selCopy(editor, mode);
  if (!r) { snackbar('No hay celdas seleccionadas'); return; }
  const ok = await clipboardWrite(r.text);
  const shape = mode === 'list' ? `como lista (${plural(r.h, 'renglón', 'renglones')})` : `como bloque (${plural(r.w, 'columna', 'columnas')} × ${plural(r.h, 'fila', 'filas')})`;
  let msg = `${plural(r.count, cut ? 'celda cortada' : 'celda copiada', cut ? 'celdas cortadas' : 'celdas copiadas')} ${shape}`;
  if (!ok) msg += '. No se pudo usar el portapapeles del sistema: se puede pegar dentro de ANote';
  if (cut) { selClear(editor); snackbar(msg, 'Deshacer', undoQuiet); } else snackbar(msg);
}

async function selDoPaste(text) {
  if (!isSelecting()) return;
  if (!selectionInfo(editor).count) { snackbar('Primero seleccioná al menos una celda'); return; }
  if (text === undefined) {
    text = await clipboardRead();
    if (text == null) { openPasteSheet(); return; }
  }
  if (text === '') {
    if (!getCellClip()) { snackbar('El portapapeles está vacío'); return; }
    text = null; // se pega lo último copiado en ANote
  }
  if (!editor || !isSelecting()) return;
  const r = selPaste(editor, text);
  if (!r.ok) {
    snackbar(r.reason === 'merged' ? 'No se puede agrandar la tabla: tiene celdas combinadas' : 'No hay nada para pegar');
    return;
  }
  const p = r.plan;
  let msg;
  if (p.mode === 'fill') msg = `Mismo valor pegado en ${plural(p.cells.length, 'celda', 'celdas')}`;
  else if (p.mode === 'tile') msg = `Bloque repetido en ${plural(p.cells.length, 'celda', 'celdas')}`;
  else if (p.mode === 'order') {
    msg = `${plural(p.used, 'valor pegado', 'valores pegados')} en orden`;
    if (p.total > p.used) msg += ` (sobraron ${p.total - p.used})`;
    else if (p.targets > p.used) msg += ` (${plural(p.targets - p.used, 'celda quedó', 'celdas quedaron')} sin cambiar)`;
  } else msg = `${plural(p.cells.length, 'celda pegada', 'celdas pegadas')}${r.grew ? ' (se agregaron filas o columnas)' : ''}`;
  snackbar(msg, 'Deshacer', undoQuiet);
}

// Si no se puede leer el portapapeles (en la web, el navegador puede negarlo): se pega a mano en un cuadro.
function openPasteSheet() {
  const clip = getCellClip();
  openSheet(`<h2 class="sheet-title">Pegar en la selección</h2>
    <p class="sheet-text">No se pudo leer el portapapeles. Pegá acá lo que copiaste (Ctrl + V, o mantené apretado → Pegar) y tocá «Pegar».</p>
    <textarea id="paste-box" class="paste-box" rows="5" spellcheck="false"></textarea>
    <div class="sheet-actions">${clip ? `<button class="text-btn ripple" id="paste-clip">Lo copiado en ANote (${plural(clip.count, 'celda', 'celdas')})</button>` : ''}<span class="spacer"></span><button class="text-btn ripple" id="paste-cancel">Cancelar</button><button class="filled-btn ripple" id="paste-ok">Pegar</button></div>`, (body) => {
    body.querySelector('#paste-cancel').addEventListener('click', closeOverlays);
    body.querySelector('#paste-ok').addEventListener('click', () => {
      const t = body.querySelector('#paste-box').value;
      closeOverlays();
      if (t) selDoPaste(t); else snackbar('No había nada para pegar');
    });
    body.querySelector('#paste-clip')?.addEventListener('click', () => { closeOverlays(); selDoPaste(null); });
  });
}

function selDoMark(mark) {
  const r = selToggleMark(editor, mark);
  const name = { bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado' }[mark];
  if (r === 'empty') snackbar('Las celdas seleccionadas no tienen texto');
  else if (r) snackbar(`${name} ${r === 'added' ? 'aplicada' : 'quitada'} en la selección`);
}

function selDoClear() {
  const n = selClear(editor);
  if (n) snackbar(`Contenido borrado en ${plural(n, 'celda', 'celdas')}`, 'Deshacer', undoQuiet);
  else snackbar('Las celdas seleccionadas ya estaban vacías');
}

function selDoDelete(kind) {
  const info = selectionInfo(editor);
  if (!info) return;
  const list = kind === 'rows' ? info.rows : info.cols;
  const r = selDeleteLines(editor, kind);
  if (!r.ok) { if (r.reason === 'merged') snackbar('No se puede: la tabla tiene celdas combinadas'); return; }
  hideSelBars();
  const what = r.table ? 'Tabla eliminada (estaban todas seleccionadas)'
    : kind === 'rows' ? `${list.length === 1 ? 'Fila' : 'Filas'} ${listText(list)} ${list.length === 1 ? 'eliminada' : 'eliminadas'}`
      : `${list.length === 1 ? 'Columna' : 'Columnas'} ${listText(list, colName)} ${list.length === 1 ? 'eliminada' : 'eliminadas'}`;
  snackbar(what, 'Deshacer', undoQuiet);
}

function deleteItems(info) {
  if (!info.count) return [];
  return [
    { label: `− Eliminar ${info.rows.length === 1 ? 'la fila' : 'las filas'} ${listText(info.rows)}`, onClick: () => selDoDelete('rows') },
    { label: `− Eliminar ${info.cols.length === 1 ? 'la columna' : 'las columnas'} ${listText(info.cols, colName)}`, onClick: () => selDoDelete('cols') },
  ];
}

// Menú de la selección: al mantener apretada una celda (o clic derecho) mientras se selecciona, o desde «N celdas».
function openSelMenu(anchor, fromPress = false) {
  if (!isSelecting()) return;
  if (fromPress) haptic();
  const info = selectionInfo(editor);
  const def = copyModeDefault(); const other = def === 'block' ? 'list' : 'block';
  const has = info.count > 0;
  const items = [
    { label: `${icon('copy')} Copiar ${COPY_MODE_LABEL[def]}`, disabled: !has, onClick: () => selDoCopy(def) },
    { label: `${icon('copy')} Copiar ${COPY_MODE_LABEL[other]}`, disabled: !has, onClick: () => selDoCopy(other) },
    { label: `Cortar ${COPY_MODE_LABEL[def]}`, disabled: !has, onClick: () => selDoCopy(def, true) },
    { label: 'Pegar', disabled: !has, onClick: () => selDoPaste() },
    { divider: true },
    { label: `${icon('palette')} Color de fondo y alineación…`, disabled: !has, onClick: () => openSelFormatSheet() },
    { label: `${icon('bold')} Negrita`, disabled: !has, onClick: () => selDoMark('bold') },
    { label: `${icon('italic')} Cursiva`, disabled: !has, onClick: () => selDoMark('italic') },
    { label: `${icon('underline')} Subrayado`, disabled: !has, onClick: () => selDoMark('underline') },
    { label: 'Borrar el contenido', disabled: !has, onClick: selDoClear },
    { divider: true },
    ...deleteItems(info),
    ...(has ? [{ divider: true }] : []),
    { label: 'Seleccionar toda la tabla', onClick: () => updateSelection(editor, 'all') },
    { label: 'Invertir la selección', onClick: () => updateSelection(editor, 'invert') },
    { label: `${icon('settings')} Modo de copiado por defecto…`, onClick: showCopyModeSettings },
    { divider: true },
    { label: `${icon('check')} Terminar la selección`, onClick: finishSelection },
  ];
  openMenu(anchor, items);
  $('#menu').classList.add('cell-menu');
  if (fromPress) cellMenuAt = Date.now();
}

// Panel con color de fondo y alineación para las celdas seleccionadas.
function openSelFormatSheet({ keepScroll = false } = {}) {
  if (!isSelecting()) return;
  const prev = $('#sheet').scrollTop;
  const cur = selCommonAttrs(editor);
  const n = selectionInfo(editor).count;
  const hBtns = ALIGN_H.map((a) => `<button class="tool ripple${cur.align === a ? ' active' : ''}" data-align="${a}" aria-label="${H_LABEL[a]}" title="${H_LABEL[a]}">${icon(`align${a}`)}</button>`).join('');
  const vBtns = ALIGN_V.map((a) => `<button class="tool ripple${cur.valign === a ? ' active' : ''}" data-valign="${a}" aria-label="${V_LABEL[a]}" title="${V_LABEL[a]}">${icon(`valign${a}`)}</button>`).join('');
  const bgBtns = `<button class="tbl-swatch tbl-swatch-none ripple${cur.bg === null ? ' on' : ''}" data-bgset="" aria-label="Sin color" title="Sin color">${icon('block')}</button>`
    + CELL_BG.map(([k, l]) => `<button class="tbl-swatch ripple${cur.bg === k ? ' on' : ''}" data-bg="${k}" data-bgset="${k}" aria-label="${l}" title="${l}">${cur.bg === k ? icon('check') : ''}</button>`).join('');
  openSheet(`<h2 class="sheet-title">${icon('palette')} Selección <small class="ver">${plural(n, 'celda', 'celdas')}</small></h2>
    <div class="tbl-group"><h3>Color de fondo</h3><div class="tbl-swatches" role="group" aria-label="Color de fondo">${bgBtns}</div></div>
    <div class="tbl-group"><h3>Alineación</h3>
      <div class="tbl-align-row"><span>Horizontal</span>${hBtns}</div>
      <div class="tbl-align-row"><span>Vertical</span>${vBtns}</div>
    </div>
    <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="self-ok">Listo</button></div>`, (body) => {
    const again = () => requestAnimationFrame(() => openSelFormatSheet({ keepScroll: true }));
    body.querySelectorAll('[data-bgset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.bgset || null;
      selApplyAttrs(editor, { bg: k }); again();
      snackbar(k ? `Fondo ${BG_LABEL[k].toLowerCase()} en la selección` : 'Selección sin color de fondo');
    }));
    body.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => { selApplyAttrs(editor, { align: b.dataset.align }); again(); }));
    body.querySelectorAll('[data-valign]').forEach((b) => b.addEventListener('click', () => { selApplyAttrs(editor, { valign: b.dataset.valign }); again(); }));
    body.querySelector('#self-ok').addEventListener('click', closeOverlays);
  });
  if (keepScroll) $('#sheet').scrollTop = prev;
}

// Ajuste: cómo se copia por defecto (también se puede elegir en el momento, desde el menú de la selección).
function showCopyModeSettings() {
  const cur = copyModeDefault();
  const opts = [
    ['block', 'Como bloque', 'Se copian como en una planilla: las filas y columnas que tienen algo seleccionado, una al lado de la otra (las que no tienen nada se saltean). Las celdas sin seleccionar dentro del bloque quedan vacías. Ej.: A1 y C3 → un bloque de 2 × 2 con dos huecos.'],
    ['list', 'Como lista', 'Un valor por renglón, en orden de lectura (fila por fila, de izquierda a derecha). Ej.: A1 y C3 → dos renglones.'],
  ];
  openSheet(`<h2 class="sheet-title">Copiar celdas</h2>
    <p class="sheet-text">Cómo se copian por defecto las celdas seleccionadas. Desde el menú de la selección siempre podés elegir el otro modo en el momento.</p>
    <div class="picker-list">${opts.map(([k, l, d]) => `<button class="picker-item ripple copy-mode" data-mode="${k}"><span class="radio${k === cur ? ' on' : ''}"></span><span><strong>${l}</strong><br><small>${d}</small></span></button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      state.repo.saveSettings({ cellCopyMode: mode });
      state.org.settings.cellCopyMode = mode;
      body.querySelectorAll('[data-mode]').forEach((x) => x.querySelector('.radio').classList.toggle('on', x.dataset.mode === mode));
      renderDrawer();
      snackbar(`Las celdas se copian ${COPY_MODE_LABEL[mode]}`);
    }));
  });
}

function overlayOpen() { return !$('#menu').hidden || $('#sheet').classList.contains('open') || !$('#dialog').hidden; }

function bindSelection() {
  const host = $('#editor');
  let tap = null;
  // pointerdown + preventDefault: tocar una celda no pone el cursor ni abre el teclado (sí se puede desplazar).
  host.addEventListener('pointerdown', (e) => {
    tap = null;
    if (!editor || !editor.isEditable || $('#toolbar').hidden) return;
    const cellEl = e.target.closest?.('td, th');
    if (!isSelecting()) {
      // PC: Ctrl + clic en una celda empieza a seleccionar (con la celda del cursor y la tocada).
      if (!cellEl || !(e.ctrlKey || e.metaKey) || e.button !== 0) return;
      const hit = cellAtDom(editor, cellEl);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      const ctx = tableContext(editor.state);
      if (ctx && ctx.tablePos === hit.tablePos && ctx.cellPos != null) {
        beginSelection();
        if (ctx.rect.top !== hit.r || ctx.rect.left !== hit.c) updateSelection(editor, 'toggle', hit);
      } else beginSelection(hit);
      tap = { skip: true };
      return;
    }
    if (!cellEl) {
      if (e.target.closest?.('.tbl-selecting')) e.preventDefault(); // borde de la tabla: no hace nada
      else finishSelection(); // tocar fuera de la tabla termina la selección (y pone el cursor ahí)
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    tap = { cellEl, shift: e.shiftKey };
  }, true);
  host.addEventListener('mousedown', (e) => {
    if (isSelecting() && e.target.closest?.('.tbl-selecting')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  host.addEventListener('click', (e) => {
    const t = tap; tap = null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.skip || !isSelecting()) return;
    const hit = cellAtDom(editor, t.cellEl);
    if (!hit) return;
    const op = (t.shift || selUi.range) ? 'range' : 'toggle';
    selUi.range = false;
    updateSelection(editor, op, hit);
  }, true);
  // Por las dudas: si el editor recibe el foco mientras se selecciona, se lo saca (así no se abre el teclado).
  host.addEventListener('focusin', () => {
    if (!isSelecting()) return;
    editor.view.dom.blur();
    hideKeyboard();
  });
  // Las letras y los números se vuelven a ubicar al desplazar la tabla de costado o al cambiar el tamaño.
  host.addEventListener('scroll', () => { if (isSelecting()) scheduleSelHandles(); }, true);
  window.addEventListener('resize', () => { if (isSelecting()) scheduleSelHandles(); });
  window.addEventListener('kbchange', () => { if (isSelecting()) scheduleSelHandles(); });

  const handles = $('#sel-handles');
  handles.addEventListener('pointerdown', (e) => e.preventDefault());
  handles.addEventListener('click', (e) => {
    const b = e.target.closest('.sel-handle');
    if (!b || !isSelecting()) return;
    if (b.dataset.hcol != null) selDoLine('col', +b.dataset.hcol);
    else if (b.dataset.hrow != null) selDoLine('row', +b.dataset.hrow);
    else if (b.dataset.hall) { const s = selState(editor); updateSelection(editor, s.cells.size === s.rows * s.cols ? 'none' : 'all'); haptic(); }
  });

  // Barras de la selección
  document.querySelectorAll('#sel-bar [data-sel], #sel-actions [data-sel]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (!isSelecting()) return;
      const cmd = b.dataset.sel;
      const s = selState(editor);
      switch (cmd) {
        case 'menu': openSelMenu(b); break;
        case 'done': finishSelection(); break;
        case 'row': if (s.anchor) selDoLine('row', s.anchor.r); else snackbar('Tocá primero una celda de la fila'); break;
        case 'col': if (s.anchor) selDoLine('col', s.anchor.c); else snackbar('Tocá primero una celda de la columna'); break;
        case 'range':
          selUi.range = !selUi.range;
          b.classList.toggle('on', selUi.range);
          if (selUi.range) snackbar(s.anchor ? `Tocá otra celda: se selecciona el rectángulo desde ${colName(s.anchor.c)}${s.anchor.r + 1}` : 'Tocá dos celdas: se selecciona el rectángulo entre ellas');
          break;
        case 'all': case 'invert': case 'none': updateSelection(editor, cmd); break;
        case 'copy': selDoCopy(); break;
        case 'cut': selDoCopy(copyModeDefault(), true); break;
        case 'paste': selDoPaste(); break;
        case 'format': openSelFormatSheet(); break;
        case 'bold': case 'italic': case 'underline': selDoMark(cmd); break;
        case 'clear': selDoClear(); break;
        case 'delete': {
          const items = deleteItems(selectionInfo(editor));
          if (items.length) openMenu(b, items);
          break;
        }
        default: break;
      }
    });
  });

  // PC: atajos de teclado mientras se selecciona.
  const typing = (t) => t && t.closest?.('input, textarea, select');
  let pasteWait = null;
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'editor' || !isSelecting() || overlayOpen() || typing(e.target)) return;
    const k = e.key; const mod = e.ctrlKey || e.metaKey;
    if (k === 'Escape') { e.preventDefault(); finishSelection(); return; }
    if ((k === 'Delete' || k === 'Backspace') && !mod) { e.preventDefault(); selDoClear(); return; }
    if (!mod) return;
    const l = k.toLowerCase();
    if (l === 'a') { e.preventDefault(); updateSelection(editor, 'all'); return; }
    if (l === 'c') { e.preventDefault(); selDoCopy(); return; }
    if (l === 'x') { e.preventDefault(); selDoCopy(copyModeDefault(), true); return; }
    if (l === 'b' || l === 'i' || l === 'u') { e.preventDefault(); selDoMark({ b: 'bold', i: 'italic', u: 'underline' }[l]); return; }
    // Ctrl + V: se usa el evento "paste" (trae el texto sin pedir permiso); si no llega, se lee el portapapeles.
    if (l === 'v') { clearTimeout(pasteWait); pasteWait = setTimeout(() => { pasteWait = null; selDoPaste(); }, 250); }
  });
  document.addEventListener('paste', (e) => {
    if (state.view !== 'editor' || !isSelecting() || overlayOpen() || typing(e.target)) return;
    clearTimeout(pasteWait); pasteWait = null;
    e.preventDefault();
    selDoPaste(e.clipboardData ? e.clipboardData.getData('text/plain') : undefined);
  });
  // Escribir el título termina la selección.
  $('#note-title').addEventListener('focus', () => { if (isSelecting()) finishSelection(); });
}

/* ---------- Acciones del editor ---------- */
function bindEditorUi() {
  bindTableBar();
  bindCellPress();
  bindSelection();
  // Tocar debajo de una tabla (o imagen) que está al final de la nota, o entre el título y una que está al principio:
  // renglón nuevo con el cursor y el teclado.
  $('#editor-scroll').addEventListener('click', (e) => {
    if (!editor || !editor.isEditable || $('#toolbar').hidden) return;
    if (e.target.closest?.('td, th, a, button, input, img, #link-previews, .edited, #trash-banner')) return;
    const doc = editor.state.doc;
    const dom = editor.view.dom;
    const first = dom.firstElementChild;
    const last = dom.lastElementChild;
    if (first && needsLeadingParagraph(doc) && e.clientY < first.getBoundingClientRect().top
      && e.clientY > $('#note-title').getBoundingClientRect().bottom) { writeAtStart(editor); return; }
    if (last && needsTrailingParagraph(doc) && e.clientY > last.getBoundingClientRect().bottom) writeAtEnd(editor);
  });
  // pointerdown + preventDefault: el foco queda en el texto y el teclado no se cierra.
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (!editor) return;
      if (b.dataset.cmd === 'image') { $('#file-image').click(); return; }
      if (b.dataset.cmd === 'table') { openTableUi(); return; }
      runCommand(editor, b.dataset.cmd);
    });
  });

  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    try {
      const { url, kb } = await compressImage(file);
      const src = await storeImage(state.current.id, url);
      editor.chain().focus().setImage({ src }).createParagraphNear().run();
      snackbar(`Imagen agregada (${kb} KB)`);
    } catch {
      snackbar('No se pudo cargar la imagen');
    }
  });

  $('#note-title').addEventListener('input', () => {
    const s = state.current?.session;
    if (s) applyTextDiff(s.titleText, $('#note-title').value);
    markDirty();
  });
  $('#note-title').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!editor) return;
    // Si la nota empieza con una tabla (o imagen), Enter crea un renglón arriba en vez de entrar a la primera celda.
    if (editor.isEditable && needsLeadingParagraph(editor.state.doc)) writeAtStart(editor);
    else editor.commands.focus('start');
  });

  $('#editor').addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) haptic();
  });

  $('#btn-back').addEventListener('click', goBack);
  $('#btn-reminder').addEventListener('click', () => openReminderSheet(state.current.id));
  $('#btn-share').addEventListener('click', () => openShareSheet(state.current.id));
  $('#invites-action').addEventListener('click', showInvites);

  $('#btn-pin').addEventListener('click', () => {
    const c = state.current;
    c.pinned = !c.pinned;
    haptic();
    paintEditorChrome();
    state.repo.setMeta(c.id, { pinned: c.pinned });
    snackbar(c.pinned ? 'Nota fijada' : 'Nota sin fijar');
  });

  $('#btn-color').addEventListener('click', () => openColorSheet([state.current.id]));

  $('#btn-restore').addEventListener('click', () => {
    const c = state.current;
    restoreNotes([c.id]);
    c.trashed = false; paintEditorChrome();
  });

  $('#btn-menu-editor').addEventListener('click', (e) => {
    const c = state.current;
    if (!c) return;
    const items = c.trashed ? [
      { label: 'Restaurar', onClick: () => { restoreNotes([c.id]); c.trashed = false; paintEditorChrome(); } },
      { label: 'Eliminar definitivamente', onClick: async () => { const id = c.id; if (await deleteForever([id])) goBack(); } },
    ] : [
      { label: 'Compartir Acceso → Invitar Usuario', onClick: () => openShareSheet(c.id) },
      { label: 'Copiar (o Enviar) Link', onClick: () => openLinkSheet(c.id) },
      { label: 'Carpetas…', onClick: () => openPicker([c.id], 'folders') },
      { label: 'Etiquetas…', onClick: () => openPicker([c.id], 'labels') },
      ...(noteFolders(c).length ? [{ label: 'Ver en qué carpetas está', onClick: () => showOccurrences(c.id) }] : []),
      { divider: true },
      { label: c.archived ? 'Desarchivar' : 'Archivar', onClick: () => { const id = c.id; const v = !c.archived; goBack(); archiveNotes([id], v); } },
      ...(c.template ? [] : [noteById(c.id)?.hidden
        ? { label: 'Mostrar en la pantalla principal', onClick: () => hideNotes([c.id], false) }
        : { label: 'Ocultar de la pantalla principal', onClick: () => hideNotes([c.id], true) }]),
      { label: 'Estadísticas e Info de la nota', onClick: () => showNoteStats(c.id) },
      { label: 'Historial de versiones', onClick: () => showVersions(c.id) },
      { label: 'Enviar… (a través de →)', onClick: () => openSendSheet([c.id]) },
      { label: 'Exportar y Descargar…', onClick: () => openExportSheet([c.id]) },
      { label: (noteById(c.id)?.locked ? 'Quitar el bloqueo' : 'Bloquear con huella'), onClick: () => setLocked([c.id], !noteById(c.id)?.locked) },
      { label: 'Copiar nota', onClick: async () => { await saveSummaryNow(); copyNotes([c.id]); } },
      c.template
        ? { label: 'Usar esta plantilla', onClick: async () => { await saveSummaryNow(); const id = c.id; goBack(); setTimeout(() => useTemplate(id), 250); } }
        : { label: 'Guardar como plantilla', onClick: async () => { await saveSummaryNow(); copyNotes([c.id], { asTemplate: true }); } },
      { label: 'Enviar a la papelera', onClick: deleteCurrent },
    ];
    openMenu(e.currentTarget, items);
  });

  [['#list-scroll', '#appbar-list'], ['#editor-scroll', '#appbar-editor']].forEach(([s, a]) => {
    $(s).addEventListener('scroll', () => $(a).classList.toggle('scrolled', $(s).scrollTop > 2), { passive: true });
  });

  window.addEventListener('kbchange', () => {
    if (state.view === 'editor' && editor?.isFocused) setTimeout(() => editor?.commands.scrollIntoView(), 60);
    // Campos de un panel (correo y contraseña): que el teclado no los tape
    const a = document.activeElement;
    if (a && $('#sheet').classList.contains('open') && $('#sheet').contains(a)) setTimeout(() => a.scrollIntoView({ block: 'center' }), 80);
  });
}

// Eliminar = mandar a la papelera (es personal; la nota no se borra para otros).
function deleteCurrent() {
  const id = state.current.id;
  goBack();
  trashNotes([id]);
}

/* ---------- Menú de la lista: tema y versión ---------- */
$('#btn-menu-list').addEventListener('click', (e) => {
  const pref = themePref();
  const setTheme = (t) => { localStorage.setItem('notas-theme', t); applyTheme(); };
  const f = state.filter;
  const ctx = f.kind === 'folder' ? [
    { label: 'Nueva subcarpeta', onClick: () => newFolder(f.id) },
    { label: 'Renombrar carpeta', onClick: () => renameFolder(f.id) },
    { label: 'Eliminar carpeta', onClick: () => deleteFolder(f.id) },
    { divider: true },
  ] : f.kind === 'label' ? [
    { label: 'Editar etiqueta', onClick: () => editLabel(f.id) },
    { label: 'Eliminar etiqueta', onClick: () => deleteLabel(f.id) },
    { divider: true },
  ] : f.kind === 'trash' ? [
    { label: 'Vaciar papelera', onClick: emptyTrash },
    { label: 'Plazo de la papelera', onClick: showTrashSettings },
    { divider: true },
  ] : [];
  openMenu(e.currentTarget, [
    ...ctx,
    { label: 'Ordenar por…', onClick: showSortSheet },
    { label: 'Nueva nota desde plantilla…', onClick: pickTemplate },
    { label: 'Vista de la lista (compacta / estándar)…', onClick: showListSettings },
    { label: 'Exportar y Descargar todas las notas…', onClick: () => openExportSheet(state.notes.filter((n) => !n.trashed).map((n) => n.id)) },
    { label: 'Importar notas…', onClick: pickImportFiles },
    { label: 'Vista previa de links', checked: previewsEnabled(), onClick: () => { setPreviewsEnabled(!previewsEnabled()); snackbar(previewsEnabled() ? 'Vista previa de links activada' : 'Vista previa de links desactivada'); } },
    { divider: true },
    { label: 'Tema del sistema', checked: pref === 'system', onClick: () => setTheme('system') },
    { label: 'Tema claro', checked: pref === 'light', onClick: () => setTheme('light') },
    { label: 'Tema oscuro', checked: pref === 'dark', onClick: () => setTheme('dark') },
    { divider: true },
    { label: `Versión ${APP_VERSION}`, onClick: showVersion },
  ]);
});

// Android y WebView (Chromium) del equipo: sirve para saber si una tablet vieja tiene la WebView actualizada.
function deviceInfo() {
  const ua = navigator.userAgent;
  const android = (/Android ([\d.]+)/.exec(ua) || [])[1];
  const chrome = (/Chrome\/(\d+)/.exec(ua) || [])[1];
  if (!android) return '';
  return `Android ${android}${chrome ? ` · ${isNative ? 'WebView' : 'Chrome'} ${chrome}` : ''}`;
}

function showVersion() {
  const r = state.release;
  openSheet(`
    <h2 class="sheet-title">${BRAND} <small class="ver">v${esc(APP_VERSION)}</small></h2>
    <p class="sheet-text">${isNative ? 'App Android' : 'Versión web'} · tablas dentro de las notas</p>
    ${deviceInfo() ? `<p class="sheet-text">Equipo: ${esc(deviceInfo())}</p>` : ''}
    <p class="sheet-text">Archivo más reciente de la Release${r?.tag ? ` ${esc(r.tag)}` : ''}: <strong>${formatDate(r?.fileDate)}</strong></p>
    <a class="text-btn" href="${CHANGELOG_URL}" target="_blank" rel="noopener">Ver Changelog</a>
  `);
}
$('#btn-version').addEventListener('click', showVersion);

/* ---------- Cuenta y sincronización ---------- */
$('#btn-sync').addEventListener('click', () => {
  if (state.mode === 'cloud') {
    const u = state.user;
    const st = syncSummary();
    const label = $('#btn-sync').getAttribute('aria-label');
    const fine = st.kind === 'ok';
    openSheet(`
      <h2 class="sheet-title">Tu cuenta y sincronización</h2>
      <p class="sheet-text"><strong>${esc(displayName(u))}</strong><br>${esc(u.email || '')}<br>${esc(accountKind(u))}</p>
      ${hasPassword(u) && !passwordVerified(u) ? `<p class="login-hint warn-hint">Falta verificar el correo ${esc(passwordEmail(u))}. Hasta entonces no ves lo que te compartan.</p>` : ''}
      <div class="sync-lines">
        <p>${icon(fine ? 'cloudDone' : st.kind === 'syncing' ? 'cloudUp' : 'cloudOff')}<span>${esc(label)}</span></p>
        <p>${icon('history')}<span>Última verificación con el servidor: ${esc(ago(state.repo.lastServerAt))}</span></p>
        ${st.pendingNotes ? `<p>${icon('note')}<span>${st.pendingNotes} nota${st.pendingNotes > 1 ? 's' : ''} con cambios de este dispositivo por subir</span></p>` : ''}
      </div>
      <div class="sheet-actions"><button class="text-btn ripple" id="btn-security">${icon('lock')}<span>Seguridad de la cuenta</span></button></div>
      <div class="sheet-actions"><button class="text-btn ripple" id="btn-signout">Cerrar sesión</button><span class="spacer"></span>
        ${fine ? '' : '<button class="filled-btn ripple" id="btn-sync-now">Reintentar ahora</button>'}</div>
    `, (body) => {
      body.querySelector('#btn-signout').addEventListener('click', doSignOut);
      body.querySelector('#btn-security').addEventListener('click', showAccountSecurity);
      body.querySelector('#btn-sync-now')?.addEventListener('click', () => { closeOverlays(); syncNow(); });
    });
  } else {
    openSheet(`
      <h2 class="sheet-title">Sin cuenta</h2>
      <p class="sheet-text">Tus notas se guardan solo en este dispositivo y no se sincronizan.</p>
      <button class="text-btn ripple" id="btn-signin">Iniciar sesión con Google</button>
      <button class="text-btn ripple" id="btn-signin-email">Entrar con correo y contraseña</button>
    `, (body) => {
      body.querySelector('#btn-signin')?.addEventListener('click', () => { closeOverlays(); doSignIn({ reload: true }); });
      body.querySelector('#btn-signin-email')?.addEventListener('click', () => openEmailSheet('signin', { reload: true }));
    });
  }
});

async function doSignOut() {
  closeOverlays();
  await closeEditor();
  localStorage.removeItem('notas-mode');
  await signOutUser();
  location.replace(location.pathname);
}

/* ---------- Modos: con cuenta (nube) o sin cuenta (local) ---------- */
function startRepo(repo, mode) {
  state.startedAt = Date.now();
  state.repo = repo;
  state.mode = mode;
  state.firstList = true;
  repo.onChange = () => { updateSyncIcon(); updateNoteStatus(); };
  repo.subscribe(onList);
  repo.subscribeOrg(onOrg);
  repo.subscribeReminders(onReminders);
  repo.subscribeInvites(onInvites);
  repo.subscribeAccessRequests(onAccessRequests);
  updateSyncIcon();
  setView('list');
}

function startCloud(user) {
  if (state.mode === 'cloud' && state.user?.uid === user.uid) return;
  state.user = user;
  localStorage.setItem('notas-mode', 'cloud');
  if (user.displayName) localStorage.removeItem('notas-pending-name');
  // Sin el correo verificado (cuenta con contraseña), no se buscan invitaciones: las reglas no las dejan ver.
  const verified = !hasPassword(user) || hasGoogle(user) || passwordVerified(user);
  startRepo(new CloudRepo(fb().db, user.uid, { name: displayName(user), email: user.email, verified }), 'cloud');
  updateVerifyBanner();
  checkSession();
}

// Nombre visible: el de la cuenta, el que se escribió al registrarse (si todavía no llegó) o el del correo.
function displayName(u) {
  return u?.displayName || localStorage.getItem('notas-pending-name') || String(u?.email || '').split('@')[0];
}
function hasPasswordOnly(u = state.user) { return hasPassword(u) && !hasGoogle(u); }
function accountKind(u) {
  if (hasPasswordOnly(u)) return 'Entrás con la contraseña propia de ANote';
  if (hasPassword(u)) return 'Entrás con Google o con la contraseña propia de ANote (cambio sin terminar)';
  return 'Entrás con Google';
}

// Al abrir: si esta sesión es de Google y la cuenta pasó a contraseña propia (en otro dispositivo), se cierra.
async function checkSession() {
  if (await googleSessionBlocked()) {
    await closeEditor();
    localStorage.removeItem('notas-mode');
    localStorage.setItem('notas-password-only', '1');
    await signOutUser();
    sessionStorage.setItem('notas-login-msg', 'Tu cuenta ahora usa la contraseña propia de ANote: entrá con «Entrar con correo».');
    location.replace(location.pathname);
    return;
  }
  // Cuenta con contraseña sin verificar: al volver a abrir, se mira si ya se verificó (sin molestar si falla).
  const u = state.user;
  if (hasPassword(u) && !passwordVerified(u) && navigator.onLine) {
    try { const fresh = await refreshUser(); if (fresh && passwordVerified(fresh)) onVerified(); } catch { /* nada */ }
  }
}

function startLocal() {
  if (state.mode === 'local') return;
  localStorage.setItem('notas-mode', 'local');
  startRepo(new LocalRepo(), 'local');
}

function showLogin() {
  state.mode = null;
  $('#login-link-hint').hidden = !parseNoteHash();
  const msg = sessionStorage.getItem('notas-login-msg');
  sessionStorage.removeItem('notas-login-msg');
  const pw = localStorage.getItem('notas-password-only');
  $('#login-pw-hint').textContent = msg || 'En este dispositivo entraste con la contraseña propia de ANote: usá «Entrar con correo».';
  $('#login-pw-hint').hidden = !msg && !pw;
  setView('login');
}

// Inicio de sesión con Google: aviso inmediato, límite de espera y detalle del error.
async function doSignIn({ reload = false } = {}) {
  snackbar('Abriendo Google…');
  let timer;
  try {
    await Promise.race([
      signInGoogle(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('Google no respondió en 45 segundos'), { code: 'timeout' })), 45000); }),
    ]);
    hideSnack();
    localStorage.removeItem('notas-password-only');
    state.pendingSecTip = true; // aviso de seguridad, cuando lleguen los ajustes (por si eligió no verlo más)
    if (reload) { sessionStorage.setItem('notas-sec-tip', '1'); location.reload(); }
  } catch (e) {
    console.error('Inicio de sesión', e);
    const m = authErrorMessage(e);
    if (m) snackbar(m, 'Ver detalle', () => openSheet(`<h2 class="sheet-title">Detalle del error</h2><pre class="error-detail">${esc(errorDetail(e))}</pre>`));
    else hideSnack();
  } finally { clearTimeout(timer); }
}

$('#btn-google').addEventListener('click', async () => {
  const b = $('#btn-google');
  b.disabled = true;
  try { await doSignIn(); } finally { b.disabled = false; }
});
$('#btn-local').addEventListener('click', startLocal);
$('#btn-email').addEventListener('click', () => openEmailSheet('signin'));

/* ---------- Correo y contraseña propia de ANote ---------- */
const TWOSV_URL = 'https://myaccount.google.com/signinoptions/twosv';
const PW_OPTION_TEXT = "Contraseña propia de ANote: recomendable si tu cuenta de Google no tiene la 'Verificación en 2 Pasos'. Usá un correo distinto de ese Gmail (y, si podés, con 'Verificación en 2 Pasos' o 'Doble Factor de Autenticación' 2FA ), y una contraseña que no uses en otro lado.";
const PW_RULES = 'Mínimo 10 caracteres, con letras y números. Que no la uses en otro lado.';

function accountError(e, fallback) {
  console.error(fallback, e);
  const m = authErrorMessage(e) || fallback;
  snackbar(m, 'Ver detalle', () => openSheet(`<h2 class="sheet-title">Detalle del error</h2><pre class="error-detail">${esc(errorDetail(e))}</pre>`));
}

async function askPassword(title = 'Confirmá tu contraseña de ANote', text = '') {
  const r = await openDialog({ title, text, input: true, password: true, placeholder: 'Contraseña', ok: 'Confirmar' });
  return r?.value || null;
}

// Campo de contraseña con botón "mostrar".
const pwField = (id, label, autocomplete) => `
  <label class="field pw-field"><span>${label}</span>
    <span class="pw-wrap"><input type="password" id="${id}" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false">
    <button type="button" class="icon-btn small ripple pw-eye" data-eye="${id}" aria-label="Mostrar contraseña">${icon('visibility')}</button></span>
  </label>`;
function bindEyes(body) {
  body.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
    const inp = body.querySelector(`#${b.dataset.eye}`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = icon(show ? 'visibilityOff' : 'visibility');
    b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  }));
}
const isGmail = (e) => /@(gmail|googlemail)\.com$/i.test(String(e || '').trim());

// Entrar, crear cuenta u olvidé mi contraseña (en un panel, desde la pantalla de inicio).
function openEmailSheet(mode = 'signin', { reload = false, email = '' } = {}) {
  const titles = { signin: 'Entrar con correo', signup: 'Crear cuenta con correo', reset: 'Olvidé mi contraseña' };
  const body = {
    signin: `
      <label class="field"><span>Correo</span><input type="email" id="em-email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(email)}"></label>
      ${pwField('em-pass', 'Contraseña', 'current-password')}
      <div class="sheet-actions"><button class="text-btn ripple" data-go="reset">Olvidé mi contraseña</button><span class="spacer"></span>
        <button class="filled-btn ripple" id="em-ok">Entrar</button></div>
      <p class="sheet-text em-switch">¿No tenés cuenta? <button class="text-btn ripple" data-go="signup">Crear cuenta</button></p>`,
    signup: `
      <p class="sheet-text">${esc(PW_OPTION_TEXT)}</p>
      <label class="field"><span>Nombre visible (se ve al compartir notas)</span><input type="text" id="em-name" autocomplete="name" autocapitalize="words"></label>
      <label class="field"><span>Correo</span><input type="email" id="em-email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(email)}"></label>
      ${pwField('em-pass', 'Contraseña', 'new-password')}
      ${pwField('em-pass2', 'Repetir la contraseña', 'new-password')}
      <p class="sheet-text">${PW_RULES} Te vamos a mandar un correo para verificarlo (puede caer en spam).</p>
      <p class="login-hint warn-hint" id="em-gmail" hidden>Es un Gmail: quien sepa tu contraseña de Google podría leer ese correo y cambiar la de ANote. Si podés, usá otro correo.</p>
      <div class="sheet-actions"><button class="text-btn ripple" data-go="signin">Ya tengo cuenta</button><span class="spacer"></span>
        <button class="filled-btn ripple" id="em-ok">Crear cuenta</button></div>`,
    reset: `
      <p class="sheet-text">Te mandamos un correo con un link para elegir una contraseña nueva (puede caer en spam). Si tu cuenta es de Google, no hace falta: usá «Continuar con Google».</p>
      <label class="field"><span>Correo</span><input type="email" id="em-email" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(email)}"></label>
      <div class="sheet-actions"><button class="text-btn ripple" data-go="signin">Volver</button><span class="spacer"></span>
        <button class="filled-btn ripple" id="em-ok">Enviar el correo</button></div>`,
  }[mode];
  openSheet(`<h2 class="sheet-title">${titles[mode]}</h2><div class="em-form">${body}</div>`, (root) => {
    const b = root.querySelector('.em-form');
    const val = (id) => b.querySelector(`#${id}`)?.value || '';
    bindEyes(b);
    b.querySelectorAll('[data-go]').forEach((x) => x.addEventListener('click', () => openEmailSheet(x.dataset.go, { reload, email: val('em-email') })));
    b.querySelector('#em-email').addEventListener('input', () => { const g = b.querySelector('#em-gmail'); if (g) g.hidden = !isGmail(val('em-email')); });
    const ok = b.querySelector('#em-ok');
    const run = async () => {
      const email = val('em-email').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { snackbar('Escribí un correo válido'); b.querySelector('#em-email').focus(); return; }
      ok.disabled = true;
      try {
        if (mode === 'signin') {
          if (!val('em-pass')) { snackbar('Falta la contraseña'); b.querySelector('#em-pass').focus(); return; }
          snackbar('Entrando…');
          await signInEmail(email, val('em-pass'));
          localStorage.setItem('notas-password-only', '1');
          hideSnack(); closeOverlays();
          if (reload) location.reload();
        } else if (mode === 'signup') {
          const name = val('em-name').trim();
          if (!name) { snackbar('Escribí tu nombre visible'); b.querySelector('#em-name').focus(); return; }
          const prob = passwordProblem(val('em-pass'), email);
          if (prob) { snackbar(prob); b.querySelector('#em-pass').focus(); return; }
          if (val('em-pass') !== val('em-pass2')) { snackbar('Las contraseñas no coinciden'); b.querySelector('#em-pass2').focus(); return; }
          snackbar('Creando la cuenta…');
          localStorage.setItem('notas-pending-name', name);
          await signUpEmail(name, email, val('em-pass'));
          if (state.repo?.profile) state.repo.profile.name = name;
          localStorage.setItem('notas-password-only', '1');
          closeOverlays();
          if (reload) { location.reload(); return; }
          showVerifySheet(email, true);
        } else {
          await resetPassword(email);
          openSheet(`<h2 class="sheet-title">Correo enviado</h2>
            <p class="sheet-text">Si ${esc(email)} tiene una cuenta de ANote con contraseña, te llega un correo para elegir una nueva (mirá también en spam). Después entrá con la contraseña nueva.</p>
            <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="em-back">Entrar</button></div>`,
          (r2) => r2.querySelector('#em-back').addEventListener('click', () => openEmailSheet('signin', { reload, email })));
        }
      } catch (e) {
        if (mode === 'signup') localStorage.removeItem('notas-pending-name');
        accountError(e, mode === 'signin' ? 'No se pudo entrar' : mode === 'signup' ? 'No se pudo crear la cuenta' : 'No se pudo enviar el correo');
      } finally { ok.disabled = false; }
    };
    ok.addEventListener('click', run);
    b.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }));
    setTimeout(() => b.querySelector(mode === 'signup' ? '#em-name' : email && mode === 'signin' ? '#em-pass' : '#em-email')?.focus(), 80);
  });
}

// Panel "Verificá tu correo" (después de crear la cuenta o de agregar la contraseña).
function showVerifySheet(email, isNew = false) {
  openSheet(`<h2 class="sheet-title">Verificá tu correo</h2>
    <p class="sheet-text">${isNew ? 'Ya podés usar ANote. ' : ''}Te mandamos un correo a <strong>${esc(email)}</strong> con un link para verificarlo (si no está, mirá en spam). Tocá el link y después «Ya lo verifiqué».</p>
    <p class="sheet-text">Hasta verificarlo no ves las notas que te compartan, porque se comparten por correo.</p>
    <div class="sheet-actions"><button class="text-btn ripple" id="vf-resend">Reenviar el correo</button><span class="spacer"></span>
      <button class="filled-btn ripple" id="vf-done">Ya lo verifiqué</button></div>`, (b) => {
    b.querySelector('#vf-resend').addEventListener('click', async () => {
      try { await sendVerification(); snackbar('Correo reenviado'); } catch (e) { accountError(e, 'No se pudo reenviar el correo'); }
    });
    b.querySelector('#vf-done').addEventListener('click', checkVerified);
  });
}

async function checkVerified() {
  try {
    const u = await refreshUser();
    if (u && passwordVerified(u)) { onVerified(); return true; }
    snackbar('Todavía figura sin verificar. Tocá el link del correo y probá de nuevo.');
  } catch (e) { accountError(e, 'No se pudo comprobar'); }
  return false;
}

// Correo recién verificado: se recarga para que se vean las invitaciones (las reglas ya lo permiten).
function onVerified() {
  sessionStorage.setItem('notas-login-msg-ok', 'Correo verificado');
  closeOverlays();
  location.reload();
}

// Al volver a la app (por ejemplo, después de tocar el link en el correo): ¿ya se verificó?
let recheckAt = 0;
async function maybeRecheckVerified() {
  const u = state.user;
  if (state.mode !== 'cloud' || !hasPassword(u) || passwordVerified(u) || !navigator.onLine) return;
  if (Date.now() - recheckAt < 5000) return;
  recheckAt = Date.now();
  try { const fresh = await refreshUser(); if (fresh && passwordVerified(fresh)) onVerified(); } catch { /* nada */ }
}

function updateVerifyBanner() {
  const u = state.user;
  const show = state.mode === 'cloud' && hasPassword(u) && !passwordVerified(u);
  $('#verify-banner').hidden = !show;
  if (show) $('#verify-text').textContent = `Verificá tu correo (${passwordEmail(u)}) para ver lo que te compartan.`;
}
$('#verify-action').addEventListener('click', () => showVerifySheet(passwordEmail(state.user)));

// Aviso de seguridad para cuentas de Google: Verificación en 2 Pasos.
function securityTipHtml() {
  return `<div class="sec-tip">
    <p class="sheet-text"><strong>Recomendado: activá la Verificación en 2 Pasos de Google</strong>, con <strong>aviso en el celular</strong> o con <strong>llave de acceso</strong> (mejor que con SMS). Así, aunque alguien averigüe tu contraseña de Google, no puede entrar a tu cuenta ni a tus notas.</p>
    <p class="sheet-text">Activala también en el <strong>correo de recuperación</strong> de tu cuenta de Google. ANote no puede saber si ya la tenés activada: es solo un aviso.</p>
    <a class="text-btn" href="${TWOSV_URL}" target="_blank" rel="noopener">Abrir la Verificación en 2 Pasos de Google</a>
  </div>`;
}

function maybeSecurityTip() {
  if (!state.pendingSecTip || !state.org?.settingsLoaded || state.mode !== 'cloud') return;
  state.pendingSecTip = false;
  if (!hasGoogle(state.user) || state.org.settings.secTipOff) return;
  openSheet(`<h2 class="sheet-title">${icon('lock')} Seguridad de tu cuenta</h2>${securityTipHtml()}
    <p class="sheet-text">${esc(PW_OPTION_TEXT)}</p>
    <div class="sheet-actions"><button class="text-btn ripple" id="st-never">No volver a mostrar</button><span class="spacer"></span>
      <button class="text-btn ripple" id="st-more">Ver opciones</button><button class="filled-btn ripple" id="st-ok">Entendido</button></div>`, (b) => {
    b.querySelector('#st-never').addEventListener('click', () => { state.repo.saveSettings({ secTipOff: true }); closeOverlays(); snackbar('Podés verlo desde ⋮ Menú → Seguridad de la cuenta'); });
    b.querySelector('#st-ok').addEventListener('click', closeOverlays);
    b.querySelector('#st-more').addEventListener('click', showAccountSecurity);
  });
}

// Seguridad de la cuenta: Verificación en 2 Pasos, pasar a contraseña propia (y volver), nombre visible.
function showAccountSecurity() {
  const u = state.user;
  if (state.mode !== 'cloud' || !u) return;
  const g = hasGoogle(u); const p = hasPassword(u);
  const pe = passwordEmail(u); const ver = passwordVerified(u);
  let part;
  if (g && !p) {
    part = `<h3 class="sheet-sub">Contraseña propia de ANote</h3>
      <p class="sheet-text">${esc(PW_OPTION_TEXT)}</p>
      <p class="sheet-text">Es la misma cuenta: conservás tus notas, las compartidas y los ajustes. Después de verificar el correo, se desvincula Google y ya no se puede entrar con Google (se puede volver atrás).</p>
      <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="sec-link">Pasar a contraseña propia</button></div>`;
  } else if (g && p) {
    part = `<h3 class="sheet-sub">Pasar a contraseña propia (sin terminar)</h3>
      <p class="sheet-text">Correo de ANote: <strong>${esc(pe)}</strong> — ${ver ? 'verificado' : '<strong>sin verificar</strong>'}.</p>
      ${ver
    ? '<p class="sheet-text">Último paso: confirmar la contraseña y desvincular Google. Desde entonces se entra solo con el correo y la contraseña de ANote, y se cierran las sesiones de Google de los otros dispositivos.</p>'
    : '<p class="sheet-text">Tocá el link que te mandamos a ese correo (mirá también en spam) y después «Ya lo verifiqué».</p>'}
      <div class="sheet-actions sheet-actions-wrap"><button class="text-btn ripple" id="sec-cancel">Cancelar el cambio</button><span class="spacer"></span>
        ${ver ? '<button class="filled-btn ripple" id="sec-finish">Desvincular Google</button>'
    : '<button class="text-btn ripple" id="sec-resend">Reenviar</button><button class="filled-btn ripple" id="sec-check">Ya lo verifiqué</button>'}</div>`;
  } else {
    part = `<h3 class="sheet-sub">Contraseña propia de ANote</h3>
      <p class="sheet-text">Entrás con <strong>${esc(pe)}</strong> — ${ver ? 'verificado' : '<strong>sin verificar</strong>'}. La cuenta con contraseña tiene un solo factor: usá una contraseña que no uses en otro lado y, si podés, activá la verificación en 2 pasos en ese correo.</p>
      <div class="sheet-actions sheet-actions-wrap">${ver ? '' : '<button class="text-btn ripple" id="sec-resend">Reenviar verificación</button><button class="text-btn ripple" id="sec-check">Ya lo verifiqué</button>'}
        <span class="spacer"></span><button class="text-btn ripple" id="sec-google">Volver a usar Google</button></div>`;
  }
  openSheet(`<h2 class="sheet-title">${icon('lock')} Seguridad de la cuenta</h2>
    <p class="sheet-text"><strong>${esc(displayName(u))}</strong> · ${esc(accountKind(u))}</p>
    ${g ? securityTipHtml() : ''}
    ${part}
    ${p ? `<div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="sec-pw">${icon('lock')}<span>Cambiar la contraseña</span></button></div>` : ''}
    <div class="sheet-actions"><button class="text-btn ripple" id="sec-name">Cambiar el nombre visible</button>
      ${g ? `<span class="spacer"></span><button class="text-btn ripple" id="sec-tip">${state.org.settings.secTipOff ? 'Volver a mostrar el aviso al entrar' : 'No mostrar el aviso al entrar'}</button>` : ''}</div>`, (b) => {
    const on = (id, fn) => b.querySelector(`#${id}`)?.addEventListener('click', fn);
    on('sec-link', openLinkPasswordSheet);
    on('sec-pw', openChangePasswordSheet);
    on('sec-resend', async () => { try { await sendVerification(); snackbar(`Correo reenviado a ${pe}`); } catch (e) { accountError(e, 'No se pudo reenviar'); } });
    on('sec-check', async () => { if (await checkVerified()) return; });
    on('sec-cancel', async () => {
      const ok = await openDialog({ title: '¿Cancelar el cambio?', text: `Se quita la contraseña de ANote (${pe}) y seguís entrando con Google.`, ok: 'Quitar la contraseña', danger: true });
      if (!ok) return;
      try { await unlinkPassword(); state.user = fb().auth.currentUser; snackbar('Listo: seguís entrando con Google'); showAccountSecurity(); } catch (e) { accountError(e, 'No se pudo cancelar'); }
    });
    on('sec-finish', async () => {
      const pw = await askPassword('Último paso: confirmá tu contraseña de ANote', `Después se desvincula Google: entrás solo con ${pe} y la contraseña.`);
      if (!pw) return;
      snackbar('Desvinculando Google…');
      try {
        await finishPasswordOnly(pw);
        state.user = fb().auth.currentUser;
        closeOverlays();
        openSheet(`<h2 class="sheet-title">Listo</h2>
          <p class="sheet-text">Desde ahora entrás a ANote con <strong>${esc(pe)}</strong> y tu contraseña propia («Entrar con correo»). Las sesiones de Google que estén abiertas en otros dispositivos se cierran al abrir ANote.</p>
          <p class="sheet-text">Si alguien entra con «Continuar con Google» usando tu Gmail, se le crea una cuenta nueva y vacía: no ve tus notas.</p>`);
      } catch (e) { accountError(e, 'No se pudo terminar el cambio'); }
    });
    on('sec-google', async () => {
      const ok = await openDialog({ title: '¿Volver a usar Google?', text: 'Elegís una cuenta de Google y queda vinculada: vas a poder entrar con Google o con la contraseña de ANote.', ok: 'Continuar' });
      if (!ok) return;
      const pw = await askPassword();
      if (!pw) return;
      try {
        await relinkGoogle(pw);
        state.user = fb().auth.currentUser;
        snackbar('Google vinculado'); showAccountSecurity();
      } catch (e) { accountError(e, 'No se pudo vincular Google'); }
    });
    on('sec-name', async () => {
      const r = await openDialog({ title: 'Nombre visible', text: 'Es el que ven las personas con las que compartís notas.', input: true, value: displayName(u), ok: 'Guardar' });
      if (!r?.value) return;
      try {
        await setDisplayName(r.value);
        if (state.repo?.profile) state.repo.profile.name = r.value;
        localStorage.removeItem('notas-pending-name');
        snackbar('Nombre guardado'); showAccountSecurity();
      } catch (e) { accountError(e, 'No se pudo guardar el nombre'); }
    });
    on('sec-tip', () => { const off = !state.org.settings.secTipOff; state.repo.saveSettings({ secTipOff: off }); state.org.settings.secTipOff = off; showAccountSecurity(); });
  });
}

// Cambiar la contraseña de ANote (cuenta con contraseña): la actual, la nueva y repetirla.
function openChangePasswordSheet() {
  const pe = passwordEmail(state.user);
  openSheet(`<h2 class="sheet-title">Cambiar la contraseña</h2>
    <div class="em-form">
      <p class="sheet-text">Cuenta: <strong>${esc(pe)}</strong>. ${PW_RULES}</p>
      <input type="email" autocomplete="username" value="${esc(pe)}" readonly hidden>
      ${pwField('cp-old', 'Contraseña actual', 'current-password')}
      ${pwField('cp-new', 'Contraseña nueva', 'new-password')}
      ${pwField('cp-new2', 'Repetir la contraseña nueva', 'new-password')}
      <p class="sheet-text">En este dispositivo seguís con la sesión abierta. En los otros, la sesión se cierra sola (puede tardar hasta una hora) y hay que entrar con la contraseña nueva.</p>
      <div class="sheet-actions sheet-actions-wrap"><button class="text-btn ripple" id="cp-forgot">No me acuerdo de la actual</button><span class="spacer"></span>
        <button class="text-btn ripple" id="cp-back">Volver</button><button class="filled-btn ripple" id="cp-ok">Cambiar</button></div>
    </div>`, (b) => {
    bindEyes(b);
    const field = (id) => b.querySelector(`#${id}`);
    const val = (id) => field(id).value;
    b.querySelector('#cp-back').addEventListener('click', showAccountSecurity);
    b.querySelector('#cp-forgot').addEventListener('click', async () => {
      const ok = await openDialog({ title: '¿Mandar el correo para elegir otra?', text: `Te mandamos a ${pe} un correo con un link para elegir una contraseña nueva (puede caer en spam). Después entrá con esa contraseña.`, ok: 'Enviar el correo' });
      if (!ok) return;
      try { await resetPassword(pe); snackbar(`Correo enviado a ${pe}`); } catch (e) { accountError(e, 'No se pudo enviar el correo'); }
    });
    const ok = b.querySelector('#cp-ok');
    const run = async () => {
      if (!val('cp-old')) { snackbar('Falta la contraseña actual'); field('cp-old').focus(); return; }
      const prob = passwordProblem(val('cp-new'), pe);
      if (prob) { snackbar(prob); field('cp-new').focus(); return; }
      if (val('cp-new') === val('cp-old')) { snackbar('La contraseña nueva tiene que ser distinta de la actual'); field('cp-new').focus(); return; }
      if (val('cp-new') !== val('cp-new2')) { snackbar('Las contraseñas nuevas no coinciden'); field('cp-new2').focus(); return; }
      ok.disabled = true;
      snackbar('Cambiando la contraseña…');
      try {
        await changePassword(val('cp-old'), val('cp-new'));
        state.user = fb().auth.currentUser;
        b.querySelectorAll('input[type="password"], input[type="text"]').forEach((i) => { i.value = ''; });
        hideSnack(); closeOverlays();
        openSheet(`<h2 class="sheet-title">Contraseña cambiada</h2>
          <p class="sheet-text">Desde ahora entrás con <strong>${esc(pe)}</strong> y la contraseña nueva. En los otros dispositivos la sesión se cierra sola (puede tardar hasta una hora) y hay que volver a entrar.</p>`);
      } catch (e) {
        if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(e?.code)) {
          snackbar('La contraseña actual no es correcta'); field('cp-old').focus();
        } else accountError(e, 'No se pudo cambiar la contraseña');
      } finally { ok.disabled = false; }
    };
    ok.addEventListener('click', run);
    b.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }));
    setTimeout(() => field('cp-old')?.focus(), 80);
  });
}

// Paso 1 de "pasar a contraseña propia": correo distinto del Gmail y contraseña.
function openLinkPasswordSheet() {
  const gmail = String(state.user?.email || '').toLowerCase();
  openSheet(`<h2 class="sheet-title">Pasar a contraseña propia</h2>
    <p class="sheet-text">Usá un correo distinto de ${esc(gmail || 'tu Gmail')} y una contraseña que no uses en otro lado. ${PW_RULES}</p>
    <div class="em-form">
      <label class="field"><span>Correo nuevo para ANote</span><input type="email" id="lk-email" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
      ${pwField('lk-pass', 'Contraseña', 'new-password')}
      ${pwField('lk-pass2', 'Repetir la contraseña', 'new-password')}
      <p class="sheet-text">Te mandamos un correo para verificarlo. Hasta que lo verifiques y termines el cambio, seguís pudiendo entrar con Google.</p>
      <div class="sheet-actions"><button class="text-btn ripple" id="lk-back">Volver</button><span class="spacer"></span><button class="filled-btn ripple" id="lk-ok">Continuar</button></div>
    </div>`, (b) => {
    bindEyes(b);
    const val = (id) => b.querySelector(`#${id}`).value;
    b.querySelector('#lk-back').addEventListener('click', showAccountSecurity);
    const ok = b.querySelector('#lk-ok');
    ok.addEventListener('click', async () => {
      const email = val('lk-email').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { snackbar('Escribí un correo válido'); return; }
      if (email === gmail) { snackbar('Usá un correo distinto del de tu cuenta de Google'); return; }
      const prob = passwordProblem(val('lk-pass'), email);
      if (prob) { snackbar(prob); return; }
      if (val('lk-pass') !== val('lk-pass2')) { snackbar('Las contraseñas no coinciden'); return; }
      ok.disabled = true;
      snackbar('Agregando la contraseña…');
      try {
        await linkPassword(email, val('lk-pass'));
        state.user = fb().auth.currentUser;
        hideSnack();
        showVerifySheet(email);
      } catch (e) { accountError(e, 'No se pudo agregar la contraseña'); } finally { ok.disabled = false; }
    });
  });
}

/* ---------- Nota de bienvenida (guía de qué probar) ---------- */
function maybeWelcome() {
  const key = state.mode === 'cloud' ? `notas-welcomed-${state.user.uid}` : 'notas-welcomed';
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  if (state.notes.length) return;
  const items = state.mode === 'cloud' ? [
    'Abrir esta nota en la PC y en el navegador del celular (misma cuenta)',
    'Escribir en un dispositivo y ver el cambio en el otro',
    'Escribir al mismo tiempo en los dos, en párrafos distintos',
    'Cortar la conexión en los dos, editar en ambos y volver a conectar',
    'Tildar casillas en uno mientras escribís en el otro',
    'Cambiar el título desde los dos',
    'Agregar una imagen y verla en el otro dispositivo',
    'Fijar la nota o cambiarle el color',
  ] : [
    'Escribir con tu teclado: predicción, corrector, deslizar, dictado',
    'Dar formato con la barra de abajo (negrita, títulos, listas)',
    'Tildar estas casillas',
    'Agregar una imagen desde la cámara o la galería',
    'Volver con el botón o el gesto Atrás',
  ];
  const intro = state.mode === 'cloud'
    ? '<p>Esta es la <strong>Parte 2A</strong> de la prueba: sincronización con <em>fusión de cambios</em>. Lo que edites en un dispositivo aparece en los otros, y si editás sin conexión, al reconectar se combinan los cambios sin perder nada.</p>'
    : '<p>Estás usando ANote... <strong>sin cuenta</strong>: todo se guarda en este dispositivo.</p>';
  const html = `${intro}<h2>Qué probar</h2><ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join('')}</ul>`;
  const id = state.repo.create({
    title: state.mode === 'cloud' ? 'Bienvenido a ANote... (sincronización)' : 'Bienvenido a ANote...',
    preview: state.mode === 'cloud' ? 'Esta es la Parte 2A de la prueba: sincronización con fusión de cambios.' : 'Estás usando ANote... sin cuenta.',
    checks: { done: 0, total: items.length },
    legacy: html,
  });
  state.repo.setMeta(id, { pinned: true });
}

/* ---------- Actualizaciones ---------- */
async function checkUpdates() {
  state.release = await getLatestRelease();
  const r = state.release;
  if (!r || !isNewer(r.tag)) return;
  $('#update-text').textContent = isNative
    ? `Hay una versión nueva (${r.tag}) del instalador.`
    : `Hay una versión nueva (${r.tag}), recargá.`;
  $('#update-action').textContent = isNative ? 'Descargar' : 'Recargar';
  $('#update-action').onclick = () => {
    if (isNative && r.apk) window.open(r.apk, '_blank');
    else location.reload();
  };
  $('#update-banner').hidden = false;
}

/* ---------- Diálogo (Material) ---------- */
let dialogResolve = null;
function openDialog({ title, text = '', input = false, password = false, value = '', placeholder = '', colors = null, color = null, ok = 'Aceptar', danger = false }) {
  if (dialogResolve) closeDialog(null);
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  $('#dialog-text').hidden = !text;
  const inp = $('#dialog-input');
  inp.hidden = !input; inp.value = value; inp.placeholder = placeholder;
  inp.type = password ? 'password' : 'text';
  inp.autocomplete = password ? 'current-password' : 'off';
  const box = $('#dialog-colors');
  let chosen = color || (colors ? colors[0] : null);
  box.hidden = !colors;
  if (colors) {
    box.innerHTML = colors.map((c) => `<button class="color-dot ripple${c === chosen ? ' selected' : ''}" data-c="${c}" style="background:${c}" aria-label="Color"></button>`).join('');
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      chosen = b.dataset.c;
      box.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('selected', x === b));
    }));
  }
  $('#dialog-ok').textContent = ok;
  $('#dialog-ok').classList.toggle('danger', danger);
  $('#dialog').hidden = false;
  $('#scrim').classList.remove('clear');
  $('#scrim').classList.add('show');
  requestAnimationFrame(() => $('#dialog').classList.add('open'));
  if (input) setTimeout(() => { inp.focus(); inp.select(); }, 50);
  return new Promise((resolve) => {
    dialogResolve = (accepted) => {
      const v = password ? inp.value : inp.value.trim();
      if (password) inp.value = ''; // no dejar la contraseña en la página
      resolve(accepted ? { value: v, color: chosen } : null);
    };
  });
}
function closeDialog(accepted) {
  const r = dialogResolve; dialogResolve = null;
  $('#dialog').classList.remove('open');
  $('#dialog').hidden = true;
  if ($('#drawer').classList.contains('open') || $('#sheet').classList.contains('open')) { /* dejar el fondo */ }
  else $('#scrim').classList.remove('show', 'clear');
  r?.(accepted);
}
$('#dialog-ok').addEventListener('click', () => {
  if (!$('#dialog-input').hidden && !$('#dialog-input').value.trim()) { $('#dialog-input').focus(); return; }
  closeDialog(true);
});
$('#dialog-cancel').addEventListener('click', () => closeDialog(false));
$('#dialog-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#dialog-ok').click(); });

/* ---------- Menú lateral ---------- */
function openDrawer() {
  renderDrawer();
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.remove('clear');
  $('#scrim').classList.add('show');
}
$('#btn-drawer').addEventListener('click', openDrawer);

// Vistas con nombre en el menú lateral, debajo de «Ocultar/mostrar por reglas»
function viewItems() {
  const views = hideViewsList();
  if (!views.length) return '';
  const cur = rulesCfg().view || null;
  const row = (id, name) => `<div class="drawer-item drawer-view${(id || null) === cur ? ' current' : ''}" style="--depth:1">
      <button class="drawer-link ripple" data-view="${esc(id || '')}" aria-pressed="${(id || null) === cur}">${(id || null) === cur ? icon('check') : '<span class="drawer-view-space"></span>'}<span class="drawer-label">${esc(name)}</span></button>
    </div>`;
  return [...[...views].sort(byName).map((v) => row(v.id, `Vista: ${v.name}`)), row(null, 'Sin vista')].join('');
}

function renderDrawer() {
  const f = state.filter;
  const active = (kind, id) => (f.kind === kind && (id == null || f.id === id) ? ' active' : '');
  const count = (pred) => state.notes.filter(pred).length;
  const item = (kind, id, ic, label, extra = '', depth = 0) => `
    <div class="drawer-item${active(kind, id)}" style="--depth:${depth}">
      ${extra}
      <button class="drawer-link ripple" data-kind="${kind}" ${id ? `data-id="${esc(id)}"` : ''}>${ic}<span class="drawer-label">${esc(label)}</span></button>
    </div>`;

  const folders = [];
  const walk = (parentId, depth) => childrenOf(parentId).forEach((fo) => {
    const kids = childrenOf(fo.id).length > 0;
    const open = state.expanded.has(fo.id);
    const toggle = kids
      ? `<button class="drawer-toggle${open ? ' open' : ''}" data-toggle="${esc(fo.id)}" aria-label="${open ? 'Contraer' : 'Expandir'}">${icon('chevron')}</button>`
      : '<span class="drawer-toggle-space"></span>';
    folders.push(item('folder', fo.id, icon('folder'), fo.name, toggle, depth));
    if (kids && open) walk(fo.id, depth + 1);
  });
  walk(null, 0);

  const labels = [...state.org.labels].sort(byName).map((l) => item('label', l.id,
    `<i class="dot dot-lg" style="background:${esc(l.color || '#757575')}"></i>`, l.name));

  $('#drawer-body').innerHTML = `
    <div class="drawer-head">${BRAND}</div>
    ${item('notes', null, icon('note'), 'Notas')}
    <div class="drawer-section"><span>Carpetas</span><button class="icon-btn small ripple" id="drawer-new-folder" aria-label="Nueva carpeta">${icon('folderAdd')}</button></div>
    ${folders.join('') || '<p class="drawer-empty">Todavía no hay carpetas</p>'}
    <div class="drawer-section"><span>Etiquetas</span><button class="icon-btn small ripple" id="drawer-new-label" aria-label="Nueva etiqueta">${icon('add')}</button></div>
    ${labels.join('') || '<p class="drawer-empty">Todavía no hay etiquetas</p>'}
    <div class="drawer-divider"></div>
    ${state.mode === 'cloud' ? item('shared', null, icon('people'), `Compartidas conmigo (${state.notes.filter((n) => !n.trashed && n.owner && n.owner !== state.user?.uid).length})`) : ''}
    ${state.invites.length ? `<div class="drawer-item"><button class="drawer-link ripple" id="drawer-invites">${icon('mail')}<span class="drawer-label">Invitaciones (${state.invites.length})</span></button></div>` : ''}
    ${item('reminders', null, icon('bell'), `Recordatorios (${state.notes.filter((n) => !n.trashed && activeReminders(n.id).length).length})`)}
    ${item('templates', null, icon('template'), `Plantillas (${count((n) => n.template && !n.trashed)})`)}
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-hidden">${icon('visibilityOff')}<span class="drawer-label">Ocultas (${count((n) => n.hidden && !n.trashed && !n.template)})</span></button></div>
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-rules">${icon('visibility')}<span class="drawer-label">Ocultar/mostrar por reglas${rulesLabel()}</span></button></div>
    ${viewItems()}
    ${item('archive', null, icon('archive'), `Archivo (${count((n) => n.archived && !n.trashed && !n.template)})`)}
    ${item('trash', null, icon('delete'), `Papelera (${count((n) => n.trashed)})`)}
    <div class="drawer-divider"></div>
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-settings">${icon('settings')}<span class="drawer-label">Plazo de la papelera</span></button></div>
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-autotitle">${icon('title')}<span class="drawer-label">Título automático${state.org.settings.autoTitleOn ? ' (activado)' : ''}</span></button></div>
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-copymode">${icon('copy')}<span class="drawer-label">Copiar celdas de tablas: ${COPY_MODE_LABEL[copyModeDefault()]}</span></button></div>
    ${state.mode === 'cloud' ? `<div class="drawer-item"><button class="drawer-link ripple" id="drawer-security">${icon('lock')}<span class="drawer-label">Seguridad de la cuenta</span></button></div>` : ''}
  `;
  $('#drawer-body').querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    setFilter(b.dataset.id ? { kind: b.dataset.kind, id: b.dataset.id } : { kind: b.dataset.kind });
  }));
  $('#drawer-body').querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.toggle;
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    localStorage.setItem('notas-expanded', JSON.stringify([...state.expanded]));
    renderDrawer();
  }));
  $('#drawer-new-folder').addEventListener('click', () => newFolder(null));
  $('#drawer-invites')?.addEventListener('click', () => { closeOverlays(); showInvites(); });
  $('#drawer-new-label').addEventListener('click', () => newLabel());
  $('#drawer-hidden').addEventListener('click', () => { closeOverlays(); showHiddenManager(); });
  $('#drawer-rules').addEventListener('click', () => { closeOverlays(); showRulesSettings(); });
  // Vistas con nombre: se eligen desde el menú y se va a la pantalla principal para ver el efecto
  $('#drawer-body').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    applyView(b.dataset.view || null);
    setFilter({ kind: 'notes' });
  }));
  $('#drawer-settings').addEventListener('click', () => { closeOverlays(); showTrashSettings(); });
  $('#drawer-autotitle').addEventListener('click', () => { closeOverlays(); showAutoTitleSettings(); });
  $('#drawer-copymode').addEventListener('click', () => { closeOverlays(); showCopyModeSettings(); });
  $('#drawer-security')?.addEventListener('click', () => { closeOverlays(); showAccountSecurity(); });
}

/* ---------- Carpetas ---------- */
async function newFolder(parentId, { silent = false } = {}) {
  const r = await openDialog({
    title: parentId ? `Nueva subcarpeta en «${folderById(parentId)?.name || ''}»` : 'Nueva carpeta',
    input: true, placeholder: 'Nombre de la carpeta', ok: 'Crear',
  });
  if (!r?.value) return null;
  const id = orgId();
  state.repo.saveFolder({ id, name: r.value, parentId: parentId || null, created: Date.now() });
  if (parentId) { state.expanded.add(parentId); localStorage.setItem('notas-expanded', JSON.stringify([...state.expanded])); }
  if (!silent) snackbar(`Carpeta «${r.value}» creada`);
  return id;
}

async function renameFolder(id) {
  const fo = folderById(id); if (!fo) return;
  const r = await openDialog({ title: 'Renombrar carpeta', input: true, value: fo.name, ok: 'Guardar' });
  if (r?.value) state.repo.saveFolder({ id, name: r.value });
}

async function deleteFolder(id) {
  const fo = folderById(id); if (!fo) return;
  const ids = [id, ...descendantsOf(id)];
  const subs = ids.length - 1;
  const r = await openDialog({
    title: `¿Eliminar la carpeta «${fo.name}»?`,
    text: `${subs ? `También se eliminan sus ${subs} subcarpetas. ` : ''}Las notas no se borran: siguen en sus otras carpetas o en Notas.`,
    ok: 'Eliminar', danger: true,
  });
  if (!r) return;
  state.notes.forEach((n) => {
    (n.folders || []).filter((x) => ids.includes(x)).forEach((x) => state.repo.removeFromMeta(n.id, 'folders', x));
  });
  ids.forEach((x) => state.repo.deleteFolder(x));
  if (state.filter.kind === 'folder' && ids.includes(state.filter.id)) setFilter({ kind: 'notes' });
  snackbar('Carpeta eliminada');
}

/* ---------- Etiquetas ---------- */
async function newLabel({ silent = false } = {}) {
  const r = await openDialog({ title: 'Nueva etiqueta', input: true, placeholder: 'Nombre de la etiqueta', colors: LABEL_COLORS, ok: 'Crear' });
  if (!r?.value) return null;
  const id = orgId();
  state.repo.saveLabel({ id, name: r.value, color: r.color, created: Date.now() });
  if (!silent) snackbar(`Etiqueta «${r.value}» creada`);
  return id;
}

async function editLabel(id) {
  const l = labelById(id); if (!l) return;
  const r = await openDialog({ title: 'Editar etiqueta', input: true, value: l.name, colors: LABEL_COLORS, color: l.color, ok: 'Guardar' });
  if (r?.value) state.repo.saveLabel({ id, name: r.value, color: r.color });
}

async function deleteLabel(id) {
  const l = labelById(id); if (!l) return;
  const r = await openDialog({ title: `¿Eliminar la etiqueta «${l.name}»?`, text: 'Se quita de todas las notas. Las notas no se borran.', ok: 'Eliminar', danger: true });
  if (!r) return;
  state.notes.forEach((n) => {
    if ((n.labels || []).includes(id)) state.repo.removeFromMeta(n.id, 'labels', id);
  });
  state.repo.deleteLabel(id);
  if (state.filter.kind === 'label' && state.filter.id === id) setFilter({ kind: 'notes' });
  snackbar('Etiqueta eliminada');
}

/* ---------- Selector de carpetas o etiquetas (para una nota o varias) ---------- */
// Cada opción muestra si la tienen todas, algunas o ninguna de las notas. El cambio se aplica al instante.
function openPicker(ids, field) {
  const isFolder = field === 'folders';
  const notes = () => ids.map(noteById).filter(Boolean);
  const items = () => (isFolder
    ? folderTree().map((fo) => ({ id: fo.id, name: fo.name, depth: fo.depth, mark: icon('folder') }))
    : [...state.org.labels].sort(byName).map((l) => ({ id: l.id, name: l.name, depth: 0, mark: `<i class="dot dot-lg" style="background:${esc(l.color || '#757575')}"></i>` })));
  const stateOf = (id) => {
    const ns = notes(); const c = ns.filter((n) => (n[field] || []).includes(id)).length;
    return c === 0 ? 'none' : c === ns.length ? 'all' : 'some';
  };
  const apply = (id, add) => {
    notes().forEach((n) => {
      const set = new Set(n[field] || []);
      if (add) set.add(id); else set.delete(id);
      if (set.size !== (n[field] || []).length) {
        const arr = [...set];
        n[field] = arr; // reflejo inmediato hasta que llegue la sincronización
        if (state.current?.id === n.id) state.current[field] = arr;
        // Se agrega o quita solo esa carpeta/etiqueta: no pisa cambios hechos en otro dispositivo
        if (add) state.repo.addToMeta(n.id, field, id); else state.repo.removeFromMeta(n.id, field, id);
      }
    });
  };
  const draw = (body) => {
    const list = items();
    body.querySelector('.picker-list').innerHTML = list.length ? list.map((it) => {
      const st = stateOf(it.id);
      return `<button class="picker-item ripple" data-id="${esc(it.id)}" style="--depth:${it.depth}" aria-pressed="${st === 'all'}">
        <span class="checkbox ${st}"></span>${it.mark}<span>${esc(it.name)}</span></button>`;
    }).join('') : `<p class="sheet-text">Todavía no hay ${isFolder ? 'carpetas' : 'etiquetas'}.</p>`;
    body.querySelectorAll('.picker-item').forEach((b) => b.addEventListener('click', () => {
      apply(b.dataset.id, stateOf(b.dataset.id) !== 'all');
      haptic();
      draw(body);
      renderList(); paintEditorChrome();
    }));
  };
  const title = isFolder ? 'Carpetas' : 'Etiquetas';
  const sub = ids.length > 1 ? `<p class="sheet-text">${ids.length} notas seleccionadas</p>` : '';
  openSheet(`<h2 class="sheet-title">${title}</h2>${sub}<div class="picker-list"></div>
    <div class="sheet-actions"><button class="text-btn ripple" id="picker-new">${isFolder ? 'Nueva carpeta' : 'Nueva etiqueta'}</button>
    <span class="spacer"></span><button class="text-btn ripple" id="picker-done">Listo</button></div>`, (body) => {
    draw(body);
    body.querySelector('#picker-done').addEventListener('click', closeOverlays);
    body.querySelector('#picker-new').addEventListener('click', async () => {
      closeOverlays();
      const id = isFolder ? await newFolder(null, { silent: true }) : await newLabel({ silent: true });
      if (id) { apply(id, true); setTimeout(() => openPicker(ids, field), 150); }
    });
  });
}

// "Está en X carpetas": lista de carpetas de la nota, con acceso a cada una
function showOccurrences(id) {
  const n = state.current?.id === id ? state.current : noteById(id);
  const fs = noteFolders(n);
  openSheet(`<h2 class="sheet-title">${fs.length === 1 ? 'Está en 1 carpeta' : `Está en ${fs.length} carpetas`}</h2>
    <p class="sheet-text">Es la misma nota en todas: lo que edites se ve igual desde cualquier carpeta.</p>
    <div class="picker-list">${fs.map((fid) => `<button class="picker-item ripple" data-go="${esc(fid)}">${icon('folder')}<span>${esc(folderPath(fid))}</span></button>`).join('')}</div>
    <div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="occ-edit">Cambiar carpetas</button></div>`, (body) => {
    body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', async () => {
      closeOverlays();
      if (state.view === 'editor') goBack();
      setTimeout(() => setFilter({ kind: 'folder', id: b.dataset.go }), state.view === 'editor' ? 250 : 0);
    }));
    body.querySelector('#occ-edit').addEventListener('click', () => { closeOverlays(); setTimeout(() => openPicker([id], 'folders'), 150); });
  });
}

/* ---------- Color ---------- */
function openColorSheet(ids) {
  const first = noteById(ids[0]) || state.current;
  const cur = ids.length === 1 ? (first?.color || 'default') : null;
  const sw = COLORS.map(([key, label]) => `
    <button class="swatch ripple${key === cur ? ' selected' : ''}" data-color-key="${key}" ${key !== 'default' ? `data-color="${key}"` : ''} aria-label="${label}">
      ${key === 'default' ? icon('block') : ''}${key === cur ? `<span class="swatch-check">${icon('check')}</span>` : ''}
    </button>`).join('');
  openSheet(`<h2 class="sheet-title">Color</h2><p class="sheet-text">El color es tuyo: si compartís la nota, cada persona elige el suyo.</p><div class="swatches">${sw}</div>`, (body) => {
    body.querySelectorAll('[data-color-key]').forEach((b) => b.addEventListener('click', () => {
      const color = b.dataset.colorKey;
      ids.forEach((id) => state.repo.setMeta(id, { color }));
      if (state.current && ids.includes(state.current.id)) { state.current.color = color; paintEditorChrome(); }
      closeOverlays();
    }));
  });
}

/* ---------- Acciones (una nota o varias) ---------- */
function pinNotes(ids, value) {
  ids.forEach((id) => state.repo.setMeta(id, { pinned: value }));
  snackbar(value ? (ids.length > 1 ? 'Notas fijadas' : 'Nota fijada') : (ids.length > 1 ? 'Notas sin fijar' : 'Nota sin fijar'));
}

function archiveNotes(ids, value) {
  ids.forEach((id) => state.repo.setMeta(id, { archived: value }));
  const n = ids.length > 1 ? `${ids.length} notas` : 'Nota';
  snackbar(value ? `${n} ${ids.length > 1 ? 'archivadas' : 'archivada'}` : `${n} ${ids.length > 1 ? 'desarchivadas' : 'desarchivada'}`,
    'Deshacer', () => ids.forEach((id) => state.repo.setMeta(id, { archived: !value })));
}

// Ocultar = no aparece en la pantalla principal de Notas (es personal, como las carpetas)
function hideNotes(ids, value, { quiet = false } = {}) {
  ids.forEach((id) => {
    const n = noteById(id); if (n) { n.hidden = value; n.unlisted = false; }
    if (state.current?.id === id) state.current.hidden = value;
    state.repo.setMeta(id, { hidden: value, unlisted: false });
  });
  renderList(); renderDrawer();
  if (quiet) return;
  const k = ids.length > 1 ? `${ids.length} notas` : 'Nota';
  snackbar(value ? `${k} ${ids.length > 1 ? 'ocultas' : 'oculta'} en la pantalla principal` : `${k} ${ids.length > 1 ? 'visibles' : 'visible'} otra vez`,
    'Deshacer', () => hideNotes(ids, !value, { quiet: true }));
}

/* ---------- Notas ocultables: listado para Ocultar / Mostrar / Quitar del listado ---------- */
// Por defecto el listado incluye todas las notas. "Quitar del listado" la deja visible y fuera del listado;
// "Restaurar listado" vuelve a incluir todas.
const hm = { sel: new Set(), view: 'all', q: '', manage: false };
function showHiddenManager() {
  const pool = () => state.notes.filter((n) => !n.trashed && !n.template);
  const listed = () => pool().filter((n) => !n.unlisted);
  const shown = () => {
    const q = normalize(hm.q).trim();
    return listed()
      .filter((n) => (hm.view === 'hidden' ? n.hidden : hm.view === 'visible' ? !n.hidden : true))
      .filter((n) => !q || normalize(`${n.title || ''} ${n.locked && !state.unlocked.has(n.id) ? '' : (n.preview || '')}`).includes(q))
      .sort((a, b) => (Number(!!b.hidden) - Number(!!a.hidden)) || ((b.updated || 0) - (a.updated || 0)));
  };
  const titleOf = (n) => (n.title || (n.locked && !state.unlocked.has(n.id) ? 'Nota bloqueada' : n.preview) || 'Nota sin título').slice(0, 90);
  const draw = (body) => {
    const all = listed();
    [...hm.sel].forEach((id) => { if (!all.some((n) => n.id === id)) hm.sel.delete(id); });
    const list = shown();
    const nHidden = all.filter((n) => n.hidden).length;
    const nUnlisted = pool().filter((n) => n.unlisted).length;
    const allSel = list.length > 0 && list.every((n) => hm.sel.has(n.id));
    const someSel = list.some((n) => hm.sel.has(n.id));
    const seg = (v, label) => `<button class="chip ripple${hm.view === v ? ' on' : ''}" data-view="${v}"><span>${label}</span></button>`;
    body.querySelector('.hm-head').innerHTML = `
      <div class="hm-segs">${seg('all', `Todas (${all.length})`)}${seg('hidden', `Ocultas (${nHidden})`)}${seg('visible', `Visibles (${all.length - nHidden})`)}</div>`;
    body.querySelector('.hm-list').innerHTML = (list.length ? `
      <button class="picker-item ripple hm-all" data-all="1"><span class="checkbox ${allSel ? 'all' : someSel ? 'some' : 'none'}"></span><span>Seleccionar todas (${list.length})</span></button>` : '')
      + (list.map((n) => `
      <div class="hm-row${hm.sel.has(n.id) ? ' sel' : ''}">
        <button class="picker-item ripple" data-id="${esc(n.id)}" aria-pressed="${hm.sel.has(n.id)}">
          <span class="checkbox ${hm.sel.has(n.id) ? 'all' : 'none'}"></span>
          <span class="rem-text"><strong>${esc(titleOf(n))}</strong><small>${n.archived ? 'Archivada · ' : ''}${esc(formatWhen(n.updated || n.created || Date.now()))}</small></span>
          <span class="hm-state${n.hidden ? ' on' : ''}">${icon(n.hidden ? 'visibilityOff' : 'visibility')}<span>${n.hidden ? 'Oculta' : 'Visible'}</span></span>
        </button>
        <button class="icon-btn small ripple" data-open="${esc(n.id)}" aria-label="Abrir la nota" title="Abrir la nota">${icon('note')}</button>
      </div>`).join('') || `<p class="sheet-text">${hm.q ? 'Ninguna nota coincide con la búsqueda.' : hm.view === 'hidden' ? 'No hay notas ocultas.' : 'No hay notas en el listado.'}</p>`);
    const nSel = hm.sel.size;
    body.querySelector('.hm-count').textContent = nSel ? `${nSel} seleccionada${nSel > 1 ? 's' : ''}` : 'Elegí una o varias notas';
    body.querySelectorAll('[data-act]').forEach((b) => { b.disabled = !nSel && b.dataset.act !== 'manage' && b.dataset.act !== 'restore'; });
    body.querySelector('.hm-manage').hidden = !hm.manage;
    body.querySelector('[data-act="manage"]').classList.toggle('on', hm.manage);
    const rest = body.querySelector('[data-act="restore"]');
    rest.disabled = !nUnlisted;
    rest.querySelector('span').textContent = nUnlisted ? `Restaurar listado (${nUnlisted} quitada${nUnlisted > 1 ? 's' : ''})` : 'Restaurar listado';
    hydrateIcons(body);
  };
  openSheet(`<div class="hm"><h2 class="sheet-title">${icon('visibilityOff')} Notas ocultables</h2>
    <p class="sheet-text">Las notas ocultas no aparecen en la pantalla principal de Notas; sí en carpetas, etiquetas y búsqueda, marcadas con «[Oculta]».</p>
    <label class="field hm-search"><input type="search" id="hm-q" placeholder="Buscar en el listado" value="${esc(hm.q)}"></label>
    <div class="hm-head"></div>
    <div class="picker-list hm-list"></div>
    <div class="sheet-actions hm-actions">
      <span class="hm-count"></span><span class="spacer"></span>
      <button class="text-btn ripple" data-act="show">Mostrar</button>
      <button class="filled-btn ripple" data-act="hide">${icon('visibilityOff')}<span>Ocultar</span></button>
    </div>
    <div class="sheet-actions">
      <button class="chip chip-outline ripple" data-act="manage">${icon('settings')}<span>Gestionar</span></button>
    </div>
    <div class="hm-manage" hidden>
      <p class="sheet-text">«Quitar del listado» deja las notas elegidas visibles y ya no las muestra acá. «Restaurar listado» vuelve a mostrar todas.</p>
      <div class="sheet-actions">
        <button class="text-btn ripple" data-act="unlist">${icon('removeFolder')}<span>Quitar del listado</span></button>
        <span class="spacer"></span>
        <button class="text-btn ripple" data-act="restore">${icon('restore')}<span>Restaurar listado</span></button>
      </div>
    </div></div>`, (sheetBody) => {
    // El contenedor del panel se reutiliza: los eventos van en el .hm (se reemplaza en cada apertura)
    const body = sheetBody.querySelector('.hm');
    draw(body);
    body.querySelector('#hm-q').addEventListener('input', (e) => { hm.q = e.target.value; draw(body); });
    body.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t || !body.contains(t)) return;
      if (t.dataset.view) { hm.view = t.dataset.view; draw(body); return; }
      if (t.dataset.all) {
        const list = shown(); const allSel = list.every((n) => hm.sel.has(n.id));
        list.forEach((n) => (allSel ? hm.sel.delete(n.id) : hm.sel.add(n.id))); draw(body); return;
      }
      if (t.dataset.open) { const id = t.dataset.open; closeOverlays(); openNote(id); return; }
      if (t.dataset.id) { const id = t.dataset.id; if (hm.sel.has(id)) hm.sel.delete(id); else hm.sel.add(id); draw(body); return; }
      const ids = [...hm.sel];
      switch (t.dataset.act) {
        case 'manage': hm.manage = !hm.manage; draw(body); break;
        case 'hide': hideNotes(ids, true); hm.sel.clear(); draw(body); break;
        case 'show': hideNotes(ids, false); hm.sel.clear(); draw(body); break;
        case 'unlist': {
          ids.forEach((id) => { const n = noteById(id); if (n) { n.hidden = false; n.unlisted = true; } state.repo.setMeta(id, { hidden: false, unlisted: true }); });
          hm.sel.clear(); renderList(); renderDrawer(); draw(body);
          snackbar(ids.length > 1 ? `${ids.length} notas quitadas del listado (quedan visibles)` : 'Nota quitada del listado (queda visible)', 'Deshacer', () => {
            ids.forEach((id) => { const n = noteById(id); if (n) n.unlisted = false; state.repo.setMeta(id, { unlisted: false }); });
            if (body.isConnected) draw(body);
          });
          break;
        }
        case 'restore': {
          const un = pool().filter((n) => n.unlisted);
          if (!un.length) return;
          un.forEach((n) => { n.unlisted = false; state.repo.setMeta(n.id, { unlisted: false }); });
          draw(body);
          snackbar(`Listado restaurado: ${un.length > 1 ? `volvieron ${un.length} notas` : 'volvió 1 nota'}`);
          break;
        }
        default:
      }
    });
  });
}

/* ---------- Estadísticas e Info de la nota ---------- */
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;
function docStats(doc, from = 0, to = doc.content.size) {
  const st = { chars: 0, noSpaces: 0, words: 0, unique: 0, lines: 0, paragraphs: 0, sentences: 0, headings: 0, listItems: 0, tasks: 0, tasksDone: 0, images: 0, links: 0, longest: '' };
  const texts = [];
  const links = new Set();
  const uniq = new Set();
  doc.nodesBetween(from, to, (node, pos) => {
    const name = node.type.name;
    if (name === 'image') st.images += 1;
    if (name === 'taskItem') { st.tasks += 1; if (node.attrs.checked) st.tasksDone += 1; }
    if (name === 'listItem' || name === 'taskItem') st.listItems += 1;
    if (node.isText) node.marks.forEach((m) => { if (m.type.name === 'link' && m.attrs.href) links.add(m.attrs.href); });
    if (node.isTextblock) {
      const a = Math.max(from, pos + 1); const b = Math.min(to, pos + node.nodeSize - 1);
      const text = a <= b ? doc.textBetween(a, b, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : '')) : '';
      if (name === 'heading' && text.trim()) st.headings += 1;
      texts.push(text);
      st.lines += text.split('\n').length;
      if (text.trim()) st.paragraphs += 1;
      st.sentences += (text.match(/[^.!?…\n]*[\p{L}\p{N}][^.!?…\n]*(?:[.!?…]+|$)/gmu) || []).length;
    }
    return true;
  });
  const all = texts.join('\n');
  if (!all.trim()) st.lines = 0;
  st.chars = all.replace(/\n/g, '').length;
  st.noSpaces = all.replace(/\s/g, '').length;
  const words = all.match(WORD_RE) || [];
  st.words = words.length;
  words.forEach((w) => { uniq.add(w.toLowerCase()); if (w.length > st.longest.length) st.longest = w; });
  st.unique = uniq.size;
  st.links = links.size;
  return st;
}

function readingTime(words, wpm) {
  if (!words) return '—';
  const min = words / wpm;
  if (min < 1) return 'menos de 1 min';
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

async function showNoteStats(noteId) {
  const c = state.current;
  if (!editor || c?.id !== noteId) return;
  const n = noteById(noteId) || c;
  const fmt = (x) => Number(x).toLocaleString('es-AR');
  const doc = editor.state.doc;
  const sel = editor.state.selection;
  const total = docStats(doc);
  const part = sel.empty ? null : docStats(doc, sel.from, sel.to);
  const title = $('#note-title').value || '';
  const row = (label, a, b) => `<tr><th>${label}</th><td>${a}</td>${part ? `<td>${b ?? ''}</td>` : ''}</tr>`;
  const r2 = (label, key) => row(label, fmt(total[key]), part ? fmt(part[key]) : '');
  const pct = (s) => (s.tasks ? `${fmt(s.tasksDone)}/${fmt(s.tasks)} (${Math.round((s.tasksDone / s.tasks) * 100)}%)` : '0');
  const people = (n.memberIds || []).map((uid) => n.members?.[uid]?.name || n.members?.[uid]?.email || (uid === state.user?.uid ? 'Vos' : 'Usuario'));
  const ownerName = n.owner ? (n.owner === state.user?.uid ? 'Vos' : (n.members?.[n.owner]?.name || n.members?.[n.owner]?.email || '—')) : 'Vos';
  const roleName = { owner: 'Dueño/a', edit: 'Puede editar', view: 'Solo puede ver' }[myRole(n)] || '—';
  const flags = [n.pinned && 'Fijada', n.archived && 'Archivada', n.hidden && 'Oculta', !n.hidden && !n.archived && !n.trashed && !n.template && hiddenByRules(n) && 'Oculta por reglas en la pantalla principal', n.locked && 'Bloqueada con huella', n.template && 'Plantilla'].filter(Boolean);
  const rems = activeReminders(noteId);
  const next = nextOf(noteId);
  let bytes = 0;
  try { bytes = c.session?.snapshot()?.length || 0; } catch { bytes = 0; }
  const size = bytes ? (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`) : '—';
  const info = (label, v) => `<tr><th>${label}</th><td colspan="${part ? 2 : 1}">${v}</td></tr>`;
  openSheet(`<h2 class="sheet-title">${icon('info')} Estadísticas e Info de la nota</h2>
    <div class="stats-wrap"><table class="stats">
      ${part ? '<thead><tr><th></th><th>Toda la nota</th><th>Selección</th></tr></thead>' : ''}
      <tbody>
      <tr class="stats-sec"><th colspan="3">Texto (sin el título)</th></tr>
      ${r2('Caracteres', 'chars')}
      ${r2('Caracteres sin espacios', 'noSpaces')}
      ${r2('Palabras', 'words')}
      ${r2('Palabras distintas', 'unique')}
      ${r2('Líneas', 'lines')}
      ${r2('Párrafos', 'paragraphs')}
      ${r2('Oraciones', 'sentences')}
      ${row('Promedio de palabras por oración', total.sentences ? fmt(Math.round(total.words / total.sentences)) : '—', part ? (part.sentences ? fmt(Math.round(part.words / part.sentences)) : '—') : '')}
      ${row('Palabra más larga', esc(total.longest || '—'), part ? esc(part.longest || '—') : '')}
      ${row('Título', `${fmt(title.length)} caracteres · ${fmt((title.match(WORD_RE) || []).length)} palabras`, part ? '' : null)}
      <tr class="stats-sec"><th colspan="3">Lectura</th></tr>
      ${row('Tiempo de lectura', readingTime(total.words, 200), part ? readingTime(part.words, 200) : '')}
      ${row('Lectura en voz alta', readingTime(total.words, 140), part ? readingTime(part.words, 140) : '')}
      <tr class="stats-sec"><th colspan="3">Contenido</th></tr>
      ${row('Casillas tildadas', pct(total), part ? pct(part) : '')}
      ${r2('Elementos de lista', 'listItems')}
      ${r2('Encabezados', 'headings')}
      ${r2('Imágenes', 'images')}
      ${r2('Links', 'links')}
      <tr class="stats-sec"><th colspan="3">Info</th></tr>
      ${info('Creada', n.created ? esc(formatDateTime(n.created)) : '—')}
      ${info('Última modificación', `${n.updated ? esc(formatDateTime(n.updated)) : '—'}${n.updatedByName ? ` · ${esc(n.updatedByName)}` : ''}`)}
      ${info('Versiones guardadas', '<span id="stats-versions">…</span>')}
      ${info('Estado', esc(flags.join(' · ') || 'Normal'))}
      ${info('Carpetas', esc(noteFolders(n).map(folderPath).join(' · ') || 'Ninguna'))}
      ${info('Etiquetas', esc(noteLabels(n).map((id) => labelById(id)?.name).join(' · ') || 'Ninguna'))}
      ${info('Recordatorios activos', `${fmt(rems.length)}${next ? ` · próximo: ${esc(formatWhen(next.t))}` : ''}`)}
      ${state.mode === 'cloud' ? info('Dueño/a', esc(ownerName)) : ''}
      ${state.mode === 'cloud' ? info('Tu acceso', esc(roleName)) : ''}
      ${state.mode === 'cloud' ? info('Personas con acceso', `${fmt(people.length || 1)}${people.length > 1 ? ` · ${esc(people.join(', '))}` : ''}`) : ''}
      ${info('Tamaño aproximado', esc(size))}
      </tbody></table></div>
    ${part ? '' : '<p class="sheet-text stats-tip">Tip: seleccioná parte del texto antes de abrir esta ventana para ver también las cifras de la selección.</p>'}`);
  try {
    const list = await state.repo.listVersions(noteId);
    const el = $('#stats-versions'); if (el) el.textContent = fmt(list.length);
  } catch { const el = $('#stats-versions'); if (el) el.textContent = '—'; }
}

function formatDateTime(t) {
  return new Date(t).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function trashNotes(ids) {
  const at = Date.now();
  ids.forEach((id) => state.repo.setMeta(id, { trashed: true, trashedAt: at }));
  snackbar(ids.length > 1 ? `${ids.length} notas enviadas a la papelera` : 'Nota enviada a la papelera',
    'Deshacer', () => ids.forEach((id) => state.repo.setMeta(id, { trashed: false, trashedAt: null })));
}

function restoreNotes(ids) {
  ids.forEach((id) => state.repo.setMeta(id, { trashed: false, trashedAt: null }));
  snackbar(ids.length > 1 ? `${ids.length} notas restauradas` : 'Nota restaurada');
}

async function deleteForever(ids) {
  const r = await openDialog({
    title: ids.length > 1 ? `¿Eliminar definitivamente ${ids.length} notas?` : '¿Eliminar definitivamente la nota?',
    text: ids.some((id) => isShared(noteById(id)) && noteById(id)?.owner === state.user?.uid)
      ? 'No se puede deshacer. Las notas que compartiste se borran también para las personas con acceso.'
      : 'No se puede deshacer.',
    ok: 'Eliminar', danger: true,
  });
  if (!r) return false;
  ids.forEach((id) => {
    const n = noteById(id);
    if (!n) return;
    if (state.repo.canPurge(n)) state.repo.removeCompletely(id);
    else state.repo.leaveNote(id); // compartida por otro: se sale de la nota, no se borra para los demás
    removeNoteReminders(id);
  });
  snackbar(ids.length > 1 ? 'Notas eliminadas' : 'Nota eliminada');
  return true;
}

function removeFromFolder(ids, folderId) {
  ids.forEach((id) => {
    if (noteById(id)) state.repo.removeFromMeta(id, 'folders', folderId);
  });
  snackbar(`Quitada${ids.length > 1 ? 's' : ''} de «${folderById(folderId)?.name || 'la carpeta'}»`);
}

// Copiar: crea notas nuevas e independientes con el mismo contenido y la misma organización
async function copyNotes(ids, { asTemplate = false, fromTemplate = false, meta = null, quiet = false } = {}) {
  if (!quiet) snackbar(ids.length > 1 ? 'Copiando notas…' : 'Copiando nota…');
  let ok = 0; let big = 0;
  const created = [];
  for (const id of ids) {
    const n = noteById(id);
    if (!n) continue;
    const s = state.repo.session(id, () => {});
    try {
      await s.ready();
      const json = yXmlFragmentToProsemirrorJSON(s.fragment);
      const title = s.titleText.toString() || n.title || '';
      const legacy = json?.content?.length ? json : (n.legacy || '');
      if (JSON.stringify(legacy).length > 700000) { big++; continue; }
      const nid = state.repo.create({
        title, preview: n.preview || '', text: n.text || '', checks: n.checks || { done: 0, total: 0 }, thumb: n.thumb || null, legacy,
      });
      if (asTemplate) state.repo.setMeta(nid, { template: true, color: n.color || 'default' });
      else if (fromTemplate) state.repo.setMeta(nid, { color: n.color || 'default', ...(meta || {}) });
      else state.repo.setMeta(nid, { color: n.color || 'default', labels: n.labels || [], folders: n.folders || [] });
      created.push({ id: nid, title });
      ok++;
    } finally { s.destroy(); }
  }
  if (big) snackbar(`${ok ? `${ok} copiada${ok > 1 ? 's' : ''}. ` : ''}${big} nota${big > 1 ? 's' : ''} con muchas imágenes no se pudo copiar (llega en la Fase 5).`);
  else if (!quiet) snackbar(asTemplate ? (ok > 1 ? `${ok} plantillas guardadas` : 'Plantilla guardada') : (ok > 1 ? `${ok} notas copiadas` : 'Nota copiada'));
  return created;
}

/* ---------- Selección múltiple ---------- */
function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
  updateSelectionUi();
}
function clearSelection() { state.selection.clear(); updateSelectionUi(); }
const selectedIds = () => [...state.selection];

function updateSelectionUi() {
  const on = state.selection.size > 0;
  $('#appbar-select').hidden = !on;
  $('#appbar-list').hidden = on || state.search.active;
  $('#appbar-search').hidden = on || !state.search.active;
  $('#search-filters').hidden = on || !state.search.active;
  root.classList.toggle('selecting', on);
  $('#select-count').textContent = String(state.selection.size);
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', state.selection.has(c.dataset.id)));
  if (on) renderSelectActions();
}

function renderSelectActions() {
  const ids = selectedIds();
  const notes = ids.map(noteById).filter(Boolean);
  const f = state.filter;
  const btn = (name, label, fn, active = false) => ({ name, label, fn, active });
  let actions;
  let more;
  const selectAll = { label: 'Seleccionar todo', onClick: () => { state.notes.filter((n) => matchesFilter(n)).forEach((n) => state.selection.add(n.id)); updateSelectionUi(); } };
  if (f.kind === 'trash') {
    actions = [
      btn('restore', 'Restaurar', () => { restoreNotes(ids); clearSelection(); }),
      btn('deleteForever', 'Eliminar definitivamente', async () => { if (await deleteForever(ids)) clearSelection(); }),
    ];
    more = [selectAll];
  } else {
    const allPinned = notes.length && notes.every((n) => n.pinned);
    const inArchive = f.kind === 'archive';
    actions = [
      btn('pin', allPinned ? 'Dejar de fijar' : 'Fijar', () => { pinNotes(ids, !allPinned); clearSelection(); }, allPinned),
      btn('palette', 'Color', () => openColorSheet(ids)),
      btn('label', 'Etiquetas', () => openPicker(ids, 'labels')),
      btn('folderAdd', 'Carpetas', () => openPicker(ids, 'folders')),
      btn(inArchive ? 'unarchive' : 'archive', inArchive ? 'Desarchivar' : 'Archivar', () => { archiveNotes(ids, !inArchive); clearSelection(); }),
      btn('delete', 'Enviar a la papelera', () => { trashNotes(ids); clearSelection(); }),
    ];
    more = [
      ...(f.kind === 'templates' && ids.length === 1 ? [{ label: 'Usar plantilla', onClick: () => { useTemplate(ids[0]); clearSelection(); } }] : []),
      ...(f.kind !== 'templates' ? [{ label: ids.length > 1 ? 'Guardar como plantillas' : 'Guardar como plantilla', onClick: () => { copyNotes(ids, { asTemplate: true }); clearSelection(); } }] : []),
      ...(f.kind !== 'templates' ? [notes.every((n) => n.hidden)
        ? { label: 'Mostrar en la pantalla principal', onClick: () => { hideNotes(ids, false); clearSelection(); } }
        : { label: 'Ocultar de la pantalla principal', onClick: () => { hideNotes(ids, true); clearSelection(); } }] : []),
      { label: ids.length > 1 ? `Copiar ${ids.length} notas` : 'Copiar nota', onClick: () => { copyNotes(ids); clearSelection(); } },
      ...(ids.length === 1 && f.kind !== 'trash' ? [{ label: 'Copiar (o Enviar) Link', onClick: () => { openLinkSheet(ids[0]); clearSelection(); } }] : []),
      { label: 'Enviar… (a través de →)', onClick: () => { openSendSheet(ids); clearSelection(); } },
      { label: 'Exportar y Descargar…', onClick: () => { openExportSheet(ids); clearSelection(); } },
      { label: notes.every((n) => n.locked) ? 'Quitar el bloqueo' : 'Bloquear con huella', onClick: () => { setLocked(ids, !notes.every((n) => n.locked)); clearSelection(); } },
      ...(f.kind === 'folder' ? [{ label: 'Quitar de esta carpeta', onClick: () => { removeFromFolder(ids, f.id); clearSelection(); } }] : []),
      selectAll,
    ];
  }
  const box = $('#select-actions');
  box.innerHTML = '';
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = `icon-btn ripple${a.active ? ' active' : ''}`;
    b.setAttribute('aria-label', a.label); b.title = a.label;
    b.innerHTML = icon(a.name);
    b.addEventListener('click', a.fn);
    box.appendChild(b);
  });
  const m = document.createElement('button');
  m.className = 'icon-btn ripple'; m.setAttribute('aria-label', 'Más acciones'); m.title = 'Más acciones';
  m.innerHTML = icon('more');
  m.addEventListener('click', (e) => openMenu(e.currentTarget, more));
  box.appendChild(m);
}
$('#btn-select-close').addEventListener('click', clearSelection);

/* ---------- Papelera: plazo y borrado automático ---------- */
function showTrashSettings() {
  const cur = state.org.settings.trashDays;
  openSheet(`<h2 class="sheet-title">Plazo de la papelera</h2>
    <p class="sheet-text">Las notas de la papelera se eliminan definitivamente al cumplirse este plazo.</p>
    <div class="picker-list">${TRASH_OPTIONS.map(([d, label]) => `<button class="picker-item ripple" data-days="${d}"><span class="radio${d === cur ? ' on' : ''}"></span><span>${label}</span></button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
      state.repo.saveSettings({ trashDays: Number(b.dataset.days) });
      closeOverlays();
      snackbar('Plazo de la papelera guardado');
    }));
  });
}

/* ---------- Título automático para notas nuevas sin título ---------- */
const AUTO_TITLE_MODES = [
  ['phrase', 'Primera frase de la nota'],
  ['prefix', 'Prefijo'],
  ['both', 'Prefijo + primera frase'],
];

// Primera frase: hasta el primer punto (seguido de espacio o fin del texto) o el primer salto de línea, lo que aparezca antes.
// Un punto pegado a otro carácter (3.5, www.sitio.com) no corta la frase.
function firstPhrase(text) {
  const t = String(text || '').replace(/^\s+/, '');
  if (!t) return '';
  let cut = t.length;
  const nl = t.indexOf('\n');
  if (nl >= 0) cut = nl;
  const dot = t.search(/\.(?=\s|$)/);
  if (dot >= 0 && dot < cut) cut = dot;
  return t.slice(0, cut).replace(/\.+$/, '').trim();
}

function buildAutoTitle(mode, prefix, text) {
  const phrase = firstPhrase(text);
  if (mode === 'prefix') return (prefix || '').trim();
  if (mode === 'both') return ((prefix || '') + phrase).trim();
  return phrase;
}

function autoTitleFor(text) {
  const st = state.org.settings;
  if (!st.autoTitleOn) return '';
  return buildAutoTitle(st.autoTitleMode || 'phrase', st.autoTitlePrefix || '', text);
}

/* ---------- Ocultar/mostrar por reglas: panel ---------- */
const SHARED_WHO = [
  ['withMe', 'Las que me compartieron'], ['byMe', 'Las mías que compartí con otros'],
  ['mine', 'Solo las mías (no las que me compartieron)'], ['owner', 'Las de un dueño en particular'],
];
const UNORG_WHAT = [['folder', 'Sin carpeta'], ['label', 'Sin etiqueta'], ['both', 'Sin carpeta ni etiqueta']];

function rulesLabel() {
  const cfg = rulesCfg();
  const k = cfg.rules.filter(ruleActive).length;
  if (!cfg.rules.length) return '';
  if (!cfg.on) return ' (apagadas)';
  const v = activeView(cfg);
  return k ? ` (${v ? `${esc(v.name)}: ` : ''}${k} activa${k > 1 ? 's' : ''})` : ' (sin efecto)';
}

// Dueños de las notas que me compartieron (para la regla "de un dueño en particular")
function sharedOwners() {
  const m = new Map();
  state.notes.forEach((n) => {
    if (n.owner && n.owner !== state.user?.uid && !m.has(n.owner)) m.set(n.owner, n.members?.[n.owner]?.name || n.members?.[n.owner]?.email || 'Usuario');
  });
  return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}

function ruleText(r) {
  const names = (arr) => arr.filter(Boolean).join(', ');
  switch (r.type) {
    case 'label': return `Etiqueta: ${names((r.ids || []).map((id) => labelById(id)?.name)) || '(borrada)'}`;
    case 'folder': return `Carpeta: ${names((r.ids || []).filter((id) => folderById(id)).map(folderPath)) || '(borrada)'}${r.sub ? ' (con subcarpetas)' : ''}`;
    case 'color': return `Color: ${names((r.colors || []).map((c) => COLORS.find(([k]) => k === c)?.[1]))}`;
    case 'shared': return r.who === 'owner' ? `Compartidas por ${r.ownerName || 'un usuario'}` : (SHARED_WHO.find(([k]) => k === r.who)?.[1] || 'Compartidas');
    case 'unorg': return UNORG_WHAT.find(([k]) => k === r.what)?.[1] || 'Sin organizar';
    case 'complete': return 'Listas completas (todas las casillas tildadas)';
    case 'age': return `Sin cambios hace más de ${plural(Number(r.days) || 0, 'día', 'días')}`;
    case 'locked': return 'Bloqueadas con huella';
    case 'template': return r.ids?.length
      ? `Creadas desde la plantilla: ${names(r.ids.map((id) => { const t = noteById(id); return t ? (t.title || 'Sin título') : null; })) || '(borrada)'}`
      : 'Creadas desde una plantilla (cualquiera)';
    default: return 'Regla';
  }
}

function showRulesSettings() {
  const ui = { cfg: rulesCfg(), screen: 'main', idx: -1, draft: null };
  // Con una vista elegida, saveRules copia los cambios en esa vista
  const save = () => saveRules(ui.cfg);
  const reload = () => { ui.cfg = rulesCfg(); if ($('#sheet').classList.contains('open') && ui.screen === 'main') paint(); };
  const viewsHtml = () => {
    const views = [...hideViewsList()].sort(byName);
    const cur = ui.cfg.view || null;
    const rows = views.map((v) => `<div class="rl-rule rl-view">
        <button class="picker-item ripple rl-wrap rl-view-pick" data-view="${esc(v.id)}">${radio(v.id === cur)}<span>${esc(v.name)}</span></button>
        <button class="icon-btn small ripple" data-vren="${esc(v.id)}" aria-label="Cambiar el nombre">${icon('edit')}</button>
        <button class="icon-btn small ripple" data-vdel="${esc(v.id)}" aria-label="Borrar la vista">${icon('delete')}</button>
      </div>`).join('');
    return `<div class="rl-head">Vista</div>
      ${views.length ? `${rows}<div class="rl-rule rl-view"><button class="picker-item ripple rl-wrap rl-view-pick" data-view="">${radio(!cur)}<span>Sin vista (reglas sin nombre)</span></button></div>
        <p class="sheet-text rl-small">${cur ? 'Los cambios de abajo se guardan solos en esta vista.' : 'Al elegir una vista, estas reglas sin nombre quedan guardadas para volver con «Sin vista».'} También se cambia desde ⋮ Menú.</p>`
    : '<p class="sheet-text rl-small">Guardá estas reglas con un nombre («Trabajo», «Hogar») para cambiar entre ellas desde ⋮ Menú.</p>'}
      <div class="sheet-actions"><button class="text-btn ripple" id="rl-vnew">${icon('add')}<span>Nueva vista con estas reglas</span></button></div>`;
  };
  const askViewName = async (title, value = '', skip = null) => {
    const r = await openDialog({ title, input: true, value, placeholder: 'Ej.: Trabajo', ok: 'Guardar' });
    const name = r?.value?.trim().slice(0, 40);
    if (!name) return null;
    if (hideViewsList().some((v) => v.id !== skip && v.name.toLowerCase() === name.toLowerCase())) { snackbar('Ya hay una vista con ese nombre'); return null; }
    return name;
  };
  const radio = (on) => `<span class="radio${on ? ' on' : ''}"></span>`;
  const check = (on) => `<span class="checkbox ${on ? 'all' : 'none'}"></span>`;
  const item = (attrs, mark, text, extra = '') => `<button class="picker-item ripple rl-wrap" ${attrs}>${mark}${extra}<span>${text}</span></button>`;
  const typeIcon = (t) => icon(RULE_TYPES.find(([k]) => k === t)?.[2] || 'visibility');
  const types = () => RULE_TYPES.filter(([k]) => k !== 'shared' || state.mode === 'cloud');

  const mainHtml = () => {
    const c = ui.cfg;
    const cands = mainCandidates();
    rulesMemo = null;
    const tmp = rulesCtx(); // save() ya dejó ui.cfg en los ajustes
    const hiddenN = cands.filter((n) => hiddenByRules(n, tmp)).length;
    const rulesList = c.rules.map((r, i) => `<div class="rl-rule${ruleActive(r) ? '' : ' off'}">
        <span class="rl-ico">${typeIcon(r.type)}</span><span class="rl-text">${esc(ruleText(r))}${ruleActive(r) ? '' : ' <small>(sin efecto)</small>'}</span>
        <button class="icon-btn small ripple" data-edit="${i}" aria-label="Cambiar la regla">${icon('edit')}</button>
        <button class="icon-btn small ripple" data-del="${i}" aria-label="Quitar la regla">${icon('delete')}</button>
      </div>`).join('') || '<p class="sheet-text">Todavía no hay reglas.</p>';
    return `<h2 class="sheet-title">Ocultar o mostrar por reglas</h2>
      <p class="sheet-text">Se aplican solo a la pantalla principal de Notas: en carpetas, etiquetas, archivo, recordatorios, compartidas y búsqueda las notas siguen apareciendo. Valen en todos tus dispositivos.</p>
      <button class="picker-item ripple at-switch" id="rl-on" role="switch" aria-checked="${c.on}"><span>Reglas activadas</span><span class="spacer"></span><span class="switch${c.on ? ' on' : ''}"></span></button>
      ${viewsHtml()}
      <div class="at-opts${c.on ? '' : ' off'}">
        <div class="rl-head">Qué hacer${activeView(c) ? ` <span class="rl-vname">· vista «${esc(activeView(c).name)}»</span>` : ''}</div>
        ${item('data-mode="hide"', radio(c.mode !== 'show'), 'Ocultar las que cumplan las reglas')}
        ${item('data-mode="show"', radio(c.mode === 'show'), 'Mostrar solo las que cumplan las reglas')}
        ${c.rules.length > 1 ? `<div class="rl-head">Con varias reglas</div>
        ${item('data-combine="any"', radio(c.combine !== 'all'), 'Alcanza con que cumpla <strong>cualquiera</strong> de las reglas')}
        ${item('data-combine="all"', radio(c.combine === 'all'), 'Tiene que cumplir <strong>todas</strong> las reglas a la vez')}` : ''}
        ${item('id="rl-pinned"', check(c.keepPinned), 'Las fijadas se ven siempre, aunque cumplan (o no) las reglas')}
        <div class="rl-head">Reglas</div>
        ${rulesList}
        <div class="sheet-actions"><button class="text-btn ripple" id="rl-add">${icon('add')}<span>Agregar regla</span></button></div>
        <p class="sheet-text rl-result">${c.on && tmp.rules.length
          ? `En la pantalla principal se ven <strong>${cands.length - hiddenN}</strong> de ${plural(cands.length, 'nota', 'notas')} (${hiddenN} oculta${hiddenN === 1 ? '' : 's'} por las reglas).`
          : 'Ahora las reglas no ocultan ninguna nota.'}</p>
      </div>
      <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="rl-ok">Listo</button></div>`;
  };

  const typesHtml = () => `<h2 class="sheet-title">Agregar regla</h2>
    <p class="sheet-text">Elegí el criterio:</p>
    <div class="picker-list">${types().map(([k, l, ic]) => `<button class="picker-item ripple" data-type="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    <div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="rl-back">Volver</button></div>`;

  const editHtml = () => {
    const d = ui.draft;
    const title = RULE_TYPES.find(([k]) => k === d.type)?.[1] || 'Regla';
    let inner = '';
    if (d.type === 'label') {
      const ls = [...state.org.labels].sort(byName);
      inner = ls.length ? `<p class="sheet-text">Notas con alguna de estas etiquetas:</p><div class="picker-list">${ls.map((l) => item(`data-pick="${esc(l.id)}"`, check(d.ids.includes(l.id)), esc(l.name), `<i class="dot dot-lg" style="background:${esc(l.color || '#757575')}"></i>`)).join('')}</div>`
        : '<p class="sheet-text">Todavía no hay etiquetas.</p>';
    } else if (d.type === 'folder') {
      const tree = folderTree();
      inner = tree.length ? `<p class="sheet-text">Notas que están en alguna de estas carpetas:</p><div class="picker-list">${tree.map((fo) => `<button class="picker-item ripple" style="--depth:${fo.depth}" data-pick="${esc(fo.id)}">${check(d.ids.includes(fo.id))}${icon('folder')}<span>${esc(fo.name || 'Sin nombre')}</span></button>`).join('')}</div>
        ${item('id="rl-sub"', check(d.sub), 'Incluir las subcarpetas')}`
        : '<p class="sheet-text">Todavía no hay carpetas.</p>';
    } else if (d.type === 'color') {
      inner = `<p class="sheet-text">Notas de alguno de estos colores:</p><div class="picker-list">${COLORS.map(([k, l]) => item(`data-pick="${k}"`, check(d.colors.includes(k)), l, `<i class="dot dot-lg note-dot" data-color="${k}"></i>`)).join('')}</div>`;
    } else if (d.type === 'shared') {
      const owners = sharedOwners();
      inner = SHARED_WHO.map(([k, l]) => item(`data-who="${k}"`, radio(d.who === k), l)).join('')
        + (d.who === 'owner' ? (owners.length ? `<div class="rl-head">Dueño</div><div class="picker-list">${owners.map(([uid, name]) => item(`data-owner="${esc(uid)}"`, radio(d.owner === uid), esc(name))).join('')}</div>`
          : '<p class="sheet-text">Nadie te compartió notas todavía.</p>') : '');
    } else if (d.type === 'unorg') {
      inner = UNORG_WHAT.map(([k, l]) => item(`data-what="${k}"`, radio(d.what === k), l)).join('');
    } else if (d.type === 'age') {
      inner = `<label class="field"><span>Notas sin cambios hace más de… (días)</span><input type="number" id="rl-days" min="1" step="1" inputmode="numeric" value="${esc(String(d.days || ''))}"></label>
        <div class="hm-segs">${[7, 30, 90, 180, 365].map((k) => `<button class="chip ripple${Number(d.days) === k ? ' on' : ''}" data-days="${k}"><span>${k === 365 ? '1 año' : `${k} días`}</span></button>`).join('')}</div>`;
    } else if (d.type === 'template') {
      const ts = state.notes.filter((n) => n.template && !n.trashed);
      inner = `<p class="sheet-text">Si no elegís ninguna, vale cualquier plantilla. Solo se reconocen las notas creadas desde una plantilla a partir de la v0.3.2.</p>
        ${ts.length ? `<div class="picker-list">${ts.map((t) => item(`data-pick="${esc(t.id)}"`, check(d.ids.includes(t.id)), esc(t.title || 'Sin título'))).join('')}</div>` : '<p class="sheet-text">Todavía no hay plantillas.</p>'}`;
    } else if (d.type === 'complete') {
      inner = '<p class="sheet-text">Notas con casillas en las que todas están tildadas.</p>';
    } else if (d.type === 'locked') {
      inner = '<p class="sheet-text">Notas bloqueadas con huella.</p>';
    }
    return `<h2 class="sheet-title">${ui.idx >= 0 ? 'Cambiar regla' : 'Nueva regla'}: ${esc(title)}</h2>${inner}
      <p class="sheet-text rl-result" id="rl-count">${editResult(d)}</p>
      <div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="rl-back">Cancelar</button><button class="filled-btn ripple" id="rl-save"${ruleActive(d) ? '' : ' disabled'}>Guardar</button></div>`;
  };
  // Cuántas notas de la pantalla principal cumplen la regla que se está armando
  const editResult = (d) => {
    if (!ruleActive(d)) return 'Elegí al menos una opción.';
    const r = withSet(d); const now = Date.now();
    const n = mainCandidates().filter((x) => ruleMatch(r, x, now)).length;
    return `Cumplen esta regla: <strong>${plural(n, 'nota', 'notas')}</strong> de la pantalla principal.`;
  };

  const newDraft = (type) => ({
    label: { type, ids: [] }, folder: { type, ids: [], sub: true }, color: { type, colors: [] },
    shared: { type, who: 'withMe' }, unorg: { type, what: 'both' }, age: { type, days: 30 }, template: { type, ids: [] },
  }[type] || { type });

  const paint = (keepScroll = true) => {
    const prev = $('#sheet').scrollTop;
    const html = ui.screen === 'types' ? typesHtml() : ui.screen === 'edit' ? editHtml() : mainHtml();
    openSheet(`<div class="rl-sheet">${html}</div>`, (body) => {
      const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b)));
      if (ui.screen === 'main') {
        const c = ui.cfg;
        on('#rl-on', () => { c.on = !c.on; if (c.on) rulesPeek = false; save(); paint(); snackbar(c.on ? 'Reglas activadas' : 'Reglas apagadas: se ven todas las notas'); });
        // Vistas con nombre
        on('[data-view]', (b) => { applyView(b.dataset.view || null); reload(); });
        on('#rl-vnew', async () => {
          const name = await askViewName('Nueva vista');
          if (!name) return;
          const cur = rulesCfg();
          const id = newViewId();
          const views = [...hideViewsList(), { id, name, cfg: ruleCore(cur) }];
          saveRules({ ...cur, view: id, loose: cur.view ? cur.loose : ruleCore(cur) }, views);
          reload();
          snackbar(`Vista «${name}» guardada y elegida`);
        });
        on('[data-vren]', async (b) => {
          const v = hideViewsList().find((x) => x.id === b.dataset.vren);
          if (!v) return;
          const name = await askViewName('Nombre de la vista', v.name, v.id);
          if (!name || name === v.name) return;
          saveRules(rulesCfg(), hideViewsList().map((x) => (x.id === v.id ? { ...x, name } : x)));
          reload();
        });
        on('[data-vdel]', (b) => {
          const prevCfg = JSON.parse(JSON.stringify(rulesCfg()));
          const prevViews = JSON.parse(JSON.stringify(hideViewsList()));
          const v = prevViews.find((x) => x.id === b.dataset.vdel);
          if (!v) return;
          const cur = rulesCfg();
          // Si era la elegida, sus reglas quedan como reglas sin nombre (la pantalla no cambia)
          const next = cur.view === v.id ? { ...cur, view: null, loose: null } : cur;
          saveRules(next, prevViews.filter((x) => x.id !== v.id));
          reload();
          snackbar(cur.view === v.id ? `Vista «${v.name}» borrada: sus reglas quedan sin nombre` : `Vista «${v.name}» borrada`, 'Deshacer', () => { saveRules(prevCfg, prevViews); reload(); });
        });
        on('[data-mode]', (b) => { c.mode = b.dataset.mode; save(); paint(); });
        on('[data-combine]', (b) => { c.combine = b.dataset.combine; save(); paint(); });
        on('#rl-pinned', () => { c.keepPinned = !c.keepPinned; save(); paint(); });
        on('#rl-add', () => { ui.screen = 'types'; paint(false); });
        on('[data-edit]', (b) => { ui.idx = Number(b.dataset.edit); ui.draft = JSON.parse(JSON.stringify(c.rules[ui.idx])); ui.screen = 'edit'; paint(false); });
        on('[data-del]', (b) => {
          const i = Number(b.dataset.del); const removed = c.rules[i];
          c.rules = c.rules.filter((_, j) => j !== i); save(); paint();
          snackbar('Regla quitada', 'Deshacer', () => { c.rules = [...c.rules.slice(0, i), removed, ...c.rules.slice(i)]; save(); if ($('#sheet').classList.contains('open') && ui.screen === 'main') paint(); });
        });
        on('#rl-ok', closeOverlays);
      } else if (ui.screen === 'types') {
        on('[data-type]', (b) => { ui.idx = -1; ui.draft = newDraft(b.dataset.type); ui.screen = 'edit'; paint(false); });
        on('#rl-back', () => { ui.screen = 'main'; paint(false); });
      } else {
        const d = ui.draft;
        const listKey = d.type === 'color' ? 'colors' : 'ids';
        on('[data-pick]', (b) => {
          const v = b.dataset.pick; const arr = d[listKey];
          d[listKey] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]; paint();
        });
        on('#rl-sub', () => { d.sub = !d.sub; paint(); });
        on('[data-who]', (b) => { d.who = b.dataset.who; if (d.who !== 'owner') { delete d.owner; delete d.ownerName; } paint(); });
        on('[data-owner]', (b) => { d.owner = b.dataset.owner; d.ownerName = sharedOwners().find(([u]) => u === d.owner)?.[1] || ''; paint(); });
        on('[data-what]', (b) => { d.what = b.dataset.what; paint(); });
        on('[data-days]', (b) => { d.days = Number(b.dataset.days); paint(); });
        const days = body.querySelector('#rl-days');
        // Sin redibujar mientras se escribe (no se pierde el toque en «Guardar» ni el teclado)
        if (days) days.addEventListener('input', () => {
          d.days = Math.max(0, Math.round(Number(days.value) || 0));
          body.querySelector('#rl-count').innerHTML = editResult(d);
          body.querySelector('#rl-save').disabled = !ruleActive(d);
          body.querySelectorAll('[data-days]').forEach((x) => x.classList.toggle('on', Number(x.dataset.days) === d.days));
        });
        on('#rl-back', () => { ui.screen = ui.idx >= 0 ? 'main' : 'types'; paint(false); });
        on('#rl-save', () => {
          if (days) d.days = Math.max(0, Math.round(Number(days.value) || 0));
          if (!ruleActive(d)) { paint(); return; }
          const c = ui.cfg;
          if (ui.idx >= 0) c.rules = c.rules.map((r, j) => (j === ui.idx ? d : r)); else c.rules = [...c.rules, d];
          if (!c.on) c.on = true;
          save(); ui.screen = 'main'; paint(false);
          snackbar(ui.idx >= 0 ? 'Regla cambiada' : 'Regla agregada');
        });
      }
    });
    $('#sheet').scrollTop = keepScroll ? prev : 0;
  };
  paint(false);
}

function showAutoTitleSettings() {
  const st = state.org.settings;
  const cur = { on: !!st.autoTitleOn, mode: st.autoTitleMode || 'phrase', prefix: st.autoTitlePrefix ?? '' };
  const save = (patch) => { state.repo.saveSettings(patch); Object.assign(state.org.settings, patch); };
  openSheet(`<h2 class="sheet-title">Título automático</h2>
    <p class="sheet-text">Si creás una nota y la cerrás sin título, se le pone uno automáticamente. Las notas que ya existen no cambian.</p>
    <button class="picker-item ripple at-switch" id="at-on" role="switch" aria-checked="${cur.on}"><span>Activar título automático</span><span class="spacer"></span><span class="switch${cur.on ? ' on' : ''}"></span></button>
    <div id="at-opts" class="at-opts${cur.on ? '' : ' off'}">
      <div class="picker-list">${AUTO_TITLE_MODES.map(([k, label]) => `<button class="picker-item ripple" data-mode="${k}"><span class="radio${k === cur.mode ? ' on' : ''}"></span><span>${label}</span></button>`).join('')}</div>
      <label class="field" id="at-prefix-field"><span>Prefijo (se respetan los espacios del final)</span><input type="text" id="at-prefix" value="${esc(cur.prefix)}" placeholder="Ej.: Idea - " autocomplete="off"></label>
      <p class="sheet-text">La primera frase llega hasta el primer punto o el primer salto de línea, lo que aparezca antes.</p>
      <p class="sheet-text" id="at-example"></p>
    </div>`, (body) => {
    const paint = () => {
      body.querySelector('#at-on').setAttribute('aria-checked', String(cur.on));
      body.querySelector('.switch').classList.toggle('on', cur.on);
      body.querySelector('#at-opts').classList.toggle('off', !cur.on);
      body.querySelectorAll('[data-mode]').forEach((b) => b.querySelector('.radio').classList.toggle('on', b.dataset.mode === cur.mode));
      body.querySelector('#at-prefix-field').classList.toggle('off', cur.mode === 'phrase');
      const ex = buildAutoTitle(cur.mode, cur.prefix, 'Comprar pan y leche. Pasar por la farmacia');
      body.querySelector('#at-example').innerHTML = `Ejemplo con «Comprar pan y leche. Pasar por la farmacia» → <strong>${ex ? esc(ex) : '(sin título)'}</strong>`;
    };
    body.querySelector('#at-on').addEventListener('click', () => {
      cur.on = !cur.on; save({ autoTitleOn: cur.on }); paint(); renderDrawer();
      snackbar(cur.on ? 'Título automático activado' : 'Título automático desactivado');
    });
    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      cur.mode = b.dataset.mode; save({ autoTitleMode: cur.mode }); paint();
      if (cur.mode !== 'phrase' && !cur.prefix.trim()) body.querySelector('#at-prefix').focus();
    }));
    let t = null;
    const input = body.querySelector('#at-prefix');
    input.addEventListener('input', () => {
      cur.prefix = input.value; paint();
      clearTimeout(t); t = setTimeout(() => save({ autoTitlePrefix: cur.prefix }), 500);
    });
    input.addEventListener('change', () => { clearTimeout(t); save({ autoTitlePrefix: input.value }); });
    paint();
  });
}

async function emptyTrash() {
  const ids = state.notes.filter((n) => n.trashed).map((n) => n.id);
  if (!ids.length) { snackbar('La papelera está vacía'); return; }
  await deleteForever(ids);
}

function maybePurge() {
  if (state.purged || !state.repo?.serverLoaded || !state.org.settingsLoaded) return;
  state.purged = true;
  const days = state.org.settings.trashDays;
  const now = Date.now();
  state.notes.filter((n) => n.trashed).forEach((n) => {
    if (!n.trashedAt) { state.repo.setMeta(n.id, { trashedAt: now }); return; } // empieza a contar el plazo
    if (days > 0 && now - n.trashedAt > days * 86400000) {
      if (state.repo.canPurge(n)) state.repo.removeCompletely(n.id); else state.repo.leaveNote(n.id);
      removeNoteReminders(n.id);
    }
  });
}

/* ---------- Fase 1B: búsqueda con filtros ---------- */
const normalize = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function matchesSearch(n) {
  const s = state.search;
  if (n.trashed || n.template) return false;
  if (n.archived && !s.archived) return false;
  if ((n.hidden || hiddenByRules(n)) && s.noHidden) return false; // también las ocultas por reglas
  if (s.folder && !(n.folders || []).includes(s.folder)) return false;
  if (s.label && !(n.labels || []).includes(s.label)) return false;
  if (s.color && (n.color || 'default') !== s.color) return false;
  if (s.checks === 'with' && !n.checks?.total) return false;
  if (s.checks === 'pending' && !(n.checks?.total > n.checks?.done)) return false;
  if (s.checks === 'done' && !(n.checks?.total && n.checks.total === n.checks.done)) return false;
  if (s.days && (n.updated || 0) < Date.now() - s.days * 86400000) return false;
  const q = normalize(s.q).trim();
  if (!q) return true;
  const hay = normalize(n.locked && !state.unlocked.has(n.id) ? (n.title || '') : `${n.title || ''} ${n.text || n.preview || ''}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function openSearch() {
  state.search.active = true;
  clearSelection();
  $('#appbar-list').hidden = true;
  $('#appbar-search').hidden = false;
  $('#search-filters').hidden = false;
  renderSearchFilters();
  renderList();
  setTimeout(() => $('#search-input').focus(), 30);
}

function closeSearch() {
  Object.assign(state.search, { active: false, q: '', folder: null, label: null, color: null, checks: null, days: null, archived: false, noHidden: false });
  $('#search-input').value = '';
  $('#btn-search-clear').hidden = true;
  $('#appbar-search').hidden = true;
  $('#search-filters').hidden = true;
  $('#appbar-list').hidden = state.selection.size > 0;
  renderList();
}

let searchTimer;
$('#btn-search').addEventListener('click', openSearch);
$('#btn-search-close').addEventListener('click', closeSearch);
$('#search-input').addEventListener('input', () => {
  state.search.q = $('#search-input').value;
  $('#btn-search-clear').hidden = !state.search.q;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 120);
});
$('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#search-input').blur(); });
$('#btn-search-clear').addEventListener('click', () => {
  $('#search-input').value = ''; state.search.q = ''; $('#btn-search-clear').hidden = true; renderList(); $('#search-input').focus();
});

function renderSearchFilters() {
  const s = state.search;
  const colorName = (k) => COLORS.find(([key]) => key === k)?.[1] || k;
  const checksName = { with: 'Con casillas', pending: 'Casillas pendientes', done: 'Casillas completas' };
  const daysName = { 1: 'Hoy', 7: 'Últimos 7 días', 30: 'Últimos 30 días', 365: 'Último año' };
  const chip = (key, label, value) => `<button class="chip filter-chip ripple${value ? ' on' : ''}" data-filter="${key}"><span>${esc(value || label)}</span>${icon('dropdown')}</button>`;
  $('#search-filters').innerHTML = [
    chip('folder', 'Carpeta', s.folder && folderPath(s.folder)),
    chip('label', 'Etiqueta', s.label && labelById(s.label)?.name),
    chip('color', 'Color', s.color && colorName(s.color)),
    chip('checks', 'Casillas', s.checks && checksName[s.checks]),
    chip('days', 'Fecha', s.days && daysName[s.days]),
    `<button class="chip filter-chip ripple${s.archived ? ' on' : ''}" data-filter="archived">${s.archived ? icon('check') : ''}<span>Incluir archivadas</span></button>`,
    `<button class="chip filter-chip ripple${s.noHidden ? ' on' : ''}" data-filter="noHidden">${s.noHidden ? icon('check') : ''}<span>Excluir ocultas</span></button>`,
  ].join('');
  $('#search-filters').querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', (e) => openFilterMenu(b.dataset.filter, e.currentTarget)));
}

function openFilterMenu(key, anchor) {
  const s = state.search;
  const set = (v) => { s[key] = v; renderSearchFilters(); renderList(); };
  if (key === 'archived') { set(!s.archived); return; }
  if (key === 'noHidden') { set(!s.noHidden); return; }
  const any = { label: 'Cualquiera', checked: !s[key], onClick: () => set(null) };
  let items = [];
  if (key === 'folder') items = folderTree().map((fo) => ({ label: `${'\u00A0\u00A0\u00A0'.repeat(fo.depth)}${esc(fo.name)}`, checked: s.folder === fo.id, onClick: () => set(fo.id) }));
  if (key === 'label') items = [...state.org.labels].sort(byName).map((l) => ({ label: esc(l.name), checked: s.label === l.id, onClick: () => set(l.id) }));
  if (key === 'color') items = COLORS.map(([k, label]) => ({ label, checked: s.color === k, onClick: () => set(k) }));
  if (key === 'checks') items = [['with', 'Con casillas'], ['pending', 'Con casillas pendientes'], ['done', 'Con todas tildadas']].map(([v, label]) => ({ label, checked: s.checks === v, onClick: () => set(v) }));
  if (key === 'days') items = [[1, 'Hoy'], [7, 'Últimos 7 días'], [30, 'Últimos 30 días'], [365, 'Último año']].map(([v, label]) => ({ label: `Editadas: ${label.toLowerCase()}`, checked: s.days === v, onClick: () => set(v) }));
  if (!items.length) items = [{ label: key === 'folder' ? 'No hay carpetas' : 'No hay etiquetas', disabled: true }];
  openMenu(anchor, [any, { divider: true }, ...items]);
}

/* ---------- Orden y vista ---------- */
function showSortSheet() {
  const cur = state.org.settings.sort || 'updated';
  openSheet(`<h2 class="sheet-title">Ordenar por</h2>
    <p class="sheet-text">Se aplica a todas tus listas. En el orden manual, arrastrá cada nota desde su manija.</p>
    <div class="picker-list">${SORTS.map(([k, label]) => `<button class="picker-item ripple" data-sort="${k}"><span class="radio${k === cur ? ' on' : ''}"></span><span>${label}</span></button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      state.repo.saveSettings({ sort: b.dataset.sort });
      state.org.settings.sort = b.dataset.sort; // reflejo inmediato
      closeOverlays();
      renderList();
    }));
  });
}

$('#btn-layout').addEventListener('click', () => {
  state.layout = state.layout === 'list' ? 'grid' : 'list';
  localStorage.setItem('notas-layout', state.layout);
  renderList();
});

let lastCols = 0;
window.addEventListener('resize', () => {
  const c = columnCount();
  if (c !== lastCols) { lastCols = c; if (state.view === 'list') renderList(); }
});

/* ---------- Orden manual: arrastrar desde la manija ---------- */
function attachDrag(handle, el, n) {
  handle.addEventListener('click', (e) => e.stopPropagation());
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const grid = el.closest('.grid');
    const ids = (grid.dataset.ids || '').split(',').filter(Boolean);
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.appendChild(ghost);
    el.classList.add('drag-source');
    haptic();
    const ox = e.clientX - rect.left; const oy = e.clientY - rect.top;
    const scroller = $('#list-scroll');
    let target = null; let before = true; let autoScroll = 0;
    const tick = () => { if (autoScroll) { scroller.scrollTop += autoScroll; requestAnimationFrame(tick); } };
    const clearMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    const move = (ev) => {
      ghost.style.left = `${ev.clientX - ox}px`;
      ghost.style.top = `${ev.clientY - oy}px`;
      clearMarks();
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.card');
      if (under && under !== el && under.closest('.grid') === grid) {
        const r = under.getBoundingClientRect();
        before = ev.clientY < r.top + r.height / 2;
        target = under.dataset.id;
        under.classList.add(before ? 'drop-before' : 'drop-after');
      } else target = null;
      const sr = scroller.getBoundingClientRect();
      const was = autoScroll;
      autoScroll = ev.clientY < sr.top + 60 ? -8 : ev.clientY > sr.bottom - 60 ? 8 : 0;
      if (autoScroll && !was) requestAnimationFrame(tick);
    };
    const end = (ok) => {
      autoScroll = 0;
      handle.removeEventListener('pointermove', move);
      ghost.remove();
      el.classList.remove('drag-source');
      clearMarks();
      if (ok && target) reorder(n.id, target, before, ids);
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => end(true), { once: true });
    handle.addEventListener('pointercancel', () => end(false), { once: true });
  });
}

function reorder(id, targetId, before, ids) {
  const arr = ids.filter((x) => x !== id);
  let i = arr.indexOf(targetId);
  if (i < 0) return;
  if (!before) i++;
  arr.splice(i, 0, id);
  arr.forEach((x, k) => {
    const n = noteById(x);
    const order = (k + 1) * 1000;
    if (n && n.order !== order) { n.order = order; state.repo.setMeta(x, { order }); }
  });
  haptic();
  renderList();
}

/* ---------- Plantillas ---------- */
async function useTemplate(id) {
  const f = state.filter;
  const meta = { ...(f.kind === 'folder' ? { folders: [f.id] } : f.kind === 'label' ? { labels: [f.id] } : {}), fromTemplate: id };
  const created = await copyNotes([id], { fromTemplate: true, meta, quiet: true });
  if (!created?.length) return;
  if (f.kind === 'templates' || f.kind === 'archive' || f.kind === 'trash') state.filter = { kind: 'notes' };
  renderList();
  setTimeout(() => openNote(created[0].id, { meta: { ...meta, template: false } }), 300);
}

function pickTemplate() {
  const templates = sortNotes(state.notes.filter((n) => n.template && !n.trashed));
  if (!templates.length) {
    snackbar('Todavía no hay plantillas', 'Ver plantillas', () => setFilter({ kind: 'templates' }));
    return;
  }
  openSheet(`<h2 class="sheet-title">Nueva nota desde plantilla</h2>
    <div class="picker-list">${templates.map((t) => `<button class="picker-item ripple" data-tpl="${esc(t.id)}">${icon('template')}<span>${esc(t.title || t.preview?.slice(0, 60) || 'Plantilla sin título')}</span></button>`).join('')}</div>
    <div class="sheet-actions"><span class="spacer"></span><button class="text-btn ripple" id="tpl-manage">Administrar plantillas</button></div>`, (body) => {
    body.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => { closeOverlays(); useTemplate(b.dataset.tpl); }));
    body.querySelector('#tpl-manage').addEventListener('click', () => setFilter({ kind: 'templates' }));
  });
}

// Mantener presionado el botón + : nota desde plantilla
(() => {
  let t; let long = false;
  const fab = $('#fab');
  fab.addEventListener('pointerdown', () => { long = false; t = setTimeout(() => { long = true; haptic(); pickTemplate(); }, 500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => fab.addEventListener(ev, () => clearTimeout(t)));
  fab.addEventListener('click', (e) => { if (long) { e.stopImmediatePropagation(); long = false; } }, true);
  fab.addEventListener('contextmenu', (e) => e.preventDefault());
})();

/* ---------- Fase 2: recordatorios ---------- */
const activeReminders = (noteId) => state.reminders.filter((r) => !r.done && (!noteId || r.noteId === noteId));
const nextOf = (noteId) => {
  const list = activeReminders(noteId);
  if (!list.length) return null;
  return list.map((r) => ({ r, t: nextOccurrence(r) })).sort((a, b) => a.t - b.t)[0];
};
const reminderItemIds = () => new Set(activeReminders(state.current?.id).filter((r) => r.itemId).map((r) => r.itemId));

function onReminders(list) {
  state.reminders = list;
  scheduleReminders();
  renderList();
  renderDrawer();
  paintEditorChrome();
  refreshReminderMarks(editor);
}

function describeReminder(r) {
  const n = noteById(r.noteId);
  if (!n || n.trashed) return null;
  const title = n.title || (r.itemId ? 'Casilla pendiente' : 'Recordatorio');
  const body = n.locked ? 'Nota bloqueada: tocá para abrirla' : r.itemId ? `☐ ${r.itemText || 'Casilla'}` : (n.preview ? n.preview.slice(0, 160) : 'Tocá para abrir la nota');
  return { title, body };
}

let scheduleTimer;
function scheduleReminders() {
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    const act = activeReminders();
    syncNative(act, describeReminder);
    syncWeb(act, describeReminder, onWebReminder);
  }, 400);
}

function onWebReminder(r, d) {
  haptic();
  if (!showWebNotification(d.title, d.body, r.id, () => openNote(r.noteId))) { /* sin permiso: solo el aviso de la app */ }
  snackbar(`🔔 ${d.title}${r.itemId ? ` · ${r.itemText}` : ''}`, 'Abrir', () => openNote(r.noteId));
  renderList();
  if (r.repeat) scheduleReminders();
}

// Acciones de la notificación de Android
let pendingOpenNote = null;
async function handleReminderAction(actionId, rid, noteId) {
  const r = state.reminders.find((x) => x.id === rid);
  if (actionId === 'done' && r) { await completeReminder(r); return; }
  if (actionId === 'snooze' && r) {
    state.repo.saveReminder({ id: r.id, snoozedUntil: Date.now() + SNOOZE_MIN * 60000 });
    snackbar(`Recordatorio pospuesto ${SNOOZE_MIN} minutos`);
    return;
  }
  // Tocar la notificación: abrir la nota (cuando la lista ya esté cargada)
  if (noteId) {
    if (state.notes.some((n) => n.id === noteId)) openNote(noteId);
    else pendingOpenNote = noteId;
  }
}

async function completeReminder(r) {
  if (r.repeat) {
    state.repo.saveReminder({ id: r.id, snoozedUntil: null });
    snackbar('Listo. Vuelve a sonar en la próxima repetición');
  } else {
    state.repo.saveReminder({ id: r.id, done: true, snoozedUntil: null });
    if (r.itemId) await tickCasilla(r.noteId, r.itemId);
    snackbar(r.itemId ? 'Casilla tildada y recordatorio completado' : 'Recordatorio completado');
  }
}

// Tilda la casilla de un recordatorio "Hecho", aunque la nota no esté abierta
async function tickCasilla(noteId, itemId) {
  if (state.current?.id === noteId && editor) { checkTaskItem(editor, itemId); return; }
  const s = state.repo.session(noteId, () => {});
  try {
    await s.ready();
    const walk = (el) => {
      for (const ch of el.toArray()) {
        if (typeof ch.getAttribute !== 'function') continue;
        if (ch.nodeName === 'taskItem' && ch.getAttribute('id') === itemId) { ch.setAttribute('checked', true); return true; }
        if (walk(ch)) return true;
      }
      return false;
    };
    s.ydoc.transact(() => walk(s.fragment));
    s.flush();
  } finally { setTimeout(() => s.destroy(), 1500); }
}

// Al tildar en el editor una casilla con recordatorio, el recordatorio se completa
let casillaTimer;
function checkCasillaReminders() {
  clearTimeout(casillaTimer);
  casillaTimer = setTimeout(() => {
    const c = state.current;
    if (!c || !editor) return;
    const items = taskItems(editor);
    activeReminders(c.id).filter((r) => r.itemId && !r.repeat).forEach((r) => {
      if (items.get(r.itemId)?.checked) state.repo.saveReminder({ id: r.id, done: true });
    });
  }, 800);
}

function removeNoteReminders(noteId) {
  state.reminders.filter((r) => r.noteId === noteId).forEach((r) => state.repo.deleteReminder(r.id));
}

// Lista de recordatorios de la nota
function openReminderSheet(noteId) {
  const list = state.reminders.filter((r) => r.noteId === noteId && !r.done)
    .map((r) => ({ r, t: nextOccurrence(r) })).sort((a, b) => a.t - b.t);
  const repName = (k) => REPEATS.find(([v]) => v === k)?.[1] || '';
  const now = Date.now();
  openSheet(`<h2 class="sheet-title">Recordatorios</h2>
    ${list.length ? '' : '<p class="sheet-text">Esta nota no tiene recordatorios.</p>'}
    <div class="picker-list">${list.map(({ r, t }) => `
      <div class="rem-row${!r.repeat && t < now ? ' overdue' : ''}">
        ${icon(r.repeat ? 'repeat' : 'bell')}
        <div class="rem-text"><strong>${esc(formatWhen(t))}</strong>
          <small>${[r.repeat ? repName(r.repeat) : '', r.itemId ? `Casilla «${esc(r.itemText || '')}»` : 'Toda la nota'].filter(Boolean).join(' · ')}</small></div>
        <button class="icon-btn small ripple" data-done="${esc(r.id)}" aria-label="Marcar como hecho">${icon('check')}</button>
        <button class="icon-btn small ripple" data-edit="${esc(r.id)}" aria-label="Editar">${icon('edit')}</button>
        <button class="icon-btn small ripple" data-del="${esc(r.id)}" aria-label="Eliminar">${icon('close')}</button>
      </div>`).join('')}</div>
    <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="rem-add">${icon('bell')}<span>Agregar recordatorio</span></button></div>`, (body) => {
    body.querySelector('#rem-add').addEventListener('click', () => { closeOverlays(); setTimeout(() => openReminderForm(noteId), 150); });
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const r = state.reminders.find((x) => x.id === b.dataset.edit);
      closeOverlays(); setTimeout(() => openReminderForm(noteId, r), 150);
    }));
    body.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
      const r = state.reminders.find((x) => x.id === b.dataset.done);
      closeOverlays(); if (r) await completeReminder(r);
    }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      state.repo.deleteReminder(b.dataset.del);
      closeOverlays();
      snackbar('Recordatorio eliminado');
    }));
  });
}

const pad = (n) => String(n).padStart(2, '0');
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Formulario: fecha, hora, repetición; para toda la nota o para la casilla del cursor
function openReminderForm(noteId, existing = null) {
  const casilla = existing?.itemId
    ? { id: existing.itemId, text: existing.itemText }
    : (state.current?.id === noteId && editor ? currentTaskItem(editor) : null);
  const base = existing ? new Date(nextOccurrence(existing)) : (() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return d; })();
  const quick = [];
  const now = new Date();
  if (now.getHours() < 17) { const d = new Date(); d.setHours(18, 0, 0, 0); quick.push(['Hoy 18:00', d]); }
  { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); quick.push(['Mañana 9:00', d]); }
  { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); quick.push(['Lunes 9:00', d]); }
  { const d = new Date(Date.now() + 3600000); quick.push(['En 1 hora', d]); }

  openSheet(`<h2 class="sheet-title">${existing ? 'Editar recordatorio' : 'Nuevo recordatorio'}</h2>
    ${casilla ? `<div class="picker-list rem-target">
      <button class="picker-item ripple" data-target="note"><span class="radio${existing && !existing.itemId ? ' on' : ''}"></span><span>Toda la nota</span></button>
      <button class="picker-item ripple" data-target="item"><span class="radio${!existing || existing.itemId ? ' on' : ''}"></span><span>Casilla «${esc(casilla.text || 'sin texto')}»</span></button>
    </div>` : ''}
    <div class="chips-row rem-quick">${quick.map(([label], i) => `<button class="chip ripple" data-quick="${i}">${label}</button>`).join('')}</div>
    <div class="rem-fields">
      <label class="field"><span>Fecha</span><input type="date" id="rem-date" value="${dateValue(base)}"></label>
      <label class="field"><span>Hora</span><input type="time" id="rem-time" value="${timeValue(base)}"></label>
    </div>
    <label class="field"><span>Repetición</span><select id="rem-repeat">${REPEATS.map(([v, label]) => `<option value="${v || ''}"${(existing?.repeat || null) === v ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    <div class="sheet-actions"><span class="spacer"></span>
      <button class="text-btn ripple" id="rem-cancel">Cancelar</button>
      <button class="filled-btn ripple" id="rem-save">Guardar</button></div>`, (body) => {
    let target = casilla && (!existing || existing.itemId) ? 'item' : 'note';
    body.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => {
      target = b.dataset.target;
      body.querySelectorAll('[data-target] .radio').forEach((x) => x.classList.toggle('on', x.parentElement === b));
    }));
    body.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
      const d = quick[Number(b.dataset.quick)][1];
      body.querySelector('#rem-date').value = dateValue(d);
      body.querySelector('#rem-time').value = timeValue(d);
    }));
    body.querySelector('#rem-cancel').addEventListener('click', closeOverlays);
    body.querySelector('#rem-save').addEventListener('click', async () => {
      const date = body.querySelector('#rem-date').value;
      const time = body.querySelector('#rem-time').value;
      const repeat = body.querySelector('#rem-repeat').value || null;
      const at = new Date(`${date}T${time || '09:00'}`).getTime();
      if (!date || Number.isNaN(at)) { snackbar('Elegí la fecha y la hora'); return; }
      if (!repeat && at <= Date.now()) { snackbar('Elegí una fecha y hora futuras'); return; }
      closeOverlays();
      await saveReminder({
        id: existing?.id || orgId(), noteId, at, repeat, done: false, snoozedUntil: null,
        itemId: target === 'item' && casilla ? casilla.id : null,
        itemText: target === 'item' && casilla ? (casilla.text || '') : null,
        created: existing?.created || Date.now(),
      });
    });
  });
}

async function saveReminder(r) {
  if (isNative) {
    const ok = await ensureNativePermissions(async () => {
      if (localStorage.getItem('notas-pidio-alarmas')) return false;
      localStorage.setItem('notas-pidio-alarmas', '1');
      const res = await openDialog({
        title: 'Permitir alarmas exactas',
        text: 'Para que los recordatorios suenen a la hora justa, Android necesita el permiso «Alarmas y recordatorios». Se abre la configuración: activalo y volvé a la app.',
        ok: 'Abrir configuración',
      });
      return !!res;
    });
    if (!ok) snackbar('Sin permiso de notificaciones: el recordatorio se guarda, pero no va a sonar');
  } else {
    const ok = await askWebNotifications();
    if (!ok) snackbar('En la web el aviso aparece solo con la página abierta');
  }
  state.repo.saveReminder(r);
  snackbar(`Recordatorio: ${formatWhen(nextOccurrence(r))}${r.itemId ? ` · «${r.itemText || 'casilla'}»` : ''}`);
}

/* ---------- Fase 3: compartir y multiusuario ---------- */
const isShared = (n) => (n?.memberIds?.length || 0) > 1;
const myRole = (n) => state.repo?.roleOf(n) || 'owner';
const ROLE_NAMES = { owner: 'Dueño', edit: 'Puede editar', view: 'Solo puede ver' };

function onInvites(list) {
  state.invites = list;
  const b = $('#invites-banner');
  b.hidden = !list.length || state.mode !== 'cloud';
  if (list.length) {
    $('#invites-text').textContent = list.length === 1
      ? `${list[0].fromName || list[0].fromEmail} te compartió una nota`
      : `Tenés ${list.length} notas compartidas para aceptar`;
  }
  renderDrawer();
}

function showInvites() {
  const list = state.invites;
  openSheet(`<h2 class="sheet-title">Notas compartidas con vos</h2>
    ${list.length ? '' : '<p class="sheet-text">No hay invitaciones pendientes.</p>'}
    <div class="picker-list">${list.map((i) => `
      <div class="rem-row">
        ${icon('people')}
        <div class="rem-text"><strong>${esc(i.noteTitle || 'Nota sin título')}</strong>
          <small>${esc(i.fromName || '')} ${i.fromEmail ? `(${esc(i.fromEmail)})` : ''} · ${ROLE_NAMES[i.role] || ''}</small></div>
        <button class="text-btn ripple" data-decline="${esc(i.id)}">Rechazar</button>
        <button class="filled-btn ripple" data-accept="${esc(i.id)}">Aceptar</button>
      </div>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
      const inv = state.invites.find((x) => x.id === b.dataset.accept);
      b.disabled = true;
      try {
        await state.repo.acceptInvite(inv);
        closeOverlays();
        snackbar('Nota agregada a «Compartidas conmigo»', 'Abrir', () => openNote(inv.noteId));
      } catch (e) {
        b.disabled = false;
        snackbar(`No se pudo aceptar (${e?.code || 'error'}). ¿Ya se publicaron las reglas nuevas?`);
      }
    }));
    body.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', async () => {
      const inv = state.invites.find((x) => x.id === b.dataset.decline);
      await state.repo.declineInvite(inv);
      closeOverlays();
      snackbar('Invitación rechazada');
    }));
  });
}

// Hoja "Compartir": miembros, permisos, invitaciones pendientes e invitar por email
let unwatchInvites = null;
function openShareSheet(noteId) {
  if (!state.repo.canShare) {
    openSheet(`<h2 class="sheet-title">Compartir</h2>
      <p class="sheet-text">Para compartir notas hace falta iniciar sesión con Google: sin cuenta, las notas quedan solo en este dispositivo.</p>`);
    return;
  }
  const n = noteById(noteId);
  if (!n) return;
  const role = myRole(n);
  const owner = role === 'owner';
  let pending = [];
  const draw = (body) => {
    const note = noteById(noteId) || n;
    const members = (note.memberIds || []).map((uid) => ({
      uid, ...(note.members?.[uid] || {}),
      role: uid === note.owner ? 'owner' : (note.roles?.[uid] || 'edit'),
      me: uid === state.user?.uid,
    }));
    body.querySelector('.share-members').innerHTML = members.map((m) => `
      <div class="rem-row">
        <span class="avatar">${esc((m.name || m.email || '?').slice(0, 1).toUpperCase())}</span>
        <div class="rem-text"><strong>${esc(m.me ? `${m.name || 'Vos'} (vos)` : (m.name || m.email || 'Miembro'))}</strong><small>${esc(m.email || '')}</small></div>
        ${owner && m.role !== 'owner'
          ? `<select class="role-select" data-role-uid="${esc(m.uid)}"><option value="edit"${m.role === 'edit' ? ' selected' : ''}>Puede editar</option><option value="view"${m.role === 'view' ? ' selected' : ''}>Solo puede ver</option></select>
             <button class="icon-btn small ripple" data-remove="${esc(m.uid)}" aria-label="Quitar acceso">${icon('close')}</button>`
          : `<span class="role-label">${ROLE_NAMES[m.role]}</span>`}
      </div>`).join('') + pending.map((p) => `
      <div class="rem-row pending">
        <span class="avatar">${icon('mail')}</span>
        <div class="rem-text"><strong>${esc(p.email)}</strong><small>Invitación pendiente · ${ROLE_NAMES[p.role]}</small></div>
        <button class="icon-btn small ripple" data-cancel="${esc(p.id)}" aria-label="Cancelar invitación">${icon('close')}</button>
      </div>`).join('');
    body.querySelectorAll('[data-role-uid]').forEach((sel) => sel.addEventListener('change', () => {
      state.repo.setRole(noteId, sel.dataset.roleUid, sel.value);
      snackbar('Permiso actualizado');
    }));
    body.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const r = await openDialog({ title: '¿Quitar el acceso?', text: 'Esa persona deja de ver la nota.', ok: 'Quitar', danger: true });
      if (r) { state.repo.removeMember(noteId, b.dataset.remove); snackbar('Acceso quitado'); }
    }));
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
      state.repo.cancelInvite(b.dataset.cancel);
      snackbar('Invitación cancelada');
    }));
  };

  openSheet(`<h2 class="sheet-title">Compartir Acceso → Invitar Usuario</h2>
    <div class="picker-list share-members"></div>
    ${owner ? `
      <div class="share-form">
        <label class="field"><span>Invitar por email (cuenta de Google)</span>
          <input type="email" id="share-email" placeholder="nombre@gmail.com" autocomplete="email" inputmode="email"></label>
        <label class="field"><span>Permiso</span>
          <select id="share-role"><option value="edit">Puede editar</option><option value="view">Solo puede ver</option></select></label>
      </div>
      <p class="sheet-text">La persona ve la invitación al abrir ANote... con esa cuenta. Avisale para que la acepte.</p>
      <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="share-send">${icon('personAdd')}<span>Invitar</span></button></div>`
    : `<p class="sheet-text">Tu permiso: ${ROLE_NAMES[role]}. Solo el dueño puede invitar o cambiar permisos.</p>
      <div class="sheet-actions"><span class="spacer"></span><button class="text-btn danger ripple" id="share-leave">Salir de esta nota</button></div>`}`, (body) => {
    draw(body);
    if (owner) {
      unwatchInvites?.();
      unwatchInvites = state.repo.watchNoteInvites(noteId, (list) => {
        pending = list.filter((i) => i.status === 'pending');
        if ($('#sheet').classList.contains('open')) draw(body);
      });
      body.querySelector('#share-send').addEventListener('click', async () => {
        const email = body.querySelector('#share-email').value.trim().toLowerCase();
        const r = body.querySelector('#share-role').value;
        if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) { snackbar('Escribí un email válido'); return; }
        if (email === state.repo.profile.email) { snackbar('Esa es tu propia cuenta'); return; }
        try {
          await state.repo.invite(noteById(noteId) || n, email, r);
          body.querySelector('#share-email').value = '';
          snackbar(`Invitación enviada a ${email}`);
        } catch (e) { snackbar(`No se pudo invitar (${e?.code || 'error'})`); }
      });
    } else {
      body.querySelector('#share-leave').addEventListener('click', async () => {
        const ok = await openDialog({ title: '¿Salir de esta nota?', text: 'Deja de aparecer en tus notas. Para volver, el dueño te tiene que invitar de nuevo.', ok: 'Salir', danger: true });
        if (!ok) return;
        closeOverlays();
        if (state.current?.id === noteId) goBack();
        await state.repo.leaveNote(noteId);
        snackbar('Saliste de la nota');
      });
    }
  });
}

/* ---------- Fase 4: "Compartir con…", widget, accesos directos y vista previa de links ---------- */
const LIST_HTML = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
const pendingIntents = [];

function onIntent(data) {
  if (!state.repo || !state.repo.serverLoaded) { pendingIntents.push(data); return; }
  runIntent(data);
}

function flushIntents() {
  while (pendingIntents.length && state.repo?.serverLoaded) runIntent(pendingIntents.shift());
}

async function runIntent(data) {
  closeOverlays();
  clearSelection();
  if (state.view === 'editor') {
    history.replaceState(null, '', location.pathname + location.search);
    state.pushed = false;
    await closeEditor();
  }
  if (data.kind === 'search') { setFilter({ kind: 'notes' }); openSearch(); return; }
  if (data.kind === 'note' || data.kind === 'list') {
    const legacy = data.kind === 'list' ? LIST_HTML : null;
    const id = state.repo.create(legacy ? { legacy } : {});
    openNote(id, { isNew: true, meta: legacy ? { legacy } : {} });
    return;
  }
  if (data.kind === 'link') { openNoteLink(data.url); return; }
  if (data.kind === 'share') await noteFromShare(data);
  if (data.kind === 'file') await importAnoteText(data.name, data.text);
}

// App Links: un link de nota tocado en otra app (WhatsApp, Gmail…) abre la nota en el APK
function openNoteLink(url) {
  const i = String(url || '').indexOf('#');
  const h = i >= 0 ? parseNoteHash(String(url).slice(i)) : null;
  if (!h) { // link a la web sin nota (p. ej., «Continuar» después de verificar el correo): queda la lista
    maybeRecheckVerified();
    return;
  }
  if (state.notes.some((n) => n.id === h.id)) openNote(h.id);
  else if (state.mode === 'cloud') showNoAccess(h.id, h.owner);
  else snackbar('Para abrir el link de una nota, iniciá sesión (con Google o con correo)');
}

const linkify = (line) => esc(line).replace(/https?:\/\/[^\s<>"']+/gi, (u) => `<a href="${u}">${u}</a>`);

async function noteFromShare(data) {
  const text = String(data.text || '').trim();
  const subject = String(data.subject || '').trim();
  const parts = text ? text.split(/\r?\n/).map((l) => `<p>${linkify(l)}</p>`) : [];
  let skipped = 0;
  const newId = state.repo.newNoteId();
  for (const img of (data.images || []).slice(0, 20)) {
    try {
      const url = await compressDataUrl(img);
      const src = await storeImage(newId, url);
      if (src.startsWith('data:') && parts.join('').length + src.length > 850000 && state.mode === 'cloud') { skipped++; continue; }
      parts.push(`<img src="${src}">`);
    } catch { skipped++; }
  }
  if (!parts.length) { snackbar('No llegó contenido para crear la nota'); return; }
  const legacy = parts.join('');
  const title = subject && subject !== text ? subject.slice(0, 200) : '';
  const id = state.repo.create({ title, preview: text.slice(0, 500), text: text.slice(0, 20000), legacy }, newId);
  openNote(id, { isNew: true, meta: { legacy, seedTitle: title } });
  snackbar(skipped ? `Nota creada. ${skipped} imagen${skipped > 1 ? 'es' : ''} no entraron (muy pesadas).` : 'Nota creada desde «Compartir»');
}

// Vista previa de los links de la nota (debajo del texto)
let linkTimer;
function scheduleLinkPreviews(delay = 1200) {
  clearTimeout(linkTimer);
  linkTimer = setTimeout(renderLinkPreviews, delay);
}

async function renderLinkPreviews() {
  const box = $('#link-previews');
  if (!editor || !state.current || !previewsEnabled()) { box.innerHTML = ''; return; }
  const urls = noteLinks(editor);
  const noteId = state.current.id;
  if (box.dataset.urls === urls.join(' ')) return;
  box.dataset.urls = urls.join(' ');
  box.innerHTML = urls.map((u) => `
    <a class="link-card ripple" href="${esc(u)}" data-url="${esc(u)}">
      <span class="link-img">${icon('link')}</span>
      <span class="link-body"><strong>${esc(domainOf(u))}</strong><small>${esc(u)}</small></span>
    </a>`).join('');
  box.querySelectorAll('.link-card').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(a.dataset.url, '_blank', 'noopener');
  }));
  urls.forEach((u) => getPreview(u).then((p) => {
    if (state.current?.id !== noteId) return;
    const card = [...box.querySelectorAll('.link-card')].find((a) => a.dataset.url === u);
    if (!card || (!p.title && !p.image)) return;
    card.querySelector('.link-body').innerHTML = `<strong>${esc(p.title || domainOf(u))}</strong><small>${esc(p.site || domainOf(u))}${p.description ? ` · ${esc(p.description)}` : ''}</small>`;
    if (p.image) {
      const img = document.createElement('img');
      img.src = p.image; img.alt = ''; img.loading = 'lazy';
      img.onerror = () => img.remove();
      const holder = card.querySelector('.link-img');
      holder.innerHTML = '';
      holder.appendChild(img);
    }
  }));
}

/* ---------- Fase 5: imágenes aparte, historial, exportar/importar y notas bloqueadas ---------- */
const resolveImage = (key) => state.repo?.getImage(key) || Promise.resolve(null);

// Guarda una imagen (ya comprimida) aparte de la nota y devuelve la referencia para el contenido
async function storeImage(noteId, dataUrl) {
  let url = dataUrl;
  if (url.length > 900000) url = await compressDataUrl(url, 1024, 0.6); // límite de Firestore por documento
  return state.repo.saveImage(noteId, url);
}

// Notas viejas con imágenes dentro del texto: se pasan a "guardadas aparte" (sin límite de tamaño)
async function migrateInlineImages(noteId) {
  if (state.mode !== 'cloud' || !editor || state.current?.id !== noteId) return;
  if (myRole(noteById(noteId)) === 'view') return;
  const srcs = new Set();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.src?.startsWith('data:') && node.attrs.src.length > 20000) srcs.add(node.attrs.src);
  });
  for (const src of srcs) {
    const key = await storeImage(noteId, src);
    if (!editor || state.current?.id !== noteId) return;
    const tr = editor.state.tr; let changed = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === src) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: key }); changed = true; }
    });
    if (changed) editor.view.dispatch(tr);
  }
}

/* --- Historial de versiones --- */
const VERSION_EVERY = 10 * 60000; // como mucho una versión cada 10 minutos por nota
function canEditNote(id) { return myRole(noteById(id)) !== 'view'; }

async function saveVersionNow(c, session, label = '') {
  try {
    const bytes = session.snapshot();
    if (bytes.length > 900000 || bytes.length < 3) return;
    await state.repo.saveVersion(c.id, bytes, {
      title: ($('#note-title').value || '').slice(0, 200),
      preview: (editor?.getText({ blockSeparator: ' ' }) || '').slice(0, 160),
      label,
    });
    localStorage.setItem(`notas-ver-${c.id}`, String(Date.now()));
  } catch (e) { console.warn('Historial: no se pudo guardar la versión', e); }
}

function maybeSaveVersion(c, session) {
  if (!c.versionDirty || !canEditNote(c.id)) return;
  const last = Number(localStorage.getItem(`notas-ver-${c.id}`) || 0);
  if (Date.now() - last < VERSION_EVERY) return;
  c.versionDirty = false;
  saveVersionNow(c, session);
}

async function showVersions(noteId) {
  openSheet('<h2 class="sheet-title">Historial de versiones</h2><p class="sheet-text">Cargando…</p>');
  let list = [];
  try { list = await state.repo.listVersions(noteId); } catch (e) { snackbar(`No se pudo leer el historial (${e?.code || 'error'})`); }
  if (state.current?.id !== noteId) return;
  openSheet(`<h2 class="sheet-title">Historial de versiones</h2>
    <p class="sheet-text">Se guarda una versión cada 10 minutos de edición (se conservan las últimas 30). Tocá una para verla o restaurarla.</p>
    ${list.length ? '' : '<p class="sheet-text">Todavía no hay versiones guardadas de esta nota.</p>'}
    <div class="picker-list">${list.map((v, i) => `
      <button class="picker-item ripple version-item" data-v="${i}">
        ${icon('history')}
        <span class="rem-text"><strong>${esc(formatWhen(v.at))}${v.label ? ` · ${esc(v.label)}` : ''}</strong>
        <small>${esc(v.byName || '')}${v.preview ? ` · ${esc(v.preview)}` : ''}</small></span>
      </button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => previewVersion(noteId, list[Number(b.dataset.v)])));
  });
}

function versionContent(v) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, v.bytes);
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'));
  const title = doc.getText('title').toString();
  doc.destroy();
  return { json, title };
}

function previewVersion(noteId, v) {
  let content;
  try { content = versionContent(v); } catch { snackbar('Esa versión no se puede leer'); return; }
  const html = generateHTML(content.json?.content?.length ? content.json : { type: 'doc', content: [{ type: 'paragraph' }] }, contentExtensions());
  openSheet(`<h2 class="sheet-title">Versión del ${esc(formatWhen(v.at))}</h2>
    <div class="version-preview"><h3>${esc(content.title || 'Sin título')}</h3><div class="ProseMirror">${html}</div></div>
    <div class="sheet-actions"><button class="text-btn ripple" id="ver-back">Volver</button><span class="spacer"></span>
      ${canEditNote(noteId) ? '<button class="filled-btn ripple" id="ver-restore">Restaurar esta versión</button>' : ''}</div>`, (body) => {
    body.querySelectorAll('.version-preview img').forEach(async (img) => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('img:')) { const d = await resolveImage(src); if (d) img.src = d; else img.remove(); }
    });
    body.querySelectorAll('.version-preview input[type="checkbox"]').forEach((x) => { x.disabled = true; });
    body.querySelector('#ver-back').addEventListener('click', () => showVersions(noteId));
    body.querySelector('#ver-restore')?.addEventListener('click', async () => {
      const c = state.current;
      if (!c || c.id !== noteId || !editor) return;
      closeOverlays();
      await saveVersionNow(c, c.session, 'Antes de restaurar');
      editor.commands.setContent(content.json, true);
      applyTextDiff(c.session.titleText, content.title || '');
      $('#note-title').value = content.title || '';
      markDirty();
      snackbar('Versión restaurada (la anterior quedó guardada en el historial)');
    });
  });
}

/* --- Exportar --- */
const EXPORTS = [
  ['pdf', 'PDF', 'application/pdf'],
  ['docx', 'Word (.docx)', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['md', 'Markdown (.md)', 'text/markdown'],
  ['txt', 'Texto (.txt)', 'text/plain'],
  ['anote', 'ANote... (.anote, se abre con la app)', 'application/vnd.anote+json'],
  ['json', 'Copia de seguridad (.json, se puede importar)', 'application/json'],
];

// Contenido completo de una nota (con las imágenes resueltas)
async function noteForExport(n) {
  let json; let title = n.title || '';
  if (state.current?.id === n.id && editor) {
    json = editor.getJSON(); title = $('#note-title').value || title;
  } else {
    const s = state.repo.session(n.id, () => {});
    try {
      await s.ready();
      json = yXmlFragmentToProsemirrorJSON(s.fragment);
      title = s.titleText.toString() || title;
    } finally { s.destroy(); }
    if (!json?.content?.length && n.legacy) {
      json = typeof n.legacy === 'string' ? generateJSON(n.legacy, contentExtensions()) : n.legacy;
    }
  }
  json = await resolveImages(JSON.parse(JSON.stringify(json || { type: 'doc', content: [] })), resolveImage);
  return {
    title, json, color: n.color || 'default', pinned: !!n.pinned, archived: !!n.archived,
    labels: noteLabels(n).map((id) => labelById(id)?.name).filter(Boolean),
    folders: noteFolders(n).map((id) => folderPath(id)),
    created: n.created || null, updated: n.updated || null,
  };
}

async function unlockForExport(ids) {
  const locked = ids.map(noteById).filter((n) => n?.locked && !state.unlocked.has(n.id));
  if (!locked.length) return true;
  const ok = await unlockNote(locked[0], 'Exportar notas bloqueadas');
  if (ok) locked.forEach((n) => state.unlocked.add(n.id));
  return ok;
}

function openExportSheet(ids) {
  const many = ids.length > 1;
  openSheet(`<h2 class="sheet-title">Exportar ${many ? `${ids.length} notas` : 'nota'}</h2>
    <div class="picker-list">${EXPORTS.map(([k, label], i) => `<button class="picker-item ripple" data-fmt="${k}"><span class="radio${i === 0 ? ' on' : ''}"></span><span>${label}</span></button>`).join('')}</div>
    ${many ? '<p class="sheet-text">Las notas se juntan en un solo archivo.</p>' : ''}
    <div class="sheet-actions"><span class="spacer"></span><button class="filled-btn ripple" id="exp-go">Exportar</button></div>`, (body) => {
    let fmt = 'pdf';
    body.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => {
      fmt = b.dataset.fmt;
      body.querySelectorAll('[data-fmt] .radio').forEach((x) => x.classList.toggle('on', x.parentElement === b));
    }));
    body.querySelector('#exp-go').addEventListener('click', async () => {
      closeOverlays();
      if (!(await unlockForExport(ids))) return;
      await exportNotes(ids, fmt);
    });
  });
}

async function exportNotes(ids, fmt) {
  snackbar('Preparando el archivo…');
  try {
    if (state.current && ids.includes(state.current.id)) await saveSummaryNow();
    const notes = [];
    for (const id of ids) { const n = noteById(id); if (n) notes.push(await noteForExport(n)); }
    if (!notes.length) return;
    const [, , mime] = EXPORTS.find(([k]) => k === fmt);
    const day = new Date().toISOString().slice(0, 10);
    const base = notes.length === 1 ? safeName(notes[0].title) : `notas-${day}`;
    let blob;
    if (fmt === 'pdf') blob = await toPdf(notes);
    else if (fmt === 'docx') blob = await toDocx(notes);
    else if (fmt === 'md') blob = new Blob([notes.map(toMarkdown).join('\n---\n\n')], { type: mime });
    else if (fmt === 'txt') blob = new Blob([notes.map(toText).join('\n\n----------\n\n')], { type: mime });
    else if (fmt === 'anote') blob = new Blob([toBackup(notes.map((n) => ({ ...n, content: n.json, json: undefined })), APP_VERSION)], { type: mime });
    else blob = new Blob([toBackup(notes.map((n) => ({ ...n, content: n.json, json: undefined })), APP_VERSION)], { type: mime });
    await deliverFile(`${base}.${fmt}`, blob);
    hideSnack();
  } catch (e) {
    console.error('Exportar', e);
    snackbar(`No se pudo exportar (${e?.message || 'error'})`);
  }
}


/* --- Enviar (WhatsApp, Telegram, mail…) --- */
const SEND_OPTIONS = [
  ['text', 'Como mensaje de texto', 'Con formato de WhatsApp: negrita, listas y casillas ☐/☑'],
  ['textimg', 'Mensaje con sus imágenes', 'El texto acompaña a las fotos de la nota'],
  ['pdf', 'Como documento PDF', 'Llega como documento adjunto'],
  ['docx', 'Como documento Word (.docx)', 'Llega como documento adjunto, editable'],
  ['txt', 'Como archivo de texto (.txt)', 'Llega como documento adjunto'],
];

function openSendSheet(ids) {
  const many = ids.length > 1;
  openSheet(`<h2 class="sheet-title">Enviar ${many ? `${ids.length} notas` : 'nota'}</h2>
    <p class="sheet-text">Se abre el menú para compartir: elegí WhatsApp (o Telegram, mail…) y el chat.</p>
    <div class="picker-list">${SEND_OPTIONS.map(([k, label, hint]) => `
      <button class="picker-item ripple" data-send="${k}">${icon(k.startsWith('text') ? 'mail' : 'download')}
        <span class="rem-text"><strong>${label}</strong><small>${hint}</small></span></button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', async () => {
      closeOverlays();
      if (!(await unlockForExport(ids))) return;
      await sendNotes(ids, b.dataset.send);
    }));
  });
}

async function sendNotes(ids, how) {
  snackbar('Preparando…');
  try {
    if (state.current && ids.includes(state.current.id)) await saveSummaryNow();
    const notes = [];
    for (const id of ids) { const n = noteById(id); if (n) notes.push(await noteForExport(n)); }
    if (!notes.length) return;
    if (how === 'text' || how === 'textimg') {
      const text = notes.map(toWhatsApp).join('\n\n———\n\n');
      const images = how === 'textimg' ? notes.flatMap(noteImages).slice(0, 10) : [];
      if (how === 'textimg' && !images.length) snackbar('La nota no tiene imágenes: se envía solo el texto');
      const r = await shareMessage({ title: notes[0].title || 'Nota', text, images });
      if (r === 'copied') {
        snackbar('Texto copiado. Pegalo en el chat', 'Abrir WhatsApp', () => window.open(`https://wa.me/?text=${encodeURIComponent(text.slice(0, 4000))}`, '_blank'));
      } else hideSnack();
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const base = notes.length === 1 ? safeName(notes[0].title) : `notas-${day}`;
    let blob;
    if (how === 'pdf') blob = await toPdf(notes);
    else if (how === 'docx') blob = await toDocx(notes);
    else blob = new Blob([notes.map(toText).join('\n\n----------\n\n')], { type: 'text/plain' });
    const r = await shareFile(`${base}.${how}`, blob);
    if (r === 'downloaded') snackbar('Este navegador no permite compartir archivos: se descargó para adjuntarlo en el chat');
    else hideSnack();
  } catch (e) {
    console.error('Enviar', e);
    snackbar(`No se pudo enviar (${e?.message || 'error'})`);
  }
}

/* --- Importar --- */
async function htmlWithStoredImages(html, noteId) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:')) { if (!/^(https?:|img:)/.test(src)) img.remove(); continue; }
    try { img.setAttribute('src', await storeImage(noteId, await compressDataUrl(src))); } catch { img.remove(); }
  }
  return doc.body.innerHTML;
}

async function jsonWithStoredImages(json, noteId) {
  const walk = async (n) => {
    if (n.type === 'image' && n.attrs?.src?.startsWith('data:')) {
      try { n.attrs.src = await storeImage(noteId, await compressDataUrl(n.attrs.src)); } catch { n.attrs.src = ''; }
    }
    for (const c of n.content || []) await walk(c);
  };
  await walk(json);
  return json;
}

// Carpetas y etiquetas por nombre (se crean si no existen)
function labelIdByName(name) {
  const found = state.org.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const id = orgId();
  state.repo.saveLabel({ id, name, color: LABEL_COLORS[state.org.labels.length % LABEL_COLORS.length], created: Date.now() });
  state.org.labels.push({ id, name });
  return id;
}
function folderIdByPath(path) {
  let parent = null;
  for (const part of path.split('›').map((p) => p.trim()).filter(Boolean)) {
    let f = state.org.folders.find((x) => (x.parentId || null) === parent && x.name.toLowerCase() === part.toLowerCase());
    if (!f) {
      f = { id: orgId(), name: part, parentId: parent, created: Date.now() };
      state.repo.saveFolder(f);
      state.org.folders.push(f);
    }
    parent = f.id;
  }
  return parent;
}

function pickImportFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.anote,.json,.md,.markdown,.txt,.docx,.pdf,.html,.htm,application/json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html';
  input.addEventListener('change', () => importFiles([...input.files]));
  input.click();
}

async function importFiles(files) {
  if (!files.length) return;
  snackbar('Importando…');
  let ok = 0; const errors = [];
  for (const file of files) {
    try {
      for (const item of await readImport(file)) {
        const id = state.repo.newNoteId();
        let legacy; let text = '';
        if (item.json) {
          legacy = await jsonWithStoredImages(item.json, id);
          text = generateText(legacy);
        } else {
          legacy = await htmlWithStoredImages(item.html || '', id);
          text = new DOMParser().parseFromString(legacy, 'text/html').body.textContent || '';
        }
        state.repo.create({ title: item.title || '', preview: text.trim().slice(0, 500), text: text.trim().slice(0, 20000), legacy }, id);
        const m = item.meta || {};
        const meta = {};
        if (m.color) meta.color = m.color;
        if (m.pinned) meta.pinned = true;
        if (m.archived) meta.archived = true;
        if (m.labels?.length) meta.labels = m.labels.map(labelIdByName);
        if (m.folders?.length) meta.folders = m.folders.map(folderIdByPath);
        else if (state.filter.kind === 'folder') meta.folders = [state.filter.id];
        if (Object.keys(meta).length) state.repo.setMeta(id, meta);
        ok++;
      }
    } catch (e) { errors.push(`${file.name}: ${e?.message || 'error'}`); }
  }
  if (errors.length) snackbar(`${ok} nota${ok === 1 ? '' : 's'} importada${ok === 1 ? '' : 's'}. No se pudo: ${errors.join('; ')}`);
  else snackbar(ok === 1 ? 'Nota importada' : `${ok} notas importadas`);
}

const generateText = (json) => {
  const parts = [];
  const walk = (n) => { if (n.type === 'text') parts.push(n.text); (n.content || []).forEach(walk); if (['paragraph', 'heading'].includes(n.type)) parts.push('\n'); };
  walk(json || {});
  return parts.join('');
};

/* --- Notas bloqueadas --- */
async function unlockNote(n, reason = 'Desbloquear nota') {
  const r = await verifyUser(reason);
  if (r.ok) { state.unlocked.add(n.id); return true; }
  if (!r.unavailable) { if (r.message) snackbar('No se desbloqueó la nota'); return false; }
  // Sin huella ni bloqueo de pantalla en este dispositivo
  if (state.mode === 'cloud' && !isNative) {
    const confirmGoogle = async () => !!(await openDialog({ title: 'Confirmá que sos vos', text: 'Este navegador no tiene huella disponible. Para abrir la nota, volvé a confirmar tu cuenta de Google.', ok: 'Confirmar con Google' }));
    const askPw = () => askPassword('Confirmá que sos vos', 'Este navegador no tiene huella disponible. Para abrir la nota, escribí tu contraseña de ANote.');
    if (await reauthUser({ askPassword: askPw, confirmGoogle })) { state.unlocked.add(n.id); return true; }
    return false;
  }
  const ok = await openDialog({ title: 'Sin huella en este dispositivo', text: isNative ? 'Configurá un bloqueo de pantalla (huella, PIN o patrón) en Android para proteger las notas bloqueadas. ¿Abrirla igual?' : 'Este navegador no tiene huella disponible. ¿Abrir la nota igual?', ok: 'Abrir' });
  if (ok) state.unlocked.add(n.id);
  return !!ok;
}

async function setLocked(ids, value) {
  if (!value) {
    const n = noteById(ids[0]);
    if (!(await unlockNote(n, 'Quitar el bloqueo'))) return;
  } else {
    const r = await verifyUser('Bloquear nota');
    if (!r.ok && !r.unavailable) return;
    if (r.unavailable) snackbar(isNative ? 'Este teléfono no tiene bloqueo de pantalla: la protección es limitada' : 'Este navegador no tiene huella: se pedirá confirmar con Google');
  }
  ids.forEach((id) => { state.repo.setMeta(id, { locked: value }); if (value) state.unlocked.delete(id); });
  if (value && state.current && ids.includes(state.current.id)) goBack();
  snackbar(value ? (ids.length > 1 ? 'Notas bloqueadas' : 'Nota bloqueada') : 'Bloqueo quitado');
}

/* ---------- Sincronización: contingencias y sincronización manual ---------- */
// Sube los cambios que quedaron en este dispositivo en notas que no están abiertas
let flushingPending = false;
async function flushPendingNotes() {
  if (state.mode !== 'cloud' || flushingPending) return 0;
  flushingPending = true;
  try {
    const ids = pendingList(state.user.uid).filter((id) => id !== state.current?.id);
    for (const id of ids) {
      if (!state.notes.some((n) => n.id === id)) continue; // nota borrada o sin acceso
      await flushNote(fb().db, state.user.uid, id, 15000);
    }
  } finally { flushingPending = false; updateSyncIcon(); }
  return pendingList(state.user.uid).length;
}

let syncing = false;
async function syncNow({ quiet = false } = {}) {
  if (state.mode !== 'cloud') { if (!quiet) snackbar('Sin cuenta: las notas quedan solo en este dispositivo'); return; }
  if (syncing) return;
  syncing = true;
  if (!quiet) snackbar('Sincronizando…');
  try {
    await state.repo.forceReconnect();           // reconecta ya, sin esperar los reintentos
    state.current?.session?.retry();               // la nota abierta vuelve a pedir la versión del servidor
    await state.repo.waitWrites(8000);             // espera que se confirme lo que estaba en cola
    await flushPendingNotes();                     // sube cambios que quedaron en otras notas
    // Espera unos segundos la confirmación de conexión real
    const t0 = Date.now();
    while (!state.repo.connected && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 300));
    const st = syncSummary();
    if (!quiet) {
      if (st.kind === 'ok') snackbar('Todo sincronizado ✓');
      else if (st.kind === 'offline') snackbar(`Sin conexión${st.pendingNotes ? `: quedan ${st.pendingNotes} nota${st.pendingNotes > 1 ? 's' : ''} con cambios por subir` : ''}. Se reintenta solo al volver la conexión.`);
      else if (st.kind === 'error') snackbar(`Sigue el error de sincronización (${st.code || 'desconocido'})`);
      else snackbar('Sincronizando… (puede tardar unos segundos)');
    }
  } catch (e) {
    if (!quiet) snackbar(`No se pudo sincronizar (${e?.message || 'error'})`);
  } finally {
    syncing = false;
    updateSyncIcon(); updateNoteStatus();
  }
}

// Si la tarjeta de la lista quedó con un resumen viejo, se corrige al abrir la nota
async function repairSummary(id) {
  const c = state.current;
  if (!c || c.id !== id || !editor || !c.status?.verified || myRole(noteById(id)) === 'view') return;
  const n = noteById(id);
  if (!n || n.trashed) return;
  const s = summarize(editor.getJSON(), editor.getText({ blockSeparator: '\n' }));
  const title = $('#note-title').value;
  const same = (n.title || '') === title && (n.preview || '') === s.preview
    && (n.checks?.done || 0) === s.checks.done && (n.checks?.total || 0) === s.checks.total;
  if (!same) { c.dirty = true; await saveSummaryNow(); }
}

$('#sync-banner-action').addEventListener('click', () => syncNow());
$('#sync-state').addEventListener('click', () => {
  if (state.mode !== 'cloud') return;
  const st = state.current?.status || {};
  if (st.error || st.fromCache || !st.verified || st.pending) syncNow();
  else snackbar('La nota está actualizada con el servidor ✓');
});
window.addEventListener('pendingchange', () => updateSyncIcon());
window.addEventListener('online', () => { setTimeout(() => syncNow({ quiet: true }), 1000); });
setInterval(() => { if (state.mode === 'cloud') { updateSyncIcon(); updateNoteStatus(); } }, 5000);

// Deslizar hacia abajo en la lista: sincronizar ahora
(() => {
  const sc = $('#list-scroll');
  const ind = $('#pull-indicator');
  let startY = null; let dist = 0;
  sc.addEventListener('touchstart', (e) => {
    startY = sc.scrollTop <= 0 && !state.selection.size ? e.touches[0].clientY : null; dist = 0;
  }, { passive: true });
  sc.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dist = Math.max(0, Math.min(120, (e.touches[0].clientY - startY) * 0.5));
    ind.style.setProperty('--pull', `${dist}px`);
    ind.classList.toggle('ready', dist >= 64);
    ind.classList.toggle('show', dist > 4);
  }, { passive: true });
  sc.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    const go = dist >= 64;
    ind.classList.remove('ready');
    if (!go) { ind.classList.remove('show'); ind.style.setProperty('--pull', '0px'); return; }
    haptic();
    ind.classList.add('spinning');
    ind.style.setProperty('--pull', '56px');
    await syncNow();
    ind.classList.remove('spinning', 'show');
    ind.style.setProperty('--pull', '0px');
  });
})();

/* ---------- v0.1.0: marca, vista compacta, link a la nota, pedidos de acceso y archivo .anote ---------- */
const BRAND = '<span class="brand"><b class="brand-a">A</b><b class="brand-n">N</b>ote...</span>';
const WEB_URL = 'https://luchorcompartidos.github.io/notas/';

// "#/nota/<id>?o=<dueño>" (el dueño va en el link para poder pedirle acceso)
function parseNoteHash(hash = location.hash) {
  const m = /^#\/nota\/([^?&]+)(?:\?o=([^&]+))?/.exec(hash || '');
  return m ? { id: decodeURIComponent(m[1]), owner: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

/* --- Vista de lista: estándar o compacta (contraer / expandir) --- */
const density = () => localStorage.getItem('notas-density') || 'standard';
const compactLines = () => Math.min(5, Math.max(1, Number(localStorage.getItem('notas-compact-lines') || 2)));
const expandedCards = new Set();

function applyDensity() {
  const compact = density() === 'compact';
  root.classList.toggle('compact', compact);
  root.style.setProperty('--compact-lines', String(compactLines()));
  const b = $('#btn-density');
  b.innerHTML = icon(compact ? 'unfoldMore' : 'unfoldLess');
  b.setAttribute('aria-label', compact ? 'Expandir todo' : 'Contraer todo');
  b.title = compact ? 'Expandir todo' : 'Contraer todo';
  updateCardLimit();
}

// En la vista estándar, una nota larga ocupa como máximo 1/3 del alto de la lista
function updateCardLimit() {
  const h = $('#list-scroll').clientHeight || window.innerHeight;
  root.style.setProperty('--card-max', `${Math.max(160, Math.round(h / 3) - 8)}px`);
}

// Marca las tarjetas recortadas y les agrega la flecha para expandirlas
function markClamped() {
  document.querySelectorAll('#list-scroll .card').forEach((card) => {
    const id = card.dataset.id;
    const expanded = expandedCards.has(id);
    card.classList.toggle('expanded', expanded);
    const body = card.querySelector('.card-body');
    if (!body) return;
    const text = card.querySelector('.card-text');
    const textClamped = !!text && text.scrollHeight > text.clientHeight + 2;
    const imgHidden = root.classList.contains('compact') && !!card.querySelector('.card-img');
    const clamped = expanded || body.scrollHeight > body.clientHeight + 2 || textClamped || imgHidden;
    card.classList.toggle('clamped', clamped && !expanded);
    let t = card.querySelector('.card-expand');
    if (clamped) {
      if (!t) {
        t = document.createElement('button');
        t.className = 'card-expand';
        t.addEventListener('pointerdown', (e) => e.stopPropagation());
        t.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expandedCards.has(id)) expandedCards.delete(id); else expandedCards.add(id);
          markClamped();
          updateMoreBelow();
        });
        card.appendChild(t);
      }
      t.innerHTML = icon(expanded ? 'unfoldLess' : 'expand');
      t.setAttribute('aria-label', expanded ? 'Contraer' : 'Expandir');
    } else t?.remove();
  });
}

// Flecha flotante: avisa que hay más notas abajo y avanza una "página"
function updateMoreBelow() {
  const sc = $('#list-scroll');
  const more = state.view === 'list' && !state.selection.size && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 24;
  $('#btn-more-below').hidden = !more;
}

$('#btn-density').addEventListener('click', () => {
  localStorage.setItem('notas-density', density() === 'compact' ? 'standard' : 'compact');
  expandedCards.clear();
  applyDensity();
  renderList();
  snackbar(density() === 'compact' ? `Vista compacta: título y ${compactLines()} línea${compactLines() > 1 ? 's' : ''}` : 'Vista estándar');
});
$('#btn-more-below').addEventListener('click', () => {
  const sc = $('#list-scroll');
  sc.scrollBy({ top: Math.round(sc.clientHeight * 0.85), behavior: 'smooth' });
});
$('#list-scroll').addEventListener('scroll', updateMoreBelow, { passive: true });
window.addEventListener('resize', () => { updateCardLimit(); markClamped(); updateMoreBelow(); });

function showListSettings() {
  const d = density(); const n = compactLines();
  openSheet(`<h2 class="sheet-title">Vista de la lista</h2>
    <div class="picker-list">
      <button class="picker-item ripple" data-d="standard"><span class="radio${d === 'standard' ? ' on' : ''}"></span><span class="rem-text"><strong>Estándar</strong><small>Cada nota se ve entera; las largas ocupan como máximo 1/3 de la pantalla</small></span></button>
      <button class="picker-item ripple" data-d="compact"><span class="radio${d === 'compact' ? ' on' : ''}"></span><span class="rem-text"><strong>Compacta</strong><small>Título y la cantidad de líneas elegida</small></span></button>
    </div>
    <p class="sheet-text">Líneas en la vista compacta (además del título):</p>
    <div class="chips-row lines-pick">${[1, 2, 3, 4, 5].map((k) => `<button class="chip ripple${k === n ? ' on' : ''}" data-l="${k}">${k}</button>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      localStorage.setItem('notas-density', b.dataset.d);
      body.querySelectorAll('[data-d] .radio').forEach((x) => x.classList.toggle('on', x.parentElement === b));
      expandedCards.clear(); applyDensity(); renderList();
    }));
    body.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => {
      localStorage.setItem('notas-compact-lines', b.dataset.l);
      localStorage.setItem('notas-density', 'compact');
      body.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('on', x === b));
      body.querySelectorAll('[data-d] .radio').forEach((x) => x.classList.toggle('on', x.parentElement.dataset.d === 'compact'));
      applyDensity(); renderList();
    }));
  });
}

/* --- Copiar o enviar el link de la nota --- */
async function openLinkSheet(id) {
  const n = noteById(id);
  if (!n) return;
  if (state.mode !== 'cloud') {
    openSheet('<h2 class="sheet-title">Link de la nota</h2><p class="sheet-text">Para tener un link hace falta iniciar sesión con Google: sin cuenta, la nota está solo en este dispositivo.</p>');
    return;
  }
  const link = `${WEB_URL}#/nota/${encodeURIComponent(id)}?o=${encodeURIComponent(n.owner || state.user.uid)}`;
  let copied = false;
  try { await navigator.clipboard.writeText(link); copied = true; } catch { /* sin portapapeles */ }
  openSheet(`<h2 class="sheet-title">Link de la nota</h2>
    <p class="sheet-text">${copied ? '✓ Copiado al portapapeles. ' : ''}Lo pueden abrir vos y las personas con acceso; quien no lo tenga puede pedírtelo desde el link.</p>
    <input class="link-field" id="link-field" readonly value="${esc(link)}">
    <div class="sheet-actions"><button class="text-btn ripple" id="link-copy">Copiar</button><span class="spacer"></span>
      <button class="filled-btn ripple" id="link-share">${icon('share')}<span>Enviar link</span></button></div>`, (body) => {
    const f = body.querySelector('#link-field');
    const selectAll = () => { f.focus(); f.select(); f.setSelectionRange(0, link.length); };
    f.addEventListener('click', selectAll);
    body.querySelector('#link-copy').addEventListener('click', async () => {
      selectAll();
      try { await navigator.clipboard.writeText(link); snackbar('Link copiado'); } catch { document.execCommand?.('copy'); snackbar('Link copiado'); }
    });
    body.querySelector('#link-share').addEventListener('click', () => shareLink(n.title, link));
  });
  setTimeout(() => shareLink(n.title, link), 350); // abre el menú "Compartir" enseguida
}

async function shareLink(title, link) {
  const text = title ? `${title}\n${link}` : link;
  try {
    if (isNative) {
      const sh = await import('@capacitor/share');
      await sh.Share.share({ title: title || 'Nota', text, url: link, dialogTitle: 'Enviar link' });
    } else if (navigator.share) {
      await navigator.share({ title: title || 'Nota', text: title || undefined, url: link });
    }
  } catch { /* cancelado */ }
}

/* --- Abrir un link sin acceso: pedir acceso al dueño --- */
async function showNoAccess(id, owner) {
  history.replaceState(null, '', location.pathname + location.search);
  const requested = JSON.parse(localStorage.getItem('notas-pedidos') || '[]');
  const r = await openDialog({
    title: 'No tenés acceso a esta nota',
    text: owner
      ? (requested.includes(id) ? 'Ya pediste acceso: el dueño lo ve al abrir ANote... ¿Volver a pedirlo?' : 'Podés pedirle acceso al dueño. Cuando te lo dé, la nota aparece en «Compartidas conmigo».')
      : 'Pedile al dueño que te comparta el acceso (o puede que la nota ya no exista).',
    ok: owner ? 'Solicitar acceso' : 'Entendido',
  });
  if (!r || !owner) return;
  try {
    await state.repo.requestAccess(id, owner);
    localStorage.setItem('notas-pedidos', JSON.stringify([...new Set([...requested, id])]));
    snackbar('Pedido enviado. Te avisamos cuando te den acceso');
  } catch (e) {
    snackbar(e?.code === 'permission-denied' ? 'No se pudo pedir acceso: la nota no existe o el link está incompleto' : `No se pudo pedir acceso (${e?.code || 'error'})`);
  }
}

function openFromHash() {
  const h = parseNoteHash();
  if (!h || state.view === 'editor') return;
  if (state.notes.some((n) => n.id === h.id)) openNote(h.id, { push: false });
  else if (state.mode === 'cloud') showNoAccess(h.id, h.owner);
}

// Avisar cuando te dan acceso a una nota que pediste
function checkGranted(list) {
  const requested = JSON.parse(localStorage.getItem('notas-pedidos') || '[]');
  if (!requested.length) return;
  const got = requested.filter((id) => list.some((n) => n.id === id));
  if (!got.length) return;
  localStorage.setItem('notas-pedidos', JSON.stringify(requested.filter((id) => !got.includes(id))));
  const n = list.find((x) => x.id === got[0]);
  snackbar(`Te dieron acceso a «${n?.title || 'una nota'}»`, 'Abrir', () => openNote(got[0]));
  notifyNow('Te dieron acceso a una nota', n?.title || 'Abrila desde «Compartidas conmigo»');
}

/* --- Pedidos de acceso recibidos (soy el dueño) --- */
let knownRequests = null;
function onAccessRequests(list) {
  state.requests = list;
  const b = $('#requests-banner');
  b.hidden = !list.length;
  if (list.length) {
    const r0 = list[0];
    const title = noteById(r0.noteId)?.title || 'una nota';
    $('#requests-text').textContent = list.length === 1
      ? `${r0.name || r0.email} pidió acceso a «${title}»`
      : `${list.length} pedidos de acceso a tus notas`;
  }
  // Aviso en el momento (si la app está abierta) por cada pedido nuevo
  if (knownRequests) {
    list.filter((r) => !knownRequests.has(r.id)).forEach((r) => {
      notifyNow('Pedido de acceso', `${r.name || r.email} pidió acceso a «${noteById(r.noteId)?.title || 'una nota'}»`, { kind: 'pedido' });
    });
  }
  knownRequests = new Set(list.map((r) => r.id));
}

function showRequests() {
  const list = state.requests || [];
  openSheet(`<h2 class="sheet-title">Pedidos de acceso</h2>
    ${list.length ? '' : '<p class="sheet-text">No hay pedidos pendientes.</p>'}
    <div class="picker-list">${list.map((r) => `
      <div class="rem-row request-row">
        <span class="avatar">${esc((r.name || r.email || '?').slice(0, 1).toUpperCase())}</span>
        <div class="rem-text"><strong>${esc(r.name || r.email)}</strong><small>${esc(r.email || '')} · «${esc(noteById(r.noteId)?.title || 'Nota')}»</small></div>
        <select class="role-select" data-role-for="${esc(r.id)}"><option value="edit">Puede editar</option><option value="view">Solo puede ver</option></select>
        <button class="icon-btn small ripple" data-decline="${esc(r.id)}" aria-label="Rechazar">${icon('close')}</button>
        <button class="filled-btn ripple" data-approve="${esc(r.id)}">Dar acceso</button>
      </div>`).join('')}</div>`, (body) => {
    body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      const r = list.find((x) => x.id === b.dataset.approve);
      const role = body.querySelector(`[data-role-for="${CSS.escape(r.id)}"]`).value;
      b.disabled = true;
      try { await state.repo.approveRequest(r, role); snackbar(`Acceso dado a ${r.name || r.email}`); closeOverlays(); } catch (e) { b.disabled = false; snackbar(`No se pudo dar acceso (${e?.code || 'error'})`); }
    }));
    body.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', async () => {
      const r = list.find((x) => x.id === b.dataset.decline);
      await state.repo.declineRequest(r);
      snackbar('Pedido rechazado'); closeOverlays();
    }));
  });
}
$('#requests-action').addEventListener('click', showRequests);

/* --- Archivo .anote abierto desde Android o desde la PC --- */
async function importAnoteText(name, text) {
  const file = new File([text], name && name.toLowerCase().endsWith('.anote') ? name : 'nota.anote', { type: 'application/vnd.anote+json' });
  await importFiles([file]);
}
if (!isNative && 'launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    const files = [];
    for (const h of params.files || []) { try { files.push(await h.getFile()); } catch { /* nada */ } }
    if (!files.length) return;
    const wait = () => (state.repo?.serverLoaded ? importFiles(files) : setTimeout(wait, 500));
    wait();
  });
}

/* ---------- Inicio ---------- */
function init() {
  hydrateIcons();
  applyTheme();
  requestPersistence();
  bindEditorUi();
  initNative({ onBack: goBack });
  initNativeReminders(handleReminderAction);
  applyDensity();
  listenIntents(onIntent);
  // Web: funciona sin conexión (service worker) e instalable como app
  if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  $('#fab').addEventListener('click', () => {
    if (!state.repo) return;
    haptic();
    const f = state.filter;
    const meta = f.kind === 'folder' ? { folders: [f.id] } : f.kind === 'label' ? { labels: [f.id] } : f.kind === 'templates' ? { template: true } : {};
    const id = state.repo.create();
    if (Object.keys(meta).length) state.repo.setMeta(id, meta);
    // Mostrar el editor y enfocar el título dentro del mismo toque: así el teclado se abre en el celular.
    $('#note-title').value = '';
    delete $('#view-editor').dataset.color;
    setView('editor');
    $('#note-title').focus();
    openNote(id, { isNew: true, meta });
  });

  window.addEventListener('popstate', () => {
    closeOverlays();
    const h = parseNoteHash();
    if (h) { if (state.view !== 'editor' && state.repo) { state.pushed = false; openFromHash(); } }
    else if (state.view === 'editor') { state.pushed = false; closeEditor(); }
  });

  // Antes de pasar a segundo plano: subir lo pendiente.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveSummaryNow(); state.current?.session?.flush();
      const c = state.current;
      if (c && c.session) maybeSaveVersion(c, c.session);
      lockTimer = setTimeout(() => {
        // Al volver a la app, las notas bloqueadas piden la huella de nuevo
        state.unlocked.clear();
        if (state.current && noteById(state.current.id)?.locked) goBack();
        renderList();
      }, 60000);
    } else { clearTimeout(lockTimer); maybeRecheckVerified(); }
  });

  if (sessionStorage.getItem('notas-sec-tip')) { sessionStorage.removeItem('notas-sec-tip'); state.pendingSecTip = true; }
  const okMsg = sessionStorage.getItem('notas-login-msg-ok');
  if (okMsg) { sessionStorage.removeItem('notas-login-msg-ok'); setTimeout(() => snackbar(okMsg), 600); }
  watchAuth((user) => {
    if (user) startCloud(user);
    else if (localStorage.getItem('notas-mode') === 'local') startLocal();
    else showLogin();
  });
  checkUpdates();
}

init();
