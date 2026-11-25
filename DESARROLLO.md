# DESARROLLO — ANote... (Notas)

> Archivo para retomar el trabajo en un chat nuevo.
> Uso: *"Seguimos con ANote (repo notas), <pedido>. Leé `DESARROLLO.md` del repo luchorcompartidos/notas."*
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
| Última versión (Release) | v0.2.1 — 2026-11-25 |
| Se conecta con | Firebase, proyecto **notas-pro-2026** (plan gratuito Spark; Firestore en modo producción) |
| Dispositivos viejos (Android 5/6) | **Sí**: aplicar `plantilla/APK-DISPOSITIVOS-VIEJOS.md` del repo home en cada cambio. Parte 1 hecha (v0.2.1, web compatible con WebView viejas); falta la Parte 2 (APK con mínimo Android 5) |

## 2. Etapa actual
**APK para dispositivos viejos (Android 5/6): Parte 1 hecha (v0.2.1). Sigue la Parte 2.**
- Objetivo: que ANote... se instale y ande en la tablet Android 6.0.1 (32 bits) y en la Bangho AERO J1216 (Android 5.0, Intel x86), sin perjudicar en nada el APK de los celulares actuales.
- Diagnóstico (2026-11-25), resumido:
  - **Instalar:** Capacitor 7 y todos sus plugins toman la versión mínima de `variables.gradle` (hoy 23 = Android 6). El APK actual **ya se instala en Android 6**. Para Android 5 hay que bajar `minSdkVersion` a 21; el código nativo de Capacitor 7 y de los plugins tiene sus `SDK_INT` cubiertos, salvo los recordatorios (ya resuelto en la Parte 1).
  - **Arquitectura:** el APK no tiene bibliotecas nativas (`lib/`): es **universal** (anda en armeabi-v7a y en x86, la Bangho lo corre sin traductor).
  - **WebView (lo principal):** la de fábrica de Android 5/6 (Chromium 37–44) no sirve. Actualizada desde Play Store llega a **Chromium 95** en Android 5 y **106** en Android 6. La web se compila con `es2022` (pide Chromium 94 o más).
  - **Inicio de sesión con Google:** Google Play services dejó de actualizarse en Android 5 en julio de 2024 (sigue en Android 6). El plugin prueba Credential Manager y, si falla, el método clásico (`play-services-auth` 20.7.0). Solo se sabe probando.
  - **Firebase nativo:** `@capacitor-firebase/authentication` 7.5 usa `firebase-auth` 23.1.0 (anterior al mínimo Android 6 de Firebase, julio de 2025). Si la compilación con mínimo 21 lo rechaza, se fija una versión anterior en `variables.gradle`.
- Hecho en la Parte 1 (v0.2.1):
  - **Colores:** bloque `@supports not (color: color-mix(...))` al final de `styles.css` con colores fijos de respaldo (barra del editor, barra de formato, chips, selección, banner, encabezado y celdas seleccionadas de tablas).
  - **`:has`:** bloque `@supports not selector(:has(a))` con clases: `body.editor-open` (la pone `setView`) para el snackbar del editor y `.card.with-drag` (la pone `cardEl`) para el margen de la tarjeta con orden manual.
  - **Importar PDF:** `pdfToHtml` usa la compilación `pdfjs-dist/legacy/build/` si faltan `Promise.withResolvers`, `structuredClone` o `AbortSignal.any`; si no, la moderna de siempre.
  - **Recordatorios:** `allowWhileIdle` solo en Android 6 o más (`IDLE_OK` en `reminders.js`, por el `userAgent`). En Android 5 el plugin usaba `setExactAndAllowWhileIdle` (Android 6+) y la app se cerraba.
  - **Aviso de WebView vieja:** script en ES5 en `index.html`, antes del módulo: si no hay `class static {}`, `.at()` u `Object.hasOwn`, oculta la app y muestra en español la versión de la WebView y un botón a Play Store ("Android System WebView").
  - **Versión (menú lateral):** muestra "Equipo: Android X · WebView Y" (o "Chrome Y" en la web de un celular).
  - Verificado en el APK de la Release: los dos bloques `@supports`, el aviso en `index.html` y los dos juegos de pdfjs (el APK pasó de 6,0 a 6,6 MB por la versión legacy, que solo se carga al importar un PDF en un equipo viejo).
- En curso: nada a medio hacer.

## 3. Próximos pasos
1. **El usuario prueba la v0.2.1:** en el celular que todo siga igual; en la **tablet Android 6** (este APK ya se instala ahí) con la WebView actualizada: abrir, iniciar sesión, sincronizar, crear un recordatorio, una tabla y "Versión" (que diga Android y WebView). Si la WebView es vieja, tiene que salir el aviso en español.
2. **Parte 2 (Patch):** un solo APK para todos con `minSdkVersion` 21 (decisión del usuario, sección 4): en `ci.yml`, `sed` de `minSdkVersion = 23` → `21` en `android/variables.gradle`; verificar que compile (si `firebase-auth` 23.1.0 lo rechaza, fijar `firebaseAuthVersion`), que el APK diga `minSdkVersion 21` y que nada más cambie para el celular. Texto de la Release con la tabla "¿Qué archivo bajar?" y la nota de la WebView.
3. **Parte 3:** prueba en la Bangho (Android 5) y correcciones.
4. Tablas, más adelante (si se pide): combinar celdas; exportar anchos/altos al PDF y docx.

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
- **Tablas y dispositivos viejos:** en las tablas no se usa CSS ni JavaScript más nuevo que el que ya usa el resto de la app, para no sumar requisitos a la etapa del APK para Android 5/6.
- **Dispositivos viejos (Android 5/6)** (2026-11-25):
  - **Un solo APK para todos** (no dos como en Flutter), siempre que no perjudique en nada al APK de los celulares actuales. Es posible porque el APK no tiene partes nativas por arquitectura y Capacitor 7 acepta bajar el mínimo desde `variables.gradle`.
  - Mínimo de WebView: **Chromium 94** (por `es2022`). No se baja el `target` de la web: en Android 5 la última WebView es la 95 y en Android 6 la 106.
  - Lo que falta en esas WebView se resuelve con **respaldos que solo se activan donde falta la función** (`@supports not`, detección de funciones), para que la web y el celular sigan exactamente igual.
- **Versiones:** cada pedido define el tipo de Release (la mayoría Patch; la v0.1.0 y la v0.2.0 fueron Minor; las tablas Parte A y B1 fueron Patch por elección del usuario). Si hay otras preguntas pendientes, el tipo de Release se pregunta al final; si no, se avanza con Patch y se avisa el número.

## 5. Pendientes / dudas abiertas
- [ ] **APK para dispositivos viejos:** diagnóstico y Parte 1 hechos (v0.2.1, ver sección 2). Esquema elegido: un solo APK. Pendiente: Partes 2 y 3.
- [ ] **App Links** (que el link de una nota abra la app en vez de la web). Requiere que el usuario cree el repo vacío `luchorcompartidos.github.io` (Claude no puede crear repos). Después hay que subir ahí `.well-known/assetlinks.json` con el paquete `io.github.luchorcompartidos.notas` y el SHA-256 de la firma: `F3:CC:EE:75:71:9A:9E:A6:13:FD:C2:0E:30:33:49:48:C3:1A:0C:67:77:60:B4:97:B5:C5:9C:3F:E3:AD:3B:D9`. Además hay que agregar en `patch-android.py` el intent-filter `autoVerify` para `https://luchorcompartidos.github.io/notas/`.
- **Limitaciones conocidas:**
  - **Sin notificaciones push:** con la app cerrada no llegan los pedidos de acceso, ni las invitaciones, ni los recordatorios creados en otro dispositivo; se ven y se programan al abrir la app. Hacerlo requiere el plan Blaze (Cloud Functions + FCM).
  - **El bloqueo con huella no cifra:** solo oculta el contenido en la interfaz.
  - **Imágenes en copias:** una nota copiada referencia las imágenes de la original.
  - **`.anote` en Android:** algunos exploradores muestran "Abrir con…" la primera vez, y ANote... aparece también para algunos archivos genéricos.
  - **Vista previa de links en la web:** depende de microlink.io (se puede desactivar desde ⋮).
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
| `transfer.js` | Exportar a txt, md, docx (docx), pdf (jspdf) y `.anote`/json, con tablas (`tableRows`). Importar anote, json, md (con tablas GFM), txt, html, docx (mammoth) y pdf (pdfjs-dist). Además, WhatsApp, `shareFile` y `deliverFile` |
| `reminders.js` | Programación de recordatorios (Local Notifications en el APK, notificaciones del navegador en la web) y `formatWhen` |
| `links.js` | Vista previa de links: CapacitorHttp en el APK, microlink.io en la web |
| `lock.js` | Bloqueo con huella: WebAuthn en la web, plugin `Biometria` en el APK |
| `native.js` | Integración Android: intents (`IntentBridge`), barra de estado y háptica |
| `firebase.js` | Inicio de sesión. En el APK usa `@capacitor-firebase/authentication` (`skipNativeAuth`, con respaldo de Credential Manager) más `signInWithCredential`, y `initializeAuth` con `indexedDBLocalPersistence` |
| `version.js` | Versión, fecha y Changelog desde las Releases, y aviso de versión nueva |
| `store.js`, `icons.js`, `styles.css` | Almacenamiento kv (IndexedDB), íconos Material en SVG en línea, y estilos Material 3 (claro y oscuro) |

**Tablas:** el contenido de la tabla vive en el documento Yjs como el resto (se fusiona entre dispositivos). La alineación se guarda en cada celda (`align`: center/right/justify; `valign`: middle/bottom; izquierda y arriba = `null`).
- **Ancho:** cada celda guarda `colwidth` (de prosemirror-tables). La tabla (`Tabla`, extensión de Table) tiene `colMode`: `'auto'` = `table-layout: auto`; `null` = fijo (Iguales si ninguna celda tiene `colwidth`, Manual si alguna tiene). En el editor la tabla se dibuja con `TableView`, que no copia atributos: por eso el modo se marca con una decoración (`tbl-auto` en `.tableWrapper`, plugin `tablaModo`). En las vistas sin editor sale como `data-cols="auto"`. El mismo plugin pasa la tabla a Manual si en Automático aparece un `colwidth` (arrastre con el mouse).
- **Alto:** `height` en cada fila (`Fila`, extensión de TableRow), con `style="height:Npx"`, funciona como mínimo.
- **Color de fondo:** atributo `bg` en `Celda`/`CeldaEncabezado` (`data-bg="<clave>"`), paleta `CELL_BG` en `editor.js`; los colores están en `styles.css` (claro y `[data-scheme="dark"]`) y, para exportar, en `CELL_BG_HEX` de `transfer.js` (si se cambia la paleta, cambiar los tres). Se aplica con `setCellsAttrs(editor, scope, { bg })`. Lo copiado (fila/columna) conserva el color.
- **Ordenar:** `sortTable(editor, dir, kind)` y `parseCellNumber(text)` en `editor.js`; arma la tabla con las filas en el nuevo orden (`replaceWith`) y deja el cursor en la misma columna, primera fila ordenada. En `main.js`, `doSort` (snackbar + Deshacer) y el grupo `#tbl-sort-group` del panel.
- **Menú de la celda:** `bindCellPress` (en `bindEditorUi`) escucha en `#editor` `touchstart`/`touchmove`/`touchend` (temporizador de 520 ms) y `contextmenu`; `placeCursorAt` (editor.js) ubica el cursor en la celda tocada (sin perder una selección de varias celdas); `openCellMenu` usa `openMenu` con un "ancla" falsa en el punto tocado y la clase `cell-menu`. Para que soltar el dedo no cierre el menú: `touchend` con `preventDefault` y el fondo (`#scrim`) ignora clics durante 400 ms (`cellMenuAt`).
- **Funciones** (`editor.js`): `tableSizes` (modos y medidas actuales con `nodeDOM`), `setColumnWidth`, `setColumnsMode`, `setRowHeight`, `setRowsMode`, `copyTablePart`, `insertCopied`, `duplicateTablePart` y `getTableClip`. Lo copiado se guarda como JSON (cada editor tiene su propio esquema) y se rearma con `schema.nodeFromJSON`. Las columnas se insertan con `TableMap.positionAt`, de la última fila a la primera. `#table-bar` está en `index.html`, arriba de `#toolbar`; la clase `in-table` en `#view-editor` agranda el margen inferior del editor.

**Android (`android-extra/`):**
- `res/`: ícono, splash, widget "Nota rápida", accesos directos y strings.
- `java/`:
  - `MainActivity` registra los plugins.
  - `IntentBridgePlugin` atiende SEND ("Compartir con…"), VIEW de `.anote` y las acciones del widget y de los accesos directos.
  - `NotaRapidaWidget` es el widget.
  - `BiometricPlugin` usa BiometricPrompt.
- `patch-android.py` corre en cada compilación sobre el proyecto que genera `npx cap add android`. Agrega intent-filters (con los `pathPattern` de `.anote`), el receiver del widget y la dependencia biometric.

**WebView viejas (Android 5/6):** al tocar CSS o JS, no usar nada que pida más de Chromium 94 sin respaldo. Lo que ya tiene respaldo: `color-mix` y `:has` (bloques `@supports not` al final de `styles.css`, con las clases `editor-open` y `with-drag`), pdfjs (`legacy`), `allowWhileIdle` (`IDLE_OK`). El aviso de WebView vieja es el `<script>` ES5 de `index.html`. Para revisar un APK: `grep` en `assets/public/assets/*.js` de `structuredClone`, `Promise.withResolvers`, `findLast`, `toSorted`, `Object.groupBy`, `AbortSignal.any` (en el paquete principal no tiene que aparecer ninguno sin control).

**Web:** `public/manifest.webmanifest` (PWA, con `file_handlers` para `.anote`). El service worker lo genera un plugin de Vite en `vite.config.js` y precachea lo que pesa menos de 400 KB.

### Modelo de datos (Firestore)
- `notes/{id}`: `owner`, `memberIds`, `roles{uid}`, `members{uid:{name,email}}` y el resumen: `title`, `preview`, `text`, `checks`, `thumb`, `created`, `updated`, `updatedBy`, `updatedByName` y `legacy`.
  - `notes/{id}/updates/*`: bytes de Yjs.
  - `notes/{id}/images/*`: imágenes.
  - `notes/{id}/versions/*`: historial, una versión cada 10 minutos como máximo y las últimas 30.
- `users/{uid}/meta/{noteId}`: organización personal. Campos: `color`, `pinned`, `archived`, `trashed`, `trashedAt`, `folders[]`, `labels[]`, `order`, `locked`, `template`, `hidden`, `unlisted`.
- `users/{uid}/folders`, `labels`, `settings/prefs` (`sort`, `trashDays`, título automático) y `reminders`.
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
   - Corre `assembleRelease`.
4. Si el commit tiene marca, crea la Release con `notas-vX.Y.Z.apk`. Sin marca, el APK de prueba queda en Artifacts.
- Releases: según `ESTANDAR-VERSIONES.md` del repo home. Los cambios que no tocan la app (solo docs) van con `[skip release]`.

**En el entorno de Claude** no hay red para `npm install`, así que no se puede compilar ni probar localmente.
- Antes de subir, chequear la sintaxis con `cp src/x.js /tmp/x.mjs && node --check /tmp/x.mjs`.
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
