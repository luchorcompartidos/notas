// Selección de celdas de una tabla (celdas sueltas, filas y columnas, o una mezcla).
// Funciones puras, sin ProseMirror: se pueden probar con node.
// Cada celda se identifica por "fila,columna" (desde 0).

export const cellKey = (r, c) => `${r},${c}`;
export function parseKey(k) { const i = k.indexOf(','); return { r: +k.slice(0, i), c: +k.slice(i + 1) }; }

// Celdas en orden de lectura (fila por fila, de izquierda a derecha).
export function readingOrder(keys) {
  return [...keys].map(parseKey).sort((a, b) => a.r - b.r || a.c - b.c);
}

// Rectángulo que encierra la selección (inclusive).
export function bounds(cells) {
  if (!cells.length) return null;
  let top = Infinity; let left = Infinity; let bottom = -1; let right = -1;
  cells.forEach(({ r, c }) => { top = Math.min(top, r); left = Math.min(left, c); bottom = Math.max(bottom, r); right = Math.max(right, c); });
  return { top, left, bottom, right };
}

// true si la selección es un rectángulo completo (todas las celdas de su recuadro).
export function isRect(keys) {
  const cells = readingOrder(keys);
  const b = bounds(cells);
  return !!b && cells.length === (b.bottom - b.top + 1) * (b.right - b.left + 1);
}

// Filas y columnas completas de la selección, y las que toca.
export function lines(keys, rows, cols) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const fullRows = []; const fullCols = []; const touchedRows = new Set(); const touchedCols = new Set();
  set.forEach((k) => { const { r, c } = parseKey(k); touchedRows.add(r); touchedCols.add(c); });
  for (let r = 0; r < rows; r++) {
    let all = true;
    for (let c = 0; c < cols && all; c++) if (!set.has(cellKey(r, c))) all = false;
    if (all && cols) fullRows.push(r);
  }
  for (let c = 0; c < cols; c++) {
    let all = true;
    for (let r = 0; r < rows && all; r++) if (!set.has(cellKey(r, c))) all = false;
    if (all && rows) fullCols.push(c);
  }
  const num = (a, b) => a - b;
  return { fullRows, fullCols, rows: [...touchedRows].sort(num), cols: [...touchedCols].sort(num) };
}

// Agrega (o quita, si ya está toda) una fila o columna entera.
export function toggleLine(keys, kind, index, rows, cols) {
  const set = new Set(keys);
  const list = [];
  if (kind === 'row') for (let c = 0; c < cols; c++) list.push(cellKey(index, c));
  else for (let r = 0; r < rows; r++) list.push(cellKey(r, index));
  const all = list.every((k) => set.has(k));
  list.forEach((k) => (all ? set.delete(k) : set.add(k)));
  return set;
}

// Agrega el rectángulo entre dos celdas.
export function addRange(keys, a, b) {
  const set = new Set(keys);
  for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) set.add(cellKey(r, c));
  }
  return set;
}

export function allKeys(rows, cols) {
  const set = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) set.add(cellKey(r, c));
  return set;
}

export function invertKeys(keys, rows, cols) {
  const set = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const k = cellKey(r, c); if (!keys.has(k)) set.add(k); }
  return set;
}

// Forma de lo copiado.
// - 'block': bloque con las filas y columnas que tienen algo seleccionado (las que no tienen nada se saltean,
//   como en Excel); las celdas sin seleccionar dentro del bloque quedan como huecos (null).
// - 'list': un valor por renglón, en orden de lectura (una sola columna).
// Devuelve una grilla de { r, c } | null.
export function copyLayout(keys, mode) {
  const cells = readingOrder(keys);
  if (mode === 'list') return cells.map((p) => [p]);
  const set = new Set(keys);
  const rows = [...new Set(cells.map((p) => p.r))].sort((a, b) => a - b);
  const cols = [...new Set(cells.map((p) => p.c))].sort((a, b) => a - b);
  return rows.map((r) => cols.map((c) => (set.has(cellKey(r, c)) ? { r, c } : null)));
}

// Texto separado por tabulaciones (lo que entienden Excel, Google Sheets y LibreOffice).
// Un valor con tabulación, salto de línea o comillas va entre comillas (las comillas internas se duplican).
export function toTSV(grid) {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return grid.map((row) => row.map(q).join('\t')).join('\n');
}

// Lee texto separado por tabulaciones (con comillas como las pone Excel). Sin tabulaciones, cada renglón es un valor.
export function parseTSV(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = []; let row = []; let cur = ''; let i = 0; let quoted = false; let fieldStart = true;
  while (i < t.length) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cur += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cur += ch; i++; continue;
    }
    if (ch === '"' && fieldStart) { quoted = true; fieldStart = false; i++; continue; }
    if (ch === '\t') { row.push(cur); cur = ''; fieldStart = true; i++; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; fieldStart = true; i++; continue; }
    cur += ch; fieldStart = false; i++;
  }
  if (cur !== '' || row.length || !fieldStart) { row.push(cur); rows.push(row); }
  // Sin el renglón vacío del final (Excel siempre agrega un salto de línea al copiar).
  while (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => { const out = r.slice(); while (out.length < w) out.push(''); return out; });
}

// Dónde va cada valor al pegar. src: grilla de valores (null = hueco, no se pega). keys: la selección.
// Reglas:
//  - Selección de una sola celda: el bloque se pega desde ahí (a la derecha y hacia abajo).
//  - Un solo valor sobre varias celdas: se repite en todas.
//  - Selección rectangular: el bloque se pega desde su esquina; si el rectángulo es un múltiplo exacto
//    del bloque, lo repite hasta llenarlo (como Excel).
//  - Selección salteada: los valores se pegan en orden de lectura (sobran o faltan → se avisa).
// Devuelve { cells: [{ r, c, v }], rows, cols, used, total, mode } (rows/cols = tamaño mínimo que necesita la tabla).
export function pastePlan(src, keys) {
  const sel = readingOrder(keys);
  const h = src.length; const w = h ? Math.max(...src.map((r) => r.length)) : 0;
  const out = [];
  const values = [];
  src.forEach((row) => row.forEach((v) => { if (v != null) values.push(v); }));
  let mode;
  if (!sel.length || !values.length) return { cells: [], rows: 0, cols: 0, used: 0, total: values.length, mode: 'none' };
  if (values.length === 1 && sel.length > 1) {
    mode = 'fill';
    sel.forEach(({ r, c }) => out.push({ r, c, v: values[0] }));
  } else if (sel.length === 1 || isRect(keys)) {
    const b = bounds(sel);
    const sh = b.bottom - b.top + 1; const sw = b.right - b.left + 1;
    const tile = sel.length > 1 && sh % h === 0 && sw % w === 0;
    mode = tile ? 'tile' : 'anchor';
    const th = tile ? sh : h; const tw = tile ? sw : w;
    for (let i = 0; i < th; i++) {
      for (let j = 0; j < tw; j++) {
        const v = src[i % h]?.[j % w];
        if (v != null) out.push({ r: b.top + i, c: b.left + j, v });
      }
    }
  } else {
    mode = 'order';
    const n = Math.min(sel.length, values.length);
    for (let i = 0; i < n; i++) out.push({ r: sel[i].r, c: sel[i].c, v: values[i] });
  }
  let rows = 0; let cols = 0;
  out.forEach(({ r, c }) => { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); });
  return { cells: out, rows, cols, used: mode === 'order' ? out.length : values.length, total: values.length, targets: sel.length, mode };
}

// Letra de columna como en las planillas: 0 → A, 25 → Z, 26 → AA.
export function colName(c) {
  let s = ''; let n = c + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Texto corto para mostrar una lista de números: "2, 4 y 7" (o "1 a 5").
export function listText(nums, fmt = (n) => String(n + 1)) {
  if (!nums.length) return '';
  const contiguous = nums.every((n, i) => !i || n === nums[i - 1] + 1);
  if (contiguous && nums.length > 2) return `${fmt(nums[0])} a ${fmt(nums[nums.length - 1])}`;
  const t = nums.map(fmt);
  return t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`;
}
