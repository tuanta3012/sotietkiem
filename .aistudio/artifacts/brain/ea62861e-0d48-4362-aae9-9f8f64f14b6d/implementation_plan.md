# Kế hoạch Triển khai Chi tiết: Tích hợp Picker API Giữ Nguyên 100% Giao diện & Câu chữ Hiện tại

Kế hoạch này phản ánh chính xác yêu cầu trải nghiệm người dùng của bạn: **Giữ nguyên 100% giao diện và các câu chữ hiện tại trong ứng dụng**, tích hợp Google Picker API ở mục *"Bảng tính trên Drive"* khi bấm *"Đồng bộ Google Drive"* đối với luồng Thành viên.

> [!IMPORTANT] Tóm tắt Giải pháp UX Tự nhiên
> 1. **Bảo tồn Giao diện & Chữ hiện tại**:
>    - Không thay đổi bất kỳ nút bấm, nhãn chữ, hay layout nào hiện có trong `DataSyncModal.tsx` và toàn bộ ứng dụng.
> 2. **Tích hợp Tự nhiên cho Thành viên ở Mục "Bảng tính trên Drive"**:
>    - Khi Thành viên bấm *"Đồng bộ Google Drive"*, ở khu vực *"Bảng tính trên Drive"*:
>    - Nhấp chọn file hoặc bấm làm mới sẽ kích hoạt **Google Picker API** (hoặc danh sách file được chia sẻ có dán nhãn `com.tietkiemgiadinh.app`).
>    - Thành viên chạm chọn file -> App tự động cấp quyền `drive.file` và tải/truy xuất dữ liệu ô tính theo đúng phân quyền Admin đã cấp trên Google Drive.
> 3. **Single Scope `drive.file`**:
>    - Chỉ xin duy nhất scope `https://www.googleapis.com/auth/drive.file`.

---

## Decision Log & UX Specifications

- **Giao diện**: Giữ nguyên 100% thiết kế Tailwind CSS, màu sắc, icon, và nhãn chữ hiện tại.
- **Tích hợp ngầm**: Kích hoạt Google Picker API trong danh sách *"Bảng tính trên Drive"* ở `DataSyncModal.tsx`.
- **OAuth Scope**: `https://www.googleapis.com/auth/drive.file` duy nhất.
- **Mã Nhãn Ứng Dụng**: `appProperties: { app_identifier: 'com.tietkiemgiadinh.app' }`.

---

## 1. Chi tiết Luồng Nghiệp vụ Thành viên

1. **Thành viên bấm nút *"Đồng bộ Google Drive"***:
   - Mở `DataSyncModal.tsx` với giao diện hiện tại.
2. **Tại mục *"Bảng tính trên Drive"***:
   - Khi nhấp vào mục hoặc danh sách file, **Google Picker API** được mở ra ở tab *"Được chia sẻ với tôi"* (Shared with me) hiển thị các tệp Google Sheet đã được Admin chia sẻ và có nhãn `com.tietkiemgiadinh.app`.
3. **Thành viên chọn file**:
   - Google tự động trao quyền `drive.file` cho tài khoản Thành viên trên tệp đó.
   - App lập tức đọc dữ liệu sổ thu chi/tài chính từ file về giao diện theo đúng quyền `writer` / `reader` do Admin thiết lập.

---

## 2. Technical Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     React Component Layer                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ DataSyncModal.tsx (Giữ nguyên 100% giao diện & câu chữ)   │  │
│  │ - Mục "Bảng tính trên Drive" kích hoạt Google Picker API  │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
└────────────────────────────────┼────────────────────────────────┘
                                 │ SINGLE SCOPE: drive.file ONLY
┌────────────────────────────────▼────────────────────────────────┐
│                   Google Integration Services                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. googlePickerService.ts (Widget chọn file Shared with me)│  │
│  │ 2. googleDriveService.ts (Drive REST API v3)              │  │
│  │ 3. googleSheetsService.ts (Sheets REST API v4)            │  │
│  └─────────────────────────────┬─────────────────────────────┘  │
└────────────────────────────────┼────────────────────────────────┘
                                 │ HTTPS REST Calls & JS SDK
┌────────────────────────────────▼────────────────────────────────┐
│                       Google Cloud APIs                         │
│  - Google Picker API (google.picker)                            │
│  - Drive REST API v3 (files, permissions, appProperties)        │
│  - Sheets REST API v4 (spreadsheets.values)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Danh sách các File Code Chỉnh sửa

1. **`src/services/googlePickerService.ts`**:
   - Xây dựng Google Picker API hỗ trợ lọc các file có nhãn `com.tietkiemgiadinh.app` thuộc mục Shared with me.
2. **`src/services/googleDriveService.ts`**:
   - Quản lý nhãn `appProperties` và chia sẻ quyền bằng scope `drive.file`.
3. **`src/components/DataSyncModal.tsx`**:
   - Tích hợp gọi Google Picker API trực tiếp từ mục "Bảng tính trên Drive" mà **không làm thay đổi giao diện hay chữ hiện tại**.
