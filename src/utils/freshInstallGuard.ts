import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { Preferences } from '@capacitor/preferences';

const INSTALLED_INSTANCE_KEY = 'stk_app_installed_marker_v1';

/**
 * Kiểm tra và xử lý triệt để vấn đề Android Package Manager tự động tải snapshot sao lưu
 * từ Google One / Google Drive về máy khi cài đặt mới ứng dụng (Fresh Install).
 *
 * Cơ chế:
 * - Khi app bị gỡ cài đặt (Uninstall), hệ điều hành Android tự động thu hồi và xóa toàn bộ
 *   Master Key mã hóa trong Android Keystore phần cứng (Keystore daemon).
 * - Do đó, SecureStoragePlugin (chạy trên Android Keystore) luôn bị làm trống hoàn toàn khi cài mới.
 * - Tuy nhiên, cơ chế Auto Backup của Google One trước đây có thể tự động khôi phục thư mục WebView
 *   (chứa localStorage và IndexedDB) khi APK được cài đặt lại, khiến app có sẵn data cũ mà không qua login.
 * - Hàm này chạy TRƯỚC KHI React DOM render:
 *   Nếu SecureStoragePlugin không có marker cài đặt (chứng tỏ app vừa cài mới sau khi gỡ),
 *   nhưng localStorage lại có dữ liệu cũ do Google One tiêm vào, hàm sẽ lập tức purge sạch sẽ,
 *   trả app về trạng thái cài mới 100% nguyên bản mà người dùng không cần phải vào Cài đặt để Clear Data thủ công!
 */
export async function enforceFreshInstallCleanState(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    let installedMarker: string | null = null;
    try {
      const res = await SecureStoragePlugin.get({ key: INSTALLED_INSTANCE_KEY });
      if (res && res.value) {
        installedMarker = res.value;
      }
    } catch {
      // Key không tồn tại trong Keystore -> Đây là lần khởi chạy đầu tiên sau khi cài mới app
      installedMarker = null;
    }

    if (!installedMarker) {
      // Phát hiện lần chạy đầu tiên của bản cài mới
      const hasZombieUser = localStorage.getItem('savings_auth_user_v3') !== null;
      const hasZombieBooks = localStorage.getItem('savings_books_v3') !== null;
      const hasZombieSettings = localStorage.getItem('savings_settings_v3') !== null;

      if (hasZombieUser || hasZombieBooks || hasZombieSettings) {
        console.warn(
          '[FreshInstallGuard] Phát hiện bản sao lưu snapshot Google One cũ được Android khôi phục vào máy khi cài mới. Đang làm sạch toàn diện...'
        );

        // Xóa sạch toàn bộ data cũ được Google One restore vào localStorage
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => {
          try {
            localStorage.removeItem(k);
          } catch {
            // ignore
          }
        });

        // Xóa sạch Preferences bộ nhớ đệm
        try {
          await Preferences.clear();
        } catch {
          // ignore
        }

        console.info('[FreshInstallGuard] Đã làm sạch toàn diện bản sao lưu Google One zombie. App đã sẵn sàng như mới xuất xưởng.');
      }

      // Lưu marker phiên bản cài đặt vào Android Keystore bảo mật phần cứng
      const newMarker = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      try {
        await SecureStoragePlugin.set({ key: INSTALLED_INSTANCE_KEY, value: newMarker });
      } catch (err) {
        console.warn('[FreshInstallGuard] Không thể lưu marker vào Keystore:', err);
      }
    }
  } catch (err) {
    console.warn('[FreshInstallGuard] Thông báo kiểm tra cài đặt:', err);
  }
}
