# ANote... — notas sincronizadas (web + Android)

App de notas con **web + Android (Capacitor)** a partir de un solo código, con sincronización entre
dispositivos y **fusión de cambios** (Yjs + Firestore).

- Web: `https://luchorcompartidos.github.io/notas/`
- APK: en **Releases** (`notas-vX.Y.Z.apk`)

## Estado

| Parte | Versión | Contenido |
|---|---|---|
| 1 | v0.0.1 | Aspecto y uso: editor con formato, casillas, imágenes, Material 3, Atrás, temas |
| 2A | v0.0.2 | Inicio de sesión con Google (web) y sincronización con fusión de cambios |
| 2B | v0.0.3–v0.0.6 | Inicio de sesión nativo en Android y firma fija del APK |
| 1A | v0.0.7 | Carpetas con subcarpetas, nota en varias carpetas, etiquetas con color, archivo, papelera con plazo, selección múltiple, copiar |
| 1B | v0.0.8 | Búsqueda con filtros, orden por criterios y manual (arrastrar), vista lista/cuadrícula, plantillas |
| 2 | v0.0.9 | Recordatorios por nota y por casilla, con repetición; notificaciones en Android con «Hecho» y «Posponer» |
| 3 | v0.0.10 | Compartir por email (puede editar / solo puede ver), «Compartidas conmigo», edición simultánea, quitar acceso, salir de una nota |
| 4 | v0.0.11 | «Compartir con…» desde otras apps, widget de nota rápida, ícono propio, accesos directos, web instalable que abre sin conexión, vista previa de links |
| 5 | v0.0.12 | Imágenes guardadas aparte (sin límite por nota), historial de versiones, exportar (PDF, .docx, .md, .txt, .json) e importar (.json, .md, .txt, .docx, .pdf, .html), notas bloqueadas con huella |
| — | v0.0.13 | Enviar a WhatsApp (texto con formato, imágenes, PDF/Word/txt como adjunto) |
| — | v0.0.14 | Sincronización reforzada: estado de verificación por nota, conexión real, cola de cambios pendientes, reintentos, «tirar para actualizar» y «Reintentar ahora» |
| — | v0.1.0 | Marca ANote..., vista compacta (1 a 5 líneas) y estándar con límite de 1/3, contraer/expandir, flecha de «más notas», formato .anote, «Copiar (o Enviar) Link» y pedidos de acceso al dueño |
| — | v0.1.1 | Ocultar notas de la pantalla principal (listado «Notas ocultables» con selección múltiple, Quitar del listado y Restaurar listado; marca [Oculta] y filtro «Excluir ocultas» en la búsqueda) y «Estadísticas e Info de la nota» |
| — | v0.1.2 | «Título automático» (menú lateral): a una nota nueva que se cierra sin título se le pone la primera frase, un prefijo configurable o prefijo + primera frase |
| — | v0.1.3 | **Tablas (Parte A)**: insertar eligiendo columnas × filas (grilla o − / +), barra de tabla, agregar/insertar/eliminar filas y columnas, alineación horizontal y vertical (celda, fila, columna o tabla), fila y columna de encabezado, duplicar/eliminar tabla, escribir arriba/debajo, pegar desde Excel/Sheets, desplazamiento lateral en el celular; exportar e importar tablas |
| — | v0.1.4 | **Tablas (Parte B1)**: ancho de columnas automático, iguales o manual (con − / + o un número, también en el celular), alto de filas automático, iguales o manual, copiar una fila o columna e insertarla con su contenido entre otras (también en otra tabla u otra nota), duplicar fila o columna, botón «↔ Tamaño» en la barra de tabla |

Desde la v0.0.3, la app Android inicia sesión con Google (nativo) y sincroniza igual que la web.

## Cómo funciona la sincronización

- Cada nota es un documento **Yjs**: título y contenido. Yjs combina los cambios de varios dispositivos
  sin perder ninguno, aunque se hayan hecho sin conexión.
- Copia local en IndexedDB: se puede editar sin conexión (con la página ya abierta).
- Firestore:
  - `notes/{id}`: resumen compartido (dueño, miembros, título, vista previa, casillas, miniatura)
  - `notes/{id}/updates/*`: cambios de Yjs; se compactan cuando pasan de 40
  - `users/{uid}/meta/{id}`: organización personal (color, fijada, papelera)
- Las reglas de seguridad están en `firestore.rules` (se pegan en la consola de Firebase cada vez que cambian).
- Compartir: `invites/{idNota}_{email}` guarda la invitación; al aceptarla, la persona se agrega a `memberIds` con el rol indicado.

## Cómo se publica

Todo lo hace `.github/workflows/ci.yml` en cada push a `main`:

| Marca en el mensaje del commit | Resultado |
|---|---|
| `[patch]`, `[minor]` o `[major]` | Web publicada + APK + **Release nueva** |
| sin marca (o `[skip release]`) | Web publicada + APK de prueba (en *Actions → Artifacts*), **sin Release** |

También se puede lanzar a mano: *Actions → CI → Run workflow* y elegir el tipo de Release.

## Notas técnicas

- `android-extra/`: ícono, splash, widget, accesos directos y el plugin nativo `IntentBridge` ("Compartir con…"); `patch-android.py` los aplica al proyecto que genera Capacitor en cada compilación.
- Vista previa de links: en el APK se descarga la página desde el teléfono; en la web se usa el servicio gratuito microlink.io (se puede desactivar desde el menú ⋮).

- El APK se firma con la clave fija guardada en los Secrets del repo (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`). Su SHA-1 está registrada en Firebase.
- `config/google-services.json` configura Firebase en Android (inicio de sesión nativo con Google).
