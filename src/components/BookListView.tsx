import React, { useState, useEffect } from 'react';
import {
  SavingsBook,
  AppSettings,
  AuthUser,
  SettlementAdjustment,
  canEditData,
} from '../types';
import { ExcelSheetView } from './ExcelSheetView';
import { SettlementHistoryModal } from './SettlementHistoryModal';
import {
  FileSpreadsheet,
  Cloud,
  Plus,
  History,
  RefreshCw,
  Check,
  AlertCircle,
} from 'lucide-react';

interface BookListViewProps {
  books: SavingsBook[];
  filteredBooks: SavingsBook[];
  settings: AppSettings;
  currentDateStr: string;
  settlementAdjustments: SettlementAdjustment[];
  currentUser: AuthUser | null;
  sheetSubView?: 'excel' | 'cards';
  setSheetSubView?: (view: 'excel' | 'cards') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  ownerFilter: string;
  setOwnerFilter: (owner: string) => void;
  bankFilter: string;
  setBankFilter: (bank: string) => void;
  sortBy: 'maturity' | 'principal' | 'rate';
  setSortBy: (sort: 'maturity' | 'principal' | 'rate') => void;
  banksVersion?: number;
  sortedBanksInfo: {
    frequentBanks: any[];
    otherBanks: any[];
  };
  isSyncingDrive: boolean;
  syncDriveStatus?: string | null;
  onOpenSyncModal: () => void;
  onOpenAddModal: () => void;
  onOpenManageBanks: () => void;
  onSelectForAnalysis: (book: SavingsBook) => void;
  onOpenEdit: (book: SavingsBook) => void;
  onUpdateBook?: (book: SavingsBook) => void;
  onSettleBook?: (bookId: string, extra?: { isEarlySettled: boolean; settlementDate: string; actualInterestVND: number }) => void;
  onRolloverBook?: (oldBookId: string, rolloverConfig: { newPrincipal: number; newInterestRate: number; newTermMonths: number; newStartDate: string; newMaturityDate: string }) => void;
  onDeleteBook: (bookId: string) => void;
  onOpenOptimizer: () => void;
  onOpenInterestCalc: () => void;
  onSyncDrive: () => Promise<void>;
  onResetData?: () => void;
  onImportBooks?: (books: SavingsBook[], mode: 'replace' | 'merge') => void;
  onDeleteSettlement?: (id: string) => void;
}

export const BookListView: React.FC<BookListViewProps> = ({
  books,
  filteredBooks,
  settings,
  currentDateStr,
  settlementAdjustments,
  currentUser,
  searchQuery,
  setSearchQuery,
  ownerFilter,
  setOwnerFilter,
  bankFilter,
  setBankFilter,
  sortBy,
  setSortBy,
  banksVersion = 0,
  sortedBanksInfo,
  isSyncingDrive,
  syncDriveStatus,
  onOpenSyncModal,
  onOpenAddModal,
  onOpenManageBanks,
  onSelectForAnalysis,
  onOpenEdit,
  onUpdateBook,
  onSettleBook,
  onRolloverBook,
  onDeleteBook,
  onOpenOptimizer,
  onOpenInterestCalc,
  onSyncDrive,
  onResetData,
  onImportBooks,
  onDeleteSettlement,
}) => {
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [briefStatus, setBriefStatus] = useState<{
    text: string;
    type: 'syncing' | 'success' | 'error';
  } | null>(null);

  // Hiển thị ngắn gọn trạng thái đồng bộ ngay trên nút và tự động ẩn đi sau 3 giây
  useEffect(() => {
    if (isSyncingDrive) {
      setBriefStatus({ text: 'Đang đồng bộ...', type: 'syncing' });
      return;
    }

    if (!syncDriveStatus) {
      return;
    }

    const s = syncDriveStatus.trim();
    const isError =
      s.includes('❌') ||
      s.toLowerCase().includes('lỗi') ||
      s.toLowerCase().includes('thất bại') ||
      s.toLowerCase().includes('hết hạn') ||
      s.toLowerCase().includes('không thể') ||
      s.toLowerCase().includes('xung đột');

    let text = 'Đã đồng bộ';
    let type: 'success' | 'error' = 'success';

    if (isError) {
      type = 'error';
      if (s.toLowerCase().includes('hết hạn')) {
        text = 'Hết hạn phiên';
      } else if (s.toLowerCase().includes('xung đột')) {
        text = 'Xung đột dữ liệu';
      } else {
        text = 'Lỗi đồng bộ';
      }
    } else {
      type = 'success';
      if (s.toLowerCase().includes('kết nối') || s.toLowerCase().includes('tự động')) {
        text = 'Đã kết nối';
      } else {
        text = 'Đã đồng bộ';
      }
    }

    setBriefStatus({ text, type });

    const timer = setTimeout(() => {
      setBriefStatus(null);
    }, 3000);

    return () => clearTimeout(timer);
  }, [syncDriveStatus, isSyncingDrive]);

  return (
    <div className="space-y-4">
      {/* Action Bar: Bảng kê & Nhật ký Button + Drive Sync + Add Book */}
      <div className="bg-white p-2 sm:p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        {/* Main Tabs: Bảng kê + Nhật ký */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl w-full sm:w-auto overflow-x-auto">
            <div className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow-xs whitespace-nowrap">
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Bảng kê ({books.length} sổ)</span>
            </div>

            <button
              id="btn-open-activity-log"
              onClick={() => setIsSettlementModalOpen(true)}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 active:bg-amber-300 transition-all cursor-pointer whitespace-nowrap ml-1 border border-amber-300/80 shadow-2xs"
              title="Xem nhật ký biến động sổ, tất toán và tái tục"
            >
              <History className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>Nhật ký</span>
              <span className="bg-amber-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded-full font-extrabold shadow-2xs">
                {settlementAdjustments ? settlementAdjustments.length : 0}
              </span>
            </button>
          </div>
        </div>

        {/* Actions right beside switcher */}
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            id="btn-subview-sync-drive"
            onClick={onOpenSyncModal}
            className={`flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap border shadow-2xs ${
              isSyncingDrive || briefStatus?.type === 'syncing'
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 ring-2 ring-amber-300/40 animate-pulse'
                : briefStatus?.type === 'success'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-xs'
                : briefStatus?.type === 'error'
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300 ring-1 ring-rose-300/40'
                : 'bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border-emerald-300'
            }`}
            title={
              briefStatus
                ? `Trạng thái: ${briefStatus.text}`
                : settings.googleSheetName
                ? `File: ${settings.googleSheetName}`
                : 'Đồng bộ Google Drive'
            }
          >
            {isSyncingDrive || briefStatus?.type === 'syncing' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />
                <span>Đang đồng bộ...</span>
              </>
            ) : briefStatus?.type === 'success' ? (
              <>
                <Check className="w-3.5 h-3.5 text-white shrink-0" />
                <span>{briefStatus.text}</span>
              </>
            ) : briefStatus?.type === 'error' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{briefStatus.text}</span>
              </>
            ) : (
              <>
                <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{currentUser?.isOffline ? 'Sao Lưu & Đồng Bộ' : 'Đồng Bộ Google Drive'}</span>
              </>
            )}
          </button>

          <button
            id="btn-subview-add-book"
            onClick={() => {
              if (!canEditData(settings.currentRole)) {
                alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền thêm hoặc chỉnh sửa dữ liệu.');
                return;
              }
              onOpenAddModal();
            }}
            disabled={!canEditData(settings.currentRole)}
            className={`flex-1 sm:flex-none flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
              canEditData(settings.currentRole)
                ? 'bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-70'
            }`}
            title={canEditData(settings.currentRole) ? 'Thêm sổ tiết kiệm' : 'Tài khoản chỉ xem - không thể thêm sổ'}
          >
            <Plus className={`w-3.5 h-3.5 shrink-0 ${canEditData(settings.currentRole) ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span>Thêm sổ</span>
          </button>
        </div>
      </div>

      {/* Main View: Excel Sheet View */}
      <ExcelSheetView
        books={books}
        settings={settings}
        currentDateStr={currentDateStr}
        banksVersion={banksVersion}
        settlements={settlementAdjustments}
        onOpenDetail={onSelectForAnalysis}
        onUpdateBook={onUpdateBook}
        onSettleBook={onSettleBook}
        onRolloverBook={onRolloverBook}
        onDeleteBook={onDeleteBook}
        onOpenOptimizer={onOpenOptimizer}
        onOpenSyncModal={onOpenSyncModal}
        onOpenInterestCalc={onOpenInterestCalc}
        onSyncDrive={onSyncDrive}
        isSyncingDrive={isSyncingDrive}
        onImportBooks={onImportBooks}
        onOpenAddModal={onOpenAddModal}
      />

      {/* Modal Nhật Ký Biến Động Sổ (Mobile-First Card View) */}
      <SettlementHistoryModal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        settlements={settlementAdjustments}
        settings={settings}
        onDeleteSettlement={onDeleteSettlement}
      />
    </div>
  );
};
