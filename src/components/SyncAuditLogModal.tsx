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
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Cloud,
  Laptop,
  Users,
  Database,
  Smartphone,
  Globe,
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
  const [selectedUserFilter, setSelectedUserFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  
  // Master Workspace state info on Firestore
  const [masterState, setMasterState] = useState<MasterSyncState | null>(null);
  const [loadingMasterState, setLoadingMasterState] = useState<boolean>(false);

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
    setLoadingMasterState(true);
    try {
      const res = await getWorkspaceMasterStateFromFirestore();
      if (res) {
        setMasterState(res);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMasterState(false);
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

  // Lấy danh sách email độc nhất để lọc
  const uniqueUsers = useMemo(() => {
    const emails = new Set<string>();
    activeLogs.forEach((l) => {
      if (l.userEmail) emails.add(l.userEmail);
    });
    return Array.from(emails);
  }, [activeLogs]);

  // Bộ lọc danh sách
  const filteredLogs = useMemo(() => {
    return activeLogs.filter((log) => {
      if (selectedUserFilter !== 'all' && log.userEmail !== selectedUserFilter) {
        return false;
      }
      if (selectedStatusFilter !== 'all' && log.status !== selectedStatusFilter) {
        return false;
      }
      return true;
    });
  }, [activeLogs, selectedUserFilter, selectedStatusFilter]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      const text = formatAuditLogsAsText(filteredLogs);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleDownload = async () => {
    const text = formatAuditLogsAsText(filteredLogs);
    const fileName = `nhat_ky_kiem_toan_${activeTab}_${new Date().toISOString().slice(0, 10)}.txt`;

    if (Capacitor.isNativePlatform()) {
      try {
        const writeResult = await Filesystem.writeFile({
          path: fileName,
          data: text,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });

        await Share.share({
          title: 'Tải file Nhật ký kiểm toán',
          text: `Nhật ký kiểm toán hệ thống (${filteredLogs.length} bản ghi)`,
          url: writeResult.uri,
          dialogTitle: 'Lưu hoặc gửi Nhật ký kiểm toán',
        });
      } catch (err: any) {
        console.warn('Lỗi Share trên native di động, thử lưu vào Documents:', err);
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: text,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
          });
          alert(`Đã lưu file "${fileName}" vào thư mục Tài liệu (Documents) của điện thoại!`);
        } catch (saveErr) {
          alert('Không thể lưu hoặc chia sẻ file: ' + (saveErr instanceof Error ? saveErr.message : String(saveErr)));
        }
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
    if (window.confirm('Bạn có chắc chắn muốn xóa lịch sử nhật ký cục bộ trên thiết bị này không? (Nhật ký trên Cloud vẫn được lưu giữ an toàn)')) {
      clearSyncAuditLogs();
      loadLocalLogs();
    }
  };

  const successCount = filteredLogs.filter((l) => l.status === 'success').length;
  const errorCount = filteredLogs.filter((l) => l.status === 'error').length;
  const warnCount = filteredLogs.filter((l) => l.status === 'warning').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                Nhật ký kiểm toán & Giám sát lỗi tập trung
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {filteredLogs.length} bản ghi
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Gom toàn bộ log lỗi & sự kiện đồng bộ từ tất cả máy thành viên về Firestore trung tâm
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector & Cloud Backup Status */}
        <div className="px-5 pt-3 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('cloud')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${
                activeTab === 'cloud'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Cloud className="w-4 h-4" />
              Trung tâm Cloud (Tất cả máy & Thành viên)
              {cloudLogs.length > 0 && (
                <span className="px-1.5 py-0.2 bg-blue-200/60 text-blue-800 rounded-full text-[10px]">
                  {cloudLogs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('local')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${
                activeTab === 'local'
                  ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Laptop className="w-4 h-4" />
              Thiết bị này (Cục bộ)
              {localLogs.length > 0 && (
                <span className="px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded-full text-[10px]">
                  {localLogs.length}
                </span>
              )}
            </button>
          </div>

          {/* Master Workspace Pointer on Firestore */}
          {masterState && masterState.activeFileName && (
            <div className="flex items-center gap-1.5 text-[11px] bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg mb-1">
              <Database className="w-3.5 h-3.5 text-blue-600" />
              <span>
                File liên kết: <strong>{masterState.activeFileName}</strong> ({masterState.status === 'active' ? 'Đang hoạt động' : 'Chưa liên kết'})
              </span>
            </div>
          )}
        </div>

        {/* Action bar & Filter Controls */}
        <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status pills */}
            <button
              onClick={() => setSelectedStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                selectedStatusFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Tất cả ({activeLogs.length})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('error')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                selectedStatusFilter === 'error'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Lỗi ({activeLogs.filter((l) => l.status === 'error').length})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('warning')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                selectedStatusFilter === 'warning'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Cảnh báo ({activeLogs.filter((l) => l.status === 'warning').length})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('success')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors ${
                selectedStatusFilter === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Thành công ({activeLogs.filter((l) => l.status === 'success').length})
            </button>

            {/* Filter by user email if cloud tab */}
            {uniqueUsers.length > 1 && (
              <div className="flex items-center gap-1.5 ml-1">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedUserFilter}
                  onChange={(e) => setSelectedUserFilter(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-700 font-medium text-xs focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">Tất cả thành viên ({uniqueUsers.length})</option>
                  {uniqueUsers.map((email) => (
                    <option key={email} value={email}>
                      {email}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
              title="Sao chép toàn bộ nhật ký"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Đã copy!' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium transition-colors border border-blue-200"
              title="Tải về file text"
            >
              <Download className="w-3.5 h-3.5" />
              Tải .txt
            </button>
            <button
              onClick={() => {
                if (activeTab === 'cloud') loadCloudLogs();
                else loadLocalLogs();
                loadMasterStatus();
              }}
              disabled={isLoadingCloud}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              title="Làm mới danh sách"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingCloud ? 'animate-spin text-blue-600' : ''}`} />
            </button>
            {activeTab === 'local' && localLogs.length > 0 && (
              <button
                onClick={handleClearLocal}
                className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                title="Xóa nhật ký cục bộ trên máy này"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-slate-50/50">
          {isLoadingCloud ? (
            <div className="text-center py-12 text-slate-400">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-blue-500 opacity-80" />
              <p className="font-medium text-slate-600">Đang tải nhật ký kiểm toán từ Firestore trung tâm...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-slate-600">
                {activeTab === 'cloud'
                  ? 'Chưa có nhật ký nào được ghi nhận trên Firestore trung tâm'
                  : 'Chưa có nhật ký cục bộ nào trên thiết bị này'}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Mọi hành động đồng bộ, thao tác sửa/thêm sổ, và bất kỳ lỗi mạng/Google API nào đều sẽ được tự động gửi về Firestore để Admin theo dõi.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isPush = log.type === 'SYNC_PUSH';
              const isPull = log.type === 'SYNC_PULL';

              return (
                <div
                  key={log.id}
                  className={`bg-white rounded-xl border transition-shadow ${
                    log.status === 'error'
                      ? 'border-rose-200 shadow-xs'
                      : log.status === 'warning'
                      ? 'border-amber-200 shadow-xs'
                      : 'border-slate-200 hover:shadow-xs'
                  }`}
                >
                  {/* Log summary row */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-3.5 sm:p-4 cursor-pointer flex items-start justify-between gap-3 select-none"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {log.status === 'error' ? (
                          <div className="p-1.5 rounded-lg bg-rose-100 text-rose-600">
                            <AlertCircle className="w-4 h-4" />
                          </div>
                        ) : log.status === 'warning' ? (
                          <div className="p-1.5 rounded-lg bg-amber-100 text-amber-600">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        ) : isPush ? (
                          <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600">
                            <ArrowUpCircle className="w-4 h-4" />
                          </div>
                        ) : isPull ? (
                          <div className="p-1.5 rounded-lg bg-blue-100 text-blue-600">
                            <ArrowDownCircle className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isPush
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : isPull
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : log.status === 'error'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {log.type}
                          </span>

                          <span className="text-xs font-semibold text-slate-800">
                            {log.title}
                          </span>

                          <span className="text-[11px] text-slate-400">
                            {log.timeStr}
                          </span>
                        </div>

                        {/* Sub metadata: User email, Role, Platform */}
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                          {log.userEmail && (
                            <span className="inline-flex items-center gap-1 font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                              <Users className="w-3 h-3 text-slate-400" />
                              {log.userEmail}
                              {log.currentRole && (
                                <span className="text-[10px] text-blue-600 font-bold ml-0.5">
                                  ({log.currentRole})
                                </span>
                              )}
                            </span>
                          )}

                          {log.platform && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              {log.platform === 'Android' ? (
                                <Smartphone className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Globe className="w-3 h-3 text-blue-600" />
                              )}
                              {log.platform}
                            </span>
                          )}

                          {log.sheetName && (
                            <span className="text-[11px] text-slate-500 truncate max-w-[200px]">
                              File: <strong>{log.sheetName}</strong>
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 mt-1 font-mono">
                          {log.summary}
                        </p>
                      </div>
                    </div>

                    <div className="text-slate-400 hover:text-slate-600">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {/* Expanded Technical Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/60 rounded-b-xl text-xs space-y-2">
                      {log.errorMessage && (
                        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
                          <p className="font-bold mb-0.5">Chi tiết lỗi kỹ thuật:</p>
                          <p className="font-mono whitespace-pre-wrap">{log.errorMessage}</p>
                        </div>
                      )}

                      {log.details && (
                        <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-mono text-[11px] overflow-x-auto max-h-60">
                          <p className="font-bold text-slate-800 font-sans mb-1">Dữ liệu chi tiết sự kiện:</p>
                          <pre>{JSON.stringify(log.details, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
