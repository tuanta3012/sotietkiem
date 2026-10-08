import React, { useState } from 'react';
import { 
  Plus, 
  Download, 
  Trash2, 
  X,
  FileWarning,
  ArrowRight,
  FileSpreadsheet,
  CheckCircle,
  Undo2
} from 'lucide-react';
import { SavingsBook } from '../types';

interface FileDeletedRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: SavingsBook[];
  settlements?: any[];
  onCreateNewFile: (customFileName?: string) => Promise<void>;
  onExportExcel: () => void;
  onDeleteAppData: () => void;
}

export const FileDeletedRecoveryModal: React.FC<FileDeletedRecoveryModalProps> = ({
  isOpen,
  onClose,
  books,
  onCreateNewFile,
  onExportExcel,
  onDeleteAppData,
}) => {
  const [showNameInput, setShowNameInput] = useState(false);
  const [newFileName, setNewFileName] = useState(`So_tiet_kiem_${new Date().getFullYear()}`);
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen) return null;

  const handleConfirmCreate = async () => {
    if (!newFileName.trim()) return;
    setIsCreating(true);
    try {
      await onCreateNewFile(newFileName.trim());
      onClose();
    } catch (err) {
      console.error('Error creating recovery file:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteImmediately = () => {
    onDeleteAppData();
    onClose();
  };

  const hasData = books.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-sm sm:max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-5 flex items-start space-x-3.5 border-b border-amber-100 bg-amber-50/70 relative">
          <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center shrink-0">
            <FileWarning className="w-5 h-5" />
          </div>
          <div className="pr-6">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
              File liên kết đã bị xóa trên Drive
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5">
              Ứng dụng đã tự động hủy liên kết để bảo vệ dữ liệu thiết bị.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDeleteImmediately}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-amber-100 transition-colors cursor-pointer"
            title="Đóng & Xóa dữ liệu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          
          {/* Trạng thái dữ liệu hiện tại */}
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 border border-slate-200 flex items-center justify-between">
            <span>Dữ liệu hiện có trên App:</span>
            <span className={`font-bold ${hasData ? 'text-emerald-700' : 'text-slate-500'}`}>
              {books.length} sổ tiết kiệm
            </span>
          </div>

          {showNameInput ? (
            /* LUỒNG NHẬP TÊN FILE TÙY CHỌN ĐỂ GHI ĐỒNG BỘ TIẾP */
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="space-y-2 text-xs">
                <label className="font-bold text-slate-800 block flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Tên file muốn tạo trên Google Drive:</span>
                </label>
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="So_tiet_kiem"
                  disabled={isCreating}
                  className="w-full px-3.5 py-2.5 border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 rounded-xl font-mono text-xs focus:outline-none transition-all disabled:bg-slate-50 disabled:text-slate-400"
                />
                <p className="text-[10px] text-slate-500 leading-normal">
                  💡 File mới này sẽ tự động được ghi nạp {books.length} sổ tiết kiệm hiện tại trên thiết bị của bạn để tiếp tục đồng bộ, bảo toàn dữ liệu 100%.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => setShowNameInput(false)}
                  className="w-full py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Quay lại</span>
                </button>

                <button
                  type="button"
                  disabled={isCreating || !newFileName.trim()}
                  onClick={handleConfirmCreate}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span>Đang tạo...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>Tạo &amp; Đồng bộ</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* LUỒNG LỰA CHỌN PHƯƠNG ÁN KHÔI PHỤC */
            <div className="space-y-2.5">
              
              {/* Chỉ hiện luồng tạo file đồng bộ tiếp khi có dữ liệu thực tế */}
              {hasData && (
                <button
                  type="button"
                  onClick={() => setShowNameInput(true)}
                  className="w-full flex items-center justify-between p-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm shadow-emerald-600/10 group cursor-pointer"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-1">
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="truncate">1. Tạo file mới trên Drive để đồng bộ tiếp</span>
                  </div>
                  <ArrowRight className="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>
              )}

              {/* Nút xuất file sao lưu Excel về máy */}
              <button
                type="button"
                onClick={onExportExcel}
                className="w-full flex items-center justify-between p-3.5 bg-white border border-slate-300 hover:bg-slate-50 active:scale-[0.98] text-slate-800 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-2xs"
              >
                <div className="flex items-center space-x-2.5 min-w-0 pr-1">
                  <Download className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="truncate">
                    {hasData ? '2. Xuất file sao lưu về máy (.xlsx)' : '1. Xuất file sao lưu rỗng (.xlsx)'}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {/* Nút hủy bỏ và xóa sạch */}
              <button
                type="button"
                onClick={handleDeleteImmediately}
                className="w-full flex items-center justify-center p-2.5 text-rose-600 hover:bg-rose-50 border border-rose-200 bg-rose-50/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                <span>
                  {hasData ? '3. Bỏ qua & Xóa toàn bộ dữ liệu máy' : '2. Bỏ qua & Dọn sạch dữ liệu'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
