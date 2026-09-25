# Kế hoạch Xử lý Treo Cảm ứng APK & Đồng bộ Chuẩn Master Data Google Drive

Kế hoạch này giải quyết triệt để 2 vấn đề lớn được người dùng phản ánh trên bản build Android APK:
1. **Gỡ bỏ hoàn toàn cử chỉ vuốt xuống (Pull-to-refresh)** và dọn gọn các nút đồng bộ rời rạc trên giao diện (chỉ giữ nút đồng bộ bên trong hộp thoại Quản lý đồng bộ Google Drive), loại bỏ 100% tình trạng giật lag, xung đột gesture và treo cảm ứng trên WebView Android.
2. **Xử lý dứt điểm hiện tượng nhật ký tất toán "ma"**, bảo đảm file liên kết trên Google Drive là **Master Data (Nguồn sự thật duy nhất)**, đồng thời chỉ đẩy nhật ký lên Drive khi người dùng thực hiện thao tác tất toán thực tế trên ứng dụng.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Toàn bộ các lựa chọn đã được xác nhận trực tiếp qua trao đổi làm rõ:
> - **Giao diện & Thao tác làm mới**: Gỡ bỏ hoàn toàn cơ chế kéo vuốt (`PullToRefreshWrapper`) và các nút đồng bộ phân tán ở thanh điều hướng/header; gom nút đồng bộ duy nhất vào bên trong hộp thoại Quản lý liên kết Google Drive (`DataSyncModal`).
> - **Quy tắc Master Data cho Nhật ký Tất toán**: File Google Drive liên kết đóng vai trò là Master Data duy nhất. Ứng dụng sẽ đồng bộ 2 chiều chính xác: tải nhật ký từ Drive về làm chuẩn, loại bỏ việc tự sinh hoặc hồi sinh các bản ghi tất toán cũ trong bộ nhớ đệm `localStorage`, và chỉ ghi nhận/đẩy nhật ký mới lên Drive khi có hành động tất toán/tái tục thực tế của người dùng.

---

## 1. Tổng quan & Mục tiêu Kỹ thuật

```
┌────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE DRIVE (MASTER DATA)                      │
│   • Trang tính Google Sheets: Danh sách sổ active + Nhật ký tất toán  │
│   • Là Nguồn Sự Thật Duy Nhất (Single Source of Truth)                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         Pull Data  │  Push khi có thao tác thật
                         (Chính xác)│  (Settle / Rollover)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         REACT APPLICATION STATE                        │
│   • Books State (Chỉ chứa sổ Active)                                   │
│   • Settlement Adjustments State (Đồng bộ chuẩn từ file Drive)          │
│   • Không tự nhặt bản ghi rác từ localStorage khi file Drive trống     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GIAO DIỆN NGƯỜI DÙNG (UI/UX)                    │
│   • Mượt mà 100% trên Android: Đã gỡ bỏ touch listeners toàn cục      │
│   • Nút đồng bộ nằm tập trung trong Hộp thoại Google Drive             │
└────────────────────────────────────────────────────────────────────────┘
```

- **Mục tiêu 1**: Khôi phục khả năng phản hồi cảm ứng tức thì 60fps mượt mà cho app Android APK bằng cách gỡ bỏ các sự kiện `touchstart`, `touchmove`, `touchend` toàn cục của `PullToRefreshWrapper`.
- **Mục tiêu 2**: Làm sạch logic đồng bộ nhật ký tất toán (`settlementAdjustments`), triệt tiêu các điều kiện fallback vô tình đọc lại `savings_settlements_v3` cũ rồi ghi đè ngược lên Google Drive.
- **Mục tiêu 3**: Chuẩn hóa bộ lọc trích xuất nhật ký tất toán từ Excel/Sheets matrix (`excelParser.ts`), chỉ nhận diện các hàng có đầy đủ thông tin giao dịch tất toán hợp lệ, loại bỏ hoàn toàn các hàng chú thích/tổng kết nhầm lẫn.

---

## 2. Thiết kế Giao diện & Trải nghiệm Người dùng (UX)

### A. Gỡ bỏ cử chỉ vuốt Pull-to-refresh & Tối ưu hóa Touch Event
- Gỡ bỏ component bọc ngoài `PullToRefreshWrapper.tsx` khỏi `App.tsx`.
- Loại bỏ các thuộc tính `select-none` và event listeners cảm ứng trên thẻ root container để WebView của Android xử lý cuộn trang native mượt mà, không bao giờ bị khóa cảm ứng (touch freeze).

### B. Tinh gọn các nút thao tác Đồng bộ
- Loại bỏ nút icon làm mới/đồng bộ nhanh ở thanh Header trên cùng hoặc các thanh công cụ phụ trợ bên ngoài (tránh gây nhầm lẫn hoặc kích hoạt xung đột mạng).
- Nút bấm **"Đồng bộ ngay"** và **"Kiểm tra & Tải dữ liệu từ Drive"** được đặt chuẩn mực, rõ ràng bên trong Hộp thoại Quản lý Đồng bộ (`DataSyncModal`), nơi người dùng có đầy đủ ngữ cảnh về tài khoản Google đang kết nối và tên file Drive liên kết.

---

## 3. Kiến trúc Đồng bộ & Xử lý Triệt để Nhật ký Tất toán "Ma"

### A. Nguyên nhân phát sinh nhật ký tất toán "ma"
1. **Fallback nhầm từ LocalStorage**: Trong `useDriveSync.ts` và `dataTranslator.ts`, khi danh sách `settlementAdjustments` truyền vào là mảng rỗng `[]`, code cũ có đoạn fallback `if (!adjs || adjs.length === 0) { const saved = localStorage.getItem('savings_settlements_v3'); ... }` dẫn tới việc các bản ghi mẫu hoặc bản ghi từ các phiên thử nghiệm cũ trong máy bị lôi ra và ghi ngược vào file Google Drive.
2. **Parser bảng tính nhận diện thừa hàng**: Trong `excelParser.ts`, việc quét các cột U-AC đôi khi nhận nhầm các dòng ghi chú cuối bảng tính (footer/notes) có chứa ngày tháng hoặc số tiền làm bản ghi tất toán.

### B. Giải pháp xử lý triệt để
1. **Bỏ Fallback nguy hiểm**:
   - Khi file trên Google Drive không có nhật ký tất toán nào, ứng dụng sẽ hiểu chính xác là `[]` (rỗng), lập tức cập nhật state và localStorage thành `[]`, không lôi dữ liệu cũ lên.
   - Khi đẩy lên Drive (`pushBooksToDrive`), chỉ đẩy đúng mảng `settlementAdjustments` hiện tại trong state của phiên làm việc.
2. **Siết chặt điều kiện trích xuất bảng tính (`excelParser.ts`)**:
   - Một dòng chỉ được coi là bản ghi tất toán hợp lệ nếu có đầy đủ: Mã sổ hoặc Tên ngân hàng hợp lệ + Ngày tất toán hợp lệ + Số tiền gốc hoặc Lãi thực nhận > 0.
   - Bỏ qua toàn bộ các dòng tiêu đề, dòng tổng cộng, dòng ghi chú text thông thường.
3. **Thao tác Tất toán có chủ đích**:
   - Chỉ bổ sung bản ghi mới vào danh sách nhật ký khi người dùng nhấn nút **Tất toán** hoặc **Tất toán & Tái tục** trên giao diện sổ tiết kiệm.

---

## 4. Kế hoạch Triển khai & Xác minh (Verification Plan)

### Các bước thực hiện:
1. **Bước 1**: Gỡ bỏ `PullToRefreshWrapper` khỏi `App.tsx`, dọn dẹp các import và touch handlers không cần thiết.
2. **Bước 2**: Tinh chỉnh thanh Header và các view để loại bỏ các nút đồng bộ phân tán, giữ nguyên nút đồng bộ tập trung trong `DataSyncModal`.
3. **Bước 3**: Sửa đổi `useDriveSync.ts`, `dataTranslator.ts`, `excelParser.ts`, và `useSavingsBooks.ts`:
   - Xóa bỏ toàn bộ logic fallback tự động hồi sinh `savings_settlements_v3`.
   - Siết chặt validation trong `extractHistoricalTablesFromMatrix` của `excelParser.ts`.
   - Đảm bảo khi tải dữ liệu từ Google Drive, dữ liệu trên Drive luôn ghi đè chính xác 100% xuống Local (Master Data Priority).
4. **Bước 4**: Kiểm tra biên dịch dự án (`compile_applet`) và chạy thử nghiệm để đảm bảo không còn lỗi cú pháp hoặc runtime.
