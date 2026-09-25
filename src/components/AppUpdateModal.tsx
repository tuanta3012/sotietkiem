import React from 'react';
import { ArrowUpCircle, X, Download, Calendar, CheckCircle2 } from 'lucide-react';

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
  if (!isOpen || !updateInfo) return null;

  const handleUpdate = () => {
    const targetLink = updateInfo.apkUrl || updateInfo.downloadUrl;
    if (targetLink) {
      window.open(targetLink, '_system');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md transform overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl transition-all p-6 text-slate-100 flex flex-col space-y-5 animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header decoration */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 via-emerald-500 to-blue-500" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          title="Bỏ qua"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon & Title */}
        <div className="flex flex-col items-center text-center space-y-2 pt-2">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 shadow-inner">
            <ArrowUpCircle className="w-10 h-10 animate-bounce" />
          </div>
          <h2 className="text-lg font-extrabold tracking-tight text-white px-2">
            Đã có bản cập nhật mới (v{updateInfo.version})!
          </h2>
          <p className="text-xs text-slate-400 px-4">
            Bạn có muốn tải về để vá lỗi và trải nghiệm tính năng tốt nhất không?
          </p>
        </div>

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
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-500/10 transition-all active:scale-[0.98]"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Cập nhật ngay</span>
          </button>
        </div>
      </div>
    </div>
  );
};
