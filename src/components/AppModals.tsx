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
  getMasterSyncStateFromDrive,
  saveMasterSyncStateOnDrive,
  shareFileWithUserEmail,
  removeMemberFromDriveMaster,
  updateMemberRoleOnDrive,
  synchronizeDrivePermissionsWithJsonMembers,
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
  onLeaveWorkspace?: () => void;

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
  const handleSaveMembers = async (updatedMembers: WorkspaceMember[]) => {
    const prevMembers = settings.members || [];
    setSettings((prev) => ({
      ...prev,
      members: updatedMembers,
    }));

    // If online with Google token, persist members directly to Master Sync State file on Drive
    const token = getGoogleAccessToken();
    if (token) {
      try {
        let currentMaster = await getMasterSyncStateFromDrive(token);
        const fileMatch = settings.googleSheetUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl?.match(/id=([a-zA-Z0-9-_]+)/);
        const activeFileId = fileMatch ? fileMatch[1] : null;

        if (!currentMaster) {
          currentMaster = {
            status: 'active',
            lastAction: 'link',
            activeFileId: activeFileId || undefined,
            activeFileName: settings.googleSheetName || 'Bảng tính tiết kiệm',
            activeFileUrl: settings.googleSheetUrl || undefined,
            linkedTimestamp: settings.lastLocalLinkTimestamp || new Date().toISOString(),
            linkedAccountEmail: currentUser?.email || 'Google User',
            adminEmail: currentUser?.email?.toLowerCase() || 'admin',
            members: updatedMembers,
            updatedAt: new Date().toISOString(),
          };
        } else {
          currentMaster = {
            ...currentMaster,
            adminEmail: currentMaster.adminEmail || currentUser?.email?.toLowerCase() || 'admin',
            members: updatedMembers,
            updatedAt: new Date().toISOString(),
          };
        }
        await saveMasterSyncStateOnDrive(token, currentMaster);

        const effectiveAdminEmail = currentMaster.adminEmail || currentUser?.email;
        if (activeFileId) {
          await synchronizeDrivePermissionsWithJsonMembers(
            token,
            activeFileId,
            updatedMembers,
            effectiveAdminEmail
          );
        }
      } catch (err) {
        console.warn('Lỗi lưu danh sách thành viên lên Google Drive:', err);
      }
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
        try {
          sessionStorage.removeItem('explicitly_unlinked');
        } catch {}
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
            onUpdateSettings={(newSettings) => {
              setSettings((prev) => ({ ...prev, ...newSettings }));
            }}
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
      {isDriveTokenExpired && (
        <DriveTokenExpiredModal
          isOpen={isDriveTokenExpired}
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
        />
      )}
    </>
  );
};
