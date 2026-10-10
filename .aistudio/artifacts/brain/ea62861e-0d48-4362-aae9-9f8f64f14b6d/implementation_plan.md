# Kế hoạch tích hợp Google Picker API (Cách 2: Sử dụng API Key riêng)

## Tổng quan
- **Mục tiêu**: Cho phép thành viên chọn file Google Sheet do Admin (`tuanta3012.backup`) chia sẻ thông qua **Google Picker API** trực tiếp giao diện ứng dụng, giải quyết triệt để lỗi thành viên không tìm thấy file do giới hạn scope `drive.file`.
- **API Key được cung cấp**: `AIzaSyAnw7aOX0jaHNAp43xor-RVWHIBh7Jtaos`

## Các bước thực hiện chi tiết

### 1. Cấu hình biến môi trường & Tải Google Picker API Script
- Cập nhật biến `VITE_GOOGLE_API_KEY=AIzaSyAnw7aOX0jaHNAp43xor-RVWHIBh7Jtaos` vào tệp cấu hình / `.env` (hoặc cấu hình trực tiếp trong code khởi tạo Google Picker).
- Tải động (dynamic load) script `https://apis.google.com/js/api.js` khi mở hộp thoại Picker.

### 2. Xây dựng component `GoogleSheetPickerModal`
- Mở modal chọn file trực tiếp trong ứng dụng.
- Yêu cầu người dùng đăng nhập Google Account (thành viên) để lấy OAuth token (`access_token`) với scope `https://www.googleapis.com/auth/drive.file`.
- Sử dụng `google.picker.PickerBuilder`:
  - Đặt API Key: `AIzaSyAnw7aOX0jaHNAp43xor-RVWHIBh7Jtaos`.
  - Đặt OAuth Token của user.
  - Thêm View `google.picker.ViewId.SPREADSHEETS` để lọc các file Google Sheets được chia sẻ với user hoặc do user sở hữu.
  - Thiết lập callback nhận file ID, file Name khi người dùng chọn.

### 3. Tích hợp vào màn hình Đồng bộ / Liên kết sổ
- Thay thế hoặc bổ sung nút "Chọn file Google Sheet (Google Picker)" trong phần đồng bộ của thành viên.
- Khi chọn xong file `file_C`, app tự động lưu `fileId` vào cấu hình đồng bộ, kết nối thành công với dữ liệu thực tế do Admin chia sẻ.

### 4. Kiểm tra & Kiểm thử
- Kiểm tra tài khoản thành viên (`app.hay.ai`) mở Google Picker, thấy danh sách file chia sẻ từ Admin (`tuanta3012.backup`), chọn file `file_C` và đồng bộ dữ liệu thành công.
- Kiểm tra `compile_applet` để đảm bảo không có lỗi TypeScript / build.
