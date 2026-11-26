import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import * as E from './editor.js';
const cellAttrs = { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, align: { default: null }, valign: { default: null }, bg: { default: null } };
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*' },
  table: { group: 'block', content: 'tableRow+', tableRole: 'table', isolating: true, attrs: { colMode: { default: null } } },
  tableRow: { content: '(tableCell | tableHeader)*', tableRole: 'row', attrs: { height: { default: null } } },
  tableCell: { content: 'block+', tableRole: 'cell', isolating: true, attrs: cellAttrs },
  tableHeader: { content: 'block+', tableRole: 'header_cell', isolating: true, attrs: cellAttrs },
}});
// grid: arreglo de filas; cada celda 'txt' o {t, cs, rs, w:[..], bg}
export function mk(grid, tableAttrs = {}) {
  const rows = grid.map((row) => schema.nodes.tableRow.create(null, row.map((c) => {
    const o = typeof c === 'string' ? { t: c } : c;
    return schema.nodes.tableCell.create({ colspan: o.cs || 1, rowspan: o.rs || 1, colwidth: o.w || null, bg: o.bg || null }, schema.nodes.paragraph.create(null, o.t ? schema.text(o.t) : null));
  })));
  const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('x')), schema.nodes.table.create(tableAttrs, rows), schema.nodes.paragraph.create()]);
  return doc;
}
export function editorFor(doc) {
  const ed = { schema, isDestroyed: false, state: EditorState.create({ doc, schema, plugins: E.__t.selPlugins() }) };
  ed.view = { dispatch(tr) { ed.state = ed.state.apply(tr); }, focus() {}, nodeDOM: () => null };
  ed.chain = () => { const c = new Proxy({}, { get: (t, k) => (k === 'run' ? () => true : () => c) }); return c; };
  return ed;
}
const TP = 3; // posición de la tabla (después del párrafo 'x')
export function show(ed) {
  const t = ed.state.doc.nodeAt(TP);
  const m = TableMap.get(t);
  const out = [];
  for (let r = 0; r < m.height; r++) {
    const line = [];
    for (let c = 0; c < m.width; c++) {
      const rel = m.map[r * m.width + c]; const cr = m.findCell(rel); const n = t.nodeAt(rel);
      line.push(cr.top === r && cr.left === c ? `${n.textContent || '·'}${n.attrs.colspan > 1 || n.attrs.rowspan > 1 ? `[${n.attrs.colspan}x${n.attrs.rowspan}]` : ''}${n.attrs.colwidth ? '{' + n.attrs.colwidth.join(',') + '}' : ''}` : '^');
    }
    out.push(line.join(' | ') + (t.child(r).attrs.height ? `  (h${t.child(r).attrs.height})` : ''));
  }
  return out.join('\n');
}
export function cursorIn(ed, r, c) {
  const t = ed.state.doc.nodeAt(TP); const m = TableMap.get(t);
  const pos = TP + 1 + m.map[r * m.width + c] + 2;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}
export function select(ed, keys) { E.__t.setSelForTest(ed, { tablePos: TP, cells: new Set(keys), anchor: null }); }
export function check(ed) { const t = ed.state.doc.nodeAt(TP); t.check(); const m = TableMap.get(t); if (m.problems) throw new Error('problems ' + JSON.stringify(m.problems)); }
export { E, schema };
