# Notas — Prueba de concepto, Parte 1

Objetivo: comprobar si una app hecha con **web + Capacitor** se siente nativa en Android y si la
versión web se ve igual. **No tiene sincronización todavía**: cada dispositivo guarda sus notas localmente.

- Web: `https://luchorcompartidos.github.io/notas/`
- APK: en **Releases** (`notas-vX.Y.Z.apk`)

## Qué incluye

- Editor con formato (títulos, negrita, cursiva, subrayado, listas), **casillas** e **imágenes** (comprimidas a WebP, máx. 1280 px)
- Barra de formato pegada arriba del teclado
- Botón/gesto **Atrás** de Android, efecto ripple, vibración al tildar
- Estilo Material 3, tema del sistema / claro / oscuro, color por nota, notas fijadas
- Eliminar con "Deshacer"
- Versión en el encabezado (al tocarla: fecha de la Release y link al Changelog) y aviso de versión nueva

## Cómo se publica

Todo lo hace `.github/workflows/ci.yml` en cada push a `main`:

| Marca en el mensaje del commit | Resultado |
|---|---|
| `[patch]`, `[minor]` o `[major]` | Web publicada + APK + **Release nueva** |
| sin marca | Web publicada + APK de prueba (en *Actions → Artifacts*), **sin Release** (aviso en el workflow) |

También se puede lanzar a mano: *Actions → CI → Run workflow* y elegir el tipo de Release.

## Puesta en marcha (una sola vez)

1. Crear el repo público `luchorcompartidos/notas` (vacío).
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. Subir todos los archivos de este proyecto (incluida la carpeta `.github`) con el mensaje de commit:
   `Prueba de concepto Parte 1 [patch]` → crea la **v0.0.1**.

## Notas técnicas

- El APK es de tipo *debug*: cada compilación usa una firma distinta, así que para instalar una versión
  nueva puede hacer falta desinstalar la anterior. Se resuelve con una firma fija más adelante.
- El ícono de la app es el predeterminado de Capacitor (se personaliza después).
