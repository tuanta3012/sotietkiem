/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Preferences } from '@capacitor/preferences';
import { SavingsBook, AppSettings, AuthUser, SettlementAdjustment } from './types';
import { isUsingSampleData } from './data/historicalGrowth';
import { Navbar, NavTabType } from './components/Navbar';
import { LoginModal } from './components/LoginModal';
import { BiometricUnlockModal } from './components/BiometricUnlockModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { BookListView } from './components/BookListView';
import { AppModals } from './components/AppModals';
import { LoginConflictResolveModal } from './components/LoginConflictResolveModal';
import {
  downloadRealGoogleDriveFile,
  updateRealGoogleDriveFile,
  getGoogleAccessToken,
  setGoogleAccessToken,
  restoreGoogleAuthSession,
  signOutGoogle,
  signInWithGoogle,
  initGoogleAuth,
  checkRedirectResult,
  autoDiscoverLatestCentralHub,
  removeMemberFromDriveMaster,
  setExplicitlyUnlinked,
} from './utils/googleDriveService';
import { exportSavingsBooksToExcel } from './utils/excelParser';
import { sortAndReindexBooks } from './utils/dataTranslator';
import {
  getDynamicAnnualInterestHistory,
  getDynamicBalanceGrowthHistory,
  clearStaticHistoryFromStorage,
} from './data/historicalGrowth';
import { getSecureItem, setSecureItem, autoCleanupStartupCache } from './utils/secureStorage';
import { useDriveSync } from './hooks/useDriveSync';
import { useSavingsBooks } from './hooks/useSavingsBooks';
import { useToast } from './context/ToastContext';
import { scheduleMaturityNotifications } from './utils/notificationService';
import { getAllBanks, updateBanksFromRemote } from './data/banks';

// Chuyển hai component có kích thước lớn và chứa biểu đồ thành dạng lazy load
const MobilizationOptimizer = React.lazy(() =>
  import('./components/MobilizationOptimizer').then((m) => ({ default: m.MobilizationOptimizer }))
);
const InterestCalculationView = React.lazy(() =>
  import('./components/InterestCalculationView').then((m) => ({ default: m.InterestCalculationView }))
);

const TabLoadingFallback = () => (
  <div className="flex flex-col items-center justify-center min-h-[360px] py-16 px-4 bg-white/70 rounded-2xl border border-slate-200/80 shadow-xs animate-in fade-in duration-150">
    <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-3 shadow-xs">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
    <span className="text-sm font-bold text-slate-800">Đang tải phân tích &amp; đồ thị dữ liệu...</span>
    <span className="text-xs text-slate-400 mt-1">Hệ thống đang chuẩn bị mô đun tính toán chuyên sâu</span>
  </div>
);

import { CURRENT_APP_VERSION } from './version';

import { useAppUpdate } from './hooks/useAppUpdate';

const CURRENT_DATE = new Date().toISOString().split('T')[0];

export default function App() {
  const { showToast } = useToast();
  const [isPendingAuth, setIsPendingAuth] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('pending_google_redirect_auth') === 'true';
    } catch {
      return false;
    }
  });

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      if (sessionStorage.getItem('pending_google_redirect_auth') === 'true') {
        return null;
      }
      const saved = localStorage.getItem('savings_auth_user_v3');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return null;
  });

  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      const savedUser = localStorage.getItem('savings_auth_user_v3');
      const savedSettings = localStorage.getItem('savings_settings_v3');
      const bioDirect = localStorage.getItem('savings_setting_biometrics');

      if (savedUser) {
        if (bioDirect === 'true') {
          return false;
        }
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (parsed.enableBiometricLogin) {
            return false;
          }
        }
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  });

  const [isLogoutWarningModalOpen, setIsLogoutWarningModalOpen] = useState<boolean>(false);
  const [showFileDeletedRecovery, setShowFileDeletedRecovery] = useState<boolean>(false);
  const [isClearDataModalOpen, setIsClearDataModalOpen] = useState<boolean>(false);

  // States to manage conflict when logging in online with existing offline books
  const [conflictHub, setConflictHub] = useState<any | null>(null);
  const [conflictToken, setConflictToken] = useState<string | null>(null);
  const [conflictUser, setConflictUser] = useState<AuthUser | null>(null);

  // App settings state - Hỗ trợ khôi phục đồng bộ đa tầng (Direct keys + JSON settings)
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('savings_settings_v3');
      const notiDirect = localStorage.getItem('savings_setting_notifications');
      const bioDirect = localStorage.getItem('savings_setting_biometrics');

      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          privacyMode: parsed.privacyMode ?? false,
          isVipMode: parsed.isVipMode ?? true,
          upfrontNetting: parsed.upfrontNetting ?? true,
          defaultLoanMargin: parsed.defaultLoanMargin ?? 1.5,
          bankLoanMargins: parsed.bankLoanMargins ?? {
            seabank: 1.5,
            shb: 1.5,
            sea2: 1.5,
            vietcombank: 1.5,
            techcombank: 1.8,
            bidv: 1.5,
            vpbank: 2.0,
            mbbank: 1.5,
            acb: 1.6,
            agribank: 1.5,
            hdbank: 2.0,
            vib: 1.9,
            tpbank: 1.8,
          },
          defaultDemandRate: parsed.defaultDemandRate ?? 0.2,
          defaultLTV: parsed.defaultLTV ?? 1.0,
          husbandName: 'Chồng',
          wifeName: 'Vợ',
          googleSheetUrl: parsed.googleSheetUrl || undefined,
          googleSheetName: parsed.googleSheetName || undefined,
          lastSyncTime: parsed.lastSyncTime ?? undefined,
          notificationsEnabled: notiDirect !== null ? notiDirect === 'true' : (parsed.notificationsEnabled ?? false),
          enableBiometricLogin: bioDirect !== null ? bioDirect === 'true' : (parsed.enableBiometricLogin ?? false),
        };
      } else if (notiDirect !== null || bioDirect !== null) {
        return {
          privacyMode: false,
          isVipMode: true,
          upfrontNetting: true,
          defaultLoanMargin: 1.5,
          bankLoanMargins: {
            seabank: 1.5,
            shb: 1.5,
            sea2: 1.5,
            vietcombank: 1.5,
            techcombank: 1.8,
            bidv: 1.5,
            vpbank: 2.0,
            mbbank: 1.5,
            acb: 1.6,
            agribank: 1.5,
            hdbank: 2.0,
            vib: 1.9,
            tpbank: 1.8,
          },
          defaultDemandRate: 0.2,
          defaultLTV: 1.0,
          husbandName: 'Chồng',
          wifeName: 'Vợ',
          googleSheetUrl: undefined,
          googleSheetName: undefined,
          lastSyncTime: undefined,
          notificationsEnabled: notiDirect === 'true',
          enableBiometricLogin: bioDirect === 'true',
        };
      }
    } catch {
      // ignore
    }
    return {
      privacyMode: false,
      isVipMode: true,
      upfrontNetting: true,
      defaultLoanMargin: 1.5,
      bankLoanMargins: {
        seabank: 1.5,
        shb: 1.5,
        sea2: 1.5,
        vietcombank: 1.5,
        techcombank: 1.8,
        bidv: 1.5,
        vpbank: 2.0,
        mbbank: 1.5,
        acb: 1.6,
        agribank: 1.5,
        hdbank: 2.0,
        vib: 1.9,
        tpbank: 1.8,
      },
      defaultDemandRate: 0.2,
      defaultLTV: 1.0,
      husbandName: 'Chồng',
      wifeName: 'Vợ',
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      lastSyncTime: undefined,
      notificationsEnabled: false,
      enableBiometricLogin: false,
    };
  });

  const [isSessionRestored, setIsSessionRestored] = useState<boolean>(false);

  // 1. Cấu hình chống đè Status Bar trên thiết bị di động
  useEffect(() => {
    const initNativeStatusBar = async () => {
      try {
        if (Capacitor.isNativePlatform() || (typeof window !== 'undefined' && 'Capacitor' in window)) {
          await StatusBar.setOverlaysWebView({ overlay: false });
          await StatusBar.setBackgroundColor({ color: '#0f172a' });
          await StatusBar.setStyle({ style: Style.Dark });
        }
      } catch (err) {
        // Fallback nhẹ trên giao diện Web Preview
      }
    };
    initNativeStatusBar();
  }, []);

  // 2. Tự động khôi phục phiên làm việc ngầm từ Capacitor Preferences và SecureStorage khi mở/khởi động lại app
  useEffect(() => {
    const restoreSessionFromPreferences = async () => {
      try {
        // Tự động dọn dẹp bộ nhớ đệm tạm thời khi mở app
        await autoCleanupStartupCache();

        let hasBiometric = false;
        let hasNotifications = false;

        // Tầng 1: Đọc từ Keystore phần cứng SecureStorage (không bao giờ bị xóa khi cập nhật APK)
        try {
          const secBio = await getSecureItem('savings_setting_biometrics');
          const secNoti = await getSecureItem('savings_setting_notifications');
          if (secBio === 'true') hasBiometric = true;
          if (secNoti === 'true') hasNotifications = true;
        } catch (e) {
          console.warn('Lỗi đọc SecureStorage settings:', e);
        }

        // Tầng 2: Đọc từ Preferences riêng lẻ
        try {
          const { value: pBio } = await Preferences.get({ key: 'savings_setting_biometrics' });
          const { value: pNoti } = await Preferences.get({ key: 'savings_setting_notifications' });
          if (pBio === 'true') hasBiometric = true;
          if (pNoti === 'true') hasNotifications = true;
        } catch (e) {
          console.warn('Lỗi đọc Preferences settings riêng lẻ:', e);
        }

        // Tầng 3: Đọc settings tổng thể từ Preferences
        let parsedPref: any = null;
        try {
          const { value: prefSettings } = await Preferences.get({ key: 'savings_settings_v3' });
          if (prefSettings) {
            parsedPref = JSON.parse(prefSettings);
            if (parsedPref.enableBiometricLogin) hasBiometric = true;
            if (parsedPref.notificationsEnabled) hasNotifications = true;
          }
        } catch (e) {
          console.warn('Lỗi parse settings từ Preferences:', e);
        }

        // Cập nhật state Settings với giá trị đã được khôi phục chắc chắn
        setSettings((prev) => {
          const updated = {
            ...prev,
            ...(parsedPref || {}),
            enableBiometricLogin: hasBiometric || prev.enableBiometricLogin,
            notificationsEnabled: hasNotifications || prev.notificationsEnabled,
          };
          try {
            const json = JSON.stringify(updated);
            localStorage.setItem('savings_settings_v3', json);
            localStorage.setItem('savings_setting_biometrics', String(updated.enableBiometricLogin));
            localStorage.setItem('savings_setting_notifications', String(updated.notificationsEnabled));
          } catch {}
          return updated;
        });

        // 2. Khôi phục user từ Preferences
        let hasUser = false;
        if (!currentUser) {
          const { value: prefUser } = await Preferences.get({ key: 'savings_auth_user_v3' });
          if (prefUser) {
            try {
              const user = JSON.parse(prefUser);
              setCurrentUser(user);
              hasUser = true;
            } catch (e) {
              console.warn('Lỗi parse user từ Preferences:', e);
            }
          }
        } else {
          hasUser = true;
        }

        // 3. Nếu khôi phục thành công user và thiết bị KHÔNG bật khóa vân tay, tự động mở khóa (isUnlocked = true)
        if (hasUser) {
          if (!hasBiometric) {
            setIsUnlocked(true);
          } else {
            setIsUnlocked(false);
          }
        }

        // 4. Khôi phục token bảo mật dài hạn (Secure Storage)
        await restoreGoogleAuthSession();
      } catch (err) {
        console.warn('Lỗi khôi phục phiên từ Preferences:', err);
      } finally {
        // Đánh dấu đã khôi phục xong để cho phép ghi đè/lưu thay đổi
        setIsSessionRestored(true);
      }
    };
    restoreSessionFromPreferences();
  }, []);

  // Lưu settings khi thay đổi - Chỉ ghi đè sau khi đã hoàn thành khôi phục từ Preferences
  useEffect(() => {
    if (!isSessionRestored) return;
    try {
      const json = JSON.stringify(settings);
      localStorage.setItem('savings_settings_v3', json);
      Preferences.set({ key: 'savings_settings_v3', value: json }).catch(() => {});

      // Đồng thời lưu độc lập vào SecureStorage (Keystore) và Preferences
      if (settings.enableBiometricLogin !== undefined) {
        const bioVal = String(settings.enableBiometricLogin);
        localStorage.setItem('savings_setting_biometrics', bioVal);
        Preferences.set({ key: 'savings_setting_biometrics', value: bioVal }).catch(() => {});
        setSecureItem('savings_setting_biometrics', bioVal).catch(() => {});
      }
      if (settings.notificationsEnabled !== undefined) {
        const notiVal = String(settings.notificationsEnabled);
        localStorage.setItem('savings_setting_notifications', notiVal);
        Preferences.set({ key: 'savings_setting_notifications', value: notiVal }).catch(() => {});
        setSecureItem('savings_setting_notifications', notiVal).catch(() => {});
      }

      if (!settings.googleSheetUrl) {
        clearStaticHistoryFromStorage();
      }
    } catch {
      // ignore
    }
  }, [settings, isSessionRestored]);

  // Lưu user khi thay đổi - Chỉ ghi đè sau khi đã hoàn thành khôi phục từ Preferences
  useEffect(() => {
    if (!isSessionRestored) return;
    try {
      if (currentUser) {
        const json = JSON.stringify(currentUser);
        localStorage.setItem('savings_auth_user_v3', json);
        Preferences.set({ key: 'savings_auth_user_v3', value: json }).catch(() => {});
      } else {
        localStorage.removeItem('savings_auth_user_v3');
        Preferences.remove({ key: 'savings_auth_user_v3' }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }, [currentUser, isSessionRestored]);



  // 3. Tự động kiểm tra cập nhật APK từ xa bằng useAppUpdate hook
  const {
    updateInfo,
    isUpdateModalOpen,
    setIsUpdateModalOpen,
    checkAppUpdate,
  } = useAppUpdate({
    currentVersion: CURRENT_APP_VERSION,
    updateServerUrl: 'https://raw.githubusercontent.com/tuanta3012/sotietkiem/main/version.json',
    autoCheckDelayMs: 2000,
    onNotification: (msg, type) => {
      if (type === 'info') {
        showToast(msg, 'info');
      } else if (type === 'success') {
        showToast(msg, 'success', 4000);
      } else {
        showToast(msg, 'error', 4000);
      }
    },
  });

  // Giữ phiên Google OAuth và Firebase Auth luôn đồng bộ bền vững khi mở app hoặc refresh trang
  useEffect(() => {
    if (!isSessionRestored) return; // Đợi khôi phục xong phiên từ Secure Storage mới lắng nghe Auth

    const unsubscribe = initGoogleAuth(
      (firebaseUser, token) => {
        if (token) {
          setGoogleAccessToken(token);
        }
      },
      () => {
        // signed out
      }
    );
    return () => {
      unsubscribe();
    };
  }, [isSessionRestored]);

  // Ref callbacks for useSavingsBooks to push to Google Drive seamlessly
  const pushBooksToDriveRef = useRef<((b: SavingsBook[], a?: SettlementAdjustment[]) => void) | undefined>(undefined);
  const showSyncStatusRef = useRef<((msg: string) => void) | undefined>(undefined);

  // Savings books core management hook
  const {
    books,
    setBooks,
    settlementAdjustments,
    setSettlementAdjustments,
    activeBooks,
    totalPrincipal,
    totalEstimatedInterest,
    sortedBanksInfo,
    banksVersion,
    setBanksVersion,
    searchQuery,
    setSearchQuery,
    ownerFilter,
    setOwnerFilter,
    bankFilter,
    setBankFilter,
    sortBy,
    setSortBy,
    filteredBooks,
    handleUpdateBook,
    handleSaveBook,
    handleDeleteBook,
    handleSettleBook,
    handleRolloverBook,
    handleImportBooks,
    handleDeleteSettlementAdjustment,
    handleDeleteAllAppData,
  } = useSavingsBooks({
    currentRole: settings.currentRole,
    onPushToDrive: (b, a) => pushBooksToDriveRef.current?.(b, a),
    onShowSyncStatus: (msg) => showSyncStatusRef.current?.(msg),
  });

  // Google Drive 2-way sync hook
  const {
    isSyncingDrive,
    syncDriveStatus,
    setSyncDriveStatus,
    setIsSyncingDrive,
    isDriveTokenExpired,
    setIsDriveTokenExpired,
    renewTokenAndSync,
    syncBooksFromDrive,
    pushBooksToDrive,
    detectedDesyncHub,
    markAsRemoteUpdate,
    startFileSwitch,
    finishFileSwitch,
    cancelFileSwitch,
  } = useDriveSync({
    currentUser,
    settings,
    setSettings,
    books,
    setBooks,
    settlementAdjustments,
    setSettlementAdjustments,
    setShowFileDeletedRecovery,
  });

  pushBooksToDriveRef.current = pushBooksToDrive;
  showSyncStatusRef.current = setSyncDriveStatus;

  // Sync drive status notification effect (Floating Toast - 1 time on initial load, silent on background auto-sync)
  const hasShownInitialDriveConnToastRef = useRef<boolean>(false);

  useEffect(() => {
    if (syncDriveStatus && currentUser && !currentUser.isOffline) {
      const isError =
        syncDriveStatus.includes('❌') ||
        syncDriveStatus.toLowerCase().includes('lỗi') ||
        syncDriveStatus.toLowerCase().includes('thất bại') ||
        syncDriveStatus.toLowerCase().includes('hết hạn');

      const isWarning =
        syncDriveStatus.includes('⚡') ||
        syncDriveStatus.toLowerCase().includes('hủy liên kết') ||
        syncDriveStatus.toLowerCase().includes('đã dọn');

      if (isError) {
        showToast(syncDriveStatus, 'error', 5000);
      } else if (isWarning) {
        showToast(syncDriveStatus, 'error', 8000);
      } else {
        // Chỉ xuất hiện 1 lần duy nhất khi mở app để xác nhận đã kết nối thành công với file liên kết
        if (!hasShownInitialDriveConnToastRef.current) {
          hasShownInitialDriveConnToastRef.current = true;
          showToast('Đã kết nối và đồng bộ thành công với file Google Drive', 'success', 3500);
        }
      }
    }
  }, [syncDriveStatus, currentUser, showToast]);

  // Tự động lập lịch thông báo nhắc đáo hạn (Local Notifications trên Capacitor Android)
  useEffect(() => {
    if (settings.notificationsEnabled && books.length > 0) {
      scheduleMaturityNotifications(books).catch((err) => {
        console.warn('Lỗi tự động lập lịch thông báo đáo hạn:', err);
      });
    }
  }, [settings.notificationsEnabled, books]);

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const redirectRes = await checkRedirectResult();
        if (redirectRes) {
          const email = redirectRes.user.email || '';
          const cleanEmail = email.trim().toLowerCase();

          const role: 'admin' | 'viewer' = 'admin';
          const title = 'Quản trị viên (Admin) - Toàn quyền quản lý & Đồng bộ Google Drive';
          const name = redirectRes.user.displayName || 'Chủ Tài Khoản';

          const onlineUser: AuthUser = {
            email: cleanEmail,
            name,
            photoURL: redirectRes.user.photoURL || undefined,
            role,
            title,
            isOffline: false,
          };

          setCurrentUser(onlineUser);
          setIsUnlocked(true);
          setGoogleAccessToken(redirectRes.accessToken);
          setIsPendingAuth(false);
          syncBooksFromDrive(false, redirectRes.accessToken);
        } else {
          setIsPendingAuth(false);
        }
      } catch (err) {
        console.error('Error handling Google OAuth redirect result:', err);
        setIsPendingAuth(false);
      }
    };
    handleRedirect();
  }, [syncBooksFromDrive]);

  // Navigation states
  const [activeTab, setActiveTab] = useState<NavTabType>('sheet-view');
  const [sheetSubView, setSheetSubView] = useState<'excel' | 'cards'>('excel');
  const [analyticsSubView, setAnalyticsSubView] = useState<'cashflow' | 'charts'>('cashflow');

  // Preview & Modal states
  const [isMobilePreview, setIsMobilePreview] = useState<boolean>(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [isAndroidSpecModalOpen, setIsAndroidSpecModalOpen] = useState<boolean>(false);
  const [isManageBanksModalOpen, setIsManageBanksModalOpen] = useState<boolean>(false);
  const [isUserManagementModalOpen, setIsUserManagementModalOpen] = useState<boolean>(false);
  const [bookToEdit, setBookToEdit] = useState<SavingsBook | null>(null);
  const [selectedBookForDetail, setSelectedBookForDetail] = useState<SavingsBook | null>(null);

  const handleLeaveWorkspace = async () => {
    const token = getGoogleAccessToken();
    if (token && currentUser?.email) {
      try {
        await removeMemberFromDriveMaster(token, currentUser.email);
      } catch (err) {
        console.warn('Lỗi tự động xóa thành viên khỏi Master State trên Drive:', err);
      }
    }

    setExplicitlyUnlinked(true);

    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      currentRole: 'ADMIN',
      workspaceOwnerEmail: undefined,
      members: [],
    }));
    setBooks([]);
    showToast('Đã rời không gian chia sẻ thành công! Bạn hiện là Admin không gian cá nhân mới.', 'success');
  };

  // Switch tab with intelligent normalization
  const handleTabChange = (tab: NavTabType) => {
    if (tab === 'charts') {
      setActiveTab('analytics');
      setAnalyticsSubView('charts');
    } else if (tab === 'portfolio') {
      setActiveTab('sheet-view');
      setSheetSubView('cards');
    } else if (tab === 'android-spec') {
      setIsAndroidSpecModalOpen(true);
    } else {
      setActiveTab(tab);
    }
  };

  const handleOpenEdit = useCallback((book: SavingsBook) => {
    setBookToEdit(book);
    setIsAddModalOpen(true);
  }, []);

  const handleSelectForAnalysis = useCallback((book: SavingsBook) => {
    setSelectedBookForDetail(book);
  }, []);

  // Google Sign-in Handler for Offline User Transition
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState<boolean>(false);

  const handleLoginGoogle = async () => {
    if (isLoggingInGoogle) return;
    setIsLoggingInGoogle(true);
    try {
      const res = await signInWithGoogle();
      const onlineUser: AuthUser = {
        email: res.user.email || '',
        name: res.user.displayName || 'Chủ Tài Khoản',
        role: 'admin',
        title: 'Quản trị viên (Admin)',
        isOffline: false,
      };
      setCurrentUser(onlineUser);
      setIsUnlocked(true);
      if (res.accessToken) {
        setGoogleAccessToken(res.accessToken);
        syncBooksFromDrive(false, res.accessToken);
      }
      showToast(`Đã chuyển sang trực tuyến: ${onlineUser.email}`, 'success');
    } catch (err: any) {
      console.warn('Lỗi đăng nhập Google (đã xử lý):', err?.message || err);
      showToast(err?.message || 'Đăng nhập Google thất bại hoặc bị hủy.', 'error');
    } finally {
      setIsLoggingInGoogle(false);
    }
  };

  const clearSessionAndLocalData = () => {
    // 1. Đồng bộ xóa sạch mọi dữ liệu tài chính trong localStorage ngay lập tức để tránh race condition khi unmount
    try {
      localStorage.removeItem('savings_books_v3');
      localStorage.removeItem('savings_settlements_v3');
      localStorage.setItem('savings_books_cleared', 'true');
      localStorage.removeItem('savings_auth_user_v3');
      localStorage.removeItem('google_drive_access_token');
      localStorage.removeItem('google_drive_access_token_v4');
      sessionStorage.removeItem('google_drive_access_token_v4');
      
      // Xóa sạch dấu vết liên kết file để tránh liên kết tự động sau này
      localStorage.removeItem('last_linked_file_id_v2');
      localStorage.removeItem('master_pointer_file_id');
      localStorage.removeItem('master_sync_state_local_v2');
      
      const savedSettings = localStorage.getItem('savings_settings_v3');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        delete parsed.googleSheetUrl;
        delete parsed.googleSheetName;
        delete parsed.lastSyncTime;
        delete parsed.lastLocalLinkTimestamp;
        localStorage.setItem('savings_settings_v3', JSON.stringify(parsed));
      }
    } catch (err) {
      console.warn('Lỗi khi xóa sạch dữ liệu cục bộ khi đăng xuất:', err);
    }

    // 2. Xóa khỏi Capacitor Preferences để tránh tự động khôi phục phiên khi khởi động lại ứng dụng
    try {
      Preferences.remove({ key: 'savings_auth_user_v3' }).catch(() => {});
      Preferences.remove({ key: 'savings_books_v3' }).catch(() => {});
      Preferences.remove({ key: 'savings_settlements_v3' }).catch(() => {});
    } catch (err) {
      console.warn('Lỗi khi dọn dẹp Capacitor Preferences:', err);
    }

    // 3. Xóa cứng React State (Bỏ qua hoàn toàn canEditData check của hook) để dọn sạch dữ liệu hiển thị tức thì
    setBooks([]);
    setSettlementAdjustments([]);
    clearStaticHistoryFromStorage();

    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      lastSyncTime: undefined,
      lastLocalLinkTimestamp: undefined,
    }));
  };

  const handleDeleteAppDataAndUnlink = () => {
    try {
      // Xóa sạch dấu vết liên kết file & dữ liệu trong localStorage
      localStorage.removeItem('savings_books_v3');
      localStorage.removeItem('savings_settlements_v3');
      localStorage.setItem('savings_books_cleared', 'true');
      localStorage.removeItem('last_linked_file_id_v2');
      localStorage.removeItem('master_pointer_file_id');
      localStorage.removeItem('master_sync_state_local_v2');

      const savedSettings = localStorage.getItem('savings_settings_v3');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        delete parsed.googleSheetUrl;
        delete parsed.googleSheetName;
        delete parsed.lastSyncTime;
        delete parsed.lastLocalLinkTimestamp;
        localStorage.setItem('savings_settings_v3', JSON.stringify(parsed));
      }
    } catch (err) {
      console.warn('Lỗi khi xóa thông tin liên kết:', err);
    }

    // Xóa cứng React State để dọn sạch dữ liệu hiển thị tức thì
    setBooks([]);
    setSettlementAdjustments([]);
    clearStaticHistoryFromStorage();

    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      lastSyncTime: undefined,
      lastLocalLinkTimestamp: undefined,
    }));
  };

  // Logout Safeguard
  const handleRequestLogout = async () => {
    if (currentUser?.isOffline) {
      clearSessionAndLocalData();
      setCurrentUser(null);
      setIsUnlocked(false);
      setGoogleAccessToken(null);
      signOutGoogle().catch(() => {});
      return;
    }

    if (settings.googleSheetUrl) {
      setIsSyncingDrive(true);
      setSyncDriveStatus('Đang tự động đồng bộ dữ liệu mới nhất lên Google Drive trước khi đăng xuất...');
      try {
        // Tối đa 1.5 giây để đồng bộ, nếu quá thời gian hoặc lỗi mạng, buộc phải bỏ qua để logout lập tức để tránh treo UI
        const pushPromise = pushBooksToDrive(books);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Sync timeout')), 1500)
        );
        await Promise.race([pushPromise, timeoutPromise]);
        setSyncDriveStatus('Đã đồng bộ thành công lên Google Drive. Đã đăng xuất!');
      } catch (err: any) {
        console.warn('Bỏ qua đồng bộ trước đăng xuất do trễ hoặc lỗi mạng (an toàn):', err?.message || err);
      } finally {
        setIsSyncingDrive(false);
      }
      
      // Đăng xuất UI lập tức không chờ tác vụ mạng chặn UI
      clearSessionAndLocalData();
      setCurrentUser(null);
      setIsUnlocked(false);
      setGoogleAccessToken(null);
      signOutGoogle().catch(() => {});
      setTimeout(() => setSyncDriveStatus(null), 3000);
    } else {
      if (books.length > 0) {
        setIsLogoutWarningModalOpen(true);
      } else {
        clearSessionAndLocalData();
        setCurrentUser(null);
        setIsUnlocked(false);
        setGoogleAccessToken(null);
        signOutGoogle().catch(() => {});
      }
    }
  };

  const handleSaveBookFromModal = useCallback(
    (book: SavingsBook) => {
      handleSaveBook(book);
      setIsAddModalOpen(false);
      setBookToEdit(null);
      setActiveTab('sheet-view');
    },
    [handleSaveBook]
  );

  const handleLoginOnlineFromModal = useCallback(
    (user: AuthUser, token?: string) => {
      setCurrentUser(user);
      setIsUnlocked(true);
      if (token) {
        setGoogleAccessToken(token);
        syncBooksFromDrive(false, token);
      }
    },
    [syncBooksFromDrive]
  );

  const handleDriveFileNotFoundFromModal = useCallback(() => {
    setShowFileDeletedRecovery(true);
  }, []);

  const handleImportBooksFromModal = useCallback(
    (newBooks: SavingsBook[], mode: 'replace' | 'append') => {
      try {
        localStorage.removeItem('savings_books_cleared');
      } catch {
        // ignore
      }
      let updated: SavingsBook[];
      if (mode === 'replace') {
        updated = newBooks;
      } else {
        updated = [...books, ...newBooks];
      }
      setBooks(updated);
    },
    [books, setBooks]
  );

  const handleClearBooksFromModal = useCallback(() => {
    try {
      localStorage.setItem('savings_books_cleared', 'true');
      localStorage.setItem('savings_books_v3', JSON.stringify([]));
      localStorage.setItem('savings_settlements_v3', JSON.stringify([]));
      clearStaticHistoryFromStorage();
    } catch {
      // ignore
    }
    setBooks([]);
    setSettlementAdjustments([]);
  }, [setBooks, setSettlementAdjustments]);

  const handleTriggerManualSyncFromModal = useCallback(async () => {
    const token = getGoogleAccessToken() || undefined;
    await syncBooksFromDrive(true, token, true);
  }, [syncBooksFromDrive]);

  const handleUpdateBookFromModal = useCallback(
    (updatedBook: SavingsBook) => {
      handleUpdateBook(updatedBook);
      setSelectedBookForDetail(updatedBook);
    },
    [handleUpdateBook]
  );

  const handleSettleBookFromModal = useCallback(
    (
      bookId: string,
      extra?: { isEarlySettled: boolean; settlementDate: string; actualInterestVND: number }
    ) => {
      handleSettleBook(bookId, extra);
      setSelectedBookForDetail(null);
      setActiveTab('sheet-view');
      showToast('Đã tất toán sổ tiết kiệm thành công!');
    },
    [handleSettleBook, showToast]
  );

  const handleRolloverBookFromModal = useCallback(
    (
      oldBookId: string,
      config: {
        newPrincipal: number;
        newInterestRate: number;
        newTermMonths: number;
        newStartDate: string;
        newMaturityDate: string;
      }
    ) => {
      handleRolloverBook(oldBookId, config);
      setSelectedBookForDetail(null);
      setActiveTab('sheet-view');
      showToast('Đã tái tục sổ tiết kiệm thành công!');
    },
    [handleRolloverBook, showToast]
  );

  const handleBanksChangedFromModal = useCallback(() => {
    setBanksVersion((v) => v + 1);
  }, [setBanksVersion]);

  const handleConfirmLogoutAnyway = useCallback(async () => {
    setIsLogoutWarningModalOpen(false);
    
    // Đăng xuất UI và xóa dữ liệu lập tức (0ms delay)
    clearSessionAndLocalData();
    setCurrentUser(null);
    setIsUnlocked(false);
    setGoogleAccessToken(null);

    // Chạy ngầm dọn dẹp phiên Google/Firebase ngoài mạng để tối ưu tốc độ phản hồi
    signOutGoogle().catch((err) => console.warn('Background sign out warning:', err));
  }, []);

  const handleExportAndLogout = useCallback(async () => {
    const annualHistory = getDynamicAnnualInterestHistory(books, settlementAdjustments);
    const balanceHistory = getDynamicBalanceGrowthHistory(books, settlementAdjustments);
    
    // 1. Thực hiện xuất file Excel lưu về máy trước
    await exportSavingsBooksToExcel(books, `So_Tiet_Kiem_Gia_Dinh_Backup_${CURRENT_DATE}.xlsx`, annualHistory, balanceHistory);
    
    setIsLogoutWarningModalOpen(false);
    
    // 2. Đăng xuất UI lập tức
    clearSessionAndLocalData();
    setCurrentUser(null);
    setIsUnlocked(false);
    setGoogleAccessToken(null);

    // 3. Đăng xuất Google ngầm
    signOutGoogle().catch((err) => console.warn('Background sign out warning:', err));
  }, [books, settlementAdjustments]);

  // 4. Các hàm xử lý xung đột đồng bộ giữa sổ tiết kiệm ngoại tuyến và Google Drive
  const resolveConflictMerge = async () => {
    if (!conflictHub || !conflictToken || !conflictUser) return;
    setIsSyncingDrive(true);
    setSyncDriveStatus('Đang thực hiện gộp dữ liệu ngoại tuyến và tệp Google Drive...');
    const fileId = conflictHub.id;
    try {
      const res = await downloadRealGoogleDriveFile(conflictToken, fileId);
      if (res.success) {
        // Gộp danh sách sổ tiết kiệm (Union theo ID)
        const localBooks = books || [];
        const remoteBooks = res.books || [];
        const bookMap = new Map<string, SavingsBook>();
        remoteBooks.forEach((b: SavingsBook) => bookMap.set(b.id, b));
        localBooks.forEach((b: SavingsBook) => bookMap.set(b.id, b));
        const mergedBooks = sortAndReindexBooks(Array.from(bookMap.values()));

        // Gộp nhật ký tất toán (Union theo ID)
        const localAdjs = settlementAdjustments || [];
        const remoteAdjs = res.settlements || [];
        const adjMap = new Map<string, SettlementAdjustment>();
        remoteAdjs.forEach((a: SettlementAdjustment) => adjMap.set(a.id, a));
        localAdjs.forEach((a: SettlementAdjustment) => adjMap.set(a.id, a));
        const mergedAdjs = Array.from(adjMap.values());

        // Cập nhật React State cục bộ
        setBooks(mergedBooks);
        setSettlementAdjustments(mergedAdjs);

        // Thiết lập liên kết Google Sheet trong settings
        const hubUrl = conflictHub.webViewLink || `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
        setSettings((prev) => ({
          ...prev,
          googleSheetUrl: hubUrl,
          googleSheetName: conflictHub.name,
          lastLocalLinkTimestamp: conflictHub.linkedTimestamp || new Date().toISOString(),
        }));

        // Đẩy toàn bộ dữ liệu đã gộp ngược lên Drive trung tâm ngay lập tức
        await updateRealGoogleDriveFile(conflictToken, fileId, mergedBooks, mergedAdjs);
        const nowStr = new Date().toLocaleString('vi-VN');
        setSettings((prev) => ({ ...prev, lastSyncTime: nowStr }));

        showToast('Gộp dữ liệu thành công! Sổ cũ trên Drive và sổ ngoại tuyến mới đã được đồng bộ đồng nhất.', 'success');
      } else {
        showToast('Không thể tải dữ liệu cũ từ Google Drive để gộp. Vui lòng kiểm tra mạng.', 'error');
      }
    } catch (err: any) {
      console.error('Merge conflict error:', err);
      showToast('Lỗi khi gộp dữ liệu: ' + (err?.message || err), 'error');
    } finally {
      setIsSyncingDrive(false);
      setSyncDriveStatus(null);
      setConflictHub(null);
      setConflictToken(null);
      setConflictUser(null);
    }
  };

  const resolveConflictOverwriteLocal = async () => {
    if (!conflictHub || !conflictToken || !conflictUser) return;
    const fileId = conflictHub.id;
    const hubUrl = conflictHub.webViewLink || `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: hubUrl,
      googleSheetName: conflictHub.name,
      lastLocalLinkTimestamp: conflictHub.linkedTimestamp || new Date().toISOString(),
    }));
    setConflictHub(null);
    setConflictToken(null);
    setConflictUser(null);
    showToast('Đang thiết lập kết nối và tải toàn bộ sổ cũ từ Google Drive về máy...', 'info');
    setTimeout(() => {
      syncBooksFromDrive(false, conflictToken);
    }, 200);
  };

  const resolveConflictCreateNewFile = () => {
    setConflictHub(null);
    setConflictToken(null);
    setConflictUser(null);
    setIsSyncModalOpen(true);
    showToast('Vui lòng nhấp vào nút "Tạo file mới" hoặc "Chọn file" trong bảng đồng bộ.', 'info');
  };

  const resolveConflictClose = () => {
    // Trở lại chế độ ngoại tuyến bằng cách hủy phiên Google vừa đăng nhập
    setConflictHub(null);
    setConflictToken(null);
    setConflictUser(null);
    clearSessionAndLocalData();
    setCurrentUser(null);
    setIsUnlocked(false);
    setGoogleAccessToken(null);
    signOutGoogle().catch(() => {});
    showToast('Đã hủy đăng nhập Google. Bạn tiếp tục sử dụng app ở chế độ Ngoại tuyến.', 'info');
  };

  if (isPendingAuth && !currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white text-center space-y-4">
        <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto" />
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">Đang Hoàn Tất Đăng Nhập Google</h2>
          <p className="text-xs text-slate-400">Đang đồng bộ tài khoản và kết nối Google Drive...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginModal
          isOpen={true}
          onLogin={async (user, token) => {
            setCurrentUser(user);
            if (user.isOffline) {
              setIsUnlocked(true);
              setSyncDriveStatus(null);
              // Tiếp tục sử dụng dữ liệu sổ cũ đã có sẵn trên máy
            } else {
              setIsUnlocked(true);
              if (token) {
                setGoogleAccessToken(token);
                try {
                  // Kiểm tra xem tài khoản này đã có file liên kết trung tâm trên Google Drive chưa
                  const hub = await autoDiscoverLatestCentralHub(token, user.email);
                  if (hub && hub.id && (hub as any).status !== 'unlinked' && (hub as any).lastAction !== 'unlink') {
                    // Nếu thiết bị đang có sổ ngoại tuyến mới (books.length > 0), không tự động liên kết
                    // Mà hiển thị Modal giải quyết xung đột để người dùng lựa chọn (gộp, ghi đè hoặc tạo mới)
                    if (books.length > 0) {
                      setConflictHub(hub);
                      setConflictToken(token);
                      setConflictUser(user);
                    } else {
                      const hubUrl = hub.webViewLink || `https://docs.google.com/spreadsheets/d/${hub.id}/edit`;
                      setSettings((prev) => ({
                        ...prev,
                        googleSheetUrl: hubUrl,
                        googleSheetName: hub.name,
                        lastLocalLinkTimestamp: hub.linkedTimestamp || new Date().toISOString(),
                      }));
                      syncBooksFromDrive(false, token);
                    }
                  } else if (!settings.googleSheetUrl) {
                    // Mở modal đồng bộ để hỗ trợ tạo file liên kết mới hoặc chọn file có sẵn
                    setIsSyncModalOpen(true);
                  } else {
                    syncBooksFromDrive(false, token);
                  }
                } catch (err) {
                  console.warn('Auto discover central hub failed on login:', err);
                  if (!settings.googleSheetUrl) {
                    setIsSyncModalOpen(true);
                  } else {
                    syncBooksFromDrive(false, token);
                  }
                }
              } else {
                if (!settings.googleSheetUrl) {
                  setIsSyncModalOpen(true);
                } else {
                  syncBooksFromDrive(false);
                }
              }
            }
          }}
          currentVersion={CURRENT_APP_VERSION}
          onCheckUpdate={() => checkAppUpdate(true)}
          hasNewUpdate={!!updateInfo}
          newVersion={updateInfo?.version}
          onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
        />

        {/* APK Auto-Update Modal (Hiển thị đầy đủ ngay cả khi chưa đăng nhập) */}
        <AppUpdateModal
          isOpen={isUpdateModalOpen}
          currentVersion={CURRENT_APP_VERSION}
          updateInfo={updateInfo}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      {/* Biometric / Device Unlock Modal */}
      <BiometricUnlockModal
        isOpen={!isUnlocked && !!currentUser && !currentUser.isOffline}
        userName={currentUser?.name || ''}
        userEmail={currentUser?.email || ''}
        onSuccess={() => {
          setIsUnlocked(true);
          showToast('Xác thực Vân tay / Face ID thành công! Đã khôi phục phiên đăng nhập.', 'success');
        }}
        onCancel={() => {
          handleRequestLogout();
        }}
      />

        {/* Top Navbar */}
        <Navbar
          activeTab={activeTab}
          setActiveTab={handleTabChange}
          settings={settings}
          setSettings={setSettings}
          totalPrincipal={totalPrincipal}
          totalEstimatedInterest={totalEstimatedInterest}
          activeBooksCount={activeBooks.length}
          isMobilePreview={isMobilePreview}
          setIsMobilePreview={setIsMobilePreview}
          currentUser={currentUser}
          isSyncingDrive={isSyncingDrive}
          onLoginGoogle={handleLoginGoogle}
          isLoggingInGoogle={isLoggingInGoogle}
          onLogout={handleRequestLogout}
          onOpenAddModal={() => {
            setBookToEdit(null);
            setIsAddModalOpen(true);
          }}
          onOpenSyncModal={() => setIsSyncModalOpen(true)}
          onOpenAndroidSpec={() => setIsAndroidSpecModalOpen(true)}
          onOpenManageBanks={() => setIsManageBanksModalOpen(true)}
          onOpenClearDataModal={() => setIsClearDataModalOpen(true)}
          onOpenUserManagement={() => setIsUserManagementModalOpen(true)}
          onTriggerManualCheckUpdate={() => checkAppUpdate(true)}
          currentVersion={CURRENT_APP_VERSION}
        />

        {/* Main Content Area */}
        <main className="flex-1 py-3 sm:py-5 px-2 sm:px-6 max-w-7xl mx-auto w-full">
          {isMobilePreview ? (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="mb-3 flex items-center space-x-2 text-xs text-slate-500 bg-white px-3 py-1 rounded-full border shadow-xs">
                <Smartphone className="w-4 h-4 text-indigo-600" />
                <span>Đang xem mô phỏng trên Khung Điện Thoại Android (Material 3)</span>
              </div>

              {/* Android Device Shell */}
              <div className="w-full max-w-[440px] bg-slate-900 p-3.5 rounded-[44px] shadow-2xl border-4 border-slate-700 ring-1 ring-slate-900/50">
                <div className="w-32 h-4 bg-slate-950 rounded-full mx-auto mb-2 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-slate-800 mr-2" />
                  <div className="w-10 h-1 bg-slate-800 rounded-full" />
                </div>

                <div className="bg-slate-50 rounded-[32px] overflow-hidden min-h-[720px] max-h-[760px] overflow-y-auto p-3.5 space-y-4 text-slate-900">
                  {activeTab === 'sheet-view' && (
                    <BookListView
                      books={books}
                      filteredBooks={filteredBooks}
                      settings={settings}
                      currentDateStr={CURRENT_DATE}
                      settlementAdjustments={settlementAdjustments}
                      currentUser={currentUser}
                      sheetSubView={sheetSubView}
                      setSheetSubView={setSheetSubView}
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      ownerFilter={ownerFilter}
                      setOwnerFilter={setOwnerFilter}
                      bankFilter={bankFilter}
                      setBankFilter={setBankFilter}
                      sortBy={sortBy}
                      setSortBy={setSortBy}
                      sortedBanksInfo={sortedBanksInfo}
                      isSyncingDrive={isSyncingDrive}
                      onOpenSyncModal={() => setIsSyncModalOpen(true)}
                      onOpenAddModal={() => {
                        setBookToEdit(null);
                        setIsAddModalOpen(true);
                      }}
                      onOpenManageBanks={() => setIsManageBanksModalOpen(true)}
                      onSelectForAnalysis={handleSelectForAnalysis}
                      onOpenEdit={handleOpenEdit}
                      onDeleteBook={handleDeleteBook}
                      onOpenOptimizer={() => setActiveTab('optimizer')}
                      onOpenInterestCalc={() => setActiveTab('interest-calc')}
                      onSyncDrive={() => syncBooksFromDrive(true, undefined, true)}
                      onImportBooks={handleImportBooks}
                      onDeleteSettlement={handleDeleteSettlementAdjustment}
                    />
                  )}

                  {activeTab === 'optimizer' && (
                    <Suspense fallback={<TabLoadingFallback />}>
                      <MobilizationOptimizer
                        books={books}
                        currentDateStr={CURRENT_DATE}
                        settings={settings}
                        onOpenBookDetail={handleSelectForAnalysis}
                      />
                    </Suspense>
                  )}

                  {activeTab === 'analytics' && (
                    <Suspense fallback={<TabLoadingFallback />}>
                      <InterestCalculationView
                        books={books}
                        settings={settings}
                        currentDateStr={CURRENT_DATE}
                        settlements={settlementAdjustments}
                        onOpenOptimizer={() => setActiveTab('optimizer')}
                        onOpenSyncModal={() => setIsSyncModalOpen(true)}
                      />
                    </Suspense>
                  )}
                </div>

                <div className="w-28 h-1 bg-slate-600 rounded-full mx-auto mt-2" />
              </div>
            </div>
          ) : (
            <div>
              {activeTab === 'sheet-view' && (
                <BookListView
                  books={books}
                  filteredBooks={filteredBooks}
                  settings={settings}
                  currentDateStr={CURRENT_DATE}
                  settlementAdjustments={settlementAdjustments}
                  currentUser={currentUser}
                  sheetSubView={sheetSubView}
                  setSheetSubView={setSheetSubView}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  ownerFilter={ownerFilter}
                  setOwnerFilter={setOwnerFilter}
                  bankFilter={bankFilter}
                  setBankFilter={setBankFilter}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  banksVersion={banksVersion}
                  sortedBanksInfo={sortedBanksInfo}
                  isSyncingDrive={isSyncingDrive}
                  onOpenSyncModal={() => setIsSyncModalOpen(true)}
                  onOpenAddModal={() => {
                    setBookToEdit(null);
                    setIsAddModalOpen(true);
                  }}
                  onOpenManageBanks={() => setIsManageBanksModalOpen(true)}
                  onSelectForAnalysis={handleSelectForAnalysis}
                  onOpenEdit={handleOpenEdit}
                  onUpdateBook={handleUpdateBook}
                  onSettleBook={handleSettleBook}
                  onRolloverBook={handleRolloverBook}
                  onDeleteBook={handleDeleteBook}
                  onOpenOptimizer={() => setActiveTab('optimizer')}
                  onOpenInterestCalc={() => setActiveTab('interest-calc')}
                  onSyncDrive={() => syncBooksFromDrive(true, undefined, true)}
                  onImportBooks={handleImportBooks}
                />
              )}

              {activeTab === 'optimizer' && (
                <Suspense fallback={<TabLoadingFallback />}>
                  <MobilizationOptimizer
                    books={books}
                    currentDateStr={CURRENT_DATE}
                    settings={settings}
                    onOpenBookDetail={handleSelectForAnalysis}
                    onOpenSyncModal={() => setIsSyncModalOpen(true)}
                  />
                </Suspense>
              )}

              {(activeTab === 'analytics' || activeTab === 'interest-calc' || activeTab === 'timeline') && (
                <Suspense fallback={<TabLoadingFallback />}>
                  <InterestCalculationView
                    books={books}
                    settings={settings}
                    currentDateStr={CURRENT_DATE}
                    settlements={settlementAdjustments}
                    onOpenOptimizer={() => setActiveTab('optimizer')}
                    onOpenSyncModal={() => setIsSyncModalOpen(true)}
                  />
                </Suspense>
              )}
            </div>
          )}
        </main>

        {/* App Modals & Dialogs Container */}
        <AppModals
          isAddModalOpen={isAddModalOpen}
          setIsAddModalOpen={setIsAddModalOpen}
          bookToEdit={bookToEdit}
          onSaveBook={handleSaveBookFromModal}
          isSyncModalOpen={isSyncModalOpen}
          setIsSyncModalOpen={setIsSyncModalOpen}
          onLoginOnline={handleLoginOnlineFromModal}
          onDriveFileNotFound={handleDriveFileNotFoundFromModal}
          onImportBooks={handleImportBooksFromModal}
          onClearBooks={handleClearBooksFromModal}
          onTriggerManualSync={handleTriggerManualSyncFromModal}
          onMarkAsRemoteUpdate={markAsRemoteUpdate}
          selectedBookForDetail={selectedBookForDetail}
          setSelectedBookForDetail={setSelectedBookForDetail}
          onUpdateBook={handleUpdateBookFromModal}
          onSettleBook={handleSettleBookFromModal}
          onRolloverBook={handleRolloverBookFromModal}
          isAndroidSpecModalOpen={isAndroidSpecModalOpen}
          setIsAndroidSpecModalOpen={setIsAndroidSpecModalOpen}
          isManageBanksModalOpen={isManageBanksModalOpen}
          setIsManageBanksModalOpen={setIsManageBanksModalOpen}
          onBanksChanged={handleBanksChangedFromModal}
          isLogoutWarningModalOpen={isLogoutWarningModalOpen}
          setIsLogoutWarningModalOpen={setIsLogoutWarningModalOpen}
          onConfirmLogoutAnyway={handleConfirmLogoutAnyway}
          onExportAndLogout={handleExportAndLogout}
          showFileDeletedRecovery={showFileDeletedRecovery}
          setShowFileDeletedRecovery={setShowFileDeletedRecovery}
          onDeleteAppData={handleDeleteAppDataAndUnlink}
          onSetSyncDriveStatus={setSyncDriveStatus}
          onSetIsSyncingDrive={setIsSyncingDrive}
          onStartFileSwitch={startFileSwitch}
          onFinishFileSwitch={finishFileSwitch}
          onCancelFileSwitch={cancelFileSwitch}
          isClearDataModalOpen={isClearDataModalOpen}
          setIsClearDataModalOpen={setIsClearDataModalOpen}
          onClearAllAppData={handleDeleteAllAppData}
          isDriveTokenExpired={isDriveTokenExpired}
          setIsDriveTokenExpired={setIsDriveTokenExpired}
          onRenewDriveTokenAndSync={renewTokenAndSync}
          isUserManagementModalOpen={isUserManagementModalOpen}
          setIsUserManagementModalOpen={setIsUserManagementModalOpen}
          onLeaveWorkspace={handleLeaveWorkspace}
          books={books}
          setBooks={setBooks}
          settlementAdjustments={settlementAdjustments}
          settings={settings}
          setSettings={setSettings}
          currentUser={currentUser}
          currentDateStr={CURRENT_DATE}
        />

        {/* Footer */}
        <footer className="bg-white border-t border-slate-200 mt-auto py-4 px-4 text-center text-xs text-slate-400">
          <p>
            Sổ tiết kiệm &bull; Gửi gối đầu &bull; Tối ưu hóa huy động vốn tại Ngân hàng Việt Nam
          </p>
        </footer>

      {/* APK Auto-Update Modal */}
      <AppUpdateModal
        isOpen={isUpdateModalOpen}
        currentVersion={CURRENT_APP_VERSION}
        updateInfo={updateInfo}
        onClose={() => setIsUpdateModalOpen(false)}
      />

      {/* Login Sync Conflict Resolution Modal */}
      <LoginConflictResolveModal
        isOpen={!!conflictHub}
        onClose={resolveConflictClose}
        fileName={conflictHub?.name || 'Sổ tiết kiệm'}
        localBooksCount={books.length}
        onResolveMerge={resolveConflictMerge}
        onResolveOverwriteLocal={resolveConflictOverwriteLocal}
        onResolveCreateNewFile={resolveConflictCreateNewFile}
      />
    </div>
  );
}
