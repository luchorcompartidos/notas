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

open(m_path, 'w', encoding='utf-8').write(m)
assert 'android.intent.action.SEND' in m, 'No se pudo agregar "Compartir con…" al manifest'
assert 'NotaRapidaWidget' in m, 'No se pudo agregar el widget al manifest'
print('Proyecto Android ajustado: ícono, splash, widget, accesos directos y Compartir con…')
