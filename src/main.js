import './styles.css';
import { hydrateIcons, icon } from './icons.js';
import { requestPersistence } from './store.js';
import { createEditor, runCommand, isActive, summarize, compressImage, makeThumb } from './editor.js';
import { initNative, setStatusBar, haptic, minimizeApp, isNative } from './native.js';
import { APP_VERSION, CHANGELOG_URL, getLatestRelease, isNewer, formatDate } from './version.js';
import { applyTextDiff } from './sync.js';
import { CloudRepo, LocalRepo } from './repo.js';
import { fb, watchAuth, signInGoogle, signOutUser, authErrorMessage } from './firebase.js';

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
};
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

/* ---------- Lista ---------- */
function onList(list) {
  state.notes = list;
  const c = state.current;
  if (c) {
    const n = list.find((x) => x.id === c.id);
    if (n) { c.color = n.color; c.pinned = n.pinned; c.updated = n.updated; paintEditorChrome(); }
  }
  renderList();
  if (state.firstList && state.repo?.serverLoaded) {
    state.firstList = false;
    maybeWelcome();
    const m = location.hash.match(/^#\/nota\/(.+)$/);
    if (m && state.view !== 'editor') openNote(m[1], { push: false });
  }
}

function renderList() {
  const visible = state.notes.filter((n) => !n.trashed).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const pinned = visible.filter((n) => n.pinned);
  const others = visible.filter((n) => !n.pinned);
  $('#grid-pinned').replaceChildren(...pinned.map(cardEl));
  $('#grid-others').replaceChildren(...others.map(cardEl));
  $('#pinned-wrap').hidden = pinned.length === 0;
  $('#others-label').hidden = pinned.length === 0 || others.length === 0;
  $('#empty').hidden = visible.length > 0;
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
function paintEditorChrome() {
  const c = state.current;
  if (!c) return;
  const v = $('#view-editor');
  if (c.color && c.color !== 'default') v.dataset.color = c.color; else delete v.dataset.color;
  $('#btn-pin').classList.toggle('active', !!c.pinned);
  $('#btn-pin').setAttribute('aria-label', c.pinned ? 'Dejar de fijar' : 'Fijar nota');
  updateNoteStatus();
  syncBars();
}

async function openNote(id, { push = true, isNew = false } = {}) {
  const n = state.notes.find((x) => x.id === id);
  if (!n && !isNew) return;
  await closeSession();
  const token = ++openToken;
  const c = {
    id, isNew, dirty: false, status: { pending: 0, error: null },
    color: n?.color || 'default', pinned: !!n?.pinned, updated: n?.updated,
    legacy: n?.legacy || null, seedTitle: n?.title || '',
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
    onUpdate: (ed, remote) => { if (!remote) markDirty(); },
    onState: (ed) => updateToolbar(ed),
    onCreate: (ed) => {
      if (needsSeed && c.legacy) {
        setTimeout(() => {
          if (token === openToken && session.fragment.length === 0) ed.commands.setContent(c.legacy, true);
        }, 60);
      }
    },
  });
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
    title: $('#note-title').value, preview: s.preview, checks: s.checks, thumb, updated: Date.now(),
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

  $('#btn-pin').addEventListener('click', () => {
    const c = state.current;
    c.pinned = !c.pinned;
    haptic();
    paintEditorChrome();
    state.repo.setMeta(c.id, { pinned: c.pinned });
    snackbar(c.pinned ? 'Nota fijada' : 'Nota sin fijar');
  });

  $('#btn-color').addEventListener('click', () => {
    const cur = state.current.color || 'default';
    const sw = COLORS.map(([key, label]) => `
      <button class="swatch ripple${key === cur ? ' selected' : ''}" data-color-key="${key}" ${key !== 'default' ? `data-color="${key}"` : ''} aria-label="${label}">
        ${key === 'default' ? icon('block') : ''}${key === cur ? `<span class="swatch-check">${icon('check')}</span>` : ''}
      </button>`).join('');
    openSheet(`<h2 class="sheet-title">Color</h2><p class="sheet-text">El color es tuyo: si compartís la nota, cada persona elige el suyo.</p><div class="swatches">${sw}</div>`, (body) => {
      body.querySelectorAll('[data-color-key]').forEach((b) => b.addEventListener('click', () => {
        const c = state.current;
        c.color = b.dataset.colorKey;
        paintEditorChrome();
        state.repo.setMeta(c.id, { color: c.color });
        closeOverlays();
      }));
    });
  });

  $('#btn-menu-editor').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [{ label: 'Eliminar nota', onClick: deleteCurrent }]);
  });

  [['#list-scroll', '#appbar-list'], ['#editor-scroll', '#appbar-editor']].forEach(([s, a]) => {
    $(s).addEventListener('scroll', () => $(a).classList.toggle('scrolled', $(s).scrollTop > 2), { passive: true });
  });

  window.addEventListener('kbchange', () => {
    if (state.view === 'editor' && editor?.isFocused) setTimeout(() => editor?.commands.scrollIntoView(), 60);
  });
}

// Eliminar = mandar a la papelera (es personal; la nota no se borra para otros).
async function deleteCurrent() {
  const id = state.current.id;
  state.repo.setMeta(id, { trashed: true });
  if (state.pushed) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); closeEditor(); }
  state.pushed = false;
  snackbar('Nota enviada a la papelera', 'Deshacer', () => state.repo.setMeta(id, { trashed: false }));
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
    <h2 class="sheet-title">Notas v${esc(APP_VERSION)}</h2>
    <p class="sheet-text">${isNative ? 'App Android' : 'Versión web'} · Prueba de concepto, Parte 2A</p>
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
      ${isNative
        ? '<p class="sheet-text">El inicio de sesión en la app de Android llega en la versión 0.0.3.</p>'
        : '<button class="text-btn ripple" id="btn-signin">Iniciar sesión con Google</button>'}
    `, (body) => body.querySelector('#btn-signin')?.addEventListener('click', async () => {
      try { await signInGoogle(); location.reload(); } catch (e) { const m = authErrorMessage(e); if (m) snackbar(m); }
    }));
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
  $('#login-native-hint').hidden = !isNative;
  $('#btn-google').hidden = isNative;
  setView('login');
}

$('#btn-google').addEventListener('click', async () => {
  try { await signInGoogle(); } catch (e) { const m = authErrorMessage(e); if (m) snackbar(m); }
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

/* ---------- Inicio ---------- */
function init() {
  hydrateIcons();
  applyTheme();
  requestPersistence();
  bindEditorUi();
  initNative({ onBack: goBack });

  $('#fab').addEventListener('click', () => {
    if (!state.repo) return;
    haptic();
    const id = state.repo.create();
    // Mostrar el editor y enfocar el título dentro del mismo toque: así el teclado se abre en el celular.
    $('#note-title').value = '';
    delete $('#view-editor').dataset.color;
    setView('editor');
    $('#note-title').focus();
    openNote(id, { isNew: true });
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

  if (isNative) {
    // Parte 2A: en el APK todavía no hay inicio de sesión (llega en la 0.0.3).
    if (localStorage.getItem('notas-mode') === 'local') startLocal(); else showLogin();
  } else {
    watchAuth((user) => {
      if (user) startCloud(user);
      else if (localStorage.getItem('notas-mode') === 'local') startLocal();
      else showLogin();
    });
  }
  checkUpdates();
}

init();
