import React, { Suspense } from 'react';
import {
  SavingsBook,
  AppSettings,
  AuthUser,
  SettlementAdjustment,
} from '../types';
import { AddEditBookModal } from './AddEditBookModal';
import { BookDetailModal } from './BookDetailModal';
import { AndroidSpecModal } from './AndroidSpecModal';
import { ManageBanksModal } from './ManageBanksModal';
import { LogoutWarningModal } from './LogoutWarningModal';
import { FileDeletedRecoveryModal } from './FileDeletedRecoveryModal';
import { ClearDataConfirmationModal } from './ClearDataConfirmationModal';
import { DriveTokenExpiredModal } from './DriveTokenExpiredModal';
import { UserManagementModal } from './UserManagementModal';
import { BookOpen, X, Loader2 } from 'lucide-react';
import { exportSavingsBooksToExcel } from '../utils/excelParser';
import {
  getDynamicAnnualInterestHistory,
  getDynamicBalanceGrowthHistory,
} from '../data/historicalGrowth';
import {
  getGoogleAccessToken,
  createRealGoogleDriveFile,
  ensureGoogleAccessToken,
  isGoogleTokenValid,
  trySilentRefresh,
  getLocalMasterPointerFileId,
  getMasterSyncStateFromDrive,
  saveMasterSyncStateOnDrive,
  shareFileWithUserEmail,
  removeMemberFromDriveMaster,
  updateMemberRoleOnDrive,
  synchronizeDrivePermissionsWithJsonMembers,
  setExplicitlyUnlinked,
} from '../utils/googleDriveService';
import { WorkspaceMember } from '../types';

// Lazy load modal nặng DataSyncModal (~83KB)
const DataSyncModal = React.lazy(() =>
  import('./DataSyncModal').then((m) => ({ default: m.DataSyncModal }))
);

const ModalLoadingSpinner = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
    <div className="bg-white rounded-2xl shadow-xl p-6 flex flex-col items-center gap-3 border border-slate-200">
      <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
      <span className="text-xs font-semibold text-slate-700">Đang tải bảng đồng bộ...</span>
    </div>
  </div>
);

interface AppModalsProps {
  // Add/Edit Book Modal
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
  bookToEdit: SavingsBook | null;
  onSaveBook: (book: SavingsBook) => void;

  // Sync Modal
  isSyncModalOpen: boolean;
  setIsSyncModalOpen: (open: boolean) => void;
  onLoginOnline: (user: AuthUser, token?: string) => void;
  onDriveFileNotFound: () => void;
  onImportBooks: (newBooks: SavingsBook[], mode: 'replace' | 'append') => void;
  onClearBooks: () => void;
  onTriggerManualSync: () => Promise<void>;
  onMarkAsRemoteUpdate?: (
    newBooks?: SavingsBook[],
    newAdjs?: SettlementAdjustment[],
    newUrl?: string,
    newModifiedTime?: string
  ) => void;

  // Book Detail Modal
  selectedBookForDetail: SavingsBook | null;
  setSelectedBookForDetail: (book: SavingsBook | null) => void;
  onUpdateBook: (book: SavingsBook) => void;
  onSettleBook: (
    bookId: string,
    extra?: { isEarlySettled: boolean; settlementDate: string; actualInterestVND: number }
  ) => void;
  onRolloverBook: (
    oldBookId: string,
    rolloverConfig: {
      newPrincipal: number;
      newInterestRate: number;
      newTermMonths: number;
      newStartDate: string;
      newMaturityDate: string;
    }
  ) => void;

  // Android Spec Modal
  isAndroidSpecModalOpen: boolean;
  setIsAndroidSpecModalOpen: (open: boolean) => void;

  // Manage Banks Modal
  isManageBanksModalOpen: boolean;
  setIsManageBanksModalOpen: (open: boolean) => void;
  onBanksChanged: () => void;

  // Logout Warning Modal
  isLogoutWarningModalOpen: boolean;
  setIsLogoutWarningModalOpen: (open: boolean) => void;
  onConfirmLogoutAnyway: () => void;
  onExportAndLogout: () => void;

  // File Deleted Recovery Modal
  showFileDeletedRecovery: boolean;
  setShowFileDeletedRecovery: (show: boolean) => void;
  onDeleteAppData: () => void;
  onSetSyncDriveStatus: (msg: string | null) => void;
  onSetIsSyncingDrive: (syncing: boolean) => void;

  // File Switching Protocol
  onStartFileSwitch?: () => void;
  onFinishFileSwitch?: (
    newBooks: SavingsBook[],
    newAdjs?: SettlementAdjustment[],
    newUrl?: string,
    newFileName?: string,
    stampTime?: string,
    fileModTime?: string
  ) => void;
  onCancelFileSwitch?: () => void;

  // Clear Data Confirmation Modal
  isClearDataModalOpen: boolean;
  setIsClearDataModalOpen: (open: boolean) => void;
  onClearAllAppData: () => void;

  // Drive Token Expired Modal
  isDriveTokenExpired?: boolean;
  setIsDriveTokenExpired?: (expired: boolean) => void;
  onRenewDriveTokenAndSync?: () => Promise<void>;

  // User Management Modal
  isUserManagementModalOpen?: boolean;
  setIsUserManagementModalOpen?: (open: boolean) => void;
  onLeaveWorkspace?: () => void | Promise<void>;

  // Core Data
  books: SavingsBook[];
  setBooks: React.Dispatch<React.SetStateAction<SavingsBook[]>>;
  settlementAdjustments: SettlementAdjustment[];
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  currentUser: AuthUser | null;
  currentDateStr: string;
}

export const AppModals: React.FC<AppModalsProps> = ({
  isAddModalOpen,
  setIsAddModalOpen,
  bookToEdit,
  onSaveBook,
  isSyncModalOpen,
  setIsSyncModalOpen,
  onLoginOnline,
  onDriveFileNotFound,
  onImportBooks,
  onClearBooks,
  onTriggerManualSync,
  onMarkAsRemoteUpdate,
  selectedBookForDetail,
  setSelectedBookForDetail,
  onUpdateBook,
  onSettleBook,
  onRolloverBook,
  isAndroidSpecModalOpen,
  setIsAndroidSpecModalOpen,
  isManageBanksModalOpen,
  setIsManageBanksModalOpen,
  onBanksChanged,
  isLogoutWarningModalOpen,
  setIsLogoutWarningModalOpen,
  onConfirmLogoutAnyway,
  onExportAndLogout,
  showFileDeletedRecovery,
  setShowFileDeletedRecovery,
  onDeleteAppData,
  onSetSyncDriveStatus,
  onSetIsSyncingDrive,
  onStartFileSwitch,
  onFinishFileSwitch,
  onCancelFileSwitch,
  isClearDataModalOpen,
  setIsClearDataModalOpen,
  onClearAllAppData,
  isDriveTokenExpired = false,
  setIsDriveTokenExpired,
  onRenewDriveTokenAndSync,
  isUserManagementModalOpen = false,
  setIsUserManagementModalOpen,
  onLeaveWorkspace,
  books,
  settlementAdjustments,
  settings,
  setSettings,
  currentUser,
  currentDateStr,
}) => {
  const handleUpdateSettings = React.useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, [setSettings]);

  const handleSaveMembers = async (updatedMembers: WorkspaceMember[]) => {
    // 0. Xác định email Admin và đảm bảo Admin luôn được bảo toàn trong mảng dữ liệu tổng thể
    const effectiveAdminEmail = (currentUser?.email || settings.workspaceOwnerEmail || '').trim().toLowerCase();
    let finalMembers: WorkspaceMember[] = [...updatedMembers];
    if (effectiveAdminEmail) {
      const hasAdmin = finalMembers.some((m) => m.email.trim().toLowerCase() === effectiveAdminEmail);
      if (!hasAdmin) {
        finalMembers.unshift({
          id: `owner-${Date.now()}`,
          email: effectiveAdminEmail,
          name: currentUser?.name || 'Admin',
          role: 'ADMIN',
          addedAt: new Date().toISOString(),
          addedBy: 'Hệ thống',
        });
      }
    }

    const nowIso = new Date().toISOString();

    // 1. Cập nhật state settings và lưu ngay vào localStorage kèm timestamp mới nhất
    const updatedSettings: AppSettings = {
      ...settings,
      members: finalMembers,
      workspaceOwnerEmail: settings.workspaceOwnerEmail || effectiveAdminEmail,
      lastLocalLinkTimestamp: nowIso,
    };
    setSettings((prev) => ({
      ...prev,
      members: finalMembers,
      workspaceOwnerEmail: prev.workspaceOwnerEmail || effectiveAdminEmail,
      lastLocalLinkTimestamp: nowIso,
    }));
    try {
      localStorage.setItem('savings_settings_v3', JSON.stringify(updatedSettings));
    } catch {}

    // 2. Xác thực và đảm bảo token Google Drive còn hiệu lực
    let token = getGoogleAccessToken();
    if (!token || !isGoogleTokenValid()) {
      token = await trySilentRefresh();
    }
    if (!token) {
      try {
        token = await ensureGoogleAccessToken();
      } catch (authErr: any) {
        throw new Error('Phiên đăng nhập Google Drive đã hết hạn. Vui lòng đăng nhập lại Google để cấp quyền thành viên.');
      }
    }

    // 3. Xác định file ID đang liên kết
    const fileMatch = settings.googleSheetUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl?.match(/id=([a-zA-Z0-9-_]+)/);
    const activeFileId = fileMatch
      ? fileMatch[1]
      : (settings.googleSheetUrl && settings.googleSheetUrl.length > 20 && !settings.googleSheetUrl.includes('/')
          ? settings.googleSheetUrl
          : getLocalMasterPointerFileId());

    if (!activeFileId) {
      throw new Error('Chưa tìm thấy file Google Sheet được liên kết. Vui lòng kết nối file trước khi phân quyền.');
    }

    // 4. Lấy master sync state hiện tại từ Drive
    let currentMaster = await getMasterSyncStateFromDrive(token, activeFileId);

    if (!currentMaster) {
      currentMaster = {
        status: 'active',
        lastAction: 'link',
        activeFileId,
        activeFileName: settings.googleSheetName || 'Bảng tính tiết kiệm',
        activeFileUrl: settings.googleSheetUrl || `https://docs.google.com/spreadsheets/d/${activeFileId}/edit`,
        linkedTimestamp: nowIso,
        linkedAccountEmail: currentUser?.email || 'Google User',
        adminEmail: effectiveAdminEmail || 'admin',
        members: finalMembers,
        updatedAt: nowIso,
      };
    } else {
      currentMaster = {
        ...currentMaster,
        activeFileId: activeFileId || currentMaster.activeFileId,
        activeFileName: settings.googleSheetName || currentMaster.activeFileName,
        activeFileUrl: settings.googleSheetUrl || currentMaster.activeFileUrl,
        adminEmail: currentMaster.adminEmail || effectiveAdminEmail,
        members: finalMembers,
        updatedAt: nowIso,
      };
    }

    // 5. Lưu vào Master Sync State trên Drive (ghi tab __CONFIG__, appProperties và đồng bộ quyền Drive)
    const saveDriveRes = await saveMasterSyncStateOnDrive(token, currentMaster);
    if (!saveDriveRes) {
      throw new Error('Không thể ghi cấu hình Master State lên Google Drive. Vui lòng kiểm tra quyền truy cập file.');
    }

    // 6. Đồng bộ quyền Drive trực tiếp một lần nữa để đảm bảo và kiểm tra kết quả
    const syncRes = await synchronizeDrivePermissionsWithJsonMembers(
      token,
      activeFileId,
      finalMembers,
      effectiveAdminEmail
    );

    if (syncRes && syncRes.errors && syncRes.errors.length > 0) {
      throw new Error(`Đã lưu cấu hình nhưng chưa thể chia sẻ quyền Google Drive: ${syncRes.errors.join('; ')}`);
    }
  };
  const handleCreateRecoveryFile = async () => {
    let token = getGoogleAccessToken();
    if (!token) {
      try {
        token = await ensureGoogleAccessToken();
      } catch {
        alert('Vui lòng đăng nhập Google để tạo file mới.');
        return;
      }
    }

    try {
      onSetIsSyncingDrive(true);
      onSetSyncDriveStatus('Đang khởi tạo file liên kết mới trên Google Drive...');
      const fileName = `So_Tiet_Kiem_Gia_Dinh_Recovery_${new Date()
        .toLocaleDateString('vi-VN')
        .replace(/\//g, '-')}`;
      const newFileRes = await createRealGoogleDriveFile(token, fileName, books, settlementAdjustments);

      if (newFileRes?.id) {
        const fileUrl = newFileRes.webViewLink || `https://docs.google.com/spreadsheets/d/${newFileRes.id}/edit`;
        setSettings((prev) => ({
          ...prev,
          googleSheetUrl: fileUrl,
          googleSheetName: newFileRes.name || fileName,
          lastSyncTime: new Date().toLocaleString('vi-VN'),
        }));
        setExplicitlyUnlinked(false);
        onSetSyncDriveStatus('✅ Đã tạo file mới và khôi phục đồng bộ Google Drive thành công!');
        setTimeout(() => onSetSyncDriveStatus(null), 3500);
      }
    } catch (err: any) {
      console.error('Error creating recovery file:', err);
      alert('Lỗi khi tạo file mới trên Google Drive: ' + err.message);
    } finally {
      onSetIsSyncingDrive(false);
    }
  };

  return (
    <>
      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <AddEditBookModal
          isOpen={isAddModalOpen}
          bookToEdit={bookToEdit}
          books={books}
          currentDateStr={currentDateStr}
          husbandName={settings.husbandName}
          wifeName={settings.wifeName}
          onClose={() => setIsAddModalOpen(false)}
          onSave={onSaveBook}
        />
      )}

      {/* Data Sync & Import Modal (Lazy loaded) */}
      {isSyncModalOpen && (
        <Suspense fallback={<ModalLoadingSpinner />}>
          <DataSyncModal
            isOpen={isSyncModalOpen}
            onClose={() => setIsSyncModalOpen(false)}
            books={books}
            settlements={settlementAdjustments}
            appUser={currentUser}
            onLoginOnline={onLoginOnline}
            onDriveFileNotFound={onDriveFileNotFound}
            onImportBooks={onImportBooks}
            onClearBooks={onClearBooks}
            onTriggerManualSync={onTriggerManualSync}
            onMarkAsRemoteUpdate={onMarkAsRemoteUpdate}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onStartFileSwitch={onStartFileSwitch}
            onFinishFileSwitch={onFinishFileSwitch}
            onCancelFileSwitch={onCancelFileSwitch}
          />
        </Suspense>
      )}

      {/* Deep Dive Single Book Detail Modal */}
      {selectedBookForDetail && (
        <BookDetailModal
          book={selectedBookForDetail}
          currentDateStr={currentDateStr}
          settings={settings}
          onClose={() => setSelectedBookForDetail(null)}
          onUpdateBook={onUpdateBook}
          onSettleBook={onSettleBook}
          onRolloverBook={onRolloverBook}
        />
      )}

      {/* Android Specification & Source Code Modal */}
      {isAndroidSpecModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-sm">
                  Đặc Tả Kiến Trúc &amp; Mã Nguồn Android (Kotlin Jetpack Compose)
                </span>
              </div>
              <button
                onClick={() => setIsAndroidSpecModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <AndroidSpecModal />
            </div>
          </div>
        </div>
      )}

      {/* Quản lý danh mục Ngân hàng */}
      {isManageBanksModalOpen && (
        <ManageBanksModal
          isOpen={isManageBanksModalOpen}
          onClose={() => setIsManageBanksModalOpen(false)}
          books={books}
          onBanksChanged={onBanksChanged}
        />
      )}

      {/* Logout Safeguard Backup Warning Modal */}
      {isLogoutWarningModalOpen && (
        <LogoutWarningModal
          isOpen={isLogoutWarningModalOpen}
          onClose={() => setIsLogoutWarningModalOpen(false)}
          books={books}
          privacyMode={settings.privacyMode}
          onConnectDrive={() => {
            setIsLogoutWarningModalOpen(false);
            setIsSyncModalOpen(true);
          }}
          onExportExcel={onExportAndLogout}
          onConfirmLogout={onConfirmLogoutAnyway}
        />
      )}

      {/* Google Drive File Deleted Recovery Modal */}
      {showFileDeletedRecovery && (
        <FileDeletedRecoveryModal
          isOpen={showFileDeletedRecovery}
          onClose={() => setShowFileDeletedRecovery(false)}
          books={books}
          settlements={settlementAdjustments}
          onCreateNewFile={handleCreateRecoveryFile}
          onExportExcel={async () => {
            const annualHistory = getDynamicAnnualInterestHistory(books, settlementAdjustments);
            const balanceHistory = getDynamicBalanceGrowthHistory(books, settlementAdjustments);
            await exportSavingsBooksToExcel(
              books,
              `Backup_Khan_Cap_${currentDateStr}.xlsx`,
              annualHistory,
              balanceHistory
            );
          }}
          onDeleteAppData={onDeleteAppData}
        />
      )}

      {/* Clear App Data Confirmation Modal */}
      {isClearDataModalOpen && (
        <ClearDataConfirmationModal
          isOpen={isClearDataModalOpen}
          onClose={() => setIsClearDataModalOpen(false)}
          booksCount={books.length}
          totalPrincipal={books.reduce((sum, b) => sum + (b.status === 'active' ? b.principal : 0), 0)}
          onExportBackup={async () => {
            const annualHistory = getDynamicAnnualInterestHistory(books, settlementAdjustments);
            const balanceHistory = getDynamicBalanceGrowthHistory(books, settlementAdjustments);
            await exportSavingsBooksToExcel(
              books,
              `Sao_Luu_So_Tiet_Kiem_${currentDateStr}.xlsx`,
              annualHistory,
              balanceHistory
            );
          }}
          onConfirmClear={onClearAllAppData}
        />
      )}

      {/* Drive Token Expired Notification Modal */}
      {isDriveTokenExpired && !currentUser?.isOffline && (
        <DriveTokenExpiredModal
          isOpen={isDriveTokenExpired && !currentUser?.isOffline}
          onClose={() => {
            try {
              sessionStorage.setItem('dismissed_drive_prompt', 'true');
            } catch {}
            setIsDriveTokenExpired && setIsDriveTokenExpired(false);
          }}
          isReconnecting={!!settings.googleSheetUrl}
          onRenewToken={async () => {
            if (onRenewDriveTokenAndSync) {
              await onRenewDriveTokenAndSync();
            }
          }}
        />
      )}

      {/* User Management Modal */}
      {isUserManagementModalOpen && (
        <UserManagementModal
          isOpen={isUserManagementModalOpen}
          onClose={() => setIsUserManagementModalOpen && setIsUserManagementModalOpen(false)}
          currentUser={currentUser}
          settings={settings}
          onSaveMembers={handleSaveMembers}
          onLeaveWorkspace={onLeaveWorkspace}
          onOpenSyncModal={() => setIsSyncModalOpen(true)}
        />
      )}
    </>
  );
};
