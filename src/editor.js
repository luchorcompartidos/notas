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
function measureCol(editor, ctx, col, row = ctx.rect.top) {
  const p = ctx.map.map[row * ctx.map.width + col];
  const cell = ctx.table.nodeAt(p);
  const el = domAt(editor, ctx.tableStart + p);
  const w = el ? el.offsetWidth / (cell?.attrs.colspan || 1) : 0;
  const attr = cell?.attrs.colwidth?.[cell.attrs.colspan === 1 ? 0 : col - ctx.map.colCount(p)];
  return Math.round(w || attr || CELL_MIN);
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
    cells.push(table.nodeAt(p).toJSON());
  }
  tableClip = {
    kind, cells,
    index: (kind === 'row' ? rect.top : rect.left) + 1,
    rowAttrs: kind === 'row' ? { ...table.child(rect.top).attrs } : null,
  };
  return tableClip;
}

// Arma una celda nueva con el contenido copiado (o vacía) y el tipo/ancho del lugar donde va.
function makeCell(schema, json, type, colwidth) {
  let content = null; let align = null; let valign = null; let bg = null;
  if (json) {
    try {
      const src = schema.nodeFromJSON(json);
      content = src.content; align = src.attrs.align || null; valign = src.attrs.valign || null; bg = src.attrs.bg || null;
    } catch { content = null; }
  }
  const attrs = { colspan: 1, rowspan: 1, colwidth: colwidth || null, align, valign, bg };
  return (content && content.size ? type.create(attrs, content) : null) || type.createAndFill(attrs);
}

// Inserta la fila o columna copiada arriba/abajo (fila) o a la izquierda/derecha (columna) de la celda actual.
export function insertCopied(editor, where, { focus = true } = {}) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx || !tableClip) return false;
  const { map, table, tableStart, rect } = ctx;
  const s = st.schema;
  const tr = st.tr;
  if (tableClip.kind === 'row') {
    const ref = where === 'before' ? rect.top : rect.bottom - 1;
    const target = where === 'before' ? rect.top : rect.bottom;
    const cells = [];
    for (let c = 0; c < map.width; c++) {
      const refCell = table.nodeAt(map.map[ref * map.width + c]);
      const type = c === 0 && ctx.headerCol ? s.nodes.tableHeader : s.nodes.tableCell;
      const cw = refCell.attrs.colspan === 1 ? refCell.attrs.colwidth : null;
      cells.push(makeCell(s, tableClip.cells[c], type, cw));
    }
    const rowAttrs = { ...(tableClip.rowAttrs || {}) };
    tr.insert(rowPos(ctx, target), s.nodes.tableRow.create(rowAttrs, cells));
  } else {
    const t = where === 'before' ? rect.left : rect.right;
    // El ancho copiado se usa solo si la tabla de destino ya tiene anchos manuales.
    let manual = false;
    table.descendants((c) => { if (c.attrs.colwidth?.some((w) => w > 0)) manual = true; return c.type.name === 'tableRow'; });
    manual = manual && table.attrs.colMode !== 'auto';
    for (let r = map.height - 1; r >= 0; r--) {
      const type = r === 0 && ctx.headerRow ? s.nodes.tableHeader : s.nodes.tableCell;
      const json = tableClip.cells[r];
      const cw = manual && json?.attrs?.colwidth?.[0] ? [json.attrs.colwidth[0]] : null;
      tr.insert(tableStart + map.positionAt(r, t, table), makeCell(s, json, type, cw));
    }
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
// Devuelve { ok, moved, reason } (reason: 'merged' si hay celdas combinadas, 'few' si hay menos de 2 filas para ordenar).
export function sortTable(editor, dir = 'asc', kind = 'text', { focus = false } = {}) {
  const st = editor.state;
  const ctx = tableContext(st);
  if (!ctx) return { ok: false, reason: 'none' };
  const { table, map, tablePos, rect } = ctx;
  let merged = false;
  table.descendants((c) => { if (c.attrs.colspan > 1 || c.attrs.rowspan > 1) merged = true; return c.type.name === 'tableRow'; });
  if (merged) return { ok: false, reason: 'merged' };
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
