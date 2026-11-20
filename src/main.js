import './styles.css';
import { hydrateIcons, icon } from './icons.js';
import { requestPersistence } from './store.js';
import {
  createEditor, runCommand, isActive, summarize, compressImage, makeThumb,
  refreshReminderMarks, currentTaskItem, taskItems, checkTaskItem,
} from './editor.js';
import {
  REPEATS, SNOOZE_MIN, nextOccurrence, formatWhen, initNativeReminders, ensureNativePermissions,
  syncNative, syncWeb, askWebNotifications, showWebNotification,
} from './reminders.js';
import { initNative, setStatusBar, haptic, minimizeApp, isNative } from './native.js';
import { APP_VERSION, CHANGELOG_URL, getLatestRelease, isNewer, formatDate } from './version.js';
import { applyTextDiff } from './sync.js';
import { CloudRepo, LocalRepo, orgId } from './repo.js';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { fb, watchAuth, signInGoogle, signOutUser, authErrorMessage, errorDetail } from './firebase.js';

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
  search: { active: false, q: '', folder: null, label: null, color: null, checks: null, days: null, archived: false },
  layout: localStorage.getItem('notas-layout') || 'grid',
  reminders: [],
};

const SORTS = [['updated', 'Fecha de modificación'], ['created', 'Fecha de creación'], ['title', 'Título (A-Z)'], ['manual', 'Manual (arrastrar)']];

const LABEL_COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#6D4C41', '#757575'];
const TRASH_OPTIONS = [[7, '7 días'], [15, '15 días'], [30, '30 días'], [60, '60 días'], [90, '90 días'], [0, 'Nunca (vaciar a mano)']];
let editor = null;
let summaryTimer;
let openToken = 0;

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
$('#scrim').addEventListener('click', closeOverlays);

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Vistas ---------- */
function setView(view) {
  state.view = view;
  ['login', 'list', 'editor'].forEach((v) => $(`#view-${v}`).classList.toggle('active', v === view));
  $('#view-list').classList.toggle('behind', view === 'editor');
  syncBars();
}

/* ---------- Estado de sincronización ---------- */
function updateSyncIcon() {
  const btn = $('#btn-sync');
  let name = 'phone'; let label = 'Sin cuenta: notas solo en este dispositivo';
  if (state.mode === 'cloud') {
    const repo = state.repo;
    const sessPending = state.current?.status?.pending || 0;
    if (repo?.error) { name = 'error'; label = 'Error de sincronización'; }
    else if (!navigator.onLine) { name = 'cloudOff'; label = 'Sin conexión: los cambios se suben al reconectar'; }
    else if ((repo?.pending || 0) + sessPending > 0) { name = 'cloudUp'; label = 'Sincronizando…'; }
    else { name = 'cloudDone'; label = 'Sincronizado'; }
  }
  btn.innerHTML = icon(name);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.classList.toggle('warn', name === 'error' || name === 'cloudOff');
}

function updateNoteStatus() {
  const c = state.current;
  if (!c) return;
  let text = 'Guardado en este dispositivo';
  if (state.mode === 'cloud') {
    const st = c.status || {};
    if (st.error) text = `Error de sincronización (${st.error.code || 'desconocido'})`;
    else if (!navigator.onLine) text = 'Sin conexión · se sube al reconectar';
    else if (st.pending) text = 'Sincronizando…';
    else text = 'Sincronizado';
  }
  $('#sync-state').textContent = text;
  $('#edited').textContent = c.updated && !c.isNew ? ` · Editado: ${formatDate(new Date(c.updated).toISOString())}` : '';
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
    case 'archive': return n.archived && !n.trashed;
    case 'trash': return n.trashed;
    case 'folder': return !n.trashed && !n.archived && (n.folders || []).includes(f.id);
    case 'label': return !n.trashed && !n.archived && (n.labels || []).includes(f.id);
    default: return !n.trashed && !n.archived;
  }
}

function filterTitle(f = state.filter) {
  if (f.kind === 'archive') return 'Archivo';
  if (f.kind === 'templates') return 'Plantillas';
  if (f.kind === 'reminders') return 'Recordatorios';
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
        archived: !!n.archived, trashed: !!n.trashed,
      });
      paintEditorChrome();
    }
  }
  renderList();
  if (state.firstList && state.repo?.serverLoaded) {
    state.firstList = false;
    maybeWelcome();
    const m = location.hash.match(/^#\/nota\/(.+)$/);
    if (m && state.view !== 'editor') openNote(m[1], { push: false });
  }
  maybePurge();
  scheduleReminders();
  if (pendingOpenNote && list.some((n) => n.id === pendingOpenNote)) { const id = pendingOpenNote; pendingOpenNote = null; openNote(id); }
}

function onOrg(org) {
  state.org = org;
  if (state.filter.kind === 'folder' && !folderById(state.filter.id)) state.filter = { kind: 'notes' };
  if (state.filter.kind === 'label' && !labelById(state.filter.id)) state.filter = { kind: 'notes' };
  renderDrawer();
  renderList();
  paintEditorChrome();
  maybePurge();
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
  const visible = sortNotes(state.notes.filter((n) => (searching ? matchesSearch(n) : matchesFilter(n))));
  const usePinned = !searching && !['archive', 'trash', 'templates', 'reminders'].includes(f.kind);
  const pinned = usePinned ? visible.filter((n) => n.pinned) : [];
  const others = usePinned ? visible.filter((n) => !n.pinned) : visible;

  $('#list-title').textContent = filterTitle();
  fillGrid($('#grid-pinned'), pinned);
  fillGrid($('#grid-others'), others);
  $('#pinned-wrap').hidden = pinned.length === 0;
  $('#others-label').hidden = pinned.length === 0 || others.length === 0;
  $('#fab').hidden = searching || ['archive', 'trash', 'reminders'].includes(f.kind);
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
    reminders: 'No hay recordatorios pendientes. Para crear uno, abrí una nota y tocá la campana.',
    templates: 'Todavía no hay plantillas. Creá una con el botón +, o desde una nota: menú ⋮ → «Guardar como plantilla».',
  };
  $('#empty-text').textContent = searching ? 'No se encontraron notas' : (emptyTexts[f.kind] || emptyTexts.notes);
  $('#empty').hidden = visible.length > 0;

  // La selección solo conserva notas visibles
  [...state.selection].forEach((id) => { if (!visible.some((n) => n.id === id)) state.selection.delete(id); });
  updateSelectionUi();
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

  if (n.thumb) {
    const img = document.createElement('img');
    img.className = 'card-img'; img.src = n.thumb; img.alt = ''; img.loading = 'lazy';
    el.appendChild(img);
  }
  if (n.title) {
    const t = document.createElement('h3'); t.className = 'card-title'; t.textContent = n.title; el.appendChild(t);
  }
  if (n.preview) {
    const p = document.createElement('p'); p.className = 'card-text'; p.textContent = n.preview; el.appendChild(p);
  }
  if (n.checks?.total) {
    const m = document.createElement('p'); m.className = 'card-meta';
    m.innerHTML = `${icon('checklist')}<span>${n.checks.done}/${n.checks.total}</span>`;
    el.appendChild(m);
  }

  // Recordatorio, etiquetas y carpetas de la nota
  const labels = noteLabels(n);
  const folders = noteFolders(n);
  const next = n.trashed ? null : nextOf(n.id);
  if (labels.length || folders.length || next) {
    const row = document.createElement('div');
    row.className = 'card-chips';
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

  if (manualMode()) {
    const h = document.createElement('button');
    h.className = 'card-drag';
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

  // Papelera: solo lectura, con opción de restaurar
  const trashed = !!c.trashed;
  $('#trash-banner').hidden = !trashed;
  $('#toolbar').hidden = trashed;
  $('#btn-pin').hidden = trashed;
  $('#btn-reminder').hidden = trashed;
  $('#btn-reminder').classList.toggle('active', activeReminders(c.id).length > 0);
  $('#btn-color').hidden = trashed;
  $('#note-title').readOnly = trashed;
  if (editor && editor.isEditable === trashed) editor.setEditable(!trashed);

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
  await closeSession();
  const token = ++openToken;
  const c = {
    id, isNew, dirty: false, status: { pending: 0, error: null },
    color: n?.color || 'default', pinned: !!n?.pinned, updated: n?.updated,
    legacy: n?.legacy || null, seedTitle: n?.title || '',
    folders: n?.folders || [], labels: n?.labels || [], archived: !!n?.archived, trashed: !!n?.trashed,
    template: !!n?.template,
    ...meta,
  };
  state.current = c;
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
    onUpdate: (ed, remote) => { if (!remote) { markDirty(); checkCasillaReminders(); } },
    reminderIds: reminderItemIds,
    onState: (ed) => updateToolbar(ed),
    onCreate: (ed) => {
      if (needsSeed && c.legacy) {
        setTimeout(() => {
          if (token === openToken && session.fragment.length === 0) ed.commands.setContent(c.legacy, true);
        }, 60);
      }
    },
  });
  if (c.trashed) editor.setEditable(false);
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
    empty = !title.trim() && !s.preview && !s.thumb && !s.checks.total;
    if (c.dirty && !(empty && c.isNew)) await saveSummaryNow();
    editor.destroy();
    editor = null;
  }
  $('#editor').innerHTML = '';
  if (c.titleObserver) c.session?.titleText.unobserve(c.titleObserver);
  c.session?.destroy();
  state.current = null;
  if (empty && c.isNew) state.repo.removeCompletely(c.id);
}

async function closeEditor() {
  if (state.view !== 'editor') return;
  closeOverlays();
  $('#note-title').blur();
  editor?.commands.blur();
  await closeSession();
  setView('list');
  renderList();
}

function goBack() {
  if (closeOverlays()) return;
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
  const thumb = await makeThumb(s.thumb);
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
}

/* ---------- Acciones del editor ---------- */
function bindEditorUi() {
  // pointerdown + preventDefault: el foco queda en el texto y el teclado no se cierra.
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (!editor) return;
      if (b.dataset.cmd === 'image') { $('#file-image').click(); return; }
      runCommand(editor, b.dataset.cmd);
    });
  });

  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    try {
      const { url, kb } = await compressImage(file);
      editor.chain().focus().setImage({ src: url }).createParagraphNear().run();
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
    if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); }
  });

  $('#editor').addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) haptic();
  });

  $('#btn-back').addEventListener('click', goBack);
  $('#btn-reminder').addEventListener('click', () => openReminderSheet(state.current.id));

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
      { label: 'Carpetas…', onClick: () => openPicker([c.id], 'folders') },
      { label: 'Etiquetas…', onClick: () => openPicker([c.id], 'labels') },
      ...(noteFolders(c).length ? [{ label: 'Ver en qué carpetas está', onClick: () => showOccurrences(c.id) }] : []),
      { divider: true },
      { label: c.archived ? 'Desarchivar' : 'Archivar', onClick: () => { const id = c.id; const v = !c.archived; goBack(); archiveNotes([id], v); } },
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
    { divider: true },
    { label: 'Tema del sistema', checked: pref === 'system', onClick: () => setTheme('system') },
    { label: 'Tema claro', checked: pref === 'light', onClick: () => setTheme('light') },
    { label: 'Tema oscuro', checked: pref === 'dark', onClick: () => setTheme('dark') },
    { divider: true },
    { label: `Versión ${APP_VERSION}`, onClick: showVersion },
  ]);
});

function showVersion() {
  const r = state.release;
  openSheet(`
    <h2 class="sheet-title">Notas v${esc(APP_VERSION)}</h2>
    <p class="sheet-text">${isNative ? 'App Android' : 'Versión web'} · Fase 2: recordatorios</p>
    <p class="sheet-text">Archivo más reciente de la Release${r?.tag ? ` ${esc(r.tag)}` : ''}: <strong>${formatDate(r?.fileDate)}</strong></p>
    <a class="text-btn" href="${CHANGELOG_URL}" target="_blank" rel="noopener">Ver Changelog</a>
  `);
}
$('#btn-version').addEventListener('click', showVersion);

/* ---------- Cuenta y sincronización ---------- */
$('#btn-sync').addEventListener('click', () => {
  if (state.mode === 'cloud') {
    const u = state.user;
    const label = $('#btn-sync').getAttribute('aria-label');
    openSheet(`
      <h2 class="sheet-title">Tu cuenta</h2>
      <p class="sheet-text"><strong>${esc(u.displayName || '')}</strong><br>${esc(u.email || '')}</p>
      <p class="sheet-text">Estado: ${esc(label)}</p>
      <button class="text-btn ripple" id="btn-signout">Cerrar sesión</button>
    `, (body) => body.querySelector('#btn-signout').addEventListener('click', doSignOut));
  } else {
    openSheet(`
      <h2 class="sheet-title">Sin cuenta</h2>
      <p class="sheet-text">Tus notas se guardan solo en este dispositivo y no se sincronizan.</p>
      <button class="text-btn ripple" id="btn-signin">Iniciar sesión con Google</button>
    `, (body) => body.querySelector('#btn-signin')?.addEventListener('click', () => { closeOverlays(); doSignIn({ reload: true }); }));
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
  state.repo = repo;
  state.mode = mode;
  state.firstList = true;
  repo.onChange = () => { updateSyncIcon(); updateNoteStatus(); };
  repo.subscribe(onList);
  repo.subscribeOrg(onOrg);
  repo.subscribeReminders(onReminders);
  updateSyncIcon();
  setView('list');
}

function startCloud(user) {
  if (state.mode === 'cloud' && state.user?.uid === user.uid) return;
  state.user = user;
  localStorage.setItem('notas-mode', 'cloud');
  startRepo(new CloudRepo(fb().db, user.uid), 'cloud');
}

function startLocal() {
  if (state.mode === 'local') return;
  localStorage.setItem('notas-mode', 'local');
  startRepo(new LocalRepo(), 'local');
}

function showLogin() {
  state.mode = null;
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
    if (reload) location.reload();
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
    : '<p>Estás usando Notas <strong>sin cuenta</strong>: todo se guarda en este dispositivo.</p>';
  const html = `${intro}<h2>Qué probar</h2><ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join('')}</ul>`;
  const id = state.repo.create({
    title: state.mode === 'cloud' ? 'Bienvenido a Notas (sincronización)' : 'Bienvenido a Notas',
    preview: state.mode === 'cloud' ? 'Esta es la Parte 2A de la prueba: sincronización con fusión de cambios.' : 'Estás usando Notas sin cuenta.',
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
function openDialog({ title, text = '', input = false, value = '', placeholder = '', colors = null, color = null, ok = 'Aceptar', danger = false }) {
  if (dialogResolve) closeDialog(null);
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  $('#dialog-text').hidden = !text;
  const inp = $('#dialog-input');
  inp.hidden = !input; inp.value = value; inp.placeholder = placeholder;
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
    dialogResolve = (accepted) => resolve(accepted ? { value: inp.value.trim(), color: chosen } : null);
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
    <div class="drawer-head">Notas</div>
    ${item('notes', null, icon('note'), 'Notas')}
    <div class="drawer-section"><span>Carpetas</span><button class="icon-btn small ripple" id="drawer-new-folder" aria-label="Nueva carpeta">${icon('folderAdd')}</button></div>
    ${folders.join('') || '<p class="drawer-empty">Todavía no hay carpetas</p>'}
    <div class="drawer-section"><span>Etiquetas</span><button class="icon-btn small ripple" id="drawer-new-label" aria-label="Nueva etiqueta">${icon('add')}</button></div>
    ${labels.join('') || '<p class="drawer-empty">Todavía no hay etiquetas</p>'}
    <div class="drawer-divider"></div>
    ${item('reminders', null, icon('bell'), `Recordatorios (${state.notes.filter((n) => !n.trashed && activeReminders(n.id).length).length})`)}
    ${item('templates', null, icon('template'), `Plantillas (${count((n) => n.template && !n.trashed)})`)}
    ${item('archive', null, icon('archive'), `Archivo (${count((n) => n.archived && !n.trashed && !n.template)})`)}
    ${item('trash', null, icon('delete'), `Papelera (${count((n) => n.trashed)})`)}
    <div class="drawer-divider"></div>
    <div class="drawer-item"><button class="drawer-link ripple" id="drawer-settings">${icon('settings')}<span class="drawer-label">Plazo de la papelera</span></button></div>
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
  $('#drawer-new-label').addEventListener('click', () => newLabel());
  $('#drawer-settings').addEventListener('click', () => { closeOverlays(); showTrashSettings(); });
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
    const keep = (n.folders || []).filter((x) => !ids.includes(x));
    if (keep.length !== (n.folders || []).length) state.repo.setMeta(n.id, { folders: keep });
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
    if ((n.labels || []).includes(id)) state.repo.setMeta(n.id, { labels: n.labels.filter((x) => x !== id) });
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
        state.repo.setMeta(n.id, { [field]: arr });
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
    text: 'No se puede deshacer.', ok: 'Eliminar', danger: true,
  });
  if (!r) return false;
  ids.forEach((id) => {
    const n = noteById(id);
    if (n && state.repo.canPurge(n)) { state.repo.removeCompletely(id); removeNoteReminders(id); }
  });
  snackbar(ids.length > 1 ? 'Notas eliminadas' : 'Nota eliminada');
  return true;
}

function removeFromFolder(ids, folderId) {
  ids.forEach((id) => {
    const n = noteById(id);
    if (n) state.repo.setMeta(id, { folders: (n.folders || []).filter((x) => x !== folderId) });
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
      { label: ids.length > 1 ? `Copiar ${ids.length} notas` : 'Copiar nota', onClick: () => { copyNotes(ids); clearSelection(); } },
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
    if (days > 0 && now - n.trashedAt > days * 86400000 && state.repo.canPurge(n)) { state.repo.removeCompletely(n.id); removeNoteReminders(n.id); }
  });
}

/* ---------- Fase 1B: búsqueda con filtros ---------- */
const normalize = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function matchesSearch(n) {
  const s = state.search;
  if (n.trashed || n.template) return false;
  if (n.archived && !s.archived) return false;
  if (s.folder && !(n.folders || []).includes(s.folder)) return false;
  if (s.label && !(n.labels || []).includes(s.label)) return false;
  if (s.color && (n.color || 'default') !== s.color) return false;
  if (s.checks === 'with' && !n.checks?.total) return false;
  if (s.checks === 'pending' && !(n.checks?.total > n.checks?.done)) return false;
  if (s.checks === 'done' && !(n.checks?.total && n.checks.total === n.checks.done)) return false;
  if (s.days && (n.updated || 0) < Date.now() - s.days * 86400000) return false;
  const q = normalize(s.q).trim();
  if (!q) return true;
  const hay = normalize(`${n.title || ''} ${n.text || n.preview || ''}`);
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
  Object.assign(state.search, { active: false, q: '', folder: null, label: null, color: null, checks: null, days: null, archived: false });
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
  ].join('');
  $('#search-filters').querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', (e) => openFilterMenu(b.dataset.filter, e.currentTarget)));
}

function openFilterMenu(key, anchor) {
  const s = state.search;
  const set = (v) => { s[key] = v; renderSearchFilters(); renderList(); };
  if (key === 'archived') { set(!s.archived); return; }
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
  const meta = f.kind === 'folder' ? { folders: [f.id] } : f.kind === 'label' ? { labels: [f.id] } : {};
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
  const body = r.itemId ? `☐ ${r.itemText || 'Casilla'}` : (n.preview ? n.preview.slice(0, 160) : 'Tocá para abrir la nota');
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

/* ---------- Inicio ---------- */
function init() {
  hydrateIcons();
  applyTheme();
  requestPersistence();
  bindEditorUi();
  initNative({ onBack: goBack });
  initNativeReminders(handleReminderAction);

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
    const m = location.hash.match(/^#\/nota\/(.+)$/);
    if (m) { if (state.view !== 'editor' && state.repo) { openNote(m[1], { push: false }); state.pushed = false; } }
    else if (state.view === 'editor') { state.pushed = false; closeEditor(); }
  });

  // Antes de pasar a segundo plano: subir lo pendiente.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveSummaryNow(); state.current?.session?.flush(); }
  });

  watchAuth((user) => {
    if (user) startCloud(user);
    else if (localStorage.getItem('notas-mode') === 'local') startLocal();
    else showLogin();
  });
  checkUpdates();
}

init();
