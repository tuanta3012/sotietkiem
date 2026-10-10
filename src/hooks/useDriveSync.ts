import React, { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { SavingsBook, AppSettings, AuthUser, SettlementAdjustment, BookStatus, canPushToDrive } from '../types';
import { sortAndReindexBooks, deduplicateSettlementAdjustments } from '../utils/dataTranslator';
import {
  getGoogleAccessToken,
  setGoogleAccessToken,
  ensureGoogleAccessToken,
  trySilentRefresh,
  isGoogleTokenValid,
  downloadRealGoogleDriveFile,
  updateRealGoogleDriveFile,
  getRealGoogleDriveFileMetadata,
  autoDiscoverLatestCentralHub,
  setMasterSyncLinked,
  getMasterSyncStateFromDrive,
  saveMasterSyncStateOnDrive,
  touchMasterSyncStateOnDrive,
  applyMasterStateToSettings,
  isExplicitlyUnlinked,
  setExplicitlyUnlinked,
} from '../utils/googleDriveService';
import {
  recordSyncAuditLog,
  initAuditLogForLinkedFile,
  clearSyncAuditLogs,
} from '../utils/syncAuditLog';
import { resolveUserRole } from '../utils/roleHelper';
import { getAdjustedMaturityDate } from '../utils/calculator';

import { clearStaticHistoryFromStorage } from '../data/historicalGrowth';
import { mergeBooksAndSettlements } from '../utils/conflictResolver';
import {
  getOutboxData,
  acknowledgeSyncedMutations,
  acknowledgeDeletedBooks,
} from '../utils/syncOutbox';
import { saveSavingsBooksToFile, saveSettlementsToFile } from '../utils/fileStorage';

function isActuallyUnlinked(masterState: any, localLinkTimestamp?: string): boolean {
  if (!masterState || (masterState.status !== 'unlinked' && masterState.lastAction !== 'unlink')) {
    return false;
  }
  const unlinkMs = masterState.updatedAt
    ? new Date(masterState.updatedAt).getTime()
    : masterState.linkedTimestamp
    ? new Date(masterState.linkedTimestamp).getTime()
    : 0;
  const localMs = localLinkTimestamp ? new Date(localLinkTimestamp).getTime() : 0;
  return unlinkMs > localMs && unlinkMs > 0;
}


interface UseDriveSyncProps {
  currentUser: AuthUser | null;
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  books: SavingsBook[];
  setBooks: Dispatch<SetStateAction<SavingsBook[]>>;
  settlementAdjustments: SettlementAdjustment[];
  setSettlementAdjustments?: Dispatch<SetStateAction<SettlementAdjustment[]>>;
  setShowFileDeletedRecovery: (show: boolean) => void;
}

export interface SyncConflictState {
  fileId: string;
  fileName: string;
  remoteModifiedTime: string;
  localBooks: SavingsBook[];
  localSettlements: SettlementAdjustment[];
  remoteBooks: SavingsBook[];
  remoteSettlements: SettlementAdjustment[];
}

const SYNC_CONFLICT_STORAGE_KEY = 'savings_sync_conflict_v1';
const SYNC_BASELINE_STORAGE_KEY = 'savings_sync_baseline_v1';

interface SyncBaseline {
  fileId: string;
  modifiedTime: string | null;
  books: SavingsBook[];
  settlements: SettlementAdjustment[];
}

function getDriveFileIdFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/);
  return match
    ? match[1]
    : url.length > 20 && !url.includes('/')
    ? url
    : null;
}

function readSavedSyncBaseline(url?: string): SyncBaseline | null {
  const fileId = getDriveFileIdFromUrl(url);
  if (!fileId) return null;
  try {
    const saved = localStorage.getItem(SYNC_BASELINE_STORAGE_KEY);
    const baseline = saved ? JSON.parse(saved) as SyncBaseline : null;
    return baseline?.fileId === fileId &&
      Array.isArray(baseline.books) &&
      Array.isArray(baseline.settlements)
      ? baseline
      : null;
  } catch (err) {
    console.error('[Drive Sync] Could not restore the last synchronized snapshot.', err);
    return null;
  }
}

function persistSyncBaseline(baseline: SyncBaseline): void {
  try {
    localStorage.setItem(SYNC_BASELINE_STORAGE_KEY, JSON.stringify(baseline));
  } catch (err) {
    console.error('[Drive Sync] Could not persist the last synchronized snapshot.', err);
  }
}

function readSavedSyncConflict(): SyncConflictState | null {
  try {
    const saved = localStorage.getItem(SYNC_CONFLICT_STORAGE_KEY);
    const conflict = saved ? JSON.parse(saved) as SyncConflictState : null;
    if (
      conflict &&
      typeof conflict.fileId === 'string' &&
      typeof conflict.remoteModifiedTime === 'string' &&
      Array.isArray(conflict.localBooks) &&
      Array.isArray(conflict.localSettlements) &&
      Array.isArray(conflict.remoteBooks) &&
      Array.isArray(conflict.remoteSettlements)
    ) {
      return conflict;
    }
    return null;
  } catch (err) {
    console.error('[Drive Sync] Could not restore a saved sync conflict.', err);
    return null;
  }
}

export function booksHaveSameSheetData(left: SavingsBook[], right: SavingsBook[]): boolean {
  const toSheetData = (books: SavingsBook[]) =>
    books
      .map((book) => ({
        bankId: book.bankId,
        owner: String(book.owner).trim().toLowerCase(),
        depositType: book.depositType,
        principalMillions: Math.round(book.principal / 1_000_000),
        interestRate: Number(book.interestRate.toFixed(2)),
        termMonths: book.termMonths,
        startDate: book.startDate,
        maturityDate: getAdjustedMaturityDate(book.maturityDate, book.depositType, book.bankId),
      }))
      .sort((a, b) =>
        `${a.bankId}|${a.owner}|${a.principalMillions}|${a.startDate}|${a.maturityDate}`.localeCompare(
          `${b.bankId}|${b.owner}|${b.principalMillions}|${b.startDate}|${b.maturityDate}`
        )
      );
  return JSON.stringify(toSheetData(left)) === JSON.stringify(toSheetData(right));
}

export function settlementsHaveSameSheetData(left: SettlementAdjustment[], right: SettlementAdjustment[]): boolean {
  const toSheetData = (settlements: SettlementAdjustment[]) =>
    deduplicateSettlementAdjustments(settlements)
      .map((item) => ({
        bankId: item.bankId,
        owner: String(item.owner).trim().toLowerCase(),
        principalMillions: Math.round(item.principal / 1_000_000),
        settlementDate: item.settlementDate,
        settlementType: item.settlementType,
        actualInterestMillions: Math.round(item.actualInterestVND / 1_000_000),
        note: item.note,
      }))
      .sort((a, b) =>
        `${a.bankId}|${a.owner}|${a.principalMillions}|${a.settlementDate}|${a.settlementType}`.localeCompare(
          `${b.bankId}|${b.owner}|${b.principalMillions}|${b.settlementDate}|${b.settlementType}`
        )
      );
  return JSON.stringify(toSheetData(left)) === JSON.stringify(toSheetData(right));
}

export function useDriveSync({
  currentUser,
  settings,
  setSettings,
  books,
  setBooks,
  settlementAdjustments,
  setSettlementAdjustments,
  setShowFileDeletedRecovery,
}: UseDriveSyncProps) {
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [syncDriveStatus, setSyncDriveStatus] = useState<string | null>(null);
  const [syncConflict, setSyncConflict] = useState<SyncConflictState | null>(readSavedSyncConflict);
  const [initialSyncBaseline] = useState<SyncBaseline | null>(() => readSavedSyncBaseline(settings.googleSheetUrl));
  const [detectedDesyncHub, setDetectedDesyncHub] = useState<{ id: string; name: string; webViewLink?: string; linkedTimestamp?: string } | null>(null);
  const [isDriveTokenExpired, setIsDriveTokenExpired] = useState<boolean>(false);

  // Đảm bảo ở chế độ offline (hoặc người dùng ngoại tuyến), tuyệt đối không mở cảnh báo hết hạn token Drive
  useEffect(() => {
    if (!currentUser || currentUser.isOffline) {
      setIsDriveTokenExpired(false);
      setSyncDriveStatus(null);
    }
  }, [currentUser]);

  // Refs và cơ chế quản lý đồng bộ 2 chiều phản xạ (Reactive 2-Way Sync)
  const isTabVisibleRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const lastCheckedModifiedTimeTimestampRef = useRef<number>(Date.now());
  const isRemoteUpdateRef = useRef<boolean>(false);
  const isInitialSyncDoneRef = useRef<boolean>(false);
  const lastCheckedModifiedTimeRef = useRef<string | null>(initialSyncBaseline?.modifiedTime || null);
  const lastSyncedBooksRef = useRef<SavingsBook[] | null>(initialSyncBaseline?.books || null);
  const lastSyncedSettlementsRef = useRef<SettlementAdjustment[] | null>(initialSyncBaseline?.settlements || null);
  const hasUnresolvedSyncConflictRef = useRef<boolean>(Boolean(syncConflict));
  const isCheckingRemoteRef = useRef<boolean>(false);
  const previousBooksStringRef = useRef<string>(JSON.stringify(books));
  const previousAdjsStringRef = useRef<string>(JSON.stringify(settlementAdjustments));

  // Helper đồng bộ danh sách nhật ký tất toán từ file liên kết trên Google Drive (Nguồn sự thật duy nhất)
  const applyMasterSettlements = useCallback(
    (remoteSettlements: SettlementAdjustment[] | undefined) => {
      if (!setSettlementAdjustments) return;
      const cleanNext = deduplicateSettlementAdjustments(remoteSettlements || []);
      const nextStr = JSON.stringify(cleanNext);
      previousAdjsStringRef.current = nextStr;
      setSettlementAdjustments(cleanNext);
      try {
        localStorage.setItem('savings_settlements_v3', nextStr);
      } catch {}
    },
    [setSettlementAdjustments]
  );

  // Triệt tiêu vòng lặp phản xạ khi đổi file hoặc push/pull liên tục
  const settlementAdjustmentsRef = useRef<SettlementAdjustment[]>(settlementAdjustments);
  settlementAdjustmentsRef.current = settlementAdjustments;
  const remoteSyncCooldownUntilRef = useRef<number>(0);

  const isSwitchingFileRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);
  const isPushingRef = useRef<boolean>(false);
  const isResolvingSyncConflictRef = useRef<boolean>(false);
  const isAutoConnectingRef = useRef<boolean>(false);
  const lastLocalPushTimeRef = useRef<number>(0);
  const fileSwitchCooldownUntilRef = useRef<number>(0);

  // Hàng đợi đẩy dữ liệu tránh race condition khi cập nhật nhanh liên tục
  const needsPushRef = useRef<boolean>(false);
  const pendingBooksRef = useRef<SavingsBook[] | null>(null);
  const pendingAdjsRef = useRef<SettlementAdjustment[] | null>(null);

  // Quản lý độ trễ index tìm kiếm của Google Drive API (để tránh vòng lặp phản hồi ngược)
  const lastUrlChangeTimeRef = useRef<number>(Date.now());
  const prevUrlRef = useRef<string | undefined>(settings.googleSheetUrl);
  const lastSyncedUrlRef = useRef<string | null>(settings.googleSheetUrl || null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (settings.googleSheetUrl !== prevUrlRef.current) {
      lastUrlChangeTimeRef.current = Date.now();
      prevUrlRef.current = settings.googleSheetUrl;
      const baseline = readSavedSyncBaseline(settings.googleSheetUrl);
      lastCheckedModifiedTimeRef.current = baseline?.modifiedTime || null;
      lastSyncedBooksRef.current = baseline?.books || null;
      lastSyncedSettlementsRef.current = baseline?.settlements || null;
      hasUnresolvedSyncConflictRef.current = false;
      setSyncConflict(null);
      try {
        localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
      } catch (err) {
        console.error('[Drive Sync] Could not clear the conflict marker after a file switch.', err);
      }
    }
  }, [settings.googleSheetUrl]);

  // Lắng nghe các lỗi runtime toàn cục để tự động ghi log vào Google Drive khi đã liên kết file
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      if (!settingsRef.current?.googleSheetUrl) return;
      if (event.error) {
        recordSyncAuditLog({
          type: 'SYNC_ERROR',
          title: 'Lỗi Runtime chưa xử lý',
          status: 'error',
          userEmail: currentUser?.email,
          currentRole: settingsRef.current?.currentRole,
          summary: event.message || 'Uncaught runtime error',
          errorMessage: event.error ? String(event.error?.stack || event.error) : event.message,
          details: {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        });
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!settingsRef.current?.googleSheetUrl) return;
      recordSyncAuditLog({
        type: 'SYNC_ERROR',
        title: 'Lỗi Promise Rejection chưa bắt',
        status: 'error',
        userEmail: currentUser?.email,
        currentRole: settingsRef.current?.currentRole,
        summary: event.reason ? String(event.reason?.message || event.reason) : 'Unhandled promise rejection',
        errorMessage: event.reason ? String(event.reason?.stack || event.reason) : 'Unhandled promise rejection',
      });
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [currentUser?.email]);

  // Khởi tạo quy trình chuyển đổi liên kết file: Khóa toàn bộ các trigger push/pull tự động
  const startFileSwitch = useCallback(() => {
    isSwitchingFileRef.current = true;
    isInitialSyncDoneRef.current = false;
    isCheckingRemoteRef.current = true;
    fileSwitchCooldownUntilRef.current = Date.now() + 10000;
    setIsSyncingDrive(true);
    setSyncDriveStatus('Đang chuyển đổi liên kết file Google Drive...');
  }, []);

  const cancelFileSwitch = useCallback(() => {
    isSwitchingFileRef.current = false;
    isCheckingRemoteRef.current = false;
    isInitialSyncDoneRef.current = true;
    setIsSyncingDrive(false);
    setSyncDriveStatus(null);
  }, []);

  const finishFileSwitch = useCallback(
    (
      newBooks: SavingsBook[],
      newAdjs?: SettlementAdjustment[],
      newUrl?: string,
      newFileName?: string,
      stampTime?: string,
      fileModTime?: string
    ) => {
      // 1. Chuẩn hóa danh sách sổ để bảo đảm tính nhất quán (deterministic)
      const activeRemote = newBooks.filter((b) => b.status !== 'settled');
      const normalizedBooks = sortAndReindexBooks(activeRemote);
      const adjsToKeep = deduplicateSettlementAdjustments(newAdjs ?? settlementAdjustments);

      // 2. Cập nhật các snapshot và ref trước khi cập nhật state
      previousBooksStringRef.current = JSON.stringify(normalizedBooks);
      previousAdjsStringRef.current = JSON.stringify(adjsToKeep);
      isRemoteUpdateRef.current = true;

      const effectiveUrl = newUrl ?? settings.googleSheetUrl;
      if (effectiveUrl) {
        lastSyncedUrlRef.current = effectiveUrl;
        prevUrlRef.current = effectiveUrl;
      }
      lastUrlChangeTimeRef.current = Date.now();
      lastLocalPushTimeRef.current = Date.now();
      lastCheckedModifiedTimeRef.current = fileModTime || null;
      lastSyncedBooksRef.current = normalizedBooks;
      lastSyncedSettlementsRef.current = adjsToKeep;
      hasUnresolvedSyncConflictRef.current = false;
      setSyncConflict(null);
      const effectiveFileId = getDriveFileIdFromUrl(effectiveUrl);
      if (effectiveFileId) {
        persistSyncBaseline({
          fileId: effectiveFileId,
          modifiedTime: fileModTime || null,
          books: normalizedBooks,
          settlements: adjsToKeep,
        });
        // Khi liên kết hoặc chuyển đổi sang file mới: Xóa sạch toàn bộ log cũ và bắt đầu ghi log mới từ mốc này
        initAuditLogForLinkedFile(
          effectiveFileId,
          newFileName || settings.googleSheetName,
          currentUser?.email,
          getGoogleAccessToken() || undefined
        );
      } else {
        // Hủy liên kết: Xóa sạch toàn bộ nhật ký kiểm toán cũ để tránh nhiễu
        clearSyncAuditLogs();
      }

      // 3. Cập nhật state nội bộ và bộ nhớ lưu trữ
      try {
        localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
        if (normalizedBooks.length > 0) {
          localStorage.removeItem('savings_books_cleared');
        } else {
          localStorage.setItem('savings_books_cleared', 'true');
        }
        localStorage.setItem('savings_books_v3', JSON.stringify(normalizedBooks));
        localStorage.setItem('savings_settlements_v3', JSON.stringify(adjsToKeep));
      } catch {}
      setBooks(normalizedBooks);
      if (setSettlementAdjustments) {
        setSettlementAdjustments(adjsToKeep);
      }

      const nowStr = new Date().toLocaleString('vi-VN');
      setSettings((prev) => ({
        ...prev,
        googleSheetUrl: effectiveUrl || '',
        googleSheetName: newFileName || prev.googleSheetName || '',
        lastSyncTime: nowStr,
        autoSync: true,
        lastLocalLinkTimestamp: stampTime || new Date().toISOString(),
      }));

      // Tự động lấp đầy các cột tính toán đã tính xong lên Google Drive ngay khi vừa liên kết file mới
      const token = getGoogleAccessToken();
      const match = effectiveUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || effectiveUrl?.match(/id=([a-zA-Z0-9-_]+)/);
      const fileId = match ? match[1] : null;
      if (token && fileId && normalizedBooks.length > 0) {
        updateRealGoogleDriveFile(token, fileId, normalizedBooks, adjsToKeep)
          .then(() => {
            console.info('[Central Hub Sync] Đã tự động lấp đầy các cột tính toán lên Google Drive ngay sau khi liên kết.');
          })
          .catch((err) => {
            console.warn('Lỗi tự động điền cột tính toán sau khi liên kết:', err);
          });
      }

      // 4. Giữ lock trong 1200ms để mọi render của React và I/O mạng lắng xuống hoàn toàn
      fileSwitchCooldownUntilRef.current = Date.now() + 6000;
      setTimeout(() => {
        isInitialSyncDoneRef.current = true;
        isSwitchingFileRef.current = false;
        isCheckingRemoteRef.current = false;
        setIsSyncingDrive(false);
        setSyncDriveStatus(`✅ Đã kết nối và nạp thành công ${normalizedBooks.length} sổ từ file mới`);
        setTimeout(() => setSyncDriveStatus(null), 3500);
      }, 1200);
    },
    [settings.googleSheetUrl, settlementAdjustments, setBooks, setSettings]
  );

  // Đánh dấu cập nhật dữ liệu đến từ thao tác Drive (nạp file/đổi file) để ngăn phản xạ đẩy ngược lên Drive
  const markAsRemoteUpdate = useCallback(
    (newBooks?: SavingsBook[], newAdjs?: SettlementAdjustment[], newUrl?: string, newModifiedTime?: string) => {
      isRemoteUpdateRef.current = true;
      if (newBooks) {
        previousBooksStringRef.current = JSON.stringify(newBooks);
        lastSyncedBooksRef.current = newBooks;
      }
      if (newAdjs) {
        previousAdjsStringRef.current = JSON.stringify(newAdjs);
        lastSyncedSettlementsRef.current = newAdjs;
      }
      if (newUrl) {
        lastSyncedUrlRef.current = newUrl;
        prevUrlRef.current = newUrl;
        lastUrlChangeTimeRef.current = Date.now();
        const fileId = getDriveFileIdFromUrl(newUrl);
        if (fileId && newBooks && newAdjs) {
          persistSyncBaseline({
            fileId,
            modifiedTime: null,
            books: newBooks,
            settlements: newAdjs,
          });
        }
      }
      if (newModifiedTime) {
        lastCheckedModifiedTimeRef.current = newModifiedTime;
      }
    },
    []
  );

  // Intelligent Drive Synchronization
  const syncBooksFromDrive = useCallback(
    async (forceTokenPrompt = false, explicitToken?: string, pushAfterSync = false) => {
      if (!currentUser || currentUser.isOffline) return;
      if (isSwitchingFileRef.current || isPushingRef.current || isSyncingRef.current) {
        return;
      }
      if (
        hasUnresolvedSyncConflictRef.current &&
        syncConflict?.fileId === getDriveFileIdFromUrl(settings.googleSheetUrl)
      ) {
        isInitialSyncDoneRef.current = true;
        setSyncDriveStatus('⚠️ Xung đột đồng bộ cần được giải quyết trước khi tiếp tục.');
        return;
      }

      let token = explicitToken || getGoogleAccessToken();
      const isValid = isGoogleTokenValid();

      if (!token || !isValid) {
        // Thử silent refresh ngầm trước khi làm gián đoạn người dùng
        const silentToken = await trySilentRefresh();
        if (silentToken) {
          token = silentToken;
        } else if (forceTokenPrompt) {
          try {
            token = await ensureGoogleAccessToken();
          } catch {
            setSyncDriveStatus('Chưa hoàn tất đăng nhập Google để đồng bộ.');
            return;
          }
        } else {
          // Chỉ kích hoạt khi silent refresh thực sự thất bại
          if (token && !isValid) {
            setGoogleAccessToken(null);
            setIsDriveTokenExpired(true);
            setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
          }
          return;
        }
      }

      const currentUrl = settings.googleSheetUrl;
      if (!currentUrl) {
        isInitialSyncDoneRef.current = true;
        return;
      }

      // Phân tích file ID hiện tại
      let currentFileId: string | null = null;
      const match = currentUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || currentUrl.match(/id=([a-zA-Z0-9-_]+)/);
      currentFileId = match
        ? match[1]
        : currentUrl.length > 20 && !currentUrl.includes('/')
        ? currentUrl
        : null;

      if (!currentFileId) {
        isInitialSyncDoneRef.current = true;
        return;
      }

      const fileId = currentFileId;

      isSyncingRef.current = true;
      setIsSyncingDrive(true);
      setSyncDriveStatus('Đang đồng bộ Google Drive...');
      try {
        // Kiểm tra nhanh xem thiết bị khác có hủy liên kết file này trước đó không & nạp danh sách thành viên
        try {
          const masterState = token ? await getMasterSyncStateFromDrive(token, fileId) : null;
          if (masterState) {
            applyMasterStateToSettings(masterState, currentUser?.email, setSettings, settingsRef.current, token);
            if (isActuallyUnlinked(masterState, settingsRef.current?.lastLocalLinkTimestamp)) {
              const unlinkMs = masterState.updatedAt
                ? new Date(masterState.updatedAt).getTime()
                : masterState.linkedTimestamp
                ? new Date(masterState.linkedTimestamp).getTime()
                : 0;
              const localMs = settings.lastLocalLinkTimestamp ? new Date(settings.lastLocalLinkTimestamp).getTime() : 0;
              if (unlinkMs >= localMs || unlinkMs === 0) {
                console.info('[Central Hub Sync] Phát hiện thiết bị khác đã hủy liên kết file trung tâm khi đang đồng bộ.');
                setBooks([]);
                if (setSettlementAdjustments) setSettlementAdjustments([]);
                try {
                  localStorage.setItem('savings_books_v3', JSON.stringify([]));
                  localStorage.setItem('savings_books_cleared', 'true');
                  localStorage.removeItem('savings_settlements_v3');
                  clearStaticHistoryFromStorage();
                  sessionStorage.setItem('explicitly_unlinked', 'true');
                } catch {}
                setSettings((prev) => ({
                  ...prev,
                  googleSheetUrl: '',
                  googleSheetName: '',
                  lastSyncTime: undefined,
                  lastLocalLinkTimestamp: masterState.updatedAt || masterState.linkedTimestamp,
                }));
                setSyncDriveStatus('⚡ Thiết bị khác đã hủy liên kết. Đã dọn sạch dữ liệu để đồng bộ an toàn.');
                isSyncingRef.current = false;
                setIsSyncingDrive(false);
                return;
              }
            }
          }
        } catch (masterErr) {
          console.warn('Lỗi kiểm tra master state trong syncBooksFromDrive:', masterErr);
        }

        let res;
        try {
          res = await downloadRealGoogleDriveFile(token, fileId);
        } catch (tokenErr: any) {
          // If token expired (401) or credentials invalid
          if (
            tokenErr?.message?.includes('hết hạn') ||
            tokenErr?.message?.includes('401') ||
            tokenErr?.message?.includes('invalid authentication credentials') ||
            tokenErr?.message?.includes('credentials')
          ) {
            console.warn('[Central Hub Sync] Token hết hạn trong download. Thử gia hạn ngầm...');
            const freshToken = await trySilentRefresh();
            if (freshToken) {
              token = freshToken;
              setIsDriveTokenExpired(false);
              res = await downloadRealGoogleDriveFile(freshToken, fileId);
            } else if (forceTokenPrompt) {
              try {
                token = await ensureGoogleAccessToken();
                setIsDriveTokenExpired(false);
                res = await downloadRealGoogleDriveFile(token, fileId);
              } catch {
                return;
              }
            } else {
              setGoogleAccessToken(null);
              setIsDriveTokenExpired(true);
              setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
              return;
            }
          } else {
            throw tokenErr;
          }
        }
        if (res.success) {
          const remoteBooks = sortAndReindexBooks(
            (res.books || []).filter((book) => book.status !== 'settled').map((book) => ({
              ...book,
              status: 'active' as BookStatus,
            }))
          );
          const remoteSettlements = deduplicateSettlementAdjustments(res.settlements || []);
          const localBooks = sortAndReindexBooks(
            books.filter((book) => book.status !== 'settled').map((book) => ({
              ...book,
              status: 'active' as BookStatus,
            }))
          );
          const localSettlements = deduplicateSettlementAdjustments(settlementAdjustmentsRef.current);
          const baselineBooks = lastSyncedBooksRef.current;
          const baselineSettlements = lastSyncedSettlementsRef.current;
          const localHasChanges =
            (baselineBooks === null && (localBooks.length > 0 || localSettlements.length > 0)) ||
            (baselineSettlements === null && (localBooks.length > 0 || localSettlements.length > 0)) ||
            (baselineBooks !== null && !booksHaveSameSheetData(localBooks, baselineBooks)) ||
            (baselineSettlements !== null && !settlementsHaveSameSheetData(localSettlements, baselineSettlements));
          const remoteHasChanges =
            (baselineBooks === null && (remoteBooks.length > 0 || remoteSettlements.length > 0)) ||
            (baselineSettlements === null && (remoteBooks.length > 0 || remoteSettlements.length > 0)) ||
            (baselineBooks !== null && !booksHaveSameSheetData(remoteBooks, baselineBooks)) ||
            (baselineSettlements !== null && !settlementsHaveSameSheetData(remoteSettlements, baselineSettlements));

          if (localHasChanges && remoteHasChanges) {
            try {
              const outbox = await getOutboxData();
              const mergeResult = mergeBooksAndSettlements({
                localBooks,
                remoteBooks,
                localSettlements,
                remoteSettlements,
                deletedBookIds: outbox.deletedBookIds,
                pendingMutations: outbox.pendingMutations,
              });

              isRemoteUpdateRef.current = true;
              remoteSyncCooldownUntilRef.current = Date.now() + 5000;
              setBooks(mergeResult.mergedBooks);
              if (setSettlementAdjustments) {
                setSettlementAdjustments(mergeResult.mergedSettlements);
              }
              applyMasterSettlements(mergeResult.mergedSettlements);
              saveSavingsBooksToFile(mergeResult.mergedBooks).catch(() => {});
              saveSettlementsToFile(mergeResult.mergedSettlements).catch(() => {});

              lastSyncedBooksRef.current = mergeResult.mergedBooks;
              lastSyncedSettlementsRef.current = mergeResult.mergedSettlements;

              if (mergeResult.hasChangesToPush && canPushToDrive(settingsRef.current?.currentRole || settings.currentRole)) {
                await updateRealGoogleDriveFile(token, fileId, mergeResult.mergedBooks, mergeResult.mergedSettlements);
                await acknowledgeSyncedMutations(outbox.pendingMutations.map((m) => m.id));
                await acknowledgeDeletedBooks(outbox.deletedBookIds);
              }

              const meta = await getRealGoogleDriveFileMetadata(token, fileId);
              lastCheckedModifiedTimeRef.current = meta?.modifiedTime || null;
              persistSyncBaseline({
                fileId,
                modifiedTime: meta?.modifiedTime || null,
                books: mergeResult.mergedBooks,
                settlements: mergeResult.mergedSettlements,
              });

              hasUnresolvedSyncConflictRef.current = false;
              setSyncConflict(null);
              try {
                localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
              } catch {}

              isInitialSyncDoneRef.current = true;
              setSyncDriveStatus(`✅ Đã đồng bộ & gộp dữ liệu gia đình (${new Date().toLocaleTimeString('vi-VN')})`);
              setTimeout(() => setSyncDriveStatus(null), 4000);
              return;
            } catch (mergeErr) {
              console.warn('[Drive Sync] Tự động hợp nhất thất bại, chuyển sang hiển thị hộp thoại xung đột:', mergeErr);
              const meta = await getRealGoogleDriveFileMetadata(token, fileId);
              const conflict: SyncConflictState = {
                fileId,
                fileName: meta?.name || settingsRef.current?.googleSheetName || 'Google Sheets',
                remoteModifiedTime: meta?.modifiedTime || '',
                localBooks,
                localSettlements,
                remoteBooks,
                remoteSettlements,
              };
              hasUnresolvedSyncConflictRef.current = true;
              needsPushRef.current = false;
              pendingBooksRef.current = null;
              pendingAdjsRef.current = null;
              setSyncConflict(conflict);
              try {
                localStorage.setItem(SYNC_CONFLICT_STORAGE_KEY, JSON.stringify(conflict));
              } catch (err) {
                console.error('[Drive Sync] Failed to persist pull conflict snapshots.', err);
              }
              isInitialSyncDoneRef.current = true;
              setSyncDriveStatus('⚠️ Xung đột đồng bộ: dữ liệu trên Drive và thiết bị đều đã thay đổi. Hãy chọn bản cần giữ.');
              return;
            }
          }

          if (localHasChanges && !remoteHasChanges) {
            const meta = await getRealGoogleDriveFileMetadata(token, fileId);
            lastCheckedModifiedTimeRef.current = meta?.modifiedTime || null;
            lastSyncedBooksRef.current = remoteBooks;
            lastSyncedSettlementsRef.current = remoteSettlements;
            persistSyncBaseline({
              fileId,
              modifiedTime: meta?.modifiedTime || null,
              books: remoteBooks,
              settlements: remoteSettlements,
            });
            needsPushRef.current = true;
            pendingBooksRef.current = books;
            pendingAdjsRef.current = settlementAdjustmentsRef.current;
            isInitialSyncDoneRef.current = true;
            setSyncDriveStatus('Có thay đổi trên thiết bị chưa đồng bộ; đang giữ nguyên bản cục bộ.');
            return;
          }

          isRemoteUpdateRef.current = true;
          remoteSyncCooldownUntilRef.current = Date.now() + 5000;
          applyMasterSettlements(remoteSettlements);
          lastSyncedBooksRef.current = remoteBooks;
          lastSyncedSettlementsRef.current = remoteSettlements;

          const userEmail = currentUser?.email || 'unknown';
          const role = resolveUserRole(userEmail, settingsRef.current?.currentRole, settingsRef.current?.members, settingsRef.current?.workspaceOwnerEmail);
          const activeBooksCount = res.books?.length || 0;
          const settlementsCount = res.settlements?.length || 0;

          recordSyncAuditLog({
            type: 'SYNC_PULL',
            title: 'Tải từ Google Drive',
            status: 'success',
            fileId,
            userEmail,
            currentRole: role,
            sheetName: settingsRef.current?.googleSheetName || 'Google Sheets',
            summary: `Nạp ${activeBooksCount} sổ tiết kiệm, ${res.annualInterestHistory?.length || 0} mốc lãi, ${res.balanceGrowthHistory?.length || 0} mốc số dư, ${settlementsCount} tất toán.`,
            details: {
              activeBooksCount,
              totalPrincipalMillion: res.books?.reduce((s, b) => s + b.principal, 0) ? Math.round(res.books.reduce((s, b) => s + b.principal, 0) / 1_000_000) : 0,
              columns_A_to_M_books: res.books?.map((b, idx) => ({
                col_A_bank: b.bankId.toUpperCase(),
                col_B_owner: b.owner,
                col_C_type: b.depositType || 'counter',
                col_D_rate: `${b.interestRate}%`,
                col_E_principalMil: b.principal / 1_000_000,
                col_F_startDate: b.startDate,
                col_G_maturityDate: b.maturityDate,
                col_H_termMonths: b.termMonths,
                col_J_termInterestMil: (b.estimatedInterest || 0) / 1_000_000,
                col_K_annualInterestMil: (b.annualInterestEquivalent || 0) / 1_000_000,
                col_L_maturityMonth: b.maturityMonthYear,
                col_M_code: b.bookCode || `SO-${idx + 1}`,
              })),
              columns_N_to_P_annualInterest: res.annualInterestHistory,
              columns_Q_to_S_balanceGrowth: res.balanceGrowthHistory,
              columns_U_to_AC_settlements: res.settlements?.map((s) => ({
                col_U_id: s.id,
                col_V_date: s.settlementDate,
                col_W_type: s.settlementType,
                col_X_code: s.bookCode,
                col_Y_bank: s.bankId,
                col_Z_owner: s.owner,
                col_AA_principalMil: s.principal / 1_000_000,
                col_AB_actualInterestMil: s.actualInterestVND / 1_000_000,
                col_AC_note: s.note,
              })),
            },
          });

          isInitialSyncDoneRef.current = true;

          if (res.books) {
            const activeRemote = res.books.map((b) => ({ ...b, status: 'active' as BookStatus }));
            const mergedBooks = sortAndReindexBooks(activeRemote);

            setBooks((prevBooks) => {
              const nextStr = JSON.stringify(mergedBooks);
              const prevStr = JSON.stringify(prevBooks);
              if (prevStr === nextStr) {
                return prevBooks;
              }
              previousBooksStringRef.current = nextStr;
              try {
                localStorage.removeItem('savings_books_cleared');
                localStorage.setItem('savings_books_v3', nextStr);
              } catch {
                // ignore
              }
              return mergedBooks;
            });

            const nowStr = new Date().toLocaleString('vi-VN');
            let fetchedName = settings.googleSheetName;
            try {
              const meta = await getRealGoogleDriveFileMetadata(token, fileId);
              if (meta?.modifiedTime) {
                lastCheckedModifiedTimeRef.current = meta.modifiedTime;
              }
              persistSyncBaseline({
                fileId,
                modifiedTime: meta?.modifiedTime || null,
                books: remoteBooks,
                settlements: remoteSettlements,
              });
              if (meta?.name && !fetchedName) {
                fetchedName = meta.name;
              }
            } catch {
              // ignore
            }

            setSettings((prev) => {
              const shouldUpdateName = fetchedName && fetchedName !== prev.googleSheetName;
              if (!shouldUpdateName && prev.lastSyncTime === nowStr) {
                return prev;
              }
              return {
                ...prev,
                lastSyncTime: nowStr,
                ...(shouldUpdateName ? { googleSheetName: fetchedName } : {}),
              };
            });

            lastSyncedUrlRef.current = currentUrl;
            setSyncDriveStatus(`Đã đồng bộ ${res.books.length} sổ từ Google Drive`);
          } else {
            // File trên Google Drive trống hoặc chưa có sổ
            setBooks([]);
            try {
              localStorage.setItem('savings_books_v3', JSON.stringify([]));
              localStorage.setItem('savings_books_cleared', 'true');
            } catch {}
            setSyncDriveStatus('File Google Drive chưa có sổ tiết kiệm nào.');
          }
        } else if (!res.success && res.errors && res.errors.length > 0) {
          isInitialSyncDoneRef.current = true;
          setSyncDriveStatus(res.errors[0]);
        } else {
          isInitialSyncDoneRef.current = true;
          lastSyncedUrlRef.current = currentUrl;
        }
      } catch (err: any) {
        isInitialSyncDoneRef.current = true;
        recordSyncAuditLog({
          type: 'SYNC_ERROR',
          title: 'Lỗi tải dữ liệu từ Google Drive',
          status: 'error',
          userEmail: currentUser?.email,
          currentRole: settingsRef.current?.currentRole,
          sheetName: settingsRef.current?.googleSheetName,
          summary: `Lỗi đọc file Google Drive: ${err?.message || err}`,
          errorMessage: err?.stack || err?.message,
          details: { fileId, currentUrl },
        });
        if (
          err?.message?.includes('hết hạn') ||
          err?.message?.includes('invalid authentication credentials')
        ) {
          console.warn('Drive sync warning:', err?.message);
          setSyncDriveStatus('Phiên đăng nhập Google hết hạn. Vui lòng bấm đăng nhập lại.');
        } else if (
          err?.message?.includes('FILE_NOT_FOUND') ||
          err?.message?.includes('xóa') ||
          err?.message?.includes('404')
        ) {
          console.warn('Google Drive file deleted or not found for this client:', err?.message);
          setSyncDriveStatus('⚠️ Không thể đọc file liên kết trên tài khoản này (hoặc chưa được chia sẻ quyền).');
        } else {
          console.error('Drive sync error:', err);
          setSyncDriveStatus(`Lỗi đồng bộ: ${err.message}`);
        }
      } finally {
        isSyncingRef.current = false;
        setIsSyncingDrive(false);
        if (!hasUnresolvedSyncConflictRef.current) {
          setTimeout(() => setSyncDriveStatus(null), 3500);
        }

        // Kích hoạt đẩy dữ liệu xếp hàng đợi nếu có thay đổi cục bộ trong khi sync
        if (needsPushRef.current && pendingBooksRef.current) {
          const nextB = pendingBooksRef.current;
          const nextA = pendingAdjsRef.current || settlementAdjustments;
          needsPushRef.current = false;
          pendingBooksRef.current = null;
          pendingAdjsRef.current = null;
          setTimeout(() => {
            pushBooksToDrive(nextB, nextA);
          }, 400);
        }
      }
    },
    [currentUser, settings.googleSheetUrl, settings.googleSheetName, books, settlementAdjustments, setSettings, setBooks, setShowFileDeletedRecovery, syncConflict]
  );

  // Automatic push updated books to Google Drive (2-way sync)
  const pushBooksToDrive = useCallback(
    async (updatedBooks: SavingsBook[], currentAdjustments?: SettlementAdjustment[]) => {
      // TUYỆT ĐỐI KHÔNG GHI ĐÈ KHI CHƯA HOÀN TẤT TẢI DỮ LIỆU TỪ DRIVE VỀ HOẶC ĐANG TRONG THỜI GIAN COOLDOWN
      if (!isInitialSyncDoneRef.current) return;
      if (isSwitchingFileRef.current || isSyncingRef.current || isPushingRef.current) return;
      if (Date.now() < fileSwitchCooldownUntilRef.current) return;
      if (!currentUser || currentUser.isOffline || !settings.googleSheetUrl) return;
      if (!canPushToDrive(settings.currentRole)) {
        console.info('[Smart Sync] Thành viên với vai trò VIEWER (Chỉ xem) không thực hiện đẩy dữ liệu lên Google Drive.');
        return;
      }

      const match =
        settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) ||
        settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/);
      const fileId = match
        ? match[1]
        : settings.googleSheetUrl.length > 20 && !settings.googleSheetUrl.includes('/')
        ? settings.googleSheetUrl
        : null;
      if (!fileId) return;

      if (hasUnresolvedSyncConflictRef.current) {
        if (syncConflict?.fileId === fileId) {
          const refreshedConflict = {
            ...syncConflict,
            localBooks: updatedBooks,
            localSettlements: currentAdjustments ?? settlementAdjustmentsRef.current ?? settlementAdjustments ?? [],
          };
          setSyncConflict(refreshedConflict);
          try {
            localStorage.setItem(SYNC_CONFLICT_STORAGE_KEY, JSON.stringify(refreshedConflict));
          } catch (err) {
            console.error('[Drive Sync] Failed to persist updated local conflict snapshot.', err);
          }
          return;
        }
        hasUnresolvedSyncConflictRef.current = false;
        setSyncConflict(null);
        try {
          localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
        } catch (err) {
          console.error('[Drive Sync] Could not clear a conflict for the previous linked file.', err);
        }
      }

      let token = getGoogleAccessToken();
      const isValid = isGoogleTokenValid();

      if (!token || !isValid) {
        const silentToken = await trySilentRefresh();
        if (silentToken) {
          token = silentToken;
        } else {
          console.warn('[Auto-Push] Token Google Drive không tồn tại hoặc đã hết hạn.');
          if (token && !isValid) {
            setGoogleAccessToken(null);
          }
          setIsDriveTokenExpired(true);
          setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
          return;
        }
      }

      isPushingRef.current = true;
      try {
        setIsSyncingDrive(true);

        // KIỂM TRA TRẠNG THÁI TRÊN DRIVE TRƯỚC KHI GHI (TRÁNH GHI ĐÈ KHI THIẾT BỊ KHÁC ĐÃ UNLINK)
        try {
          const currentMaster = token ? await getMasterSyncStateFromDrive(token, fileId) : null;
          if (currentMaster && isActuallyUnlinked(currentMaster, settingsRef.current?.lastLocalLinkTimestamp)) {
            console.warn('[Central Hub Sync] Phát hiện tệp cấu hình đã được hủy liên kết từ thiết bị khác. Hủy đẩy dữ liệu và tự động ngắt liên kết.');
            
            setExplicitlyUnlinked(true);
            setBooks([]);
            if (setSettlementAdjustments) setSettlementAdjustments([]);
            try {
              localStorage.setItem('savings_books_v3', JSON.stringify([]));
              localStorage.setItem('savings_settlements_v3', JSON.stringify([]));
              localStorage.setItem('savings_books_cleared', 'true');
              clearStaticHistoryFromStorage();
            } catch {}

            setSettings((prev) => ({
              ...prev,
              googleSheetUrl: '',
              googleSheetName: '',
              members: [],
              lastSyncTime: undefined,
              lastLocalLinkTimestamp: currentMaster.updatedAt || currentMaster.linkedTimestamp,
            }));

            setSyncDriveStatus('⚡ Thiết bị khác đã hủy liên kết. Đã ngắt kết nối để bảo mật dữ liệu.');
            setIsSyncingDrive(false);
            isPushingRef.current = false;
            return; // Dừng ngay lập tức, không cho phép ghi đè lên file!
          }
        } catch (masterCheckErr) {
          console.warn('[Auto-Push] Bỏ qua kiểm tra master state do lỗi kết nối:', masterCheckErr);
        }

        const remoteMeta = await getRealGoogleDriveFileMetadata(token, fileId);
        if (!remoteMeta || remoteMeta.isDeleted) {
          throw new Error('Không xác minh được phiên bản hiện tại trên Google Drive; đã hủy ghi để bảo vệ dữ liệu.');
        }

        if (
          (!remoteMeta.modifiedTime ||
            !lastCheckedModifiedTimeRef.current ||
            remoteMeta.modifiedTime !== lastCheckedModifiedTimeRef.current) &&
          Date.now() - lastLocalPushTimeRef.current > 8000
        ) {
          const pullRes = await downloadRealGoogleDriveFile(token, fileId);
          if (!pullRes.success) {
            throw new Error(
              `Google Drive đã thay đổi nhưng dữ liệu mới không vượt qua kiểm tra cấu trúc. Không ghi đè. ${pullRes.errors.join(' ')}`
            );
          }

          const remoteBooks = sortAndReindexBooks(
            (pullRes.books || []).filter((book) => book.status !== 'settled').map((book) => ({
              ...book,
              status: 'active' as BookStatus,
            }))
          );
          const remoteSettlements = deduplicateSettlementAdjustments(pullRes.settlements || []);
          const baselineBooks = lastSyncedBooksRef.current;
          const baselineSettlements = lastSyncedSettlementsRef.current;
          const dataChangedRemotely =
            !baselineBooks ||
            !baselineSettlements ||
            !booksHaveSameSheetData(remoteBooks, baselineBooks) ||
            !settlementsHaveSameSheetData(remoteSettlements, baselineSettlements);

          if (dataChangedRemotely) {
            try {
              const outbox = await getOutboxData();
              const mergeResult = mergeBooksAndSettlements({
                localBooks: updatedBooks,
                remoteBooks,
                localSettlements: currentAdjustments ?? settlementAdjustmentsRef.current ?? settlementAdjustments ?? [],
                remoteSettlements,
                deletedBookIds: outbox.deletedBookIds,
                pendingMutations: outbox.pendingMutations,
              });

              const pushSuccess = await updateRealGoogleDriveFile(
                token,
                fileId,
                mergeResult.mergedBooks,
                mergeResult.mergedSettlements
              );

              if (pushSuccess) {
                lastLocalPushTimeRef.current = Date.now();
                setBooks(mergeResult.mergedBooks);
                if (setSettlementAdjustments) {
                  setSettlementAdjustments(mergeResult.mergedSettlements);
                }
                applyMasterSettlements(mergeResult.mergedSettlements);
                saveSavingsBooksToFile(mergeResult.mergedBooks).catch(() => {});
                saveSettlementsToFile(mergeResult.mergedSettlements).catch(() => {});
                await acknowledgeSyncedMutations(outbox.pendingMutations.map((m) => m.id));
                await acknowledgeDeletedBooks(outbox.deletedBookIds);

                lastSyncedBooksRef.current = mergeResult.mergedBooks;
                lastSyncedSettlementsRef.current = mergeResult.mergedSettlements;
                const updatedMeta = await getRealGoogleDriveFileMetadata(token, fileId);
                if (updatedMeta?.modifiedTime) {
                  lastCheckedModifiedTimeRef.current = updatedMeta.modifiedTime;
                }
                persistSyncBaseline({
                  fileId,
                  modifiedTime: updatedMeta?.modifiedTime || null,
                  books: mergeResult.mergedBooks,
                  settlements: mergeResult.mergedSettlements,
                });

                hasUnresolvedSyncConflictRef.current = false;
                setSyncConflict(null);
                try {
                  localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
                } catch {}

                const nowStr = new Date().toLocaleString('vi-VN');
                setSettings((prev) => ({ ...prev, lastSyncTime: nowStr }));
                setSyncDriveStatus(`✅ Đã đồng bộ & lưu lên Google Sheets (${nowStr})`);
                setTimeout(() => setSyncDriveStatus(null), 4000);
                setIsSyncingDrive(false);
                isPushingRef.current = false;
                return;
              }
            } catch (mergeErr) {
              console.warn('[Auto-Push] Hợp nhất tự động khi push thất bại, mở hộp thoại xung đột:', mergeErr);
            }

            const conflict: SyncConflictState = {
              fileId,
              fileName: remoteMeta.name || settingsRef.current?.googleSheetName || 'Google Sheets',
              remoteModifiedTime: remoteMeta.modifiedTime || '',
              localBooks: updatedBooks,
              localSettlements: currentAdjustments ?? settlementAdjustmentsRef.current ?? settlementAdjustments ?? [],
              remoteBooks,
              remoteSettlements,
            };
            hasUnresolvedSyncConflictRef.current = true;
            needsPushRef.current = false;
            pendingBooksRef.current = null;
            pendingAdjsRef.current = null;
            setSyncConflict(conflict);
            try {
              localStorage.setItem(SYNC_CONFLICT_STORAGE_KEY, JSON.stringify(conflict));
            } catch (err) {
              console.error('[Drive Sync] Failed to persist conflict snapshots.', err);
            }
            setSyncDriveStatus('⚠️ Xung đột đồng bộ: dữ liệu trên Drive và thiết bị đều đã thay đổi. Hãy chọn bản cần giữ.');
            return;
          }

          lastCheckedModifiedTimeRef.current = remoteMeta.modifiedTime || null;
          lastSyncedBooksRef.current = remoteBooks;
          lastSyncedSettlementsRef.current = remoteSettlements;
          persistSyncBaseline({
            fileId,
            modifiedTime: remoteMeta.modifiedTime || null,
            books: remoteBooks,
            settlements: remoteSettlements,
          });
        }

        const adjs = currentAdjustments ?? settlementAdjustmentsRef.current ?? settlementAdjustments ?? [];
        const success = await updateRealGoogleDriveFile(token, fileId, updatedBooks, adjs);
        if (success) {
          lastLocalPushTimeRef.current = Date.now();
          lastSyncedBooksRef.current = sortAndReindexBooks(
            updatedBooks.filter((book) => book.status !== 'settled').map((book) => ({
              ...book,
              status: 'active' as BookStatus,
            }))
          );
          lastSyncedSettlementsRef.current = deduplicateSettlementAdjustments(adjs);
          const nowStr = new Date().toLocaleString('vi-VN');
          setSettings((prev) => ({ ...prev, lastSyncTime: nowStr }));
          try {
            const updatedMeta = await getRealGoogleDriveFileMetadata(token, fileId);
            if (updatedMeta?.modifiedTime) {
              lastCheckedModifiedTimeRef.current = updatedMeta.modifiedTime;
            }
          } catch {
            // ignore
          }

          // Cập nhật Master State trực tiếp vào Tab __CONFIG__ của Sheet (dùng settingsRef.current để luôn bảo toàn members mới nhất)
          if (token) {
            const currentMembers = settingsRef.current?.members || settings.members || [];
            const effectiveAdmin = settingsRef.current?.workspaceOwnerEmail || settings.workspaceOwnerEmail || currentUser?.email;
            await saveMasterSyncStateOnDrive(token, {
              status: 'active',
              lastAction: 'link',
              activeFileId: fileId,
              activeFileName: settingsRef.current?.googleSheetName || settings.googleSheetName || 'Sổ tiết kiệm',
              activeFileUrl: settingsRef.current?.googleSheetUrl || settings.googleSheetUrl,
              linkedTimestamp: settingsRef.current?.lastLocalLinkTimestamp || settings.lastLocalLinkTimestamp || new Date().toISOString(),
              linkedAccountEmail: currentUser?.email,
              adminEmail: effectiveAdmin,
              members: currentMembers,
              settlements: adjs,
              updatedAt: new Date().toISOString(),
            }).catch((err) => {
              console.error('[Drive Sync] Failed to save workspace state after writing sheet data.', err);
            });
          }
          const finalMeta = await getRealGoogleDriveFileMetadata(token, fileId);
          if (finalMeta?.modifiedTime) lastCheckedModifiedTimeRef.current = finalMeta.modifiedTime;
          persistSyncBaseline({
            fileId,
            modifiedTime: finalMeta?.modifiedTime || lastCheckedModifiedTimeRef.current,
            books: lastSyncedBooksRef.current || [],
            settlements: lastSyncedSettlementsRef.current || [],
          });

          const userEmail = currentUser?.email || 'unknown';
          const role = resolveUserRole(userEmail, settingsRef.current?.currentRole, settingsRef.current?.members, settingsRef.current?.workspaceOwnerEmail);

          recordSyncAuditLog({
            type: 'SYNC_PUSH',
            title: 'Cập nhật lên Drive',
            status: 'success',
            fileId,
            userEmail,
            currentRole: role,
            sheetName: settingsRef.current?.googleSheetName || 'Google Sheets',
            summary: `Lưu ${updatedBooks.length} sổ tiết kiệm, ${adjs.length} tất toán lên Google Drive.`,
            details: {
              activeBooksCount: updatedBooks.length,
              totalPrincipalMillion: updatedBooks.reduce((s, b) => s + b.principal, 0) ? Math.round(updatedBooks.reduce((s, b) => s + b.principal, 0) / 1_000_000) : 0,
              columns_A_to_M_books: updatedBooks.map((b, idx) => ({
                col_A_bank: b.bankId.toUpperCase(),
                col_B_owner: b.owner,
                col_C_type: b.depositType || 'counter',
                col_D_rate: `${b.interestRate}%`,
                col_E_principalMil: b.principal / 1_000_000,
                col_F_startDate: b.startDate,
                col_G_maturityDate: b.maturityDate,
                col_H_termMonths: b.termMonths,
                col_J_termInterestMil: ((b as any).estimatedInterest || b.expectedTermInterest || 0) / 1_000_000,
                col_K_annualInterestMil: (b.annualInterestEquivalent || 0) / 1_000_000,
                col_L_maturityMonth: b.maturityMonthYear,
                col_M_code: b.bookCode || `SO-${idx + 1}`,
              })),
              columns_U_to_AC_settlements: adjs.map((s) => ({
                col_U_id: s.id,
                col_V_date: s.settlementDate,
                col_W_type: s.settlementType,
                col_X_code: s.bookCode,
                col_Y_bank: s.bankId,
                col_Z_owner: s.owner,
                col_AA_principalMil: s.principal / 1_000_000,
                col_AB_actualInterestMil: s.actualInterestVND / 1_000_000,
                col_AC_note: s.note,
              })),
            },
          });

          setSyncDriveStatus('Đã đồng bộ 2 chiều thành công lên Google Drive');
        }
      } catch (err: any) {
        recordSyncAuditLog({
          type: 'SYNC_ERROR',
          title: 'Lỗi đồng bộ lên Google Drive',
          status: 'error',
          userEmail: currentUser?.email,
          currentRole: settingsRef.current?.currentRole,
          sheetName: settingsRef.current?.googleSheetName,
          summary: `Lỗi ghi file Google Drive: ${err?.message || err}`,
          errorMessage: err?.stack || err?.message,
          details: { fileId, booksCount: updatedBooks.length },
        });
        if (
          err?.message?.includes('FILE_NOT_FOUND') ||
          err?.message?.includes('xóa') ||
          err?.message?.includes('thùng rác') ||
          err?.message?.includes('404')
        ) {
          console.warn('Google Drive file push failed - file not accessible:', err?.message);
          setSyncDriveStatus('⚠️ Không thể ghi vào file Google Drive. Vui lòng kiểm tra quyền chỉnh sửa của tài khoản.');
        } else if (
          err?.message?.toLowerCase().includes('permission') ||
          err?.message?.includes('403')
        ) {
          console.warn('Google Drive file push failed - permission denied:', err?.message);
          setSyncDriveStatus('⚠️ Bạn không có quyền chỉnh sửa file này. Vui lòng chọn lại file trong Google Picker để cấp quyền ghi.');
        } else if (
          err?.message?.includes('hết hạn') ||
          err?.message?.includes('invalid authentication credentials')
        ) {
          console.warn('Push to Drive notice:', err?.message);
          setSyncDriveStatus('Phiên đăng nhập Google hết hạn. Vui lòng bấm đăng nhập lại.');
        } else {
          console.error('Push to Drive error:', err);
          setSyncDriveStatus(`❌ Lỗi đồng bộ lên Drive: ${err.message}`);
        }
      } finally {
        isPushingRef.current = false;
        setIsSyncingDrive(false);
        if (!hasUnresolvedSyncConflictRef.current) {
          setTimeout(() => setSyncDriveStatus(null), 4000);
        }

        // Kích hoạt đẩy dữ liệu xếp hàng đợi nếu có thay đổi mới nhất trong lúc đang push
        if (!hasUnresolvedSyncConflictRef.current && needsPushRef.current && pendingBooksRef.current) {
          const nextB = pendingBooksRef.current;
          const nextA = pendingAdjsRef.current || settlementAdjustments;
          needsPushRef.current = false;
          pendingBooksRef.current = null;
          pendingAdjsRef.current = null;
          setTimeout(() => {
            pushBooksToDrive(nextB, nextA);
          }, 400);
        }
      }
    },
    [currentUser, settings.googleSheetUrl, settings.googleSheetName, setSettings, settlementAdjustments, setShowFileDeletedRecovery, syncConflict]
  );

  // Auto-sync whenever Google Sheet link is present or user logs in with a valid token
  useEffect(() => {
    if (currentUser?.isOffline) return;
    if (isSwitchingFileRef.current) return;
    if (!settings.googleSheetUrl) {
      lastSyncedUrlRef.current = null;
      return;
    }
    const token = getGoogleAccessToken();
    if (token) {
      if (settings.googleSheetUrl !== lastSyncedUrlRef.current) {
        console.info(`[Central Hub Sync] URL changed to ${settings.googleSheetUrl}. Syncing...`);
        syncBooksFromDrive(false, token);
      }
    }
  }, [settings.googleSheetUrl, currentUser, syncBooksFromDrive]);

  // Tự động nhận diện và kết nối file trung tâm khi login hoặc mở app trên thiết bị mới
  useEffect(() => {
    const performAutoConnect = async () => {
      if (!currentUser || currentUser.isOffline || isSwitchingFileRef.current || isAutoConnectingRef.current) return;
      isAutoConnectingRef.current = true;
      const token = getGoogleAccessToken();
      if (!token) {
        isAutoConnectingRef.current = false;
        return;
      }

      // SECURITY CHECK: Ensure the token belongs to the current user
      try {
        const savedProfileStr = localStorage.getItem('google_drive_user_profile_v4');
        if (savedProfileStr && currentUser?.email) {
          const profile = JSON.parse(savedProfileStr);
          if (profile.email && profile.email.toLowerCase() !== currentUser.email.toLowerCase()) {
            console.warn('[Central Hub Sync] Token profile email mismatch. Potential cross-user leak detected. Aborting auto-connect.');
            isAutoConnectingRef.current = false;
            return;
          }
        }
      } catch (e) {
        console.warn('[Central Hub Sync] Error checking token email match:', e);
      }

      try {
        console.info('[Central Hub Sync] Đang tự động quét tìm file trung tâm trên Google Drive...');

        // 1. Trường hợp máy chưa có file liên kết cục bộ (hoặc máy 2 vừa mở app sau khi máy 1 tạo/liên kết lại)
        if (!settingsRef.current.googleSheetUrl) {
          const hub = await autoDiscoverLatestCentralHub(token, currentUser?.email);
          if (hub && hub.id) {
            const masterState = await getMasterSyncStateFromDrive(token, hub.id);
            if (masterState && masterState.status === 'active' && masterState.lastAction !== 'unlink') {
              
              applyMasterStateToSettings(masterState, currentUser?.email, setSettings, settingsRef.current, token);
              const link = hub.webViewLink || masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${hub.id}/edit`;
              const fileName = hub.name || masterState.activeFileName || 'Sổ tiết kiệm';
              console.info(`[Central Hub Sync] Phát hiện file trung tâm "${fileName}". Tự động kết nối và nạp dữ liệu ngay lập tức...`);
              setSyncDriveStatus(`Đang tự động đồng bộ file trung tâm "${fileName}"...`);
              setExplicitlyUnlinked(false);

              try {
                sessionStorage.removeItem('explicitly_unlinked');
              } catch {}

              // Tải dữ liệu từ file trung tâm
              try {
                const res = await downloadRealGoogleDriveFile(token, hub.id, hub.mimeType);
                if (res.success) {
                  applyMasterSettlements(res.settlements || []);
                  if (res.books && res.books.length > 0) {
                    const activeRemote = res.books.map((b) => ({ ...b, status: 'active' as BookStatus }));
                    const mergedBooks = sortAndReindexBooks(activeRemote);
                    setBooks(mergedBooks);
                    localStorage.setItem('savings_books_v3', JSON.stringify(mergedBooks));
                  }
                  const nowStr = new Date().toLocaleString('vi-VN');
                  setSettings((prev) => ({
                    ...prev,
                    googleSheetUrl: link,
                    googleSheetName: fileName,
                    lastSyncTime: nowStr,
                    lastLocalLinkTimestamp: masterState.linkedTimestamp || new Date().toISOString(),
                    autoSync: true,
                  }));
                  initAuditLogForLinkedFile(hub.id, fileName, currentUser?.email, token);
                  setSyncDriveStatus(`⚡ Đã tự động kết nối & đồng bộ file trung tâm "${fileName}"`);
                }
              } catch (dlErr: any) {
                console.warn('Lỗi tải dữ liệu cho file tự động phát hiện:', dlErr);
              }
            }
          }
          isAutoConnectingRef.current = false;
          return;
        }

        // 2. Trường hợp máy đã có file liên kết cục bộ: kiểm tra xem file master trên Drive có bị unlinked không
        const currentUrl = settingsRef.current.googleSheetUrl;
        const match = currentUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || currentUrl?.match(/id=([a-zA-Z0-9-_]+)/);
        const currentFileId = match ? match[1] : undefined;
        const masterState = await getMasterSyncStateFromDrive(token, currentFileId);

        if (!masterState || !masterState.activeFileId || isActuallyUnlinked(masterState, settingsRef.current?.lastLocalLinkTimestamp)) {
          console.info('[Central Hub Sync] File master đã ở trạng thái unlinked trên Drive -> Hủy liên kết cục bộ.');
          setExplicitlyUnlinked(true);
          setBooks([]);
          if (setSettlementAdjustments) setSettlementAdjustments([]);
          setSettings((prev) => ({
            ...prev,
            googleSheetUrl: undefined,
            googleSheetName: undefined,
            members: [],
            lastSyncTime: undefined,
          }));
          isAutoConnectingRef.current = false;
          return;
        }

        // Master state tồn tại và active
        applyMasterStateToSettings(masterState, currentUser?.email, setSettings, settingsRef.current, token);
      } catch (err: any) {
        console.warn('Lỗi quét tìm file trung tâm tự động:', err);
        recordSyncAuditLog({
          type: 'SYNC_ERROR',
          title: 'Lỗi quét tìm file trung tâm',
          status: 'error',
          userEmail: currentUser?.email,
          currentRole: settingsRef.current?.currentRole,
          summary: `Lỗi quét file: ${err?.message || err}`,
          errorMessage: err?.stack || err?.message,
        });
      } finally {
        isAutoConnectingRef.current = false;
      }
    };

    performAutoConnect();

    // Lắng nghe khi người dùng quay lại app (sau khi hoàn tất đăng nhập Google trên popup)
    const handleFocus = () => {
      performAutoConnect();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentUser, setSettings, setBooks]);

  // Centralized reactive effect: tự động đẩy thay đổi từ phía App lên Google Drive khi người dùng sửa dữ liệu
  useEffect(() => {
    if (!isInitialSyncDoneRef.current || isSwitchingFileRef.current || isSyncingRef.current) {
      return;
    }

    const currentBooksStr = JSON.stringify(books);
    const currentAdjsStr = JSON.stringify(settlementAdjustments);

    if (Date.now() < remoteSyncCooldownUntilRef.current) {
      previousBooksStringRef.current = currentBooksStr;
      previousAdjsStringRef.current = currentAdjsStr;
      return;
    }

    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      previousBooksStringRef.current = currentBooksStr;
      previousAdjsStringRef.current = currentAdjsStr;
      needsPushRef.current = false;
      pendingBooksRef.current = null;
      pendingAdjsRef.current = null;
      return;
    }

    // Chỉ push khi có sự thay đổi thực sự so với snapshot trước đó
    if (
      currentBooksStr !== previousBooksStringRef.current ||
      currentAdjsStr !== previousAdjsStringRef.current
    ) {
      previousBooksStringRef.current = currentBooksStr;
      previousAdjsStringRef.current = currentAdjsStr;

      // Thành viên vai trò VIEWER (Chỉ xem) không được đẩy dữ liệu lên Drive
      if (!canPushToDrive(settings.currentRole)) {
        return;
      }

      if (isPushingRef.current || isSyncingRef.current || Date.now() < fileSwitchCooldownUntilRef.current) {
        // Đang bận hoặc đang trong cooldown -> Đánh dấu cần push sau khi rảnh
        needsPushRef.current = true;
        pendingBooksRef.current = books;
        pendingAdjsRef.current = settlementAdjustments;
        console.info('[Drive Sync] Phát hiện thay đổi cục bộ trong khi bận, đã xếp hàng đợi cập nhật lên Drive.');
      } else {
        // Rảnh -> Đẩy ngay lập tức
        pushBooksToDrive(books, settlementAdjustments);
      }
    }
  }, [books, settlementAdjustments, pushBooksToDrive, settings.currentRole]);

  const syncBooksFromDriveRef = useRef(syncBooksFromDrive);
  syncBooksFromDriveRef.current = syncBooksFromDrive;

  const checkRemoteSheetChanges = useCallback(
    async (isInitial = false) => {
      if (!isTabVisibleRef.current) return; // Skip polling when tab is hidden
      lastCheckedModifiedTimeTimestampRef.current = Date.now();

      if (currentUser?.isOffline || !settings.googleSheetUrl) return;
      if (hasUnresolvedSyncConflictRef.current) return;
      if (
        isSwitchingFileRef.current ||
        isSyncingRef.current ||
        isPushingRef.current ||
        isCheckingRemoteRef.current
      ) {
        return;
      }
      if (Date.now() < fileSwitchCooldownUntilRef.current) {
        return;
      }
      // Khắc phục triệt để vòng lặp tự kích hoạt: Nếu vừa tự đẩy lên Drive trong 8 giây qua, bỏ qua không kéo lại
      if (Date.now() - lastLocalPushTimeRef.current < 8000) {
        return;
      }

      let token = getGoogleAccessToken();
      let isValid = isGoogleTokenValid();
      if (!token || !isValid) {
        const silentToken = await trySilentRefresh();
        if (silentToken) {
          token = silentToken;
          isValid = true;
        } else {
          if (token && !isValid) {
            setGoogleAccessToken(null);
            setIsDriveTokenExpired(true);
            setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
          }
          return;
        }
      }

      const match =
        settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) ||
        settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/);
      const fileId = match
        ? match[1]
        : settings.googleSheetUrl.length > 20 && !settings.googleSheetUrl.includes('/')
        ? settings.googleSheetUrl
        : null;
      if (!fileId) return;

      try {
        isCheckingRemoteRef.current = true;

        // Check if another device changed the active central hub file on Drive
        try {
          const timeSinceUrlChange = Date.now() - lastUrlChangeTimeRef.current;
          if (timeSinceUrlChange < 10000) {
            // Vừa đổi link cục bộ, chờ Drive index
          } else {
            // Ensure master state file exists on Drive for current link if not yet created
            try {
              const currentMaster = token ? await getMasterSyncStateFromDrive(token, fileId) : null;
              if (currentMaster) {
                applyMasterStateToSettings(currentMaster, currentUser?.email, setSettings, settingsRef.current, token);
                if (isActuallyUnlinked(currentMaster, settingsRef.current?.lastLocalLinkTimestamp)) {
                  console.info('[Central Hub Sync] Phát hiện thiết bị khác đã hủy liên kết file trung tâm. Tự động ngắt kết nối và dọn dẹp dữ liệu...');
                  
                  // Thực hiện hủy liên kết và làm sạch toàn bộ dữ liệu cục bộ
                  setExplicitlyUnlinked(true);
                  setBooks([]);
                  if (setSettlementAdjustments) setSettlementAdjustments([]);
                  try {
                    localStorage.setItem('savings_books_v3', JSON.stringify([]));
                    localStorage.setItem('savings_settlements_v3', JSON.stringify([]));
                    localStorage.setItem('savings_books_cleared', 'true');
                    clearStaticHistoryFromStorage();
                  } catch {}

                  setSettings((prev) => ({
                    ...prev,
                    googleSheetUrl: '',
                    googleSheetName: '',
                    members: [],
                    lastSyncTime: undefined,
                    lastLocalLinkTimestamp: currentMaster.updatedAt || currentMaster.linkedTimestamp,
                  }));
                  setSyncDriveStatus('⚡ Thiết bị khác đã hủy liên kết. Đã dọn sạch dữ liệu để đảm bảo an toàn.');
                  return;
                }
              } else {
                // Không tìm thấy file master JSON (so_tiet_kiem_backup.json) trên Drive.
                // Tuyệt đối KHÔNG tự ý sinh file JSON mới từ dữ liệu cục bộ.
                // Nếu máy này đang lưu link cũ nhưng trên Drive chưa có liên kết -> đặt app về trạng thái chưa liên kết.
                console.info('[Central Hub Sync] Không có file master JSON trên Drive. Đặt app về trạng thái chưa liên kết.');
                if (settings.googleSheetUrl) {
                  setSettings((prev) => ({
                    ...prev,
                    googleSheetUrl: '',
                    googleSheetName: '',
                    lastSyncTime: undefined,
                  }));
                }
              }
            } catch (initErr: any) {
              console.warn('Init master state warning:', initErr);
              if (
                initErr?.message?.includes('hết hạn') ||
                initErr?.message?.includes('401') ||
                initErr?.message?.includes('invalid authentication credentials') ||
                initErr?.message?.includes('credentials')
              ) {
                setGoogleAccessToken(null);
                setIsDriveTokenExpired(true);
                setSyncDriveStatus('⚠️ Phiên kết nối Google Drive đã hết hạn.');
                return;
              }
            }

            const latestHub = await autoDiscoverLatestCentralHub(token, currentUser?.email);
            if (latestHub && latestHub.id !== fileId) {
              const remoteTime = latestHub.linkedTimestamp || '';
              const localTime = settings.lastLocalLinkTimestamp || '';

              const remoteMs = remoteTime ? new Date(remoteTime).getTime() : 0;
              const localMs = localTime ? new Date(localTime).getTime() : 0;

              if (remoteMs > 0 && localMs > 0 && remoteMs <= localMs) {
                setDetectedDesyncHub(null);
                return;
              }

              // Thiết bị khác (ví dụ Tablet) đã đổi sang file trung tâm mới hơn! Tự động chuyển đổi và nạp file mới
              console.info(`[Central Hub Sync] Phát hiện thiết bị khác đã chuyển sang file "${latestHub.name}" (Timestamp: ${remoteTime}). Tự động đồng bộ theo file mới...`);
              const newLink = latestHub.webViewLink || `https://docs.google.com/spreadsheets/d/${latestHub.id}/edit`;
              
              isSwitchingFileRef.current = true;
              fileSwitchCooldownUntilRef.current = Date.now() + 8000;

              try {
                const res = await downloadRealGoogleDriveFile(token, latestHub.id, latestHub.mimeType);
                if (res.success) {
                  applyMasterSettlements(res.settlements || []);
                  if (res.books && res.books.length > 0) {
                    const activeRemote = res.books.map((b) => ({ ...b, status: 'active' as BookStatus }));
                    const mergedBooks = sortAndReindexBooks(activeRemote);
                    setBooks(mergedBooks);
                    localStorage.setItem('savings_books_v3', JSON.stringify(mergedBooks));
                  }
                }
              } catch (dErr) {
                console.warn('Lỗi tải file trung tâm mới:', dErr);
              } finally {
                setTimeout(() => {
                  isSwitchingFileRef.current = false;
                }, 3500);
              }

              const nowStr = new Date().toLocaleString('vi-VN');
              setSettings((prev) => ({
                ...prev,
                googleSheetUrl: newLink,
                googleSheetName: latestHub.name,
                lastSyncTime: nowStr,
                lastLocalLinkTimestamp: remoteTime,
                autoSync: true,
              }));
              setSyncDriveStatus(`⚡ Đã tự động chuyển và đồng bộ sang file trung tâm mới "${latestHub.name}"`);
              setDetectedDesyncHub(null);
              return;
            } else {
              setDetectedDesyncHub(null);
            }
          }
        } catch (hubErr: any) {
          console.warn('Central hub check warning:', hubErr);
          if (
            hubErr?.message?.includes('hết hạn') ||
            hubErr?.message?.includes('401') ||
            hubErr?.message?.includes('invalid authentication credentials') ||
            hubErr?.message?.includes('credentials')
          ) {
            console.warn('[Central Hub Sync] Token expired inside autoDiscover check. Clearing token.');
            setGoogleAccessToken(null);
            setIsDriveTokenExpired(true);
            setSyncDriveStatus('⚠️ Phiên kết nối Google Drive đã hết hạn.');
            return;
          }
        }

        const meta = await getRealGoogleDriveFileMetadata(token, fileId);
        if (meta?.isDeleted) {
          console.warn('Google Drive file is marked deleted on Drive:', fileId);
          setSyncDriveStatus('⚠️ File liên kết đang ở trong thùng rác hoặc không khả dụng.');
          return;
        }

        if (meta?.modifiedTime) {
          // Nếu vừa thực hiện đẩy dữ liệu lên Drive trong vòng 8 giây, cập nhật timestamp và bỏ qua kéo về để tránh ghi đè dữ liệu vừa sửa
          if (Date.now() - lastLocalPushTimeRef.current < 8000) {
            lastCheckedModifiedTimeRef.current = meta.modifiedTime;
            return;
          }

          if (!lastCheckedModifiedTimeRef.current) {
            lastCheckedModifiedTimeRef.current = meta.modifiedTime;
            // Chỉ kéo về nếu lần đầu tiên ứng dụng khởi động và chưa nạp dữ liệu
            if (isInitial && !isInitialSyncDoneRef.current) {
              await syncBooksFromDriveRef.current(false, token);
            }
          } else if (meta.modifiedTime !== lastCheckedModifiedTimeRef.current) {
            // File trên Google Drive đã được sửa đổi bên ngoài!
            lastCheckedModifiedTimeRef.current = meta.modifiedTime;
            await syncBooksFromDriveRef.current(false, token);
            setSyncDriveStatus('Đã cập nhật dữ liệu mới từ Google Drive');
            setTimeout(() => setSyncDriveStatus(null), 3500);
          }
        }
      } catch (err: any) {
        if (
          err?.message?.includes('hết hạn') ||
          err?.message?.includes('401') ||
          err?.message?.includes('invalid authentication credentials') ||
          err?.message?.includes('credentials')
        ) {
          console.warn('[Central Hub Sync] Token expired/invalid inside checkRemoteSheetChanges outer catch. Clearing token.');
          setGoogleAccessToken(null);
          setIsDriveTokenExpired(true);
          setSyncDriveStatus('⚠️ Phiên kết nối Google Drive đã hết hạn.');
          return;
        }

        if (
          err?.message?.includes('FILE_NOT_FOUND') ||
          err?.message?.includes('xóa') ||
          err?.message?.includes('thùng rác') ||
          err?.message?.includes('404')
        ) {
          console.warn('checkRemoteSheetChanges: file not found or inaccessible for this account:', err?.message);
          recordSyncAuditLog({
            type: 'SYNC_ERROR',
            title: 'File Google Drive không tìm thấy hoặc đã bị xóa',
            status: 'error',
            userEmail: currentUser?.email,
            currentRole: settingsRef.current?.currentRole,
            summary: `File không truy cập được: ${err?.message || err}`,
            errorMessage: err?.stack || err?.message,
            details: { fileId },
          });
        }
      } finally {
        isCheckingRemoteRef.current = false;
      }
    },
    [currentUser, settings.googleSheetUrl, settings.lastLocalLinkTimestamp, setSettings, setShowFileDeletedRecovery]
  );

  const expiredNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerExpiredNoticeWithDelay = useCallback((delayMs = 2500) => {
    if (expiredNoticeTimerRef.current) {
      clearTimeout(expiredNoticeTimerRef.current);
    }
    expiredNoticeTimerRef.current = setTimeout(() => {
      setIsDriveTokenExpired(true);
    }, delayMs);
  }, []);

  const clearExpiredNoticeTimer = useCallback(() => {
    if (expiredNoticeTimerRef.current) {
      clearTimeout(expiredNoticeTimerRef.current);
      expiredNoticeTimerRef.current = null;
    }
    setIsDriveTokenExpired(false);
  }, []);

  // Kiểm tra tính hợp lệ của Token Google Drive định kỳ & tự động kiểm tra liên kết file trung tâm
  const checkDriveTokenValidity = useCallback(async (isPassiveBackground = false) => {
    if (!isTabVisibleRef.current) return; // Skip checking token when tab is hidden
    if (!currentUser || currentUser.isOffline) {
      setIsDriveTokenExpired(false);
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    let token = getGoogleAccessToken();
    let isValid = isGoogleTokenValid();

    if (!token || !isValid) {
      try {
        const freshToken = await trySilentRefresh();
        if (freshToken) {
          token = freshToken;
          isValid = true;
        }
      } catch {
        // ignore
      }
    }

    if (!token || !isValid) {
      if (!isPassiveBackground) {
        const dismissedPrompt = sessionStorage.getItem('dismissed_drive_prompt') === 'true';
        const explicitlyUnlinked = isExplicitlyUnlinked();
        if (!dismissedPrompt && !explicitlyUnlinked) {
          setIsDriveTokenExpired(true);
        }
        setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
      }
      return;
    }

    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.status === 401) {
        console.warn('[Google Drive Auth] Token Drive không hợp lệ hoặc đã hết hạn (401). Thử gia hạn ngầm...');
        const freshToken = await trySilentRefresh();
        if (freshToken) {
          token = freshToken;
          setIsDriveTokenExpired(false);
        } else {
          setGoogleAccessToken(null);
          if (!isPassiveBackground) {
            const dismissedPrompt = sessionStorage.getItem('dismissed_drive_prompt') === 'true';
            const explicitlyUnlinked = isExplicitlyUnlinked();
            if (!dismissedPrompt && !explicitlyUnlinked) {
              setIsDriveTokenExpired(true);
            }
            setSyncDriveStatus('⚠️ Cần xác thực lại tài khoản Google Drive.');
          }
        }
      } else if (res.status === 403) {
        console.warn('[Google Drive Auth] Google Drive API bị giới hạn truy cập hoặc hết hạn mức (403). Giữ nguyên Token.');
      } else if (res.ok) {
        clearExpiredNoticeTimer();
        setIsDriveTokenExpired(false);

        // Tự động kiểm tra và đồng bộ trạng thái master cùng danh sách thành viên
        if (currentUser.email) {
          try {
            if (!settingsRef.current.googleSheetUrl) {
              const hub = await autoDiscoverLatestCentralHub(token, currentUser.email);
              if (hub && hub.id) {
                const sheetUrl = hub.webViewLink || `https://docs.google.com/spreadsheets/d/${hub.id}/edit`;
                setSettings((prev) => ({
                  ...prev,
                  googleSheetUrl: sheetUrl,
                  googleSheetName: hub.name || 'Bảng tính tiết kiệm',
                }));
                initAuditLogForLinkedFile(hub.id, hub.name || 'Bảng tính tiết kiệm', currentUser.email, token);
                setExplicitlyUnlinked(false);
                console.info('[Central Hub Sync] Tự động liên kết và nạp dữ liệu từ master workspace...');
                await syncBooksFromDriveRef.current(false, token);
              }
            } else {
              const currentUrl = settingsRef.current.googleSheetUrl;
              const match = currentUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || currentUrl?.match(/id=([a-zA-Z0-9-_]+)/);
              const currentFileId = match ? match[1] : undefined;
              const masterState = token ? await getMasterSyncStateFromDrive(token, currentFileId) : null;
              if (masterState && masterState.status === 'active' && masterState.activeFileId) {
                applyMasterStateToSettings(masterState, currentUser.email, setSettings, settingsRef.current, token);
              } else if (masterState && isActuallyUnlinked(masterState, settingsRef.current?.lastLocalLinkTimestamp)) {
                setExplicitlyUnlinked(true);
                setBooks([]);
                if (setSettlementAdjustments) setSettlementAdjustments([]);
                setSettings((prev) => ({
                  ...prev,
                  googleSheetUrl: undefined,
                  googleSheetName: undefined,
                  members: [],
                  lastSyncTime: undefined,
                }));
                clearSyncAuditLogs();
              }
            }
          } catch (hubErr) {
            console.warn('Auto discover hub on token check warning:', hubErr);
          }
        }
      }
    } catch (err) {
      // Lỗi mạng tạm thời, giữ nguyên không làm phiền người dùng
    }
  }, [currentUser, setSettings, clearExpiredNoticeTimer]);

  // SMART SYNC: Lắng nghe sự kiện mở app/máy (Cold start, Focus, Visibility, Android Resume) & Polling nền 5 phút
  useEffect(() => {
    if (!currentUser || currentUser.isOffline) return;

    // 1. Khởi động ứng dụng (Cold start): Kiểm tra âm thầm trong nền và kéo dữ liệu mới nhất tức thì
    checkDriveTokenValidity(true);
    checkRemoteSheetChanges(true);

    let lastCheckTime = Date.now();

    // 2. Mở máy / Mở lại app / Chuyển tab: Kiểm tra tức thì để đảm bảo luôn có số liệu mới nhất
    const handleFocusOrVisible = () => {
      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      isTabVisibleRef.current = isVisible;

      if (isVisible) {
        const now = Date.now();
        const timeHidden = now - lastCheckedModifiedTimeTimestampRef.current;
        lastCheckedModifiedTimeTimestampRef.current = now;

        // Nếu app vừa quay trở lại sau thời gian ẩn (> 3 phút): Ép kéo dữ liệu mới nhất
        if (timeHidden > 3 * 60 * 1000 && isInitialSyncDoneRef.current) {
          console.info('[Smart Sync] Mở lại app sau khi ẩn (>3 phút). Kích hoạt kiểm tra và nạp dữ liệu mới nhất...');
          checkRemoteSheetChanges(false);
        } else if (now - lastCheckTime > 5000) { // Cooldown 5s tránh trùng lặp giữa focus và visibilitychange
          lastCheckTime = now;
          checkRemoteSheetChanges(false);
        }
      }
    };

    const handleOnline = () => {
      console.info('[Smart Sync] Thiết bị đã có mạng trở lại (Online). Kích hoạt kiểm tra và đồng bộ ngầm...');
      checkDriveTokenValidity(true);
      checkRemoteSheetChanges(false);
    };

    window.addEventListener('focus', handleFocusOrVisible);
    window.addEventListener('pageshow', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);
    document.addEventListener('resume', handleFocusOrVisible); // Hỗ trợ Capacitor / Android Native App Resume!
    window.addEventListener('online', handleOnline);

    // 3. Chu kỳ polling ngầm thông minh: 5 phút/lần (300,000ms), tự động dừng hoàn toàn khi màn hình tắt/app ẩn
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const now = Date.now();
        lastCheckTime = now;
        lastCheckedModifiedTimeTimestampRef.current = now;
        checkDriveTokenValidity(true); // Kiểm tra âm thầm trong nền, không hiện popup phiền toái
        checkRemoteSheetChanges(false);
      }
    }, 5 * 60 * 1000); // 5 phút: Giảm 85% truy vấn Google API, triệt tiêu lỗi Quota 403 và tiết kiệm pin tối đa

    return () => {
      window.removeEventListener('focus', handleFocusOrVisible);
      window.removeEventListener('pageshow', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
      document.removeEventListener('resume', handleFocusOrVisible);
      window.removeEventListener('online', handleOnline);
      clearInterval(intervalId);
    };
  }, [checkDriveTokenValidity, checkRemoteSheetChanges, currentUser?.email, applyMasterSettlements, setSettings]);

  const renewTokenAndSync = useCallback(async () => {
    try {
      setSyncDriveStatus('🔄 Đang mở xác thực Google Drive...');
      const token = await ensureGoogleAccessToken();
      if (token) {
        clearExpiredNoticeTimer();
        setSyncDriveStatus('🔄 Đang kết nối và cập nhật file trung tâm...');

        // 1. Đọc JSON master pointer xem có đổi file liên kết từ máy khác không
        const hub = await autoDiscoverLatestCentralHub(token, currentUser?.email);
        if (hub && hub.id) {
          const hubUrl = hub.webViewLink || `https://docs.google.com/spreadsheets/d/${hub.id}/edit`;
          if (hubUrl !== settingsRef.current.googleSheetUrl) {
            console.info('[Central Hub Sync] Phát hiện thay đổi file trung tâm sau khi gia hạn token:', hub.name);
            initAuditLogForLinkedFile(hub.id, hub.name, currentUser?.email, token);
            setSettings((prev) => ({
              ...prev,
              googleSheetUrl: hubUrl,
              googleSheetName: hub.name,
              lastLocalLinkTimestamp: hub.linkedTimestamp || new Date().toISOString(),
            }));
          }
        }

        // 2. Tải và đồng bộ dữ liệu ngay lập tức
        await syncBooksFromDriveRef.current(true, token);
        setSyncDriveStatus('✅ Đã gia hạn kết nối Google Drive & đồng bộ dữ liệu mới nhất!');
        setTimeout(() => setSyncDriveStatus(null), 4000);
      }
    } catch (err: any) {
      console.warn('Gia hạn token thất bại:', err);
      const errMsg = err?.message || String(err);
      setSyncDriveStatus(`❌ Gia hạn kết nối Google Drive thất bại: ${errMsg}`);
      recordSyncAuditLog({
        type: 'SYNC_ERROR',
        title: 'Lỗi gia hạn kết nối Google Drive',
        status: 'error',
        userEmail: currentUser?.email,
        currentRole: settingsRef.current?.currentRole,
        sheetName: settingsRef.current?.googleSheetName,
        summary: `Gia hạn kết nối thất bại: ${errMsg}`,
        errorMessage: err?.stack || errMsg,
      });
      throw err;
    }
  }, [currentUser, setSettings, clearExpiredNoticeTimer]);

  const resolveSyncConflict = useCallback(
    async (choice: 'remote' | 'local' | 'merge') => {
      if (isResolvingSyncConflictRef.current || isSyncingRef.current || isPushingRef.current) return;
      isResolvingSyncConflictRef.current = true;
      setIsSyncingDrive(true);
      try {
        const conflict = syncConflict;
        if (!conflict) return;

        try {
          localStorage.setItem(
            'savings_sync_conflict_backup_v1',
            JSON.stringify({
              fileId: conflict.fileId,
              savedAt: new Date().toISOString(),
              books: conflict.localBooks,
              settlements: conflict.localSettlements,
              remoteBooks: conflict.remoteBooks,
              remoteSettlements: conflict.remoteSettlements,
            })
          );
        } catch (err) {
          console.error('[Drive Sync] Could not save a local backup of the conflict snapshot.', err);
          setSyncDriveStatus('❌ Không thể tạo bản sao lưu cục bộ. Xung đột vẫn được giữ nguyên, chưa thay đổi dữ liệu.');
          return;
        }

      let token = getGoogleAccessToken();
      if (!token || !isGoogleTokenValid()) {
        token = await trySilentRefresh();
      }
      if (!token) {
        try {
          token = await ensureGoogleAccessToken();
        } catch (err) {
          setSyncDriveStatus(
            `⚠️ Cần đăng nhập lại Google trước khi giải quyết xung đột: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      }

      if (choice === 'merge') {
        const outbox = await getOutboxData();
        const mergeResult = mergeBooksAndSettlements({
          localBooks: conflict.localBooks,
          remoteBooks: conflict.remoteBooks,
          localSettlements: conflict.localSettlements,
          remoteSettlements: conflict.remoteSettlements,
          deletedBookIds: outbox.deletedBookIds,
          pendingMutations: outbox.pendingMutations,
        });

        const success = await updateRealGoogleDriveFile(
          token,
          conflict.fileId,
          mergeResult.mergedBooks,
          mergeResult.mergedSettlements
        );
        if (!success) {
          setSyncDriveStatus('❌ Không thể lưu bản hợp nhất lên Drive.');
          return;
        }

        setBooks(mergeResult.mergedBooks);
        if (setSettlementAdjustments) {
          setSettlementAdjustments(mergeResult.mergedSettlements);
        }
        applyMasterSettlements(mergeResult.mergedSettlements);
        saveSavingsBooksToFile(mergeResult.mergedBooks).catch(() => {});
        saveSettlementsToFile(mergeResult.mergedSettlements).catch(() => {});
        await acknowledgeSyncedMutations(outbox.pendingMutations.map((m) => m.id));
        await acknowledgeDeletedBooks(outbox.deletedBookIds);

        lastSyncedBooksRef.current = mergeResult.mergedBooks;
        lastSyncedSettlementsRef.current = mergeResult.mergedSettlements;
        const meta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
        lastCheckedModifiedTimeRef.current = meta?.modifiedTime || null;
        persistSyncBaseline({
          fileId: conflict.fileId,
          modifiedTime: meta?.modifiedTime || null,
          books: mergeResult.mergedBooks,
          settlements: mergeResult.mergedSettlements,
        });

        setSyncConflict(null);
        hasUnresolvedSyncConflictRef.current = false;
        try {
          localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
        } catch {}

        setSyncDriveStatus('✅ Đã hợp nhất dữ liệu hai bên thành công lên Google Drive!');
        setTimeout(() => setSyncDriveStatus(null), 5000);
        return;
      }

      if (choice === 'remote') {
        const latestRemote = await downloadRealGoogleDriveFile(token, conflict.fileId);
        if (!latestRemote.success) {
          setSyncDriveStatus(`❌ Không thể xác minh bản Drive mới nhất: ${latestRemote.errors.join(' ')}`);
          return;
        }
        const latestBooks = sortAndReindexBooks(
          (latestRemote.books || []).filter((book) => book.status !== 'settled')
        );
        const latestSettlements = deduplicateSettlementAdjustments(latestRemote.settlements || []);
        if (
          !booksHaveSameSheetData(latestBooks, conflict.remoteBooks) ||
          !settlementsHaveSameSheetData(latestSettlements, conflict.remoteSettlements)
        ) {
          const latestMeta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
          const updatedConflict: SyncConflictState = {
            ...conflict,
            remoteModifiedTime: latestMeta?.modifiedTime || '',
            remoteBooks: latestBooks,
            remoteSettlements: latestSettlements,
          };
          setSyncConflict(updatedConflict);
          try {
            localStorage.setItem(SYNC_CONFLICT_STORAGE_KEY, JSON.stringify(updatedConflict));
          } catch (err) {
            console.error('[Drive Sync] Failed to persist refreshed remote conflict data.', err);
          }
          setSyncDriveStatus('⚠️ Drive vừa thay đổi thêm. Hãy xem lại phiên bản mới trước khi chọn.');
          return;
        }
        const remoteBooks = sortAndReindexBooks(
          latestBooks.filter((book) => book.status !== 'settled')
        );
        const remoteSettlements = latestSettlements;
        try {
          localStorage.setItem('savings_books_v3', JSON.stringify(remoteBooks));
          localStorage.setItem('savings_settlements_v3', JSON.stringify(remoteSettlements));
          if (remoteBooks.length > 0) localStorage.removeItem('savings_books_cleared');
          else localStorage.setItem('savings_books_cleared', 'true');
        } catch (err) {
          console.error('[Drive Sync] Failed to persist the selected Drive version locally.', err);
          setSyncDriveStatus('❌ Không thể lưu bản Google Drive trên thiết bị. Bản sao lưu xung đột vẫn còn.');
          return;
        }

        isRemoteUpdateRef.current = true;
        previousBooksStringRef.current = JSON.stringify(remoteBooks);
        previousAdjsStringRef.current = JSON.stringify(remoteSettlements);
        lastSyncedBooksRef.current = remoteBooks;
        lastSyncedSettlementsRef.current = remoteSettlements;
        setBooks(remoteBooks);
        setSettlementAdjustments?.(remoteSettlements);
        const latestMeta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
        lastCheckedModifiedTimeRef.current = latestMeta?.modifiedTime || null;
        persistSyncBaseline({
          fileId: conflict.fileId,
          modifiedTime: latestMeta?.modifiedTime || null,
          books: remoteBooks,
          settlements: remoteSettlements,
        });
        setSyncConflict(null);
        hasUnresolvedSyncConflictRef.current = false;
        try {
          localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
        } catch (err) {
          console.error('[Drive Sync] Could not remove the resolved conflict marker.', err);
        }
        setSyncDriveStatus('✅ Đã chọn và tải dữ liệu Google Drive. Bản trên thiết bị được sao lưu cục bộ.');
        setTimeout(() => setSyncDriveStatus(null), 5000);
        return;
      }

      let expectedModifiedTime = conflict.remoteModifiedTime;
      let currentMeta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
      if (!currentMeta || currentMeta.isDeleted) {
        setSyncDriveStatus('❌ Không thể xác minh phiên bản Google Drive hiện tại; chưa ghi đè.');
        return;
      }

      if (!currentMeta.modifiedTime || currentMeta.modifiedTime !== expectedModifiedTime) {
        const latestRemote = await downloadRealGoogleDriveFile(token, conflict.fileId);
        if (!latestRemote.success) {
          setSyncDriveStatus(`❌ Không thể kiểm tra thay đổi mới trên Drive: ${latestRemote.errors.join(' ')}`);
          return;
        }
        const latestBooks = sortAndReindexBooks(
          (latestRemote.books || []).filter((book) => book.status !== 'settled').map((book) => ({
            ...book,
            status: 'active' as BookStatus,
          }))
        );
        const latestSettlements = deduplicateSettlementAdjustments(latestRemote.settlements || []);
        if (
          !booksHaveSameSheetData(latestBooks, conflict.remoteBooks) ||
          !settlementsHaveSameSheetData(latestSettlements, conflict.remoteSettlements)
        ) {
          const updatedConflict: SyncConflictState = {
            ...conflict,
            remoteModifiedTime: currentMeta.modifiedTime || '',
            remoteBooks: latestBooks,
            remoteSettlements: latestSettlements,
          };
          setSyncConflict(updatedConflict);
          try {
            localStorage.setItem(SYNC_CONFLICT_STORAGE_KEY, JSON.stringify(updatedConflict));
          } catch (err) {
            console.error('[Drive Sync] Failed to save the refreshed conflict snapshot.', err);
          }
          setSyncDriveStatus('⚠️ Drive vừa thay đổi thêm. Hãy kiểm tra phiên bản mới trước khi chọn lại.');
          return;
        }
        expectedModifiedTime = currentMeta.modifiedTime || '';
      }

      currentMeta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
      if (
        !currentMeta ||
        currentMeta.isDeleted ||
        (expectedModifiedTime && currentMeta.modifiedTime !== expectedModifiedTime)
      ) {
        setSyncDriveStatus('⚠️ Google Drive vừa thay đổi thêm; chưa ghi đè. Hãy rà soát lại phiên bản mới.');
        return;
      }
      if (!expectedModifiedTime) {
        const latestRemote = await downloadRealGoogleDriveFile(token, conflict.fileId);
        const latestBooks = latestRemote.success
          ? sortAndReindexBooks((latestRemote.books || []).filter((book) => book.status !== 'settled'))
          : [];
        if (
          !latestRemote.success ||
          !booksHaveSameSheetData(latestBooks, conflict.remoteBooks) ||
          !settlementsHaveSameSheetData(latestRemote.settlements || [], conflict.remoteSettlements)
        ) {
          setSyncDriveStatus('⚠️ Drive đã thay đổi thêm; chưa ghi đè. Hãy đồng bộ lại để rà soát bản mới.');
          return;
        }
      }

        try {
          const success = await updateRealGoogleDriveFile(
            token,
            conflict.fileId,
            conflict.localBooks,
            conflict.localSettlements
          );
          if (!success) throw new Error('Google Sheets không xác nhận đã lưu dữ liệu.');

          const localBooks = sortAndReindexBooks(
            conflict.localBooks.filter((book) => book.status !== 'settled')
          );
          const localSettlements = deduplicateSettlementAdjustments(conflict.localSettlements);
          lastSyncedBooksRef.current = localBooks;
          lastSyncedSettlementsRef.current = localSettlements;
          previousBooksStringRef.current = JSON.stringify(localBooks);
          previousAdjsStringRef.current = JSON.stringify(localSettlements);
          lastLocalPushTimeRef.current = Date.now();

          const currentSettings = settingsRef.current;
          await saveMasterSyncStateOnDrive(token, {
            status: 'active',
            lastAction: 'link',
            activeFileId: conflict.fileId,
            activeFileName: currentSettings.googleSheetName || conflict.fileName,
            activeFileUrl: currentSettings.googleSheetUrl,
            linkedTimestamp: currentSettings.lastLocalLinkTimestamp || new Date().toISOString(),
            linkedAccountEmail: currentUser?.email,
            adminEmail: currentSettings.workspaceOwnerEmail || currentUser?.email,
            members: currentSettings.members || [],
            settlements: localSettlements,
            updatedAt: new Date().toISOString(),
          });
          currentMeta = await getRealGoogleDriveFileMetadata(token, conflict.fileId);
          if (!currentMeta || currentMeta.isDeleted) {
            throw new Error('Dữ liệu đã được ghi nhưng không thể xác minh trạng thái file trên Drive.');
          }
          lastCheckedModifiedTimeRef.current = currentMeta.modifiedTime || null;
          persistSyncBaseline({
            fileId: conflict.fileId,
            modifiedTime: currentMeta.modifiedTime || null,
            books: localBooks,
            settlements: localSettlements,
          });
          setSettings((prev) => ({ ...prev, lastSyncTime: new Date().toLocaleString('vi-VN') }));
          setSyncConflict(null);
          hasUnresolvedSyncConflictRef.current = false;
          try {
            localStorage.removeItem(SYNC_CONFLICT_STORAGE_KEY);
          } catch (err) {
            console.error('[Drive Sync] Could not remove the resolved conflict marker.', err);
          }
          setSyncDriveStatus('✅ Đã ghi bản trên thiết bị lên Google Drive theo lựa chọn của bạn.');
          setTimeout(() => setSyncDriveStatus(null), 5000);
        } catch (err) {
          console.error('[Drive Sync] Could not resolve the sync conflict by writing the local version.', err);
          setSyncDriveStatus(`❌ Chưa giải quyết được xung đột: ${err instanceof Error ? err.message : String(err)}`);
        }
      } catch (err) {
        console.error('[Drive Sync] Unexpected error while resolving a sync conflict.', err);
        setSyncDriveStatus(`❌ Chưa giải quyết được xung đột: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        isResolvingSyncConflictRef.current = false;
        setIsSyncingDrive(false);
      }
    },
    [currentUser?.email, setBooks, setSettlementAdjustments, setSettings, syncConflict]
  );

  return {
    isSyncingDrive,
    syncDriveStatus,
    setSyncDriveStatus,
    setIsSyncingDrive,
    isDriveTokenExpired,
    setIsDriveTokenExpired,
    renewTokenAndSync,
    syncBooksFromDrive,
    pushBooksToDrive,
    syncConflict,
    resolveSyncConflict,
    detectedDesyncHub,
    setDetectedDesyncHub,
    markAsRemoteUpdate,
    startFileSwitch,
    finishFileSwitch,
    cancelFileSwitch,
  };
}
