# Hướng Dẫn Cấu Hình Google Apps Script Webhook (Gửi Email Lời Mời Tự Động)

Dự án sử dụng Google Apps Script hoàn toàn miễn phí (chạy bằng tài khoản Gmail của bạn) để gửi email lời mời kèm liên kết Deep Link thông minh đến các thành viên được chia sẻ.

---

## 🚀 CÁC BƯỚC TRIỂN KHAI NHANH (Trong 2 phút):

### Bước 1: Tạo dự án Apps Script
1. Truy cập: [https://script.google.com/](https://script.google.com/)
2. Bấm nút **"Dự án mới" (New project)**.
3. Đặt tên dự án (góc trên bên trái): `SoTietKiem_InviteMailer`.

### Bước 2: Dán mã nguồn `Code.gs`
1. Mở file `Code.gs` trong trình soạn thảo của Google Apps Script.
2. Xóa nội dung mặc định và sao chép toàn bộ nội dung từ tệp `google_apps_script/Code.gs` của dự án này dán vào.
3. Bấm biểu tượng **Lưu (Save / Ctrl+S)**.

### Bước 3: Triển khai dưới dạng Web App
1. Bấm nút **"Triển khai" (Deploy)** ở góc trên bên phải > Chọn **"Tùy chọn triển khai mới" (New deployment)**.
2. Chọn biểu tượng bánh răng bên cạnh "Chọn loại" > Chọn **"Ứng dụng web" (Web App)**.
3. Cấu hình chính xác các mục sau:
   - **Mô tả (Description)**: `Webhook Gửi Email Mời v1.0`
   - **Thực thi dưới dạng (Execute as)**: `Tôi (your-email@gmail.com)` *(Rất quan trọng! Để email gửi từ chính tài khoản Gmail của bạn)*
   - **Ai có quyền truy cập (Who has access)**: `Bất kỳ ai (Anyone)` *(Để ứng dụng trên điện thoại có thể gọi webhook POST mà không bị chặn)*
4. Bấm nút **"Triển khai" (Deploy)**.

### Bước 4: Cấp quyền Gmail (Chỉ làm lần đầu)
1. Google sẽ hiển thị hộp thoại yêu cầu cấp quyền: Bấm **"Ủy quyền truy cập" (Authorize access)**.
2. Chọn tài khoản Gmail của bạn.
3. Nếu thấy cảnh báo "Google chưa xác minh ứng dụng này" (Google hasn't verified this app):
   - Bấm vào dòng chữ nhỏ **"Nâng cao" (Advanced)** ở góc dưới.
   - Bấm tiếp vào **"Đi tới SoTietKiem_InviteMailer (không an toàn)" (Go to ...)**.
   - Bấm **"Cho phép" (Allow)**.

### Bước 5: Lấy Web App URL và dán vào Ứng dụng
1. Sau khi triển khai thành công, Google sẽ cung cấp **URL ứng dụng web (Web App URL)** (dạng `https://script.google.com/macros/s/AKfycbx.../exec`).
2. Sao chép URL này.
3. Mở ứng dụng **Sổ Tiết Kiệm** > Vào mục **Cài đặt** > **URL Webhook Lời Mời** > Dán URL vào và bấm **Lưu**.

---

## 🎯 CƠ CHẾ HOẠT ĐỘNG
1. Khi Admin thêm thành viên mới (hoặc bấm "Gửi lại email mời"), App sẽ gửi yêu cầu HTTP POST đến Web App URL này.
2. Google Apps Script tự động kích hoạt `GmailApp.sendEmail()` gửi một email HTML giao diện sang trọng, chuyên nghiệp kèm nút bấm:
   `https://tuanta3012.github.io/sotietkiem/connect.html?fileId=<FILE_ID>&workspaceName=<NAME>`
3. Thành viên bấm vào nút trong email -> Điện thoại tự động kích hoạt ứng dụng qua Deep Link `sotietkiem://connect?fileId=...` -> Nạp và liên kết dữ liệu ngay lập tức!
