// Exportar tablas con celdas combinadas (combinar celdas, Parte D, v0.3.9).
// Correr: bash pruebas/exportar/correr.sh pruebas/exportar/combinadas.mjs
import { writeFileSync } from 'node:fs';
import { tableRows, tableGeom, toText, toMarkdown, toDocx, toPdf, toWhatsApp } from './transfer.js';

const OUT = process.env.OUT || '/tmp/exp-salida';
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FALLA:', msg); } else console.log('  ok:', msg); };

const p = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] });
// Celda: 'texto' o { t, cs, rs, w: [..], bg, h (encabezado), al, va }
const cell = (x) => {
  const o = typeof x === 'string' ? { t: x } : x;
  const lines = String(o.t ?? '').split('\n');
  return {
    type: o.h ? 'tableHeader' : 'tableCell',
    attrs: { colspan: o.cs || 1, rowspan: o.rs || 1, colwidth: o.w || null, bg: o.bg || null, align: o.al || null, valign: o.va || null },
    content: lines.map(p),
  };
};
const table = (rows, attrs = {}, heights = []) => ({
  type: 'table', attrs: { colMode: null, ...attrs },
  content: rows.map((r, i) => ({ type: 'tableRow', attrs: { height: heights[i] || null }, content: r.map(cell) })),
});

// T1: encabezado combinado a lo ancho, una combinada a lo alto y una de 2 × 2. Manual (todas con ancho).
const t1 = table([
  [{ t: 'Encabezado A+B', cs: 2, h: 1, w: [90, 120], al: 'center' }, { t: 'C', h: 1, w: [80] }, { t: 'D', h: 1, w: [70] }],
  ['a1', { t: 'b1', w: [120] }, { t: 'Alta (2 filas)', rs: 2, w: [80], bg: 'yellow', va: 'middle' }, { t: 'd1', w: [70] }],
  [{ t: 'a2', w: [90] }, { t: 'b2', w: [120] }, { t: 'd2', w: [70] }],
  [{ t: 'Bloque 2×2\ncon dos renglones', cs: 2, rs: 2, w: [90, 120], bg: 'blue' }, { t: 'c3', w: [80] }, { t: 'd3', w: [70] }],
  [{ t: 'c4', w: [80] }, { t: 'd4', w: [70] }],
].map((r, i) => (i === 1 ? r.map((c) => (typeof c === 'string' ? { t: c, w: [90] } : c)) : r)));

// T2: Automático con un texto largo combinado a lo ancho (no tiene que ensanchar solo la primera columna).
const t2 = table([
  ['x', 'y', 'z'],
  [{ t: 'Un texto bastante largo que abarca las tres columnas de la tabla automática', cs: 3 }],
  ['1', '2', '3'],
], { colMode: 'auto' });

// T3: fila sin celdas propias (cubierta entera por combinadas a lo alto).
const t3 = table([
  [{ t: 'Izq', rs: 2 }, { t: 'Der', rs: 2 }],
  [],
  ['abajo 1', 'abajo 2'],
]);

// T4: una combinada a lo alto de 30 filas con mucho texto (más alta que una página): se corta entre páginas.
const many = Array.from({ length: 90 }, (_, i) => `Renglón largo número ${i + 1} de la celda combinada`).join('\n');
const t4rows = [[{ t: many, rs: 30 }, 'fila 1']];
for (let i = 2; i <= 30; i++) t4rows.push([`fila ${i}`]);
t4rows.push(['después', 'fin']);
const t4 = table(t4rows);

console.log('Grilla (tableRows):');
const g1 = tableRows(t1);
ok(g1.length === 5 && g1.every((r) => r.length === 4), 'T1 es de 5 × 4');
ok(g1[0][1]?.covered && g1[0][1].by === g1[0][0], 'T1: la casilla (0,1) la tapa el encabezado combinado');
ok(g1[2][2]?.covered && g1[2][2].by === g1[1][2], 'T1: la (2,2) la tapa la combinada a lo alto');
ok(g1[2][3]?.blocks && g1[2][3].c === 3, 'T1: d2 cae en la columna 3 (después de la tapada)');
ok(g1[4][0]?.covered && g1[4][1]?.covered && g1[4][2]?.c === 2, 'T1: en la última fila, c4 cae en la columna 2');
const geom1 = tableGeom(t1);
ok(geom1.cols === 4 && geom1.mode === 'manual' && geom1.px.join() === '90,120,80,70', `T1: geometría ${geom1.px.join()}`);
const g3 = tableRows(t3);
ok(g3.length === 3 && g3[1].every((s) => s?.covered), 'T3: la fila vacía queda toda tapada');

console.log('txt y md:');
const note = { title: 'Combinadas', json: { type: 'doc', content: [p('Tabla 1'), t1, p('Tabla 2'), t2, p('Tabla 3'), t3, p('Tabla 4'), t4, p('Fin')] } };
const txt = toText(note); const md = toMarkdown(note);
writeFileSync(`${OUT}/combinadas.txt`, txt); writeFileSync(`${OUT}/combinadas.md`, md);
ok(txt.includes('Encabezado A+B |  | C | D'), 'txt: el encabezado combinado va en la primera casilla y la segunda vacía');
ok(txt.includes('a2 | b2 |  | d2'), 'txt: la casilla tapada por la combinada a lo alto va vacía y d2 en su columna');
ok(md.includes('| Encabezado A+B |  | C | D |'), 'md: encabezado combinado');
ok(md.includes('| :---: | --- | --- | --- |'), 'md: la alineación del encabezado es la de la celda real');
ok(md.includes('| a2 | b2 |  | d2 |'), 'md: casilla tapada vacía');
ok(md.includes('| Bloque 2×2<br>con dos renglones |  | c3 | d3 |') && md.includes('|  |  | c4 | d4 |'), 'md: bloque 2 × 2');
const wa = toWhatsApp(note);
ok(wa.includes('*Encabezado A+B* |  | *C* | *D*'), 'WhatsApp: encabezado en negrita y casilla tapada vacía (sin "**")');
console.log(txt.split('\n').slice(0, 14).join('\n'));

console.log('docx:');
const docx = await toDocx([note]);
writeFileSync(`${OUT}/combinadas.docx`, Buffer.from(await docx.arrayBuffer()));
ok(docx.size > 1000, `docx generado (${docx.size} bytes)`);

console.log('PDF:');
const pdf = await toPdf([note]);
writeFileSync(`${OUT}/combinadas.pdf`, Buffer.from(await pdf.arrayBuffer()));
ok(pdf.size > 1000, `PDF generado (${pdf.size} bytes)`);
const pdfTxt = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
const pages = (pdfTxt.match(/\/Type \/Page[^s]/g) || []).length;
ok(pages === 3, `PDF de 3 páginas (la combinada de T4 se corta entre la 1 y la 3): ${pages}`);

console.log(fails ? `${fails} FALLAS` : 'Todo bien');
process.exit(fails ? 1 : 0);
