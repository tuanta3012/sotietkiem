# HƯỚNG DẪN ĐÓNG GÓI ỨNG DỤNG TIẾT KIỆM GIA ĐÌNH THÀNH FILE APK

Mã nguồn đã được tích hợp sẵn 100%:
- **Tự động hóa phát hành (CI/CD GitHub Actions)**: File `.github/workflows/auto-release.yml` giúp tự động build APK và upload bản phát hành mới khi push code lên GitHub.
- **Tập tin cấu hình Google Services**: `google-services.json` đã đặt chuẩn tại thư mục gốc và `android/app/google-services.json`.
- **Logo & Bộ Icon ứng dụng**: Đã được đồng bộ đầy đủ các kích thước vào `android/app/src/main/res/mipmap-*`, `resources/`, và `public/stk_app_icon.png`.
- **Màn hình chào (Splash Screen)**: Đã tạo chuẩn theo tông màu xanh lục bảo (Emerald Green) vào `android/app/src/main/res/drawable*`.
- **Bảo mật & Cấu hình Capacitor Android**: Đã cấu hình `package_name: com.tietkiemgiadinh.app`, sinh trắc học vân tay/FaceID, thông báo nhắc hạn, và OAuth Google Drive.

---

## 🤖 Tự động đóng gói & Phát hành APK qua GitHub Actions (Khuyên dùng)

Mã nguồn đã đi kèm workflow `.github/workflows/auto-release.yml`. Khi bạn push mã nguồn mới hoặc tạo tag phiên bản (ví dụ `v1.0.1`) lên repository GitHub (`tuanta3012/sotietkiem`):

1. **GitHub Actions** sẽ tự động thực hiện:
   - Cài đặt Node.js & Java 17
   - Cài đặt thư viện & build Web (`npm run build`)
   - Đồng bộ Capacitor (`npx cap sync android`)
   - Đóng gói file APK bằng Gradle
   - Tự động tạo bản Release trên GitHub và đính kèm file `app-release.apk`
2. Người dùng mở App trên điện thoại sẽ tự động kiểm tra `version.json` trên GitHub và tải bản APK cập nhật mới nhất!

---

## 🚀 Các bước tạo file APK thủ công trên máy tính của bạn

### Bước 1: Yêu cầu chuẩn bị
- Đã cài đặt **Node.js** (phiên bản 18 trở lên).
- Đã cài đặt **Android Studio** (miễn phí từ trang chủ Google).

---

### Bước 2: Chạy các lệnh đồng bộ và mở Android Studio

Mở Terminal (hoặc CMD/PowerShell) tại thư mục mã nguồn đã giải nén ZIP và chạy các lệnh:

```bash
# 1. Cài đặt các thư viện cần thiết
npm install

# 2. Biên dịch giao diện Web sang thư mục dist
npm run build

# 3. Đồng bộ mã nguồn và plugin vào thư mục android đã có sẵn
npx cap sync

# 4. Mở trực tiếp dự án bằng Android Studio
npx cap open android
```

*(Lưu ý: Thư mục `android/` đã được tạo sẵn đầy đủ trong mã nguồn ZIP, bạn chỉ cần chạy `npx cap sync` mà không cần phải gõ `npx cap add android` nữa).*

---

### Bước 3: Build thành file APK trong Android Studio

Khi Android Studio mở ra:
1. Chờ Android Studio đồng bộ xong Gradle (khoảng 1 - 2 phút). `google-services.json` sẽ tự động được plugin Google Services nhận diện.
2. Trên thanh menu trên cùng của Android Studio:
   - Chọn **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.
3. Khi quá trình build hoàn tất, Android Studio sẽ hiển thị thông báo góc dưới:
   - Bấm vào link **locate** để mở thư mục chứa file **app-debug.apk** (hoặc `app-release.apk` nếu bạn ký keystore).
4. Chép file `.apk` này vào điện thoại Android của bạn và cài đặt!

---

## 🔒 Kiểm tra vị trí file cấu hình quan trọng trong project

1. `android/app/google-services.json`: File chứng thực Firebase & Google Auth cho Android app.
2. `google-services.json`: File dự phòng tại thư mục gốc.
3. `android/app/src/main/res/mipmap-*`: Toàn bộ bộ icon ứng dụng (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi).
4. `android/app/src/main/res/drawable*`: Toàn bộ bộ ảnh màn hình chờ Splash Screen.
5. `resources/icon.png` và `resources/splash.png`: Asset gốc chất lượng cao (1024x1024 và 2732x2732).

---

## 💡 Xử lý lỗi "Something went wrong" (Mã lỗi 10) khi Đăng nhập Google trên APK

Lỗi `Something went wrong` (mã trạng thái 10 hoặc 12500 trong Google Play Services) xuất hiện khi **mã băm chứng chỉ SHA-1** của file APK cài trên máy không trùng khớp với mã SHA-1 được đăng ký trong Firebase Console / Google Cloud Console.

### Cách 1: Sử dụng ngay chế độ Ngoại tuyến (Offline - Khuyên dùng)
- Bấm nút **"Sử dụng ngay (Sao lưu và đồng bộ trên máy)"**: Bạn được vào ngay ứng dụng, sử dụng đầy đủ 100% tính năng quản lý sổ, tính lãi suất, huy động vốn, bảo mật vân tay/FaceID mà không bị gián đoạn hay phụ thuộc mạng.

### Cách 2: Lấy mã SHA-1 của APK và thêm vào Firebase Console
1. **Nếu build qua GitHub Actions**:
   - Vào tab **Actions** trên GitHub `tuanta3012/sotietkiem` $\rightarrow$ bấm vào lần chạy build APK gần nhất $\rightarrow$ mở bước **Build Android APK**.
   - Tại dòng `=== APK SIGNING KEY FINGERPRINTS ===`, bạn sẽ thấy mã SHA-1 (dạng `XX:XX:XX:...`).
2. **Nếu build qua Android Studio**:
   - Ở cột bên phải Android Studio, mở tab **Gradle** $\rightarrow$ `app` $\rightarrow$ `Tasks` $\rightarrow$ `android` $\rightarrow$ double-click vào `signingReport`.
   - Cửa sổ Run ở dưới sẽ in ra mã `SHA1` của `debug` hoặc `release`.
3. **Thêm vào Firebase Console**:
   - Vào [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ Chọn dự án của bạn $\rightarrow$ **Project Settings (Cài đặt dự án)** $\rightarrow$ Cuộn xuống mục **Your apps (Ứng dụng của bạn)** $\rightarrow$ Chọn ứng dụng Android `com.tietkiemgiadinh.app`.
   - Bấm **Add fingerprint (Thêm dấu vân tay)** và dán mã SHA-1 vừa lấy được.
   - Tải lại file `google-services.json` mới về và lưu đè vào `android/app/google-services.json`.
