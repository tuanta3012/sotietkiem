# Kế Hoạch Public Ứng Dụng Sổ Tiết Kiệm (Google Play & APK Trực Tiếp)

Kế hoạch tái cấu trúc và hoàn thiện ứng dụng Sổ Tiết Kiệm Thông Minh để sẵn sàng phát hành đại trà cho công chúng qua cả hai kênh **Google Play Store** và **File APK trực tiếp (GitHub Releases)**, cam kết **bảo mật 100%**, **0đ chi phí máy chủ cho cả lập trình viên và người dùng**, đồng thời trang bị hệ thống **hỗ trợ & chẩn đoán lỗi tích hợp sẵn trong app**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Dưới đây là các quyết định chiến lược then chốt đã được bạn xác nhận và các khuyến nghị kỹ thuật thực thi trước khi tiến hành chỉnh sửa mã nguồn:

- **Kênh phân phối (Đã xác nhận)**: Phát hành song song cả hai kênh:
  1. Bản Google Play Store (định dạng `.aab`, tuân thủ chính sách Google Play, cập nhật qua Google Play In-App Update).
  2. Bản cài đặt trực tiếp qua file `.apk` (tải từ GitHub Releases / Website, tích hợp bộ tự động kiểm tra và tải APK mới `AutoUpdate`).
- **Mô hình lưu trữ & bảo mật (Đã xác nhận)**: Dữ liệu cá nhân hóa 100% trên **Google Drive riêng của từng người dùng** với phạm vi quyền an toàn **`drive.file`**.
  - Không lưu sổ tiết kiệm tập trung trên 1 tài khoản Firestore chung.
  - Mỗi người dùng tự quản lý và sở hữu file bảng tính trên Drive của họ, đảm bảo tính riêng tư tuyệt đối.
  - Chi phí lưu trữ Cloud phía lập trình viên = **0 VNĐ**.
- **Kênh tiếp nhận phản hồi & hỗ trợ (Đã xác nhận)**: Tích hợp **Biểu mẫu góp ý & Báo cáo lỗi (In-App Feedback & Diagnostics)** trực tiếp trong ứng dụng.
  - Người dùng có thể gửi góp ý, báo lỗi kèm thông tin chẩn đoán kỹ thuật (phiên bản app, thiết bị, log lỗi gần nhất) chỉ bằng 1 chạm mà không cần phải rời ứng dụng.
- **Quyết định về phân quyền Admin**: Bỏ hoàn toàn việc gán cứng email quản trị viên mặc định (`tuanta3012@gmail.com`). Mỗi người dùng khi đăng nhập bằng Google trên máy của họ sẽ tự động là **Admin tối cao đối với kho dữ liệu cá nhân của chính họ**.

---

## 1. Overview & Core Concept

- **Mục tiêu ứng dụng**: Cung cấp công cụ quản lý, tính toán và theo dõi danh mục tiền gửi tiết kiệm ngân hàng đa nền tảng (Android & Web) với trải nghiệm mượt mà, bảo mật sinh trắc học và tự động đồng bộ hóa lên Google Drive cá nhân.
- **Đối tượng người dùng**: Cá nhân, gia đình hoặc người quản lý tài chính muốn theo dõi lãi suất, lịch đáo hạn và dòng tiền tiết kiệm minh bạch, an toàn mà không phải chia sẻ dữ liệu tài chính nhạy cảm lên máy chủ bên thứ ba.
- **Giá trị cốt lõi**:
  - **Zero-Knowledge Architecture**: Dữ liệu tài chính chỉ nằm trên thiết bị và Google Drive cá nhân của người dùng.
  - **Zero-Cost Infrastructure**: Sử dụng Google Drive API và Firestore Free Tier (chỉ lưu metadata feedback/phản hồi) giúp duy trì ứng dụng vĩnh viễn với chi phí 0đ.
  - **Full Platform Compliance**: Vượt qua quy trình kiểm duyệt khắt khe của Google Play nhờ dùng scope an toàn `drive.file` và có đầy đủ trang Chính sách bảo mật (Privacy Policy).

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Luồng Khởi chạy & Thiết lập 1 Chạm (Onboarding)**:
   - Người dùng tải ứng dụng từ Google Play hoặc cài đặt file APK.
   - Ứng dụng tự động kiểm tra trạng thái đăng nhập. Nếu là người dùng mới, hiển thị màn hình chào mừng ngắn gọn làm nổi bật tính năng bảo mật: *"Dữ liệu của bạn được lưu an toàn trên Google Drive cá nhân của chính bạn"*.
   - Đăng nhập 1 chạm với Google -> Tự động tạo file bảng tính chuẩn 12 cột trên Google Drive của người dùng (không cần người dùng phải tự cấu hình phức tạp).
2. **Luồng Nhận diện Kênh cập nhật (Dual Distribution UX)**:
   - Nếu chạy bản cài đặt APK từ GitHub: Ứng dụng duy trì tính năng kiểm tra bản mới, thông báo pop-up tải APK mượt mà kèm thanh tiến trình tải.
   - Nếu chạy bản từ Google Play Store: Ứng dụng tự động ẩn nút tải APK trực tiếp và chuyển hướng người dùng sang trang Google Play để cập nhật theo đúng chuẩn chính sách của Google.
3. **Luồng Hỗ Trợ & Góp Ý (In-App Support & Diagnostics Modal)**:
   - Menu Cài đặt bổ sung mục **"Trợ giúp & Góp ý"**.
   - Mở giao diện phản hồi: Cho phép chọn loại vấn đề (*Góp ý tính năng*, *Báo lỗi kỹ thuật*, *Hỏi đáp cách dùng*).
   - Tự động đính kèm thông tin chẩn đoán kỹ thuật an toàn (Mã phiên bản, tên thiết bị, hệ điều hành Android, mã lỗi gần nhất nếu có) với tùy chọn cho phép người dùng bật/tắt đính kèm log.

### Visual Identity & Theme Tokens
- Tuân thủ thiết kế hiện đại, mobile-first đã định hình:
  - Nền tối cao cấp: `bg-slate-900` / `bg-slate-950`
  - Màu nhấn chính (Brand Emerald): `text-emerald-400`, `bg-emerald-600`
  - Thẻ thông tin: Viền `border-slate-800`, bo góc tiêu chuẩn `rounded-2xl`
  - Mục thông tin trạng thái & chẩn đoán: Không dùng pill bao viền rối mắt, hiển thị text phân cách sạch sẽ (`v1.0.4 · Android 14 · Online`).

---

## 3. Key Product Decisions & Trade-Offs

### Quyết định 1: Rút gọn Scope sang `drive.file` và tối ưu luồng tạo file
- **Lý do**: Quyền `drive` đầy đủ bị Google Play xếp vào diện Restricted Scope (bắt buộc kiểm định bảo mật CASA tốn hàng chục ngàn USD). Chuyển sang `drive.file` là Non-Sensitive Scope, **miễn phí duyệt 100%** và tạo niềm tin tuyệt đối cho người dùng.
- **Giải pháp UX**: 
  - Đặt nút **"Tạo sổ mới trên Google Drive"** làm luồng mặc định và khuyến nghị.
  - Với tính năng dán URL ngoài: Nếu người dùng dán file ngoài phạm vi app tạo, hiển thị thông báo hướng dẫn rõ ràng hoặc mở Google Picker để người dùng chủ động cấp quyền cho file đó.

### Quyết định 2: Tách biệt Document Firestore và phân quyền độc lập
- **Hiện tại**: Cả ứng dụng đang đọc/ghi chung vào 1 document Firestore `family_vault/master_state` và chỉ cấp quyền Admin cho `tuanta3012@gmail.com`.
- **Giải pháp cho Public App**:
  - Dữ liệu master state chuyển sang lưu trực tiếp theo `users/{userId}/workspace_state` hoặc lưu trực tiếp trong Google Drive cá nhân của người dùng.
  - Bỏ kiểm tra cứng email admin. Chủ sở hữu tài khoản Google đang đăng nhập tự động có toàn quyền Admin với dữ liệu của mình.

### Quyết định 3: Kênh thu thập phản hồi 0đ chi phí
- **Giải pháp**: Tạo collection `user_feedbacks` trên Firestore với quy tắc bảo mật: Người dùng có thể `create` phản hồi của mình, nhưng chỉ Admin hệ thống mới có thể `read/list`.
- **Lợi ích**: Không tốn tiền mua máy chủ CRM hay email server, phản hồi xuất hiện tức thì trong Firebase Console của bạn.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER MOBILE CLIENT (Android)                    │
│                                                                        │
│   ┌─────────────────────┐                 ┌────────────────────────┐   │
│   │    Local Storage    │                 │   Biometric Security   │   │
│   │ (Preferences/Cache) │                 │  (Hardware Keystore)   │   │
│   └──────────┬──────────┘                 └───────────┬────────────┘   │
│              │                                        │                │
│   ┌──────────▼────────────────────────────────────────▼────────────┐   │
│   │                 App Core State & Auth Provider                 │   │
│   │         (User Role = Admin for their own workspace)            │   │
│   └──────────┬──────────────────────────┬──────────────────────┬───┘   │
└──────────────┼──────────────────────────┼──────────────────────┼───────┘
               │                          │                      │
       (OAuth drive.file)          (In-App Feedback)      (Dual-Update)
               │                          │                      │
               ▼                          ▼                      ▼
┌───────────────────────────┐ ┌──────────────────────┐ ┌─────────────────┐
│     USER GOOGLE DRIVE     │ │  FIRESTORE BACKEND   │ │ RELEASE CHANNELS│
│                           │ │ (Free Tier Metadata) │ │                 │
│  - User's Personal Sheet  │ │                      │ │ 1. GitHub APK   │
│    (12-column layout)     │ │ - Collection:        │ │    Auto-Update  │
│  - Zero access to other   │ │   'user_feedbacks'   │ │ 2. Play Store   │
│    user files or folders  │ │ - Secure Rules       │ │    AAB Channel  │
└───────────────────────────┘ └──────────────────────┘ └─────────────────┘
```

### Data Model & Changes Required

1. **Google OAuth Scopes (`src/utils/googleDriveService.ts`)**:
   - Loại bỏ: `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/drive.readonly`
   - Giữ lại: `email`, `profile`, `openid`, `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/spreadsheets`
2. **Loại bỏ Hardcoded Admin (`src/utils/roleHelper.ts` & `src/utils/googleDriveService.ts`)**:
   - Xóa bỏ việc so sánh cứng với email `tuanta3012@gmail.com`.
   - Mặc định: Người tạo file và chủ sở hữu phiên đăng nhập là `ADMIN`.
3. **Môi trường phân phối (Build Flavor / Detection)**:
   - Thêm cờ nhận diện nguồn cài đặt (ví dụ: `IS_PLAY_STORE_BUILD` hoặc tự động nhận diện installer package name qua Capacitor).
   - Nếu cài từ Play Store -> Điều hướng sang Play Store khi có bản mới.
   - Nếu cài từ APK ngoài -> Sử dụng cơ chế GitHub Releases APK tải trực tiếp hiện có.
4. **Trang Chính sách bảo mật (Privacy Policy)**:
   - Tạo file tĩnh `public/privacy-policy.html` mô tả minh bạch:
     - Ứng dụng chỉ sử dụng quyền `drive.file` để tạo và lưu file sổ tiết kiệm của người dùng.
     - Ứng dụng không thu thập, không bán và không gửi dữ liệu tài chính của người dùng cho bất kỳ bên thứ ba nào.
     - Liên hệ hỗ trợ người dùng.

---

## 5. Implementation Roadmap (Các Bước Triển Khai)

- **Bước 1**: Điều chỉnh phạm vi quyền OAuth trong `googleDriveService.ts` sang `drive.file` và dọn dẹp các scope dư thừa.
- **Bước 2**: Gỡ bỏ triệt để hardcoded admin email, hoàn thiện cơ chế phân quyền độc lập theo từng tài khoản cá nhân.
- **Bước 3**: Tối ưu hóa giao diện kết nối Drive (`DataSyncModal.tsx`), đặt nút tạo file mới làm luồng ưu tiên số 1, bổ sung thông báo hướng dẫn khi liên kết file.
- **Bước 4**: Xây dựng thành phần **Biểu mẫu góp ý & Báo lỗi tích hợp (FeedbackModal.tsx)** và service gửi dữ liệu lên Firestore.
- **Bước 5**: Thêm trang tĩnh **Privacy Policy (Chính sách bảo mật)** và liên kết trong menu Cài đặt để đáp ứng tiêu chuẩn của Google Play Console.
- **Bước 6**: Cập nhật CI/CD workflow GitHub Actions để hỗ trợ build song song cả APK (cho người dùng ngoài) và AAB (Android App Bundle để upload Google Play Console).
