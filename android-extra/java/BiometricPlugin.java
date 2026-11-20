package io.github.luchorcompartidos.notas;

import android.os.Build;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Desbloqueo con huella, rostro o el bloqueo de pantalla del teléfono (para notas bloqueadas). */
@CapacitorPlugin(name = "Biometria")
public class BiometricPlugin extends Plugin {

    private int authenticators() {
        return Build.VERSION.SDK_INT >= 30
            ? BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_WEAK;
    }

    @PluginMethod
    public void available(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(authenticators());
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        o.put("code", r);
        call.resolve(o);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        String title = call.getString("title", "Desbloquear nota");
        String subtitle = call.getString("subtitle", "");
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(),
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject o = new JSObject();
                            o.put("ok", true);
                            call.resolve(o);
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            JSObject o = new JSObject();
                            o.put("ok", false);
                            o.put("code", code);
                            o.put("message", msg == null ? "" : msg.toString());
                            call.resolve(o);
                        }
                    });
                BiometricPrompt.PromptInfo.Builder b = new BiometricPrompt.PromptInfo.Builder().setTitle(title);
                if (!subtitle.isEmpty()) b.setSubtitle(subtitle);
                if (Build.VERSION.SDK_INT >= 30) {
                    b.setAllowedAuthenticators(authenticators());
                } else {
                    b.setDeviceCredentialAllowed(true);
                }
                prompt.authenticate(b.build());
            } catch (Exception e) {
                JSObject o = new JSObject();
                o.put("ok", false);
                o.put("code", -1);
                o.put("message", e.getMessage());
                call.resolve(o);
            }
        });
    }
}
