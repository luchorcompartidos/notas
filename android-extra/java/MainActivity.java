package io.github.luchorcompartidos.notas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio: recibe "Compartir con…" y las acciones del widget y de los accesos directos
        registerPlugin(IntentBridgePlugin.class);
        // Plugin propio: huella / bloqueo de pantalla para notas bloqueadas
        registerPlugin(BiometricPlugin.class);
        // Plugin propio: leer y escribir el portapapeles del sistema (copiar y pegar celdas de tablas)
        registerPlugin(PortapapelesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
