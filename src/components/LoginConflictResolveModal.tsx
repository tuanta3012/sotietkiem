import React from 'react';
import { AlertTriangle, Merge, HardDriveDownload, PlusCircle, LogOut } from 'lucide-react';

interface LoginConflictResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  localBooksCount: number;
  onResolveMerge: () => void;
  onResolveOverwriteLocal: () => void;
  onResolveCreateNewFile: () => void;
}

export function LoginConflictResolveModal({
  isOpen,
  onClose,
  fileName,
  localBooksCount,
  onResolveMerge,
  onResolveOverwriteLocal,
  onResolveCreateNewFile,
}: LoginConflictResolveModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-sm sm:max-w-md w-full overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header section with compact warning look */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 bg-gradient-to-r from-amber-500/10 to-transparent border-b border-slate-800 flex items-center space-x-3">
          <div className="p-2 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-xl shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-black text-white tracking-tight leading-tight">
              Phát hiện file trên Drive
            </h2>
            <p className="text-xs text-amber-300/90 truncate mt-0.5 font-medium">
              File: {fileName}
            </p>
          </div>
        </div>

        {/* Content detail - compact for phone */}
        <div className="p-4 sm:p-5 space-y-3">
          <p className="text-xs sm:text-sm text-slate-300">
            Máy đang có <strong className="text-emerald-400">{localBooksCount} sổ</strong> chưa đồng bộ. Vui lòng chọn cách xử lý:
          </p>

          {/* Action options buttons */}
          <div className="space-y-2">
            {/* Option 1: Merge (Recommended) */}
            <button
              onClick={onResolveMerge}
              className="w-full text-left p-3 rounded-xl bg-emerald-950/30 hover:bg-emerald-950/50 text-white border border-emerald-500/40 transition-all flex items-center justify-between gap-2.5 cursor-pointer active:scale-98"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="p-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg shrink-0">
                  <Merge className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-bold text-emerald-300">
                    Gộp chung dữ liệu
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Ghép {localBooksCount} sổ vào Drive, không mất sổ nào
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/30 shrink-0">
                Khuyên dùng
              </span>
            </button>

            {/* Option 2: Overwrite (Discard local, download remote) */}
            <button
              onClick={onResolveOverwriteLocal}
              className="w-full text-left p-3 rounded-xl bg-slate-950/40 hover:bg-slate-950/80 text-white border border-slate-800 transition-all flex items-center space-x-2.5 cursor-pointer active:scale-98"
            >
              <div className="p-2 bg-slate-800 text-slate-400 border border-slate-700/60 rounded-lg shrink-0">
                <HardDriveDownload className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-slate-300">
                  Lấy dữ liệu từ Drive
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Bỏ {localBooksCount} sổ trên máy, tải toàn bộ từ Drive
                </div>
              </div>
            </button>

            {/* Option 3: Create New File */}
            <button
              onClick={onResolveCreateNewFile}
              className="w-full text-left p-3 rounded-xl bg-slate-950/40 hover:bg-slate-950/80 text-white border border-slate-800 transition-all flex items-center space-x-2.5 cursor-pointer active:scale-98"
            >
              <div className="p-2 bg-slate-800 text-slate-400 border border-slate-700/60 rounded-lg shrink-0">
                <PlusCircle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-slate-300">
                  Tạo file mới riêng
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Tạo file Sheet mới tinh trên Drive cho các sổ này
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer with stay offline option */}
        <div className="px-4 py-2.5 sm:px-5 sm:py-3 bg-slate-950/50 border-t border-slate-800 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Để sau / Ngoại tuyến</span>
          </button>
        </div>
      </div>
    </div>
  );
}
