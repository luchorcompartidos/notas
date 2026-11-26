// Casos de la Parte C de combinar celdas (v0.3.8). Correr: bash pruebas/tablas/correr.sh pruebas/tablas/combinadas.mjs
import { mk, editorFor, show, E, cursorIn, select, check } from './base.mjs';
const T = (name, fn) => { try { fn(); } catch (e) { console.log('ERROR', name, e.stack); } };
const H = (s) => console.log('\n## ' + s);

H('1 eliminar fila 0 con combinada vertical que empieza ahí');
T('1', () => { const ed = editorFor(mk([[{t:'A',rs:2},'B','C'],['D','E'],['F','G','H']])); console.log(show(ed)); select(ed, ['0,1']); console.log(JSON.stringify(E.selDeleteLines(ed,'rows'))); check(ed); console.log(show(ed)); });
H('1b eliminar fila 1 (dentro de la combinada)');
T('1b', () => { const ed = editorFor(mk([[{t:'A',rs:2},'B','C'],['D','E'],['F','G','H']])); select(ed, ['1,1']); E.selDeleteLines(ed,'rows'); check(ed); console.log(show(ed)); });
H('1c eliminar filas 0 y 2 (combinada 3 alto)');
T('1c', () => { const ed = editorFor(mk([[{t:'A',rs:3},'B'],['C'],['D'],['E','F']])); select(ed, ['0,1','2,1']); E.selDeleteLines(ed,'rows'); check(ed); console.log(show(ed)); });
H('2 eliminar columna 0 con combinada horizontal y anchos');
T('2', () => { const ed = editorFor(mk([[{t:'A',cs:2,w:[100,50]},{t:'B',w:[80]}],[{t:'C',w:[100]},{t:'D',w:[50]},{t:'E',w:[80]}]])); select(ed, ['1,0']); E.selDeleteLines(ed,'cols'); check(ed); console.log(show(ed)); });
H('2b eliminar columnas 0 y 1 (la combinada entera)');
T('2b', () => { const ed = editorFor(mk([[{t:'A',cs:2},'B'],['C','D','E']])); select(ed, ['1,0','1,1']); E.selDeleteLines(ed,'cols'); check(ed); console.log(show(ed)); });
H('2c combinada 2x2 en el medio, eliminar columna 1 y fila 1');
T('2c', () => { const ed = editorFor(mk([['a',{t:'M',cs:2,rs:2},'b'],['c','d'],['e','f','g','h']])); select(ed, ['2,1']); E.selDeleteLines(ed,'cols'); check(ed); console.log(show(ed)); select(ed, ['1,0']); E.selDeleteLines(ed,'rows'); check(ed); console.log(show(ed)); });

H('3 insertar fila copiada dentro de una combinada vertical');
T('3', () => { const ed = editorFor(mk([[{t:'A',rs:3},'B'],['C'],['D']])); cursorIn(ed,0,1); E.copyTablePart(ed,'row'); E.insertCopied(ed,'after'); check(ed); console.log(show(ed)); });
H('3b duplicar fila con combinada horizontal');
T('3b', () => { const ed = editorFor(mk([[{t:'A',cs:2,bg:'yellow'},'B'],['C','D','E']])); cursorIn(ed,0,0); E.duplicateTablePart(ed,'row'); check(ed); console.log(show(ed)); });
H('3c duplicar fila 1 cruzada por combinada que empieza arriba (cursor en fila 1, combinada termina en fila 1)');
T('3c', () => { const ed = editorFor(mk([[{t:'A',rs:2},'B'],['C'],['D','E']])); cursorIn(ed,1,1); E.duplicateTablePart(ed,'row'); check(ed); console.log(show(ed)); });
H('3d insertar columna copiada (con combinada vertical) a la derecha, tabla manual');
T('3d', () => { const ed = editorFor(mk([[{t:'A',rs:2,w:[90]},{t:'B',w:[60]}],[{t:'C',w:[60]}],[{t:'D',w:[90]},{t:'E',w:[60]}]])); cursorIn(ed,0,0); E.copyTablePart(ed,'col'); cursorIn(ed,0,1); E.insertCopied(ed,'after'); check(ed); console.log(show(ed)); });
H('3e insertar columna en medio de combinada horizontal');
T('3e', () => { const ed = editorFor(mk([[{t:'A',cs:2,w:[50,70]},{t:'B',w:[40]}],[{t:'C',w:[50]},{t:'D',w:[70]},{t:'E',w:[40]}]])); cursorIn(ed,1,0); E.copyTablePart(ed,'col'); E.insertCopied(ed,'after'); check(ed); console.log(show(ed)); });
H('3f insertar fila copiada arriba de todo con encabezado de otra tabla');
T('3f', () => { const ed = editorFor(mk([['a','b'],['c','d']])); cursorIn(ed,1,0); E.copyTablePart(ed,'row'); E.insertCopied(ed,'before'); check(ed); console.log(show(ed)); });

H('4 pegar agrandando con combinadas');
T('4', () => { const ed = editorFor(mk([[{t:'A',rs:2},'B'],['C']])); select(ed, ['1,1']); const r = E.selPaste(ed, '1\t2\n3\t4'); console.log(JSON.stringify({ok:r.ok, grew:r.grew, skipped:r.skipped})); check(ed); console.log(show(ed)); });
H('4b pegar agrandando: combinada en la última columna (tapa la fila de abajo)');
T('4b', () => { const ed = editorFor(mk([['a',{t:'M',rs:2}],['b'],['c','d']])); select(ed, ['2,0']); const r = E.selPaste(ed, '1\t2\t3\n4\t5\t6'); console.log(JSON.stringify({ok:r.ok, grew:r.grew, skipped:r.skipped})); check(ed); console.log(show(ed)); });

H('5 ordenar con combinada horizontal');
T('5', () => { const ed = editorFor(mk([[{t:'z',cs:2},'q'],['a','b','c'],['m','n','o']])); cursorIn(ed,1,0); console.log(JSON.stringify(E.sortTable(ed,'asc','text'))); check(ed); console.log(show(ed)); });
H('5b ordenar con combinada vertical');
T('5b', () => { const ed = editorFor(mk([[{t:'z',rs:2},'q'],['b'],['m','n']])); cursorIn(ed,2,0); console.log(JSON.stringify(E.sortTable(ed,'asc','text'))); });


T('fila vacía tapada, borrar fila 0', () => { const ed = editorFor(mk([[{t:'A',cs:2,rs:2}],[],['c','d']])); check(ed); select(ed,['0,0','0,1','1,0','1,1']); console.log(JSON.stringify(E.selectionInfo(ed).rows)); E.selDeleteLines(ed,'rows'); check(ed); console.log(show(ed)); });
T('fila vacía tapada, borrar solo fila 1 (selección cell 2,0 => no). borrar col 1', () => { const ed = editorFor(mk([[{t:'A',cs:2,rs:2}],[],['c','d']])); select(ed,['2,1']); E.selDeleteLines(ed,'cols'); check(ed); console.log(show(ed)); });
T('pegar agrandando tabla manual con combinada', () => { const ed = editorFor(mk([[{t:'A',cs:2,w:[60,70]}],[{t:'b',w:[60]},{t:'c',w:[70]}]])); select(ed,['1,1']); E.selPaste(ed,'1\t2\n3\t4'); check(ed); console.log(show(ed)); });
T('fila copiada con alto', () => { const ed = editorFor(mk([['a','b'],['c','d']])); const t=ed.state.doc.nodeAt(3); ed.view.dispatch(ed.state.tr.setNodeMarkup(4, null, {height: 80})); cursorIn(ed,0,0); E.copyTablePart(ed,'row'); cursorIn(ed,1,0); E.insertCopied(ed,'after'); check(ed); console.log(show(ed)); });
T('combinar después de borrar', () => { const ed = editorFor(mk([['a','b','c'],['d','e','f']])); select(ed,['0,0','0,1','1,0','1,1']); console.log(JSON.stringify(E.selMerge(ed))); select(ed,['0,2']); E.selDeleteLines(ed,'cols'); check(ed); console.log(show(ed)); select(ed,['1,0']); E.selDeleteLines(ed,'rows'); check(ed); console.log(show(ed)); });
