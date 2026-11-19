import './styles.css';
import { hydrateIcons, icon } from './icons.js';
import { store, requestPersistence, newId } from './store.js';
import { createEditor, runCommand, isActive, summarize, compressImage } from './editor.js';
import { initNative, setStatusBar, haptic, minimizeApp, isNative } from './native.js';
import { APP_VERSION, CHANGELOG_URL, getLatestRelease, isNewer, formatDate } from './version.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

const COLORS = [
  ['default', 'Predeterminado'], ['coral', 'Coral'], ['peach', 'Durazno'], ['sand', 'Arena'],
  ['mint', 'Menta'], ['sage', 'Salvia'], ['fog', 'Niebla'], ['storm', 'Tormenta'],
  ['dusk', 'Atardecer'], ['blossom', 'Flor'],
];

const state = { notes: [], current: null, view: 'list', pushed: false, release: null };
let editor;
let saveTimer;

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
  const view = state.view === 'editor' ? $('#view-editor') : $('#view-list');
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
  const bar = $('#snackbar');
  $('#snack-text').textContent = text;
  const btn = $('#snack-action');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideSnack(); onAction?.(); };
  bar.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, actionLabel ? 5000 : 2800);
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
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom - 4}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  menu.hidden = false;
  requestAnimationFrame(() => menu.classList.add('open'));
  $('#scrim').classList.add('show', 'clear');
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
  $('#scrim').classList.remove('show', 'clear');
  return closed;
}
$('#scrim').addEventListener('click', closeOverlays);

/* ---------- Lista ---------- */
function renderList() {
  const sorted = [...state.notes].sort((a, b) => b.updated - a.updated);
  const pinned = sorted.filter((n) => n.pinned);
  const others = sorted.filter((n) => !n.pinned);
  const fill = (grid, list) => { grid.replaceChildren(...list.map(cardEl)); };
  fill($('#grid-pinned'), pinned);
  fill($('#grid-others'), others);
  $('#pinned-wrap').hidden = pinned.length === 0;
  $('#others-label').hidden = pinned.length === 0 || others.length === 0;
  $('#empty').hidden = sorted.length > 0;
}

function cardEl(n) {
  const el = document.createElement('article');
  el.className = 'card ripple';
  el.tabIndex = 0;
  if (n.color && n.color !== 'default') el.dataset.color = n.color;
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
  el.addEventListener('click', () => openNote(n.id));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(n.id); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

/* ---------- Editor ---------- */
function blankNote() {
  const now = Date.now();
  return { id: newId(), title: '', content: '', color: 'default', pinned: false, created: now, updated: now, preview: '', checks: { done: 0, total: 0 }, thumb: null };
}

function setView(view) {
  state.view = view;
  $('#view-list').classList.toggle('active', view === 'list');
  $('#view-list').classList.toggle('behind', view === 'editor');
  $('#view-editor').classList.toggle('active', view === 'editor');
  syncBars();
}

function paintEditorChrome() {
  const n = state.current;
  const v = $('#view-editor');
  if (n.color && n.color !== 'default') v.dataset.color = n.color; else delete v.dataset.color;
  $('#btn-pin').classList.toggle('active', !!n.pinned);
  $('#btn-pin').setAttribute('aria-label', n.pinned ? 'Dejar de fijar' : 'Fijar nota');
  $('#edited').textContent = n.isNew ? '' : `Editado: ${formatDate(new Date(n.updated).toISOString())}`;
  syncBars();
}

function openNote(id, { push = true, isNew = false } = {}) {
  const found = id ? state.notes.find((x) => x.id === id) : null;
  if (id && !found) return;
  state.current = found ? { ...found } : { ...blankNote(), isNew: true };
  $('#note-title').value = state.current.title || '';
  editor.commands.setContent(state.current.content || '', false);
  editor.commands.clearHistory?.();
  $('#editor-scroll').scrollTop = 0;
  paintEditorChrome();
  setView('editor');
  if (push) {
    history.pushState({ note: state.current.id }, '', `#/nota/${state.current.id}`);
    state.pushed = true;
  }
  if (isNew) editor.commands.focus('end');
}

async function closeEditor() {
  if (state.view !== 'editor') return;
  closeOverlays();
  editor.commands.blur();
  $('#note-title').blur();
  await saveNow();
  state.current = null;
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
  minimizeApp();
}

function isEmptyNote(n) {
  return !n.title.trim() && !n.preview && !n.thumb && !(n.checks?.total);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(saveTimer);
  const n = state.current;
  if (!n || !n.dirty) return;
  const json = editor.getJSON();
  n.content = json;
  n.title = $('#note-title').value;
  Object.assign(n, summarize(json, editor.getText({ blockSeparator: '\n' })));
  n.updated = Date.now();
  n.dirty = false;
  const { dirty, isNew, ...toSave } = n;
  const idx = state.notes.findIndex((x) => x.id === n.id);
  if (isEmptyNote(n)) {
    if (idx >= 0) state.notes.splice(idx, 1);
    await store.remove(n.id);
    return;
  }
  if (idx >= 0) state.notes[idx] = toSave; else state.notes.push(toSave);
  await store.put(toSave);
}

function markDirty() {
  if (!state.current) return;
  state.current.dirty = true;
  scheduleSave();
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
      if (b.dataset.cmd === 'image') { $('#file-image').click(); return; }
      runCommand(editor, b.dataset.cmd);
    });
  });

  $('#file-image').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url, kb } = await compressImage(file);
      editor.chain().focus().setImage({ src: url }).createParagraphNear().run();
      snackbar(`Imagen agregada (${kb} KB)`);
    } catch {
      snackbar('No se pudo cargar la imagen');
    }
  });

  $('#note-title').addEventListener('input', markDirty);
  $('#note-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start'); }
  });

  // Vibración corta al tildar una casilla
  $('#editor').addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) haptic();
  });

  $('#btn-back').addEventListener('click', goBack);

  $('#btn-pin').addEventListener('click', () => {
    state.current.pinned = !state.current.pinned;
    haptic();
    paintEditorChrome();
    markDirty();
    snackbar(state.current.pinned ? 'Nota fijada' : 'Nota sin fijar');
  });

  $('#btn-color').addEventListener('click', () => {
    const cur = state.current.color || 'default';
    const sw = COLORS.map(([key, label]) => `
      <button class="swatch ripple${key === cur ? ' selected' : ''}" data-color-key="${key}" ${key !== 'default' ? `data-color="${key}"` : ''} aria-label="${label}">
        ${key === 'default' ? icon('block') : ''}${key === cur ? `<span class="swatch-check">${icon('check')}</span>` : ''}
      </button>`).join('');
    openSheet(`<h2 class="sheet-title">Color</h2><div class="swatches">${sw}</div>`, (body) => {
      body.querySelectorAll('[data-color-key]').forEach((b) => b.addEventListener('click', () => {
        state.current.color = b.dataset.colorKey;
        paintEditorChrome();
        markDirty();
        closeOverlays();
      }));
    });
  });

  $('#btn-menu-editor').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [{ label: 'Eliminar nota', onClick: deleteCurrent }]);
  });

  // Elevación de la barra superior al desplazar (como Material 3)
  [['#list-scroll', '#appbar-list'], ['#editor-scroll', '#appbar-editor']].forEach(([s, a]) => {
    $(s).addEventListener('scroll', () => $(a).classList.toggle('scrolled', $(s).scrollTop > 2), { passive: true });
  });

  // Cuando aparece el teclado, asegurar que el cursor quede visible
  window.addEventListener('kbchange', () => {
    if (state.view === 'editor' && editor.isFocused) setTimeout(() => editor.commands.scrollIntoView(), 60);
  });
}

async function deleteCurrent() {
  const n = state.current;
  await saveNow();
  const saved = state.notes.find((x) => x.id === n.id);
  state.notes = state.notes.filter((x) => x.id !== n.id);
  await store.remove(n.id);
  state.current = null;
  setView('list');
  if (state.pushed) history.back(); else history.replaceState(null, '', location.pathname + location.search);
  state.pushed = false;
  renderList();
  if (saved) {
    snackbar('Nota eliminada', 'Deshacer', async () => {
      state.notes.push(saved);
      await store.put(saved);
      renderList();
    });
  }
}

/* ---------- Menú de la lista: tema y versión ---------- */
$('#btn-menu-list').addEventListener('click', (e) => {
  const pref = themePref();
  const setTheme = (t) => { localStorage.setItem('notas-theme', t); applyTheme(); };
  openMenu(e.currentTarget, [
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
    <h2 class="sheet-title">Notas v${APP_VERSION}</h2>
    <p class="sheet-text">${isNative ? 'App Android' : 'Versión web'} · Prueba de concepto, Parte 1</p>
    <p class="sheet-text">Archivo más reciente de la Release${r?.tag ? ` ${r.tag}` : ''}: <strong>${formatDate(r?.fileDate)}</strong></p>
    <a class="text-btn" href="${CHANGELOG_URL}" target="_blank" rel="noopener">Ver Changelog</a>
  `);
}
$('#btn-version').addEventListener('click', showVersion);

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

/* ---------- Nota de bienvenida (guía de qué probar) ---------- */
function welcomeNote() {
  const items = [
    'Escribir con tu teclado: predicción, corrector, deslizar, dictado',
    'Dar formato con la barra de abajo (negrita, títulos, listas)',
    'Tildar estas casillas (sentí la vibración)',
    'Agregar una imagen desde la cámara o la galería',
    'Ver que la barra quede justo arriba del teclado',
    'Volver con el botón o el gesto Atrás',
    'Cambiar el color de la nota y fijarla',
    'Probar el tema claro y el oscuro (menú ⋮ de la lista)',
  ];
  const n = blankNote();
  n.title = 'Bienvenido a Notas (prueba)';
  n.content = `<p>Esta es la <strong>Parte 1</strong> de la prueba de concepto: solo aspecto y uso, <em>sin sincronización</em>. Todo se guarda en este dispositivo.</p><h2>Qué probar</h2><ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join('')}</ul><p>Cuando termines, anotá qué se sintió "poco nativo".</p>`;
  n.preview = 'Esta es la Parte 1 de la prueba de concepto: solo aspecto y uso, sin sincronización.';
  n.checks = { done: 0, total: items.length };
  n.pinned = true;
  return n;
}

/* ---------- Inicio ---------- */
async function init() {
  hydrateIcons();
  applyTheme();
  requestPersistence();

  editor = createEditor($('#editor'), {
    onUpdate: () => markDirty(),
    onState: (ed) => updateToolbar(ed),
  });
  bindEditorUi();
  initNative({ onBack: goBack });

  $('#fab').addEventListener('click', () => { haptic(); openNote(null, { isNew: true }); });

  window.addEventListener('popstate', () => {
    closeOverlays();
    const m = location.hash.match(/^#\/nota\/(.+)$/);
    if (m) { if (state.view !== 'editor') { openNote(m[1], { push: false }); state.pushed = false; } }
    else if (state.view === 'editor') { state.pushed = false; closeEditor(); }
  });

  // Guardar si la app pasa a segundo plano
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  state.notes = await store.all();
  if (!state.notes.length && !localStorage.getItem('notas-welcomed')) {
    const w = welcomeNote();
    state.notes.push(w);
    await store.put(w);
    localStorage.setItem('notas-welcomed', '1');
  }
  renderList();

  const m = location.hash.match(/^#\/nota\/(.+)$/);
  if (m) openNote(m[1], { push: false });

  checkUpdates();
}

init();
