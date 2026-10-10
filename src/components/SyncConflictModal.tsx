import React from 'react';
import { AlertTriangle, CloudDownload, Loader2, Upload } from 'lucide-react';
import { SyncConflictState } from '../hooks/useDriveSync';

interface SyncConflictModalProps {
  conflict: SyncConflictState | null;
  isResolving: boolean;
  status: string | null;
  onChooseRemote: () => void;
  onChooseLocal: () => void;
}

export function SyncConflictModal({
  conflict,
  isResolving,
  status,
  onChooseRemote,
  onChooseLocal,
}: SyncConflictModalProps) {
  if (!conflict) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 p-5">
          <div className="rounded-xl bg-amber-100 p-2.5 text-amber-700">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h2 id="sync-conflict-title" className="text-lg font-black text-slate-900">
              Phát hiện xung đột đồng bộ
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              File “{conflict.fileName}” đã được sửa trên Drive trong khi thiết bị này cũng có thay đổi.
            </p>
          </div>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-slate-700">
            Để tránh ghi đè âm thầm, đồng bộ tự động đã tạm dừng. Bản trên thiết bị sẽ được sao lưu cục bộ trước khi áp dụng lựa chọn.
          </p>

          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-center">
            <div>
              <div className="text-2xl font-black text-slate-800">{conflict.localBooks.length}</div>
              <div className="text-xs font-semibold text-slate-500">sổ trên thiết bị</div>
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800">{conflict.remoteBooks.length}</div>
              <div className="text-xs font-semibold text-slate-500">sổ trên Drive</div>
            </div>
          </div>

          {status && (status.includes('❌') || status.includes('⚠️')) && (
            <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-700">
              {status}
            </p>
          )}

          <div className="space-y-2">
            <button
              type="button"
              disabled={isResolving}
              onClick={onChooseRemote}
              className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
            >
              <CloudDownload className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <span>
                <span className="block text-sm font-bold text-slate-900">Dùng bản Google Drive</span>
                <span className="mt-1 block text-xs text-slate-600">
                  Thay dữ liệu đang hiển thị bằng bản Drive. Cả hai phiên bản được giữ trong bản sao lưu xung đột cục bộ.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={isResolving}
              onClick={onChooseLocal}
              className="flex w-full items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            >
              {isResolving ? (
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-amber-800" />
              ) : (
                <Upload className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
              )}
              <span>
                <span className="block text-sm font-bold text-slate-900">Ghi bản trên thiết bị lên Drive</span>
                <span className="mt-1 block text-xs text-slate-700">
                  Chỉ chọn nếu bạn chủ động muốn thay thế dữ liệu đang có trên Drive. Cả hai phiên bản được giữ trong bản sao lưu xung đột cục bộ.
                </span>
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
