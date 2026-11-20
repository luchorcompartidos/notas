# Notas — Prueba de concepto

App de notas con **web + Android (Capacitor)** a partir de un solo código, con sincronización entre
dispositivos y **fusión de cambios** (Yjs + Firestore).

- Web: `https://luchorcompartidos.github.io/notas/`
- APK: en **Releases** (`notas-vX.Y.Z.apk`)

## Estado

| Parte | Versión | Contenido |
|---|---|---|
| 1 | v0.0.1 | Aspecto y uso: editor con formato, casillas, imágenes, Material 3, Atrás, temas |
| 2A | v0.0.2 | Inicio de sesión con Google (web) y sincronización con fusión de cambios |
| 2B | v0.0.3 | Inicio de sesión nativo en Android y firma fija del APK |

Desde la v0.0.3, la app Android inicia sesión con Google (nativo) y sincroniza igual que la web.

## Cómo funciona la sincronización

- Cada nota es un documento **Yjs**: título y contenido. Yjs combina los cambios de varios dispositivos
  sin perder ninguno, aunque se hayan hecho sin conexión.
- Copia local en IndexedDB: se puede editar sin conexión (con la página ya abierta).
- Firestore:
  - `notes/{id}`: resumen compartido (dueño, miembros, título, vista previa, casillas, miniatura)
  - `notes/{id}/updates/*`: cambios de Yjs; se compactan cuando pasan de 40
  - `users/{uid}/meta/{id}`: organización personal (color, fijada, papelera)
- Las reglas de seguridad están en `firestore.rules` (se pegan en la consola de Firebase).

## Cómo se publica

Todo lo hace `.github/workflows/ci.yml` en cada push a `main`:

| Marca en el mensaje del commit | Resultado |
|---|---|
| `[patch]`, `[minor]` o `[major]` | Web publicada + APK + **Release nueva** |
| sin marca (o `[skip release]`) | Web publicada + APK de prueba (en *Actions → Artifacts*), **sin Release** |

También se puede lanzar a mano: *Actions → CI → Run workflow* y elegir el tipo de Release.

## Notas técnicas

- El APK se firma con la clave fija guardada en los Secrets del repo (`ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`). Su SHA-1 está registrada en Firebase.
- `config/google-services.json` configura Firebase en Android (inicio de sesión nativo con Google).
