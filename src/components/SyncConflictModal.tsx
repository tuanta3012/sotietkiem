import React, { useEffect, useState } from 'react';
import { AlertTriangle, CloudDownload, Loader2, Upload, GitMerge } from 'lucide-react';
import { SyncConflictState } from '../hooks/useDriveSync';

interface SyncConflictModalProps {
  conflict: SyncConflictState | null;
  isResolving: boolean;
  status: string | null;
  onChooseRemote: () => void;
  onChooseLocal: () => void;
  onChooseMerge?: (choices: Record<string, 'local' | 'remote'>) => void;
}

export function SyncConflictModal({
  conflict,
  isResolving,
  status,
  onChooseRemote,
  onChooseLocal,
  onChooseMerge,
}: SyncConflictModalProps) {
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'local' | 'remote'>>({});

  useEffect(() => {
    setConflictChoices({});
  }, [conflict]);

  if (!conflict) return null;
  const bookConflicts = conflict.bookConflicts || [];
  const missingChoices = bookConflicts.some((item) => !conflictChoices[item.identityKey]);
  const fieldLabels: Record<string, string> = {
    principal: 'Gốc',
    interestRate: 'Lãi suất',
    termMonths: 'Kỳ hạn',
    owner: 'Chủ sổ',
    depositType: 'Hình thức',
    startDate: 'Ngày gửi',
    maturityDate: 'Ngày đáo hạn',
    deletedOnDrive: 'Đã xóa trên Drive',
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-2.5 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-amber-200 bg-white shadow-2xl overscroll-contain"
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-amber-100 bg-amber-50/95 px-3.5 py-2.5 backdrop-blur">
          <div className="shrink-0 rounded-lg bg-amber-100 p-1.5 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="sync-conflict-title" className="text-sm font-black leading-tight text-slate-900">
              Cần xử lý xung đột
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {conflict.fileName} · {bookConflicts.length} sổ cần chọn
            </p>
          </div>
        </header>

        <div className="space-y-2.5 p-3">
          {bookConflicts.length > 0 && (
            <p className="text-xs text-slate-600">
              Chọn bản giữ cho từng sổ, sau đó hợp nhất.
            </p>
          )}

          {bookConflicts.length > 0 && (
            <div className="max-h-[32dvh] space-y-1.5 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/60 p-2">
              {bookConflicts.map((item) => (
                <fieldset key={item.identityKey} className="rounded-lg border border-amber-100 bg-white p-2">
                  <legend className="max-w-full truncate px-1 text-xs font-semibold text-slate-800">
                    {item.bookCode || item.localBook.bankId.toUpperCase()}
                  </legend>
                  <p className="mb-1 px-1 text-[10px] text-slate-500">
                    {item.changedFields.map((field) => fieldLabels[field] || field).join(' · ')}
                  </p>
                  {(['local', 'remote'] as const).map((source) => {
                    const selectedBook = source === 'local' ? item.localBook : item.remoteBook;
                    return (
                      <label key={source} className="flex min-h-9 cursor-pointer items-center gap-2 px-1 text-xs text-slate-700">
                        <input
                          type="radio"
                          name={`conflict-${item.identityKey}`}
                          className="h-4 w-4 shrink-0 accent-indigo-600"
                          checked={conflictChoices[item.identityKey] === source}
                          onChange={() => setConflictChoices((previous) => ({
                            ...previous,
                            [item.identityKey]: source,
                          }))}
                        />
                        <span className="min-w-0 truncate">
                          {source === 'local' ? 'Máy' : 'Drive'} ·{' '}
                          {selectedBook
                            ? `${selectedBook.principal.toLocaleString('vi-VN')} · ${selectedBook.interestRate}%`
                            : 'Đã xóa'}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          )}

          {status && (status.includes('❌') || status.includes('⚠️')) && (
            <p role="alert" className="max-h-16 overflow-y-auto rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
              {status}
            </p>
          )}

          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            {onChooseMerge && (
              <button
                type="button"
                disabled={isResolving || missingChoices}
                onClick={() => onChooseMerge(conflictChoices)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
              >
                {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                <span>Hợp nhất dữ liệu</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isResolving}
                onClick={onChooseRemote}
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-50"
              >
                <CloudDownload className="h-3.5 w-3.5" />
                Dùng bản Drive
              </button>
              <button
                type="button"
                disabled={isResolving}
                onClick={onChooseLocal}
                className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {isResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Dùng bản máy
              </button>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
