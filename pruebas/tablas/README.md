# Banco de pruebas de tablas

Prueba las funciones de tabla de `src/editor.js` con **ProseMirror real**, sin `npm install` (en el entorno de Claude no hay red para npm, pero sí `git clone` desde GitHub y un `esbuild` instalado en `/opt/npm-tools`).

- `correr.sh <prueba.mjs>`: baja una vez el código fuente de ProseMirror (model, state, transform, view, keymap, tables y sus dependencias) a `/tmp/pm`, copia `editor.js` y `seleccion.js`, y arma el paquete con esbuild. Las extensiones de Tiptap y `y-prosemirror` se reemplazan por `stub.mjs` (no hacen nada); el plugin de la selección de celdas sí funciona.
- `base.mjs`: esquema parecido al de ANote (tabla con `colMode`, fila con `height`, celdas con `colwidth`, `align`, `valign`, `bg`), `mk(grilla)` para armar una tabla (`'texto'` o `{ t, cs, rs, w: [..], bg }`), `editorFor(doc)` (editor de mentira), `show(ed)` (dibuja la grilla: `^` = casilla tapada, `[2x1]` = combinada, `{60,70}` = anchos), `cursorIn(ed, r, c)`, `select(ed, ['r,c', …])` y `check(ed)` (corta si la tabla quedó mal formada para `TableMap`).
- `combinadas.mjs`: casos de la Parte C de combinar celdas (v0.3.8): eliminar filas y columnas, insertar y duplicar, pegar agrandando y ordenar.

Ojo: las versiones de ProseMirror que se bajan son las últimas de GitHub, no exactamente las del `package.json` (las funciones que se usan no cambiaron). En una tabla de prueba con anchos, todas las celdas tienen que tener `colwidth`; si no, `TableMap` avisa "colwidth mismatch".
