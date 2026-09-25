/**
 * Module ghi nhật ký kiểm toán (Audit Log) cho toàn bộ các thay đổi và hoạt động đồng bộ:
 * - Theo dõi chi tiết từng lần Đọc (Pull) và Ghi (Push) với Google Drive / Google Sheets.
 * - Ghi lại chính xác dải ô (Ranges) được cập nhật trên Google Sheets.
 * - Ghi lại những dữ liệu lịch sử được bảo toàn (2019-2025) và những dữ liệu mới được cập nhật (2026-2028).
 * - Lưu trữ trong localStorage và đồng bộ lên file log trên Google Drive để điều tra sự cố.
 */

import { pushAuditLogToFirestore } from './firebaseFirestoreService';

export interface SyncAuditLogEntry {
  id: string;
  timestamp: number; // Unix ms
  timeStr: string; // Định dạng ngày giờ VN (VD: 23/09/2026 18:15:30)
  type: 'SYNC_PUSH' | 'SYNC_PULL' | 'DATA_RESTORE' | 'CALCULATION' | 'SETTLEMENT_CHANGE' | 'ERROR' | 'SYNC_ERROR' | 'INFO';
  title: string;
  status: 'success' | 'warning' | 'error' | 'info';
  sheetName?: string;
  fileId?: string;
  userEmail?: string;
  userName?: string;
  currentRole?: string;
  platform?: string;
  appVersion?: string;
  summary: string;
  details?: {
    activeBooksCount?: number;
    totalPrincipalMillion?: number;
    updatedRanges?: string[];
    annualInterestUpdated?: { year: number; interestMillion: number }[];
    annualInterestPreserved?: number[];
    balanceGrowthUpdated?: { year: number; balanceMillion: number; incomeMillion?: number };
    balanceGrowthPreserved?: number[];
    settlementsCount?: number;
    settlementDetails?: any[];
    [key: string]: any;
  };
  errorMessage?: string;
}

const STORAGE_KEY = 'savings_sync_audit_log_v1';
const MAX_LOG_ENTRIES = 50;

/**
 * Đọc toàn bộ danh sách nhật ký kiểm toán từ localStorage
 */
export function getSyncAuditLogs(): SyncAuditLogEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('Lỗi đọc audit log từ storage:', err);
    return [];
  }
}

/**
 * Thêm một mục nhật ký kiểm toán mới
 */
export function recordSyncAuditLog(
  entry: Omit<SyncAuditLogEntry, 'id' | 'timestamp' | 'timeStr'>
): SyncAuditLogEntry {
  const now = new Date();
  const timeStr = now.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const fullEntry: SyncAuditLogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    timeStr,
  };

  try {
    const existing = getSyncAuditLogs();
    const updated = [fullEntry, ...existing].slice(0, MAX_LOG_ENTRIES);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (err) {
    console.warn('Lỗi lưu audit log:', err);
  }

  // Tự động đẩy không đồng bộ lên Firestore trung tâm (để Admin kiểm tra tập trung từ mọi máy)
  try {
    pushAuditLogToFirestore(fullEntry).catch(() => {});
  } catch {
    // Không gián đoạn luồng làm việc
  }

  // Xuất ra console dev để dễ theo dõi
  const prefix = `[SYNC AUDIT] [${fullEntry.type}] [${fullEntry.status.toUpperCase()}]`;
  if (fullEntry.status === 'error') {
    console.error(prefix, fullEntry.title, fullEntry.summary, fullEntry.details);
  } else if (fullEntry.status === 'warning') {
    console.warn(prefix, fullEntry.title, fullEntry.summary, fullEntry.details);
  } else {
    console.info(prefix, fullEntry.title, fullEntry.summary, fullEntry.details);
  }

  return fullEntry;
}

/**
 * Xóa sạch toàn bộ nhật ký kiểm toán
 */
export function clearSyncAuditLogs(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Lỗi xóa audit log:', err);
  }
}

/**
 * Xuất toàn bộ nhật ký ra định dạng văn bản (Plain Text) để sao chép hoặc tải về
 */
export function formatAuditLogsAsText(customLogs?: SyncAuditLogEntry[]): string {
  const logs = customLogs !== undefined ? customLogs : getSyncAuditLogs();
  if (logs.length === 0) {
    return 'Chưa có nhật ký kiểm toán đồng bộ nào được ghi nhận.';
  }

  let text = `NHẬT KÝ KIỂM TOÁN ĐỒNG BỘ VÀ GIÁM SÁT HỆ THỐNG (TỔNG CỘNG: ${logs.length} BẢN GHI)\r\n`;
  text += `Thời gian xuất báo cáo: ${new Date().toLocaleString('vi-VN')}\r\n`;
  text += `================================================================================\r\n\r\n`;

  logs.forEach((log, idx) => {
    text += `[#${idx + 1}] ${log.timeStr} | [${log.type}] | TRẠNG THÁI: ${log.status.toUpperCase()}\r\n`;
    text += `TIÊU ĐỀ: ${log.title}\r\n`;
    text += `TÓM TẮT: ${log.summary}\r\n`;
    if (log.userEmail) text += `NGƯỜI DÙNG: ${log.userEmail}${log.currentRole ? ` (${log.currentRole})` : ''}\r\n`;
    if (log.platform) text += `NỀN TẢNG: ${log.platform}\r\n`;
    if (log.sheetName) text += `TÊN FILE / BẢNG TÍNH: ${log.sheetName}\r\n`;
    if (log.errorMessage) text += `LỖI: ${log.errorMessage}\r\n`;
    if (log.details) {
      text += `CHI TIẾT THAY ĐỔI:\r\n${JSON.stringify(log.details, null, 2)}\r\n`;
    }
    text += `--------------------------------------------------------------------------------\r\n\r\n`;
  });

  return text;
}
