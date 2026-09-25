import React, { useState, useRef, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  PiggyBank,
  Calendar,
  Calculator,
  Smartphone,
  Monitor,
  Plus,
  BookOpen,
  RotateCcw,
  FileSpreadsheet,
  BarChart3,
  Cloud,
  Menu,
  X,
  Database,
  Layers,
  Sparkles,
  CheckCircle2,
  Settings,
  Building2,
  Fingerprint,
  LogOut,
  LogIn,
  Trash2,
  Users,
  Bell,
  FileText,
  Download,
  Globe,
  WifiOff,
} from 'lucide-react';
import { SyncAuditLogModal } from './SyncAuditLogModal';
import { AppSettings, AuthUser } from '../types';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { Capacitor } from '@capacitor/core';
import { formatVND, formatShortVND } from '../utils/formatters';
import { useToast } from '../context/ToastContext';
import {
  requestNotificationPermission,
  triggerTestNotification,
  isCapacitorNative,
} from '../utils/notificationService';

export type NavTabType = 'sheet-view' | 'interest-calc' | 'optimizer' | 'analytics' | 'timeline' | 'portfolio' | 'charts' | 'history' | 'android-spec';

interface NavbarProps {
  activeTab: NavTabType;
  setActiveTab: (tab: NavTabType) => void;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  totalPrincipal: number;
  totalEstimatedInterest: number;
  activeBooksCount: number;
  isMobilePreview: boolean;
  setIsMobilePreview: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenAddModal: () => void;
  onResetData?: () => void;
  onOpenSyncModal: () => void;
  onOpenAndroidSpec: () => void;
  onOpenManageBanks?: () => void;
  onOpenClearDataModal?: () => void;
  onOpenUserManagement?: () => void;
  currentUser?: AuthUser | null;
  onLogout?: () => void;
  onLoginGoogle?: () => void;
  isSyncingDrive?: boolean;
  onTriggerManualCheckUpdate?: () => void;
  currentVersion?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  settings,
  setSettings,
  totalPrincipal,
  totalEstimatedInterest,
  activeBooksCount,
  isMobilePreview,
  setIsMobilePreview,
  onOpenAddModal,
  onResetData,
  onOpenSyncModal,
  onOpenAndroidSpec,
  onOpenManageBanks,
  onOpenClearDataModal,
  onOpenUserManagement,
  currentUser,
  onLogout,
  onLoginGoogle,
  isSyncingDrive,
  onTriggerManualCheckUpdate,
  currentVersion = '1.0.0',
}) => {
  const { showToast } = useToast();
  const [showMenu, setShowMenu] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const togglePrivacy = () => {
    setSettings((prev) => ({ ...prev, privacyMode: !prev.privacyMode }));
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  // Normalize active tab into 3 main tabs
  const getActiveTabKey = (): 'sheet-view' | 'optimizer' | 'analytics' => {
    if (activeTab === 'optimizer') return 'optimizer';
    if (activeTab === 'interest-calc' || activeTab === 'charts' || activeTab === 'history' || activeTab === 'analytics' || activeTab === 'timeline') return 'analytics';
    return 'sheet-view';
  };

  const currentTab = getActiveTabKey();

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md safe-area-header">
      {/* Top Banner / Brand Header */}
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 py-2 sm:py-2.5">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* Logo & Title */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl overflow-hidden bg-slate-950/60 border border-emerald-500/40 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <img 
                src="/stk_app_icon.png" 
                alt="Logo" 
                className="w-full h-full object-cover" 
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5 sm:space-x-2">
                <h1 className="text-sm sm:text-lg font-bold tracking-tight text-white truncate">
                  Tiết kiệm gia đình
                </h1>
              </div>
            </div>
          </div>

          {/* Center Summary Stats (Hidden on small mobile) */}
          <div className="hidden lg:flex items-center space-x-3 text-xs">
            <div className="bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700/70">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Tổng gốc ({activeBooksCount} sổ)
              </span>
              <span className="font-bold text-emerald-400 text-sm">
                {formatVND(totalPrincipal, settings.privacyMode)}
              </span>
            </div>

            <div className="bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700/70">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Lãi dự kiến cả kỳ
              </span>
              <span className="font-bold text-amber-400 text-sm">
                +{formatVND(totalEstimatedInterest, settings.privacyMode)}
              </span>
            </div>
          </div>

          {/* Action Toolbar: Add Book, Privacy Toggle & Hamburger Menu */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* Quick Google Login for Offline Users */}
            {currentUser?.isOffline && onLoginGoogle && (
              <button
                id="btn-navbar-login-google"
                onClick={onLoginGoogle}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all active:scale-98 cursor-pointer"
                title="Đăng nhập Google để chuyển sang trực tuyến và đồng bộ Drive"
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Đăng nhập Google</span>
                <span className="xs:hidden">Google</span>
              </button>
            )}

            {/* Quick Add Book */}
            <button
              id="btn-add-new-book"
              onClick={onOpenAddModal}
              className="hidden sm:flex items-center space-x-1 px-3 py-1.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-slate-700 shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Thêm sổ</span>
            </button>

            {/* Privacy Toggle Quick Button */}
            <button
              id="btn-toggle-privacy"
              onClick={togglePrivacy}
              title={settings.privacyMode ? 'Hiện số tiền' : 'Ẩn số tiền (Chế độ riêng tư)'}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700"
            >
              {settings.privacyMode ? (
                <EyeOff className="w-4 h-4 text-amber-400" />
              ) : (
                <Eye className="w-4 h-4 text-slate-300" />
              )}
            </button>

            {/* MENU 3 GẠCH (HAMBURGER MENU) */}
            <div className="relative" ref={menuRef}>
              <button
                id="btn-hamburger-menu"
                onClick={() => setShowMenu(!showMenu)}
                title="Menu công cụ & Cài đặt bổ sung"
                className={`p-2 rounded-xl border transition-all flex items-center justify-center ${
                  showMenu
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-bold'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                {showMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>

              {/* Hamburger Dropdown Drawer */}
              {showMenu && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 space-y-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  {/* User Profile / Info */}
                  <div className="p-3 bg-slate-800/95 rounded-xl border border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white truncate">
                        {currentUser ? currentUser.name : `Gia đình ${settings.husbandName} & ${settings.wifeName}`}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                        currentUser?.isOffline
                          ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                          : (settings.currentRole || 'ADMIN') === 'ADMIN'
                          ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                          : (settings.currentRole || 'ADMIN') === 'EDITOR'
                          ? 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
                          : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        {currentUser?.isOffline
                          ? 'Ngoại tuyến (Offline)'
                          : (settings.currentRole || 'ADMIN') === 'ADMIN'
                          ? '👑 Admin (Chủ sở hữu)'
                          : (settings.currentRole || 'ADMIN') === 'EDITOR'
                          ? '✏️ Quyền Sửa (Editor)'
                          : '👁️ Chỉ Xem (Viewer)'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-300 font-mono truncate">
                      {currentUser?.isOffline ? 'Lưu trữ trên thiết bị này' : (currentUser?.email || 'Đã kết nối Google')}
                    </div>

                    {/* Action button inside drawer: Đăng xuất khi đã login, Đăng nhập khi chưa login */}
                    {currentUser && !currentUser.isOffline ? (
                      onLogout && (
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            onLogout();
                          }}
                          className="w-full mt-2 py-2 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/30 transition-all flex items-center justify-center space-x-1.5 active:scale-98 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Đăng xuất</span>
                        </button>
                      )
                    ) : (
                      onLoginGoogle && (
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            onLoginGoogle();
                          }}
                          className="w-full mt-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center space-x-1.5 active:scale-98 cursor-pointer"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>Đăng nhập</span>
                        </button>
                      )
                    )}
                  </div>

                  {/* Menu Items List */}
                  <div className="space-y-1 text-xs">
                    {/* Sync Google Drive / Offline File */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onOpenSyncModal();
                      }}
                      className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl hover:bg-emerald-950/60 hover:text-emerald-300 text-slate-200 transition-colors text-left"
                    >
                      <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-bold">Đồng bộ dữ liệu</div>
                        <p className="text-[10px] text-slate-400">
                          {settings.lastSyncTime
                            ? `Gần nhất: ${settings.lastSyncTime}`
                            : 'Gần nhất: Chưa đồng bộ'}
                        </p>
                      </div>
                    </button>

                    {/* Quản lý thành viên gia đình */}
                    <button
                      id="btn-nav-user-management"
                      onClick={() => {
                        setShowMenu(false);
                        if (onOpenUserManagement) onOpenUserManagement();
                      }}
                      className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl hover:bg-teal-950/60 hover:text-teal-300 text-slate-200 transition-colors text-left pl-3"
                    >
                      <Users className="w-4 h-4 text-teal-400 shrink-0" />
                      <div>
                        <div className="font-bold">Quản Lý Thành Viên</div>
                      </div>
                    </button>

                    {/* Quản lý danh sách ngân hàng */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        if (onOpenManageBanks) onOpenManageBanks();
                      }}
                      className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl hover:bg-slate-800 text-slate-200 transition-colors text-left"
                    >
                      <Building2 className="w-4 h-4 text-teal-400 shrink-0" />
                      <div>
                        <div className="font-semibold">Danh sách ngân hàng</div>
                      </div>
                    </button>

                    {/* Cài đặt Thông báo tự động */}
                    <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 mt-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Bell className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="font-semibold text-slate-200 text-xs">Thông báo</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const nextState = !settings.notificationsEnabled;
                            if (nextState) {
                              const granted = await requestNotificationPermission();
                              if (!granted) {
                                showToast('Vui lòng cấp quyền thông báo trên thiết bị.', 'error');
                                return;
                              }
                              // Phát ngay âm thanh chuông & rung thử nghiệm 1 lần khi BẬT
                              triggerTestNotification();
                            }
                            setSettings((prev) => ({
                              ...prev,
                              notificationsEnabled: nextState,
                            }));
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                            settings.notificationsEnabled
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {settings.notificationsEnabled ? 'BẬT (08:30)' : 'TẮT'}
                        </button>
                      </div>
                    </div>

                    {/* Cài đặt Khóa vân tay */}
                    <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 mt-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Fingerprint className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="font-semibold text-slate-200 text-xs">Khóa vân tay</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const nextState = !settings.enableBiometricLogin;
                            if (nextState) {
                              let isSupported = false;
                              try {
                                if (Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'Capacitor' in window)) {
                                  const res = await NativeBiometric.isAvailable();
                                  isSupported = res.isAvailable;
                                } else if (window.PublicKeyCredential) {
                                  isSupported = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
                                }
                              } catch {
                                isSupported = false;
                              }
                              if (!isSupported) {
                                showToast('Thiết bị chưa kích hoạt sinh trắc học hoặc mở khóa màn hình.', 'error');
                              }
                            }
                            setSettings((prev) => ({
                              ...prev,
                              enableBiometricLogin: nextState,
                            }));
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                            settings.enableBiometricLogin
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {settings.enableBiometricLogin ? 'BẬT' : 'TẮT'}
                        </button>
                      </div>
                    </div>

                    {/* Nhật Ký Kiểm Toán Đồng Bộ */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        setIsAuditLogOpen(true);
                      }}
                      className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-blue-300 transition-colors text-left mt-1"
                    >
                      <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="font-semibold text-xs text-blue-200">Kiểm toán đồng bộ</span>
                    </button>

                    {/* Phiên bản & Cập nhật */}
                    <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between mt-1 space-x-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="font-mono font-bold text-slate-200 text-xs">
                          {currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          if (onTriggerManualCheckUpdate) {
                            onTriggerManualCheckUpdate();
                          }
                        }}
                        title="Tải cập nhật mới"
                        className="p-1.5 rounded-lg bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-bold shrink-0 shadow-sm transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Clear All App Data */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        if (onOpenClearDataModal) onOpenClearDataModal();
                      }}
                      className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 transition-colors text-left border-t border-slate-800/80 pt-2 mt-1"
                    >
                      <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-rose-300">Xóa dữ liệu</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3 CONSOLIDATED CLEAN TABS */}
        <nav className="flex items-center space-x-1 sm:space-x-2 mt-1.5 sm:mt-2 pt-1.5 sm:pt-2 border-t border-slate-800/90 w-full overflow-x-auto no-scrollbar">
          {/* TAB 1: BẢNG KÊ EXCEL & DANH MỤC */}
          <button
            id="tab-sheet-view"
            onClick={() => setActiveTab('sheet-view')}
            className={`flex-1 flex items-center justify-center space-x-1 sm:space-x-2 px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-sm font-bold transition-all whitespace-nowrap ${
              currentTab === 'sheet-view'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-emerald-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>Bảng kê</span>
            <span className="px-1.5 py-0.2 bg-emerald-950/70 text-emerald-300 text-[10px] font-bold rounded-full">
              {activeBooksCount}
            </span>
          </button>

          {/* TAB 2: TỐI ƯU HUY ĐỘNG VỐN */}
          <button
            id="tab-optimizer"
            onClick={() => setActiveTab('optimizer')}
            className={`flex-1 flex items-center justify-center space-x-1 sm:space-x-2 px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-sm font-bold transition-all whitespace-nowrap relative ${
              currentTab === 'optimizer'
                ? 'bg-emerald-400 text-slate-950 shadow-sm'
                : 'text-emerald-200 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="sm:hidden">Tối ưu vốn</span>
            <span className="hidden sm:inline">2. Tối Ưu Huy Động Vốn</span>
          </button>

          {/* TAB 3: PHÂN TÍCH & DÒNG TIỀN */}
          <button
            id="tab-analytics"
            onClick={() => setActiveTab('analytics')}
            className={`flex-1 flex items-center justify-center space-x-1 sm:space-x-2 px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-sm font-bold transition-all whitespace-nowrap ${
              currentTab === 'analytics'
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-indigo-300 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="sm:hidden">Dòng tiền</span>
            <span className="hidden sm:inline">3. Phân Tích &amp; Dòng Tiền</span>
          </button>
        </nav>
      </div>

      {/* Modal Nhật ký kiểm toán & điều tra đồng bộ */}
      <SyncAuditLogModal
        isOpen={isAuditLogOpen}
        onClose={() => setIsAuditLogOpen(false)}
        currentUserEmail={currentUser?.email}
        userRole={settings.currentRole || 'ADMIN'}
      />
    </header>
  );
};
