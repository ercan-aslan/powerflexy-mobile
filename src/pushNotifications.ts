import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ||
  'fb698c1a-44e6-49cb-a596-a49f76f91e89';

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366F1',
  });
}

export type PushTokenResult = {
  token: string | null;
  error: string | null;
};

export async function getExpoPushTokenAsync(): Promise<string | null> {
  const r = await getExpoPushTokenDetailed();
  return r.token;
}

export async function getExpoPushTokenDetailed(): Promise<PushTokenResult> {
  try {
    if (!Device.isDevice) {
      return { token: null, error: 'Simülatörde push token alınamaz — gerçek cihaz gerekli' };
    }
    if (!EAS_PROJECT_ID || EAS_PROJECT_ID.startsWith('REPLACE_')) {
      return { token: null, error: 'EAS projectId eksik' };
    }
    await ensureAndroidChannel();

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return { token: null, error: 'Bildirim izni yok (' + finalStatus + ')' };
    }

    // Prefer Expo token directly; device-token probe is diagnostic only
    let deviceErr = '';
    try {
      const deviceTok = await Notifications.getDevicePushTokenAsync();
      console.log('[BD_PUSH] device token type=', deviceTok?.type);
    } catch (e) {
      deviceErr = e instanceof Error ? e.message : String(e);
      console.warn('[BD_PUSH] getDevicePushTokenAsync failed', deviceErr);
    }

    try {
      const tokenRes = await Notifications.getExpoPushTokenAsync({
        projectId: EAS_PROJECT_ID,
      });
      const token = tokenRes.data || null;
      if (!token) {
        return {
          token: null,
          error:
            'Expo push token boş' +
            (deviceErr ? ' (cihaz: ' + deviceErr + ')' : ''),
        };
      }
      console.log('[BD_PUSH] token', token.slice(0, 32) + '…');
      return { token, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        token: null,
        error:
          'Expo token hatası: ' +
          msg +
          (deviceErr ? ' | cihaz: ' + deviceErr : ''),
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[BD_PUSH] getExpoPushTokenAsync failed', msg);
    return { token: null, error: msg };
  }
}

/** JS injected into WebView: sets token + registers via same-origin cookie session. */
export function buildPushBridgeScript(token: string, platform: string): string {
  const tok = JSON.stringify(token);
  const plat = JSON.stringify(platform);
  return `
(function(){
  try {
    window.__BD_PUSH_TOKEN__ = ${tok};
    window.__BD_PUSH_PLATFORM__ = ${plat};
    function bdPushPost(msg){
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(msg));
        }
      } catch (e0) {}
    }
    // Always refresh token globals; re-run register if user session changed
    if (window.__BD_PUSH_BRIDGE_INSTALLED__) {
      try { if (typeof window.__BD_PUSH_REGISTER_NOW__ === 'function') window.__BD_PUSH_REGISTER_NOW__('reinject'); } catch (e) {}
      return;
    }
    window.__BD_PUSH_BRIDGE_INSTALLED__ = true;

    async function bdEnsureCsrf(){
      try {
        if (window.APP && window.APP.csrf) return window.APP.csrf;
        var r = await fetch('/api.php?action=me', { credentials: 'same-origin' });
        var j = await r.json();
        if (j && j.ok && j.csrf) {
          window.APP = window.APP || {};
          window.APP.csrf = j.csrf;
          return j.csrf;
        }
      } catch (e) {}
      return '';
    }

    async function bdRegisterPush(reason){
      try {
        var token = window.__BD_PUSH_TOKEN__;
        if (!token) {
          bdPushPost({ type: 'bd_push_status', stage: 'no_token', reason: reason || '' });
          return;
        }
        var me = await fetch('/api.php?action=me', { credentials: 'same-origin' });
        var mj = await me.json();
        if (!mj || !mj.ok || !mj.user) {
          bdPushPost({ type: 'bd_push_status', stage: 'no_session', reason: reason || '' });
          return;
        }
        var uid = parseInt((mj.user && mj.user.id) || 0, 10) || 0;
        var role = String((mj.user && (mj.user.role || mj.user.role_norm)) || '');
        // Re-register when logged-in user changes (uye ↔ egitmen on same device)
        if (window.__BD_PUSH_REGISTERED__ === token && window.__BD_PUSH_REGISTERED_UID__ === uid) {
          bdPushPost({ type: 'bd_push_status', stage: 'already', uid: uid, role: role, reason: reason || '' });
          return;
        }
        var csrf = (mj.csrf || (await bdEnsureCsrf()) || '');
        if (csrf) {
          window.APP = window.APP || {};
          window.APP.csrf = csrf;
        }
        var fd = new FormData();
        fd.append('csrf', csrf || '');
        fd.append('token', token);
        fd.append('platform', window.__BD_PUSH_PLATFORM__ || '');
        fd.append('device_name', 'PowerFlexy App');
        var headers = {};
        if (csrf) headers['X-CSRF-TOKEN'] = csrf;
        var res = await fetch('/api.php?action=notifications.register_device', {
          method: 'POST',
          credentials: 'same-origin',
          headers: headers,
          body: fd
        });
        var j = await res.json();
        if (j && j.ok) {
          window.__BD_PUSH_REGISTERED__ = token;
          window.__BD_PUSH_REGISTERED_UID__ = uid;
          bdPushPost({ type: 'bd_push_registered', uid: uid, role: role, reason: reason || '' });
          try { console.log('[BD_PUSH] registered ok uid=' + uid + ' role=' + role, reason || ''); } catch (e1) {}
        } else {
          bdPushPost({ type: 'bd_push_register_fail', error: (j && j.error) || 'fail', reason: reason || '', http: res.status });
          try { console.warn('[BD_PUSH] register failed', j, reason || ''); } catch (e2) {}
        }
      } catch (e) {
        bdPushPost({ type: 'bd_push_register_fail', error: String(e && e.message || e), reason: reason || '' });
        try { console.warn('[BD_PUSH] register error', e); } catch (e3) {}
      }
    }

    window.__BD_PUSH_REGISTER_NOW__ = bdRegisterPush;
    bdPushPost({ type: 'bd_push_status', stage: 'bridge_ready', hasToken: !!window.__BD_PUSH_TOKEN__ });
    bdRegisterPush('install');
    // Fast retries after login (staff pages never load bilgilerim.js)
    var n = 0;
    var fast = setInterval(function(){
      bdRegisterPush('fast');
      if (++n >= 40) clearInterval(fast);
    }, 1500);
    setInterval(function(){ bdRegisterPush('keepalive'); }, 30000);
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) bdRegisterPush('visible');
    });
    // Catch SPA-like redirects / history changes after egitmen login
    try {
      var _ps = history.pushState;
      var _rs = history.replaceState;
      history.pushState = function(){ var r = _ps.apply(this, arguments); bdRegisterPush('pushState'); return r; };
      history.replaceState = function(){ var r = _rs.apply(this, arguments); bdRegisterPush('replaceState'); return r; };
      window.addEventListener('popstate', function(){ bdRegisterPush('popstate'); });
    } catch (e4) {}
  } catch (e) {}
})();
true;
`;
}

export function pathFromNotificationData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const url = data.url;
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) {
    try {
      const parsed = new URL(u);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return null;
    }
  }
  return u.startsWith('/') ? u : '/' + u;
}

export type PushOpenPayload = {
  type: 'push_open';
  title: string;
  body: string;
  url: string;
  /** Native notification request id (dedupe across inject retries) */
  id?: string;
  /** Notification category: engagement | package | reminders | ops | broadcast */
  category?: string;
  /** Notification type within category, e.g. birthday, motivation, debt */
  notifType?: string;
};

function strField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return '';
}

/** Extract title/body/url (+ mood fields) from a notification response (cold start + tap). */
export function pushOpenFromResponse(
  response: Notifications.NotificationResponse | null
): PushOpenPayload | null {
  if (!response) return null;
  const content = response.notification.request.content;
  const data = (content.data || {}) as Record<string, unknown>;
  const title = String(content.title ?? data.title ?? '').trim();
  const body = String(content.body ?? data.body ?? '').trim();
  const path = pathFromNotificationData(data);
  if (!title && !body && !path) return null;

  const category = strField(data, 'category').toLowerCase();
  // Prefer explicit notif_type; legacy enqueue used data.type for kind (not bridge type)
  let notifType = strField(data, 'notif_type', 'notifType', 'push_type', 'kind').toLowerCase();
  if (!notifType) {
    const legacy = strField(data, 'type').toLowerCase();
    if (legacy && legacy !== 'push_open' && legacy !== 'bd_push_open') {
      notifType = legacy;
    }
  }

  const nativeId = String(response.notification.request.identifier || '').trim();
  const payload: PushOpenPayload = {
    type: 'push_open',
    title,
    body,
    url: path || '',
  };
  if (nativeId) payload.id = nativeId;
  if (category) payload.category = category;
  if (notifType) payload.notifType = notifType;
  return payload;
}

/** Stable fingerprint for native-side inject dedupe. */
export function pushPayloadFingerprint(payload: PushOpenPayload): string {
  return [
    payload.id || '',
    payload.title || '',
    payload.body || '',
    payload.url || '',
    payload.category || '',
    payload.notifType || '',
  ].join('\n');
}

/** Inject into WebView: open site modal (retries until push-modal.js is ready). */
export function buildPushOpenScript(payload: PushOpenPayload): string {
  const json = JSON.stringify(payload);
  return `
(function(){
  try {
    var payload = ${json};
    var stamp = String(payload.id || '') + '\\n' + String(payload.title || '') + '\\n' + String(payload.body || '');
    // Ignore duplicate inject scripts for the same notification (cold start + onLoadEnd)
    if (window.__BD_PUSH_OPEN_STAMP__ === stamp && window.__BD_PUSH_OPEN_SHOWN__) {
      return;
    }
    window.__BD_PUSH_OPEN_STAMP__ = stamp;
    window.__BD_PUSH_OPEN__ = payload;
    function show(){
      try {
        if (window.bdPushModal && typeof window.bdPushModal.open === 'function') {
          var ok = window.bdPushModal.open(payload);
          if (ok !== false) {
            window.__BD_PUSH_OPEN_SHOWN__ = true;
            window.__BD_PUSH_OPEN__ = null;
            return true;
          }
        }
        // Fallback only if modal API not ready yet (event may be handled later)
        if (!window.bdPushModal) {
          window.dispatchEvent(new CustomEvent('bd:push_open', { detail: payload }));
        }
      } catch (e) {}
      return !!(window.bdPushModal && window.__BD_PUSH_OPEN_SHOWN__);
    }
    if (show()) return;
    if (window.__BD_PUSH_OPEN_RETRY__) {
      clearInterval(window.__BD_PUSH_OPEN_RETRY__);
      window.__BD_PUSH_OPEN_RETRY__ = null;
    }
    var n = 0;
    window.__BD_PUSH_OPEN_RETRY__ = setInterval(function(){
      if (show() || ++n > 50) {
        clearInterval(window.__BD_PUSH_OPEN_RETRY__);
        window.__BD_PUSH_OPEN_RETRY__ = null;
      }
    }, 120);
  } catch (e) {}
})();
true;
`;
}
