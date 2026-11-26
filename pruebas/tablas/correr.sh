#!/bin/bash
# Banco de pruebas de las funciones de tabla de src/editor.js con ProseMirror real (sin npm install).
# Uso (desde la raíz del repo): bash pruebas/tablas/correr.sh pruebas/tablas/combinadas.mjs
# Baja el código fuente de ProseMirror desde GitHub (una vez, a /tmp/pm) y arma el paquete con el esbuild del entorno.
set -e
REPO=$(cd "$(dirname "$0")/../.." && pwd)
PRUEBA=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
PM=/tmp/pm; W=/tmp/pm-prueba
ESB=${ESBUILD:-$(command -v esbuild || ls /opt/npm-tools/node_modules/esbuild/bin/esbuild 2>/dev/null)}
[ -x "$ESB" ] || { echo "Falta esbuild"; exit 1; }
mkdir -p $PM
for r in ProseMirror/prosemirror-model ProseMirror/prosemirror-state ProseMirror/prosemirror-transform ProseMirror/prosemirror-view ProseMirror/prosemirror-keymap ProseMirror/prosemirror-tables marijnh/orderedmap marijnh/w3c-keyname; do
  n=${r#*/}; [ -d $PM/$n ] || git clone --depth 1 -q https://github.com/$r $PM/$n
done
rm -rf $W && mkdir -p $W && cp "$(dirname "$0")"/*.mjs $W/ && cp "$PRUEBA" $W/ && cp $REPO/src/editor.js $REPO/src/seleccion.js $W/
# Funciones internas de editor.js que usan las pruebas.
echo 'export const __t = { selPlugins: () => SeleccionCeldas.cfg.addProseMirrorPlugins(), mergeRectTr, splitCellsTr, growTable, columnWidths, tableSpans, setSelForTest: (editor, v) => setSel(editor, v) };' >> $W/editor.js
A=""
for p in model state transform view keymap; do f=$PM/prosemirror-$p/src/index.ts; [ -f $f ] || f=$PM/prosemirror-$p/src/$p.ts; A="$A --alias:prosemirror-$p=$f"; done
A="$A --alias:prosemirror-tables=$PM/prosemirror-tables/src/index.ts --alias:orderedmap=$PM/orderedmap/index.js --alias:w3c-keyname=$PM/w3c-keyname/index.js"
A="$A --alias:@tiptap/pm/tables=$PM/prosemirror-tables/src/index.ts --alias:@tiptap/pm/state=$PM/prosemirror-state/src/index.ts --alias:@tiptap/pm/view=$PM/prosemirror-view/src/index.ts"
for m in @tiptap/core @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-image @tiptap/extension-placeholder @tiptap/extension-collaboration @tiptap/extension-link @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-header @tiptap/extension-table-cell y-prosemirror; do A="$A --alias:$m=$W/stub.mjs"; done
"$ESB" "$W/$(basename "$PRUEBA")" --bundle --platform=node --format=esm --outfile=$W/salida.mjs --log-level=error --ignore-annotations $A
node $W/salida.mjs
