import React, { useState, useEffect } from 'react';
import {
  PiggyBank,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  HardDrive,
  ShieldCheck,
  ExternalLink,
  Info,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { signInWithGoogle, signInWithGoogleRedirect } from '../utils/googleDriveService';
import { AuthUser } from '../types';

interface LoginModalProps {
  isOpen: boolean;
  onLogin: (user: AuthUser, accessToken?: string) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onLogin }) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showShaHelp, setShowShaHelp] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isNative = Capacitor.isNativePlatform();

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const { user, accessToken } = await signInWithGoogle();
      const email = user.email || '';
      const cleanEmail = email.trim().toLowerCase();

      const role: 'admin' | 'viewer' = 'admin';
      const title = 'Quản trị viên (Admin) - Toàn quyền quản lý & Đồng bộ Google Drive';
      const name = user.displayName || 'Chủ Tài Khoản';

      const authUser: AuthUser = {
        email: cleanEmail,
        name,
        photoURL: user.photoURL || undefined,
        role,
        title,
        isOffline: false,
      };

      onLogin(authUser, accessToken);
    } catch (err: any) {
      console.warn('Google Login notice:', err?.message || err);
      setErrorMessage(
        err?.message || 'Đăng nhập Google thất bại hoặc cửa sổ bị đóng. Vui lòng thử lại.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleRedirectSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await signInWithGoogleRedirect();
    } catch (err: any) {
      console.error('Redirect sign in error:', err);
      setErrorMessage(err?.message || 'Không thể kết nối trang đăng nhập Google.');
      setIsLoading(false);
    }
  };

  const handleOpenInNewTab = () => {
    const webUrl = isNative 
      ? 'https://ais-pre-ue6i2njozapz2wlld2tvs2-546075383474.asia-southeast1.run.app'
      : window.location.href;
    window.open(webUrl, '_blank');
  };

  const handleUseOffline = () => {
    const offlineUser: AuthUser = {
      email: 'offline_user@local',
      name: 'Chủ sổ (Offline)',
      role: 'admin',
      title: 'Chế độ Ngoại tuyến (Offline) - Toàn quyền quản lý & Lưu trữ thiết bị',
      isOffline: true,
    };
    onLogin(offlineUser);
  };

  return (
    <div className="fixed inset-0 z-50 min-h-dvh h-dvh w-full flex flex-col justify-between items-center bg-gradient-to-b from-slate-950 via-slate-900 to-emerald-950 text-white px-5 py-8 sm:py-12 select-none overflow-hidden animate-in fade-in duration-300">
      {/* Background Subtle Ambient Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top / Center Branding Section */}
      <div className="w-full max-w-sm sm:max-w-md mx-auto my-auto pt-4 pb-6 flex flex-col items-center text-center relative z-10">
        {/* Emblem */}
        <div className="relative mb-5 group">
          <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-3xl overflow-hidden shadow-2xl shadow-emerald-500/30 ring-4 ring-emerald-500/20 bg-slate-950/70 border border-emerald-500/30 flex items-center justify-center">
            <img 
              src="/stk_app_icon.png" 
              alt="Logo" 
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-sm">
          Sổ Tiết Kiệm Gia Đình
        </h1>
      </div>

      {/* Bottom Action Stack */}
      <div className="w-full max-w-sm sm:max-w-md mx-auto space-y-3 relative z-10 pb-4">
        {/* Lựa chọn 1: Đăng nhập bằng Google */}
        <button
          id="btn-login-google-online"
          type="button"
          disabled={isLoading}
          onClick={handleGoogleSignIn}
          className="w-full h-[76px] text-left px-4 rounded-2xl bg-white hover:bg-slate-50 text-slate-900 border-2 border-white shadow-xl shadow-black/40 transition-all flex items-center space-x-3.5 active:scale-[0.98] disabled:opacity-60 cursor-pointer group box-border"
        >
          {/* Official Google Icon Container */}
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-slate-200/70 transition-colors">
            {isLoading ? (
              <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
          </div>

          <div className="flex-1 min-w-0 pr-1">
            <div className="text-base font-bold text-slate-900 leading-snug whitespace-nowrap">
              {isLoading ? 'Đang kết nối...' : 'Đăng nhập bằng Google'}
            </div>
            <div className="text-xs text-slate-500 font-medium mt-0.5 whitespace-nowrap">
              Sao lưu và đồng bộ trực tuyến.
            </div>
          </div>
        </button>

        {/* Lựa chọn 2: Sử dụng ngay */}
        <button
          id="btn-login-offline-mode"
          type="button"
          onClick={handleUseOffline}
          className="w-full h-[76px] text-left px-4 rounded-2xl bg-slate-900 hover:bg-slate-800/90 border-2 border-slate-700/70 text-white shadow-xl shadow-black/30 transition-all flex items-center space-x-3.5 active:scale-[0.98] cursor-pointer group box-border"
        >
          <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0 text-emerald-400 group-hover:bg-slate-700 transition-colors">
            <HardDrive className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0 pr-1">
            <div className="text-base font-bold text-white leading-snug whitespace-nowrap">
              Sử dụng ngay
            </div>
            <div className="text-xs text-slate-400 font-medium mt-0.5 whitespace-nowrap">
              Sao lưu và đồng bộ trên máy.
            </div>
          </div>
        </button>

        {errorMessage && (
          <div className="p-3.5 bg-rose-950/90 border border-rose-800/80 rounded-2xl text-xs text-rose-200 space-y-3 text-left animate-in fade-in">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span className="leading-relaxed font-medium flex-1 text-[12px]">{errorMessage}</span>
            </div>

            {isNative ? (
              <div className="pt-2.5 flex flex-col gap-2 border-t border-rose-900/60">
                <button
                  type="button"
                  onClick={handleUseOffline}
                  className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-md"
                >
                  <HardDrive className="w-4 h-4" />
                  <span>Vào ứng dụng ngay (Chế độ Ngoại tuyến)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowShaHelp(true)}
                  className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-800/60 rounded-xl font-medium text-[11px] flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Info className="w-3.5 h-3.5 text-amber-400" />
                  <span>Xem cách Khắc phục mã SHA-1</span>
                </button>
              </div>
            ) : (
              <div className="pt-2 flex items-center justify-between gap-2 border-t border-rose-900/60">
                <button
                  type="button"
                  onClick={handleOpenInNewTab}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-[11px] flex items-center space-x-1.5 transition-colors cursor-pointer shadow-md"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Mở ở Tab mới</span>
                </button>
                <button
                  type="button"
                  onClick={handleGoogleRedirectSignIn}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-bold text-[11px] flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Đăng nhập qua Redirect</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Hướng dẫn khắc phục SHA-1 APK */}
      {showShaHelp && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 text-slate-200 space-y-4 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Khắc Phục Đăng Nhập Google (Mã 10)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShaHelp(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Google yêu cầu mã <strong>SHA-1 Fingerprint</strong> của file APK đã ký phải khớp 100% với cấu hình trong Firebase Console:
            </p>

            <div className="space-y-2 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-400">Package Name:</div>
                <div className="font-mono text-emerald-400 flex items-center justify-between">
                  <span>com.tietkiemgiadinh.app</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('com.tietkiemgiadinh.app', 'pkg')}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                  >
                    {copiedKey === 'pkg' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <div className="text-[11px] text-slate-400 font-medium">Các bước lấy mã SHA-1 chính xác:</div>
                <ol className="list-decimal pl-4 space-y-1 text-slate-300 text-[11px]">
                  <li>Vào <strong>GitHub Repo</strong> của bạn &gt; tab <strong>Actions</strong> &gt; chọn lần chạy mới nhất.</li>
                  <li>Xem mục <strong>Summary</strong> ở dưới cùng để lấy mã <strong>SHA-1 Fingerprint</strong> của bản build.</li>
                  <li>Mở <strong>Firebase Console</strong> &gt; <strong>Project settings</strong> &gt; cuộn xuống phần app Android.</li>
                  <li>Bấm <strong>Add fingerprint</strong> và dán mã SHA-1 vào.</li>
                </ol>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 space-y-1.5 bg-slate-800/40 p-3 rounded-xl">
              <div className="font-semibold text-slate-300">Tính năng Ngoại tuyến:</div>
              <div>Bạn có thể bấm nút dưới đây để sử dụng ngay toàn bộ tính năng quản lý sổ, tính lãi suất, khóa sinh trắc học hoàn toàn trên máy mà không cần đợi cấu hình SHA-1.</div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowShaHelp(false);
                handleUseOffline();
              }}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
            >
              Vào ứng dụng ngay với chế độ Ngoại tuyến
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

