import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  onSnapshot,
  getDocFromServer,
  Unsubscribe,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { SavingsBook, SettlementAdjustment, AppSettings, MasterSyncState, WorkspaceMember, BankInfo } from '../types';
import { SyncAuditLogEntry } from './syncAuditLog';

// Khởi tạo Firebase App & Firestore Database với cấu hình tự động thích ứng kết nối (Long-Polling)
// để tránh lỗi ngắt kết nối backend WebChannel trên môi trường WebView và Proxy
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = (() => {
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      ignoreUndefinedProperties: true,
    }, firebaseConfig.firestoreDatabaseId);
  } catch (err) {
    try {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    } catch {
      return getFirestore(app);
    }
  }
})();

const WORKSPACE_DOC_ID = 'family_vault';
const MAX_LOGS_LIMIT = 50;

/**
 * 1. QUẢN LÝ TRẠNG THÁI KHÔNG GIAN LÀM VIỆC (MASTER WORKSPACE POINTER TRÊN FIRESTORE)
 * Lưu đúng các trường thông tin mà file so_tiet_kiem_backup.json trước đây lưu trữ.
 */
export async function getWorkspaceMasterStateFromFirestore(): Promise<MasterSyncState | null> {
  try {
    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    
    // Add strict 8-second timeout to prevent hangs when Firestore connection is unstable
    const fetchPromise = getDoc(docRef);
    const timeoutPromise = new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT: Quá thời gian tải dữ liệu từ Firestore (8 giây).')), 8000)
    );
    
    const docSnap = await Promise.race([fetchPromise, timeoutPromise]);

    if (!docSnap || !docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();
    return {
      status: data.status || 'unlinked',
      lastAction: data.lastAction || 'link',
      activeFileId: data.activeFileId || '',
      activeFileName: data.activeFileName || '',
      activeFileUrl: data.activeFileUrl || '',
      mimeType: data.mimeType || 'application/vnd.google-apps.spreadsheet',
      linkedTimestamp: data.linkedTimestamp || data.createdAt || '',
      linkedLocalTimeVi: data.linkedLocalTimeVi || '',
      linkedAccountEmail: data.linkedAccountEmail || '',
      adminEmail: data.adminEmail || '',
      members: data.members || [],
      settlements: data.settlements || [],
      banksConfig: data.banksConfig || undefined,
      schemaVersion: data.schemaVersion || 1,
      updatedAt: data.updatedAt || '',
      updatedAtVi: data.updatedAtVi || '',
    };
  } catch (err) {
    console.warn('[Firestore Workspace] Lỗi khi nạp Master State từ Firestore:', err);
    return null;
  }
}

/**
 * Lưu trạng thái Master Workspace Pointer lên Firestore
 */
export async function saveWorkspaceMasterStateToFirestore(
  state: Partial<MasterSyncState>
): Promise<boolean> {
  try {
    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    const existing = await getWorkspaceMasterStateFromFirestore().catch(() => null);

    const currentUserEmail = auth.currentUser?.email || state.linkedAccountEmail || state.adminEmail || 'admin';
    const nowIso = state.updatedAt || new Date().toISOString();
    const nowVi = state.updatedAtVi || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (GMT+7)';
    const linkedIso = state.linkedTimestamp || existing?.linkedTimestamp || nowIso;
    const linkedVi = state.linkedLocalTimeVi || existing?.linkedLocalTimeVi || nowVi;

    const payload: MasterSyncState = {
      status: state.status || existing?.status || 'active',
      lastAction: state.lastAction || existing?.lastAction || 'link',
      activeFileId: state.activeFileId !== undefined ? state.activeFileId : (existing?.activeFileId || ''),
      activeFileName: state.activeFileName !== undefined ? state.activeFileName : (existing?.activeFileName || ''),
      activeFileUrl: state.activeFileUrl !== undefined ? state.activeFileUrl : (existing?.activeFileUrl || ''),
      mimeType: state.mimeType || existing?.mimeType || 'application/vnd.google-apps.spreadsheet',
      linkedTimestamp: linkedIso,
      linkedLocalTimeVi: linkedVi,
      linkedAccountEmail: state.linkedAccountEmail || existing?.linkedAccountEmail || currentUserEmail,
      adminEmail: state.adminEmail || existing?.adminEmail || currentUserEmail,
      members: state.members !== undefined ? state.members : (existing?.members || []),
      settlements: state.settlements !== undefined ? state.settlements : (existing?.settlements || []),
      banksConfig: state.banksConfig !== undefined ? state.banksConfig : (existing?.banksConfig || undefined),
      schemaVersion: state.schemaVersion || existing?.schemaVersion || 1,
      updatedAt: nowIso,
      updatedAtVi: nowVi,
    };

    await setDoc(docRef, payload, { merge: true });
    console.info('[Firestore Workspace] Đã cập nhật Master Pointer lên Firestore thành công.');
    return true;
  } catch (err) {
    console.warn('[Firestore Workspace] Lỗi khi lưu Master Pointer lên Firestore:', err);
    return false;
  }
}

/**
 * Lắng nghe thay đổi Master Workspace theo thời gian thực (Real-time Listener)
 */
export function subscribeToWorkspaceMasterState(
  callback: (state: MasterSyncState | null) => void
): Unsubscribe {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return () => {};
    }
    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    return onSnapshot(
      docRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          callback(null);
          return;
        }
        const data = docSnap.data();
        callback({
          status: data.status || 'unlinked',
          lastAction: data.lastAction || 'link',
          activeFileId: data.activeFileId || '',
          activeFileName: data.activeFileName || '',
          activeFileUrl: data.activeFileUrl || '',
          mimeType: data.mimeType || 'application/vnd.google-apps.spreadsheet',
          linkedTimestamp: data.linkedTimestamp || '',
          linkedLocalTimeVi: data.linkedLocalTimeVi || '',
          linkedAccountEmail: data.linkedAccountEmail || '',
          adminEmail: data.adminEmail || '',
          members: data.members || [],
          settlements: data.settlements || [],
          banksConfig: data.banksConfig || undefined,
          schemaVersion: data.schemaVersion || 1,
          updatedAt: data.updatedAt || '',
          updatedAtVi: data.updatedAtVi || '',
        });
      },
      (err) => {
        console.warn('[Firestore Workspace] Lỗi lắng nghe realtime Master State:', err);
      }
    );
  } catch {
    return () => {};
  }
}

export async function getBanksConfigFromFirestore(): Promise<BankInfo[] | null> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    
    // Add strict 6-second timeout to prevent hangs when Firestore connection is unstable
    const fetchPromise = getDoc(docRef);
    const timeoutPromise = new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT: Quá thời gian nạp cấu hình ngân hàng.')), 6000)
    );
    
    const docSnap = await Promise.race([fetchPromise, timeoutPromise]);
    if (!docSnap || !docSnap.exists()) return [];
    const data = docSnap.data();
    if (Array.isArray(data.banksConfig) && data.banksConfig.length > 0) {
      return data.banksConfig as BankInfo[];
    }
    return [];
  } catch (err) {
    console.warn('[Firestore Banks] Lỗi khi nạp cấu hình ngân hàng từ Firestore:', err);
    return null;
  }
}

/**
 * Lưu cấu hình danh sách ngân hàng lên Firestore (đồng bộ cho tất cả các thiết bị)
 */
export async function saveBanksConfigToFirestore(banks: BankInfo[]): Promise<boolean> {
  try {
    if (!Array.isArray(banks) || banks.length === 0) return false;
    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    const nowIso = new Date().toISOString();
    const nowVi = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) + ' (GMT+7)';
    await setDoc(docRef, {
      banksConfig: banks,
      updatedAt: nowIso,
      updatedAtVi: nowVi,
    }, { merge: true });
    console.info(`[Firestore Banks] Đã đồng bộ ${banks.length} ngân hàng lên Firestore thành công.`);
    return true;
  } catch (err) {
    console.warn('[Firestore Banks] Lỗi khi lưu cấu hình ngân hàng lên Firestore:', err);
    return false;
  }
}

/**
 * Lắng nghe thay đổi cấu hình ngân hàng thời gian thực từ Firestore
 */
export function subscribeToBanksConfig(callback: (banks: BankInfo[]) => void): Unsubscribe {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return () => {};
    }
    const docRef = doc(db, 'workspaces', WORKSPACE_DOC_ID);
    return onSnapshot(
      docRef,
      (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        if (Array.isArray(data.banksConfig) && data.banksConfig.length > 0) {
          callback(data.banksConfig as BankInfo[]);
        }
      },
      (err) => {
        console.warn('[Firestore Banks] Lỗi lắng nghe realtime cấu hình ngân hàng:', err);
      }
    );
  } catch {
    return () => {};
  }
}


/**
 * 2. ĐẨY NHẬT KÝ KIỂM TOÁN VÀ TỰ ĐỘNG GIỚI HẠN 50 BẢN GHI GẦN NHẤT
 */
export async function pushAuditLogToFirestore(entry: SyncAuditLogEntry): Promise<void> {
  try {
    const cleanId = entry.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const logDocRef = doc(db, 'audit_logs', cleanId);

    const payload = {
      id: cleanId,
      timestamp: new Date(entry.timestamp).toISOString(),
      action: entry.type,
      status: (entry.status || 'info').toUpperCase(),
      details: entry.summary || entry.title || '',
      fullTitle: entry.title || '',
      userEmail: entry.userEmail || auth.currentUser?.email || 'unknown',
      userName: entry.userName || auth.currentUser?.displayName || 'Thành viên',
      currentRole: entry.userEmail?.toLowerCase() === 'tuanta3012@gmail.com' ? 'ADMIN' : (entry.currentRole?.toUpperCase() || 'ADMIN'),
      platform: typeof navigator !== 'undefined' ? (navigator.userAgent.includes('Android') ? 'Android' : 'Web') : 'Web',
      appVersion: entry.appVersion || '1.0.2',
      errorStack: entry.errorMessage || (entry.details?.error ? String(entry.details.error) : ''),
      technicalDetails: entry.details ? JSON.stringify(entry.details) : '',
      createdAt: new Date().toISOString(),
    };

    await setDoc(logDocRef, payload);

    // Tự động dọn dẹp để đảm bảo luôn chỉ giữ đúng tối đa 50 bản ghi gần nhất trên Firestore
    pruneOldAuditLogsFromFirestore().catch(() => {});
  } catch (err) {
    console.warn('[Central Audit Log] Lỗi đẩy log lên Firestore:', err);
  }
}

/**
 * Hàm dọn dẹp tự động: Xóa các log cũ vượt quá 50 bản ghi
 */
async function pruneOldAuditLogsFromFirestore(): Promise<void> {
  try {
    const logsCol = collection(db, 'audit_logs');
    const q = query(logsCol, orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);

    if (snapshot.size > MAX_LOGS_LIMIT) {
      const docsToDelete = snapshot.docs.slice(MAX_LOGS_LIMIT);
      for (const d of docsToDelete) {
        await deleteDoc(d.ref).catch(() => {});
      }
    }
  } catch {
    // Không làm ảnh hưởng luồng chính
  }
}

/**
 * LẤY DANH SÁCH NHẬT KÝ KIỂM TOÁN TẬP TRUNG TỪ FIRESTORE (Tối đa 50 bản ghi)
 */
export async function fetchCentralAuditLogsFromFirestore(maxLimit = 50): Promise<SyncAuditLogEntry[]> {
  try {
    const logsCol = collection(db, 'audit_logs');
    const q = query(logsCol, orderBy('timestamp', 'desc'), limit(Math.min(maxLimit, MAX_LOGS_LIMIT)));
    const snapshot = await getDocs(q);

    const logs: SyncAuditLogEntry[] = [];
    snapshot.forEach((d) => {
      const data = d.data();
      let parsedDetails: any = undefined;
      if (data.technicalDetails) {
        try {
          parsedDetails = JSON.parse(data.technicalDetails);
        } catch {
          parsedDetails = { raw: data.technicalDetails };
        }
      }

      logs.push({
        id: data.id || d.id,
        timestamp: new Date(data.timestamp || data.createdAt).getTime(),
        timeStr: new Date(data.timestamp || data.createdAt).toLocaleString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        type: (data.action as any) || 'INFO',
        title: data.fullTitle || data.details || 'Nhật ký kiểm toán',
        status: (data.status ? data.status.toLowerCase() : 'info') as any,
        userEmail: data.userEmail,
        userName: data.userName,
        currentRole: data.currentRole,
        platform: data.platform,
        appVersion: data.appVersion,
        summary: data.details || '',
        errorMessage: data.errorStack || undefined,
        details: parsedDetails,
      });
    });

    return logs;
  } catch (err) {
    console.warn('[Central Audit Log] Lỗi khi kéo log trung tâm từ Firestore:', err);
    return [];
  }
}

