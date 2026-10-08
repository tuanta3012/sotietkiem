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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800/80 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header section with WARNING look */}
        <div className="p-6 pb-4 bg-gradient-to-r from-amber-500/10 to-transparent border-b border-slate-800/60 flex items-start space-x-3.5">
          <div className="p-3 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-2xl shrink-0 animate-pulse">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight leading-snug">
              Phát hiện dữ liệu cũ trên Google Drive
            </h2>
            <p className="text-xs text-amber-300 font-medium mt-1">
              Bạn đang có cả dữ liệu ngoại tuyến và tệp sao lưu trên Drive
            </p>
          </div>
        </div>

        {/* Content detail */}
        <div className="p-6 space-y-4">
          <div className="text-slate-300 text-sm leading-relaxed space-y-2.5">
            <p>
              Hệ thống phát hiện tài khoản Google của bạn đang liên kết với tệp cũ:
            </p>
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl font-semibold text-slate-200 text-xs flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="truncate">{fileName}</span>
            </div>
            <p>
              Trong khi đó, bạn vừa tạo mới <strong className="text-emerald-400">{localBooksCount} sổ tiết kiệm ngoại tuyến</strong> trên thiết bị này.
            </p>
            <p className="text-xs text-slate-400 italic">
              Để tránh ghi đè làm mất dữ liệu của bạn, vui lòng lựa chọn cách xử lý bên dưới:
            </p>
          </div>

          {/* Action options buttons */}
          <div className="space-y-3 pt-2">
            {/* Option 1: Merge (Recommended) */}
            <button
              onClick={onResolveMerge}
              className="w-full text-left p-3.5 rounded-2xl bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 hover:from-emerald-600/30 hover:to-emerald-500/20 text-white border border-emerald-500/30 transition-all flex items-start space-x-3 cursor-pointer group active:scale-98"
            >
              <div className="p-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl group-hover:scale-105 transition-transform shrink-0">
                <Merge className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-emerald-300 flex items-center space-x-1.5">
                  <span>Gộp dữ liệu (Khuyên dùng)</span>
                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-md border border-emerald-500/20">
                    An toàn
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Hợp nhất toàn bộ sổ ngoại tuyến mới vào tệp trên Drive. Bảo toàn tuyệt đối mọi dữ liệu.
                </div>
              </div>
            </button>

            {/* Option 2: Overwrite (Discard local, download remote) */}
            <button
              onClick={onResolveOverwriteLocal}
              className="w-full text-left p-3.5 rounded-2xl bg-slate-950/40 hover:bg-slate-950/80 text-white border border-slate-800 transition-all flex items-start space-x-3 cursor-pointer group active:scale-98"
            >
              <div className="p-2 bg-slate-800 text-slate-400 border border-slate-700/60 rounded-xl group-hover:scale-105 transition-transform shrink-0">
                <HardDriveDownload className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-300">
                  Lấy dữ liệu từ Google Drive
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Xóa bỏ các sổ ngoại tuyến hiện tại và đồng bộ tải về toàn bộ sổ cũ từ Google Drive.
                </div>
              </div>
            </button>

            {/* Option 3: Create New File */}
            <button
              onClick={onResolveCreateNewFile}
              className="w-full text-left p-3.5 rounded-2xl bg-slate-950/40 hover:bg-slate-950/80 text-white border border-slate-800 transition-all flex items-start space-x-3 cursor-pointer group active:scale-98"
            >
              <div className="p-2 bg-slate-800 text-slate-400 border border-slate-700/60 rounded-xl group-hover:scale-105 transition-transform shrink-0">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-300">
                  Tạo tệp sao lưu mới hoàn toàn
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  Tạo tệp Google Sheet mới tinh trên Drive từ các sổ ngoại tuyến hiện tại.
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer with stay offline option */}
        <div className="p-4 bg-slate-950/40 border-t border-slate-800/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Hủy &amp; Tiếp tục ngoại tuyến</span>
          </button>
        </div>
      </div>
    </div>
  );
}
