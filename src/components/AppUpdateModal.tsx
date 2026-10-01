import React, { useState } from 'react';
import { ArrowUpCircle, X, Download, Calendar, CheckCircle2, Loader2, AlertCircle, ExternalLink, Play } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';

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
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [downloadedFilePath, setDownloadedFilePath] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !updateInfo) return null;

  const targetLink = updateInfo.apkUrl || updateInfo.downloadUrl || '';

  const triggerPackageInstall = async (fileUriOrPath: string) => {
    try {
      setStatusMessage('Đang kích hoạt Trình Cài Đặt Android...');
      let targetPath = fileUriOrPath;

      // Đảm bảo lấy đúng URI hệ thống từ Filesystem nếu có
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
      setStatusMessage('Đang hiển thị màn hình cài đặt nâng cấp hệ thống...');
    } catch (fileOpenerErr: any) {
      console.warn('FileOpener trigger:', fileOpenerErr);
      try {
        const shareUri = fileUriOrPath.startsWith('file://') || fileUriOrPath.startsWith('content://')
          ? fileUriOrPath
          : `file://${fileUriOrPath.startsWith('/') ? '' : '/'}${fileUriOrPath}`;

        await Share.share({
          title: `Cập nhật Tiết Kiệm Gia Đình v${updateInfo.version}`,
          url: shareUri,
          dialogTitle: 'Chọn Trình Cài Đặt Gói (Package Installer) để nâng cấp',
        });
      } catch (shareErr) {
        console.warn('Share intent error:', shareErr);
        if (targetLink) {
          window.open(targetLink, '_system') || window.open(targetLink, '_blank');
        }
      }
    }
  };

  const handleUpdate = async () => {
    if (!targetLink) return;

    setIsDownloading(true);
    setIsReadyToInstall(false);
    setErrorMessage(null);
    setDownloadProgress(5);
    setStatusMessage('Đang kết nối đến máy chủ...');

    try {
      if (Capacitor.isNativePlatform()) {
        const fileName = `sotietkiem_v${updateInfo.version}.apk`;
        let savedUri = '';

        // Phương án 1: Tải với fetch + ReadableStream để đo phần trăm tải thực tế chính xác 100%
        try {
          setStatusMessage('Đang tải tệp APK...');
          const response = await fetch(targetLink, { redirect: 'follow' });
          if (!response.ok) throw new Error(`Máy chủ trả về mã lỗi: ${response.status}`);

          const contentLength = response.headers.get('content-length');
          const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

          if (response.body && totalBytes > 0) {
            const reader = response.body.getReader();
            let receivedBytes = 0;
            const chunks: Uint8Array[] = [];

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                receivedBytes += value.length;
                const percent = Math.min(95, Math.round((receivedBytes / totalBytes) * 95));
                setDownloadProgress(percent);
                const receivedMB = (receivedBytes / (1024 * 1024)).toFixed(1);
                const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                setStatusMessage(`Đang tải tệp APK: ${receivedMB} MB / ${totalMB} MB (${percent}%)`);
              }
            }

            // Gộp các chunks thành Uint8Array
            const fullBuffer = new Uint8Array(receivedBytes);
            let position = 0;
            for (const chunk of chunks) {
              fullBuffer.set(chunk, position);
              position += chunk.length;
            }

            setStatusMessage('Đang lưu tệp cài đặt vào bộ nhớ...');
            setDownloadProgress(96);

            // Chuyển đổi sang base64 theo từng phần an toàn không tràn bộ nhớ
            let binary = '';
            const len = fullBuffer.byteLength;
            const chunkSize = 8192;
            for (let i = 0; i < len; i += chunkSize) {
              const sub = fullBuffer.subarray(i, Math.min(i + chunkSize, len));
              binary += String.fromCharCode.apply(null, sub as any);
            }
            const base64Data = btoa(binary);

            const writeRes = await Filesystem.writeFile({
              path: fileName,
              data: base64Data,
              directory: Directory.Cache,
            });

            savedUri = writeRes.uri;
          } else {
            // Fallback nếu không có stream hoặc content-length
            setStatusMessage('Đang tải trực tiếp tệp cài đặt...');
            const downloadRes = await Filesystem.downloadFile({
              url: targetLink,
              path: fileName,
              directory: Directory.Cache,
            });
            savedUri = (downloadRes as any).uri || downloadRes.path || '';
          }
        } catch (streamErr) {
          console.warn('Stream download fallback to direct downloadFile:', streamErr);
          setStatusMessage('Đang tải tệp APK...');
          const downloadRes = await Filesystem.downloadFile({
            url: targetLink,
            path: fileName,
            directory: Directory.Cache,
          });
          savedUri = (downloadRes as any).uri || downloadRes.path || '';
        }

        // Tải hoàn tất
        setDownloadProgress(100);
        setDownloadedFilePath(savedUri);
        setIsDownloading(false);
        setIsReadyToInstall(true);
        setStatusMessage('Đã tải xong APK! Sẵn sàng nâng cấp.');

        // Tự động kích hoạt màn hình cài đặt Android
        await triggerPackageInstall(savedUri);
      } else {
        // Môi trường Web browser
        setDownloadProgress(100);
        window.open(targetLink, '_system') || window.open(targetLink, '_blank');
        setIsDownloading(false);
        onClose();
      }
    } catch (err: any) {
      console.error('Update download error:', err);
      setIsDownloading(false);
      setErrorMessage(err?.message || 'Không thể tải tệp APK tự động. Bạn có thể mở tải bằng Trình duyệt.');
    }
  };

  const handleOpenBrowserDownload = () => {
    if (targetLink) {
      window.open(targetLink, '_system') || window.open(targetLink, '_blank');
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
      <div className="relative w-full max-w-md transform overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl transition-all p-6 text-slate-100 flex flex-col space-y-5 animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header decoration */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 via-emerald-500 to-blue-500" />

        {/* Close Button */}
        {!isDownloading && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Icon & Title */}
        <div className="flex flex-col items-center text-center space-y-2 pt-2">
          <div className={`p-3 rounded-full border shadow-inner ${
            isReadyToInstall
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : errorMessage
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            {isDownloading ? (
              <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />
            ) : isReadyToInstall ? (
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            ) : errorMessage ? (
              <AlertCircle className="w-10 h-10 text-rose-400" />
            ) : (
              <ArrowUpCircle className="w-10 h-10 animate-bounce" />
            )}
          </div>
          <h2 className="text-lg font-extrabold tracking-tight text-white px-2">
            {isDownloading
              ? `Đang tải v${updateInfo.version}...`
              : isReadyToInstall
              ? `Đã tải xong v${updateInfo.version}!`
              : errorMessage
              ? 'Tải bản cập nhật chưa hoàn tất'
              : `Đã có bản cập nhật mới (v${updateInfo.version})!`}
          </h2>
          <p className="text-xs text-slate-400 px-2">
            {isDownloading
              ? statusMessage
              : isReadyToInstall
              ? 'Bấm nút Cài Đặt Nâng Cấp bên dưới để hoàn tất cập nhật ứng dụng.'
              : errorMessage
              ? errorMessage
              : 'Bạn có muốn tải về để vá lỗi và trải nghiệm tính năng tốt nhất không?'}
          </p>
        </div>

        {/* TRẠNG THÁI 1: ĐANG TẢI */}
        {isDownloading && (
          <div className="space-y-3 py-3">
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
              <div 
                className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full rounded-full transition-all duration-200"
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
                onClick={handleOpenBrowserDownload}
                className="inline-flex items-center space-x-1 text-xs text-teal-400 underline hover:text-teal-300 transition-colors font-medium"
              >
                <span>Mở tải về trực tiếp bằng Trình duyệt</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI 2: ĐÃ TẢI XONG - SẴN SÀNG CÀI ĐẶT */}
        {isReadyToInstall && !isDownloading && (
          <div className="space-y-4 py-1">
            <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs space-y-2 text-slate-300">
              <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Tệp cài đặt APK đã sẵn sàng</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Nếu hệ thống Android hiện thông báo <em>&quot;Cho phép cài đặt ứng dụng từ nguồn này&quot;</em>, vui lòng bật <strong>Cho phép</strong> rồi bấm nút Cài đặt.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => triggerPackageInstall(downloadedFilePath)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>🚀 Cài Đặt Nâng Cấp Ngay</span>
              </button>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleOpenBrowserDownload}
                  className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tải lại qua Browser</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2 px-4 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 font-semibold text-xs transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI 3: LỖI TẢI XUỐNG */}
        {errorMessage && !isDownloading && !isReadyToInstall && (
          <div className="space-y-4 py-1">
            <div className="p-3 bg-rose-950/40 border border-rose-500/30 rounded-xl text-xs space-y-1 text-rose-300">
              <p className="font-bold">⚠️ Có lỗi trong quá trình tải trực tiếp</p>
              <p className="text-[11px] text-rose-400">{errorMessage}</p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleOpenBrowserDownload}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-2 shadow-lg active:scale-[0.98] transition-all cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Mở Trình duyệt tải APK về máy</span>
              </button>

              <button
                type="button"
                onClick={handleUpdate}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors"
              >
                Thử tải lại trong ứng dụng
              </button>
            </div>
          </div>
        )}

        {/* TRẠNG THÁI 4: BAN ĐẦU (CHƯA TẢI) */}
        {!isDownloading && !isReadyToInstall && !errorMessage && (
          <>
            {/* Version Badge Box */}
            <div className="grid grid-cols-2 gap-3 bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 text-center">
              <div>
                <span className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider">Phiên bản hiện tại</span>
                <span className="text-sm font-semibold text-slate-300">v{currentVersion}</span>
              </div>
              <div className="border-l border-slate-800">
                <span className="block text-[10px] text-emerald-500 uppercase font-bold tracking-wider">Phiên bản mới nhất</span>
                <span className="text-sm font-extrabold text-emerald-400">v{updateInfo.version}</span>
              </div>
            </div>

            {/* Changelog Section */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300 border-b border-slate-800 pb-1">
                <span>Danh sách thay đổi &amp; sửa lỗi:</span>
                {updateInfo.releaseDate && (
                  <span className="flex items-center space-x-1 text-[10px] text-slate-500">
                    <Calendar className="w-3 h-3" />
                    <span>{updateInfo.releaseDate}</span>
                  </span>
                )}
              </div>
              <ul className="space-y-2 text-slate-300 text-xs">
                {updateInfo.changelog && updateInfo.changelog.length > 0 ? (
                  updateInfo.changelog.map((item, idx) => (
                    <li key={idx} className="flex items-start space-x-2 text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500 italic text-center py-2">Nâng cấp hiệu năng và sửa lỗi hệ thống.</li>
                )}
              </ul>
            </div>

            {/* Footer Actions */}
            <div className="flex space-x-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-100 font-bold text-xs transition-all"
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
