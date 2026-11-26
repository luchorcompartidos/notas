"""Ajusta el proyecto Android generado por Capacitor (se ejecuta en GitHub Actions).
- Ícono propio, splash, widget y accesos directos
- "Compartir con…" (intent-filters) y el plugin propio IntentBridge
"""
import os, re, shutil, glob

BASE = os.path.dirname(os.path.abspath(__file__))
APP = 'android/app/src/main'
PKG_DIR = f'{APP}/java/io/github/luchorcompartidos/notas'

# 1. Recursos (íconos, splash, widget, accesos directos)
for path in glob.glob(f'{APP}/res/drawable*/splash.png'):
    os.remove(path)
for path in glob.glob(f'{APP}/res/mipmap-*/ic_launcher_foreground.png'):
    os.remove(path)
shutil.copytree(f'{BASE}/res', f'{APP}/res', dirs_exist_ok=True)

# 2. Código Java
os.makedirs(PKG_DIR, exist_ok=True)
for name in os.listdir(f'{BASE}/java'):
    shutil.copy(f'{BASE}/java/{name}', f'{PKG_DIR}/{name}')

# 3. Manifest
m_path = f'{APP}/AndroidManifest.xml'
m = open(m_path, encoding='utf-8').read()

filters = '''
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/vnd.anote+json" />
                <data android:mimeType="application/json" />
            </intent-filter>
            <!-- Abrir archivos .anote -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/vnd.anote+json" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathPattern=".*\\\\.anote" />
                <data android:pathPattern=".*\\\\..*\\\\.anote" />
                <data android:pathPattern=".*\\\\..*\\\\..*\\\\.anote" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:host="*" />
                <data android:mimeType="application/octet-stream" />
            </intent-filter>
            <!-- App Links: los links de notas abren la app (archivo .well-known/assetlinks.json en el repo luchorcompartidos.github.io) -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" />
                <data android:scheme="http" />
                <data android:host="luchorcompartidos.github.io" />
                <data android:pathPrefix="/notas" />
            </intent-filter>
            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />
'''
if 'android.intent.action.SEND' not in m:
    # Después del intent-filter del lanzador, dentro de la actividad principal
    m = re.sub(r'(<category android:name="android.intent.category.LAUNCHER"\s*/>\s*</intent-filter>)', r'\1' + filters, m, count=1)

receiver = '''
        <receiver android:name=".NotaRapidaWidget" android:exported="false" android:label="@string/widget_nueva_nota">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_nota_rapida_info" />
        </receiver>
'''
if 'NotaRapidaWidget' not in m:
    m = m.replace('</application>', receiver + '    </application>', 1)

# Atrapador de cierres (AnoteApp + CierreActivity en proceso aparte): muestra el error en vez de
# "Se ha detenido la aplicación". Solo actúa si la app se cae.
if '.AnoteApp' not in m:
    assert 'android:name=' not in m.split('<application', 1)[1].split('>', 1)[0], 'El <application> ya tiene android:name'
    m = m.replace('<application', '<application\n        android:name=".AnoteApp"', 1)
cierre = '''
        <activity android:name=".CierreActivity" android:process=":cierre" android:exported="false"
            android:excludeFromRecents="true" android:theme="@android:style/Theme.Material.Light" />
'''
if 'CierreActivity' not in m:
    m = m.replace('</application>', cierre + '    </application>', 1)

open(m_path, 'w', encoding='utf-8').write(m)

# 3b. Android 5.0 (API 21): @capacitor/status-bar 7 llama a View.getRootWindowInsets() (API 23) sin control
# al arrancar y la app se cerraba con NoSuchMethodError (v0.2.5, Bangho). Se protege con SDK_INT y en
# Android 5 se toma el alto de la barra del recurso "status_bar_height". Android 6+ queda igual.
SB = 'node_modules/@capacitor/status-bar/android/src/main/java/com/capacitorjs/plugins/statusbar/StatusBar.java'
sb = open(SB, encoding='utf-8').read()
viejo = 'WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();'
nuevo = '''if (Build.VERSION.SDK_INT < 23) { // ANote: Android 5 no tiene getRootWindowInsets()
            int resId = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
            return resId > 0 ? (int) (activity.getResources().getDimensionPixelSize(resId) / metrics.density) : 0;
        }
        ''' + viejo
if 'ANote: Android 5' not in sb:
    assert sb.count(viejo) == 1, 'StatusBar.java cambió: revisar el arreglo de getRootWindowInsets para Android 5'
    sb = sb.replace(viejo, nuevo, 1)
    open(SB, 'w', encoding='utf-8').write(sb)
assert 'ANote: Android 5' in sb

# 4. Dependencia para la huella (BiometricPrompt)
g_path = 'android/app/build.gradle'
g = open(g_path, encoding='utf-8').read()
if 'androidx.biometric' not in g:
    g += "\n// Huella para notas bloqueadas\ndependencies {\n    implementation 'androidx.biometric:biometric:1.1.0'\n}\n"
    open(g_path, 'w', encoding='utf-8').write(g)
assert 'android.intent.action.SEND' in m, 'No se pudo agregar "Compartir con…" al manifest'
assert 'NotaRapidaWidget' in m, 'No se pudo agregar el widget al manifest'
assert '.AnoteApp' in m and 'CierreActivity' in m, 'No se pudo agregar el atrapador de cierres al manifest'
print('Proyecto Android ajustado: ícono, splash, widget, accesos directos, Compartir con… y huella')
