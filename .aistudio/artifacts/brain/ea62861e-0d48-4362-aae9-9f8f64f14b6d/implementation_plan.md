# Kế hoạch Tối ưu hóa Dung lượng Siêu An toàn (Zero-Risk Asset Compression)

Kế hoạch này tập trung tối ưu hóa và nén hình ảnh Splash Screen, Icon và Assets đồ họa thô. **Hoàn toàn không can thiệp vào ProGuard hay cấu hình Gradle**, đảm bảo 100% không ảnh hưởng đến việc viết code và nâng cấp tính năng ở các phiên bản tiếp theo.

---

## Quyết định của người dùng & Phân tích giải pháp

> [!IMPORTANT]
> **Quyết định đã chọn: KHÔNG DÙNG PROGUARD, CHỈ NÉN ASSET ĐỒ HỌA**
> * **Zero-Risk 100%**: Mã nguồn React, TypeScript, cấu hình Capacitor và Android Gradle giữ nguyên bản. Bạn tiếp tục phát triển tính năng, thêm trang mới hay sửa logic như bình thường mà không cần bất kỳ kiến thức nào về Android ProGuard.
> * **Mục tiêu**: Giảm trực tiếp ~2.5MB - 3MB dung lượng bộ cài đặt nhờ nén ảnh Splash và Icon kích thước lớn.

---

## 1. Phân tích nguyên nhân dung lượng ảnh đồ họa

Hiện tại trong thư mục `resources/`:
* `resources/splash.png`: **2.6MB** (kích thước 2732x2732 px, định dạng PNG thô chưa nén). Khi công cụ Capacitor Assets tạo ra các biến thể drawable cho các mật độ màn hình (hdpi, xhdpi, xxhdpi, xxxhdpi), nó nhân bản dung lượng này lên nhiều lần.
* `resources/icon-foreground.png`: **3.2MB**.
* `resources/android/`: **3.2MB**.

Bằng cách sử dụng các thuật toán nén ảnh chuẩn (ImageMagick / pngquant tối ưu bảng màu 256 màu và nén PNG mức cao), các file ảnh này sẽ giảm từ **~9MB tổng dung lượng ảnh thô xuống chỉ còn dưới 1MB**, trong khi chất lượng hiển thị trên màn hình điện thoại vẫn sắc nét và chuẩn xác 100%.

---

## 2. Chi tiết các bước thực hiện

### A. Tối ưu script sinh ảnh `scripts/generate_app_icons.py`
Cập nhật script tạo ảnh với các tham số nén PNG tối ưu của ImageMagick:
* Thêm `-quality 85` và `-define png:compression-level=9` khi xuất ảnh Splash Screen và Icons.
* Giảm kích thước vùng đệm dư thừa của file Splash mà vẫn giữ nguyên tỷ lệ và độ sắc nét cho logo trung tâm.

### B. Thực hiện nén trực tiếp các tệp trong `resources/` và `public/`
* Chạy nén lại các tệp:
  - `resources/splash.png` (từ 2.6MB -> ~200-300KB)
  - `resources/icon-foreground.png` (từ 3.2MB -> ~150KB)
  - `resources/icon.png` và `resources/master_solid.png`
* Chạy lại `python3 scripts/generate_app_icons.py` để đồng bộ lại các icon mipmap trong `android/app/src/main/res/`.

### C. Giữ nguyên toàn bộ cấu hình phát triển
* Không chạm vào `proguard-rules.pro`.
* Không thay đổi `build.gradle`.
* Giữ nguyên 100% quy trình build hiện tại trong `.github/workflows/auto-release.yml`.

---

## 3. Kiến trúc luồng tối ưu Asset

```
[Master Image Assets]
       │
       ▼ (ImageMagick Nén Mức 9 + Tối ưu hóa Palette)
[Compressed Splash & Icons] (Giảm ~80% dung lượng thô)
       │
       ▼ (Đồng bộ vào Android mipmap / drawables)
[Thư mục Android Res & Web Assets siêu nhẹ]
       │
       ▼ (Gradle Assemble thông thường)
[Bản APK nhẹ hơn ~2.5MB - 3MB, an toàn tuyệt đối]
```

---

## 4. Kế hoạch kiểm tra
1. Kiểm tra dung lượng thư mục `resources/` trước và sau khi nén.
2. Kiểm tra giao diện icon và màn hình khởi động (splash screen) không bị vỡ hạt hay biến dạng.
3. Chạy `npm run lint` & `npm run build` để xác nhận toàn bộ hệ thống hoạt động hoàn hảo.
