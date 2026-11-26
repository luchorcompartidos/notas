# DESARROLLO — ANote... (Notas)

> Archivo para retomar el trabajo en un chat nuevo.
> Uso: *"Seguimos con ANote (repo notas), <pedido>. Leé `DESARROLLO.md` del repo luchorcompartidos/notas."*
> Guía de dispositivos viejos: `plantilla/APK-DISPOSITIVOS-VIEJOS.md` del repo **home** (no está en este repo; se lee con `git clone --depth 1 https://github.com/luchorcompartidos/home`).
> Estructura según `plantilla/DESARROLLO.md` del repo home. Lo viejo va resumido en "Historial".
> Al cerrar cada etapa: actualizar secciones 1, 2, 3 y 7, y subir el archivo al repo.

---

## 1. Ficha rápida
| Campo | Valor |
|---|---|
| App | ANote... (Notas) |
| Repo | luchorcompartidos/notas |
| URL publicada | https://luchorcompartidos.github.io/notas/ |
| Tipo | Web + Android (Capacitor, un solo código) |
| Estado | En uso |
| Última versión (Release) | v0.2.7 — 2026-11-26 |
| Se conecta con | Firebase, proyecto **notas-pro-2026** (plan gratuito Spark; Firestore en modo producción) |
| Dispositivos viejos (Android 5/6) | **Sí, hecho**: aplicar `plantilla/APK-DISPOSITIVOS-VIEJOS.md` del repo home en cada cambio. Partes 1 (v0.2.1), 2 (v0.2.2) y 3 (v0.2.6) cerradas: un solo APK anda en el celular, la tablet Android 6.0.1 y la Bangho (Android 5.0) |

## 2. Etapa actual
**Sin etapa en curso.** La selección de celdas (v0.2.7) la probó el usuario el 2026-11-26 y anda bien dentro del alcance de su prueba; si aparece algo con el uso, lo reporta.
- Último trabajo: selección de celdas sueltas, filas y columnas, con copiar/cortar (bloque o lista), pegar, formato y eliminar (detalle en las secciones 4 y 6, "Selección de celdas").
- Dispositivos viejos: Partes 1, 2 y 3 cerradas (v0.2.6 probada con éxito en la Bangho con Android 5.0).

## 3. Próximos pasos
1. Corregir lo que el usuario reporte de la selección de celdas con el uso.
2. Confirmar en la Bangho (Android 5.0), si no se probó todavía: inicio de sesión con Google, sincronización, recordatorios y exportar PDF (Play services de Android 5 no se actualiza desde 2024).
3. Pruebas pendientes en el celular y en la tablet Android 6: inicio de sesión con Google, exportar/enviar PDF o docx, escribir arriba/debajo de una tabla, recordatorios, sincronización.
4. Tablas, más adelante (si se pide): combinar celdas; exportar anchos/altos al PDF y docx; arrastrar con el dedo para seleccionar un rango.
5. Opcional: App Links (sección 5), si el usuario lo quiere.

## 4. Decisiones tomadas
- **Un solo código** para la web y Android (Capacitor), con el aspecto lo más parecido posible en las dos, que en Android se sienta nativa. Backend gratis (Firebase Spark) y hosting en GitHub.
- **Fusión de cambios:** no alcanza con "gana la última versión". Cada nota es un documento Yjs.
- **Contenido compartido, organización personal:** carpetas, etiquetas, color, fijada, archivo, papelera, oculta y orden son de cada usuario (`users/{uid}/meta`). El texto, las imágenes y el historial son de la nota.
- **Nombre:** "ANote..." con puntos suspensivos. En el logo (`BRAND` en `main.js`) va la **A** violeta en negrita, la **N** en negrita del color del texto y "ote..." en letra normal. El ícono de la app no se cambia.
- **Textos de menú elegidos por el usuario:** "Compartir Acceso → Invitar Usuario", "Copiar (o Enviar) Link", "Enviar… (a través de →)", "Exportar y Descargar…" y "Estadísticas e Info de la nota".
- **Notas ocultas** (v0.1.1):
  - Faltan **solo** en la pantalla principal de Notas. En carpetas, etiquetas, archivo, recordatorios, compartidas y búsqueda aparecen con "[Oculta]".
  - La búsqueda las muestra por defecto y tiene el filtro "Excluir ocultas".
  - El listado "Notas ocultables" incluye por defecto **todas** las notas, cada una como Oculta o Visible.
  - "Quitar del listado" deja la nota visible y la saca del listado (`unlisted: true`); "Restaurar listado" vuelve a incluir todas.
- **Título automático** (v0.1.2), en el menú lateral, debajo de "Plazo de la papelera":
  - Se aplica **solo** a una nota nueva (`c.isNew`) que se cierra sin título y con contenido (en `closeSession`). Las notas existentes no cambian.
  - Modos: primera frase, prefijo, o prefijo + primera frase (se concatenan tal cual, respetando los espacios del final del prefijo).
  - Primera frase: hasta el primer punto seguido de espacio o fin, o el primer salto de línea, lo que aparezca antes; sin tope de largo (`firstPhrase`).
  - Se guarda en `settings/prefs`: `autoTitleOn`, `autoTitleMode` (`phrase`/`prefix`/`both`), `autoTitlePrefix`. Sin cambio de reglas.
- **Links de nota:** por ahora abren la web (`#/nota/<id>?o=<dueño>`). Si quien abre el link no tiene acceso, puede "Solicitar acceso" y el dueño lo aprueba o lo rechaza.
- **Tablas** (2026-11-25): se hicieron por partes: A en v0.1.3, B1 en v0.1.4 (ancho, alto, copiar/insertar copiada) y B2 en v0.2.0 (color de fondo, ordenar, menú al mantener apretado; Release **Minor** por elección del usuario). Combinar celdas queda fuera por ahora.
- **Color de fondo de celda:** se guarda la *clave* de la paleta (`bg`: yellow, orange, …), no el color, para que cambie con el tema claro/oscuro. Colores sólidos en CSS (sin `color-mix`).
- **Ordenar números:** formato argentino primero: "1.234,56" = 1234,56; "12,5" = 12,5; un solo punto con exactamente 3 cifras después es separador de miles ("1.234" = 1234); "1.5" = 1,5. Se ignoran $, % y espacios.
- **Renglón final** (v0.2.3): si la nota termina en una tabla o una imagen, siempre queda un renglón vacío debajo, para poder poner el cursor después (en el celular no había forma salvo desde el panel). Se agrega solo ante cambios hechos en el dispositivo (no ante los que llegan de otro), y además tocar debajo del final de la nota lo crea y pone el cursor. "Escribir arriba/debajo de la tabla" también está en el menú de la celda (primeras dos opciones) y reutiliza un renglón vacío que ya esté al lado, en vez de agregar otro.
- **Renglón inicial** (v0.2.4): arriba **no** queda un renglón fijo (separaría el título de la tabla y saldría en la vista previa de la tarjeta). Si la nota empieza con una tabla o una imagen, el renglón se crea al tocar entre el título y la tabla (la tabla del principio tiene 24 px de margen arriba para que se pueda tocar) o con Enter en el título.
- **Tablas y dispositivos viejos:** en las tablas no se usa CSS ni JavaScript más nuevo que el que ya usa el resto de la app, para no sumar requisitos a la etapa del APK para Android 5/6.
- **Dispositivos viejos (Android 5/6)** (2026-11-25):
  - **Un solo APK para todos** (no dos como en Flutter), siempre que no perjudique en nada al APK de los celulares actuales. Es posible porque el APK no tiene partes nativas por arquitectura y Capacitor 7 acepta bajar el mínimo desde `variables.gradle`.
  - Mínimo de WebView: **Chromium 94** (por `es2022`). No se baja el `target` de la web: en Android 5 la última WebView es la 95 y en Android 6 la 106.
  - Lo que falta en esas WebView se resuelve con **respaldos que solo se activan donde falta la función** (`@supports not`, detección de funciones), para que la web y el celular sigan exactamente igual.
  - **Bibliotecas fijadas para Android 5.0 (v0.2.2):** `firebase-auth` 22.3.1 (`firebaseAuthVersion` en `variables.gradle`, desde `ci.yml`) y `@capacitor/filesystem` 7.0.1 (versión exacta en `package.json`); Cordova se acepta con `tools:overrideLibrary`. `@capacitor/status-bar` se corrige en `patch-android.py` (v0.2.6). **No actualizar** esas dos versiones sin revisar que la nueva no pida más que API 21. Afectan también al APK de los celulares, pero sin cambio visible (la parte nativa de la autenticación solo trae la credencial de Google y la de archivos solo escribe en la caché).
- **Selección de celdas** (v0.2.7):
  - Es una selección **propia** (un conjunto de celdas "fila,columna" de una tabla), no la de ProseMirror, que solo admite un rectángulo. Se marca en pantalla con decoraciones: no se guarda en la nota ni se sincroniza.
  - Mientras se selecciona no hay cursor ni teclado: tocar una celda la suma o la quita. Se eligió así para que en el celular se pueda tocar celdas sueltas sin abrir el teclado.
  - **Copiar como bloque:** se toman las filas y columnas que tienen algo seleccionado, una al lado de la otra (las que no tienen nada se saltean, como en Excel); las celdas sin seleccionar dentro del bloque quedan vacías. Ej.: A1 y C3 → bloque de 2 × 2 con dos huecos. **Como lista:** un valor por renglón, en orden de lectura. Modo por defecto en `settings/prefs.cellCopyMode` (`block` por defecto, o `list`); el otro siempre en el menú.
  - Se copia como texto separado por tabulaciones (lo que entienden Excel, Sheets y LibreOffice; con comillas si un valor tiene varios renglones). Dentro de ANote se conserva además el formato (negrita, color, alineación): si el texto del portapapeles es el mismo que se copió en ANote, se pega desde la copia interna.
  - **Pegar:** sobre una sola celda, el bloque desde ahí (agrega filas y columnas si no alcanzan, salvo con celdas combinadas); un solo valor sobre varias celdas, en todas; sobre un rectángulo múltiplo exacto del bloque, lo repite (como Excel); sobre un rectángulo, desde su esquina; sobre celdas salteadas, en orden de lectura (avisa si sobran o faltan). Los huecos de un bloque copiado en ANote no pisan la celda de destino. Queda seleccionado lo pegado.
  - **Eliminar** borra las filas (o columnas) que toca la selección; si son todas, la tabla.
- **Versiones:** cada pedido define el tipo de Release (la mayoría Patch; la v0.1.0 y la v0.2.0 fueron Minor; las tablas Parte A y B1 fueron Patch por elección del usuario). Si hay otras preguntas pendientes, el tipo de Release se pregunta al final; si no, se avanza con Patch y se avisa el número.

## 5. Pendientes / dudas abiertas
- [x] **APK para dispositivos viejos:** Partes 1 (v0.2.1), 2 (v0.2.2) y 3 (v0.2.6) hechas. Un solo APK con mínimo Android 5.0; probado en la Bangho (Android 5.0) y la tablet Android 6.0.1.
- [x] **Selección de celdas (v0.2.7):** probada por el usuario el 2026-11-26, sin errores dentro del alcance de su prueba.
- [ ] **App Links (opcional)**: hoy, al tocar un link de una nota ("Copiar (o Enviar) Link") en el celular, se abre la web en el navegador; con App Links Android lo abriría directo en la app ANote. Android solo lo permite si el sitio `luchorcompartidos.github.io` publica un archivo que "autorice" a la app, y ese archivo tiene que estar en la raíz del sitio, que corresponde al repo especial `luchorcompartidos.github.io` (no al repo notas). Requiere que el usuario cree el repo vacío `luchorcompartidos.github.io` (Claude no puede crear repos). Después hay que subir ahí `.well-known/assetlinks.json` con el paquete `io.github.luchorcompartidos.notas` y el SHA-256 de la firma: `F3:CC:EE:75:71:9A:9E:A6:13:FD:C2:0E:30:33:49:48:C3:1A:0C:67:77:60:B4:97:B5:C5:9C:3F:E3:AD:3B:D9`. Además hay que agregar en `patch-android.py` el intent-filter `autoVerify` para `https://luchorcompartidos.github.io/notas/`.
- **Limitaciones conocidas:**
  - **Sin notificaciones push:** con la app cerrada no llegan los pedidos de acceso, ni las invitaciones, ni los recordatorios creados en otro dispositivo; se ven y se programan al abrir la app. Hacerlo requiere el plan Blaze (Cloud Functions + FCM).
  - **El bloqueo con huella no cifra:** solo oculta el contenido en la interfaz.
  - **Imágenes en copias:** una nota copiada referencia las imágenes de la original.
  - **`.anote` en Android:** algunos exploradores muestran "Abrir con…" la primera vez, y ANote... aparece también para algunos archivos genéricos.
  - **Vista previa de links en la web:** depende de microlink.io (se puede desactivar desde ⋮).
  - **Renglón final:** si dos dispositivos editan a la vez una nota que termina en tabla, al fusionarse pueden quedar dos renglones vacíos al final. Ese renglón vacío también sale en el PDF y el docx (no se nota).
  - **Selección de celdas:** se pierde al cerrar la nota; lo copiado en ANote (con formato) se pierde al cerrar la app (en el portapapeles del sistema queda el texto). Si otro dispositivo cambia la tabla mientras se selecciona, la selección sigue en las mismas posiciones (fila, columna). En una tabla con celdas combinadas no se agregan filas ni columnas al pegar, ni se eliminan. El rango se marca tocando dos celdas, no arrastrando el dedo (arrastrar desplaza la nota).
  - **Tablas:** en el celular el ancho se cambia desde el panel (− / +), no arrastrando el borde con el dedo. Los anchos y altos no se exportan: en el PDF las columnas salen del mismo ancho y en el docx las reparte Word. Lo copiado (fila o columna) se pierde al cerrar la app. Ordenar reemplaza la tabla entera: si otro dispositivo edita esa tabla al mismo tiempo, la fusión de cambios puede perder lo que haya escrito en las filas que se movieron.
  - **Sin probar en el dispositivo por Claude:** desde la v0.1.0 (vista compacta, link y pedidos de acceso, ocultas, estadísticas, título automático y tablas) las confirma el usuario.
  - **`package.json`** dice `"version": "0.0.12"`, pero la versión real sale de los tags: no se usa.

## 6. Datos técnicos clave

### Arquitectura
Vite 6 (target es2022, `base: './'`) + Capacitor 7. Todo el código de la app está en `src/`:

| Archivo | Qué hace |
|---|---|
| `main.js` (~3500 líneas) | Toda la interfaz. Contiene: `state`, lista (`renderList`, `cardEl`, `matchesFilter`, `matchesSearch`, `sortNotes`), editor (`openNote`, `closeSession`, `paintEditorChrome`, `updateToolbar`), tablas (`updateTableBar`, `bindTableBar`, `openTableUi`, `openInsertTableSheet`, `openTableSheet`, `tableUi`), menú lateral (`renderDrawer`), selectores (`openPicker`), recordatorios, compartir (`openShareSheet`, `openLinkSheet`, `openFromHash`, pedidos de acceso), enviar y exportar, historial, bloqueo, sincronización (`syncSummary`, `syncNow`, `flushPendingNotes`), vista compacta (`applyDensity`, `markClamped`, `updateMoreBelow`), ocultas (`hideNotes`, `showHiddenManager`) y estadísticas (`docStats`, `showNoteStats`) |
| `sync.js` | `NoteSession`: documento Yjs + y-indexeddb + `notes/{id}/updates`. Escucha con reintento, verifica contra el servidor (`verified`/`fromCache`), compacta (más de 40 updates → 1), `snapshot()`. Exporta `pendingList`, `flushNote`, `applyTextDiff` y `TRANSIENT` |
| `repo.js` | `CloudRepo` (Firestore) y `LocalRepo` (sin cuenta, IndexedDB), con la misma interfaz: notas, `setMeta`, `addToMeta`/`removeFromMeta` (arrayUnion/arrayRemove, para que se fusionen los cambios de carpetas y etiquetas), organización, ajustes, recordatorios, imágenes, versiones, compartir, invitaciones y pedidos de acceso. `META_DEFAULTS` define los campos personales |
| `editor.js` | Tiptap v2 con Collaboration (y-prosemirror). Incluye `TaskItemConId` (casillas con id estable y marca de recordatorio), `ImagenAparte` (`img:<nota>/<img>`), Link, tablas (`@tiptap/extension-table`, `Celda`/`CeldaEncabezado` con atributos `align` y `valign`, `PegarTablaTSV`, `tableContext`, `setCellsAttrs`, `insertTable`, `runTableCommand`), `summarize` (cuenta también `tables`), `makeThumb` y `compressImage` |
| `seleccion.js` | Funciones puras de la selección de celdas (sin ProseMirror, se prueban con node): `cellKey`/`parseKey`, `readingOrder`, `isRect`, `lines` (filas y columnas completas y tocadas), `toggleLine`, `addRange`, `copyLayout` (bloque o lista), `toTSV`/`parseTSV` (con comillas como Excel), `pastePlan` (reglas de pegado), `colName` (A, B, …, AA) y `listText` |
| `transfer.js` | Exportar a txt, md, docx (docx), pdf (jspdf) y `.anote`/json, con tablas (`tableRows`). Importar anote, json, md (con tablas GFM), txt, html, docx (mammoth) y pdf (pdfjs-dist). Además, WhatsApp, `shareFile` y `deliverFile` |
| `reminders.js` | Programación de recordatorios (Local Notifications en el APK, notificaciones del navegador en la web) y `formatWhen` |
| `links.js` | Vista previa de links: CapacitorHttp en el APK, microlink.io en la web |
| `lock.js` | Bloqueo con huella: WebAuthn en la web, plugin `Biometria` en el APK |
| `native.js` | Integración Android: intents (`IntentBridge`), barra de estado, háptica, `hideKeyboard` y portapapeles (`clipboardWrite`/`clipboardRead`: plugin `Portapapeles` en el APK, `navigator.clipboard` y `execCommand('copy')` en la web) |
| `firebase.js` | Inicio de sesión. En el APK usa `@capacitor-firebase/authentication` (`skipNativeAuth`, con respaldo de Credential Manager) más `signInWithCredential`, y `initializeAuth` con `indexedDBLocalPersistence` |
| `version.js` | Versión, fecha y Changelog desde las Releases, y aviso de versión nueva |
| `store.js`, `icons.js`, `styles.css` | Almacenamiento kv (IndexedDB), íconos Material en SVG en línea, y estilos Material 3 (claro y oscuro) |

**Tablas:** el contenido de la tabla vive en el documento Yjs como el resto (se fusiona entre dispositivos). La alineación se guarda en cada celda (`align`: center/right/justify; `valign`: middle/bottom; izquierda y arriba = `null`).
- **Ancho:** cada celda guarda `colwidth` (de prosemirror-tables). La tabla (`Tabla`, extensión de Table) tiene `colMode`: `'auto'` = `table-layout: auto`; `null` = fijo (Iguales si ninguna celda tiene `colwidth`, Manual si alguna tiene). En el editor la tabla se dibuja con `TableView`, que no copia atributos: por eso el modo se marca con una decoración (`tbl-auto` en `.tableWrapper`, plugin `tablaModo`). En las vistas sin editor sale como `data-cols="auto"`. El mismo plugin pasa la tabla a Manual si en Automático aparece un `colwidth` (arrastre con el mouse).
- **Alto:** `height` en cada fila (`Fila`, extensión de TableRow), con `style="height:Npx"`, funciona como mínimo.
- **Color de fondo:** atributo `bg` en `Celda`/`CeldaEncabezado` (`data-bg="<clave>"`), paleta `CELL_BG` en `editor.js`; los colores están en `styles.css` (claro y `[data-scheme="dark"]`) y, para exportar, en `CELL_BG_HEX` de `transfer.js` (si se cambia la paleta, cambiar los tres). Se aplica con `setCellsAttrs(editor, scope, { bg })`. Lo copiado (fila/columna) conserva el color.
- **Ordenar:** `sortTable(editor, dir, kind)` y `parseCellNumber(text)` en `editor.js`; arma la tabla con las filas en el nuevo orden (`replaceWith`) y deja el cursor en la misma columna, primera fila ordenada. En `main.js`, `doSort` (snackbar + Deshacer) y el grupo `#tbl-sort-group` del panel.
- **Renglón final:** extensión `RenglonFinal` (solo en `createEditor`, no en `contentExtensions`): `appendTransaction` que agrega un párrafo si `needsTrailingParagraph(doc)` (último nodo `table` o `image`) y la transacción no viene de otro dispositivo (`ySyncPluginKey` con `isChangeOrigin`). En `main.js`, un `click` en `#editor-scroll` por debajo del último elemento de `.ProseMirror` llama a `writeAtEnd` (agrega el párrafo si falta, cursor al final y `focus()`, que abre el teclado). `runTableCommand` `textBefore`/`textAfter` usan el párrafo vacío vecino si existe.
- **Renglón inicial:** `needsLeadingParagraph`/`writeAtStart` (editor.js). El mismo `click` de `#editor-scroll` llama a `writeAtStart` si se toca entre el título (`#note-title`) y el primer elemento de `.ProseMirror`. Enter en `#note-title` también (si no, `focus('start')`). CSS: `.ProseMirror > .tableWrapper:first-child { margin-top: 24px }`.
- **Menú de la celda:** `bindCellPress` (en `bindEditorUi`) escucha en `#editor` `touchstart`/`touchmove`/`touchend` (temporizador de 520 ms) y `contextmenu`; `placeCursorAt` (editor.js) ubica el cursor en la celda tocada (sin perder una selección de varias celdas); `openCellMenu` usa `openMenu` con un "ancla" falsa en el punto tocado y la clase `cell-menu`. Para que soltar el dedo no cierre el menú: `touchend` con `preventDefault` y el fondo (`#scrim`) ignora clics durante 400 ms (`cellMenuAt`).
- **Funciones** (`editor.js`): `tableSizes` (modos y medidas actuales con `nodeDOM`), `setColumnWidth`, `setColumnsMode`, `setRowHeight`, `setRowsMode`, `copyTablePart`, `insertCopied`, `duplicateTablePart` y `getTableClip`. Lo copiado se guarda como JSON (cada editor tiene su propio esquema) y se rearma con `schema.nodeFromJSON`. Las columnas se insertan con `TableMap.positionAt`, de la última fila a la primera. `#table-bar` está en `index.html`, arriba de `#toolbar`; la clase `in-table` en `#view-editor` agranda el margen inferior del editor.

**Selección de celdas** (v0.2.7):
- **Estado** (`editor.js`): plugin `SeleccionCeldas` (`selKey`, solo en `createEditor`) con `{ tablePos, cells: Set("r,c"), anchor }` o `null`. Se cambia con `tr.setMeta(selKey, …)`; ante otros cambios, `tablePos` se mapea (`assoc 1`) y si el cambio llega de otro dispositivo (y-prosemirror puede reemplazar todo el documento) primero se busca la tabla en la misma posición. Las celdas que quedan fuera de la tabla se descartan.
- **Decoraciones:** `tbl-selecting` en la tabla (el `.tableWrapper` gana relleno arriba y a la izquierda para las letras y números), `cell-sel` en cada celda (capa con `::after`) y `cell-anchor` (borde punteado con `::before`) en la última tocada.
- **Funciones** (`editor.js`): `selState`, `cellAtDom` (td/th → `{ tablePos, r, c }` con `posAtDOM`), `startSelection` (toma la celda del cursor y una `CellSelection` del mouse), `endSelection`, `updateSelection(op)` (`toggle`, `range`, `row`, `col`, `all`, `invert`, `none`), `selectionInfo` (`nRows`/`nCols` = tamaño de la tabla; `rows`/`cols` = las que toca), `selApplyAttrs`, `selCommonAttrs`, `selToggleMark`, `selClear`, `selCopy`, `selPaste` (con `growTable`) y `selDeleteLines`. Todas recorren las celdas de la última a la primera, para que las posiciones no se corran. `cellClip` guarda lo copiado como JSON de cada celda (null = hueco).
- **Interfaz** (`main.js`, bloque "Tablas: selección de celdas"): `beginSelection`/`finishSelection`, `updateSelBars` (llamado desde `updateTableBar`; con la clase `selecting` en `#view-editor` se oculta `#toolbar` con `visibility`, porque `#toolbar.hidden` significa "solo lectura"), `drawSelHandles` (botones `.sel-handle` en `#sel-handles`, dentro de `.editor-wrap` con `position: relative`; se redibujan en cada transacción, al desplazar la tabla de costado, al cambiar el tamaño y con `kbchange`), `openSelMenu`, `openSelFormatSheet`, `showCopyModeSettings`, `openPasteSheet` y `bindSelection`.
- **Toques:** en `#editor`, en fase de captura: `pointerdown` con `preventDefault` + `stopPropagation` (no pone el cursor ni abre el teclado, pero se puede desplazar), `mousedown` bloqueado (ProseMirror y la selección de prosemirror-tables) y `click` que suma o quita la celda. Mantener apretado (o clic derecho) usa `bindCellPress`: seleccionando, suma la celda y abre el menú de la selección.
- **Teclado (PC):** Escape, Supr/Retroceso, Ctrl + A/C/X/B/I/U; Ctrl + V usa el evento `paste` (trae el texto sin pedir permiso) y, si no llega en 250 ms, lee el portapapeles.
- HTML: `#sel-bar` (misma posición que `#table-bar`) y `#sel-actions` (misma posición que `#toolbar`) en `index.html`; botón `data-tbl="select"` en `#table-bar`.

**Android (`android-extra/`):**
- `res/`: ícono, splash, widget "Nota rápida", accesos directos y strings.
- `java/`:
  - `MainActivity` registra los plugins.
  - `IntentBridgePlugin` atiende SEND ("Compartir con…"), VIEW de `.anote` y las acciones del widget y de los accesos directos.
  - `NotaRapidaWidget` es el widget.
  - `BiometricPlugin` usa BiometricPrompt.
  - `PortapapelesPlugin` ("Portapapeles": `escribir({ texto })` y `leer()` → `{ texto, vacio }`) usa `ClipboardManager` (desde Android 3; sirve en Android 5). Existe porque la WebView no deja leer el portapapeles desde JavaScript.
  - `AnoteApp` (Application, `android:name` del `<application>`) instala en `attachBaseContext` un `UncaughtExceptionHandler`: ante un cierre por error de Java arma un informe (versión, Android/API, equipo, ABI, hilo y traza), abre `CierreActivity` y termina el proceso. No se instala en el proceso `:cierre` (lo detecta por `/proc/self/cmdline`).
  - `CierreActivity` corre en el proceso aparte `:cierre`, con tema `Theme.Material.Light` y vistas de Android puras (sin Capacitor ni AndroidX), y muestra el error con "Copiar", "Enviar…" y "Cerrar". No atrapa cierres nativos (de la WebView, por ejemplo).
- `patch-android.py` corre en cada compilación sobre el proyecto que genera `npx cap add android` (y corrige `node_modules/@capacitor/status-bar/.../StatusBar.java` para Android 5: si el plugin cambia y el texto a reemplazar ya no está, el CI corta con error). Agrega intent-filters (con los `pathPattern` de `.anote`), el receiver del widget, `android:name=".AnoteApp"` y `CierreActivity`, y la dependencia biometric.

**WebView viejas (Android 5/6):** al tocar CSS o JS, no usar nada que pida más de Chromium 94 sin respaldo. El APK tiene mínimo **Android 5.0 (API 21)**: si se agrega un plugin o una biblioteca nativa, verificar su `minSdk` (el CI corta con error si el APK no queda en `sdkVersion:'21'` y, si falla la compilación, lista las AAR con mínimo mayor). Si el APK se cierra en un Android viejo, la pantalla de `CierreActivity` muestra la función que falta (`NoSuchMethodError`); proteger esa llamada con `SDK_INT` (en un plugin, desde `patch-android.py`). La selección de celdas no usa nada nuevo (`inset`, `user-select` y eventos de puntero ya andan en Chromium 94); `color-mix` tiene respaldo en el bloque `@supports not` (`.cell-sel`, `.sel-handle.part`). Lo que ya tiene respaldo: `getRootWindowInsets` de `@capacitor/status-bar` (v0.2.6), `color-mix` y `:has` (bloques `@supports not` al final de `styles.css`, con las clases `editor-open` y `with-drag`), pdfjs (`legacy`), `allowWhileIdle` (`IDLE_OK`). El aviso de WebView vieja es el `<script>` ES5 de `index.html`. Para revisar un APK: `grep` en `assets/public/assets/*.js` de `structuredClone`, `Promise.withResolvers`, `findLast`, `toSorted`, `Object.groupBy`, `AbortSignal.any` (en el paquete principal no tiene que aparecer ninguno sin control).

**Web:** `public/manifest.webmanifest` (PWA, con `file_handlers` para `.anote`). El service worker lo genera un plugin de Vite en `vite.config.js` y precachea lo que pesa menos de 400 KB.

### Modelo de datos (Firestore)
- `notes/{id}`: `owner`, `memberIds`, `roles{uid}`, `members{uid:{name,email}}` y el resumen: `title`, `preview`, `text`, `checks`, `thumb`, `created`, `updated`, `updatedBy`, `updatedByName` y `legacy`.
  - `notes/{id}/updates/*`: bytes de Yjs.
  - `notes/{id}/images/*`: imágenes.
  - `notes/{id}/versions/*`: historial, una versión cada 10 minutos como máximo y las últimas 30.
- `users/{uid}/meta/{noteId}`: organización personal. Campos: `color`, `pinned`, `archived`, `trashed`, `trashedAt`, `folders[]`, `labels[]`, `order`, `locked`, `template`, `hidden`, `unlisted`.
- `users/{uid}/folders`, `labels`, `settings/prefs` (`sort`, `trashDays`, título automático, `cellCopyMode`) y `reminders`.
- `invites/{noteId}_{email}` y `accessRequests/{noteId}_{uid}`.
- **Reglas:** `firestore.rules`. **Cada vez que cambian, el usuario tiene que pegarlas en la consola de Firebase** (Firestore Database → Reglas → Publicar). La última vez que cambiaron fue en la v0.1.0 (`accessRequests`). Lo que se guarda en `users/{uid}/**` no necesita cambios de reglas. Las tablas no cambiaron reglas.

### Cómo se construye y se publica
`.github/workflows/ci.yml` corre en cada push a `main`:
1. Calcula la versión desde los tags según la marca del commit: `[patch]`, `[minor]`, `[major]` o `[skip release]`. También se puede lanzar a mano con *Run workflow*.
2. Compila la web y la publica en Pages (Settings → Pages → Source: GitHub Actions).
3. Para Android:
   - Corre `npx cap add android` y después `python3 android-extra/patch-android.py`.
   - Copia `config/google-services.json` y aplica `rgcfaIncludeGoogle`.
   - Firma con los Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` y `ANDROID_KEY_ALIAS` (la SHA-1 y la SHA-256 están registradas en Firebase).
   - Baja el mínimo a Android 5.0 (`minSdkVersion = 21`, `firebaseAuthVersion` y `overrideLibrary` de Cordova).
   - Corre `assembleRelease` y verifica con `aapt` que el APK diga `sdkVersion:'21'`.
4. Si el commit tiene marca, crea la Release con `notas-vX.Y.Z.apk` y el texto con la tabla "¿Qué archivo bajar?" (más las notas automáticas). Sin marca, el APK de prueba queda en Artifacts.
- Releases: según `ESTANDAR-VERSIONES.md` del repo home. Los cambios que no tocan la app (solo docs) van con `[skip release]`.

**En el entorno de Claude** no hay red para `npm install`, así que no se puede compilar ni probar localmente.
- Antes de subir, chequear la sintaxis con `cp src/x.js /tmp/x.mjs && node --check /tmp/x.mjs`.
- `seleccion.js` se prueba con node tal cual (no importa nada).
- `transfer.js` se puede probar con node cambiando la línea `import { isNative } …` por `const isNative = false;` en una copia.
- Después del push, esperar el run (API `actions/runs`) y bajar el APK de la Release.
- Verificar que los textos nuevos estén en `assets/public/assets/index-*.js`. Para manifest, intents y dex, con `aapt`/`unzip`.
- La GitHub API pública funciona con curl y el push funciona por el proxy de git. WebFetch no llega a `github.io`.
- Repos del usuario que no están adjuntos al chat (por ejemplo, `home` con las plantillas) se leen con `git clone --depth 1`.

### Trampas conocidas (ya resueltas; no repetir)
- **Capacitor:** nunca devolver un proxy de plugin desde una función `async` o desde una promesa. El proxy parece un "thenable" y se cuelga. Usar el namespace del módulo.
- **Inicio de sesión nativo:** el respaldo con Credential Manager se usa ante cualquier error que no sea una cancelación ("No credentials available").
- **Menús emergentes:** usar `placePopup`, que los ajusta al borde de la pantalla.
- **CSS:** existe un `[hidden]{display:none!important}` global, porque algunas reglas `display` pisaban `hidden`.
- **Panel inferior (sheet):** `#sheet-body` se reutiliza entre aperturas. Los eventos van en un contenedor interno que se reemplaza, no en `#sheet-body`, para que no se acumulen. Además, `openMenu` llama a `closeOverlays()`, que cierra también el panel: dentro de un panel, usar botones propios en vez de un menú. `#sheet` tiene alto máximo y desplazamiento propio (desde v0.1.3).
- **Tablas, medir antes de cambiar:** "Manual", "Iguales" (filas) y el ancho de una columna miden la tabla en pantalla. El panel se redibuja en el cuadro siguiente (`requestAnimationFrame`) para medir la tabla ya actualizada.
- **Tablas desde el panel:** los comandos se corren sin `focus()` (`runTableCommand(..., { focus: false })`), para que no se abra el teclado detrás del panel. Los botones de las barras usan `pointerdown` + `preventDefault` para no cerrar el teclado.
- **`deleteRow`/`deleteColumn`** no borran la última fila o columna: en ese caso se borra la tabla (`runTableCommand`).
- **`.anote` en `patch-android.py`:** cuidado con el doble escape de `pathPattern`.
- **`deploy-pages` a veces falla** con "No artifacts named github-pages were found" (problema pasajero de GitHub): se arregla con *Re-run failed jobs* (`gh run rerun <id> --failed`). Pasó en la v0.2.1.
- **Maven Central a veces devuelve 429** ("Too Many Requests") al bajar dependencias de Gradle: es pasajero. Se reintenta con *Re-run failed jobs* o con un commit vacío (`git commit --allow-empty`) con la marca de versión. Pasó en la v0.2.2.
- **`gh` no tiene sesión en el entorno de Claude:** los logs de un job se bajan sin login con `curl -sL https://api.github.com/repos/luchorcompartidos/notas/actions/jobs/<id>/logs`.
- **Plantilla `release.yml`:** al inicio, la de prueba-deploy chocaba con `ci.yml`. En este repo solo existe `ci.yml`.

## 7. Historial (resumido)
La tabla completa de versiones está en el `README.md`.

| Versión | Contenido |
|---|---|
| v0.0.1–v0.0.6 | Prueba de concepto: editor (formato, casillas, imágenes), inicio de sesión con Google en la web y en Android (nativo), sincronización con fusión de cambios, firma fija del APK |
| v0.0.7–v0.0.12 | Fases 1A a 5: carpetas multinivel, etiquetas, archivo, papelera con plazo, selección múltiple, búsqueda con filtros, orden manual, lista/cuadrícula, plantillas, recordatorios por nota y por casilla, compartir con roles, "Compartir con…", widget, accesos directos, web sin conexión, vista previa de links, imágenes aparte, historial de versiones, exportar/importar, bloqueo con huella |
| v0.0.13 | Enviar a WhatsApp |
| v0.0.14 | Sincronización reforzada (estado por nota, cola de pendientes, reintentos, sincronización manual, tirar para actualizar) |
| v0.1.0 | Marca "ANote...", vista compacta y estándar, contraer/expandir, flecha de "más notas", formato `.anote`, "Copiar (o Enviar) Link", pedidos de acceso |
| v0.1.1 | Ocultar notas (listado "Notas ocultables") y "Estadísticas e Info de la nota" |
| v0.1.2 | Título automático para notas nuevas sin título |
| v0.1.3 (2026-11-25) | Tablas, Parte A: insertar (grilla o − / +), barra y panel de tabla, filas y columnas, alineación, encabezados, duplicar/eliminar, pegar desde Excel/Sheets, exportar e importar tablas. DESARROLLO.md pasa a la estructura de la plantilla |
| v0.1.4 (2026-11-25) | Tablas, Parte B1: ancho de columnas (automático, iguales, manual con − / +), alto de filas (automático, iguales, manual), copiar e insertar filas y columnas con su contenido, duplicar fila o columna, botón «↔ Tamaño» |
| v0.2.0 (2026-11-25) | Tablas, Parte B2: color de fondo por celda/fila/columna/tabla (también en PDF y docx), ordenar filas por una columna (texto y números), menú al mantener apretada una celda (clic derecho en la PC), botón de color en la barra de tabla |
| v0.2.1 (2026-11-25) | Dispositivos viejos, Parte 1: web compatible con WebView de Android 5/6 (respaldos de `color-mix` y `:has`, pdfjs legacy, recordatorios sin cierre en Android 5, aviso de WebView vieja, Android/WebView en "Versión") |
| v0.2.2 (2026-11-25) | Dispositivos viejos, Parte 2: un solo APK con mínimo Android 5.0 (`minSdkVersion` 21, `firebase-auth` 22.3.1, `@capacitor/filesystem` 7.0.1, `overrideLibrary` de Cordova), verificación con `aapt` en el CI y tabla "¿Qué archivo bajar?" en la Release |
| v0.2.3 (2026-11-25) | Tablas: renglón vacío siempre debajo de una tabla (o imagen) al final de la nota, tocar debajo para escribir, y "Escribir arriba/debajo de la tabla" en el menú de la celda |
| v0.2.4 (2026-11-25) | Tablas: escribir arriba de una tabla que está al principio de la nota, tocando entre el título y la tabla o con Enter en el título |
| v0.2.5 (2026-11-25) | Atrapador de cierres: ante un cierre por error muestra el error con Copiar/Enviar (diagnóstico de la Bangho con Android 5.0) |
| v0.2.6 (2026-11-25) | Android 5.0: arreglo del cierre al abrir (`@capacitor/status-bar` usaba `getRootWindowInsets`, de Android 6). Probada con éxito en la Bangho el 2026-11-26 (cierre de la Parte 3) |
| v0.2.7 (2026-11-26) | Tablas: selección de celdas sueltas, filas y columnas (letras y números como en una planilla, rango, todo, invertir), con copiar/cortar como bloque o como lista (modo por defecto en el menú lateral), pegar (agrega filas y columnas si hace falta), color, alineación, negrita/cursiva/subrayado, borrar y eliminar filas o columnas. Plugin propio `Portapapeles` en el APK. Probada por el usuario el 2026-11-26 |
