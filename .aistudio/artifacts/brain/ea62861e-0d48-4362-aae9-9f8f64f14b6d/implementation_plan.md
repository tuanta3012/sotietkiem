# Kế hoạch Thiết lập Trang Chính sách Bảo mật & Chuẩn bị Phát hành Song song

## 1. Tích hợp Trang Chính sách Bảo mật (Privacy Policy)
- **Phương án thực hiện:**
  - Tạo file `public/privacy.html` chứa nội dung chính sách bảo mật chuẩn quốc tế và tiếng Việt dành cho ứng dụng cá nhân/gia đình sử dụng Google Drive API.
  - **Thông tin liên hệ:** Kết hợp trang hỗ trợ GitHub Issues (`github.com/tuanta3012/sotietkiem/issues`) và email hỗ trợ chính thức **`sotietkiem.support@gmail.com`** để đáp ứng đúng quy định của Google Play.
  - **Cách hoạt động:** Khi dự án build và sync qua GitHub, tệp này sẽ nằm ở đường dẫn công khai (ví dụ: `https://tuanta3012.github.io/sotietkiem/privacy.html` hoặc link trang host của bạn) để khai báo trực tiếp trên Google Play Console.

## 2. Thích ứng Cơ chế Cập nhật Phiên bản (Adaptive App Update)
- **Phương án thực hiện:**
  - Cấu hình ứng dụng để tự động phát hiện nguồn cài đặt (Installer Source):
    - Nếu cài đặt qua Google Play Store (hoặc các kho ứng dụng chính thống), ứng dụng sẽ tự động ẩn thông báo cập nhật in-app (để tuân thủ nghiêm ngặt chính sách của Google Play, tránh bị gỡ app).
    - Nếu cài đặt qua file APK tải trực tiếp, ứng dụng giữ nguyên tính năng kiểm tra bản cập nhật và tải APK mới từ GitHub Releases.

## 3. Cấu hình Hệ thống Đóng gói Song song (CI/CD Workflow)
- **Phương án thực hiện:**
  - Cấu hình file `.github/workflows/auto-release.yml` để tạo ra hai tệp bản dựng mỗi khi bạn push code lên `main`:
    - **File APK (`sotietkiem_v1.0.xx.apk`):** Bản cài đặt trực tiếp, tự kích hoạt thông báo cập nhật khi có bản mới.
    - **File AAB (`sotietkiem_v1.0.xx.aab`):** Bản đóng gói tối ưu để tải lên Google Play Console, tự ẩn thông báo cập nhật để an toàn tuyệt đối.
    - **Chữ ký số (Keystore):** Đồng nhất 1 chữ ký số cố định cho cả hai bản build để thuận tiện quản lý SHA-1 trên Firebase.
