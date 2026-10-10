import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { SavingsBook, SettlementAdjustment, AppSettings } from '../types';

export const FILE_NAMES = {
  SAVINGS_BOOKS: 'savings_books.json',
  SETTLEMENTS: 'settlements.json',
  APP_CONFIG: 'app_config.json',
  SYNC_OUTBOX: 'sync_outbox.json',
} as const;

// Storage keys dùng cho Web/Fallback và Migration
export const LEGACY_STORAGE_KEYS = {
  SAVINGS_BOOKS: 'savings_books_v3',
  SETTLEMENTS: 'savings_settlements_v3',
  SETTINGS: 'savings_settings_v3',
  CLEARED: 'savings_books_cleared',
  MIGRATION_DONE: 'savings_filesystem_migrated_v1',
};

const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

/**
 * Đọc nội dung file dạng text UTF-8 từ Directory.Data (hoặc fallback localStorage trên Web)
 */
async function readTextFile(filename: string): Promise<string | null> {
  if (isNative()) {
    try {
      const result = await Filesystem.readFile({
        path: filename,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return typeof result.data === 'string' ? result.data : null;
    } catch (err: any) {
      // File does not exist yet hoặc lỗi đọc
      return null;
    }
  } else {
    // Web / Test fallback
    try {
      return localStorage.getItem(`fs_${filename}`) ?? localStorage.getItem(getFallbackKey(filename));
    } catch {
      return null;
    }
  }
}

/**
 * Ghi nội dung file dạng text UTF-8 vào Directory.Data (hoặc fallback localStorage trên Web)
 */
async function writeTextFile(filename: string, content: string): Promise<boolean> {
  if (isNative()) {
    try {
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      // Đồng thời cập nhật bản sao nhẹ vào localStorage để tăng tốc đọc đồng bộ nếu cần
      try {
        localStorage.setItem(`fs_${filename}`, content);
      } catch {}
      return true;
    } catch (err) {
      console.error(`[FileStorage] Lỗi ghi file native ${filename}:`, err);
      // Fallback ghi localStorage nếu native file write tạm thời lỗi
      try {
        localStorage.setItem(`fs_${filename}`, content);
      } catch {}
      return false;
    }
  } else {
    // Web / Test fallback
    try {
      localStorage.setItem(`fs_${filename}`, content);
      const fallbackKey = getFallbackKey(filename);
      if (fallbackKey) {
        localStorage.setItem(fallbackKey, content);
      }
      return true;
    } catch (err) {
      console.error(`[FileStorage] Lỗi ghi localStorage ${filename}:`, err);
      return false;
    }
  }
}

/**
 * Xóa file từ Directory.Data
 */
async function deleteFile(filename: string): Promise<boolean> {
  if (isNative()) {
    try {
      await Filesystem.deleteFile({
        path: filename,
        directory: Directory.Data,
      });
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem(`fs_${filename}`);
    const fallbackKey = getFallbackKey(filename);
    if (fallbackKey) {
      localStorage.removeItem(fallbackKey);
    }
  } catch {}
  return true;
}

function getFallbackKey(filename: string): string {
  switch (filename) {
    case FILE_NAMES.SAVINGS_BOOKS:
      return LEGACY_STORAGE_KEYS.SAVINGS_BOOKS;
    case FILE_NAMES.SETTLEMENTS:
      return LEGACY_STORAGE_KEYS.SETTLEMENTS;
    case FILE_NAMES.APP_CONFIG:
      return LEGACY_STORAGE_KEYS.SETTINGS;
    default:
      return `fs_${filename}`;
  }
}

/**
 * Phân tích JSON an toàn với giá trị dự phòng
 */
function safeJsonParse<T>(jsonStr: string | null, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (err) {
    console.warn('[FileStorage] JSON parse error, using fallback:', err);
    return fallback;
  }
}

/**
 * Migration: Tự động chuyển đổi dữ liệu từ localStorage sang Filesystem
 * Giữ lại dữ liệu trong localStorage làm bản backup an toàn.
 */
export async function migrateFromLocalStorageIfNeeded(): Promise<boolean> {
  try {
    const isMigrated = localStorage.getItem(LEGACY_STORAGE_KEYS.MIGRATION_DONE);
    if (isMigrated === 'true') {
      return false;
    }

    console.info('[FileStorage] Bắt đầu kiểm tra và chuyển đổi dữ liệu sang Filesystem...');

    // 1. Kiểm tra và chuyển đổi danh mục sổ tiết kiệm
    const oldBooksJson = localStorage.getItem(LEGACY_STORAGE_KEYS.SAVINGS_BOOKS);
    const existingBooksFile = await readTextFile(FILE_NAMES.SAVINGS_BOOKS);
    if (oldBooksJson && !existingBooksFile) {
      const parsedBooks = safeJsonParse<SavingsBook[]>(oldBooksJson, []);
      if (Array.isArray(parsedBooks) && parsedBooks.length > 0) {
        await writeTextFile(FILE_NAMES.SAVINGS_BOOKS, JSON.stringify(parsedBooks));
        console.info(`[FileStorage] Đã chuyển đổi ${parsedBooks.length} cuốn sổ tiết kiệm sang ${FILE_NAMES.SAVINGS_BOOKS}`);
      }
    }

    // 2. Kiểm tra và chuyển đổi lịch sử tất toán
    const oldSettlementsJson = localStorage.getItem(LEGACY_STORAGE_KEYS.SETTLEMENTS);
    const existingSettlementsFile = await readTextFile(FILE_NAMES.SETTLEMENTS);
    if (oldSettlementsJson && !existingSettlementsFile) {
      const parsedSettlements = safeJsonParse<SettlementAdjustment[]>(oldSettlementsJson, []);
      if (Array.isArray(parsedSettlements) && parsedSettlements.length > 0) {
        await writeTextFile(FILE_NAMES.SETTLEMENTS, JSON.stringify(parsedSettlements));
        console.info(`[FileStorage] Đã chuyển đổi ${parsedSettlements.length} bản ghi tất toán sang ${FILE_NAMES.SETTLEMENTS}`);
      }
    }

    // 3. Kiểm tra và chuyển đổi cài đặt AppSettings
    const oldSettingsJson = localStorage.getItem(LEGACY_STORAGE_KEYS.SETTINGS);
    const existingSettingsFile = await readTextFile(FILE_NAMES.APP_CONFIG);
    if (oldSettingsJson && !existingSettingsFile) {
      const parsedSettings = safeJsonParse<Partial<AppSettings>>(oldSettingsJson, {});
      if (parsedSettings && Object.keys(parsedSettings).length > 0) {
        await writeTextFile(FILE_NAMES.APP_CONFIG, JSON.stringify(parsedSettings));
        console.info(`[FileStorage] Đã chuyển đổi cấu hình ứng dụng sang ${FILE_NAMES.APP_CONFIG}`);
      }
    }

    // Đánh dấu đã hoàn thành migration
    localStorage.setItem(LEGACY_STORAGE_KEYS.MIGRATION_DONE, 'true');
    console.info('[FileStorage] Chuyển đổi dữ liệu sang Filesystem hoàn tất thành công!');
    return true;
  } catch (err) {
    console.error('[FileStorage] Lỗi trong quá trình migration dữ liệu:', err);
    return false;
  }
}

// -------------------------------------------------------------
// Các hàm API nghiệp vụ đọc / ghi file
// -------------------------------------------------------------

/**
 * Đọc danh sách sổ tiết kiệm từ Filesystem
 */
export async function getSavingsBooksFromFile(): Promise<SavingsBook[]> {
  try {
    const raw = await readTextFile(FILE_NAMES.SAVINGS_BOOKS);
    if (!raw) {
      // Fallback kiểm tra localStorage nếu file chưa có
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS.SAVINGS_BOOKS);
      return safeJsonParse<SavingsBook[]>(legacy, []);
    }
    const books = safeJsonParse<SavingsBook[]>(raw, []);
    return Array.isArray(books) ? books : [];
  } catch (err) {
    console.error('[FileStorage] Lỗi khi nạp danh sách sổ:', err);
    return [];
  }
}

/**
 * Lưu danh sách sổ tiết kiệm vào Filesystem
 */
export async function saveSavingsBooksToFile(books: SavingsBook[]): Promise<boolean> {
  try {
    const json = JSON.stringify(books);
    const success = await writeTextFile(FILE_NAMES.SAVINGS_BOOKS, json);
    // Luôn giữ localStorage làm bản backup song song
    try {
      localStorage.setItem(LEGACY_STORAGE_KEYS.SAVINGS_BOOKS, json);
      if (books.length > 0) {
        localStorage.removeItem(LEGACY_STORAGE_KEYS.CLEARED);
      } else {
        localStorage.setItem(LEGACY_STORAGE_KEYS.CLEARED, 'true');
      }
    } catch {}
    return success;
  } catch (err) {
    console.error('[FileStorage] Lỗi khi lưu danh sách sổ:', err);
    return false;
  }
}

/**
 * Đọc danh sách bản ghi tất toán từ Filesystem
 */
export async function getSettlementsFromFile(): Promise<SettlementAdjustment[]> {
  try {
    const raw = await readTextFile(FILE_NAMES.SETTLEMENTS);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS.SETTLEMENTS);
      return safeJsonParse<SettlementAdjustment[]>(legacy, []);
    }
    const settlements = safeJsonParse<SettlementAdjustment[]>(raw, []);
    return Array.isArray(settlements) ? settlements : [];
  } catch (err) {
    console.error('[FileStorage] Lỗi khi nạp bản ghi tất toán:', err);
    return [];
  }
}

/**
 * Lưu danh sách bản ghi tất toán vào Filesystem
 */
export async function saveSettlementsToFile(settlements: SettlementAdjustment[]): Promise<boolean> {
  try {
    const json = JSON.stringify(settlements);
    const success = await writeTextFile(FILE_NAMES.SETTLEMENTS, json);
    try {
      localStorage.setItem(LEGACY_STORAGE_KEYS.SETTLEMENTS, json);
    } catch {}
    return success;
  } catch (err) {
    console.error('[FileStorage] Lỗi khi lưu bản ghi tất toán:', err);
    return false;
  }
}

/**
 * Đọc cấu hình cài đặt từ Filesystem
 */
export async function getAppSettingsFromFile(): Promise<Partial<AppSettings> | null> {
  try {
    const raw = await readTextFile(FILE_NAMES.APP_CONFIG);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS.SETTINGS);
      return safeJsonParse<Partial<AppSettings> | null>(legacy, null);
    }
    return safeJsonParse<Partial<AppSettings> | null>(raw, null);
  } catch (err) {
    console.error('[FileStorage] Lỗi khi nạp cài đặt:', err);
    return null;
  }
}

/**
 * Lưu cấu hình cài đặt vào Filesystem
 */
export async function saveAppSettingsToFile(settings: AppSettings): Promise<boolean> {
  try {
    const json = JSON.stringify(settings);
    const success = await writeTextFile(FILE_NAMES.APP_CONFIG, json);
    try {
      localStorage.setItem(LEGACY_STORAGE_KEYS.SETTINGS, json);
    } catch {}
    return success;
  } catch (err) {
    console.error('[FileStorage] Lỗi khi lưu cài đặt:', err);
    return false;
  }
}

/**
 * Đọc tệp tùy ý (dùng cho Outbox sync)
 */
export async function readCustomJsonFile<T>(filename: string, defaultValue: T): Promise<T> {
  try {
    const raw = await readTextFile(filename);
    return safeJsonParse<T>(raw, defaultValue);
  } catch {
    return defaultValue;
  }
}

/**
 * Lưu tệp tùy ý (dùng cho Outbox sync)
 */
export async function writeCustomJsonFile<T>(filename: string, data: T): Promise<boolean> {
  try {
    const json = JSON.stringify(data);
    return await writeTextFile(filename, json);
  } catch {
    return false;
  }
}

/**
 * Xóa toàn bộ dữ liệu ứng dụng khỏi Filesystem và localStorage
 */
export async function clearAllLocalAppFiles(): Promise<void> {
  await deleteFile(FILE_NAMES.SAVINGS_BOOKS);
  await deleteFile(FILE_NAMES.SETTLEMENTS);
  await deleteFile(FILE_NAMES.SYNC_OUTBOX);
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEYS.SAVINGS_BOOKS);
    localStorage.removeItem(LEGACY_STORAGE_KEYS.SETTLEMENTS);
    localStorage.setItem(LEGACY_STORAGE_KEYS.CLEARED, 'true');
  } catch {}
}
