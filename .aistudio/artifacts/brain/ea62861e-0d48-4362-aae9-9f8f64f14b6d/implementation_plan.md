# Kế hoạch Triển khai (Cập nhật): Tự động Nhận diện Tệp Sổ Tiết Kiệm qua `appProperties`

Kế hoạch nâng cấp cơ chế nhận diện tệp Sổ Tiết Kiệm trung tâm cho ứng dụng di động **Sổ Tiết Kiệm Gia Đình**, giúp Admin tự động gắn nhãn ẩn và giúp thành viên (User B) tự động nhận diện kho dữ liệu được chia sẻ TỰ ĐỘNG 100% ngầm bên dưới.

---

## Mới Bổ Sung: Cơ chế Tự động Thử lại (Retry Mechanism) Khi Lỗi Mạng

> [!IMPORTANT]
> **Nếu User B mở app gặp lỗi mạng hoặc API gián đoạn, hệ thống có Retry không?**
> **CÓ, CẢ Ở 2 TẦNG**:
> 
> 1. **Tầng Request API (`fetchWithRetry` - Exponential Backoff)**:
>    - Mọi lệnh quét tệp (`scanUserAccessibleVaults`) đều chạy qua bộ bọc `fetchWithRetry`.
>    - Nếu gặp lỗi mạng/timeout (15s), hệ thống tự động **thử lại 3 lần liên tiếp** với độ trễ tăng dần (1s -> 2s -> 4s).
> 
> 2. **Tầng Trạng thái App (Auto-Trigger on Focus & Network Online)**:
>    - Nếu cả 3 lần thử lại đều thất bại do thiết bị hoàn toàn mất mạng (Offline), ứng dụng đăng ký sự kiện lắng nghe:
>      * `window.addEventListener('online', ...)`: Ngay khi thiết bị có mạng trở lại.
>      * `window.addEventListener('focus', ...)`: Ngay khi người dùng chuyển lại vào app.
>    - Hệ thống sẽ **tự động kích hoạt lại tiến trình quét ngầm** để nhận diện và nạp tệp Sổ Tiết Kiệm mới nhất mà người dùng không phải làm gì.

---

## Lựa chọn & Cam kết Yêu cầu từ Bạn

- **Thông tin nhãn `appProperties`**: Được lưu đồng thời ở cả **Google Drive File Metadata** VÀ **tab ẩn `__CONFIG__`** trên Google Sheet (ô `__METADATA_JSON__`).
- **Giao diện người dùng**: **KHÔNG tạo thêm bất kỳ ô nhập hay nút dán link nào**, luồng diễn ra 100% tự động ngầm bên dưới.

---

## Mạch Kiến trúc & Luồng Dữ liệu (100% Tự động ngầm + Retry)

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ADMIN LUỒNG TẠO / LIÊN KẾT                    │
│  1. Bấm "Tạo file mới" hoặc "Chọn file" sẵn có                         │
│  2. App tự động đính `appProperties` vào Drive Metadata               │
│  3. App tự động ghi `appProperties` vào Tab ẩn __CONFIG__ của Sheet    │
│  4. Admin thêm email User B (Cấp quyền Drive Permission)               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        TỆP TẠI GOOGLE DRIVE                           │
│  - Name: "So_Tiet_Kiem_Gia_Dinh.xlsx"                                  │
│  - Permissions: [Admin (owner/writer), User B (reader/writer)]          │
│  - appProperties: { app_id: 'com.tietkiemgiadinh.app', ... }            │
│  - Tab ẩn __CONFIG__: { __METADATA_JSON__: { appProperties: ... } }     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   USER B LUỒNG TỰ ĐỘNG NHẬN DIỆN NGẦM                  │
│  1. Đăng nhập Google Auth trên App                                     │
│  2. Gọi request quét ngầm qua `fetchWithRetry` (Thử lại 3 lần nếu lỗi) │
│     `q = appProperties has { key='app_id' and                          │
│          value='com.tietkiemgiadinh.app' } and trashed = false`        │
│  3. Lắng nghe sự kiện Online/Focus để quét lại tự động nếu mất mạng   │
│  4. Nạp ngay tệp Sổ Tiết Kiệm mới nhất mà KHÔNG cần thao tác thủ công  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Chi tiết các Bước Thực thi (Implementation Steps)

### Bước 1: Khai báo Hằng số Định danh `DRIVE_APP_TAG`
- **Tệp tin**: `src/utils/googleDriveService.ts`
- **Nội dung**: Khai báo hằng số định danh cho ứng dụng Sổ Tiết Kiệm Gia Đình:
  ```typescript
  export const DRIVE_APP_TAG = {
    key: 'app_id',
    value: 'com.tietkiemgiadinh.app',
    typeKey: 'type',
    typeValue: 'savings_vault'
  };
  ```

### Bước 2: Tự động Gắn Nhãn ngầm (Drive File Metadata + Tab `__CONFIG__`)
- **Tệp tin**: `src/utils/googleDriveService.ts`
- **Thực thi**:
  1. Trong `createRealGoogleDriveFile`: Bổ sung `appProperties` vào Multipart Metadata payload khi tạo file mới.
  2. Trong `saveMasterSyncStateToGoogleSheet`: Bổ sung đối tượng `appProperties` vào chuỗi JSON ghi tại ô `__METADATA_JSON__` của tab ẩn `__CONFIG__`.
  3. Trong `setMasterSyncLinked`: Tự động gọi `PATCH` Drive File Metadata để đảm bảo file luôn mang nhãn khi liên kết.

### Bước 3: Tối ưu Luồng Tự động Nhận diện ngầm kèm Retry (`scanUserAccessibleVaults`)
- **Tệp tin**: `src/utils/googleDriveService.ts` & `src/hooks/useDriveSync.ts`
- **Thực thi**:
  1. Xây dựng hàm `scanUserAccessibleVaults(accessToken)` lọc tệp qua `fetchWithRetry` bằng query `appProperties has { key='app_id' and value='com.tietkiemgiadinh.app' } and trashed = false`.
  2. Trong `autoDiscoverLatestCentralHub`: Ưu tiên gọi `scanUserAccessibleVaults` để trả về ngay tệp mới nhất được sửa đổi (`modifiedTime desc`).
  3. Trong `useDriveSync.ts`: Bổ sung listener lắng nghe sự kiện `online` và `focus` để tự động kích hoạt lại `autoDiscoverLatestCentralHub` khi mạng phục hồi.

---

## Kiểm thử & Nghiệm thu (Verification Strategy)

1. **Kiểm tra Tạo tệp & Đồng bộ Tab `__CONFIG__`**:
   - Admin tạo file mới -> Kiểm tra thuộc tính file trên Drive có `appProperties` VÀ ô `__METADATA_JSON__` trong tab `__CONFIG__` cũng lưu thông tin nhãn.
2. **Kiểm tra Tự động Nhận diện ngầm cho User B**:
   - Admin thêm email User B.
   - User B đăng nhập Google Auth -> App tự động quét ngầm, nhận diện và nạp tệp Sổ Tiết Kiệm ngay lập tức.
3. **Kiểm tra Cơ chế Retry & Phục hồi Mạng**:
   - Giả lập đứt mạng tạm thời khi User B mở app -> Kiểm tra log `fetchWithRetry` tự động thử lại 3 lần.
   - Bật lại kết nối mạng / Chuyển lại vào app -> Xác nhận app tự kích hoạt quét lại và nạp tệp thành công.
