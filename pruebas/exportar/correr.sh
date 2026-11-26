#!/bin/bash
# Prueba de src/transfer.js (exportar a txt, md, docx y PDF) con las bibliotecas reales, sin npm install.
# Uso (desde la raíz del repo): bash pruebas/exportar/correr.sh pruebas/exportar/combinadas.mjs
# docx sale de /opt/npm-tools; jsPDF (dist ya compilado) y fflate se bajan de GitHub a /tmp/exp-libs (una vez).
# Deja los archivos en /tmp/exp-salida (docx, pdf, txt, md) para mirarlos (pdftoppm, python-docx, soffice).
set -e
REPO=$(cd "$(dirname "$0")/../.." && pwd)
PRUEBA=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
L=/tmp/exp-libs; W=/tmp/exp-prueba; OUT=/tmp/exp-salida
ESB=${ESBUILD:-$(command -v esbuild || ls /opt/npm-tools/node_modules/esbuild/bin/esbuild 2>/dev/null)}
[ -x "$ESB" ] || { echo "Falta esbuild"; exit 1; }
mkdir -p $L $OUT
[ -d $L/jsPDF ] || git clone --depth 1 -q https://github.com/parallax/jsPDF $L/jsPDF
[ -d $L/fflate ] || git clone --depth 1 -q https://github.com/101arrowz/fflate $L/fflate
rm -rf $W && mkdir -p $W && cp "$PRUEBA" $W/
# transfer.js sin native.js (como dice DESARROLLO.md: isNative = false).
sed "s#^import { isNative } from './native.js';#const isNative = false;#" $REPO/src/transfer.js > $W/transfer.js
echo 'export const decode = () => { throw new Error("png"); }; export const encode = decode; export default { decode, encode };' > $W/fastpng.mjs
A="--alias:jspdf=$L/jsPDF/dist/jspdf.node.js --alias:fflate=$L/fflate/src/index.ts --alias:fast-png=$W/fastpng.mjs"
A="$A --alias:docx=/opt/npm-tools/node_modules/docx --external:canvg --external:dompurify --external:html2canvas --external:mammoth --external:pdfjs-dist --external:@capacitor/*"
NODE_PATH=/opt/npm-tools/node_modules "$ESB" "$W/$(basename "$PRUEBA")" --bundle --platform=node --format=esm --outfile=$W/salida.mjs --log-level=error $A
cd $W && OUT=$OUT node salida.mjs
