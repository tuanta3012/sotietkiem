import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronUp,
  Cloud,
  Smartphone,
  Globe,
  Database,
  Check,
} from 'lucide-react';
import {
  getSyncAuditLogs,
  clearSyncAuditLogs,
  formatAuditLogsAsText,
  SyncAuditLogEntry,
} from '../utils/syncAuditLog';
import {
  fetchCentralAuditLogsFromFirestore,
  getWorkspaceMasterStateFromFirestore,
} from '../utils/firebaseFirestoreService';
import { MasterSyncState } from '../types';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

interface SyncAuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail?: string;
  userRole?: string;
}

export const SyncAuditLogModal: React.FC<SyncAuditLogModalProps> = ({
  isOpen,
  onClose,
  currentUserEmail,
  userRole = 'ADMIN',
}) => {
  const [activeTab, setActiveTab] = useState<'cloud' | 'local'>('cloud');
  const [localLogs, setLocalLogs] = useState<SyncAuditLogEntry[]>([]);
  const [cloudLogs, setCloudLogs] = useState<SyncAuditLogEntry[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [masterState, setMasterState] = useState<MasterSyncState | null>(null);

  const loadLocalLogs = () => {
    setLocalLogs(getSyncAuditLogs());
  };

  const loadCloudLogs = async () => {
    setIsLoadingCloud(true);
    try {
      const logs = await fetchCentralAuditLogsFromFirestore(100);
      setCloudLogs(logs);
    } catch (err) {
      console.warn('Lỗi tải log cloud:', err);
    } finally {
      setIsLoadingCloud(false);
    }
  };

  const loadMasterStatus = async () => {
    try {
      const res = await getWorkspaceMasterStateFromFirestore();
      if (res) {
        setMasterState(res);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLocalLogs();
      loadCloudLogs();
      loadMasterStatus();
      setCopied(false);
    }
  }, [isOpen]);

  const activeLogs = activeTab === 'cloud' ? cloudLogs : localLogs;

  const filteredLogs = useMemo(() => {
    return activeLogs.filter((log) => {
      if (selectedStatusFilter === 'all') return true;
      if (selectedStatusFilter === 'error') return log.status === 'error';
      if (selectedStatusFilter === 'warning') return log.status === 'warning';
      if (selectedStatusFilter === 'success') return log.status === 'success';
      return true;
    });
  }, [activeLogs, selectedStatusFilter]);

  if (!isOpen) return null;

  const handleCopyLogs = async () => {
    const text = formatAuditLogsAsText(filteredLogs);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadLogs = async () => {
    const text = formatAuditLogsAsText(filteredLogs);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `nhat_ky_kiem_toan_${dateStr}.txt`;

    if (Capacitor.isNativePlatform()) {
      try {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: text,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });

        await Share.share({
          title: 'Tải file Nhật ký kiểm toán',
          text: `Nhật ký kiểm toán (${filteredLogs.length} bản ghi)`,
          url: savedFile.uri,
          dialogTitle: 'Lưu hoặc gửi Nhật ký kiểm toán',
        });
      } catch (err) {
        console.warn('Native share failed:', err);
      }
    } else {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleClearLocal = () => {
    if (window.confirm('Bạn có chắc muốn xóa lịch sử nhật ký cục bộ trên máy này?')) {
      clearSyncAuditLogs();
      loadLocalLogs();
    }
  };

  const errorCount = activeLogs.filter((l) => l.status === 'error').length;
  const warnCount = activeLogs.filter((l) => l.status === 'warning').length;
  const successCount = activeLogs.filter((l) => l.status === 'success').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden text-slate-800">
        
        {/* Header (Mobile Compact) */}
        <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-600 text-white">
              <FileText className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Nhật ký kiểm toán
              </h2>
              <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-md bg-blue-100 text-blue-800">
                {activeLogs.length}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Tabs & Active File Tag */}
        <div className="p-2.5 bg-white border-b border-slate-100 space-y-2">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setActiveTab('cloud')}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'cloud'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud tập trung</span>
              {cloudLogs.length > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'cloud' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'}`}>
                  {cloudLogs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('local')}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'local'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Thiết bị này</span>
              {localLogs.length > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'local' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'}`}>
                  {localLogs.length}
                </span>
              )}
            </button>
          </div>

          {/* Active File Link (Compact) */}
          {masterState?.activeFileName && (
            <div className="flex items-center justify-between text-[11px] bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg text-slate-700">
              <div className="flex items-center gap-1.5 truncate">
                <Database className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="truncate">File: <strong>{masterState.activeFileName}</strong></span>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded">
                Đang hoạt động
              </span>
            </div>
          )}
        </div>

        {/* Filter Pills & Actions (Mobile Optimized) */}
        <div className="px-2.5 py-2 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-1.5">
          {/* Status Filters */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              onClick={() => setSelectedStatusFilter('all')}
              className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStatusFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              Tất cả ({activeLogs.length})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('error')}
              className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStatusFilter === 'error'
                  ? 'bg-rose-600 text-white'
                  : errorCount > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-white text-slate-500 border border-slate-200'
              }`}
            >
              Lỗi ({errorCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('warning')}
              className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStatusFilter === 'warning'
                  ? 'bg-amber-600 text-white'
                  : warnCount > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-white text-slate-500 border border-slate-200'
              }`}
            >
              Cảnh báo ({warnCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('success')}
              className={`px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStatusFilter === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              Thành công ({successCount})
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyLogs}
              className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center gap-1 shadow-2xs cursor-pointer"
              title="Sao chép toàn bộ"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Đã chép' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownloadLogs}
              className="px-2 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center gap-1 shadow-2xs cursor-pointer"
              title="Tải tệp .txt"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải .txt</span>
            </button>
            <button
              onClick={() => {
                if (activeTab === 'cloud') loadCloudLogs();
                else loadLocalLogs();
              }}
              className="p-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
              title="Làm mới"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCloud ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Logs List Area */}
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 space-y-2 bg-slate-50/50">
          {isLoadingCloud && activeTab === 'cloud' ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-600" />
              <p className="text-xs">Đang tải nhật ký từ Cloud Firestore...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs">Chưa có bản ghi nhật ký kiểm toán nào phù hợp.</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isError = log.status === 'error';
              const isWarning = log.status === 'warning';
              const isSuccess = log.status === 'success';

              // Role tag normalization: tuanta3012@gmail.com is ALWAYS ADMIN
              const cleanEmail = (log.userEmail || '').toLowerCase();
              const displayRole = cleanEmail === 'tuanta3012@gmail.com' ? 'ADMIN' : (log.currentRole?.toUpperCase() || 'ADMIN');

              const cleanTitle = (log.title || '')
                .replace('Đồng bộ dữ liệu từ Google Drive (PULL)', 'Tải từ Google Drive')
                .replace('Đồng bộ dữ liệu lên Google Drive (PUSH)', 'Cập nhật lên Drive');

              const cleanSummary = (log.summary || '')
                .replace(/\(Cột A-M\)/gi, '')
                .replace(/\(N-P\)/gi, '')
                .replace(/\(Q-S\)/gi, '')
                .replace(/\(U-AC\)/gi, '')
                .replace(/\s+/g, ' ')
                .trim();

              return (
                <div
                  key={log.id}
                  className={`bg-white rounded-xl border transition-all shadow-2xs overflow-hidden ${
                    isError
                      ? 'border-rose-300 bg-rose-50/20'
                      : isWarning
                      ? 'border-amber-300 bg-amber-50/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Card Header (Clickable) */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-2.5 sm:p-3 cursor-pointer flex items-start justify-between gap-2"
                  >
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <div className="mt-0.5 shrink-0">
                        {isError ? (
                          <div className="p-1 rounded-md bg-rose-100 text-rose-600">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        ) : isWarning ? (
                          <div className="p-1 rounded-md bg-amber-100 text-amber-600">
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </div>
                        ) : log.type === 'SYNC_PUSH' ? (
                          <div className="p-1 rounded-md bg-emerald-100 text-emerald-600">
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="p-1 rounded-md bg-blue-100 text-blue-600">
                            <ArrowDownCircle className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Tags & Title row */}
                        <div className="flex items-center justify-between gap-1 text-[10.5px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9.5px] font-extrabold uppercase shrink-0 ${
                                log.type === 'SYNC_PUSH'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : log.type === 'SYNC_PULL'
                                  ? 'bg-blue-100 text-blue-800'
                                  : log.type === 'SYNC_ERROR' || log.type === 'ERROR'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {log.type}
                            </span>

                            <span className="font-bold text-slate-900 text-xs truncate">
                              {cleanTitle}
                            </span>
                          </div>

                          <span className="text-[10px] text-slate-500 shrink-0 font-medium">
                            {log.timeStr}
                          </span>
                        </div>

                        {/* Clean Summary (no overflow) */}
                        <p className="text-[11.5px] text-slate-700 leading-snug font-medium break-words">
                          {cleanSummary}
                        </p>

                        {/* Meta badge line */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10.5px] text-slate-500 font-medium">
                          {log.userEmail && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <span>{log.userEmail}</span>
                              <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${displayRole === 'ADMIN' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                                {displayRole}
                              </span>
                            </span>
                          )}

                          {log.platform && (
                            <span className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                              {log.platform.includes('Android') ? (
                                <Smartphone className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Globe className="w-3 h-3 text-blue-600" />
                              )}
                              <span>{log.platform}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-slate-400 pt-1">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-100 bg-slate-50/80 space-y-2 text-xs">
                      {log.errorMessage && (
                        <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-mono text-[11px] break-all">
                          <strong>Mã lỗi:</strong> {log.errorMessage}
                        </div>
                      )}

                      {log.sheetName && (
                        <div className="text-slate-600 text-[11px]">
                          <strong>File / Sheet:</strong> {log.sheetName} {log.fileId && `(ID: ${log.fileId})`}
                        </div>
                      )}

                      {log.details && (
                        <div className="space-y-1.5">
                          <span className="font-bold text-slate-700 text-[11px]">
                            Chi tiết dữ liệu (Cột A - AC):
                          </span>
                          <pre className="p-2 bg-slate-900 text-slate-100 rounded-lg text-[10.5px] font-mono overflow-x-auto max-h-60 leading-relaxed">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer (Clear local logs if on local tab) */}
        {activeTab === 'local' && localLogs.length > 0 && (
          <div className="p-2 bg-slate-50 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleClearLocal}
              className="text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded-md flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Xóa nhật ký cục bộ</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
