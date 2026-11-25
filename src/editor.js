import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { TableMap, CellSelection } from '@tiptap/pm/tables';
import { ySyncPluginKey } from 'y-prosemirror';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const reminderKey = new PluginKey('casillasConRecordatorio');

// Cada casilla lleva un id fijo (para poder ponerle un recordatorio) y se marca si tiene uno.
const TaskItemConId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
    };
  },
  addProseMirrorPlugins() {
    const getIds = this.options.reminderIds;
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: new PluginKey('idsDeCasillas'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          let tr = null; const seen = new Set();
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return;
            const id = node.attrs.id;
            if (!id || seen.has(id)) { tr = tr || state.tr; tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: rid() }); } else seen.add(id);
          });
          return tr;
        },
      }),
      new Plugin({
        key: reminderKey,
        props: {
          decorations: (state) => {
            const ids = getIds?.() || new Set();
            if (!ids.size) return null;
            const decos = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'taskItem' && ids.has(node.attrs.id)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'has-reminder' }));
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// Vuelve a dibujar las marcas de recordatorio de las casillas
export function refreshReminderMarks(editor) {
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(reminderKey, true));
}

// Casilla en la que está el cursor (o null)
export function currentTaskItem(editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'taskItem') return { id: node.attrs.id, text: node.textContent.trim(), checked: !!node.attrs.checked };
  }
  return null;
}

// Estado de las casillas de la nota: id → { checked, text }
export function taskItems(editor) {
  const map = new Map();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem' && node.attrs.id) map.set(node.attrs.id, { checked: !!node.attrs.checked, text: node.textContent.trim() });
  });
  return map;
}

// Tildar una casilla por su id (desde la notificación "Hecho")
export function checkTaskItem(editor, id) {
  let done = false;
  editor.state.doc.descendants((node, pos) => {
    if (!done && node.type.name === 'taskItem' && node.attrs.id === id) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true }));
      done = true;
    }
  });
  return done;
}

// Imagen que puede venir guardada aparte ("img:<nota>/<imagen>"): se resuelve al mostrarla.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const ImagenAparte = Image.extend({
  addNodeView() {
    const resolve = this.options.resolve;
    return ({ node }) => {
      const img = document.createElement('img');
      let current = null;
      const show = (src) => {
        if (src === current) return;
        current = src;
        if (src && src.startsWith('img:')) {
          img.src = PIXEL; img.classList.add('img-loading');
          (resolve ? resolve(src) : Promise.resolve(null)).then((d) => {
            if (current !== src) return;
            img.classList.remove('img-loading');
            if (d) img.src = d; else img.classList.add('img-missing');
          });
        } else { img.src = src || ''; img.classList.remove('img-loading', 'img-missing'); }
      };
      show(node.attrs.src);
      return { dom: img, update: (n) => { if (n.type.name !== 'image') return false; show(n.attrs.src); return true; } };
    };
  },
});

/* ---------- Tablas ---------- */
// Alineación de cada celda: horizontal (izquierda por defecto) y vertical (arriba por defecto).
const H_ALIGN = ['left', 'center', 'right', 'justify'];
const V_ALIGN = ['top', 'middle', 'bottom'];
const alignAttrs = {
  align: {
    default: null,
    parseHTML: (el) => { const v = el.style.textAlign || el.getAttribute('align'); return H_ALIGN.includes(v) && v !== 'left' ? v : null; },
    renderHTML: (a) => (a.align ? { style: `text-align:${a.align}` } : {}),
  },
  valign: {
    default: null,
    parseHTML: (el) => { const v = el.style.verticalAlign || el.getAttribute('valign'); return V_ALIGN.includes(v) && v !== 'top' ? v : null; },
    renderHTML: (a) => (a.valign ? { style: `vertical-align:${a.valign}` } : {}),
  },
};
const Celda = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttrs }; } });
const CeldaEncabezado = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttrs }; } });

// Pegar texto separado por tabulaciones (copiado de Excel, Sheets o un .txt) arma una tabla.
// Si lo copiado trae HTML con <table>, lo resuelve el editor solo.
const PegarTablaTSV = Extension.create({
  name: 'pegarTablaTSV',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pegarTablaTSV'),
      props: {
        handlePaste: (view, event) => {
          const dt = event.clipboardData;
          if (!dt) return false;
          const html = dt.getData('text/html');
          if (html && /<table/i.test(html)) return false;
          const text = dt.getData('text/plain');
          if (!text || !text.includes('\t')) return false;
          if (tableContext(view.state)) return false;
          const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
          const cols = Math.max(...rows.map((r) => r.length));
          if (cols < 2) return false;
          const s = view.state.schema;
          const cell = (t) => s.nodes.tableCell.create(null, s.nodes.paragraph.create(null, t ? s.text(t) : null));
          const table = s.nodes.table.create(null, rows.map((r) => s.nodes.tableRow.create(null, Array.from({ length: cols }, (_, j) => cell((r[j] || '').trim())))));
          view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
          return true;
        },
      },
    })];
  },
});

// Tabla en la que está el cursor: nodo, posición, mapa y celda actual (o null si no hay tabla).
export function tableContext(state) {
  const { $from } = state.selection;
  let cellDepth = 0; let tableDepth = 0;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (!cellDepth && (name === 'tableCell' || name === 'tableHeader')) cellDepth = d;
    if (name === 'table') { tableDepth = d; break; }
  }
  if (!tableDepth) return null;
  const table = $from.node(tableDepth);
  const tableStart = $from.start(tableDepth);
  const tablePos = $from.before(tableDepth);
  const map = TableMap.get(table);
  const cellPos = cellDepth ? $from.before(cellDepth) : null;
  const rect = cellPos != null ? map.findCell(cellPos - tableStart) : { left: 0, top: 0, right: 1, bottom: 1 };
  const cell = cellDepth ? $from.node(cellDepth) : null;
  let headerRow = true;
  table.firstChild?.forEach((c) => { if (c.type.name !== 'tableHeader') headerRow = false; });
  let headerCol = true;
  table.forEach((row) => { if (row.firstChild?.type.name !== 'tableHeader') headerCol = false; });
  return {
    table, tableStart, tablePos, map, rect, cellPos,
    align: cell?.attrs.align || 'left', valign: cell?.attrs.valign || 'top',
    rows: map.height, cols: map.width, row: rect.top + 1, col: rect.left + 1, headerRow, headerCol,
  };
}

export const ALIGN_H = H_ALIGN;
export const ALIGN_V = V_ALIGN;

// Aplica atributos (alineación) a la celda, la fila, la columna o la tabla entera.
// "cell" respeta la selección de varias celdas (arrastrando con el mouse).
export function setCellsAttrs(editor, scope, attrs) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx) return false;
  let positions = [];
  if (scope === 'cell') {
    if (st.selection instanceof CellSelection) st.selection.forEachCell((_n, pos) => positions.push(pos));
    else if (ctx.cellPos != null) positions = [ctx.cellPos];
  } else {
    const { map, rect } = ctx;
    const r = scope === 'row' ? { left: 0, right: map.width, top: rect.top, bottom: rect.bottom }
      : scope === 'col' ? { left: rect.left, right: rect.right, top: 0, bottom: map.height }
        : { left: 0, right: map.width, top: 0, bottom: map.height };
    positions = map.cellsInRect(r).map((p) => p + ctx.tableStart);
  }
  const clean = {};
  Object.entries(attrs).forEach(([k, v]) => { clean[k] = (k === 'align' && v === 'left') || (k === 'valign' && v === 'top') ? null : v; });
  const tr = st.tr;
  positions.forEach((pos) => { const n = tr.doc.nodeAt(pos); if (n) tr.setNodeMarkup(pos, null, { ...n.attrs, ...clean }); });
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

// Inserta una tabla nueva de columnas × filas
export function insertTable(editor, { rows, cols, header }) {
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: !!header }).run();
}

// Comandos de tabla (barra de tabla y panel "Tabla"). focus = false cuando se usan desde el panel.
export function runTableCommand(editor, cmd, { focus = true } = {}) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx) return false;
  const c = focus ? editor.chain().focus() : editor.chain();
  switch (cmd) {
    case 'rowBefore': return c.addRowBefore().run();
    case 'rowAfter': return c.addRowAfter().run();
    case 'colBefore': return c.addColumnBefore().run();
    case 'colAfter': return c.addColumnAfter().run();
    case 'deleteRow': return ctx.rows <= 1 ? c.deleteTable().run() : c.deleteRow().run();
    case 'deleteCol': return ctx.cols <= 1 ? c.deleteTable().run() : c.deleteColumn().run();
    case 'deleteTable': return c.deleteTable().run();
    case 'headerRow': return c.toggleHeaderRow().run();
    case 'headerCol': return c.toggleHeaderColumn().run();
    case 'duplicate': {
      const end = ctx.tablePos + ctx.table.nodeSize;
      editor.view.dispatch(st.tr.insert(end, ctx.table.type.create(ctx.table.attrs, ctx.table.content)).scrollIntoView());
      return true;
    }
    case 'textAfter':
    case 'textBefore': {
      const at = cmd === 'textAfter' ? ctx.tablePos + ctx.table.nodeSize : ctx.tablePos;
      const tr = st.tr.insert(at, st.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
      editor.view.dispatch(tr);
      if (focus) editor.view.focus();
      return true;
    }
    default: return false;
  }
}

// Extensiones del contenido (las mismas para mostrar versiones y exportar)
export function contentExtensions({ resolveImage, reminderIds } = {}) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2] }, codeBlock: false, code: false, history: false }),
    Underline,
    TaskList,
    TaskItemConId.configure({ nested: true, reminderIds }),
    ImagenAparte.configure({ inline: false, allowBase64: true, resolve: resolveImage }),
    Link.configure({ autolink: true, linkOnPaste: true, openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
    // Tablas: en pantallas chicas cada columna mide al menos 64 px y la tabla se desplaza de costado.
    Table.configure({ resizable: true, cellMinWidth: 64, lastColumnResizable: true, allowTableNodeSelection: false, HTMLAttributes: { class: 'nota-tabla' } }),
    TableRow,
    CeldaEncabezado,
    Celda,
  ];
}

// El contenido vive en el documento Yjs de la nota (fusión de cambios entre dispositivos).
export function createEditor(element, { ydoc, onUpdate, onState, onCreate, reminderIds, resolveImage }) {
  return new Editor({
    element,
    extensions: [
      ...contentExtensions({ resolveImage, reminderIds }),
      Placeholder.configure({ placeholder: 'Escribí tu nota…' }),
      PegarTablaTSV,
      Collaboration.configure({ document: ydoc, field: 'default' }),
    ],
    editorProps: {
      attributes: { spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on' },
      // Deja margen abajo para que el cursor no quede tapado por la barra de formato.
      scrollMargin: { top: 24, bottom: 120, left: 0, right: 0 },
      scrollThreshold: { top: 24, bottom: 120, left: 0, right: 0 },
    },
    // remote = el cambio llegó de otro dispositivo (no hace falta volver a guardar el resumen)
    onUpdate: ({ editor, transaction }) => onUpdate(editor, !!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin),
    onCreate: ({ editor }) => onCreate?.(editor),
    onTransaction: ({ editor }) => onState(editor),
  });
}

// Comandos de la barra de formato.
export function runCommand(editor, cmd) {
  const c = editor.chain().focus();
  switch (cmd) {
    case 'undo': return c.undo().run();
    case 'redo': return c.redo().run();
    case 'bold': return c.toggleBold().run();
    case 'italic': return c.toggleItalic().run();
    case 'underline': return c.toggleUnderline().run();
    case 'bulletList': return c.toggleBulletList().run();
    case 'orderedList': return c.toggleOrderedList().run();
    case 'taskList': return c.toggleTaskList().run();
    case 'heading': {
      // Ciclo: párrafo → Título 1 → Título 2 → párrafo
      if (editor.isActive('heading', { level: 1 })) return c.setHeading({ level: 2 }).run();
      if (editor.isActive('heading', { level: 2 })) return c.setParagraph().run();
      return c.setHeading({ level: 1 }).run();
    }
    default: return false;
  }
}

export function isActive(editor, cmd) {
  if (cmd === 'heading') return editor.isActive('heading');
  if (cmd === 'table') return editor.isActive('table');
  if (['bold', 'italic', 'underline', 'bulletList', 'orderedList', 'taskList'].includes(cmd)) return editor.isActive(cmd);
  return false;
}

// Datos derivados para la lista: vista previa, casillas y miniatura.
export function summarize(json, text) {
  let done = 0; let total = 0; let thumb = null; let tables = 0;
  const walk = (node) => {
    if (node.type === 'taskItem') { total++; if (node.attrs?.checked) done++; }
    if (node.type === 'table') tables++;
    if (node.type === 'image' && !thumb) thumb = node.attrs?.src || null;
    node.content?.forEach(walk);
  };
  walk(json);
  return { preview: text.trim().slice(0, 500), text: text.trim().slice(0, 20000), checks: { done, total }, thumb, tables };
}

// Reduce la foto (máx. 1280 px, WebP) para que pese poco: pensado para guardarla luego en Firestore.
export async function compressImage(file, max = 1280, quality = 0.8) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  let url = canvas.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
  const kb = Math.round((url.length * 3) / 4 / 1024);
  return { url, kb };
}

// Miniatura chica para la lista (la imagen completa queda dentro de la nota).
const thumbCache = new Map();
export async function makeThumb(src, max = 320, quality = 0.6) {
  if (!src) return null;
  const key = `${src.length}:${src.slice(-64)}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  try {
    const img = new window.Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', quality);
    thumbCache.set(key, url);
    return url;
  } catch { return null; }
}

// Reduce una imagen que llega como data URL (por ejemplo, desde "Compartir con…")
export async function compressDataUrl(dataUrl, max = 1280, quality = 0.8) {
  const img = new window.Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality);
  return url;
}

// Links de la nota (marcados como link o escritos como texto)
export function noteLinks(editor, limit = 5) {
  const found = [];
  const add = (u) => { if (u && /^https?:\/\//i.test(u) && !found.includes(u) && found.length < limit) found.push(u); };
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    node.marks.forEach((m) => { if (m.type.name === 'link') add(m.attrs.href); });
    (node.text.match(/https?:\/\/[^\s<>"']+/gi) || []).forEach((u) => add(u.replace(/[.,;:!?)]+$/, '')));
  });
  return found;
}
