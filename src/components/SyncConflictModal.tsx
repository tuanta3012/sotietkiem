import React from 'react';
import { AlertTriangle, CloudDownload, Loader2, Upload, GitMerge } from 'lucide-react';
import { SyncConflictState } from '../hooks/useDriveSync';

interface SyncConflictModalProps {
  conflict: SyncConflictState | null;
  isResolving: boolean;
  status: string | null;
  onChooseRemote: () => void;
  onChooseLocal: () => void;
  onChooseMerge?: () => void;
}

export function SyncConflictModal({
  conflict,
  isResolving,
  status,
  onChooseRemote,
  onChooseLocal,
  onChooseMerge,
}: SyncConflictModalProps) {
  if (!conflict) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        className="w-full max-w-sm sm:max-w-md overflow-hidden rounded-2xl sm:rounded-3xl border border-amber-200 bg-white shadow-2xl"
      >
        {/* Compact Header */}
        <header className="flex items-center gap-2.5 border-b border-amber-100 bg-amber-50 px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="rounded-lg bg-amber-100 p-2 text-amber-700 shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="sync-conflict-title" className="text-base sm:text-lg font-black text-slate-900 leading-tight">
              Xung đột dữ liệu đồng bộ
            </h2>
            <p className="text-xs text-slate-500 truncate mt-0.5">
              File: {conflict.fileName}
            </p>
          </div>
        </header>

        <div className="space-y-3 p-4 sm:p-5">
          {/* Quick Counter Comparison */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5 text-center border border-slate-100">
            <div className="rounded-lg bg-white py-1.5 px-2 border border-slate-100 shadow-xs">
              <div className="text-xl sm:text-2xl font-black text-slate-800">{conflict.localBooks.length}</div>
              <div className="text-[11px] font-medium text-slate-500">Trên máy này</div>
            </div>
            <div className="rounded-lg bg-white py-1.5 px-2 border border-slate-100 shadow-xs">
              <div className="text-xl sm:text-2xl font-black text-emerald-700">{conflict.remoteBooks.length}</div>
              <div className="text-[11px] font-medium text-emerald-700">Trên Drive</div>
            </div>
          </div>

          <p className="text-xs text-slate-500 text-center">
            Cả 2 nơi đều có thay đổi mới. Bạn có thể tự động gộp hoặc chọn bản cần giữ:
          </p>

          {status && (status.includes('❌') || status.includes('⚠️')) && (
            <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
              {status}
            </p>
          )}

          {/* Action Buttons - Clear, Short & Touch-friendly */}
          <div className="space-y-2 pt-1">
            {onChooseMerge && (
              <button
                type="button"
                disabled={isResolving}
                onClick={onChooseMerge}
                className="flex w-full items-center justify-between gap-2.5 rounded-xl border-2 border-indigo-500 bg-indigo-50/80 p-3 sm:p-3.5 text-left transition hover:bg-indigo-100 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="rounded-lg bg-indigo-600 text-white p-2 shrink-0 shadow-xs">
                    {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-indigo-950 leading-snug">
                      Hợp nhất thông minh (Gộp cả hai)
                    </div>
                    <div className="text-[11px] text-indigo-700 font-medium">
                      Bảo toàn sổ của cả gia đình, không bỏ sót ai
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-200/80 px-2 py-0.5 rounded-full shrink-0">
                  Khuyên dùng
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={isResolving}
              onClick={onChooseRemote}
              className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 sm:p-3.5 text-left transition hover:bg-emerald-100 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="rounded-lg bg-emerald-600 text-white p-2 shrink-0 shadow-xs">
                  <CloudDownload className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900 leading-snug">
                    Lấy bản Google Drive
                  </div>
                  <div className="text-[11px] text-emerald-700 font-medium">
                    Tải {conflict.remoteBooks.length} sổ từ Drive về máy
                  </div>
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={isResolving}
              onClick={onChooseLocal}
              className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:p-3.5 text-left transition hover:bg-amber-50/60 hover:border-amber-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 cursor-pointer"
            >
              <div className="rounded-lg bg-slate-100 text-amber-700 p-2 shrink-0 border border-slate-200">
                {isResolving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800 leading-snug">
                  Ghi đè bản máy lên Drive
                </div>
                <div className="text-[11px] text-slate-500">
                  Đẩy {conflict.localBooks.length} sổ từ máy thay thế trên Drive
                </div>
              </div>
            </button>
          </div>

          <p className="text-[10px] text-slate-400 text-center pt-1">
            🔒 Dữ liệu cũ đều được tự động lưu dự phòng an toàn trên thiết bị
          </p>
        </div>
      </section>
    </div>
  );
}
