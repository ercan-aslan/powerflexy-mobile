import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';

WebBrowser.maybeCompleteAuthSession();

const BIO_ENABLED = 'pf_bio_enabled';
const BIO_ASKED = 'pf_bio_asked';
const BIO_UNLOCK = 'pf_bio_unlock_token';

export type GoogleAuthRequest = {
  type: 'bd_google_auth';
  intent?: 'login' | 'signup';
  next?: string;
  studio_code?: string;
  full_name?: string;
  kvkk?: string;
  contract?: string;
  form_token?: string;
};

export type AuthSessionMessage = {
  type: 'bd_auth_session';
  loggedIn?: boolean;
  userId?: string;
};

export function buildNativeAuthFlagScript(isIos = false): string {
  return `(() => {
    try {
      window.__BD_NATIVE_AUTH__ = true;
      ${
        isIos
          ? 'window.__BD_NATIVE_IOS__ = true; document.documentElement.classList.add("bd-native-ios");'
          : ''
      }
    } catch (e) {}
    true;
  })();`;
}

export function buildAuthSessionProbeScript(): string {
  return `(function(){
    try{
      fetch('/api.php?action=me',{credentials:'include'})
        .then(function(r){return r.json().catch(function(){return {};});})
        .then(function(d){
          var u=(d&&d.ok===true&&d.user)?d.user:null;
          var loggedIn=!!(u&&u.id);
          if(window.ReactNativeWebView){
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type:'bd_auth_session',
              loggedIn:loggedIn,
              userId:u&&u.id?String(u.id):''
            }));
          }
          if(!loggedIn) return;
          fetch('/api.php?action=auth.native_unlock_issue',{credentials:'include'})
            .then(function(r){return r.json().catch(function(){return {};});})
            .then(function(x){
              if(x&&x.ok&&x.token&&window.ReactNativeWebView){
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type:'bd_native_unlock_token',
                  token:String(x.token)
                }));
              }
            }).catch(function(){});
        }).catch(function(){});
    }catch(e){}
    true;
  })();`;
}

function asRecord(raw: string): Record<string, unknown> | null {
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return msg as Record<string, unknown>;
  } catch {
    return null;
  }
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function parseGoogleAuthMessage(raw: string): GoogleAuthRequest | null {
  const msg = asRecord(raw);
  if (!msg || msg.type !== 'bd_google_auth') return null;
  const intent = msg.intent === 'signup' || msg.intent === 'login' ? msg.intent : undefined;
  return {
    type: 'bd_google_auth',
    intent,
    next: optionalString(msg.next),
    studio_code: optionalString(msg.studio_code),
    full_name: optionalString(msg.full_name),
    kvkk: optionalString(msg.kvkk),
    contract: optionalString(msg.contract),
    form_token: optionalString(msg.form_token),
  };
}

export function parseAuthSessionMessage(raw: string): AuthSessionMessage | null {
  const msg = asRecord(raw);
  if (!msg || msg.type !== 'bd_auth_session') return null;
  return {
    type: 'bd_auth_session',
    loggedIn: msg.loggedIn === true,
    userId: optionalString(msg.userId),
  };
}

export async function isBiometricUnlockEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIO_ENABLED)) === '1';
  } catch {
    return false;
  }
}

export async function enableBiometricUnlock(): Promise<void> {
  try {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!has || !enrolled) return;
    await SecureStore.setItemAsync(BIO_ENABLED, '1');
    await SecureStore.setItemAsync(BIO_ASKED, '1');
  } catch {
    /* ignore */
  }
}

/** System Face ID / fingerprint prompt. Does not look at the opt-in flag. */
export async function promptBiometric(): Promise<'ok' | 'skipped' | 'failed'> {
  try {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!has || !enrolled) return 'skipped';
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: Platform.OS === 'ios' ? 'Face ID ile giriş' : 'Parmak izi ile giriş',
      cancelLabel: 'İptal',
      disableDeviceFallback: true,
    });
    return res.success ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function runBiometricGate(): Promise<'ok' | 'skipped' | 'failed'> {
  try {
    const enabled = await SecureStore.getItemAsync(BIO_ENABLED);
    if (enabled !== '1') return 'skipped';
    return promptBiometric();
  } catch {
    return 'failed';
  }
}

export async function maybeAskEnableBiometric(): Promise<void> {
  await enableBiometricUnlock();
}

export async function getUnlockToken(): Promise<string | null> {
  try {
    const t = await SecureStore.getItemAsync(BIO_UNLOCK);
    return t && t.length >= 32 ? t : null;
  } catch {
    return null;
  }
}

export async function saveUnlockToken(token: string): Promise<void> {
  try {
    if (token.length >= 32) await SecureStore.setItemAsync(BIO_UNLOCK, token);
  } catch {
    /* ignore */
  }
}

export function parseUnlockTokenMessage(raw: string): string | null {
  const msg = asRecord(raw);
  if (!msg || msg.type !== 'bd_native_unlock_token' || typeof msg.token !== 'string') {
    return null;
  }
  return msg.token;
}

export type AppleAuthRequest = {
  type: 'bd_apple_auth';
  intent?: 'login' | 'signup' | 'apply';
  next?: string;
  studio_code?: string;
  full_name?: string;
  form_token?: string;
  t?: string;
};

export function parseAppleAuthMessage(raw: string): AppleAuthRequest | null {
  const msg = asRecord(raw);
  if (!msg || msg.type !== 'bd_apple_auth') return null;
  const intent =
    msg.intent === 'login' || msg.intent === 'signup' || msg.intent === 'apply'
      ? msg.intent
      : undefined;
  return {
    type: 'bd_apple_auth',
    intent,
    next: optionalString(msg.next),
    studio_code: optionalString(msg.studio_code),
    full_name: optionalString(msg.full_name),
    form_token: optionalString(msg.form_token),
    t: optionalString(msg.t),
  };
}

function formatAppleName(name: {
  givenName?: string | null;
  familyName?: string | null;
} | null): string {
  if (!name) return '';
  return [name.givenName, name.familyName].filter(Boolean).join(' ').trim();
}

export async function startAppleAuth(
  siteUrl: string,
  req: AppleAuthRequest
): Promise<{ ticket?: string; redirect?: string; error?: string } | null> {
  if (Platform.OS !== 'ios') {
    return { error: 'Apple ile giriş iOS uygulamasında kullanılır.' };
  }
  let AppleAuthentication: typeof import('expo-apple-authentication');
  try {
    AppleAuthentication = await import('expo-apple-authentication');
  } catch {
    return { error: 'Apple ile giriş bu sürümde kapalı. E-posta veya Google kullanın.' };
  }
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    return { error: 'Bu cihazda Apple ile giriş kullanılamıyor.' };
  }
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    const identityToken = cred.identityToken;
    if (!identityToken) return { error: 'Apple jetonu alınamadı.' };
    const base = siteUrl.replace(/\/$/, '');
    const body = new URLSearchParams();
    body.set('identity_token', identityToken);
    body.set('intent', req.intent === 'signup' || req.intent === 'apply' ? req.intent : 'login');
    body.set('mobile', '1');
    if (req.next) body.set('next', req.next);
    const full = (req.full_name || formatAppleName(cred.fullName)).trim();
    if (full) body.set('full_name', full);
    if (cred.email) body.set('email', String(cred.email));
    if (req.intent === 'signup') {
      if (req.studio_code) body.set('studio_code', req.studio_code);
      if (req.form_token) body.set('form_token', req.form_token);
    }
    if (req.intent === 'apply' && req.t) body.set('t', req.t);
    const res = await fetch(base + '/apple_auth.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    const text = await res.text();
    let j: { ok?: boolean; ticket?: string; redirect?: string; error?: string } | null = null;
    try {
      j = JSON.parse(text);
    } catch {
      return { error: 'Apple sunucu yanıtı okunamadı. Tekrar deneyin.' };
    }
    if (!j || j.ok !== true) {
      return { error: (j && j.error) || 'Apple ile giriş başarısız.' };
    }
    if (j.ticket) return { ticket: j.ticket };
    if (j.redirect) return { redirect: j.redirect };
    return { error: 'Apple ile giriş tamamlanamadı.' };
  } catch (e) {
    const code = String((e as { code?: string })?.code || '');
    if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return null;
    if (code === 'ERR_REQUEST_UNKNOWN' || code === 'ERR_INVALID_RESPONSE') {
      return {
        error:
          'Apple kaydı tamamlanamadı. TestFlight’tan 22. sürümü yükleyin; olmazsa iPhone Ayarlar → Apple ID → Giriş ve Güvenlik → Apple ile Giriş → PowerFlexy’yi kaldırıp tekrar deneyin.',
      };
    }
    return { error: 'Apple ile giriş iptal edildi veya başarısız.' };
  }
}

export async function startGoogleAuth(
  siteUrl: string,
  req: GoogleAuthRequest
): Promise<string | null> {
  const base = siteUrl.replace(/\/$/, '');
  const u = new URL(base + '/google_oauth.php');
  u.searchParams.set('intent', req.intent === 'signup' ? 'signup' : 'login');
  u.searchParams.set('mobile', '1');
  if (req.next) u.searchParams.set('next', req.next);
  if (req.intent === 'signup') {
    if (req.studio_code) u.searchParams.set('studio_code', req.studio_code);
    if (req.full_name) u.searchParams.set('full_name', req.full_name);
    if (req.kvkk) u.searchParams.set('kvkk', req.kvkk);
    if (req.contract) u.searchParams.set('contract', req.contract);
    if (req.form_token) u.searchParams.set('form_token', req.form_token);
  }
  const scheme =
    (Constants.expoConfig?.scheme as string | undefined) || 'powerflexy';
  const redirect = `${scheme}://google-auth`;
  const result = await WebBrowser.openAuthSessionAsync(u.toString(), redirect);
  if (result.type !== 'success' || !('url' in result) || !result.url) return null;
  try {
    return new URL(result.url).searchParams.get('ticket');
  } catch {
    return null;
  }
}
