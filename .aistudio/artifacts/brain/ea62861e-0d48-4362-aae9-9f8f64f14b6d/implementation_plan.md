# Chiến Lược Nạp File Từ Host & Live Update OTA - Giải Đáp Thắc Mắc & Quy Trình Song Song

Bản kế hoạch làm rõ 3 câu hỏi quan trọng về **Chính sách Google Play Store**, **Luồng GitHub Actions build APK/AAB song song**, và **Mô hình kết hợp 2 lớp Cập Nhật (Hybrid Dual-Mode)**.

---

## Decision Summary & Confirmed Parameters

> [!IMPORTANT]
> - **Chính sách Google Play**: **100% Tuân thủ & Hợp lệ**. Google cho phép nạp động file HTML/JS/CSS/Assets qua WebView/Capacitor.
> - **Luồng GitHub Actions**: **Build SONG SONG cả file APK + AAB + Bundle ZIP** trong 1 luồng duy nhất (vừa cho user mới cài APK v1.0.5, vừa cho user cũ nhận ZIP hotfix).
> - **Cơ chế Thông báo Cập nhật hiện tại**: **GIỮ NGUYÊN & KẾT HỢP**. Hệ thống dùng mô hình 2 lớp: Live Update cho lỗi nhỏ/giao diện, và Thông báo Update APK/PlayStore cho bản nâng cấp lớn.

---

## 1. Giải Đáp 3 Thắc Mắc Lớn Của Bạn

### ❓ Thắc mắc 1: Cơ chế cập nhật ngầm file bundle zip này có vi phạm chính sách Play Store không?
👉 **TRẢ LỜI: KHÔNG VI PHẠM (Hợp Lệ 100%)**.
- Điều khoản của Google Play Store (mục *Device and Network Abuse*) quy định: **Cho phép các ứng dụng chạy môi trường WebView/JavaScript (như React/Capacitor/Cordova) tự động tải mã JavaScript/HTML/Assets từ Server** để cập nhật nội dung/giao diện.
- **Chỉ bị cấm khi**: Bạn nạp mã thực thi Native C/C++ (.so) hoặc mã Android Binary (.dex) bên ngoài, hoặc cố tình thay đổi bản chất ứng dụng (ví dụ: đăng ký app tiết kiệm nhưng nạp code biến thành app cờ bạc/cho vay).
- Các tập đoàn lớn (như Facebook, Shopee, Grab, Uber) đều áp dụng cơ chế Live Update (CodePush) này cho phần mã React Native / Web của họ.

---

### ❓ Thắc mắc 2: Auto flow GitHub Actions có còn build file APK + AAB v1.0.5 cho user mới cài không?
👉 **TRẢ LỜI: VẪN BUILD ĐẦY ĐỦ VÀ ĐỒNG THỜI CẢ APK + AAB + BUNDLE ZIP!**
Luồng GitHub Actions sẽ tự động thực hiện 3 công việc trong 1 lần push tag `v1.0.5`:

1. **Build APK + AAB v1.0.5**: Để người dùng mới tải trực tiếp APK bản mới nhất hoặc publish lên Google Play Store.
2. **Build Bundle ZIP (`bundle-v1.0.5.zip`)**: File nén nhỏ gọn chứa mã HTML/JS/CSS.
3. **Cập nhật `version.json` trên GitHub Releases**: Để ứng dụng của người dùng cũ (đang ở v1.0.4) tự động tải file ZIP này về cập nhật ngầm chỉ trong vài giây.

---

### ❓ Thắc mắc 3: Có phải bỏ cơ chế auto update và thông báo đã làm trước đây không?
👉 **TRẢ LỜI: KHÔNG BỎ, MÀ KẾT HỢP THÀNH MÔ HÌNH 2 LỚP (HYBRID DUAL-MODE UPDATE)!**

| Loại Cập Nhật | Nội Dung Thay Đổi | Luồng Xử Lý Của Hệ Thống | Trải Nghiệm Người Dùng |
| :--- | :--- | :--- | :--- |
| **Lớp 1: Live Update (Cập nhật tĩnh)** | Sửa lỗi JS, đổi lãi suất ngân hàng, cập nhật giao diện UI, đổi quy tắc sync Drive. | App tự động nạp ngầm file `bundle.zip` (1-2 MB) từ GitHub Releases khi khởi động. | Người dùng **không phải bấm nút nào**, app tự mới ở lần bật tiếp theo. |
| **Lớp 2: Native Store Update (Cập nhật APK)** | Thay đổi plugin Native Capacitor (ví dụ: nâng cấp camera, Bluetooth, đổi SDK Android). | Triggers cơ chế **Thông Báo Auto Update Hiện Tại**: *"Có phiên bản APK Native mới v2.0, vui lòng bấm Tải Về!"* | Hiện popup thông báo báo cho người dùng tải file APK mới hoặc chuyển sang Google Play Store. |

---

## 2. Sơ Đồ Kiến Trúc Luồng GitHub Actions Build Song Song

```
                            Git Push Tag (v1.0.5)
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   GitHub Actions Engine   │
                        └─────────────┬─────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
            ▼                         ▼                         ▼
  ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
  │  Build Web Bundle │     │  Build Android    │     │  Build Android    │
  │  dist/ ➔ ZIP      │     │  APK (App Debug/  │     │  AAB (Google Play │
  │                   │     │  Release)         │     │  Bundle)          │
  └─────────┬─────────┘     └─────────┬─────────┘     └─────────┬─────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      │
                                      ▼
                   ┌─────────────────────────────────────┐
                   │  Publish All Artifacts to           │
                   │  GitHub Releases / Tag v1.0.5       │
                   │  - App-v1.0.5.apk                  │
                   │  - App-v1.0.5.aab                  │
                   │  - bundle-v1.0.5.zip               │
                   │  - version.json                     │
                   └─────────────────────────────────────┘
```

---

## 3. Lộ Trình Triển Khai Tiếp Theo (Implementation Plan)

### Bước 1: Giữ Nguyên & Kết Hợp Service Thông Báo Hiện Tại
- Giữ nguyên cơ chế thông báo cập nhật hiện tại.
- Tích hợp thêm module `liveUpdateService.ts` chạy ngầm ở Lớp 1 (mã tĩnh JS/UI). Nếu Lớp 1 giải quyết được phiên bản (phiên bản JS mới khớp với server), hệ thống sẽ không bật popup thông báo APK ép người dùng nữa.

### Bước 2: Cập Nhật GitHub Actions Workflow
- Bổ sung bước tự động tạo file `bundle-v${VERSION}.zip` và `version.json` đính kèm cùng file APK/AAB lên GitHub Releases.

### Bước 3: Kiểm Thử Đầy Đủ
- Kiểm thử luồng tải ZIP ngầm khi chuyển từ v1.0.4 ➔ v1.0.5.
- Kiểm thử luồng thông báo APK khi phát hiện phiên bản Native thay đổi lớn (ví dụ v2.0.0).

---

## Quyết Định Của Bạn
Toàn bộ thắc mắc đã được giải đáp chi tiết. Bạn vui lòng xem qua và nhấn **Proceed** nếu muốn bắt đầu tích hợp nhé!
