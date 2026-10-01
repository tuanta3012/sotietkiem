import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * Check if the app is running as a native app (iOS/Android)
 */
const isNative = Capacitor.isNativePlatform();

/**
 * Securely store a key-value pair.
 * On native platforms, uses the encrypted SecureStoragePlugin.
 * On web/iframe, falls back to Capacitor Preferences with unencrypted localStorage.
 */
export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isNative) {
    try {
      await SecureStoragePlugin.set({ key, value });
      return;
    } catch (err) {
      console.warn(`[SecureStorage] Failed to set native secure storage for key: ${key}. Falling back to Preferences...`, err);
    }
  }

  // Fallback to Preferences (and also update localStorage just in case)
  try {
    await Preferences.set({ key, value });
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback storage for key: ${key}`, err);
  }
}

/**
 * Retrieve a securely stored value by key.
 * On native platforms, uses the encrypted SecureStoragePlugin.
 * On web/iframe, falls back to Capacitor Preferences and localStorage.
 */
export async function getSecureItem(key: string): Promise<string | null> {
  if (isNative) {
    try {
      const result = await SecureStoragePlugin.get({ key });
      if (result && result.value) {
        return result.value;
      }
    } catch (err) {
      console.info(`[SecureStorage] Key "${key}" not found or failed to read from native secure storage. Trying Preferences fallback...`);
    }
  }

  // Fallback to Preferences/localStorage
  try {
    const prefResult = await Preferences.get({ key });
    if (prefResult && prefResult.value) {
      return prefResult.value;
    }
    return localStorage.getItem(key) || null;
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback retrieval for key: ${key}`, err);
    return null;
  }
}

/**
 * Remove a securely stored key-value pair.
 */
export async function removeSecureItem(key: string): Promise<void> {
  if (isNative) {
    try {
      await SecureStoragePlugin.remove({ key });
      return;
    } catch (err) {
      console.warn(`[SecureStorage] Failed to remove key from native secure storage: ${key}. Trying Preferences fallback...`, err);
    }
  }

  // Fallback
  try {
    await Preferences.remove({ key });
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback removal for key: ${key}`, err);
  }
}

/**
 * Automatically clean up temporary cache memory on app startup while preserving
 * active Google Drive sync settings, authentication tokens, and user savings data.
 */
export async function autoCleanupStartupCache(): Promise<void> {
  try {
    const PRESERVED_PREFIXES = [
      'savings_',
      'google_drive_',
      'gdrive_',
      'capacitor_',
      'firebase_',
      'stk_',
    ];

    // 1. Scan and purge orphan/temporary localStorage keys
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const isPreserved = PRESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
          if (!isPreserved && (key.startsWith('temp_') || key.startsWith('cache_') || key.includes('_tmp_'))) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
      });
    }

    // 2. Clear browser CacheStorage if available
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes('temp') || name.includes('stale')) {
          await caches.delete(name);
        }
      }
    }
  } catch (err) {
    console.info('[CacheManager] Auto cache cleanup completed with minor notice:', err);
  }
}

/**
 * Tầng 3 (Runtime Keystore Guard):
 * Phát hiện và quét sạch 100% dữ liệu zombie do Google One Cloud Backup tự ý khôi phục trên cài đặt mới.
 * Sử dụng chip bảo mật phần cứng Android Keystore để nhận diện trạng thái cài đặt mới (Fresh Install).
 * Khi gỡ ứng dụng, Android Keystore phần cứng sẽ bị hệ điều hành xóa vĩnh viễn,
 * nhưng Google One có thể vẫn cố tiêm SharedPreferences/localStorage snapshot cũ.
 */
export async function enforceFreshInstallCleanState(): Promise<boolean> {
  const KEYSTORE_GUARD_KEY = 'stk_hardware_keystore_install_token';
  const PREFS_GUARD_KEY = 'stk_hardware_keystore_install_token';

  try {
    if (isNative) {
      let keystoreToken: string | null = null;
      let keystoreError = false;

      try {
        const result = await SecureStoragePlugin.get({ key: KEYSTORE_GUARD_KEY });
        keystoreToken = result?.value || null;
      } catch (err) {
        // Keystore bị reset khi app bị gỡ cài đặt hoặc khóa bảo mật bị hủy
        keystoreError = true;
        keystoreToken = null;
      }

      const prefResult = await Preferences.get({ key: PREFS_GUARD_KEY }).catch(() => ({ value: null }));
      const localPrefsToken =
        prefResult?.value || (typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_GUARD_KEY) : null);

      // Kiểm tra xem có dấu vết dữ liệu cũ bị Google One tiêm vào không
      const hasZombieSavingsData =
        typeof localStorage !== 'undefined' &&
        (Boolean(localStorage.getItem('savings_books_v3')) ||
          Boolean(localStorage.getItem('savings_auth_user_v3')) ||
          Boolean(localStorage.getItem('savings_settings_v3')) ||
          Boolean(localStorage.getItem('google_drive_file_id')));

      // Nếu Keystore không có token (hoặc bị lỗi do cài mới) NHƯNG SharedPreferences / localStorage lại có dữ liệu hoặc token cũ
      // => ĐÂY CHẮC CHẮN LÀ ZOMBIE RESTORE TỪ GOOGLE ONE TRÊN BẢN CÀI MỚI!
      if (!keystoreToken && (localPrefsToken || hasZombieSavingsData || keystoreError)) {
        console.warn(
          '[KeystoreGuard] 🚨 Phát hiện dữ liệu Zombie từ Google One Backup trên bản cài mới! Đang kích hoạt làm sạch toàn diện...'
        );

        // 1. Quét sạch Preferences của Capacitor
        try {
          await Preferences.clear();
        } catch {
          // ignore
        }

        // 2. Quét sạch LocalStorage & SessionStorage
        if (typeof localStorage !== 'undefined') {
          localStorage.clear();
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.clear();
        }

        // 3. Quét sạch CacheStorage
        if (typeof window !== 'undefined' && 'caches' in window) {
          try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
          } catch {
            // ignore
          }
        }

        // 4. Tạo token cài đặt mới và lưu vào cả Keystore phần cứng lẫn Preferences
        const newToken = `stk_fresh_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        try {
          await SecureStoragePlugin.set({ key: KEYSTORE_GUARD_KEY, value: newToken });
        } catch (e) {
          console.warn('[KeystoreGuard] Không thể ghi token vào Keystore:', e);
        }
        await Preferences.set({ key: PREFS_GUARD_KEY, value: newToken }).catch(() => {});
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(PREFS_GUARD_KEY, newToken);
        }

        console.info(
          '[KeystoreGuard] ✅ Đã quét sạch hoàn toàn dữ liệu Zombie cũ. Hệ thống bắt đầu với trạng thái hoàn toàn mới.'
        );
        return true; // Đã thực hiện làm sạch
      }

      // Nếu cả Keystore lẫn Preferences chưa có token (cài mới hoàn toàn và sạch)
      if (!keystoreToken) {
        const newToken = `stk_fresh_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        try {
          await SecureStoragePlugin.set({ key: KEYSTORE_GUARD_KEY, value: newToken });
        } catch {
          // ignore
        }
        await Preferences.set({ key: PREFS_GUARD_KEY, value: newToken }).catch(() => {});
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(PREFS_GUARD_KEY, newToken);
        }
        return false;
      }
    } else {
      // Trên môi trường Web/Preview
      if (typeof localStorage !== 'undefined' && !localStorage.getItem(PREFS_GUARD_KEY)) {
        const newToken = `stk_web_${Date.now()}`;
        localStorage.setItem(PREFS_GUARD_KEY, newToken);
        await Preferences.set({ key: PREFS_GUARD_KEY, value: newToken }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[KeystoreGuard] Lỗi trong quá trình kiểm tra fresh install guard:', err);
  }
  return false;
}
