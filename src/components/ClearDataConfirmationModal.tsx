import React from 'react';
import { Trash2 } from 'lucide-react';

interface ClearDataConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  booksCount?: number;
  totalPrincipal?: number;
  onExportBackup?: () => void;
  onConfirmClear: () => void;
}

export const ClearDataConfirmationModal: React.FC<ClearDataConfirmationModalProps> = ({
  isOpen,
  onClose,
  booksCount = 0,
  onConfirmClear,
}) => {
  if (!isOpen) return null;

  const handleExecuteWipe = () => {
    onConfirmClear();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        
        {/* Simple Confirmation Content */}
        <div className="p-5 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-base text-slate-900">
              Xác Nhận Xóa Dữ Liệu?
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {booksCount > 0
                ? `Bạn có chắc chắn muốn xóa toàn bộ ${booksCount} sổ tiết kiệm và dữ liệu trên thiết bị này không?`
                : 'Bạn có chắc chắn muốn xóa toàn bộ dữ liệu lưu trên thiết bị này không?'}
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-300 transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleExecuteWipe}
            className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-all active:scale-98 flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Xóa Dữ Liệu</span>
          </button>
        </div>

      </div>
    </div>
  );
};
