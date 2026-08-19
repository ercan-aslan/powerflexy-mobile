import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation, type WebViewMessageEvent } from 'react-native-webview';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {
  buildPushBridgeScript,
  buildPushOpenScript,
  getExpoPushTokenDetailed,
  pushOpenFromResponse,
  pushPayloadFingerprint,
  type PushOpenPayload,
} from './src/pushNotifications';
import {
  buildNativePickBridgeFlagScript,
  buildPickDeniedScript,
  buildSetPhotoScript,
  parsePickImageMessage,
  pickMealImageBase64,
} from './src/imagePickBridge';
import {
  buildAuthSessionProbeScript,
  buildNativeAuthFlagScript,
  enableBiometricUnlock,
  getUnlockToken,
  parseAuthSessionMessage,
  parseAppleAuthMessage,
  parseGoogleAuthMessage,
  parseUnlockTokenMessage,
  promptBiometric,
  saveUnlockToken,
  startAppleAuth,
  startGoogleAuth,
} from './src/authBridge';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Cream + accent — matches pro.powerflexy.com auth / panel light theme */
const THEME = {
  cream: '#F5F2EB',
  surface: '#FFFCF8',
  ink: '#2A2530',
  muted: '#6B6470',
  accent: '#7C5C9A',
  accentHover: '#6B4F86',
} as const;

const SITE_URL =
  (Constants.expoConfig?.extra?.siteUrl as string | undefined) ||
  'https://pro.powerflexy.com';

const ALLOWED_HOSTS = new Set([
  'pro.powerflexy.com',
  'powerflexy.com',
  'www.powerflexy.com',
]);

/** WKWebView / Android origin allowlist — wildcards match host only. */
const ORIGIN_WHITELIST = [
  'https://*.powerflexy.com',
  'https://powerflexy.com',
  'about:*',
  'data:*',
  'blob:*',
];

const STATIC_ASSET_RE =
  /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|map|json)(\?|$)/i;

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function siteUrlForPath(path: string): string {
  const base = SITE_URL.replace(/\/$/, '');
  if (!path || path === '/') return base + '/';
  return base + (path.startsWith('/') ? path : '/' + path);
}

function ShellLoading() {
  return (
    <View style={styles.loadingOverlay} pointerEvents="none">
      <Image
        source={require('./assets/logo.png')}
        style={styles.loadingLogo}
        resizeMode="contain"
      />
      <ActivityIndicator
        size="large"
        color={THEME.accent}
        style={styles.loadingSpinner}
      />
    </View>
  );
}

function ShellError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.offline} accessibilityRole="summary">
      <Image
        source={require('./assets/logo.png')}
        style={styles.offlineLogo}
        resizeMode="contain"
        accessibilityLabel="PowerFlexy"
      />
      <Text style={styles.errorTitle}>Bağlantı yok</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.retryBtn,
          pressed && styles.retryBtnPressed,
        ]}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Yeniden dene"
      >
        <Text style={styles.retryBtnText}>Yeniden dene</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  const webRef = useRef<WebView>(null);
  const pendingPushRef = useRef<PushOpenPayload | null>(null);
  const pendingJsRef = useRef<string[]>([]);
  const injectedPushFpRef = useRef<string | null>(null);
  const handledPushIdsRef = useRef<Set<string>>(new Set());
  const webReadyRef = useRef(false);
  const loadFailedRef = useRef(false);
  const canGoBackRef = useRef(false);
  const pickingRef = useRef(false);
  const googleBusyRef = useRef(false);
  const wasLoggedInRef = useRef(false);
  const bioBusyRef = useRef(false);
  const webUriRef = useRef(SITE_URL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [webUri, setWebUri] = useState(SITE_URL);

  const injectJs = useCallback((code: string) => {
    if (webReadyRef.current && webRef.current) {
      webRef.current.injectJavaScript(code);
      return;
    }
    pendingJsRef.current.push(code);
  }, []);

  const flushPendingJs = useCallback(() => {
    const queued = pendingJsRef.current;
    pendingJsRef.current = [];
    for (const code of queued) {
      webRef.current?.injectJavaScript(code);
    }
  }, []);

  const navigateWeb = useCallback((target: string) => {
    setLoading(true);
    setError(null);
    if (webRef.current) {
      webRef.current.injectJavaScript(
        `try{window.location.href=${JSON.stringify(target)};}catch(e){};true;`
      );
      webReadyRef.current = false;
      return;
    }
    webReadyRef.current = false;
    webUriRef.current = target;
    setWebUri(target);
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    if (bioBusyRef.current) return;
    const token = await getUnlockToken();
    if (!token) {
      setLocked(false);
      return;
    }
    bioBusyRef.current = true;
    try {
      const r = await promptBiometric();
      if (r === 'ok') {
        const target = `${SITE_URL.replace(/\/$/, '')}/native_unlock.php?t=${encodeURIComponent(token)}`;
        navigateWeb(target);
        setLocked(false);
      } else if (r === 'skipped') {
        setLocked(false);
      }
    } finally {
      bioBusyRef.current = false;
    }
  }, [navigateWeb]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getUnlockToken();
      await SplashScreen.hideAsync();
      if (cancelled) return;
      if (token) setLocked(true);
      setReady(true);
      if (!token) return;
      bioBusyRef.current = true;
      try {
        const r = await promptBiometric();
        if (cancelled) return;
        if (r === 'ok') {
          navigateWeb(
            `${SITE_URL.replace(/\/$/, '')}/native_unlock.php?t=${encodeURIComponent(token)}`
          );
          setLocked(false);
        } else if (r === 'skipped') {
          setLocked(false);
        }
      } finally {
        bioBusyRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigateWeb]);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const run = async () => {
      const { token } = await getExpoPushTokenDetailed();
      if (cancelled) return;
      if (token) {
        setPushToken(token);
        return;
      }
      if (tries < 8) {
        tries += 1;
        setTimeout(run, 2500);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Critical: token often arrives AFTER first WebView load (permission dialog).
  // injectedJavaScriptBeforeContentLoaded only applies on next navigation —
  // re-inject as soon as token is ready so egitmen/uye pages can register.
  useEffect(() => {
    if (!pushToken || !webReadyRef.current) return;
    injectJs(buildPushBridgeScript(pushToken, Platform.OS));
  }, [pushToken, injectJs]);

  /** Single open path: queue + inject once (never immediate AND every onLoadEnd). */
  const queuePushModal = useCallback((payload: PushOpenPayload, opts?: { navigate?: boolean }) => {
    const fp = pushPayloadFingerprint(payload);
    pendingPushRef.current = payload;

    // Navigating to a new URL — wait for onLoadEnd so modal isn't opened then torn down
    if (opts?.navigate) {
      injectedPushFpRef.current = null;
      return;
    }

    // Already injected this exact payload
    if (injectedPushFpRef.current === fp) return;

    // Page not ready yet — onLoadEnd will flush
    if (!webReadyRef.current) return;

    injectedPushFpRef.current = fp;
    injectJs(buildPushOpenScript(payload));
  }, [injectJs]);

  // Notification tap → navigate (if url) + show polished site modal
  useEffect(() => {
    const openFromResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier || '';
      const payload = pushOpenFromResponse(response);
      if (!payload) return;

      // Dedupe by native id, or by content fingerprint when id is empty
      const dedupeKey = id || pushPayloadFingerprint(payload);
      if (handledPushIdsRef.current.has(dedupeKey)) return;
      handledPushIdsRef.current.add(dedupeKey);

      let willNavigate = false;
      if (payload.url) {
        const target = siteUrlForPath(payload.url);
        willNavigate = true;
        navigateWeb(target);
      }
      queuePushModal(payload, { navigate: willNavigate });
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        /* older native builds */
      }
    };

    Notifications.getLastNotificationResponseAsync().then(openFromResponse);
    const sub = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => sub.remove();
  }, [queuePushModal, navigateWeb]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Use ref so the listener always sees latest history state (no stale closure).
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBackRef.current && webRef.current) {
        webRef.current.goBack();
        return true; // consume — do not exit app
      }
      return false; // no WebView history — allow default exit
    });
    return () => sub.remove();
  }, []);

  const onShouldStart = useCallback((req: { url: string }) => {
    const { url } = req;
    // Allow in-page downloads / print fallbacks from the reports UI
    if (
      url.startsWith('about:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return true;
    }
    if (isAllowedUrl(url)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    canGoBackRef.current = !!nav.canGoBack;
    if (nav.url && isAllowedUrl(nav.url)) {
      webUriRef.current = nav.url;
    }
  }, []);

  const injectedBefore = [
    buildNativePickBridgeFlagScript(),
    buildNativeAuthFlagScript(Platform.OS === 'ios'),
    pushToken ? buildPushBridgeScript(pushToken, Platform.OS) : 'true;',
  ].join('\n');

  const onMessage = useCallback(async (ev: WebViewMessageEvent) => {
    // Push bridge status (from injected JS)
    try {
      const raw = ev.nativeEvent.data;
      const msg = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (msg && msg.type === 'bd_push_registered') {
        console.log('[BD_PUSH] web registered', msg);
        return;
      }
      if (msg && msg.type === 'bd_push_register_fail') {
        console.warn('[BD_PUSH] web register fail', msg);
        return;
      }
      if (msg && msg.type === 'bd_push_status') {
        return;
      }
      if (msg && msg.type === 'bd_native_unlock_token') {
        const tok = parseUnlockTokenMessage(raw);
        if (tok) {
          saveUnlockToken(tok)
            .then(() => enableBiometricUnlock())
            .catch(() => {});
        }
        return;
      }
      if (msg && msg.type === 'bd_auth_session') {
        const sess = parseAuthSessionMessage(raw);
        if (sess) {
          if (sess.loggedIn) {
            wasLoggedInRef.current = true;
            enableBiometricUnlock().catch(() => {});
          } else {
            wasLoggedInRef.current = false;
          }
        }
        return;
      }
      if (msg && msg.type === 'bd_apple_auth') {
        const a = parseAppleAuthMessage(raw);
        if (!a || googleBusyRef.current) return;
        googleBusyRef.current = true;
        (async () => {
          try {
            const out = await startAppleAuth(SITE_URL, a);
            if (!out) return;
            if (out.error) {
              const err = JSON.stringify(out.error);
              injectJs(
                `try{if(window.bdShowAuthErr)window.bdShowAuthErr(${err});}catch(e){};true;`
              );
              return;
            }
            const base = SITE_URL.replace(/\/$/, '');
            const target = out.ticket
              ? `${base}/apple_auth.php?ticket=${encodeURIComponent(out.ticket)}`
              : `${base}/${String(out.redirect || '').replace(/^\//, '')}`;
            navigateWeb(target);
          } finally {
            googleBusyRef.current = false;
          }
        })();
        return;
      }
      if (msg && msg.type === 'bd_google_auth') {
        const g = parseGoogleAuthMessage(raw);
        if (!g || googleBusyRef.current) return;
        googleBusyRef.current = true;
        (async () => {
          try {
            const ticket = await startGoogleAuth(SITE_URL, g);
            if (!ticket) return;
            navigateWeb(
              `${SITE_URL.replace(/\/$/, '')}/google_oauth.php?ticket=${encodeURIComponent(ticket)}`
            );
          } finally {
            googleBusyRef.current = false;
          }
        })();
        return;
      }
    } catch {
      /* not JSON — fall through to image pick */
    }

    const pick = parsePickImageMessage(ev.nativeEvent.data);
    if (!pick) return;
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const source =
        pick.source === 'camera' || pick.source === 'library'
          ? pick.source
          : undefined;
      const picked = await pickMealImageBase64(source);
      if (!picked) {
        injectJs(
          buildPickDeniedScript(
            'Kamera/galeri izni gerekli veya seçim iptal edildi.',
            pick.requestId
          )
        );
        return;
      }
      injectJs(
        buildSetPhotoScript(
          pick.target || 'wl_photo',
          picked.base64,
          picked.mime,
          picked.name,
          pick.requestId
        )
      );
    } catch {
      injectJs(
        buildPickDeniedScript(
          'Fotoğraf seçilemedi. Galeri veya kameradan tekrar deneyin.',
          pick.requestId
        )
      );
    } finally {
      pickingRef.current = false;
    }
  }, [injectJs, navigateWeb]);

  const retryConnection = useCallback(() => {
    setError(null);
    setLoading(true);
    loadFailedRef.current = false;
    webReadyRef.current = false;
    canGoBackRef.current = false;
    webRef.current?.reload();
  }, []);

  const onHttpError = useCallback((e: { nativeEvent: { url?: string; statusCode?: number } }) => {
    const statusCode = e.nativeEvent.statusCode ?? 0;
    const url = e.nativeEvent.url ?? '';
    if (statusCode < 400) return;
    try {
      const failed = new URL(url);
      if (!ALLOWED_HOSTS.has(failed.hostname)) return;
      if (STATIC_ASSET_RE.test(failed.pathname)) return;
      const current = new URL(webUriRef.current);
      const isMain =
        failed.pathname === current.pathname || statusCode >= 500;
      if (!isMain) return;
    } catch {
      if (statusCode < 500) return;
    }
    setLoading(false);
    loadFailedRef.current = true;
    webReadyRef.current = false;
    canGoBackRef.current = false;
    setError('Sunucu yanıt vermedi. Biraz sonra tekrar dene.');
  }, []);

  if (!ready) {
    return <View style={styles.boot} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <WebView
          ref={webRef}
          source={{ uri: webUri }}
          style={styles.web}
          originWhitelist={ORIGIN_WHITELIST}
          onNavigationStateChange={onNavChange}
          onShouldStartLoadWithRequest={onShouldStart}
          startInLoadingState
          renderLoading={() => <ShellLoading />}
          renderError={() => (
            <ShellError
              message={error || 'Siteye ulaşılamadı. İnternet bağlantını kontrol et.'}
              onRetry={retryConnection}
            />
          )}
          onLoadEnd={() => {
            setLoading(false);
            if (loadFailedRef.current) {
              return;
            }
            setError(null);
            webReadyRef.current = true;
            webRef.current?.injectJavaScript(buildNativePickBridgeFlagScript());
            webRef.current?.injectJavaScript(buildNativeAuthFlagScript(Platform.OS === 'ios'));
            webRef.current?.injectJavaScript(buildAuthSessionProbeScript());
            if (pushToken) {
              webRef.current?.injectJavaScript(
                buildPushBridgeScript(pushToken, Platform.OS)
              );
            }
            flushPendingJs();
            const pending = pendingPushRef.current;
            if (pending) {
              const fp = pushPayloadFingerprint(pending);
              if (injectedPushFpRef.current !== fp) {
                injectedPushFpRef.current = fp;
                webRef.current?.injectJavaScript(buildPushOpenScript(pending));
              }
              setTimeout(() => {
                if (pendingPushRef.current === pending) {
                  pendingPushRef.current = null;
                }
              }, 4000);
            }
          }}
          onError={() => {
            loadFailedRef.current = true;
            setLoading(false);
            webReadyRef.current = false;
            canGoBackRef.current = false;
            setError('Siteye ulaşılamadı. İnternet bağlantını kontrol et.');
          }}
          onHttpError={onHttpError}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={injectedBefore}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          incognito={false}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          androidHardwareAccelerationDisabled={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
        />
        {loading ? <ShellLoading /> : null}
        {error ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <ShellError message={error} onRetry={retryConnection} />
          </View>
        ) : null}
        {locked ? (
          <View style={styles.lockOverlay} accessibilityViewIsModal>
                <Image
                  source={require('./assets/logo.png')}
                  style={styles.loadingLogo}
                  resizeMode="contain"
                />
                <Text style={styles.errorTitle}>
                  {Platform.OS === 'ios' ? 'Face ID' : 'Parmak izi'}
                </Text>
                <Text style={styles.errorBody}>
                  Giriş için doğrulayın.
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.retryBtn,
                    pressed && styles.retryBtnPressed,
                  ]}
                  onPress={() => {
                    void unlockWithBiometric();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Face ID ile giriş"
                >
                  <Text style={styles.retryBtnText}>
                    {Platform.OS === 'ios' ? 'Face ID ile giriş' : 'Parmak izi ile giriş'}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.passwordLink}
                  onPress={() => setLocked(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Şifre ile devam et"
                >
                  <Text style={styles.passwordLinkText}>Şifre ile devam et</Text>
                </Pressable>
              </View>
            ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: THEME.cream },
  safe: { flex: 1, backgroundColor: THEME.cream },
  web: { flex: 1, backgroundColor: THEME.cream },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.cream,
    paddingHorizontal: 32,
  },
  loadingLogo: {
    width: 180,
    height: 72,
    marginBottom: 20,
  },
  loadingSpinner: {
    marginTop: 4,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.cream,
    paddingHorizontal: 32,
    zIndex: 20,
  },
  passwordLink: {
    marginTop: 16,
    padding: 8,
  },
  passwordLinkText: {
    color: THEME.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  offline: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: THEME.cream,
  },
  offlineLogo: {
    width: 200,
    height: 80,
    marginBottom: 28,
  },
  errorTitle: {
    color: THEME.ink,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  errorBody: {
    color: THEME.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
    maxWidth: 320,
  },
  retryBtn: {
    backgroundColor: THEME.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 160,
    alignItems: 'center',
  },
  retryBtnPressed: {
    backgroundColor: THEME.accentHover,
  },
  retryBtnText: {
    color: '#FFFCF8',
    fontSize: 16,
    fontWeight: '600',
  },
});
