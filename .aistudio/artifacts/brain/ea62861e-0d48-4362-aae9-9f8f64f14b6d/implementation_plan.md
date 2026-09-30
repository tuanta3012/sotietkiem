# Kế hoạch Tổng thể Rà soát, Tối ưu hóa & Chuẩn bị Phát hành (Production Release Plan)

## 1. Chuẩn hóa Định dạng Số & Tỷ lệ Lãi suất (Number Formatting Standardization)
- **Thống nhất quy tắc định dạng:**
  - **Dấu chấm (`.`):** Dùng làm phân cách hàng nghìn (Ví dụ: `1.000.000 VNĐ`, `100.000.000`).
  - **Dấu phẩy (`,`):** Dùng làm phân cách số đơn vị với số thập phân (Ví dụ: `6,55%`, `8,20%`, `1,08` triệu).
- **Phạm vi rà soát và chỉnh sửa:**
  - `src/utils/formatters.ts`: Đảm bảo các hàm `formatPercent`, `formatDecimal`, `formatCurrency` hoạt động chuẩn xác theo chuẩn `vi-VN`.
  - `src/utils/dataTranslator.ts` & `src/utils/excelParser.ts`: Đảm bảo khi đọc/ghi dữ liệu từ Google Sheets, số liệu không bị hiểu sai giữa dấu chấm và dấu phẩy.
  - Các màn hình hiển thị UI (`ExcelSheetView.tsx`, `InterestCalculationView.tsx`, `SavingsBookModal.tsx`, v.v.): Thay thế toàn bộ các hàm `.toFixed()` trực tiếp bằng hàm chuẩn hóa `formatPercent` và `formatDecimal`.

## 2. Dọn dẹp Code Rác, File Tạm & Assets Không Sử Dụng (Junk & Unused Asset Cleanup)
- **Xóa file rác/tạm:**
  - Xóa file tạm `auto_update_feature_code.txt` ở thư mục gốc project.
  - Rà soát thư mục `public/assets` và `src/assets` để xóa bỏ các icon/hình ảnh dư thừa không được import trong code.
- **Tối ưu hóa Log & Dead Code:**
  - Thu gom và dọn dẹp các lệnh `console.log` / `console.debug` thừa trong môi trường Production.
  - Rà soát xóa bỏ các hàm, component hoặc import không còn sử dụng.

## 3. Quản lý Bộ Nhớ Đệm & Tối Ưu Hiệu Năng (Cache Cleanup & Performance Optimization)
- **Cơ chế Tự động Dọn dẹp Bộ nhớ tạm (Auto Cache Cleanup on Startup):**
  - Thêm cơ chế dọn dẹp bộ nhớ đệm tạm thời (temp cache, stale sync timestamps, old local storage keys) tự động mỗi khi người dùng mở ứng dụng.
  - **Bảo toàn 100% cơ chế đồng bộ Google Drive:** Giữ nguyên quy trình đồng bộ tự động, không làm gián đoạn token hoặc luồng lưu trữ trên Google Drive.
- **Tối ưu Hiệu năng & Dung lượng Build:**
  - Kiểm tra và tinh chỉnh cấu hình build Web / Mobile (Capacitor) để giảm thiểu dung lượng file bundle APK/Web.

## 4. Báo cáo & Kiểm thử Biên dịch (Verification & Build Check)
- Chạy `compile_applet` và `npm run build` để đảm bảo không còn bất kỳ lỗi TypeScript, Vite hay Capacitor nào.
- Kiểm tra tính hoàn thiện của ứng dụng trước khi phát hành chính thức.
