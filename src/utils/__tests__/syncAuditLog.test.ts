import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSyncAuditLogs,
  recordSyncAuditLog,
  clearSyncAuditLogs,
  initAuditLogForLinkedFile,
  hasActiveLinkedFile,
} from '../syncAuditLog';

// Tạo mock in-memory localStorage cho môi trường test
const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) || null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

(globalThis as any).localStorage = localStorageMock;

describe('syncAuditLog behavior', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('skips recording audit logs when no file is linked', () => {
    expect(hasActiveLinkedFile()).toBe(false);

    recordSyncAuditLog({
      type: 'SYNC_ERROR',
      title: 'Lỗi vặt lúc chưa link',
      status: 'error',
      summary: 'Không có mạng',
    });

    const logs = getSyncAuditLogs();
    expect(logs).toHaveLength(0);
  });

  it('records audit logs when file is linked via settings', () => {
    localStorageMock.setItem(
      'savings_settings_v3',
      JSON.stringify({ googleSheetUrl: 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit' })
    );

    expect(hasActiveLinkedFile()).toBe(true);

    recordSyncAuditLog({
      type: 'SYNC_PULL',
      title: 'Tải dữ liệu thành công',
      status: 'success',
      summary: 'Đã tải 5 sổ',
    });

    const logs = getSyncAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].title).toBe('Tải dữ liệu thành công');
  });

  it('initAuditLogForLinkedFile cleans old logs and starts fresh milestone', () => {
    // Giả sử có một số log cũ
    localStorageMock.setItem(
      'savings_settings_v3',
      JSON.stringify({ googleSheetUrl: 'https://docs.google.com/spreadsheets/d/old-sheet-id/edit' })
    );
    recordSyncAuditLog({
      type: 'SYNC_PULL',
      title: 'Log cũ từ trước',
      status: 'info',
      summary: 'Log của file cũ',
    });
    expect(getSyncAuditLogs()).toHaveLength(1);

    // Người dùng liên kết file mới
    const milestone = initAuditLogForLinkedFile('new-sheet-123', 'Sổ tiết kiệm 2026', 'admin@gmail.com');

    const logs = getSyncAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(milestone.id);
    expect(logs[0].title).toContain('Bắt đầu theo dõi');
    expect(logs[0].fileId).toBe('new-sheet-123');
    expect(logs[0].sheetName).toBe('Sổ tiết kiệm 2026');
  });

  it('clearSyncAuditLogs removes all records', () => {
    localStorageMock.setItem('last_linked_file_id_v2', 'some-file-id');
    recordSyncAuditLog({
      type: 'INFO',
      title: 'Test',
      status: 'info',
      summary: 'Test entry',
    });
    expect(getSyncAuditLogs().length).toBeGreaterThan(0);

    clearSyncAuditLogs();
    expect(getSyncAuditLogs()).toHaveLength(0);
  });
});
