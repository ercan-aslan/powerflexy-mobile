# PowerFlexy mobile (Expo)

bdPilates Expo WebView kabuğundan uyarlandı. Uygulama `https://pro.powerflexy.com` açar (iOS + Android tek proje).

## Kurulum

```bash
cd E:\web\powerflexy.com\mobile
npm install
npx expo start
```

## EAS / mağaza

- Expo: https://expo.dev/accounts/ercanaslan3/projects/powerflexy-mobile
- projectId: `fb698c1a-44e6-49cb-a596-a49f76f91e89`
- Bundle / package: `com.powerflexy.app`

### Android APK (indir)

https://expo.dev/artifacts/eas/5nk8qjiHpIHcxGoIMJ4jLxV7Nb65gzh5Pj1H2T3jaT4.apk

Build: https://expo.dev/accounts/ercanaslan3/projects/powerflexy-mobile/builds/d7accd6c-a2f7-4a5e-844f-58d9bdbcec51

### iOS IPA (hazır)

https://expo.dev/artifacts/eas/WVbp8NqEMUq4aylncOhMPHr1qqeffme71GzOnrA-WfM.ipa

Build: https://expo.dev/accounts/ercanaslan3/projects/powerflexy-mobile/builds/2ff92c1f-0dc0-43c2-b1df-49695f911154

### TestFlight

ASC API anahtarı uygulama **oluşturmaya** yetmiyor. App Store Connect’te manuel:

1. https://appstoreconnect.apple.com/apps → **+** → New App
2. Bundle ID: `com.powerflexy.app`
3. Çıkan **Apple ID** (ascAppId) numarasını söyle

Sonra `eas.json` içine `ascAppId` yazılıp submit edilir:

```bash
cd E:\web\powerflexy.com\mobile
set EAS_NO_VCS=1
npx eas-cli@latest submit -p ios --id 2ff92c1f-0dc0-43c2-b1df-49695f911154 --profile production --non-interactive
```

## Yapılandırma

- `extra.siteUrl` = `https://pro.powerflexy.com`
- Push `device_name`: PowerFlexy App

## İkonler

```bash
npm run icons
```
