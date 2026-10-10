/**
 * Module ghi nhật ký kiểm toán (Audit Log) cho toàn bộ các thay đổi và hoạt động đồng bộ:
 * - Theo dõi chi tiết từng lần Đọc (Pull) và Ghi (Push) với Google Drive / Google Sheets.
 * - Ghi lại chính xác dải ô (Ranges) được cập nhật trên Google Sheets.
 * - Ghi lại những dữ liệu lịch sử được bảo toàn (2019-2025) và những dữ liệu mới được cập nhật (2026-2028).
 * - Lưu trữ trong localStorage và đồng bộ lên file log trên Google Drive để điều tra sự cố.
 */



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
const MAX_LOG_ENTRIES = 15;

/**
 * Kiểm tra xem ứng dụng đã liên kết với file Google Drive/Sheets hay chưa.
 * Chỉ khi đã liên kết file thì hệ thống mới bắt đầu kích hoạt ghi nhật ký kiểm toán (Audit Log).
 * Khi chưa liên kết (hoặc đã hủy liên kết), hệ thống không ghi nhận để tránh nhiễu dữ liệu.
 */
export function hasActiveLinkedFile(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;

    // 1. Kiểm tra con trỏ file ID gần nhất
    const pointerFileId =
      localStorage.getItem('last_linked_file_id_v2') ||
      localStorage.getItem('master_pointer_file_id_v2');
    if (pointerFileId && pointerFileId.trim() && pointerFileId !== 'unlinked') {
      return true;
    }

    // 2. Kiểm tra AppSettings đã có googleSheetUrl chưa
    const rawSettings = localStorage.getItem('savings_settings_v3');
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (
        parsed?.googleSheetUrl &&
        typeof parsed.googleSheetUrl === 'string' &&
        parsed.googleSheetUrl.trim().length > 5
      ) {
        return true;
      }
    }

    // 3. Kiểm tra MasterSyncState
    const rawMaster = localStorage.getItem('savings_master_sync_state_v2');
    if (rawMaster) {
      const master = JSON.parse(rawMaster);
      if (master?.status === 'active' && master?.activeFileId) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

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
 * Thêm một mục nhật ký kiểm toán mới.
 * CHỈ GHI KHI: File đã được liên kết hoặc mục log chỉ rõ fileId đang xử lý.
 */
export function recordSyncAuditLog(
  entry: Omit<SyncAuditLogEntry, 'id' | 'timestamp' | 'timeStr'>
): SyncAuditLogEntry {
  const isLinked = hasActiveLinkedFile();
  // Nếu chưa liên kết file và entry không chỉ định fileId cụ thể:
  // KHÔNG lưu vào storage để tránh nhiễu và rác hệ thống trước khi liên kết
  if (!isLinked && !entry.fileId) {
    console.debug('[SYNC AUDIT SKIP - Chưa liên kết file]', entry.title, entry.summary);
    return {
      ...entry,
      id: `unlinked_skip_${Date.now()}`,
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString('vi-VN'),
    };
  }

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

  let updatedLogs: SyncAuditLogEntry[] = [fullEntry];
  try {
    const existing = getSyncAuditLogs();
    updatedLogs = [fullEntry, ...existing].slice(0, MAX_LOG_ENTRIES);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedLogs));
    }
  } catch (err) {
    console.warn('Lỗi lưu audit log:', err);
  }

  // Đồng bộ không đồng bộ lên Tab __CONFIG__ của Google Sheet liên kết
  try {
    if (typeof window !== 'undefined') {
      const token =
        localStorage.getItem('google_drive_access_token_v4') ||
        localStorage.getItem('google_access_token') ||
        sessionStorage.getItem('google_access_token');
      if (token) {
        import('./googleDriveService').then(({ saveMasterSyncStateOnDrive }) => {
          saveMasterSyncStateOnDrive(token, {
            status: 'active',
            activeFileId: entry.fileId || undefined,
            auditLogs: updatedLogs,
          }).catch(() => {});
        });
      }
    }
  } catch {}

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
 * Xóa sạch toàn bộ nhật ký kiểm toán cục bộ
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
 * Khởi tạo phiên audit log mới khi liên kết với file Google Drive:
 * 1. Xóa sạch toàn bộ log cũ khỏi storage (và đồng bộ reset lên Google Drive nếu có token)
 * 2. Ghi 1 bản ghi mốc khởi đầu sạch sẽ xác nhận bắt đầu theo dõi file mới
 */
export function initAuditLogForLinkedFile(
  fileId: string,
  fileName?: string,
  userEmail?: string,
  token?: string
): SyncAuditLogEntry {
  // 1. Xóa sạch toàn bộ log cũ để tránh nhiễu
  clearSyncAuditLogs();

  // 2. Ghi bản ghi mốc khởi đầu
  const initialEntry = recordSyncAuditLog({
    type: 'INFO',
    title: 'Bắt đầu theo dõi kiểm toán file mới',
    status: 'info',
    fileId,
    sheetName: fileName,
    userEmail,
    summary: `Đã liên kết file "${fileName || fileId}". Đã xóa sạch nhật ký kiểm toán cũ để bắt đầu theo dõi mới từ mốc này.`,
    details: {
      action: 'FILE_LINKED_INIT',
      fileId,
      fileName,
      userEmail,
      linkedAt: new Date().toISOString(),
    },
  });

  // 3. Nếu có token, đồng bộ ngay mốc khởi đầu lên Drive để dọn sạch log cũ trên sheet
  if (token) {
    try {
      import('./googleDriveService').then(({ saveMasterSyncStateOnDrive }) => {
        saveMasterSyncStateOnDrive(token, {
          status: 'active',
          activeFileId: fileId,
          activeFileName: fileName,
          auditLogs: [initialEntry],
        }).catch(() => {});
      });
    } catch {}
  }

  return initialEntry;
}

/**
 * Xóa sạch toàn bộ nhật ký kiểm toán trên Cloud của file Google Drive đang liên kết
 */
export async function clearCloudSyncAuditLogs(token: string, fileId?: string): Promise<boolean> {
  try {
    clearSyncAuditLogs();
    const { saveMasterSyncStateOnDrive } = await import('./googleDriveService');
    await saveMasterSyncStateOnDrive(token, {
      status: 'active',
      activeFileId: fileId,
      auditLogs: [],
    });
    return true;
  } catch (err) {
    console.warn('Lỗi xóa audit log trên Cloud:', err);
    return false;
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
