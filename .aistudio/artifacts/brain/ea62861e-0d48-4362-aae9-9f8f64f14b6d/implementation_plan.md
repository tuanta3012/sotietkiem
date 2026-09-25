# Kế hoạch Khắc phục Lỗi Đăng nhập Google (Mã 10) trên Android APK

Kế hoạch toàn diện giải quyết triệt để lỗi đăng nhập Google (Mã lỗi 10: `DEVELOPER_ERROR`) trên ứng dụng Android APK khi đóng gói qua GitHub Actions, đồng thời sửa lỗi 404 trang web khi bấm liên kết đồng bộ.

### User Review & Critical Decisions

> [!IMPORTANT]
> Bạn đã xác nhận có cài đặt Secret `RELEASE_KEYSTORE_BASE64` trên GitHub Repo.
> Tuy nhiên, lỗi **Mã 10** xảy ra do 1 trong 2 nguyên nhân cốt lõi sau:
> 1. **Mã SHA-1 của Keystore thực tế chưa được thêm vào Firebase Console**: Khi GitHub Actions biên dịch, nó in ra dòng `SHA1: XX:XX:...`. Mã này phải được dán vào phần **Thêm vân tay (Add fingerprint)** của ứng dụng Android trong Firebase Console.
> 2. **Cấu hình `strings.xml` và `server_client_id` trong Android**: Plugin Capacitor Google Auth yêu cầu tài nguyên `server_client_id` trong Android native để giao tiếp với Google Play Services.

- **Đã xác nhận**: Secret `RELEASE_KEYSTORE_BASE64` đã được cấu hình trên GitHub.
- **Mục tiêu**: Tối ưu mã nguồn Capacitor, luồng xử lý lỗi đăng nhập, cơ chế sao lưu dữ liệu và khắc phục đường link bản Web mở từ ứng dụng Android.

---

### 1. Tổng quan & Bản chất lỗi

- **Hiện tượng**:
  - Khi bấm **Đăng nhập bằng Google** trên file APK cài trên điện thoại, xuất hiện cảnh báo đỏ: *Lỗi xác thực Google trên Android (Mã 10: Mã SHA-1 của APK hoặc Client ID chưa khớp với cấu hình Firebase)*.
  - Khi bấm nút *"Mở bản Web để đồng bộ"*, trình duyệt Chrome mở link và báo lỗi: *Error: Page not found (The requested URL was not found on this server)*.
- **Bản chất**:
  - Mã lỗi 10 (`CommonStatusCodes.DEVELOPER_ERROR`) là mã trả về trực tiếp từ ứng dụng **Google Play Services** của Android khi chữ ký của file APK chạy trên máy không khớp với bất kỳ OAuth 2.0 Client ID Android nào đã đăng ký trên Google Cloud / Firebase Console của dự án `gen-lang-client-0423718439`.
  - Nút *"Mở bản Web để đồng bộ"* đang dẫn tới đường dẫn nội bộ máy chủ dev cũ hoặc không đúng định dạng URL preview công khai.

---

### 2. Kế hoạch Thực hiện Chi tiết

```
┌────────────────────────────────────────────────────────┐
│               QUY TRÌNH KHẮC PHỤC TRIỆT ĐỂ             │
└────────────────────────────────────────────────────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
【1. Sửa Mã Nguồn & Cấu Hình】       【2. Cập Nhật Workflow & SHA-1】
 • Cập nhật `capacitor.config.ts`    • In nổi bật mã SHA-1 trong Log GitHub
 • Đồng bộ `strings.xml` Android      • Hướng dẫn sao chép vào Firebase Console
 • Sửa URL nút "Mở bản Web"          • Đảm bảo Keystore cố định mọi lần build
 • Bổ sung chế độ đăng nhập dự phòng
```

#### Bước 1: Khắc phục cấu hình Native Android & Capacitor
1. **Kiểm tra và chuẩn hóa cấu hình `server_client_id`**:
   - Đảm bảo `capacitor.config.ts` trỏ đúng Web Client ID (`864440372329-fgoo89lqp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com`).
   - Đảm bảo trong `android/app/src/main/res/values/strings.xml` có thẻ `<string name="server_client_id">...</string>` để Google Play Services nhận diện được Web Client ID cho việc cấp token.
2. **Sửa lỗi link "Mở bản Web để đồng bộ"**:
   - Thay thế URL nội bộ cũ bị lỗi 404 bằng đường dẫn chia sẻ công khai chính xác của ứng dụng (`https://ais-pre-ue6i2njozapz2wlld2tvs2-546075383474.asia-southeast1.run.app`).

#### Bước 2: Tối ưu hóa file GitHub Actions (`auto-release.yml`)
1. **In mã SHA-1 rõ ràng trong phần Summary của GitHub Action**:
   - Bổ sung bước hiển thị mã SHA-1 của APK vào `$GITHUB_STEP_SUMMARY` để bạn có thể xem và copy ngay lập tức trên giao diện web của GitHub mà không cần lục tìm trong log.
2. **Khắc phục lỗi giải mã Keystore**:
   - Đảm bảo lệnh `base64 -d` tương thích trên Ubuntu runner, ghi đúng vào `~/.android/debug.keystore` và kiểm tra tính toàn vẹn của file keystore trước khi biên dịch Gradle.

#### Bước 3: Hướng dẫn người dùng thao tác một lần trên Firebase Console
1. Mở trang quản trị [Firebase Console](https://console.firebase.google.com/) -> Dự án của bạn.
2. Vào **Cài đặt dự án (Project settings)** -> cuộn xuống phần **Ứng dụng Android của bạn (`com.tietkiemgiadinh.app`)**.
3. Bấm **Thêm vân tay (Add fingerprint)** -> Dán mã SHA-1 được GitHub Actions in ra vào.
4. Tải file `google-services.json` mới nhất về thay thế (nếu có bổ sung client).

---

### 3. Đánh giá & Rủi ro

- **Tính tương thích**: Giữ nguyên toàn bộ tính năng hoạt động ngoại tuyến (Offline-First) và cơ chế lưu trữ nội bộ bằng IndexedDB/LocalStorage, đảm bảo người dùng vẫn nhập liệu và tính lãi suất bình thường ngay cả khi chưa kết nối mạng.
- **An toàn dữ liệu**: Dữ liệu trên máy không bị ảnh hưởng khi cài đặt bản APK mới đè lên bản cũ nếu dùng chung keystore.
