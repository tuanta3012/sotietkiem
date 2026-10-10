import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * Check if the app is running as a native app (iOS/Android)
 */
const isNative = Capacitor.isNativePlatform();

const TOKEN_KEY = 'google_drive_access_token_v4';
const TOKEN_EXPIRES_AT_KEY = 'google_drive_token_expires_at';
const REFRESH_TOKEN_KEY = 'google_drive_refresh_token_v4';
const ID_TOKEN_KEY = 'google_drive_id_token_v4';
const USER_PROFILE_KEY = 'google_drive_user_profile_v4';

/**
 * Securely store a key-value pair.
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

  try {
    await Preferences.set({ key, value });
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback storage for key: ${key}`, err);
  }
}

/**
 * Retrieve a securely stored value by key.
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

  try {
    await Preferences.remove({ key });
    localStorage.removeItem(key);
  } catch (err) {
    console.error(`[SecureStorage] Failed fallback removal for key: ${key}`, err);
  }
}

/**
 * Automatically clean up temporary cache memory on app startup.
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
 */
export async function enforceFreshInstallCleanState(): Promise<boolean> {
  const PREFS_GUARD_KEY = 'stk_hardware_keystore_install_token';
  try {
    if (Capacitor.isNativePlatform()) {
      const prefResult = await Preferences.get({ key: PREFS_GUARD_KEY }).catch(() => ({ value: null }));
      if (!prefResult?.value) {
        const newToken = `stk_install_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        await Preferences.set({ key: PREFS_GUARD_KEY, value: newToken }).catch(() => {});
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(PREFS_GUARD_KEY, newToken);
        }
      }
    }
  } catch (err) {
    console.warn('[KeystoreGuard] Bỏ qua kiểm tra token khởi động an toàn:', err);
  }
  return false;
}

/**
 * Nuclear cleanup of all application data across all storage layers.
 */
export async function clearAppStorageExceptTokens(): Promise<void> {
  const AUTH_KEYS_TO_KEEP = [
    TOKEN_KEY,
    TOKEN_EXPIRES_AT_KEY,
    REFRESH_TOKEN_KEY,
    ID_TOKEN_KEY,
    USER_PROFILE_KEY,
    'google_drive_ever_logged_in',
    'drive_scope_migrated_v2',
  ];

  try {
    const isManualLogout = (window as any).__IS_LOGGING_OUT === true;
    console.info(`[SecureStorage] Initiating nuclear cleanup (Manual Logout: ${isManualLogout})...`);

    // 1. CLEAR LOCALSTORAGE
    if (typeof window !== 'undefined' && window.localStorage) {
      const allKeys = Object.keys(localStorage);
      allKeys.forEach(key => {
        if (isManualLogout || !AUTH_KEYS_TO_KEEP.includes(key)) {
          localStorage.removeItem(key);
        }
      });
      localStorage.setItem('savings_books_cleared', 'true');
    }

    // 2. CLEAR SESSIONSTORAGE
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.clear();
    }

    // 3. CLEAR CAPACITOR PREFERENCES
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys.map(async (key) => {
        if (isManualLogout || !AUTH_KEYS_TO_KEEP.includes(key)) {
          await Preferences.remove({ key }).catch(() => {});
        }
      })
    );

    // 4. CLEAR NATIVE SECURE STORAGE
    if (isNative) {
      const dataKeys = [
        'savings_auth_user_v3',
        'savings_auth_email_v3',
        'savings_books_v3',
        'savings_settlements_v3',
        'savings_settings_v3',
        'last_linked_file_id_v2',
        'master_pointer_file_id',
        'master_sync_state_local_v2',
        'explicitly_unlinked',
        'savings_setting_biometrics',
        'savings_setting_notifications',
        'savings_sync_audit_log_v1',
        'savings_offline_vault_key',
        'google_drive_file_id',
      ];
      await Promise.all(
        dataKeys.map(async (key) => {
          if (isManualLogout || !AUTH_KEYS_TO_KEEP.includes(key)) {
            await SecureStoragePlugin.remove({ key }).catch(() => {});
          }
        })
      );
    }

    // 5. CLEAR INDEXEDB (Optional but recommended for thoroughness)
    // Note: This might clear Firebase Auth persistence if not careful, 
    // but if it's a manual logout, we WANT that.
    if (isManualLogout && typeof window !== 'undefined' && window.indexedDB) {
      try {
        const dbs = await window.indexedDB.databases();
        dbs.forEach(db => {
          if (db.name && (db.name.includes('firebase') || db.name.includes('firestore'))) {
             window.indexedDB.deleteDatabase(db.name);
          }
        });
      } catch (e) {
        // ignore errors in indexedDB listing
      }
    }

    console.info('[SecureStorage] Nuclear cleanup completed.');
  } catch (err) {
    console.error('[SecureStorage] Error during nuclear clear:', err);
  }
}
