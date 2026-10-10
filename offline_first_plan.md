# Kế hoạch nâng cấp kiến trúc lưu trữ Offline-First (@capacitor/filesystem) & Cơ chế Xử lý Xung đột Đệm đồng bộ Chuẩn xác

## 1. Phân tích Chuyên sâu: Trạng thái Login, Token Drive & Vùng đệm Đồng bộ

### 1.1. Duy trì login tự động và token Drive có giải quyết triệt để được không?
- **Khẳng định**: **Không thể giải quyết triệt để 100% nếu chỉ trông cậy vào Token Google Drive**, bởi các lý do kỹ thuật nền tảng:
  1. **Vòng đời hữu hạn của Access Token**: Token truy cập của Google chỉ có hiệu lực tối đa 1 giờ (3600 giây).
  2. **Rào cản khi Offline**: Dù ứng dụng có lưu Refresh Token an toàn, việc xin cấp mới token (Silent Refresh) bắt buộc phải có kết nối Internet gửi tới máy chủ Google (`oauth2.googleapis.com`). Khi thiết bị mất mạng hoặc đi vào vùng sóng yếu, token hết hạn sẽ không thể làm mới ngay được.
  3. **Kết nối không liền mạch (Network Flakiness)**: Google Drive API có thể trả về lỗi mạng tạm thời (Timeout, HTTP 429 Rate Limit, HTTP 503 Server Unavailable).
- **Kết luận**: Duy trì Token và Session chỉ giúp ứng dụng *không bắt người dùng phải đăng nhập lại bằng tay khi có mạng*. Để ứng dụng vận hành trơn tru trong mọi điều kiện, **BẮT BUỘC PHẢI CÓ VÙNG ĐỆM ĐỒNG BỘ CỤC BỘ (Local Sync Outbox Buffer)**.

---

## 2. Kiến trúc Giải pháp: Vùng đệm Outbox & Xử lý Xung đột Cấp bản ghi

```
[Thao tác Người dùng: Thêm / Sửa / Xóa / Tất toán]
                      │
                      ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 1. Ghi tức thì vào Bộ nhớ máy (@capacitor/filesystem)    │
 │    - savings_books.json & settlements.json              │
 │    - Cập nhật State React ngay lập tức (0ms delay)      │
 └────────────────────────────┬────────────────────────────┘
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 2. Đưa vào Vùng đệm Cục bộ (sync_outbox.json)          │
 │    - Lưu danh sách thay đổi chờ gửi (Pending Mutations) │
 │    - Gắn cờ syncStatus: 'pending'                       │
 └────────────────────────────┬────────────────────────────┘
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 3. Tiến trình Đồng bộ Ngầm (Background Sync Worker)     │
 │    - Kiểm tra: Có mạng? + Token hợp lệ (Auto-refresh)?  │
 │    ├─ KHÔNG CÓ MẠNG / LỖI TOKEN:                        │
 │    │  => Giữ nguyên trong Outbox, thử lại khi Online    │
 │    └─ CÓ MẠNG & TOKEN HỢP LỆ:                           │
 │       => Tải dữ liệu Drive mới nhất                     │
 │       => Thực hiện Record-Level Merge (Gộp chuẩn xác)   │
 │       => Đẩy lên Sheets & Dọn dẹp Outbox                │
 └─────────────────────────────────────────────────────────┘
```

---

## 3. Thiết kế Kỹ thuật Chi tiết

### 3.1. Vùng đệm Đồng bộ Cục bộ (`sync_outbox.json`)
- **Vị trí lưu trữ**: Thư mục an toàn `Directory.Data` thông qua `@capacitor/filesystem`.
- **Cấu trúc bản ghi đệm (`OutboxMutation`)**:
  ```typescript
  interface OutboxMutation {
    id: string;              // UUID duy nhất của thao tác đệm
    timestamp: number;       // Thời điểm thao tác (epoch ms)
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SETTLE';
    targetBookId: string;
    bookData?: SavingsBook;
    settlementData?: SettlementAdjustment;
    retryCount: number;
    lastError?: string;
  }
  ```
- **Nguyên tắc hoạt động**:
  - Khi người dùng thực hiện bất kỳ thao tác nào, ứng dụng lưu ngay vào tệp dữ liệu chính (`savings_books.json`) VÀ ghi thêm 1 bản ghi vào `sync_outbox.json`.
  - Nếu thiết bị mất mạng, token hết hạn hoặc Drive bị gián đoạn, thao tác nằm an toàn trong `sync_outbox.json`. **Không bao giờ bị thất lạc dữ liệu**.

### 3.2. Thuật toán Xử lý Xung đột Chuẩn xác Cấp độ Bản ghi (Granular Record-Level Merging)
- **Vấn đề của cơ chế cũ**: Trước đây, khi cả máy và Drive đều có thay đổi, ứng dụng bắt chọn "Giữ bản máy" hoặc "Giữ bản Drive". Nếu Vợ thêm sổ A lúc mất mạng, Chồng thêm sổ B trên Drive, chọn 1 trong 2 sẽ làm mất sổ của người kia!
- **Cơ chế Hợp nhất Thông minh Mới (3-Way / Record-Level Merge)**:
  1. **Tự động Gộp Sổ khác nhau (Non-overlapping Books)**:
     - Sổ mới do Vợ thêm trên máy (có ID riêng) và Sổ mới do Chồng thêm trên Drive (có ID riêng) sẽ được **tự động gộp lại (Union)**. Cả hai sổ đều được lưu giữ đầy đủ.
  2. **Xử lý Sổ bị Xóa (Tombstone / Soft-Delete Mechanism)**:
     - Khi một thành viên xóa sổ, hệ thống không chỉ xóa cục bộ mà lưu lại một "vết xóa" (`deletedBookIds` kèm timestamp) trong Outbox.
     - Khi đồng bộ, sổ đó sẽ bị xóa trên Google Sheets và không bị tình trạng "hồi sinh" khi tải dữ liệu về.
  3. **Xung đột trên CÙNG 1 Cuốn Sổ (Same-Book Modification)**:
     - So sánh `updatedAt` của từng sổ cụ thể. Bản ghi có mốc thời gian cập nhật gần nhất được ưu tiên (Last-Write-Wins per record).
     - **Ưu tiên Tất toán**: Nếu một bên đã thực hiện tất toán cuốn sổ, trạng thái tất toán và bản ghi tất toán luôn được ưu tiên bảo toàn để tránh tính sai lãi và số dư gia đình.
  4. **Dữ liệu Tất toán (`settlementAdjustments`)**:
     - Là cấu trúc Append-Only: Tự động hợp nhất không xung đột dựa trên mã giao dịch duy nhất `id` qua hàm `deduplicateSettlementAdjustments()`.
  5. **Chỉ cảnh báo người dùng (Conflict Modal)**:
     - Chỉ kích hoạt hộp thoại chọn lựa khi thực sự xảy ra xung đột không thể giải quyết tự động (ví dụ: cả 2 người cùng sửa số tiền gốc hoặc lãi suất của cùng 1 sổ trong cùng một khoảng thời gian).

### 3.3. Quản lý Phiên đăng nhập & Tự động Gia hạn Token Ngầm
- **Khởi động ứng dụng**:
  - Đọc thông tin người dùng từ bộ nhớ an toàn (`restoreGoogleAuthSession()`).
  - Chỉ coi token còn hợp lệ khi có hạn dùng hợp lệ và còn ít nhất 5 phút.
  - Trên Android Native, `GoogleAuth.refresh()` xin access token mới qua tài khoản Google trên thiết bị; đây **không phải OAuth refresh token dài hạn**.
  - Trên Web, Firebase có thể duy trì phiên Firebase nhưng không tự gia hạn Google Drive access token; khi token Drive hết hạn, ứng dụng cần người dùng cấp quyền lại.
- **Nếu làm mới token thất bại do mất mạng**:
  - Không đăng xuất người dùng!
  - Ứng dụng vẫn duy trì phiên làm việc bình thường ở trạng thái: *"Chế độ Ngoại tuyến (Đang chờ kết nối lại Drive)"*.
  - Người dùng xem và sử dụng bình thường.
- **Khi Drive trả HTTP 401**:
  - Android thử làm mới access token một lần và chỉ gửi lại request một lần.
  - Lỗi 403 quyền/scope không bị coi là token hết hạn; request dạng stream không được tự gửi lại.
- **Lắng nghe sự kiện khôi phục kết nối (Auto-Reconnect Listener)**:
  - Lắng nghe sự kiện `online` của thiết bị (`window.addEventListener('online')` và `@capacitor/network`).
  - Khi có mạng trở lại: Tự động chạy tiến trình làm mới token ngầm -> Quét và xả toàn bộ hàng đợi `sync_outbox.json` lên Google Drive.

### 3.4. Trải nghiệm Khởi động Tức thì (Zero-Friction Startup)
- **Splash Screen ngắn gọn (~1.0s)**:
  - Hiển thị logo ứng dụng, thương hiệu Sổ Tiết Kiệm.
  - Chạy ngầm việc nạp dữ liệu từ `@capacitor/filesystem` vào bộ nhớ RAM.
  - Chạy ngầm khôi phục session.
  - Hết 1.0s: Chuyển ngay vào màn hình chính, không có bất kỳ màn hình LoginModal nào chặn lối.
- **Trạng thái kết nối hiển thị tinh tế**:
  - Trên thanh tiêu đề (Header): Hiển thị huy hiệu trạng thái nhỏ:
    - 🟢 *Đã đồng bộ Drive mới nhất*
    - 🟡 *Có thay đổi chờ gửi (Đang đồng bộ ngầm...)*
    - ⚪ *Chế độ Ngoại tuyến (Sẵn sàng đồng bộ khi có mạng)*

---

## 4. Kế hoạch Các bước Thực hiện

1. **Bước 1: Xây dựng File Storage Service (`src/utils/fileStorage.ts`)**
   - Hỗ trợ lưu trữ đa tệp trên `@capacitor/filesystem` (`Directory.Data`):
     - `savings_books.json`
     - `settlements.json`
     - `app_config.json`
     - `sync_outbox.json` (Vùng đệm đồng bộ)
   - Fallback Web/Test an toàn.
   - Hàm `migrateFromLocalStorageIfNeeded()` tự động chuyển đổi dữ liệu cũ và lưu bản backup.

2. **Bước 2: Xây dựng Module Quản lý Vùng đệm & Xử lý Xung đột (`src/utils/syncOutboxService.ts`)**
   - Quản lý hàng đợi Outbox: thêm thao tác, lấy danh sách chờ, dọn dẹp sau khi gửi thành công.
   - Hàm `mergeRemoteAndLocalBooks()`: Thuật toán hợp nhất cấp độ bản ghi (Union non-overlapping, Tombstone delete, LWW theo từng sổ, bảo toàn tất toán).

3. **Bước 3: Tích hợp vào Hook Nghiệp vụ (`src/hooks/useSavingsBooks.ts`)**
   - Nạp bất đồng bộ khi khởi động với cờ `isLoadingStorage`.
   - Ghi tức thì vào Filesystem và đẩy vào Outbox khi thêm/sửa/xóa/tất toán sổ.

4. **Bước 4: Nâng cấp Cơ chế Đồng bộ Ngầm (`src/hooks/useDriveSync.ts`)**
   - Tự động flush hàng đợi Outbox khi có mạng và token sẵn sàng.
   - Silent token refresh trong nền; không chặn hay ngắt phiên làm việc khi mất mạng.
   - Áp dụng thuật toán hợp nhất bản ghi mới, hạn chế tối đa việc bật popup xung đột không cần thiết.
   - Bắt sự kiện mạng `online` để tự động kích hoạt đồng bộ bù.

5. **Bước 5: Xây dựng Splash Screen & Tinh chỉnh Giao diện Khởi động (`src/App.tsx`, `SplashWelcomeScreen.tsx`)**
   - Loại bỏ rào cản Login bắt buộc; vào thẳng ứng dụng sau 1.0s Splash branding.
   - Hiển thị huy hiệu trạng thái đồng bộ ngầm tinh tế trên Header.

6. **Bước 6: Kiểm thử tự động & Biên dịch ứng dụng (`compile_applet`)**
   - Viết test kiểm tra tính đúng đắn của thuật toán hợp nhất bản ghi và vùng đệm Outbox.
   - Biên dịch và xác thực hệ thống hoạt động trơn tru.

## 5. Trạng thái triển khai P0–P5

- **P0 — Xác nhận ghi an toàn:** Đã chỉ xác nhận mutation sau khi Drive trả kết quả ghi thành công; các mutation được chụp theo ID để thao tác mới phát sinh trong lúc push không bị xóa khỏi Outbox. Tombstone chỉ được xác nhận sau khi ghi dữ liệu và metadata xóa thành công.
- **P1 — Định danh và tombstone:** Đã bổ sung khóa nhận diện nghiệp vụ, giữ cấu trúc cột dữ liệu hiện tại và lưu dấu xóa sổ/tất toán trong metadata của tab `__CONFIG__` trên Drive. Khi đồng bộ, dấu xóa từ Drive được hợp nhất với Outbox cục bộ để tránh hồi sinh dữ liệu ở thiết bị không có baseline.
- **P2 — Outbox bền vững:** Thao tác nghiệp vụ ghi Outbox trước khi cập nhật state; khởi động phát lại mutation chưa xác nhận; lỗi ghi Outbox được báo rõ và không áp dụng thao tác.
- **P3 — Hợp nhất xung đột:** Đã có merge ba phía theo baseline/local/remote; thay đổi trường không giao nhau được gộp, còn chỉnh sửa đồng thời cùng trường tài chính yêu cầu chọn phiên bản trong modal.
- **P4 — Tất toán và trạng thái đồng bộ:** Xóa settlement có mutation/tombstone; trạng thái offline và số thao tác đang chờ được hiển thị ở thanh điều hướng và màn hình sổ. Splash chỉ kết thúc sau thời gian tối thiểu và khi local storage đã nạp xong.
- **P5 — Kiểm tra:** Đã chạy `npm run lint`, toàn bộ test (7 file/26 test) và `npm run build`; tất cả đạt. Build còn cảnh báo Vite hiện hữu về module `googleDriveService.ts` vừa static import vừa dynamic import.

### Giới hạn cần lưu ý

- Không có stable ID kỹ thuật trong các cột Sheet hiện tại; khóa nghiệp vụ vẫn có thể nhập nhằng nếu nhiều sổ trùng các thuộc tính nhận diện hoặc người dùng sửa những thuộc tính nằm trong khóa.
- Tombstone Drive hiện được giữ lâu dài để tránh thiết bị offline lâu ngày làm sống lại bản ghi đã xóa. Cần thiết kế cơ chế thu gom có xác nhận toàn bộ thiết bị trước khi giới hạn tuổi thọ; nếu không, tab metadata có thể tăng kích thước theo thời gian.
- Tự động đồng bộ phụ thuộc app đang chạy/được hệ điều hành đánh thức, mạng khả dụng và token Google hợp lệ; đây không phải worker chạy nền liên tục khi ứng dụng bị hệ điều hành đóng.

## 6. Cải tiến đăng nhập Google cho Android APK/AAB

- Access token native được yêu cầu với các scope đã cấu hình, gồm `drive.file`; plugin từ chối kết quả nếu Google không xác nhận đã cấp scope này.
- Bản vá Android được quản lý trong `scripts/patch-google-auth.js` và tự áp dụng sau cài dependency. Bản vá bỏ log token thô, trả hạn dùng thực tế và áp dụng scope cấu hình khi lấy/làm mới access token.
- ID token chỉ dùng xác thực danh tính/Firebase, không còn được chấp nhận thay access token Drive. Token và hạn dùng tiếp tục được lưu trong secure storage native; token thiếu hạn dùng được xem là hết hạn.
- Plugin hiện không cấp OAuth refresh token dài hạn cho ứng dụng. Không bật `forceCodeForRefreshToken` nếu chưa có backend an toàn để đổi `serverAuthCode`; không nhúng client secret vào APK.
- Trước khi phát hành cần xác nhận trong Google Cloud/Firebase Console: Android OAuth client dùng đúng application ID, SHA-1/SHA-256 cho debug và upload key, cùng fingerprint của Play App Signing. Repository hiện không có Gradle build files nên chưa xác minh được application ID cuối cùng hoặc build APK/AAB tại đây.
