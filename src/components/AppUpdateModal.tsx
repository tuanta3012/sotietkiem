import React, { useState } from 'react';
import { ArrowUpCircle, X, Download, Calendar, CheckCircle2, Loader2, AlertCircle, ExternalLink, Play, Sparkles } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';

interface UpdateInfo {
  version: string;
  downloadUrl?: string;
  apkUrl?: string;
  changelog: string[];
  releaseDate?: string;
}

interface AppUpdateModalProps {
  isOpen: boolean;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
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

  const openExternalUrl = async (url: string) => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url });
      } else {
        window.open(url, '_blank');
      }
    } catch {
      window.open(url, '_blank');
    }
  };

  // Kích hoạt Trình Cài Đặt Gói APK của Android
  const triggerPackageInstall = async (fileUriOrPath: string) => {
    try {
      let targetPath = fileUriOrPath;

      // Đảm bảo lấy đúng file URI từ Filesystem
      if (!targetPath.startsWith('file://') && !targetPath.startsWith('content://')) {
        try {
          const uriRes = await Filesystem.getUri({
            path: `sotietkiem_v${updateInfo.version}.apk`,
            directory: Directory.Cache,
          });
          if (uriRes?.uri) {
            targetPath = uriRes.uri;
          }
        } catch {}
      }

      await FileOpener.open({
        filePath: targetPath,
        contentType: 'application/vnd.android.package-archive',
      });
    } catch (fileOpenerErr: any) {
      console.warn('FileOpener trigger error:', fileOpenerErr);
      
      // Fallback 1: Thử chia sẻ file qua Share Intent
      try {
        const shareUri = fileUriOrPath.startsWith('file://') || fileUriOrPath.startsWith('content://')
          ? fileUriOrPath
          : `file://${fileUriOrPath.startsWith('/') ? '' : '/'}${fileUriOrPath}`;

        await Share.share({
          title: `Cập nhật Sổ tiết kiệm v${updateInfo.version}`,
          url: shareUri,
          dialogTitle: 'Chọn Trình Cài Đặt Gói (Package Installer)',
        });
      } catch (shareErr) {
        console.warn('Share intent error:', shareErr);
        if (targetLink) {
          await openExternalUrl(targetLink);
        }
      }
    }
  };

  const handleUpdate = async () => {
    if (!targetLink) return;

    setIsDownloading(true);
    setErrorMessage(null);
    setDownloadProgress(10);
    setStatusMessage('Đang kết nối đến máy chủ...');

    try {
      if (Capacitor.isNativePlatform()) {
        const fileName = `sotietkiem_v${updateInfo.version}.apk`;
        let savedUri = '';

        setStatusMessage('Đang tải tệp APK...');
        setDownloadProgress(35);

        const progressInterval = setInterval(() => {
          setDownloadProgress((prev) => {
            if (prev >= 90) {
              clearInterval(progressInterval);
              return 90;
            }
            return prev + 15;
          });
        }, 350);

        try {
          const downloadRes = await Filesystem.downloadFile({
            url: targetLink,
            path: fileName,
            directory: Directory.Cache,
          });
          clearInterval(progressInterval);
          savedUri = (downloadRes as any)?.uri || downloadRes?.path || '';

          if (!savedUri) {
            const uriRes = await Filesystem.getUri({
              path: fileName,
              directory: Directory.Cache,
            });
            savedUri = uriRes.uri;
          }
        } catch (downloadErr: any) {
          clearInterval(progressInterval);
          throw downloadErr;
        }

        setDownloadProgress(100);
        setStatusMessage('Tải xong! Đang tự động mở Trình Cài Đặt Android...');

        // Kích hoạt Trình Cài Đặt Android ngay lập tức
        await triggerPackageInstall(savedUri);

        // Đóng modal ứng dụng ngay lập tức để chuyển hoàn toàn sang giao diện Cài Đặt của Android
        setIsDownloading(false);
        onClose();
      } else {
        // Môi trường Web browser
        setDownloadProgress(100);
        await openExternalUrl(targetLink);
        setIsDownloading(false);
        onClose();
      }
    } catch (err: any) {
      console.error('Update download error:', err);
      setIsDownloading(false);
      setErrorMessage(err?.message || 'Không thể tải tệp APK tự động. Bạn có thể mở tải bằng Trình duyệt.');
    }
  };

  const handleOpenBrowserDownload = async () => {
    if (targetLink) {
      await openExternalUrl(targetLink);
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
              ? 'Chưa thể tải bản cập nhật'
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
            <div className="text-center pt-1 border-t border-slate-800/60">
              <button
                type="button"
                onClick={handleOpenBrowserDownload}
                className="inline-flex items-center space-x-1 text-xs text-teal-400 underline hover:text-teal-300 transition-colors font-medium cursor-pointer"
              >
                <span>Mở tải về trực tiếp bằng Trình duyệt</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI: LỖI TẢI XUỐNG */}
        {errorMessage && !isDownloading && (
          <div className="space-y-3 py-1">
            <div className="p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs space-y-1 text-rose-300">
              <p className="font-bold">⚠️ Có lỗi khi tải tệp cài đặt</p>
              <p className="text-[11px] text-rose-400">{errorMessage}</p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenBrowserDownload}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Mở Trình duyệt tải APK</span>
              </button>

              <button
                type="button"
                onClick={handleUpdate}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors cursor-pointer"
              >
                Thử tải lại trong ứng dụng
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
