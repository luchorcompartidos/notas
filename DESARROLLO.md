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
| Última versión (Release) | v0.1.3 — 2026-11-25 |
| Se conecta con | Firebase, proyecto **notas-pro-2026** (plan gratuito Spark; Firestore en modo producción) |
| Dispositivos viejos (Android 5/6) | **Sí**: aplicar `plantilla/APK-DISPOSITIVOS-VIEJOS.md` del repo home en cada cambio. La adaptación del APK todavía no está hecha: es una etapa propia pendiente (ver sección 5) |

## 2. Etapa actual
**Tablas en las notas: Parte A hecha (v0.1.3). Sigue la Parte B.**
- Objetivo: tablas fáciles de insertar, ajustar, ampliar y modificar dentro de las notas, en la web y en el APK.
- Hecho en la Parte A (v0.1.3):
  - Botón **Tabla** en la barra de formato. Si el cursor no está en una tabla, abre "Insertar tabla": grilla de 8 × 8 o cantidades escritas con − y + (hasta 20 columnas y 200 filas), con "Primera fila como encabezado".
  - **Barra de tabla** (aparece arriba de la barra de formato con el cursor dentro de una tabla): posición `F2 · C3` (abre el panel), + Fila ↑/↓, + Col ←/→, alineación horizontal y vertical (tocar cicla las opciones), − Fila, − Col.
  - **Panel "Tabla"**: filas, columnas, alineación con "Aplicar a: Celda / Fila / Columna / Tabla" (4 horizontales y 3 verticales), fila y columna de encabezado, escribir arriba o debajo de la tabla, duplicar y eliminar tabla (con Deshacer).
  - Tab pasa de celda y en la última agrega una fila. Pegar desde Excel/Sheets (HTML) o texto con tabulaciones arma la tabla. Casillas, listas y formato dentro de las celdas. Desplazamiento lateral en pantallas chicas (columna mínima de 64 px). Ancho de columna arrastrando el borde con el mouse (en la PC).
  - Exportar: txt, WhatsApp (filas con `|`), md (tabla GFM con alineación), docx (tabla real con alineación y encabezado sombreado) y PDF (grilla). Importar: md con tablas; docx y html ya traen sus tablas.
  - Una nota nueva que solo tiene una tabla vacía no se descarta al cerrarla.
- En curso: nada a medio hacer.

## 3. Próximos pasos
1. **El usuario prueba la v0.1.3** en la web, el celular y (si instala) las tablets.
2. **Parte B de tablas** (ya acordada):
   - Ancho de columnas: automático según el contenido, todas iguales o manual por columna (también táctil, sin mouse).
   - Alto de filas: automático, todas iguales o manual.
   - Copiar una fila o columna y "Insertar copiada" entre medio de otras, con su contenido.
   - Color de fondo por celda.
   - Ordenar la tabla por una columna (A→Z, Z→A, números).
   - Menú al mantener apretada una celda en el celular.
   - Combinar celdas: queda para más adelante (complica la fusión de cambios entre dispositivos).
3. Etapa propia: **APK para dispositivos viejos** (ver sección 5).

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
- **Tablas** (2026-11-25): se hacen en dos partes (A en v0.1.3, B después). Los extras propuestos por Claude se reparten entre A y B a criterio de Claude. Combinar celdas queda fuera por ahora.
- **Versiones:** cada pedido define el tipo de Release (la mayoría Patch; la v0.1.0 fue Minor; las tablas Parte A fueron Patch por elección del usuario). Si hay otras preguntas pendientes, el tipo de Release se pregunta al final; si no, se avanza con Patch y se avisa el número.

## 5. Pendientes / dudas abiertas
- [ ] **Parte B de tablas** (sección 3).
- [ ] **APK para dispositivos viejos** (tablet Android 6.0.1 de 32 bits y Bangho Android 5.0). La guía de Flutter no se aplica tal cual porque ANote... es Capacitor. A verificar en esa etapa:
  - Capacitor 7 pide como mínimo Android 6.0 (API 23): la tablet Android 5.0 quedaría afuera, salvo con un APK aparte en una versión vieja de Capacitor (a evaluar el costo).
  - La web se compila con `target: es2022` y usa CSS moderno (`color-mix`, `:has`). Con el WebView de fábrica de Android 5/6 no anda: hay que actualizar "Android System WebView" desde Play Store o compilar un APK aparte con un target más viejo.
  - El inicio de sesión con Google nativo y las versiones mínimas de Firebase en Android 5/6.
  - Las tablas no agregan requisitos nuevos: usan lo mismo que el resto del editor.
- [ ] **App Links** (que el link de una nota abra la app en vez de la web). Requiere que el usuario cree el repo vacío `luchorcompartidos.github.io` (Claude no puede crear repos). Después hay que subir ahí `.well-known/assetlinks.json` con el paquete `io.github.luchorcompartidos.notas` y el SHA-256 de la firma: `F3:CC:EE:75:71:9A:9E:A6:13:FD:C2:0E:30:33:49:48:C3:1A:0C:67:77:60:B4:97:B5:C5:9C:3F:E3:AD:3B:D9`. Además hay que agregar en `patch-android.py` el intent-filter `autoVerify` para `https://luchorcompartidos.github.io/notas/`.
- **Limitaciones conocidas:**
  - **Sin notificaciones push:** con la app cerrada no llegan los pedidos de acceso, ni las invitaciones, ni los recordatorios creados en otro dispositivo; se ven y se programan al abrir la app. Hacerlo requiere el plan Blaze (Cloud Functions + FCM).
  - **El bloqueo con huella no cifra:** solo oculta el contenido en la interfaz.
  - **Imágenes en copias:** una nota copiada referencia las imágenes de la original.
  - **`.anote` en Android:** algunos exploradores muestran "Abrir con…" la primera vez, y ANote... aparece también para algunos archivos genéricos.
  - **Vista previa de links en la web:** depende de microlink.io (se puede desactivar desde ⋮).
  - **Tablas:** en el celular, el ancho de columna todavía no se ajusta con el dedo (llega en la Parte B). En el PDF las columnas salen del mismo ancho.
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

**Tablas:** el contenido de la tabla vive en el documento Yjs como el resto (se fusiona entre dispositivos). La alineación se guarda en cada celda (`align`: center/right/justify; `valign`: middle/bottom; izquierda y arriba = `null`). El ancho arrastrado queda en `colwidth` (de prosemirror-tables). `#table-bar` está en `index.html`, arriba de `#toolbar`; la clase `in-table` en `#view-editor` agranda el margen inferior del editor.

**Android (`android-extra/`):**
- `res/`: ícono, splash, widget "Nota rápida", accesos directos y strings.
- `java/`:
  - `MainActivity` registra los plugins.
  - `IntentBridgePlugin` atiende SEND ("Compartir con…"), VIEW de `.anote` y las acciones del widget y de los accesos directos.
  - `NotaRapidaWidget` es el widget.
  - `BiometricPlugin` usa BiometricPrompt.
- `patch-android.py` corre en cada compilación sobre el proyecto que genera `npx cap add android`. Agrega intent-filters (con los `pathPattern` de `.anote`), el receiver del widget y la dependencia biometric.

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
- **Tablas desde el panel:** los comandos se corren sin `focus()` (`runTableCommand(..., { focus: false })`), para que no se abra el teclado detrás del panel. Los botones de las barras usan `pointerdown` + `preventDefault` para no cerrar el teclado.
- **`deleteRow`/`deleteColumn`** no borran la última fila o columna: en ese caso se borra la tabla (`runTableCommand`).
- **`.anote` en `patch-android.py`:** cuidado con el doble escape de `pathPattern`.
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
