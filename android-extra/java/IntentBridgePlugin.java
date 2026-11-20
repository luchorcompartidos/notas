package io.github.luchorcompartidos.notas;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * Lleva a la app web lo que llega por Intents de Android:
 *  - "Compartir con…" desde otras apps (texto, links e imágenes)
 *  - acciones del widget y de los accesos directos (nueva nota, nueva lista, buscar)
 */
@CapacitorPlugin(name = "IntentBridge")
public class IntentBridgePlugin extends Plugin {
    public static final String ACTION_NOTA = "io.github.luchorcompartidos.notas.NUEVA_NOTA";
    public static final String ACTION_LISTA = "io.github.luchorcompartidos.notas.NUEVA_LISTA";
    public static final String ACTION_BUSCAR = "io.github.luchorcompartidos.notas.BUSCAR";
    private static final int MAX_BYTES = 15 * 1024 * 1024;

    private JSObject pending = null;

    @Override
    public void load() {
        handle(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent, true);
    }

    private void handle(Intent intent, boolean notify) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        JSObject data = new JSObject();
        if (ACTION_NOTA.equals(action)) data.put("kind", "note");
        else if (ACTION_LISTA.equals(action)) data.put("kind", "list");
        else if (ACTION_BUSCAR.equals(action)) data.put("kind", "search");
        else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            // Abrir un archivo .anote desde un explorador de archivos, WhatsApp, Gmail, etc.
            Uri uri = intent.getData();
            String text = readText(uri);
            if (text == null) return;
            data.put("kind", "file");
            data.put("name", displayName(uri));
            data.put("text", text);
        }
        else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            String type = intent.getType() == null ? "" : intent.getType();
            data.put("kind", "share");
            data.put("text", intent.getStringExtra(Intent.EXTRA_TEXT));
            data.put("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT));
            JSArray images = new JSArray();
            if (type.startsWith("image/")) {
                if (Intent.ACTION_SEND.equals(action)) {
                    addImage(images, (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM), type);
                } else {
                    ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                    if (uris != null) for (Uri u : uris) addImage(images, u, type);
                }
            }
            data.put("images", images);
            Uri stream = Intent.ACTION_SEND.equals(action) ? (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM) : null;
            if (stream != null && !type.startsWith("image/")) {
                String name = displayName(stream);
                if (name != null && name.toLowerCase().endsWith(".anote")) {
                    String text = readText(stream);
                    if (text != null) { data.put("kind", "file"); data.put("name", name); data.put("text", text); }
                }
            }
        } else {
            return;
        }
        // Que no se procese de nuevo si la actividad se recrea
        intent.setAction(Intent.ACTION_MAIN);
        if (notify) notifyListeners("intentReceived", data, true);
        else pending = data;
    }

    private String readText(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n; int total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 40 * 1024 * 1024) return null;
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    private String displayName(Uri uri) {
        String name = "nota.anote";
        try (android.database.Cursor c = getContext().getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception e) {
            String p = uri.getLastPathSegment();
            if (p != null) name = p;
        }
        return name;
    }

    private void addImage(JSArray arr, Uri uri, String type) {
        if (uri == null) return;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n; int total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) return;
                out.write(buf, 0, n);
            }
            String mime = getContext().getContentResolver().getType(uri);
            if (mime == null || !mime.startsWith("image/")) mime = type.endsWith("*") ? "image/jpeg" : type;
            arr.put("data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        } catch (Exception e) {
            // imagen ilegible: se ignora
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = new JSObject();
        if (pending != null) {
            r.put("data", pending);
            pending = null;
        }
        call.resolve(r);
    }
}
