# PowerFlexy — Push / FCM

bdPilates’ten kopyalanırken FCM bilinçli olarak alınmamıştı (`google-services.json` / service account). Android’de token için şart.

## Android (yapıldı)

- Firebase proje: `bdpilates-3d9b2` (bdPilates / MystoneINN ile aynı)
- Android app: `com.powerflexy.app`
- `google-services.json` → `mobile/google-services.json` (`app.json` → `android.googleServicesFile`)
- Expo FCM V1: aynı service account Expo Android credentials’a bağlandı
- `fcm-service-account.json` gitignore’da kalır; `google-services.json` EAS upload için ignore dışı

## iOS

- APNs key `T62VL65K47` Expo’da `com.powerflexy.app` ile bağlı
- Provisioning: `aps-environment: production`

## Smoke test

1. Yeni preview APK kur
2. Uygulamadan (Chrome değil) stüdyo + üye girişi + bildirim izni
3. Üst bant: `Push: cihaz kayıtlı`
4. Panel → Bildirimler → Test: “cihaz yok” kalkmalı
