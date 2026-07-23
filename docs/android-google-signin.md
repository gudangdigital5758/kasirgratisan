# Setup Google Sign-In untuk Android (Play Store)

Web memakai Google Identity Services (`@react-oauth/google`). Di WebView Android, GIS
diblokir Google, jadi Android memakai **native sign-in** via
`@capgo/capacitor-social-login` (Android Credential Manager). Keduanya menghasilkan
**Google ID token** dengan audience = **Web Client ID**, sehingga backend tetap satu jalur
(`Authorization: Bearer <idToken>`).

Kode FE sudah siap (`src/lib/google-auth.ts`, branch UI per platform). Yang **wajib Anda
siapkan** di Google Cloud agar login Android berfungsi:

---

## 1. Ambil SHA-1 fingerprint

Login Google Android terikat pada **package name + SHA-1** kunci penandatangan.
Daftarkan **ketiga** SHA-1 ini:

> **`keytool` tidak ada di PATH?** Itu normal — keytool ikut JDK. Pakai yang
> dibundel Android Studio: `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`.
> Atau lebih gampang lagi, pakai Gradle (lihat bagian "Alternatif" di bawah) yang
> tidak butuh keytool di PATH.

### a. Debug (untuk tes di device/emulator)

**Windows PowerShell** (pakai `$env:USERPROFILE`, bukan `%USERPROFILE%`):
```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

**macOS/Linux:**
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

### b. Upload key (keystore rilis Anda)
```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "C:\path\ke\upload-keystore.jks" -alias <alias-anda>
```

### Alternatif (tanpa keytool di PATH) — Gradle signingReport
Dari root project, set JDK ke JBR Android Studio lalu jalankan signingReport:
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android
.\gradlew signingReport
cd ..
```
Output menampilkan SHA-1 & SHA-256 untuk varian `debug` (dan `release` bila keystore rilis sudah dikonfigurasi).

### c. Play App Signing (WAJIB untuk versi yang dirilis Play Store)
Play Console → pilih app → **Setup → App integrity → App signing** →
salin **SHA-1** dari "App signing key certificate".
> Tanpa SHA-1 ini, login **gagal di versi rilis Play Store** meski jalan di debug.

---

## 2. Buat Android OAuth Client ID di Google Cloud

Gunakan **project yang sama** dengan Web Client ID (`...gd7ih98st6vo9sqqni1kmkh4nimoee1i...`).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Application type: Android**.
3. **Package name:** `com.profitku.app`.
4. **SHA-1:** tempel salah satu SHA-1 dari langkah 1.
5. Ulangi (buat client Android terpisah) untuk **tiap** SHA-1: debug, upload, Play App Signing.

> Catatan: Android OAuth client **tidak punya client secret**. Ia hanya mengotorisasi
> app. `idToken` yang dihasilkan tetap ber-`aud` = **Web Client ID**, jadi backend tidak berubah.

---

## 3. Konfigurasi & build

- `webClientId` plugin sudah otomatis memakai `VITE_GOOGLE_CLIENT_ID` (lihat
  `src/lib/google-auth.ts`). Pastikan env ini terisi saat `vite build`.
- Sinkronkan native:
  ```bash
  npm run build
  npx cap sync android
  npx cap open android   # build & run dari Android Studio
  ```
- `@capgo/capacitor-social-login` memakai Credential Manager — **tidak perlu**
  `google-services.json` (bukan Firebase).

---

## 4. Uji

1. Jalankan app di device Android.
2. Settings → **Cloud Backup** → tombol **"Lanjut dengan Google"**.
3. Pilih akun → seharusnya langsung login & profil langganan muncul.

---

## 5. Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| `Error 10` / `DEVELOPER_ERROR` | SHA-1 / package name / project tidak cocok dengan Android OAuth client. |
| `idToken` kosong | `VITE_GOOGLE_CLIENT_ID` (webClientId) tidak terisi saat build. |
| Jalan di debug, gagal di rilis Play Store | SHA-1 **Play App Signing** belum didaftarkan (langkah 1c). |
| Login web normal, Android gagal | Wajar bila langkah 1–2 belum dilakukan; web tidak butuh ini. |

---

## Catatan
- **Push notification** sengaja **belum** diaktifkan di Android (OneSignal Web SDK
  tidak berlaku di WebView). Akan ditambah terpisah dengan plugin OneSignal native + FCM.
- Cloud backup/restore lain (upload, list, download) memakai `fetch` biasa → sudah
  jalan di Android setelah login berhasil.
