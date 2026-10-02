import React, { useState } from 'react';
import { ArrowUpCircle, X, Download, Calendar, CheckCircle2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';

export interface AppUpdateInfo {
  version: string;
  downloadUrl?: string;
  apkUrl?: string;
  changelog: string[];
  releaseDate?: string;
}

export interface AppUpdateModalProps {
  isOpen: boolean;
  currentVersion: string;
  updateInfo: AppUpdateInfo | null;
  onClose: () => void;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({
  isOpen,
  currentVersion,
  updateInfo,
  onClose,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !updateInfo) return null;

  const targetLink = updateInfo.apkUrl || updateInfo.downloadUrl || '';

  const handleUpdate = async () => {
    if (!targetLink) return;

    setIsDownloading(true);
    setErrorMessage(null);
    setDownloadProgress(10);
    setStatusMessage('Đang khởi tạo kết nối tải APK...');

    try {
      if (Capacitor.isNativePlatform()) {
        const fileName = `app_update_v${updateInfo.version}.apk`;
        setStatusMessage('Đang tải tệp APK trực tiếp về bộ nhớ máy...');
        setDownloadProgress(25);

        let savedUri = '';
        let currentProgress = 25;
        let progressInterval: any = null;
        let progressListener: any = null;

        // 1. Thêm xử lý giải mã URL chuyển hướng (HEAD request) của GitHub Releases nếu có
        let directUrl = targetLink;
        try {
          const headRes = await fetch(targetLink, { method: 'HEAD', redirect: 'follow' });
          if (headRes.url && headRes.url.includes('objects.githubusercontent.com')) {
            directUrl = headRes.url;
          }
        } catch (e) {
          console.warn('Lỗi phân tích redirect URL:', e);
        }

        try {
          // A. Chạy tiến trình giả lập tăng mượt mà (Ease-out curve tiến dần về 85%)
          progressInterval = setInterval(() => {
            if (currentProgress < 85) {
              const increment = Math.max(0.1, (85 - currentProgress) * 0.04);
              currentProgress += increment;
              setDownloadProgress(Math.round(currentProgress));
            }
          }, 120);

          // B. Lắng nghe tiến trình download thực từ plugin Filesystem của Capacitor
          try {
            progressListener = await Filesystem.addListener('progress', (progress) => {
              if (progress && typeof progress.bytes === 'number' && typeof progress.contentLength === 'number' && progress.contentLength > 0) {
                const percent = Math.round((progress.bytes / progress.contentLength) * 100);
                const mappedPercent = 25 + Math.round(percent * 0.6); // Ánh xạ 0-100% về dải 25-85%
                if (mappedPercent > currentProgress) {
                  currentProgress = mappedPercent;
                  setDownloadProgress(Math.round(currentProgress));
                }
              }
            });
          } catch (listenerErr) {
            console.warn('Không thể đăng ký native progress listener:', listenerErr);
          }

          // C. Tải file bằng native downloadFile của Capacitor Filesystem
          const downloadRes = await Filesystem.downloadFile({
            url: directUrl,
            path: fileName,
            directory: Directory.Cache,
            progress: true,
          });
          savedUri = (downloadRes as any).uri || downloadRes.path || '';
        } catch (downloadErr) {
          console.warn('Filesystem.downloadFile thất bại, chuyển sang phương án tải Blob:', downloadErr);
          currentProgress = 40;
          setDownloadProgress(40);
          
          const response = await fetch(directUrl, { redirect: 'follow' });
          if (!response.ok) throw new Error('Không thể tải file APK từ máy chủ.');
          const blob = await response.blob();
          
          currentProgress = 70;
          setDownloadProgress(70);
          setStatusMessage('Đang xử lý gói cài đặt Android...');

          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve, reject) => {
            reader.onloadend = () => {
              const base64data = (reader.result as string).split(',')[1];
              resolve(base64data);
            };
            reader.onerror = reject;
          });
          reader.readAsDataURL(blob);
          const base64Data = await base64Promise;

          const writeRes = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache,
          });
          savedUri = writeRes.uri;
        } finally {
          if (progressInterval) clearInterval(progressInterval);
          if (progressListener && typeof progressListener.remove === 'function') {
            try {
              await progressListener.remove();
            } catch {}
          }
        }

        setDownloadProgress(95);
        setStatusMessage('Đã tải xong APK! Đang mở trình cài đặt Android...');

        let resolvedPath = savedUri;
        try {
          const uriRes = await Filesystem.getUri({
            directory: Directory.Cache,
            path: fileName,
          });
          if (uriRes?.uri) resolvedPath = uriRes.uri;
        } catch (e) {
          console.warn('Lỗi lấy getUri:', e);
        }

        await new Promise((resolve) => setTimeout(resolve, 600));
        setDownloadProgress(100);

        // Kích hoạt Trình Cài đặt Android và các cơ chế Fallback đa tầng hoạt động mượt mà
        try {
          await FileOpener.open({
            filePath: resolvedPath,
            contentType: 'application/vnd.android.package-archive',
          });
          setIsDownloading(false);
          onClose();
        } catch (openErr: any) {
          console.warn('FileOpener trực tiếp thất bại, chuyển sang Share để cài đặt an toàn:', openErr);
          try {
            // Fallback 1: Chia sẻ file trực tiếp (Giúp Android tự cấp quyền đọc ghi tạm thời và hiển thị bộ chọn)
            await Share.share({
              title: 'Cài đặt bản cập nhật APK',
              url: resolvedPath,
              dialogTitle: 'Chọn Trình cài đặt gói để cập nhật',
            });
            setIsDownloading(false);
            onClose();
          } catch (shareErr) {
            console.warn('Share.share thất bại, fallback sang Browser:', shareErr);
            // Fallback 2: Mở trình duyệt tải trực tiếp
            setStatusMessage('Mở trình duyệt để tải về trực tiếp...');
            window.open(targetLink, '_system') || window.open(targetLink, '_blank');
            setIsDownloading(false);
            onClose();
          }
        }
      } else {
        // Nền tảng Web / Trình duyệt: Tải qua Tab mới
        setStatusMessage('Đang mở liên kết tải về trên trình duyệt...');
        setDownloadProgress(100);
        window.open(targetLink, '_blank');
        setTimeout(() => {
          setIsDownloading(false);
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      console.error('Lỗi quy trình cập nhật APK:', err);
      setIsDownloading(false);
      setErrorMessage(err?.message || 'Gặp sự cố khi cài đặt tự động. Vui lòng thử lại.');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity" 
        onClick={!isDownloading ? onClose : undefined}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md transform overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl transition-all p-5 text-slate-100 flex flex-col space-y-4 animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header decoration */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 via-emerald-500 to-blue-500" />

        {/* Close Button */}
        {!isDownloading && (
          <button
            onClick={onClose}
            className="absolute top-3.5 right-3.5 text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Icon & Title */}
        <div className="flex flex-col items-center text-center space-y-1.5 pt-1">
          <div className={`p-3 rounded-full border shadow-inner ${
            errorMessage
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            {isDownloading ? (
              <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
            ) : errorMessage ? (
              <AlertCircle className="w-9 h-9 text-rose-400" />
            ) : (
              <ArrowUpCircle className="w-9 h-9 text-emerald-400 animate-bounce" />
            )}
          </div>
          <h2 className="text-base font-extrabold tracking-tight text-white px-2">
            {isDownloading
              ? `Đang tải bản cập nhật v${updateInfo.version}...`
              : errorMessage
              ? 'Chưa thể cài đặt bản cập nhật'
              : `Bản Cập Nhật Mới v${updateInfo.version}`}
          </h2>
          <p className="text-xs text-slate-400 px-2">
            {isDownloading
              ? statusMessage
              : errorMessage
              ? errorMessage
              : 'Ứng dụng đã có phiên bản nâng cấp với các cải tiến mới!'}
          </p>
        </div>

        {/* TRẠNG THÁI: ĐANG TẢI */}
        {isDownloading && (
          <div className="space-y-3 py-2">
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
              <div 
                className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400 font-medium">
              <span className="truncate pr-2">{statusMessage}</span>
              <span className="text-emerald-400 font-bold shrink-0">{downloadProgress}%</span>
            </div>
            <div className="text-center pt-2 border-t border-slate-800/60">
              <button
                type="button"
                onClick={() => {
                  if (targetLink) window.open(targetLink, '_system') || window.open(targetLink, '_blank');
                }}
                className="text-xs text-teal-400 underline hover:text-teal-300 transition-colors font-medium cursor-pointer"
              >
                Mở tải về trực tiếp bằng Trình duyệt
              </button>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI: LỖI TẢI XUỐNG */}
        {errorMessage && !isDownloading && (
          <div className="space-y-3 py-1">
            <div className="p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs space-y-1 text-rose-300">
              <p className="font-bold">⚠️ Có lỗi khi cài đặt</p>
              <p className="text-[11px] text-rose-400">{errorMessage}</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (targetLink) window.open(targetLink, '_system') || window.open(targetLink, '_blank');
                  onClose();
                }}
                className="flex-1 py-2.5 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold text-xs transition-all cursor-pointer"
              >
                Tải Trình Duyệt
              </button>
              <button
                type="button"
                onClick={handleUpdate}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Thử tải lại</span>
              </button>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI: BAN ĐẦU (CHƯA TẢI) */}
        {!isDownloading && !errorMessage && (
          <>
            {/* Version Badge Box */}
            <div className="grid grid-cols-2 gap-2.5 bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80 text-center">
              <div>
                <span className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider">Hiện tại</span>
                <span className="text-xs font-semibold text-slate-300">v{currentVersion}</span>
              </div>
              <div className="border-l border-slate-800">
                <span className="block text-[10px] text-emerald-500 uppercase font-bold tracking-wider">Mới nhất</span>
                <span className="text-xs font-extrabold text-emerald-400">v{updateInfo.version}</span>
              </div>
            </div>

            {/* Changelog Section */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300 border-b border-slate-800 pb-1">
                <span>Nội dung cập nhật:</span>
                {updateInfo.releaseDate && (
                  <span className="flex items-center space-x-1 text-[10px] text-slate-500">
                    <Calendar className="w-3 h-3" />
                    <span>{updateInfo.releaseDate}</span>
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 text-slate-300 text-xs">
                {updateInfo.changelog && updateInfo.changelog.length > 0 ? (
                  updateInfo.changelog.map((item, idx) => (
                    <li key={idx} className="flex items-start space-x-2 text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500 italic text-center py-2">Nâng cấp hiệu năng và cải tiến trải nghiệm.</li>
                )}
              </ul>
            </div>

            {/* Footer Actions */}
            <div className="flex space-x-2.5 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-100 font-bold text-xs transition-all cursor-pointer"
              >
                Để sau
              </button>
              <button
                onClick={handleUpdate}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-500/10 transition-all active:scale-[0.98] cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Cập nhật ngay</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
