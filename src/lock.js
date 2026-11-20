/*
 * Notas bloqueadas: para abrirlas se pide la huella (o el bloqueo de pantalla).
 * - Android: BiometricPrompt (plugin propio "Biometria").
 * - Web: la huella / Windows Hello del dispositivo (WebAuthn), si existe.
 * Es una protección de privacidad dentro de la app: la nota no se cifra.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from './native.js';

const Biometria = registerPlugin('Biometria');
const KEY = 'notas-webauthn';

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function webAvailable() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

// Resultado: { ok: true } | { ok: false, unavailable?: true, message? }
export async function verifyUser(reason = 'Desbloquear nota') {
  if (isNative) {
    try {
      const a = await Biometria.available();
      if (!a.available) return { ok: false, unavailable: true };
      const r = await Biometria.authenticate({ title: reason, subtitle: 'Usá tu huella, rostro o el bloqueo de pantalla' });
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    } catch (e) { return { ok: false, unavailable: true, message: e?.message }; }
  }
  if (!(await webAvailable())) return { ok: false, unavailable: true };
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) {
      // Primera vez en este navegador: se registra la huella del dispositivo (también verifica a la persona)
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Notas' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'notas', displayName: 'Notas' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60000,
        },
      });
      localStorage.setItem(KEY, toB64(cred.rawId));
      return { ok: true };
    }
    await navigator.credentials.get({
      publicKey: {
        challenge, timeout: 60000, userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: fromB64(saved) }],
      },
    });
    return { ok: true };
  } catch (e) {
    if (e?.name === 'InvalidStateError') localStorage.removeItem(KEY);
    return { ok: false, message: e?.message };
  }
}
