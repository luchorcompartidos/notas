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
import { TableMap, CellSelection, addRow, addColumn, removeRow, removeColumn } from '@tiptap/pm/tables';
import { ySyncPluginKey } from 'y-prosemirror';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import * as Sel from './seleccion.js';

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
// Color de fondo de la celda: se guarda la clave de la paleta (los colores reales cambian con el tema claro/oscuro).
export const CELL_BG = [
  ['yellow', 'Amarillo'], ['orange', 'Naranja'], ['red', 'Rojo'], ['pink', 'Rosa'], ['purple', 'Violeta'],
  ['blue', 'Azul'], ['cyan', 'Celeste'], ['green', 'Verde'], ['gray', 'Gris'],
];
const BG_KEYS = CELL_BG.map(([k]) => k);
const cellAttrs = {
  ...alignAttrs,
  bg: {
    default: null,
    parseHTML: (el) => { const v = el.getAttribute('data-bg'); return BG_KEYS.includes(v) ? v : null; },
    renderHTML: (a) => (a.bg ? { 'data-bg': a.bg } : {}),
  },
};
const Celda = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
const CeldaEncabezado = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });

// Alto de fila (px). Funciona como alto mínimo: si el contenido ocupa más, la fila crece. null = automático.
const Fila = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (el) => { const h = parseInt(el.style.height || el.getAttribute('height'), 10); return h > 0 ? h : null; },
        renderHTML: (a) => (a.height ? { style: `height:${a.height}px` } : {}),
      },
    };
  },
});

// Ancho de columnas de la tabla: colMode 'auto' = según el contenido; null = fijo (iguales o con los anchos de colwidth).
// En el editor la tabla se dibuja con una vista propia (TableView), así que el modo se marca con una decoración
// en el contenedor (.tableWrapper.tbl-auto). En las vistas sin editor (versiones, exportar) va como data-cols.
const tablaModoKey = new PluginKey('tablaModo');
const decoTablas = (doc) => {
  const decos = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') {
      if (node.attrs.colMode === 'auto') decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'tbl-auto' }));
      return false;
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
};
const Tabla = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colMode: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-cols') === 'auto' ? 'auto' : null),
        renderHTML: (a) => (a.colMode ? { 'data-cols': a.colMode } : {}),
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: tablaModoKey,
        state: {
          init: (_c, state) => decoTablas(state.doc),
          apply: (tr, old) => (tr.docChanged ? decoTablas(tr.doc) : old),
        },
        props: { decorations(state) { return tablaModoKey.getState(state); } },
        // Si en modo automático se arrastra el borde de una columna (PC), la tabla pasa a anchos manuales.
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          let tr = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return !node.isTextblock;
            if (node.attrs.colMode === 'auto') {
              let has = false;
              node.descendants((c) => { if (c.attrs.colwidth?.some((w) => w > 0)) has = true; return !has && (c.type.name === 'tableRow'); });
              if (has) { tr = tr || state.tr; tr.setNodeMarkup(pos, null, { ...node.attrs, colMode: null }); }
            }
            return false;
          });
          return tr;
        },
      }),
    ];
  },
});

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
    align: cell?.attrs.align || 'left', valign: cell?.attrs.valign || 'top', bg: cell?.attrs.bg || null,
    rows: map.height, cols: map.width, row: rect.top + 1, col: rect.left + 1, headerRow, headerCol,
  };
}

export const ALIGN_H = H_ALIGN;
export const ALIGN_V = V_ALIGN;

// Aplica atributos (alineación, color de fondo) a la celda, la fila, la columna o la tabla entera.
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
  Object.entries(attrs).forEach(([k, v]) => { clean[k] = (k === 'align' && v === 'left') || (k === 'valign' && v === 'top') || (k === 'bg' && !BG_KEYS.includes(v)) ? null : v; });
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
      // Si al lado ya hay un renglón vacío (por ejemplo, el que queda siempre al final), se usa ese.
      const $at = st.doc.resolve(at);
      const near = cmd === 'textAfter' ? $at.nodeAfter : $at.nodeBefore;
      const tr = st.tr;
      if (near && near.type.name === 'paragraph' && near.content.size === 0) {
        tr.setSelection(TextSelection.create(tr.doc, cmd === 'textAfter' ? at + 1 : at - 1));
      } else {
        tr.insert(at, st.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, at + 1));
      }
      tr.scrollIntoView();
      editor.view.dispatch(tr);
      if (focus) editor.view.focus();
      return true;
    }
    default: return false;
  }
}

/* ---------- Tablas: ancho de columnas, alto de filas, copiar e insertar ---------- */
export const CELL_MIN = 64;
const COL_MAX = 1200;
const ROW_MIN = 24;
const ROW_MAX = 800;

// Posición (en el documento) de la fila r de la tabla del contexto.
function rowPos(ctx, r) {
  let p = ctx.tableStart;
  for (let i = 0; i < r; i++) p += ctx.table.child(i).nodeSize;
  return p;
}
function domAt(editor, pos) {
  try { const d = editor.view.nodeDOM(pos); return d && d.nodeType === 1 ? d : null; } catch { return null; }
}
// Ancho que se ve hoy de la columna col (medido en pantalla).
// Con celdas combinadas (v0.3.8): se mide en una fila donde la columna tenga una celda propia (no combinada a lo
// ancho); si en todas está combinada, vale el ancho guardado de esa columna antes que el promedio.
function measureCol(editor, ctx, col, row = ctx.rect.top) {
  const { map, table } = ctx;
  const at = (r) => map.map[r * map.width + col];
  let rr = row;
  if ((table.nodeAt(at(rr))?.attrs.colspan || 1) > 1) {
    for (let r = 0; r < map.height; r++) if ((table.nodeAt(at(r))?.attrs.colspan || 1) === 1) { rr = r; break; }
  }
  const p = at(rr);
  const cell = table.nodeAt(p);
  const span = cell?.attrs.colspan || 1;
  const el = domAt(editor, ctx.tableStart + p);
  const w = el ? el.offsetWidth / span : 0;
  const attr = cell?.attrs.colwidth?.[col - map.colCount(p)];
  return Math.round((span > 1 && attr) || w || attr || CELL_MIN);
}
function measureRow(editor, ctx, r) {
  const el = domAt(editor, rowPos(ctx, r));
  return Math.round(el ? el.offsetHeight : (ctx.table.child(r).attrs.height || 0));
}

// Estado de los tamaños para el panel "Tabla".
export function tableSizes(editor) {
  const ctx = tableContext(editor.state);
  if (!ctx) return null;
  let anyWidth = false;
  ctx.table.descendants((c) => { if (c.attrs.colwidth?.some((w) => w > 0)) anyWidth = true; return c.type.name === 'tableRow'; });
  const colMode = ctx.table.attrs.colMode === 'auto' ? 'auto' : anyWidth ? 'manual' : 'equal';
  const heights = [];
  ctx.table.forEach((row) => heights.push(row.attrs.height || null));
  const rowMode = heights.every((h) => !h) ? 'auto' : heights.every((h) => h && h === heights[0]) ? 'equal' : 'manual';
  return {
    colMode, rowMode,
    colWidth: measureCol(editor, ctx, ctx.rect.left),
    rowHeight: measureRow(editor, ctx, ctx.rect.top),
  };
}

// Pone colwidth = width en todas las celdas de la columna col (o la borra con width = null).
function setColAttr(tr, ctx, col, width) {
  const { map, table, tableStart } = ctx;
  for (let row = 0; row < map.height; row++) {
    const idx = row * map.width + col;
    if (row && map.map[idx] === map.map[idx - map.width]) continue;
    const p = map.map[idx];
    const attrs = table.nodeAt(p).attrs;
    const i = attrs.colspan === 1 ? 0 : col - map.colCount(p);
    const cw = attrs.colwidth ? attrs.colwidth.slice() : new Array(attrs.colspan).fill(0);
    if ((cw[i] || null) === (width || null)) continue;
    cw[i] = width || 0;
    tr.setNodeMarkup(tableStart + p, null, { ...attrs, colwidth: cw.some((w) => w > 0) ? cw : null });
  }
}

// Ancho manual de la columna en la que está el cursor (también sirve en el celular, sin arrastrar).
export function setColumnWidth(editor, width) {
  const ctx = tableContext(editor.state);
  if (!ctx) return false;
  const w = Math.max(CELL_MIN, Math.min(COL_MAX, Math.round(Number(width) || CELL_MIN)));
  const tr = editor.state.tr;
  // Al fijar una columna, las demás quedan con el ancho que se ve ahora (si no, se reparten el resto y "saltan").
  const widths = [];
  for (let c = 0; c < ctx.map.width; c++) widths.push(c === ctx.rect.left ? w : measureCol(editor, ctx, c));
  if (ctx.table.attrs.colMode) tr.setNodeMarkup(ctx.tablePos, null, { ...ctx.table.attrs, colMode: null });
  widths.forEach((cw, c) => setColAttr(tr, ctx, c, cw));
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

// Ancho de todas las columnas: 'auto' (según el contenido), 'equal' (todas iguales) o 'manual' (fija los anchos actuales).
export function setColumnsMode(editor, mode) {
  const ctx = tableContext(editor.state);
  if (!ctx) return false;
  const tr = editor.state.tr;
  const widths = [];
  for (let c = 0; c < ctx.map.width; c++) widths.push(mode === 'manual' ? measureCol(editor, ctx, c) : null);
  tr.setNodeMarkup(ctx.tablePos, null, { ...ctx.table.attrs, colMode: mode === 'auto' ? 'auto' : null });
  widths.forEach((w, c) => setColAttr(tr, ctx, c, w));
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

// Alto manual de la fila en la que está el cursor (null = automático).
export function setRowHeight(editor, height) {
  const ctx = tableContext(editor.state);
  if (!ctx) return false;
  const h = height == null ? null : Math.max(ROW_MIN, Math.min(ROW_MAX, Math.round(Number(height) || ROW_MIN)));
  const r = ctx.rect.top;
  const row = ctx.table.child(r);
  if ((row.attrs.height || null) === h) return true;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(rowPos(ctx, r), null, { ...row.attrs, height: h }));
  return true;
}

// Alto de todas las filas: 'auto', 'equal' (todas como la más alta) o 'manual' (fija los altos actuales).
export function setRowsMode(editor, mode) {
  const ctx = tableContext(editor.state);
  if (!ctx) return false;
  const measured = [];
  for (let r = 0; r < ctx.map.height; r++) measured.push(measureRow(editor, ctx, r));
  const max = Math.max(ROW_MIN, ...measured);
  const tr = editor.state.tr;
  for (let r = 0; r < ctx.table.childCount; r++) {
    const row = ctx.table.child(r);
    const h = mode === 'auto' ? null : mode === 'equal' ? max : Math.max(ROW_MIN, measured[r] || ROW_MIN);
    if ((row.attrs.height || null) !== h) tr.setNodeMarkup(tr.mapping.map(rowPos(ctx, r)), null, { ...row.attrs, height: h });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

// "Portapapeles" de filas y columnas: se guarda como JSON para poder insertarlo también en otra nota.
let tableClip = null;
export function getTableClip() { return tableClip; }

export function copyTablePart(editor, kind) {
  const ctx = tableContext(editor.state);
  if (!ctx) return null;
  const { map, table, rect } = ctx;
  const seen = new Set();
  const cells = [];
  const n = kind === 'row' ? map.width : map.height;
  for (let i = 0; i < n; i++) {
    const p = kind === 'row' ? map.map[rect.top * map.width + i] : map.map[i * map.width + rect.left];
    if (seen.has(p)) { cells.push(null); continue; } // parte de una celda combinada: va vacía
    seen.add(p);
    // Una combinada que empieza en otra fila (o columna) tiene su contenido allá: acá va vacía (como Excel; v0.3.8).
    const cr = map.findCell(p);
    if ((kind === 'row' ? cr.top !== rect.top : cr.left !== rect.left)) { cells.push(null); continue; }
    cells.push(table.nodeAt(p).toJSON());
  }
  tableClip = {
    kind, cells,
    index: (kind === 'row' ? rect.top : rect.left) + 1,
    rowAttrs: kind === 'row' ? { ...table.child(rect.top).attrs } : null,
    width: kind === 'col' ? columnWidths(table, map)[rect.left] || null : null,
  };
  return tableClip;
}

// Ancho guardado de cada columna (0 si no tiene): el de la primera celda que la cubre con ancho.
function columnWidths(table, map) {
  const out = new Array(map.width).fill(0);
  for (let c = 0; c < map.width; c++) {
    for (let r = 0; r < map.height; r++) {
      const rel = map.map[r * map.width + c];
      const v = table.nodeAt(rel).attrs.colwidth?.[c - map.colCount(rel)];
      if (v > 0) { out[c] = v; break; }
    }
  }
  return out;
}
const tableManual = (table) => {
  let m = false;
  table.descendants((c) => { if (c.attrs.colwidth?.some((w) => w > 0)) m = true; return c.type.name === 'tableRow'; });
  return m && table.attrs.colMode !== 'auto';
};
// La tabla en tablePos como el "rect" de prosemirror-tables (addRow, removeRow, …), leída del documento actual.
function tableRectAt(doc, tablePos) {
  const table = doc.nodeAt(tablePos);
  const map = TableMap.get(table);
  return { table, map, tableStart: tablePos + 1, left: 0, top: 0, right: map.width, bottom: map.height };
}
// Una casilla que es una celda sola (1 × 1) en la posición (r, c).
const soloAt = (map, r, c) => {
  const cr = map.findCell(map.map[r * map.width + c]);
  return cr.top === r && cr.left === c && cr.bottom === r + 1 && cr.right === c + 1;
};

// Pone en celdas ya creadas (posiciones relativas a la tabla) el contenido y el formato copiados (JSON de una celda).
// El tipo y el ancho de la celda de destino no cambian, salvo `colwidth` si se indica.
function fillCells(tr, tablePos, jobs, schema) {
  jobs.slice().sort((a, b) => b.rel - a.rel).forEach(({ rel, json, colwidth }) => {
    const pos = tablePos + 1 + rel;
    const cell = tr.doc.nodeAt(pos);
    if (!cell) return;
    let content = null; let fmt = {};
    if (json) {
      try {
        const src = schema.nodeFromJSON(json);
        content = src.content;
        fmt = { align: src.attrs.align || null, valign: src.attrs.valign || null, bg: src.attrs.bg || null };
      } catch { content = null; }
    }
    const attrs = { ...cell.attrs, ...fmt };
    if (colwidth !== undefined) attrs.colwidth = colwidth;
    tr.setNodeMarkup(pos, null, attrs);
    if (content && content.size) tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, content);
  });
}

// Inserta la fila o columna copiada arriba/abajo (fila) o a la izquierda/derecha (columna) de la celda actual.
// Desde la v0.3.8 primero se agrega la fila o columna vacía con addRow/addColumn de prosemirror-tables (agrandan las
// celdas combinadas que cruza) y después se llenan las celdas nuevas. Si la nueva cae dentro de una combinada, esa
// casilla no existe (la ocupa la combinada) y su contenido se descarta. Las combinadas a lo ancho de la fila copiada
// (o a lo alto de la columna copiada) se vuelven a combinar, si las casillas de destino están libres.
export function insertCopied(editor, where, { focus = true } = {}) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx || !tableClip) return false;
  const { map, table, tableStart, rect, tablePos } = ctx;
  const s = st.schema;
  const manual = tableManual(table);
  const tr = st.tr;
  const R0 = { table, map, tableStart, left: 0, top: 0, right: map.width, bottom: map.height };
  const jobs = []; const spans = [];
  if (tableClip.kind === 'row') {
    const widths = columnWidths(table, map);
    const target = where === 'before' ? rect.top : rect.bottom;
    addRow(tr, R0, target);
    const t = tr.doc.nodeAt(tablePos);
    const m = TableMap.get(t);
    for (let c = 0; c < m.width; c++) {
      if (!soloAt(m, target, c)) continue;
      const rel = m.map[target * m.width + c];
      const cr = m.findCell(rel);
      if (cr.top !== target) continue;
      const json = tableClip.cells[c] || null;
      jobs.push({ rel, json, colwidth: manual && widths[c] ? [widths[c]] : null });
      const span = json?.attrs?.colspan > 1 ? json.attrs.colspan : 1;
      if (span > 1) spans.push({ top: target, bottom: target, left: c, right: Math.min(m.width - 1, c + span - 1) });
    }
    const h = tableClip.rowAttrs?.height || null;
    let rp = tablePos + 1;
    for (let i = 0; i < target; i++) rp += t.child(i).nodeSize;
    if (h) tr.setNodeMarkup(rp, null, { ...t.child(target).attrs, height: h });
  } else {
    const t0 = where === 'before' ? rect.left : rect.right;
    addColumn(tr, R0, t0);
    const t = tr.doc.nodeAt(tablePos);
    const m = TableMap.get(t);
    for (let r = 0; r < m.height; r++) {
      if (!soloAt(m, r, t0)) continue;
      const rel = m.map[r * m.width + t0];
      const json = tableClip.cells[r] || null;
      jobs.push({ rel, json, colwidth: null });
      const span = json?.attrs?.rowspan > 1 ? json.attrs.rowspan : 1;
      if (span > 1) spans.push({ left: t0, right: t0, top: r, bottom: Math.min(m.height - 1, r + span - 1) });
    }
  }
  fillCells(tr, tablePos, jobs, s);
  // Combinadas de lo copiado: solo si todas las casillas de destino son celdas sueltas.
  spans.forEach((R) => {
    const m = TableMap.get(tr.doc.nodeAt(tablePos));
    for (let r = R.top; r <= R.bottom; r++) for (let c = R.left; c <= R.right; c++) if (!soloAt(m, r, c)) return;
    mergeRectTr(tr, tablePos, R);
  });
  // Columna nueva en una tabla con anchos manuales: el ancho copiado (o uno por defecto), también en las combinadas que cruza.
  if (tableClip.kind === 'col' && manual) {
    const x = tableRectAt(tr.doc, tablePos);
    setColAttr(tr, x, where === 'before' ? rect.left : rect.right, tableClip.width || CELL_MIN * 2);
  }
  editor.view.dispatch(tr.scrollIntoView());
  if (focus) editor.view.focus();
  return true;
}

// Duplicar la fila o la columna actual (sin tocar lo que haya copiado).
export function duplicateTablePart(editor, kind, opts) {
  const prev = tableClip;
  copyTablePart(editor, kind);
  const ok = insertCopied(editor, 'after', opts);
  tableClip = prev;
  return ok;
}

/* ---------- Tablas: ordenar por una columna ---------- */
// Número escrito como en Argentina (1.234,56) o con punto decimal (1234.56); también con $, % o espacios.
// Un solo punto seguido de exactamente 3 cifras se toma como separador de miles (1.234 = 1234).
export function parseCellNumber(text) {
  const m = String(text || '').replace(/\s/g, '').match(/-?[\d.,]*\d/);
  if (!m) return null;
  let t = m[0];
  const lastDot = t.lastIndexOf('.'); const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    t = t.match(/,/g).length > 1 ? t.replace(/,/g, '') : t.replace(',', '.'); // 1,234,567 o 12,5
  } else if (lastDot >= 0) {
    if (t.match(/\./g).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

let collator = null;
const compareText = (a, b) => {
  if (!collator) { try { collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }); } catch { collator = { compare: (x, y) => (x < y ? -1 : x > y ? 1 : 0) }; } }
  return collator.compare(a, b);
};

// Ordena las filas de la tabla por la columna del cursor. dir: 'asc' | 'desc'; kind: 'text' | 'number'.
// La fila de encabezado (si la hay) no se mueve. Las celdas vacías (o sin número) van siempre al final.
// Devuelve { ok, moved, reason } (reason: 'mergedV' si hay celdas combinadas a lo alto, 'few' si hay menos de 2 filas para ordenar).
export function sortTable(editor, dir = 'asc', kind = 'text', { focus = false } = {}) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx) return { ok: false, reason: 'none' };
  const { table, map, tablePos, rect } = ctx;
  // Con celdas combinadas (v0.3.8): se ordena si son solo a lo ancho (cada fila se mueve entera, con sus combinadas);
  // si hay alguna a lo alto (abarca varias filas), no.
  let vertical = false;
  table.descendants((c) => { if (c.attrs.rowspan > 1) vertical = true; return c.type.name === 'tableRow'; });
  if (vertical) return { ok: false, reason: 'mergedV' };
  const col = rect.left;
  const first = ctx.headerRow ? 1 : 0;
  const rows = [];
  for (let r = first; r < table.childCount; r++) {
    const text = table.nodeAt(map.map[r * map.width + col]).textContent.trim();
    rows.push({ r, node: table.child(r), text, num: kind === 'number' ? parseCellNumber(text) : null });
  }
  if (rows.length < 2) return { ok: false, reason: 'few' };
  const sign = dir === 'desc' ? -1 : 1;
  const sorted = rows.slice().sort((a, b) => {
    const ea = kind === 'number' ? a.num == null : !a.text; const eb = kind === 'number' ? b.num == null : !b.text;
    if (ea || eb) return ea === eb ? a.r - b.r : ea ? 1 : -1;
    const d = kind === 'number' ? a.num - b.num : compareText(a.text, b.text);
    return d ? d * sign : a.r - b.r; // a igual valor se mantiene el orden que tenían
  });
  const moved = sorted.filter((x, i) => x.r !== rows[i].r).length;
  if (!moved) return { ok: true, moved: 0 };
  const kids = [];
  for (let r = 0; r < first; r++) kids.push(table.child(r));
  sorted.forEach((x) => kids.push(x.node));
  const tr = st.tr.replaceWith(tablePos, tablePos + table.nodeSize, table.type.create(table.attrs, kids));
  // El cursor queda en la misma columna, en la primera fila ordenada.
  const nt = tr.doc.nodeAt(tablePos);
  const nmap = TableMap.get(nt);
  const cell = tablePos + 1 + nmap.map[first * nmap.width + col];
  tr.setSelection(TextSelection.near(tr.doc.resolve(cell + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  if (focus) editor.view.focus();
  return { ok: true, moved };
}

// Mantener apretada una celda (o clic derecho): ubica el cursor en esa celda, salvo que ya esté dentro
// de una selección de varias celdas. Devuelve true si el punto está en una tabla.
export function placeCursorAt(editor, x, y) {
  const view = editor.view;
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return false;
  const st = view.state;
  if (st.selection instanceof CellSelection) {
    let inside = false;
    st.selection.forEachCell((n, pos) => { if (hit.pos > pos && hit.pos < pos + n.nodeSize) inside = true; });
    if (inside) return true;
  }
  const sel = TextSelection.near(st.doc.resolve(hit.pos));
  view.dispatch(st.tr.setSelection(sel));
  return !!tableContext(view.state);
}

/* ---------- Tablas: selección de celdas sueltas, filas y columnas ---------- */
// Es una selección propia (la de ProseMirror solo admite un rectángulo): un conjunto de celdas "fila,columna"
// de una tabla, que se marca en pantalla con decoraciones. No toca la nota: no se guarda ni se sincroniza.
const selKey = new PluginKey('seleccionCeldas');
const tableAt = (doc, pos) => { const n = pos == null ? null : doc.nodeAt(pos); return n && n.type.name === 'table' ? n : null; };

const SeleccionCeldas = Extension.create({
  name: 'seleccionCeldas',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: selKey,
      state: {
        init: () => null,
        apply: (tr, cur, _old, state) => {
          const meta = tr.getMeta(selKey);
          if (meta !== undefined) return meta;
          if (!cur || !tr.docChanged) return cur;
          // Un cambio que llega de otro dispositivo puede reemplazar todo el documento: se busca la tabla en el mismo lugar.
          const remote = tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
          let pos = cur.tablePos;
          let table = remote ? tableAt(state.doc, pos) : null;
          if (!table) { pos = tr.mapping.map(cur.tablePos, 1); table = tableAt(state.doc, pos); }
          if (!table) return null;
          const m = TableMap.get(table);
          const cells = new Set([...cur.cells].filter((k) => { const p = Sel.parseKey(k); return p.r < m.height && p.c < m.width; }));
          const anchor = cur.anchor && cur.anchor.r < m.height && cur.anchor.c < m.width ? cur.anchor : null;
          return { ...cur, tablePos: pos, cells, anchor };
        },
      },
      props: {
        decorations(state) {
          const s = selKey.getState(state);
          const table = s && tableAt(state.doc, s.tablePos);
          if (!table) return null;
          const map = TableMap.get(table);
          const start = s.tablePos + 1;
          const cls = new Map();
          const add = (p, c) => cls.set(p, `${cls.get(p) || ''} ${c}`);
          s.cells.forEach((k) => {
            const { r, c } = Sel.parseKey(k);
            if (r < map.height && c < map.width) add(map.map[r * map.width + c], 'cell-sel');
          });
          if (s.anchor && s.anchor.r < map.height && s.anchor.c < map.width) add(map.map[s.anchor.r * map.width + s.anchor.c], 'cell-anchor');
          const decos = [Decoration.node(s.tablePos, s.tablePos + table.nodeSize, { class: 'tbl-selecting' })];
          cls.forEach((c, p) => { const n = table.nodeAt(p); if (n) decos.push(Decoration.node(start + p, start + p + n.nodeSize, { class: c.trim() })); });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// Estado de la selección (o null si no se está seleccionando).
export function selState(editor) {
  if (!editor || editor.isDestroyed) return null;
  const s = selKey.getState(editor.state);
  const table = s && tableAt(editor.state.doc, s.tablePos);
  if (!table) return null;
  const map = TableMap.get(table);
  return { ...s, table, map, rows: map.height, cols: map.width, spans: tableSpans(table, map) };
}
function setSel(editor, value) { editor.view.dispatch(editor.state.tr.setMeta(selKey, value)); }

// Celda de la tabla a la que pertenece un elemento de la pantalla (td/th): { tablePos, r, c }.
export function cellAtDom(editor, el) {
  const view = editor.view;
  const cellEl = el?.closest?.('td, th');
  if (!cellEl || !view.dom.contains(cellEl)) return null;
  let pos;
  try { pos = view.posAtDOM(cellEl, 0); } catch { return null; }
  const $p = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  let cellPos = null;
  for (let d = $p.depth; d > 0; d--) {
    const name = $p.node(d).type.name;
    if (cellPos == null && (name === 'tableCell' || name === 'tableHeader')) cellPos = $p.before(d);
    if (name === 'table') {
      if (cellPos == null) return null;
      const map = TableMap.get($p.node(d));
      const rect = map.findCell(cellPos - $p.start(d));
      return { tablePos: $p.before(d), r: rect.top, c: rect.left };
    }
  }
  return null;
}

// Empieza a seleccionar: con la celda indicada, o con la del cursor (y las de una selección hecha con el mouse).
export function startSelection(editor, hit = null) {
  const st = editor.state;
  if (hit) {
    const t = tableAt(st.doc, hit.tablePos);
    const cells = Sel.normalizeSpans(new Set([Sel.cellKey(hit.r, hit.c)]), t ? tableSpans(t) : []);
    setSel(editor, { tablePos: hit.tablePos, cells, anchor: { r: hit.r, c: hit.c } });
    return true;
  }
  const ctx = tableContext(st);
  if (!ctx) return false;
  const cells = new Set();
  if (st.selection instanceof CellSelection) {
    st.selection.forEachCell((_n, pos) => { const r = ctx.map.findCell(pos - ctx.tableStart); cells.add(Sel.cellKey(r.top, r.left)); });
  } else if (ctx.cellPos != null) cells.add(Sel.cellKey(ctx.rect.top, ctx.rect.left));
  setSel(editor, { tablePos: ctx.tablePos, cells: Sel.normalizeSpans(cells, tableSpans(ctx.table, ctx.map)), anchor: { r: ctx.rect.top, c: ctx.rect.left } });
  return true;
}
export function endSelection(editor) { if (selKey.getState(editor.state)) setSel(editor, null); }

// Cambios de la selección. op: 'toggle' (celda), 'range' (desde la última celda tocada), 'row', 'col', 'all', 'invert', 'none'.
export function updateSelection(editor, op, hit = null) {
  const s = selState(editor);
  if (!s) return false;
  // Tocar una celda de otra tabla empieza una selección nueva en esa tabla.
  if (hit && hit.tablePos !== s.tablePos) return startSelection(editor, hit);
  let cells = new Set(s.cells); let anchor = s.anchor;
  const at = hit || anchor || { r: 0, c: 0 };
  switch (op) {
    // Una celda combinada se suma o se quita entera (normalizeSpans, al final).
    case 'toggle': { const k = Sel.cellKey(at.r, at.c); if (cells.has(k)) cells.delete(k); else cells.add(k); anchor = { r: at.r, c: at.c }; break; }
    case 'range': cells = Sel.addRangeSpans(cells, anchor || at, at, s.spans); anchor = { r: at.r, c: at.c }; break;
    case 'row': cells = Sel.toggleLine(cells, 'row', at.r, s.rows, s.cols); anchor = { r: at.r, c: anchor?.c ?? 0 }; break;
    case 'col': cells = Sel.toggleLine(cells, 'col', at.c, s.rows, s.cols); anchor = { r: anchor?.r ?? 0, c: at.c }; break;
    case 'all': cells = Sel.allKeys(s.rows, s.cols); break;
    case 'invert': cells = Sel.invertKeys(cells, s.rows, s.cols); break;
    case 'none': cells = new Set(); break;
    default: return false;
  }
  cells = Sel.normalizeSpans(cells, s.spans, s.cells);
  setSel(editor, { tablePos: s.tablePos, cells, anchor });
  return true;
}

// Arrastre (v0.3.6): la selección que había al empezar (base) más el rectángulo desde la celda inicial
// hasta la que está debajo del dedo o del mouse. Se recalcula en cada movimiento (achicar el rectángulo también sirve).
export function dragSelection(editor, base, from, to) {
  const s = selState(editor);
  if (!s || !to || to.tablePos !== s.tablePos) return false;
  // El rectángulo se agranda para no cortar celdas combinadas (v0.3.7).
  setSel(editor, { tablePos: s.tablePos, cells: Sel.addRangeSpans(new Set(base), from, to, s.spans), anchor: { r: to.r, c: to.c } });
  return true;
}

// Resumen para la barra y el menú: cuántas celdas, filas y columnas completas, y las que toca.
export function selectionInfo(editor) {
  const s = selState(editor);
  if (!s) return null;
  // count = celdas (una combinada cuenta una vez); slots = casillas de la grilla.
  return {
    count: selCellPositions(s).length, slots: s.cells.size, nRows: s.rows, nCols: s.cols, anchor: s.anchor,
    merged: s.spans.length > 0, merge: Sel.mergeInfo(s.cells, s.spans), ...Sel.lines(s.cells, s.rows, s.cols),
  };
}

// Posiciones (en el documento) de las celdas seleccionadas, de la última a la primera (así no se corren al cambiarlas).
function selCellPositions(s) {
  const start = s.tablePos + 1;
  const set = new Set();
  s.cells.forEach((k) => { const { r, c } = Sel.parseKey(k); if (r < s.rows && c < s.cols) set.add(start + s.map.map[r * s.cols + c]); });
  return [...set].sort((a, b) => b - a);
}

// Color de fondo y alineación de las celdas seleccionadas.
export function selApplyAttrs(editor, attrs) {
  const s = selState(editor);
  if (!s || !s.cells.size) return false;
  const clean = {};
  Object.entries(attrs).forEach(([k, v]) => { clean[k] = (k === 'align' && v === 'left') || (k === 'valign' && v === 'top') || (k === 'bg' && !BG_KEYS.includes(v)) ? null : v; });
  const tr = editor.state.tr;
  selCellPositions(s).forEach((pos) => { const n = tr.doc.nodeAt(pos); if (n) tr.setNodeMarkup(pos, null, { ...n.attrs, ...clean }); });
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

// Valores actuales (si todas las celdas coinciden) para marcar los botones del panel.
export function selCommonAttrs(editor) {
  const s = selState(editor);
  if (!s || !s.cells.size) return {};
  const out = {};
  ['align', 'valign', 'bg'].forEach((k) => {
    const vals = new Set(selCellPositions(s).map((p) => editor.state.doc.nodeAt(p)?.attrs[k] || null));
    out[k] = vals.size === 1 ? [...vals][0] : undefined;
  });
  out.align = out.align === undefined ? undefined : out.align || 'left';
  out.valign = out.valign === undefined ? undefined : out.valign || 'top';
  return out;
}

// Negrita, cursiva o subrayado en todo el texto de las celdas: si ya lo tiene todo, se quita; si no, se pone.
export function selToggleMark(editor, markName) {
  const s = selState(editor);
  const type = editor.schema.marks[markName];
  if (!s || !s.cells.size || !type) return null;
  const doc = editor.state.doc;
  const ranges = selCellPositions(s).map((p) => ({ from: p + 1, to: p + doc.nodeAt(p).nodeSize - 1 }));
  let any = false; let all = true;
  ranges.forEach(({ from, to }) => doc.nodesBetween(from, to, (n) => {
    if (!n.isText) return;
    any = true;
    if (!type.isInSet(n.marks)) all = false;
  }));
  if (!any) return 'empty';
  const tr = editor.state.tr;
  ranges.forEach(({ from, to }) => (all ? tr.removeMark(from, to, type) : tr.addMark(from, to, type.create())));
  editor.view.dispatch(tr);
  return all ? 'removed' : 'added';
}

// Borra el contenido (deja el formato de la celda: color y alineación).
export function selClear(editor) {
  const s = selState(editor);
  if (!s || !s.cells.size) return 0;
  const tr = editor.state.tr;
  const p0 = editor.state.schema.nodes.paragraph;
  let n = 0;
  selCellPositions(s).forEach((pos) => {
    const cell = tr.doc.nodeAt(pos);
    if (!cell) return;
    if (cell.childCount === 1 && cell.firstChild.type === p0 && !cell.firstChild.content.size) return;
    tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, p0.create());
    n++;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  return n;
}

// Texto de una celda: un renglón por párrafo (o casilla, o ítem de lista).
function cellText(node) {
  const parts = [];
  node.descendants((n) => { if (n.isTextblock) { parts.push(n.textContent); return false; } return true; });
  return parts.join('\n').replace(/\n+$/, '');
}

// "Portapapeles" de celdas de ANote: conserva el formato (negrita, color, alineación) al pegar dentro de la app.
// Si lo que hay en el portapapeles del sistema es lo mismo que se copió acá, se pega desde este.
let cellClip = null;
const normText = (t) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
export function getCellClip() { return cellClip; }

// Copia la selección como bloque ('block') o como lista ('list'). Devuelve el texto para el portapapeles del sistema.
export function selCopy(editor, mode = 'block') {
  const s = selState(editor);
  if (!s || !s.cells.size) return null;
  const layout = Sel.copyLayout(s.cells, mode);
  const node = ({ r, c }) => s.table.nodeAt(s.map.map[r * s.cols + c]);
  // Una celda combinada lleva su contenido en la casilla de arriba a la izquierda; las otras van vacías (como Excel).
  const covered = ({ r, c }) => { const sp = Sel.spanAt(s.spans, r, c); return !!sp && (sp.top !== r || sp.left !== c); };
  const texts = layout.map((row) => row.map((p) => (p && !covered(p) ? cellText(node(p)) : '')));
  const grid = layout.map((row) => row.map((p) => {
    if (!p) return null;
    const j = node(p).toJSON();
    return covered(p) ? { ...j, content: [{ type: 'paragraph' }] } : j;
  }));
  // Un valor con varios renglones va entre comillas (como Excel), para que siga siendo un solo valor.
  const text = Sel.toTSV(texts);
  const count = selCellPositions(s).length;
  cellClip = { text: normText(text), grid, mode, count, h: layout.length, w: layout[0]?.length || 0 };
  return { text, mode, count, h: cellClip.h, w: cellClip.w };
}

// Agrega columnas a la derecha y filas abajo hasta llegar a rows × cols. Sirve también con celdas combinadas (v0.3.8):
// las celdas que se agregan al final de cada fila caen en las primeras casillas libres, después de las tapadas.
function growTable(tr, tablePos, rows, cols, schema) {
  let table = tr.doc.nodeAt(tablePos);
  let map = TableMap.get(table);
  if (cols > map.width) {
    const headerRow = table.firstChild && Array.from({ length: table.firstChild.childCount }, (_, i) => table.firstChild.child(i)).every((c) => c.type.name === 'tableHeader');
    let manual = false;
    table.descendants((c) => { if (c.attrs.colwidth?.some((w) => w > 0)) manual = true; return c.type.name === 'tableRow'; });
    manual = manual && table.attrs.colMode !== 'auto';
    let rp = tablePos + 1; const ends = [];
    for (let r = 0; r < table.childCount; r++) { rp += table.child(r).nodeSize; ends.push(rp - 1); }
    for (let r = table.childCount - 1; r >= 0; r--) {
      const type = r === 0 && headerRow ? schema.nodes.tableHeader : schema.nodes.tableCell;
      const cells = [];
      for (let c = map.width; c < cols; c++) cells.push(type.createAndFill({ colwidth: manual ? [CELL_MIN * 2] : null }));
      tr.insert(ends[r], cells);
    }
    table = tr.doc.nodeAt(tablePos);
    map = TableMap.get(table);
  }
  if (rows > map.height) {
    let headerCol = true;
    table.forEach((row) => { if (row.firstChild?.type.name !== 'tableHeader') headerCol = false; });
    const last = table.lastChild;
    const newRows = [];
    // Cada celda nueva, con el ancho guardado de su columna (también si arriba hay una combinada; v0.3.8).
    const widths = columnWidths(table, map);
    for (let r = map.height; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < map.width; c++) {
        const cw = widths[c] ? [widths[c]] : null;
        cells.push((c === 0 && headerCol ? schema.nodes.tableHeader : schema.nodes.tableCell).createAndFill({ colwidth: cw }));
      }
      newRows.push(schema.nodes.tableRow.create({ ...last.attrs, height: null }, cells));
    }
    tr.insert(tablePos + table.nodeSize - 1, newRows);
  }
}

// Pega sobre la selección. text = lo que hay en el portapapeles del sistema (null = usar lo copiado en ANote).
// Devuelve { ok, reason?, plan, grew, fromClip, skipped } (reason: 'empty' | 'nosel').
export function selPaste(editor, text) {
  const s = selState(editor);
  if (!s || !s.cells.size) return { ok: false, reason: 'nosel' };
  const schema = editor.state.schema;
  const useClip = cellClip && (text == null || normText(text) === cellClip.text);
  let src;
  if (useClip) src = cellClip.grid.map((row) => row.map((j) => (j ? { json: j } : null)));
  else {
    const rows = Sel.parseTSV(text || '');
    src = rows.map((row) => row.map((v) => ({ text: v })));
  }
  // Con celdas combinadas, una selección que no es un rectángulo usa una casilla por celda (la de arriba a la izquierda).
  const plan = Sel.pastePlan(src, s.spans.length && !Sel.isRect(s.cells) ? Sel.anchorKeys(s.cells, s.spans) : s.cells);
  if (!plan.cells.length) return { ok: false, reason: 'empty', plan };
  const tr = editor.state.tr;
  let grew = false;
  if (plan.rows > s.rows || plan.cols > s.cols) {
    growTable(tr, s.tablePos, plan.rows, plan.cols, schema);
    grew = true;
  }
  const table = tr.doc.nodeAt(s.tablePos);
  const map = TableMap.get(table);
  const start = s.tablePos + 1;
  const para = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null);
  const jobs = new Map();
  // Un valor que cae en una casilla tapada por una celda combinada (no la de arriba a la izquierda) no se pega;
  // se cuenta (skipped) si es distinto del que va en esa celda.
  const dropped = [];
  plan.cells.forEach(({ r, c, v }) => {
    if (r >= map.height || c >= map.width) return;
    const rel = map.map[r * map.width + c];
    const cr = map.findCell(rel);
    if (cr.top !== r || cr.left !== c) { dropped.push([start + rel, v]); return; }
    jobs.set(start + rel, v);
  });
  const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const skipped = dropped.filter(([p, v]) => !same(jobs.get(p), v)).length;
  [...jobs.keys()].sort((a, b) => b - a).forEach((pos) => {
    const v = jobs.get(pos);
    const cell = tr.doc.nodeAt(pos);
    let content; let attrs = cell.attrs;
    if (v.json) {
      try {
        const n = schema.nodeFromJSON(v.json);
        content = n.content;
        attrs = { ...cell.attrs, align: n.attrs.align || null, valign: n.attrs.valign || null, bg: n.attrs.bg || null };
      } catch { content = null; }
    } else {
      const ls = String(v.text).split('\n');
      content = ls.map(para);
    }
    if (!content || content.size === 0) content = para('');
    tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, content);
    if (attrs !== cell.attrs) tr.setNodeMarkup(pos, null, attrs);
  });
  // Queda seleccionado lo que se pegó.
  const cells = Sel.normalizeSpans(new Set(plan.cells.map(({ r, c }) => Sel.cellKey(r, c))), tableSpans(table, map));
  const first = plan.cells[0];
  tr.setMeta(selKey, { tablePos: s.tablePos, cells, anchor: { r: first.r, c: first.c } });
  editor.view.dispatch(tr);
  return { ok: true, plan, grew, fromClip: useClip, skipped };
}

// Elimina las filas ('rows') o columnas ('cols') que toca la selección. Si son todas, elimina la tabla.
// También con celdas combinadas (v0.3.8).
export function selDeleteLines(editor, kind) {
  const s = selState(editor);
  if (!s || !s.cells.size) return { ok: false };
  const info = Sel.lines(s.cells, s.rows, s.cols);
  const list = kind === 'rows' ? info.rows : info.cols;
  const total = kind === 'rows' ? s.rows : s.cols;
  const tr = editor.state.tr;
  tr.setMeta(selKey, null);
  if (list.length >= total) {
    tr.delete(s.tablePos, s.tablePos + s.table.nodeSize);
    editor.view.dispatch(tr);
    return { ok: true, table: true, list };
  }
  // Desde la v0.3.8, con removeRow/removeColumn de prosemirror-tables, de la última a la primera y releyendo la tabla
  // cada vez: una celda combinada que cruza la fila o columna se achica (si empieza en la fila borrada, baja a la siguiente).
  const fn = kind === 'rows' ? removeRow : removeColumn;
  list.slice().sort((a, b) => b - a).forEach((i) => fn(tr, tableRectAt(tr.doc, s.tablePos), i));
  // El cursor queda en la tabla (al principio de la primera celda).
  const t = tr.doc.nodeAt(s.tablePos);
  if (t) tr.setSelection(TextSelection.near(tr.doc.resolve(s.tablePos + 2)));
  editor.view.dispatch(tr);
  return { ok: true, list };
}

/* ---------- Tablas: combinar y separar celdas (v0.3.7) ---------- */
// Celdas combinadas de la tabla como rectángulos inclusive { top, left, bottom, right } (para seleccion.js).
function tableSpans(table, map = TableMap.get(table)) {
  const out = []; const seen = new Set();
  map.map.forEach((p) => {
    if (seen.has(p)) return;
    seen.add(p);
    const r = map.findCell(p);
    if (r.right - r.left > 1 || r.bottom - r.top > 1) out.push({ top: r.top, left: r.left, bottom: r.bottom - 1, right: r.right - 1 });
  });
  return out;
}
const isMergedCell = (n) => !!n && (n.attrs.colspan > 1 || n.attrs.rowspan > 1);
const cellEmpty = (cell) => cell.childCount === 1 && cell.firstChild.isTextblock && cell.firstChild.childCount === 0;

// Combina el rectángulo R (inclusive, sin cortar combinadas) de la tabla en tablePos. Como Word y Google Docs:
// queda la celda de arriba a la izquierda (tipo, color y alineación) con el contenido de todas, una debajo de la otra
// (las vacías no suman renglones). Los anchos de las columnas se conservan en `colwidth`. Devuelve cuántas celdas se juntaron.
function mergeRectTr(tr, tablePos, R) {
  const table = tr.doc.nodeAt(tablePos);
  const map = TableMap.get(table);
  const start = tablePos + 1; const w = map.width;
  const widths = []; let anyW = false;
  for (let c = R.left; c <= R.right; c++) {
    const rel = map.map[R.top * w + c];
    const v = table.nodeAt(rel).attrs.colwidth?.[c - map.findCell(rel).left] || 0;
    widths.push(v);
    if (v) anyW = true;
  }
  const seen = new Set(); const others = [];
  let first = null;
  for (let r = R.top; r <= R.bottom; r++) {
    for (let c = R.left; c <= R.right; c++) {
      const rel = map.map[r * w + c];
      if (seen.has(rel)) continue;
      seen.add(rel);
      const cell = table.nodeAt(rel);
      if (!first) first = { rel, cell }; else others.push({ rel, cell });
    }
  }
  if (!first || !others.length) return 0;
  const extra = [];
  others.forEach(({ cell }) => { if (!cellEmpty(cell)) cell.content.forEach((n) => extra.push(n)); });
  // La de arriba a la izquierda es la primera del documento: se borran las otras de la última a la primera.
  others.slice().sort((a, b) => b.rel - a.rel).forEach(({ rel, cell }) => tr.delete(start + rel, start + rel + cell.nodeSize));
  const fpos = start + first.rel;
  if (extra.length) {
    if (cellEmpty(first.cell)) tr.replaceWith(fpos + 1, fpos + first.cell.nodeSize - 1, extra);
    else tr.insert(fpos + first.cell.nodeSize - 1, extra);
  }
  tr.setNodeMarkup(fpos, null, {
    ...first.cell.attrs, colspan: R.right - R.left + 1, rowspan: R.bottom - R.top + 1, colwidth: anyW ? widths : null,
  });
  return others.length + 1;
}

// Separa las celdas combinadas (posiciones relativas a la tabla). Como prosemirror-tables (splitCell): el contenido
// queda en la de arriba a la izquierda y las nuevas heredan el tipo, el color y la alineación; cada una con el ancho
// de su columna. Se recorren de la última a la primera (las inserciones quedan siempre después). Devuelve cuántas.
function splitCellsTr(tr, tablePos, rels) {
  let n = 0;
  [...new Set(rels)].sort((a, b) => b - a).forEach((rel) => {
    const table = tr.doc.nodeAt(tablePos);
    const map = TableMap.get(table);
    const start = tablePos + 1;
    const cell = table.nodeAt(rel);
    if (!isMergedCell(cell)) return;
    const R = map.findCell(rel);
    const cw = cell.attrs.colwidth;
    const base = { ...cell.attrs, colspan: 1, rowspan: 1 };
    const attrs = [];
    for (let i = 0; i < R.right - R.left; i++) attrs.push({ ...base, colwidth: cw && cw[i] ? [cw[i]] : null });
    const m0 = tr.mapping.maps.length;
    for (let row = R.top; row < R.bottom; row++) {
      let pos = map.positionAt(row, R.left, table);
      if (row === R.top) pos += cell.nodeSize;
      for (let col = R.left, i = 0; col < R.right; col++, i++) {
        if (row === R.top && col === R.left) continue;
        tr.insert(tr.mapping.slice(m0).map(start + pos, 1), cell.type.createAndFill(attrs[i]));
      }
    }
    tr.setNodeMarkup(start + rel, null, attrs[0]);
    n++;
  });
  return n;
}

// Modo selección: ¿se puede combinar o separar? { canMerge, canSplit, splitCount, rect, reason }.
export function selMergeInfo(editor) {
  const s = selState(editor);
  return s ? Sel.mergeInfo(s.cells, s.spans) : null;
}

export function selMerge(editor) {
  const s = selState(editor);
  if (!s) return { ok: false };
  const info = Sel.mergeInfo(s.cells, s.spans);
  if (!info.canMerge) return { ok: false, reason: info.reason };
  const tr = editor.state.tr;
  const n = mergeRectTr(tr, s.tablePos, info.rect);
  if (!n) return { ok: false, reason: 'Elegí dos celdas o más' };
  // Queda seleccionada la celda combinada (las mismas casillas).
  tr.setMeta(selKey, { tablePos: s.tablePos, cells: new Set(s.cells), anchor: { r: info.rect.top, c: info.rect.left } });
  editor.view.dispatch(tr);
  return { ok: true, count: n, rows: info.rect.bottom - info.rect.top + 1, cols: info.rect.right - info.rect.left + 1 };
}

export function selSplit(editor) {
  const s = selState(editor);
  if (!s) return { ok: false };
  const rels = [];
  s.cells.forEach((k) => {
    const { r, c } = Sel.parseKey(k);
    if (r >= s.rows || c >= s.cols) return;
    const rel = s.map.map[r * s.cols + c];
    if (isMergedCell(s.table.nodeAt(rel))) rels.push(rel);
  });
  if (!rels.length) return { ok: false, reason: 'No hay celdas combinadas en la selección' };
  const tr = editor.state.tr;
  const n = splitCellsTr(tr, s.tablePos, rels);
  // Quedan seleccionadas todas las celdas que salieron (las mismas casillas).
  tr.setMeta(selKey, { tablePos: s.tablePos, cells: new Set(s.cells), anchor: s.anchor });
  editor.view.dispatch(tr);
  return { ok: true, count: n };
}

// Fuera del modo selección: la celda del cursor o la selección rectangular hecha con el mouse.
function cursorRect(state) {
  const ctx = tableContext(state);
  if (!ctx) return null;
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    const r = ctx.map.rectBetween(sel.$anchorCell.pos - ctx.tableStart, sel.$headCell.pos - ctx.tableStart);
    return { ctx, R: { top: r.top, left: r.left, bottom: r.bottom - 1, right: r.right - 1 }, multi: true };
  }
  if (ctx.cellPos == null) return null;
  const r = ctx.rect;
  return { ctx, R: { top: r.top, left: r.left, bottom: r.bottom - 1, right: r.right - 1 }, multi: false };
}

export function cellMergeInfo(editor) {
  const x = editor && !editor.isDestroyed ? cursorRect(editor.state) : null;
  if (!x) return null;
  return { ...Sel.mergeInfo(new Set(Sel.rectKeys(x.R)), tableSpans(x.ctx.table, x.ctx.map)), multi: x.multi };
}

// Pone el cursor al final del contenido de la celda (relativa a la tabla).
function cursorInCell(tr, tablePos, rel) {
  const cell = tr.doc.nodeAt(tablePos + 1 + rel);
  if (cell) tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1 + rel + cell.nodeSize - 1), -1));
}

export function mergeCursor(editor) {
  const x = cursorRect(editor.state);
  if (!x) return { ok: false };
  const info = Sel.mergeInfo(new Set(Sel.rectKeys(x.R)), tableSpans(x.ctx.table, x.ctx.map));
  if (!info.canMerge) return { ok: false, reason: info.reason };
  const tr = editor.state.tr;
  const n = mergeRectTr(tr, x.ctx.tablePos, info.rect);
  if (!n) return { ok: false, reason: 'Elegí dos celdas o más' };
  const table = tr.doc.nodeAt(x.ctx.tablePos);
  const map = TableMap.get(table);
  cursorInCell(tr, x.ctx.tablePos, map.map[info.rect.top * map.width + info.rect.left]);
  editor.view.dispatch(tr);
  return { ok: true, count: n, rows: info.rect.bottom - info.rect.top + 1, cols: info.rect.right - info.rect.left + 1 };
}

export function splitCursor(editor) {
  const x = cursorRect(editor.state);
  if (!x) return { ok: false };
  const { ctx, R } = x;
  const rels = ctx.map.cellsInRect({ left: R.left, top: R.top, right: R.right + 1, bottom: R.bottom + 1 })
    .filter((rel) => isMergedCell(ctx.table.nodeAt(rel)));
  if (!rels.length) return { ok: false, reason: 'La celda no está combinada' };
  const tr = editor.state.tr;
  const n = splitCellsTr(tr, ctx.tablePos, rels);
  cursorInCell(tr, ctx.tablePos, Math.min(...rels));
  editor.view.dispatch(tr);
  return { ok: true, count: n };
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
    Tabla.configure({ resizable: true, cellMinWidth: CELL_MIN, lastColumnResizable: true, allowTableNodeSelection: false, HTMLAttributes: { class: 'nota-tabla' } }),
    Fila,
    CeldaEncabezado,
    Celda,
  ];
}

// Renglón final: si la nota termina en una tabla o una imagen, siempre queda un renglón vacío debajo
// para seguir escribiendo (en el celular no hay otra forma de poner el cursor después de la tabla).
const FIN_SIN_TEXTO = new Set(['table', 'image']);
export function needsTrailingParagraph(doc) {
  const last = doc.lastChild;
  return !!last && FIN_SIN_TEXTO.has(last.type.name);
}
const RenglonFinal = Extension.create({
  name: 'renglonFinal',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('renglonFinal'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null;
        // Solo ante cambios hechos en este dispositivo: si lo agregaran todos a la vez, al fusionarse quedarían varios renglones.
        if (trs.some((t) => t.getMeta(ySyncPluginKey)?.isChangeOrigin)) return null;
        if (!needsTrailingParagraph(state.doc)) return null;
        return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
      },
    })];
  },
});

// Al principio no se deja un renglón fijo (separaría el título de la tabla y saldría en la vista previa):
// se crea al tocar entre el título y la tabla, o con Enter en el título.
export function needsLeadingParagraph(doc) {
  const first = doc.firstChild;
  return !!first && FIN_SIN_TEXTO.has(first.type.name);
}
export function writeAtStart(editor) {
  const st = editor.state;
  const tr = st.tr;
  if (needsLeadingParagraph(st.doc)) tr.insert(0, st.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.atStart(tr.doc)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

// Tocar debajo del final de la nota: si termina en tabla o imagen, agrega el renglón y pone el cursor ahí.
export function writeAtEnd(editor) {
  const st = editor.state;
  const tr = st.tr;
  if (needsTrailingParagraph(st.doc)) tr.insert(st.doc.content.size, st.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.atEnd(tr.doc)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

// El contenido vive en el documento Yjs de la nota (fusión de cambios entre dispositivos).
export function createEditor(element, { ydoc, onUpdate, onState, onCreate, reminderIds, resolveImage }) {
  return new Editor({
    element,
    extensions: [
      ...contentExtensions({ resolveImage, reminderIds }),
      Placeholder.configure({ placeholder: 'Escribí tu nota…' }),
      PegarTablaTSV,
      RenglonFinal,
      SeleccionCeldas,
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
