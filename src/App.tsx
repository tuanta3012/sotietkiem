/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
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
import {
  getGoogleAccessToken,
  setGoogleAccessToken,
  signOutGoogle,
  signInWithGoogle,
  initGoogleAuth,
  checkRedirectResult,
  autoDiscoverLatestCentralHub,
  removeMemberFromDriveMaster,
} from './utils/googleDriveService';
import { exportSavingsBooksToExcel } from './utils/excelParser';
import {
  getDynamicAnnualInterestHistory,
  getDynamicBalanceGrowthHistory,
  clearStaticHistoryFromStorage,
} from './data/historicalGrowth';
import { useDriveSync } from './hooks/useDriveSync';
import { useSavingsBooks } from './hooks/useSavingsBooks';
import { useToast } from './context/ToastContext';
import { scheduleMaturityNotifications } from './utils/notificationService';
import { PullToRefreshWrapper } from './components/PullToRefreshWrapper';

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

const CURRENT_APP_VERSION = '1.0.0';
const UPDATE_SERVER_URL = 'https://github.com/tuanta3012/sotietkiem/raw/refs/heads/main/version.json';

function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map(Number);
  const currParts = parse(current);
  const lateParts = parse(latest);
  for (let i = 0; i < Math.max(currParts.length, lateParts.length); i++) {
    const c = currParts[i] || 0;
    const l = lateParts[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}

const CURRENT_DATE = new Date().toISOString().split('T')[0];

export default function App() {
  const { showToast } = useToast();
  // Authentication state - Khôi phục cơ chế ghi nhớ phiên an toàn để tránh bị văng đột ngột khi thiết bị chạy ngầm hoặc reload trang
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
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
      if (savedUser) {
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

  // App settings state
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('savings_settings_v3');
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
          notificationsEnabled: parsed.notificationsEnabled ?? false,
          enableBiometricLogin: parsed.enableBiometricLogin ?? false,
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
    };
  });

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

  // 2. Tự động khôi phục phiên làm việc ngầm từ Capacitor Preferences khi mở/khởi động lại app
  useEffect(() => {
    const restoreSessionFromPreferences = async () => {
      try {
        if (!currentUser) {
          const { value: prefUser } = await Preferences.get({ key: 'savings_auth_user_v3' });
          if (prefUser) {
            const user = JSON.parse(prefUser);
            setCurrentUser(user);
          }
        }
        const token = getGoogleAccessToken();
        if (!token) {
          const { value: prefToken } = await Preferences.get({ key: 'savings_google_access_token' });
          if (prefToken) {
            setGoogleAccessToken(prefToken);
          }
        }
      } catch {
        // ignore
      }
    };
    restoreSessionFromPreferences();
  }, []);

  useEffect(() => {
    try {
      const json = JSON.stringify(settings);
      localStorage.setItem('savings_settings_v3', json);
      Preferences.set({ key: 'savings_settings_v3', value: json }).catch(() => {});
      if (!settings.googleSheetUrl) {
        clearStaticHistoryFromStorage();
      }
    } catch {
      // ignore
    }
  }, [settings]);

  useEffect(() => {
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
  }, [currentUser]);

  // 3. Tự động kiểm tra cập nhật APK từ xa
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    downloadUrl?: string;
    apkUrl?: string;
    changelog: string[];
    releaseDate?: string;
  } | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);

  const checkAppUpdate = useCallback(async (manual: boolean = false) => {
    if (manual) {
      showToast('Đang kết nối tới máy chủ GitHub kiểm tra phiên bản mới...', 'info');
    }
    try {
      const res = await fetch(`${UPDATE_SERVER_URL}?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const latestVersion = data.version || data.versionName;
        if (data && latestVersion) {
          const isNewer = isNewerVersion(CURRENT_APP_VERSION, latestVersion);
          if (isNewer) {
            setUpdateInfo({
              version: latestVersion,
              downloadUrl: data.downloadUrl || data.apkUrl || 'https://github.com/tuanta3012/sotietkiem/releases',
              apkUrl: data.apkUrl || data.downloadUrl,
              changelog: Array.isArray(data.changelog)
                ? data.changelog
                : (data.changelog ? [data.changelog] : ['Nâng cấp hiệu năng và khắc phục lỗi hệ thống.']),
              releaseDate: data.releaseDate || data.date,
            });
            setIsUpdateModalOpen(true);
            if (manual) {
              showToast(`Đã tìm thấy bản cập nhật mới v${latestVersion}!`, 'success');
            }
          } else {
            if (manual) {
              showToast(`Bạn đang sử dụng phiên bản APK mới nhất (v${CURRENT_APP_VERSION}).`, 'success', 4000);
            }
          }
        } else {
          if (manual) {
            showToast('Dữ liệu phiên bản trên GitHub không đầy đủ hoặc bị lỗi.', 'error', 4000);
          }
        }
      } else {
        if (manual) {
          showToast(`Không thể kết nối đến GitHub (HTTP ${res.status}).`, 'error', 4000);
        }
      }
    } catch (err: any) {
      console.warn('Lỗi kiểm tra cập nhật APK:', err);
      if (manual) {
        showToast('Không thể kết nối tới máy chủ GitHub. Vui lòng kiểm tra lại kết nối Internet.', 'error', 4000);
      }
    }
  }, [showToast]);

  useEffect(() => {
    // Tự động kiểm tra cập nhật APK sau 2 giây khi khởi chạy
    const timer = setTimeout(() => {
      checkAppUpdate(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [checkAppUpdate]);

  // Giữ phiên Google OAuth và Firebase Auth luôn đồng bộ bền vững khi mở app hoặc refresh trang
  useEffect(() => {
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
  }, []);

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
          syncBooksFromDrive(false, redirectRes.accessToken);
        }
      } catch (err) {
        console.error('Error handling Google OAuth redirect result:', err);
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

    try {
      sessionStorage.setItem('explicitly_unlinked', 'true');
      localStorage.setItem('explicitly_unlinked', 'true');
    } catch {}

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

  // Google Sign-in Handler
  const handleLoginGoogle = async () => {
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
    } catch (err: any) {
      console.warn('Lỗi đăng nhập Google (đã xử lý):', err?.message || err);
    }
  };

  const clearSessionAndLocalData = () => {
    handleDeleteAllAppData();
    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      lastSyncTime: undefined,
      lastLocalLinkTimestamp: undefined,
    }));
    try {
      localStorage.removeItem('savings_auth_user_v3');
      localStorage.removeItem('google_drive_access_token');
      localStorage.removeItem('google_drive_access_token_v4');
      sessionStorage.removeItem('google_drive_access_token_v4');
      
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
  };

  const handleDeleteAppDataAndUnlink = () => {
    handleDeleteAllAppData();
    setSettings((prev) => ({
      ...prev,
      googleSheetUrl: undefined,
      googleSheetName: undefined,
      lastSyncTime: undefined,
      lastLocalLinkTimestamp: undefined,
    }));
    try {
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
  };

  // Logout Safeguard
  const handleRequestLogout = async () => {
    if (currentUser?.isOffline) {
      await signOutGoogle();
      clearSessionAndLocalData();
      setCurrentUser(null);
      setIsUnlocked(false);
      setGoogleAccessToken(null);
      return;
    }

    if (settings.googleSheetUrl) {
      setIsSyncingDrive(true);
      setSyncDriveStatus('Đang tự động đồng bộ dữ liệu mới nhất lên Google Drive trước khi đăng xuất...');
      try {
        await pushBooksToDrive(books);
        setSyncDriveStatus('Đã đồng bộ thành công lên Google Drive. Đã đăng xuất!');
      } catch (err: any) {
        console.error('Lỗi tự động đồng bộ trước khi đăng xuất:', err);
      } finally {
        setIsSyncingDrive(false);
      }
      await signOutGoogle();
      clearSessionAndLocalData();
      setCurrentUser(null);
      setIsUnlocked(false);
      setGoogleAccessToken(null);
      setTimeout(() => setSyncDriveStatus(null), 3000);
    } else {
      if (books.length > 0) {
        setIsLogoutWarningModalOpen(true);
      } else {
        await signOutGoogle();
        clearSessionAndLocalData();
        setCurrentUser(null);
        setIsUnlocked(false);
        setGoogleAccessToken(null);
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
    await signOutGoogle();
    clearSessionAndLocalData();
    setCurrentUser(null);
    setIsUnlocked(false);
    setGoogleAccessToken(null);
  }, []);

  const handleExportAndLogout = useCallback(async () => {
    const annualHistory = getDynamicAnnualInterestHistory(books, settlementAdjustments);
    const balanceHistory = getDynamicBalanceGrowthHistory(books, settlementAdjustments);
    await exportSavingsBooksToExcel(books, `So_Tiet_Kiem_Gia_Dinh_Backup_${CURRENT_DATE}.xlsx`, annualHistory, balanceHistory);
    setIsLogoutWarningModalOpen(false);
    await signOutGoogle();
    clearSessionAndLocalData();
    setCurrentUser(null);
    setIsUnlocked(false);
    setGoogleAccessToken(null);
  }, [books, settlementAdjustments]);

  if (!currentUser) {
    return (
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
                  const hubUrl = hub.webViewLink || `https://docs.google.com/spreadsheets/d/${hub.id}/edit`;
                  setSettings((prev) => ({
                    ...prev,
                    googleSheetUrl: hubUrl,
                    googleSheetName: hub.name,
                    lastLocalLinkTimestamp: hub.linkedTimestamp || new Date().toISOString(),
                  }));
                  syncBooksFromDrive(false, token);
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
      />
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

      <PullToRefreshWrapper
        onRefresh={async () => {
          await syncBooksFromDrive(true, undefined, true);
          showToast('Đã làm mới dữ liệu từ Google Drive thành công!', 'success', 3000);
        }}
      >
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
            Quản Lý Sổ Tiết Kiệm Gia Đình &bull; Gửi gối đầu &bull; Tối ưu hóa huy động vốn tại Ngân hàng Việt Nam
          </p>
        </footer>
      </PullToRefreshWrapper>

      {/* APK Auto-Update Modal */}
      <AppUpdateModal
        isOpen={isUpdateModalOpen}
        currentVersion={CURRENT_APP_VERSION}
        updateInfo={updateInfo}
        onClose={() => setIsUpdateModalOpen(false)}
      />
    </div>
  );
}
