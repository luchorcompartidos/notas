# Prueba de exportar

Prueba `src/transfer.js` (exportar a txt, md, docx, PDF y WhatsApp) con las **bibliotecas reales**, sin `npm install`.

- `correr.sh <prueba.mjs>`: copia `transfer.js` con `const isNative = false;`, arma el paquete con el `esbuild` de `/opt/npm-tools` usando **docx** de `/opt/npm-tools` y **jsPDF** (el `dist` ya compilado de su repo de GitHub, con `fflate` también de GitHub; `fast-png` de mentira, así que no sirve para imágenes PNG) y lo corre con node. Deja los archivos en `/tmp/exp-salida`.
- `combinadas.mjs`: tablas con celdas combinadas (combinar celdas, Parte D, v0.3.9): grilla de `tableRows`, `tableGeom`, md, txt, WhatsApp, docx y un PDF con una combinada más alta que una hoja.

Para mirar lo exportado: `pdftoppm -r 60 -png combinadas.pdf p` (imágenes de cada hoja), `soffice --headless --convert-to pdf combinadas.docx` (cómo lo ve un procesador de texto), `unzip` y `word/document.xml` (`gridSpan`, `vMerge`, `tblHeader`) y `python3 -c "import mammoth; print(mammoth.convert_to_html(open('combinadas.docx','rb')).value)"` (cómo vuelve al importar).

Ojo: jsPDF del repo es la 4.x y la app usa la 2.5 (las funciones que se usan son las mismas).
