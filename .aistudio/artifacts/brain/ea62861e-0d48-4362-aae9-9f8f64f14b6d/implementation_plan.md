# Kế hoạch Đóng Gói Keystore Cố Định Trực Tiếp Vào Repository

Nhận định của bạn hoàn toàn chính xác! Khi build trực tiếp bằng **Android Studio trên máy tính**, Android Studio dùng trực tiếp file `debug.keystore` chuẩn trên máy của bạn (có mã SHA-1 `4C:01:EF:4E:B3:77:59:57:C7:00:0B:4E:8C:2C:BF:BD:A4:BA:54:88` đã được khai báo sẵn trong `google-services.json`).

Trong khi đó, trên **GitHub Actions**, việc giải mã chuỗi Base64 từ GitHub Secrets qua môi trường dòng lệnh Linux (base64 -d) thường xuyên gặp các lỗi:
1. Thiếu ký tự đệm `=`, ngắt dòng ẩn `\r\n` khiến file keystore sinh ra bị lỗi định dạng.
2. Khi file giải mã bị lỗi, Gradle âm thầm tự sinh một keystore ngẫu nhiên mới để tiếp tục build, dẫn đến file APK có mã SHA-1 lạ khiến Google từ chối (Mã 10).

---

### User Review & Critical Decisions

> [!IMPORTANT]
> **Giải pháp tối ưu & triệt để nhất**:
> - Tạo một file `debug.keystore` chuẩn cố định ngay trong thư mục mã nguồn dự án (`keystore/debug.keystore`).
> - Cấu hình Gradle chỉ định trực tiếp đến file này (`signingConfigs.debug.storeFile = file(...)`).
> - Bằng cách này, **100% mọi lượt build trên GitHub Actions hay bất kỳ máy tính nào** đều sử dụng chung một file keystore duy nhất, tạo ra mã SHA-1 cố định vĩnh viễn, không phụ thuộc vào GitHub Secrets.

- **Lựa chọn đã xác nhận**: Tạo file Keystore cố định ngay trong repository.

---

### 1. Chi tiết Các Bước Thực Hiện

```
┌────────────────────────────────────────────────────────┐
│         GIẢI PHÁP KEYSTORE CỐ ĐỊNH TRONG REPO          │
└────────────────────────────────────────────────────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
【1. Tạo Keystore Cố Định】           【2. Cấu hình Gradle & Workflow】
 • Tạo file `keystore/debug.keystore`  • Cấu hình cứng `build.gradle`
 • Trích xuất mã SHA-1 chuẩn           • Bỏ phụ thuộc GitHub Secrets Base64
 • Thêm mã SHA-1 vào Firebase Console  • GitHub Actions luôn ký ra mã cố định
```

#### Bước 1: Tạo file Keystore cố định trong mã nguồn
1. Khởi tạo thư mục `keystore/` trong dự án.
2. Sinh file `keystore/debug.keystore` với alias `androiddebugkey` và mật khẩu chuẩn `android`.
3. Trích xuất chính xác mã **SHA-1** của file keystore này và thông báo cho bạn để kiểm tra với Firebase Console.

#### Bước 2: Cấu hình `auto-release.yml` và Gradle
1. Loại bỏ hoàn toàn bước giải mã Base64 phức tạp trong `auto-release.yml`.
2. Sao chép `keystore/debug.keystore` vào thẳng thư mục `android/app/debug.keystore` và `~/.android/debug.keystore`.
3. Ép cấu hình `android/app/build.gradle` trỏ trực tiếp đến `debug.keystore` này khi đóng gói APK.

#### Bước 3: Xác minh & Thử nghiệm
1. Build test thử nghiệm và in mã SHA-1.
2. Đảm bảo SHA-1 được đăng ký trên Firebase Console.
3. Khi bạn tải APK mới từ GitHub Actions về, đăng nhập Google sẽ hoạt động hoàn hảo y hệt như khi bạn build từ Android Studio.
