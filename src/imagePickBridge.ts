import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

export type PickImageRequest = {
  type: 'pickImage';
  requestId?: string;
  target?: string;
  /** Optional: skip ActionSheet and open this source directly. */
  source?: 'library' | 'camera';
};

type PickSource = 'library' | 'camera';

type PickedMealImage = {
  base64: string;
  mime: string;
  name: string;
};

const PICKER_OPTS = {
  mediaTypes: ['images'] as ImagePicker.MediaType[],
  allowsEditing: false,
  quality: 0.7,
  base64: true,
  exif: false,
};

function askPickSource(): Promise<PickSource | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Fotoğraf',
      'Öğün fotoğrafı nasıl eklensin?',
      [
        { text: 'İptal', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Galeriden seç', onPress: () => resolve('library') },
        { text: 'Fotoğraf çek', onPress: () => resolve('camera') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

async function pickFromLibrary(): Promise<PickedMealImage | null> {
  // Android 13+: sistem Photo Picker — READ_MEDIA_* izni yok / gerekmez.
  if (Platform.OS !== 'android') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTS);
  return assetToMealImage(result);
}

async function pickFromCamera(): Promise<PickedMealImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchCameraAsync(PICKER_OPTS);
  return assetToMealImage(result);
}

function assetToMealImage(
  result: ImagePicker.ImagePickerResult
): PickedMealImage | null {
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (!asset.base64) return null;

  const mime = asset.mimeType || 'image/jpeg';
  const ext =
    mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const name = asset.fileName || `meal_${Date.now()}.${ext}`;

  return { base64: asset.base64, mime, name };
}

/**
 * Native meal photo pick for WebView.
 * Uses expo-image-picker (gallery or camera) — never the HTML file-input
 * camera path that kills iOS when usage strings / grants are missing.
 */
export async function pickMealImageBase64(
  preferredSource?: PickSource
): Promise<PickedMealImage | null> {
  const source = preferredSource || (await askPickSource());
  if (!source) return null;

  if (source === 'camera') {
    return pickFromCamera();
  }
  return pickFromLibrary();
}

/** Inject File into #wl_photo (or target) via DataTransfer — WebView-safe. */
export function buildSetPhotoScript(
  target: string,
  base64: string,
  mime: string,
  name: string,
  requestId?: string
): string {
  const payload = JSON.stringify({ target, base64, mime, name, requestId: requestId || '' });
  return `(() => {
  try {
    var p = ${payload};
    var input = document.getElementById(p.target || 'wl_photo');
    if (!input) return true;
    var bin = atob(p.base64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var file = new File([arr], p.name || 'meal.jpg', { type: p.mime || 'image/jpeg' });
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (e1) {
      /* DataTransfer may fail on older WebViews — fall through to custom event */
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      window.dispatchEvent(new CustomEvent('bdNativePhoto', { detail: {
        target: p.target,
        file: file,
        requestId: p.requestId,
        mime: p.mime,
        name: p.name
      }}));
    } catch (e2) {}
  } catch (e) {}
  true;
})();`;
}

export function buildPickDeniedScript(message: string, requestId?: string): string {
  const payload = JSON.stringify({ message, requestId: requestId || '' });
  return `(() => {
  try {
    var p = ${payload};
    window.dispatchEvent(new CustomEvent('bdNativePhotoDenied', { detail: p }));
    if (typeof toast === 'function') toast(p.message, 'warning');
  } catch (e) {}
  true;
})();`;
}

/**
 * Advertise native gallery/camera support.
 * Sets __BD_NATIVE_PICK_IMAGE__ as a callable that posts pickImage,
 * and also as truthy for older web checks that only test !!flag.
 */
export function buildNativePickBridgeFlagScript(): string {
  return `(() => {
  try {
    var post = function (opts) {
      try {
        if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== 'function') return false;
        var o = opts || {};
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pickImage',
          target: o.target || 'wl_photo',
          requestId: o.requestId || ('wl_' + Date.now()),
          source: o.source || undefined
        }));
        return true;
      } catch (e) { return false; }
    };
    window.__BD_NATIVE_PICK_IMAGE__ = post;
    window.__BD_NATIVE_PICK_IMAGE__.toJSON = function () { return true; };
    window.__BD_NATIVE_PICK_IMAGE__.valueOf = function () { return true; };
    try {
      document.documentElement.setAttribute('data-bd-native-pick', '1');
    } catch (e2) {}
  } catch (e) {}
  true;
})();`;
}

export function parsePickImageMessage(raw: string): PickImageRequest | null {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const rec = data as Record<string, unknown>;
    if (rec.type !== 'pickImage') return null;
    const source =
      rec.source === 'camera' || rec.source === 'library' ? rec.source : undefined;
    return {
      type: 'pickImage',
      requestId: typeof rec.requestId === 'string' ? rec.requestId : undefined,
      target: typeof rec.target === 'string' ? rec.target : undefined,
      source,
    };
  } catch {
    /* plain string messages ignored */
  }
  return null;
}

export function platformLabel(): string {
  return Platform.OS;
}
