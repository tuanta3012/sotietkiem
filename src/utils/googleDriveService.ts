import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  setPersistence,
  browserLocalPersistence,
  signInWithCredential,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { SavingsBook, SettlementAdjustment, WorkspaceMember, UserRole, AppSettings, MasterSyncState } from '../types';
import { parseWorkbook, parseMatrixData, getSavingsExcelArrayBuffer, ParseExcelResult } from './excelParser';
import { translateBooksToSheetMatrix, translateBooksToDataRows, deduplicateSettlementAdjustments, translateDateToSheet } from './dataTranslator';
import { getOwnerLabel } from './formatters';
import {
  DEFAULT_HISTORICAL_ANNUALS,
  DEFAULT_HISTORICAL_BALANCES,
  getDynamicAnnualInterestHistory,
  getDynamicBalanceGrowthHistory,
  loadStaticHistoryFromStorage,
  saveStaticHistoryToStorage,
} from '../data/historicalGrowth';
import { recordSyncAuditLog } from './syncAuditLog';
import { getBankShortCode } from '../data/banks';
import {
  getWorkspaceMasterStateFromFirestore,
  saveWorkspaceMasterStateToFirestore,
} from './firebaseFirestoreService';

// Web Client ID chuẩn (client_type = 3) dùng cho Google Authentication trên Capacitor Android Native
const WEB_CLIENT_ID = '864440372329-fgoo891qp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure local persistence to keep user logged in across refreshes
try {
  setPersistence(auth, browserLocalPersistence);
} catch (e) {
  console.warn('Could not set persistence:', e);
}

// Provider with requested Drive & Sheets scopes
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');

// Check if user has migrated to drive.file scope
const isScopeMigrated = (() => {
  try {
    return localStorage.getItem('drive_scope_migrated_v2') === 'true';
  } catch {
    return false;
  }
})();

provider.setCustomParameters({
  prompt: isScopeMigrated ? 'select_account' : 'consent',
});

// Storage Keys for persistent Google OAuth tokens and metadata
const TOKEN_KEY = 'google_drive_access_token_v4';
const TOKEN_EXPIRES_AT_KEY = 'google_drive_token_expires_at';
const REFRESH_TOKEN_KEY = 'google_drive_refresh_token_v4';
const ID_TOKEN_KEY = 'google_drive_id_token_v4';
const USER_PROFILE_KEY = 'google_drive_user_profile_v4';
const MASTER_POINTER_FILE_ID_KEY = 'master_pointer_file_id';

let cachedAccessToken: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
})();
let isSigningIn = false;

export interface RealDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  isSheetOrExcel: boolean;
  isCentralHub?: boolean;
  linkedTimestamp?: string;
}

/**
 * Get current access token (reads from memory or localStorage)
 */
export function getGoogleAccessToken(): string | null {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      cachedAccessToken = saved;
      return saved;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Get current refresh token
 */
export function getGoogleRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Get current ID token
 */
export function getGoogleIdToken(): string | null {
  try {
    return localStorage.getItem(ID_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Get current user profile
 */
export function getGoogleUserProfile(): any | null {
  try {
    const saved = localStorage.getItem(USER_PROFILE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

/**
 * Check if the stored Google access token is valid and not expired
 */
export function isGoogleTokenValid(): boolean {
  const token = getGoogleAccessToken();
  if (!token) return false;
  try {
    const expiresAtStr = localStorage.getItem(TOKEN_EXPIRES_AT_KEY);
    if (!expiresAtStr) {
      // Nếu có token nhưng chưa lưu timestamp hết hạn (hoặc phiên cũ), gán mặc định 60 phút
      const defaultExpires = Date.now() + 3500 * 1000;
      localStorage.setItem(TOKEN_EXPIRES_AT_KEY, defaultExpires.toString());
      return true;
    }
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt)) return true;
    // Token hợp lệ đến đúng thời điểm hết hạn (trừ 10 giây dự phòng)
    return Date.now() < (expiresAt - 10000);
  } catch {
    return true;
  }
}

/**
 * Set in-memory and localStorage access token
 */
export function setGoogleAccessToken(token: string | null, expiresAtMs?: number) {
  cachedAccessToken = token;
  try {
    if (token) {
      const expiresAt = expiresAtMs 
        ? expiresAtMs.toString() 
        : (Date.now() + 3500 * 1000).toString();
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRES_AT_KEY, expiresAt);
      localStorage.setItem('google_drive_ever_logged_in', 'true');
      Preferences.set({ key: TOKEN_KEY, value: token }).catch(() => {});
      Preferences.set({ key: TOKEN_EXPIRES_AT_KEY, value: expiresAt }).catch(() => {});
      Preferences.set({ key: 'google_drive_ever_logged_in', value: 'true' }).catch(() => {});
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
      localStorage.removeItem('google_drive_ever_logged_in');
      Preferences.remove({ key: TOKEN_KEY }).catch(() => {});
      Preferences.remove({ key: TOKEN_EXPIRES_AT_KEY }).catch(() => {});
      Preferences.remove({ key: 'google_drive_ever_logged_in' }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

/**
 * Centralized saver for Google OAuth session parameters
 */
export function saveGoogleAuthSession(session: {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userProfile?: {
    email?: string;
    name?: string;
    photoUrl?: string;
  }
}) {
  try {
    if (session.accessToken) {
      setGoogleAccessToken(session.accessToken, session.expiresAt);
    }
    if (session.idToken) {
      localStorage.setItem(ID_TOKEN_KEY, session.idToken);
      Preferences.set({ key: ID_TOKEN_KEY, value: session.idToken }).catch(() => {});
    }
    if (session.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
      Preferences.set({ key: REFRESH_TOKEN_KEY, value: session.refreshToken }).catch(() => {});
    }
    if (session.userProfile) {
      const json = JSON.stringify(session.userProfile);
      localStorage.setItem(USER_PROFILE_KEY, json);
      Preferences.set({ key: USER_PROFILE_KEY, value: json }).catch(() => {});
    }
  } catch (err) {
    console.warn('Error saving Google Auth Session:', err);
  }
}

/**
 * Attempt to silently refresh Google credentials without showing popups/consents.
 * Returns the fresh accessToken if successful, or null if interactive re-auth is needed.
 */
export async function trySilentRefresh(): Promise<string | null> {
  // If the token is already valid, return it instantly
  if (isGoogleTokenValid()) {
    return getGoogleAccessToken();
  }

  // 1. Silent Refresh on Native Platforms (Android/iOS)
  if (Capacitor.isNativePlatform()) {
    console.info('[Silent Auth] Đang gia hạn phiên làm việc ngầm trên Native...');
    try {
      try {
        await GoogleAuth.initialize({
          clientId: WEB_CLIENT_ID,
          scopes: [
            'email',
            'profile',
            'openid',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets'
          ],
          grantOfflineAccess: true,
        });
      } catch (e) {
        // ignore initialization warning
      }

      // Try silent refresh using offline refresh token
      try {
        const refreshResult = await GoogleAuth.refresh();
        if (refreshResult && refreshResult.accessToken) {
          console.info('[Silent Auth] Gia hạn thành công bằng GoogleAuth.refresh()');
          const expiresAt = Date.now() + 3500 * 1000;
          saveGoogleAuthSession({
            accessToken: refreshResult.accessToken,
            idToken: refreshResult.idToken || undefined,
            expiresAt,
          });
          return refreshResult.accessToken;
        }
      } catch (refreshErr) {
        console.warn('[Silent Auth] GoogleAuth.refresh() failed, trying silent signIn next...', refreshErr);
      }

      // Fallback: GoogleAuth.signIn() automatically logs in silently if session is intact
      const nativeResult = await GoogleAuth.signIn();
      const idToken = nativeResult.authentication?.idToken || (nativeResult as any).idToken;
      const accessToken = nativeResult.authentication?.accessToken || (nativeResult as any).accessToken;
      const refreshToken = nativeResult.authentication?.refreshToken || (nativeResult as any).refreshToken;

      if (accessToken && idToken) {
        console.info('[Silent Auth] Gia hạn thành công bằng GoogleAuth.signIn() ngầm');
        const expiresAt = Date.now() + 3500 * 1000;

        // Sync with Firebase Auth in the background
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        await signInWithCredential(auth, credential).catch((fbErr) => {
          console.warn('[Silent Auth] Firebase Auth silent sync failed:', fbErr);
        });

        saveGoogleAuthSession({
          accessToken,
          idToken,
          refreshToken: refreshToken || getGoogleRefreshToken() || undefined,
          expiresAt,
          userProfile: {
            email: (nativeResult as any).email || undefined,
            name: (nativeResult as any).displayName || undefined,
            photoUrl: (nativeResult as any).imageUrl || undefined,
          }
        });

        return accessToken;
      }
    } catch (nativeErr) {
      console.warn('[Silent Auth] Native silent refresh/login failed:', nativeErr);
    }
  }

  // 2. Web Platform / AI Studio Preview Flow
  return null;
}

/**
 * Initialize Auth State Listener with background startup silent-refresh
 */
export const initGoogleAuth = (
  onSuccess?: (user: User, token: string | null) => void,
  onSignedOut?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      let token = getGoogleAccessToken();
      if (!token || !isGoogleTokenValid()) {
        console.info('[initGoogleAuth] Token is missing or expired, running silent refresh...');
        const refreshed = await trySilentRefresh();
        if (refreshed) {
          token = refreshed;
        }
      }
      if (onSuccess) onSuccess(user, token);
    } else {
      const everLoggedIn = localStorage.getItem('google_drive_ever_logged_in') === 'true';
      if (everLoggedIn) {
        console.info('[initGoogleAuth] User is not in Firebase Auth but everLoggedIn is true, attempting silent restore...');
        const silentToken = await trySilentRefresh();
        if (silentToken && auth.currentUser) {
          if (onSuccess) onSuccess(auth.currentUser, silentToken);
          return;
        }
      }
      cachedAccessToken = null;
      if (onSignedOut) onSignedOut();
    }
  });
};

/**
 * Check if the application is running inside an iframe (like AI Studio preview)
 */
export const isRunningInIframe = (): boolean => {
  if (Capacitor.isNativePlatform()) {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

/**
 * Check if the user is returning from a Google OAuth redirect
 */
export const checkRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (Capacitor.isNativePlatform()) {
    return null;
  }
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        const expiresAt = Date.now() + 3500 * 1000;
        saveGoogleAuthSession({
          accessToken: credential.accessToken,
          idToken: credential.idToken || undefined,
          expiresAt,
          userProfile: {
            email: result.user.email || undefined,
            name: result.user.displayName || undefined,
            photoUrl: result.user.photoURL || undefined,
          }
        });
        localStorage.setItem('drive_scope_migrated_v2', 'true');
        provider.setCustomParameters({ prompt: 'select_account' });
        return {
          user: result.user,
          accessToken: credential.accessToken,
        };
      }
    }
  } catch (error: any) {
    console.error('Error checking Google redirect result:', error);
  }
  return null;
};

/**
 * Sign in using Google Redirect (Fallback for popup blocked environments)
 */
export const signInWithGoogleRedirect = async (): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    await signInWithGoogle();
    return;
  }
  if (isRunningInIframe()) {
    window.open(window.location.href, '_blank');
    throw new Error('Đã mở ứng dụng ở thẻ (tab) trình duyệt mới để đăng nhập Google an toàn.');
  }
  await signInWithRedirect(auth, provider);
};

/**
 * Sign in with Google Popup and obtain real OAuth Access Token
 */
export const signInWithGoogle = async (autoFallbackToRedirect = false): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;

    // 1. Native App (Capacitor) Flow
    if (Capacitor.isNativePlatform()) {
      console.info('[Google Sign-In] Khởi chạy GoogleAuth trên thiết bị Native App...');
      try {
        await GoogleAuth.initialize({
          clientId: WEB_CLIENT_ID,
          scopes: [
            'email',
            'profile',
            'openid',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets'
          ],
          grantOfflineAccess: false,
        });
      } catch (initErr) {
        console.warn('GoogleAuth.initialize warn/error:', initErr);
      }

      let nativeResult: any;
      try {
        nativeResult = await GoogleAuth.signIn();
      } catch (signInErr: any) {
        console.error('[Google Sign-In Native Error]', signInErr);
        const rawMsg = String(signInErr?.message || signInErr || '');
        if (rawMsg.includes('Something went wrong') || rawMsg.includes('10') || rawMsg.includes('12500')) {
          throw new Error('Lỗi xác thực Google trên Android (Mã 10: Mã SHA-1 của APK hoặc Client ID chưa khớp với cấu hình Firebase). Bạn có thể bấm nút "Sử dụng ngay" để dùng toàn bộ tính năng ngoại tuyến.');
        }
        if (rawMsg.includes('canceled') || rawMsg.includes('12501') || rawMsg.includes('closed')) {
          throw new Error('Bạn đã hủy thao tác đăng nhập Google.');
        }
        throw new Error(rawMsg || 'Đăng nhập Google trên thiết bị Android không thành công.');
      }

      const idToken = nativeResult.authentication?.idToken || (nativeResult as any).idToken;
      const accessToken = nativeResult.authentication?.accessToken || (nativeResult as any).accessToken;
      const refreshToken = nativeResult.authentication?.refreshToken || (nativeResult as any).refreshToken;

      if (!idToken) {
        throw new Error('Không nhận được ID Token từ Google Authentication gốc.');
      }
      if (!accessToken) {
        throw new Error('Không nhận được Access Token từ Google Authentication gốc.');
      }

      console.info('[Google Sign-In] Đang xác thực với Firebase bằng Google Credential...');
      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      const firebaseUserCredential = await signInWithCredential(auth, credential);
      const user = firebaseUserCredential.user;

      const expiresAt = Date.now() + 3500 * 1000;
      saveGoogleAuthSession({
        accessToken,
        idToken,
        refreshToken: refreshToken || undefined,
        expiresAt,
        userProfile: {
          email: (nativeResult as any).email || undefined,
          name: (nativeResult as any).displayName || undefined,
          photoUrl: (nativeResult as any).imageUrl || undefined,
        }
      });
      localStorage.setItem('drive_scope_migrated_v2', 'true');

      return {
        user,
        accessToken,
      };
    }

    // 2. Web / AI Studio Preview Flow
    if (isRunningInIframe()) {
      window.open(window.location.href, '_blank');
      throw new Error('Khung xem trước AI Studio chặn cửa sổ bật lên (popup) của Google. Ứng dụng đã tự động mở sang Tab trình duyệt mới để bạn đăng nhập Google an toàn.');
    }
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error('Không nhận được mã truy cập (Access Token) từ Google Authentication.');
    }

    const expiresAt = Date.now() + 3500 * 1000;
    saveGoogleAuthSession({
      accessToken: credential.accessToken,
      idToken: credential.idToken || undefined,
      expiresAt,
      userProfile: {
        email: result.user.email || undefined,
        name: result.user.displayName || undefined,
        photoUrl: result.user.photoURL || undefined,
      }
    });
    localStorage.setItem('drive_scope_migrated_v2', 'true');
    provider.setCustomParameters({ prompt: 'select_account' });

    return {
      user: result.user,
      accessToken: credential.accessToken,
    };
  } catch (error: any) {
    if (error?.message?.includes('Khung xem trước') || error?.message?.includes('Tab trình duyệt')) {
      console.info('Opened application in new tab for Google auth:', error.message);
      throw error;
    }
    if (error?.code === 'auth/popup-blocked' || error?.message?.includes('popup-blocked')) {
      console.warn('Google Sign In popup blocked:', error?.message);
      if (autoFallbackToRedirect && !isRunningInIframe()) {
        try {
          await signInWithRedirect(auth, provider);
          throw new Error('Đang chuyển hướng sang trang đăng nhập Google...');
        } catch (redirectErr: any) {
          console.warn('Redirect sign-in error:', redirectErr);
        }
      }
      throw new Error(error?.message?.includes('mở sang Tab trình duyệt mới') ? error.message : 'Trình duyệt hoặc khung xem trước (iframe) đã chặn cửa sổ bật lên (popup). Vui lòng bấm nút "Mở ở Tab mới" bên dưới để đăng nhập Google.');
    }
    if (error?.code === 'auth/popup-closed-by-user' || error?.message?.includes('popup-closed-by-user')) {
      console.warn('Google Sign In popup closed by user');
      throw new Error('Đã đóng cửa sổ đăng nhập Google.');
    }
    if (error?.code === 'auth/cancelled-popup-request' || error?.message?.includes('cancelled-popup-request')) {
      console.warn('Google Sign In cancelled popup request');
      throw new Error('Yêu cầu mở cửa sổ đăng nhập Google bị hủy do có cửa sổ khác đang mở.');
    }
    console.warn('Google Sign In Notice:', error?.message || error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Ensure valid token or trigger sign-in
 */
export async function ensureGoogleAccessToken(): Promise<string> {
  const silentToken = await trySilentRefresh();
  if (silentToken) return silentToken;

  const res = await signInWithGoogle();
  return res.accessToken;
}

/**
 * Actively validate the token by checking validity first, then making a test API call if needed.
 */
export async function validateAndEnsureToken(): Promise<string> {
  const silentToken = await trySilentRefresh();
  if (silentToken) {
    try {
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',
        {
          headers: {
            Authorization: `Bearer ${silentToken}`,
          },
        }
      );
      if (response.ok) {
        return silentToken;
      }
    } catch (err) {
      console.warn('[Google Drive Auth] Test API validation check failed:', err);
    }
  }

  // Fallback: full interactive sign-in
  setGoogleAccessToken(null);
  const res = await signInWithGoogle();
  return res.accessToken;
}

/**
 * Sign out (removes all saved tokens, sessions, and credentials)
 */
export async function signOutGoogle(): Promise<void> {
  try {
    await signOut(auth);
  } finally {
    cachedAccessToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(ID_TOKEN_KEY);
      localStorage.removeItem(USER_PROFILE_KEY);
      localStorage.removeItem('google_drive_ever_logged_in');
      localStorage.removeItem(MASTER_POINTER_FILE_ID_KEY);

      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Helper to format file bytes to KB / MB
 */
export const formatFileSizeBytes = (bytes?: string | number): string => {
  if (!bytes) return '0 KB';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num)) return '0 KB';
  if (num >= 1024 * 1024) {
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(num / 1024))} KB`;
};

/**
 * A highly robust fetch wrapper that handles transient network dropouts with exponential backoff retries.
 */
async function fetchWithRetry(url: string | URL, options?: RequestInit, retries = 3, delay = 1000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const mergedOptions: RequestInit = {
    ...options,
    signal: options?.signal || controller.signal,
  };

  try {
    const response = await fetch(url.toString(), mergedOptions);
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    const isNetworkOrBlocked = 
      error instanceof TypeError || 
      error?.name === 'AbortError' ||
      error?.message?.includes('Failed to fetch') || 
      error?.message?.includes('network') || 
      error?.message?.includes('aborted') ||
      !navigator.onLine;

    if (isNetworkOrBlocked) {
      if (retries > 0) {
        console.warn(`Fetch failed for ${url}. Retrying in ${delay}ms... (${retries} retries left). Error: ${error?.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1, delay * 2);
      }
      
      const isIframe = window.self !== window.top;
      let adblockWarning = 'Lỗi kết nối (Failed to fetch). ';
      if (error?.name === 'AbortError') {
        adblockWarning += 'Kết nối tới Google Drive bị quá thời gian chờ (Timeout sau 15s). Vui lòng kiểm tra kết nối mạng và thử lại.';
      } else if (isIframe) {
        adblockWarning += 'Trình duyệt hoặc phần mềm chặn quảng cáo đã chặn kết nối Google Drive API từ môi trường xem trước. Vui lòng mở trong tab mới.';
      } else {
        adblockWarning += 'Không thể kết nối tới máy chủ Google Drive. Vui lòng kiểm tra lại đường truyền internet.';
      }
      throw new Error(adblockWarning);
    }
    throw error;
  }
}

/**
 * List real files from the user's Google Drive
 */
export async function listRealGoogleDriveFiles(
  accessToken: string,
  searchKeyword?: string
): Promise<RealDriveFile[]> {
  try {
    let query = "trashed = false";
    
    if (searchKeyword && searchKeyword.trim()) {
      const sanitized = searchKeyword.replace(/'/g, "\\'");
      query += ` and name contains '${sanitized}'`;
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink, shared)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('q', query);

    const res = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      const errorData = await res.json().catch(() => ({}));
      if (errorData?.error?.status === 'UNAUTHENTICATED' || errorData?.error?.code === 401 || errorData?.error?.message?.includes('invalid authentication credentials')) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      throw new Error(errorData?.error?.message || `Lỗi từ Google Drive API (Mã ${res.status})`);
    }

    const data = await res.json();
    const rawFiles: any[] = data.files || [];

    const masterState = await getMasterSyncStateFromDrive(accessToken).catch(() => null);
    const activeFileId = masterState && masterState.status === 'active' ? masterState.activeFileId : null;

    const files = rawFiles.filter((f) => {
      const isGSheet = f.mimeType === 'application/vnd.google-apps.spreadsheet';
      const isExcel =
        f.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        f.mimeType === 'application/vnd.ms-excel' ||
        f.name.toLowerCase().endsWith('.xlsx') ||
        f.name.toLowerCase().endsWith('.xls');
      const isCsv = f.mimeType === 'text/csv' || f.name.toLowerCase().endsWith('.csv');
      const isJsonMaster = f.name === 'so_tiet_kiem_backup.json' || f.name.endsWith('.json');
      return isGSheet || isExcel || isCsv || isJsonMaster;
    });

    const mappedFiles: RealDriveFile[] = files.map((f) => {
      const isGSheet = f.mimeType === 'application/vnd.google-apps.spreadsheet';
      const isExcel =
        f.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        f.mimeType === 'application/vnd.ms-excel' ||
        f.name.toLowerCase().endsWith('.xlsx') ||
        f.name.toLowerCase().endsWith('.xls');
      const isCsv = f.mimeType === 'text/csv' || f.name.toLowerCase().endsWith('.csv');

      const isHub = activeFileId === f.id;
      const linkedTimestamp = isHub ? masterState?.linkedTimestamp : undefined;

      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        size: formatFileSizeBytes(f.size),
        webViewLink: f.webViewLink || (isGSheet ? `https://docs.google.com/spreadsheets/d/${f.id}/edit` : `https://drive.google.com/file/d/${f.id}/view`),
        iconLink: f.iconLink,
        isSheetOrExcel: isGSheet || isExcel || isCsv,
        isCentralHub: isHub,
        linkedTimestamp,
      };
    });

    mappedFiles.sort((a, b) => {
      if (a.isCentralHub && !b.isCentralHub) return -1;
      if (!a.isCentralHub && b.isCentralHub) return 1;
      return 0;
    });

    return mappedFiles;
  } catch (error: any) {
    if (error?.message?.includes('hết hạn') || error?.message?.includes('invalid authentication credentials')) {
      console.warn('Lỗi phiên đăng nhập Google Drive:', error.message);
    } else {
      console.error('Lỗi khi tải danh sách file Google Drive:', error);
    }
    throw error;
  }
}

/**
 * Get metadata (name, mimeType, webViewLink) of a specific file from Google Drive / Sheets
 */
export async function getRealGoogleDriveFileMetadata(
  accessToken: string,
  fileId: string
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  version?: string;
  isDeleted?: boolean;
} | null> {
  if (!accessToken || !fileId) return null;
  try {
    const driveRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,modifiedTime,version,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (driveRes.status === 404) {
      return { id: fileId, name: '', mimeType: '', isDeleted: true };
    }
    if (driveRes.ok) {
      const data = await driveRes.json();
      if (data?.trashed) {
        return { id: fileId, name: data.name || '', mimeType: '', isDeleted: true };
      }
      if (data?.name) {
        return {
          id: data.id || fileId,
          name: data.name,
          mimeType: data.mimeType || '',
          webViewLink: data.webViewLink,
          modifiedTime: data.modifiedTime,
          version: data.version,
          isDeleted: false,
        };
      }
    }

    const sheetsRes = await fetchWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=properties.title`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (sheetsRes.status === 404) {
      return { id: fileId, name: '', mimeType: '', isDeleted: true };
    }
    if (sheetsRes.ok) {
      const sheetsData = await sheetsRes.json();
      if (sheetsData?.properties?.title) {
        return {
          id: fileId,
          name: sheetsData.properties.title,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          webViewLink: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
          isDeleted: false,
        };
      }
    }
  } catch (err) {
    console.warn('Không thể tải tên file từ Google Drive/Sheets API:', err);
  }
  return null;
}

/**
 * Download and parse a real Google Drive file (Sheet or Excel)
 */
export async function downloadRealGoogleDriveFile(
  accessToken: string,
  fileId: string,
  mimeType?: string
): Promise<ParseExcelResult> {
  try {
    const metaCheck = await getRealGoogleDriveFileMetadata(accessToken, fileId);
    if (metaCheck?.isDeleted) {
      throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc chuyển vào thùng rác trên Google Drive.');
    }

    let resolvedMime = mimeType || metaCheck?.mimeType;
    
    if (!resolvedMime || resolvedMime === 'application/vnd.google-apps.spreadsheet') {
      try {
        const metaSheetRes = await fetchWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(title,sheetId))`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        let sheetRange = 'A1:AC1000';
        if (metaSheetRes.ok) {
          const metaSheetData = await metaSheetRes.json();
          const firstTitle = metaSheetData?.sheets?.[0]?.properties?.title;
          if (firstTitle) {
            sheetRange = `'${firstTitle}'!A1:AC1000`;
          }
        }

        const liveSheetsRes = await fetchWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(sheetRange)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (metaSheetRes.status === 404 || liveSheetsRes.status === 404) {
          throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
        }

        if (liveSheetsRes.ok) {
          const liveData = await liveSheetsRes.json();
          if (liveData?.values && Array.isArray(liveData.values) && liveData.values.length > 0) {
            const matrixResult = parseMatrixData(liveData.values);
            if (matrixResult.success && (matrixResult.books.length > 0 || (matrixResult.settlements && matrixResult.settlements.length > 0))) {
              recordSyncAuditLog({
                type: 'SYNC_PULL',
                title: 'Tải dữ liệu từ Google Sheets',
                status: 'success',
                fileId,
                summary: `Đã đọc ${matrixResult.books.length} sổ tiết kiệm, ${matrixResult.annualInterestHistory?.length || 0} mốc lãi, ${matrixResult.settlements?.length || 0} nhật ký tất toán.`,
                details: {
                  activeBooksCount: matrixResult.books.length,
                  annualYears: matrixResult.annualInterestHistory?.map((a) => a.year),
                  balanceYears: matrixResult.balanceGrowthHistory?.map((b) => b.year),
                  settlementsCount: matrixResult.settlements?.length || 0,
                },
              });
              return matrixResult;
            }
          }
        } else if (liveSheetsRes.status === 401) {
          setGoogleAccessToken(null);
          throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
        }
      } catch (sheetsErr: any) {
        if (sheetsErr?.message?.includes('hết hạn') || sheetsErr?.message?.includes('FILE_NOT_FOUND')) {
          throw sheetsErr;
        }
        console.warn('Direct Google Sheets API fetch fallback to Drive API:', sheetsErr);
      }
    }

    if (!resolvedMime) {
      const metaRes = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name,trashed`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (metaRes.status === 404) {
        throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
      }
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta?.trashed) {
          throw new Error('FILE_NOT_FOUND: File liên kết đã bị chuyển vào thùng rác trên Google Drive.');
        }
        resolvedMime = meta.mimeType;
      }
    }

    let fetchUrl: string;

    if (resolvedMime === 'application/vnd.google-apps.spreadsheet') {
      fetchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
    } else {
      fetchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const res = await fetchWithRetry(fetchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (
        res.status === 401 ||
        err?.error?.status === 'UNAUTHENTICATED' ||
        err?.error?.code === 401 ||
        err?.error?.message?.includes('invalid authentication credentials') ||
        err?.error?.message?.includes('Invalid Credentials')
      ) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      if (res.status === 404) {
        throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
      }
      throw new Error(err?.error?.message || `Không thể tải nội dung file từ Google Drive (Mã ${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const parsedBinary = await parseWorkbook(arrayBuffer);
    if (parsedBinary.success) {
      recordSyncAuditLog({
        type: 'SYNC_PULL',
        title: 'Đọc file bảng tính từ Google Drive',
        status: 'success',
        fileId,
        summary: `Đã đọc ${parsedBinary.books.length} sổ tiết kiệm, ${parsedBinary.annualInterestHistory?.length || 0} mốc lãi.`,
        details: {
          activeBooksCount: parsedBinary.books.length,
          annualYears: parsedBinary.annualInterestHistory?.map((a) => a.year),
          balanceYears: parsedBinary.balanceGrowthHistory?.map((b) => b.year),
          settlementsCount: parsedBinary.settlements?.length || 0,
        },
      });
    }
    return parsedBinary;
  } catch (error: any) {
    if (error?.message?.includes('hết hạn') || error?.message?.includes('invalid authentication credentials')) {
      console.warn('Lỗi phiên đăng nhập Google Drive:', error.message);
    } else {
      console.error('Lỗi khi đọc file từ Google Drive:', error);
    }
    throw error;
  }
}

/**
 * Upload and update an existing file on Google Drive (Real 2-way sync Push)
 */
export async function updateRealGoogleDriveFile(
  accessToken: string,
  fileId: string,
  books: SavingsBook[],
  settlements: SettlementAdjustment[] = []
): Promise<boolean> {
  try {
    const metaCheck = await getRealGoogleDriveFileMetadata(accessToken, fileId);
    if (metaCheck?.isDeleted) {
      throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc chuyển vào thùng rác trên Google Drive.');
    }

    let isGoogleSheet = false;
    try {
      const metaRes = await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (metaRes.status === 404) {
        throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
      }
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
          isGoogleSheet = true;
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('FILE_NOT_FOUND')) {
        throw err;
      }
    }

    if (isGoogleSheet) {
      let sheetPrefix = '';
      let targetSheetId = 0;
      try {
        const metaSheetRes = await fetchWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(title,sheetId))`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (metaSheetRes.ok) {
          const metaSheetData = await metaSheetRes.json();
          const firstProp = metaSheetData?.sheets?.[0]?.properties;
          if (firstProp) {
            if (firstProp.title) {
              sheetPrefix = `'${firstProp.title}'!`;
            }
            if (firstProp.sheetId !== undefined) {
              targetSheetId = firstProp.sheetId;
            }
          }
        }
      } catch {
        // fallback
      }

      const dataRows = translateBooksToDataRows(books);
      const rowCount = dataRows.length;

      const maxBookRows = Math.max(35, rowCount + 10);
      const clearRange = `${sheetPrefix}A2:L${maxBookRows}`;

      try {
        await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(clearRange)}:clear`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
      } catch {
        // ignore clear error
      }

      let existingMatrixNtoAC: any[][] = [];
      try {
        const getMetaRange = `${sheetPrefix}N1:AC40`;
        const getRes = await fetchWithRetry(
          `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(getMetaRange)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (getRes.ok) {
          const getData = await getRes.json();
          if (Array.isArray(getData?.values)) {
            existingMatrixNtoAC = getData.values;
          }
        }
      } catch (readErr) {
        console.warn('Không thể đọc trước dữ liệu N:AC từ Google Sheet:', readErr);
      }

      const annualInterestList = getDynamicAnnualInterestHistory(books, settlements);
      const balanceGrowthList = getDynamicBalanceGrowthHistory(books, settlements);
      const activityLogList = deduplicateSettlementAdjustments(settlements || []);

      const batchDataPayload: { range: string; majorDimension: string; values: any[][] }[] = [];
      const updatedRangesAudit: string[] = [];

      const targetRange = `${sheetPrefix}A2:L${1 + rowCount}`;
      batchDataPayload.push({
        range: targetRange,
        majorDimension: 'ROWS',
        values: dataRows,
      });
      updatedRangesAudit.push(`A2:L${1 + rowCount}`);

      const clearBookStartRow = 2 + rowCount;
      const clearBookEndRow = Math.max(clearBookStartRow + 10, 100);
      const emptyBookRow = ['', '', '', '', '', '', '', '', '', '', '', ''];
      const clearBookRowCount = clearBookEndRow - clearBookStartRow + 1;
      const clearBookRows = Array.from({ length: clearBookRowCount }, () => [...emptyBookRow]);
      batchDataPayload.push({
        range: `${sheetPrefix}A${clearBookStartRow}:L${clearBookEndRow}`,
        majorDimension: 'ROWS',
        values: clearBookRows,
      });

      const existingAnnualMap = new Map<number, number>();
      for (let i = 1; i < existingMatrixNtoAC.length; i++) {
        const yrRaw = parseInt(String(existingMatrixNtoAC[i]?.[0] || '').replace(/\D/g, ''), 10);
        if (yrRaw >= 2000 && yrRaw <= 2099) {
          existingAnnualMap.set(yrRaw, i + 1);
        }
      }

      const hasHistoricalAnnuals =
        existingAnnualMap.has(2022) ||
        existingAnnualMap.has(2023) ||
        existingAnnualMap.has(2024) ||
        existingAnnualMap.has(2025);

      if (hasHistoricalAnnuals) {
        const yearsToUpdate = [2026, 2027, 2028];
        let maxAnnualRow = Math.max(...Array.from(existingAnnualMap.values()), 1);

        yearsToUpdate.forEach((yr) => {
          const rec = annualInterestList.find((a) => a.year === yr);
          const amtMil = rec?.interestEarnedMillion ?? 0;
          let targetRow = existingAnnualMap.get(yr);
          if (!targetRow) {
            maxAnnualRow++;
            targetRow = maxAnnualRow;
            existingAnnualMap.set(yr, targetRow);
          }
          batchDataPayload.push({
            range: `${sheetPrefix}N${targetRow}:O${targetRow}`,
            majorDimension: 'ROWS',
            values: [[yr, amtMil]],
          });
          updatedRangesAudit.push(`N${targetRow}:O${targetRow} (Năm ${yr})`);
        });
      } else {
        const fullAnnuals = [
          ...DEFAULT_HISTORICAL_ANNUALS.filter((a) => a.year < 2026),
          ...annualInterestList.filter((a) => a.year >= 2026),
        ];
        const annualRows = fullAnnuals.map((a) => [a.year, a.interestEarnedMillion]);
        batchDataPayload.push({
          range: `${sheetPrefix}N2:O${1 + annualRows.length}`,
          majorDimension: 'ROWS',
          values: annualRows,
        });
        updatedRangesAudit.push(`N2:O${1 + annualRows.length} (Khôi phục toàn bộ 2022-2028)`);
      }

      const existingBalanceMap = new Map<number, number>();
      for (let i = 1; i < existingMatrixNtoAC.length; i++) {
        const yrRaw = parseInt(String(existingMatrixNtoAC[i]?.[3] || '').replace(/\D/g, ''), 10);
        if (yrRaw >= 2000 && yrRaw <= 2099) {
          existingBalanceMap.set(yrRaw, i + 1);
        }
      }

      const hasHistoricalBalances =
        existingBalanceMap.has(2019) ||
        existingBalanceMap.has(2020) ||
        existingBalanceMap.has(2021) ||
        existingBalanceMap.has(2025);

      if (hasHistoricalBalances) {
        const rec2026 = balanceGrowthList.find((b) => b.year === 2026);
        const bal2026 = rec2026?.balanceMillion ?? 37000;
        const inc2026 = rec2026?.annualIncomeMillion !== undefined ? rec2026.annualIncomeMillion : 1711;

        let targetRow = existingBalanceMap.get(2026);
        if (!targetRow) {
          const maxBalRow = Math.max(...Array.from(existingBalanceMap.values()), 1);
          targetRow = maxBalRow + 1;
        }

        batchDataPayload.push({
          range: `${sheetPrefix}Q${targetRow}:S${targetRow}`,
          majorDimension: 'ROWS',
          values: [[2026, bal2026, inc2026]],
        });
        updatedRangesAudit.push(`Q${targetRow}:S${targetRow} (Năm 2026)`);
      } else {
        const rec2026 = balanceGrowthList.find((b) => b.year === 2026);
        const bal2026 = rec2026?.balanceMillion ?? 37000;
        const inc2026 = rec2026?.annualIncomeMillion !== undefined ? rec2026.annualIncomeMillion : 1711;

        const fullBalances = [
          ...DEFAULT_HISTORICAL_BALANCES.filter((b) => b.year < 2026).map((b) => [
            b.year,
            b.balanceMillion,
            b.annualIncomeMillion !== undefined ? b.annualIncomeMillion : '',
          ]),
          [2026, bal2026, inc2026],
        ];

        batchDataPayload.push({
          range: `${sheetPrefix}Q2:S${1 + fullBalances.length}`,
          majorDimension: 'ROWS',
          values: fullBalances,
        });
        updatedRangesAudit.push(`Q2:S${1 + fullBalances.length} (Khôi phục toàn bộ 2019-2026)`);
      }

      let colUHeader = '';
      if (existingMatrixNtoAC.length > 0 && existingMatrixNtoAC[0]) {
        colUHeader = String(existingMatrixNtoAC[0][7] || '').toLowerCase().normalize('NFC').trim();
      }
      const is9ColLayout = colUHeader.includes('id');

      let maxExistingActivityRow = 1;
      existingMatrixNtoAC.slice(1).forEach((r, idx) => {
        const rowNum = idx + 2;
        const checkIndices = is9ColLayout ? [7, 8, 9, 10, 11, 12, 13, 14, 15] : [7, 8, 9, 10, 11, 12, 13, 14];
        const hasData = checkIndices.some(
          (cIdx) => r[cIdx] !== undefined && String(r[cIdx]).trim() !== ''
        );
        if (hasData) {
          maxExistingActivityRow = Math.max(maxExistingActivityRow, rowNum);
        }
      });

      if (activityLogList.length > 0) {
        const activityRows = activityLogList.map((s, idx) => {
          const cleanCode = (s.bookCode || 'SO').replace(/\s+/g, '').toUpperCase();
          const shortBank = getBankShortCode(s.bankId, cleanCode);
          const standardizedId = `ADJ_${idx + 1}_${cleanCode}`;

          if (is9ColLayout) {
            return [
              standardizedId,
              translateDateToSheet(s.settlementDate || '', 'd/m/yyyy'),
              s.settlementType === 'early' ? 'Tất toán trước hạn' : 'Tất toán đúng hạn',
              s.bookCode || '',
              shortBank,
              getOwnerLabel(s.owner),
              s.principal ? Math.round(s.principal / 1_000_000) : 0,
              s.actualInterestVND ? Math.round(s.actualInterestVND / 1_000_000) : 0,
              s.note || '',
            ];
          } else {
            return [
              translateDateToSheet(s.settlementDate || '', 'd/m/yyyy'),
              s.settlementType === 'early' ? 'Tất toán trước hạn' : 'Tất toán đúng hạn',
              s.bookCode || '',
              shortBank,
              getOwnerLabel(s.owner),
              s.principal ? Math.round(s.principal / 1_000_000) : 0,
              s.actualInterestVND ? Math.round(s.actualInterestVND / 1_000_000) : 0,
              s.note || '',
            ];
          }
        });

        if (maxExistingActivityRow > 1 + activityRows.length) {
          const clearStartRow = 2 + activityRows.length;
          const clearEndRow = Math.max(maxExistingActivityRow, 10);
          const emptyRow = is9ColLayout ? ['', '', '', '', '', '', '', '', ''] : ['', '', '', '', '', '', '', ''];
          const clearRowCount = clearEndRow - clearStartRow + 1;
          const clearRows = Array.from({ length: clearRowCount }, () => [...emptyRow]);

          const clearColLetter = is9ColLayout ? 'AC' : 'AB';
          batchDataPayload.push({
            range: `${sheetPrefix}U${clearStartRow}:${clearColLetter}${clearEndRow}`,
            majorDimension: 'ROWS',
            values: clearRows,
          });
          updatedRangesAudit.push(`U${clearStartRow}:${clearColLetter}${clearEndRow}`);
        }

        const targetColLetter = is9ColLayout ? 'AC' : 'AB';
        batchDataPayload.push({
          range: `${sheetPrefix}U2:${targetColLetter}${1 + activityRows.length}`,
          majorDimension: 'ROWS',
          values: activityRows,
        });
        updatedRangesAudit.push(`U2:${targetColLetter}${1 + activityRows.length}`);
      }

      if (rowCount > 0) {
        const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values:batchUpdate`;

        const batchBody = {
          valueInputOption: 'USER_ENTERED',
          data: batchDataPayload,
        };

        const putRes = await fetchWithRetry(batchUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batchBody),
        });

        if (!putRes.ok) {
          const err = await putRes.json().catch(() => ({}));
          const errMsg = err?.error?.message || `Lỗi cập nhật Google Sheet (Mã ${putRes.status})`;
          recordSyncAuditLog({
            type: 'SYNC_PUSH',
            title: 'Lỗi ghi dữ liệu Google Sheets',
            status: 'error',
            fileId,
            summary: errMsg,
            errorMessage: errMsg,
          });

          if (
            putRes.status === 401 ||
            err?.error?.status === 'UNAUTHENTICATED' ||
            err?.error?.code === 401 ||
            err?.error?.message?.includes('invalid authentication credentials')
          ) {
            setGoogleAccessToken(null);
            throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
          }
          if (putRes.status === 404) {
            throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
          }
          throw new Error(errMsg);
        }

        recordSyncAuditLog({
          type: 'SYNC_PUSH',
          title: 'Đồng bộ Google Sheets thành công',
          status: 'success',
          fileId,
          summary: `Đã cập nhật ${rowCount} sổ tiết kiệm.`,
          details: {
            activeBooksCount: rowCount,
            updatedRanges: updatedRangesAudit,
          },
        });

        try {
          const sheetsMetaRes = await fetchWithRetry(
            `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (sheetsMetaRes.ok) {
            const sheetsData = await sheetsMetaRes.json();
            const sheetId = sheetsData?.sheets?.[0]?.properties?.sheetId ?? targetSheetId ?? 0;

            const formatBody = {
              requests: [
                {
                  copyPaste: {
                    source: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 2,
                      startColumnIndex: 0,
                      endColumnIndex: 12,
                    },
                    destination: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 1 + Math.max(1, rowCount),
                      startColumnIndex: 0,
                      endColumnIndex: 12,
                    },
                    pasteType: 'PASTE_FORMAT',
                  },
                },
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 29,
                    },
                    cell: {
                      userEnteredFormat: {
                        textFormat: {
                          fontFamily: 'Arial',
                          fontSize: 10,
                          bold: true,
                        },
                        verticalAlignment: 'MIDDLE',
                      },
                    },
                    fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment',
                  },
                },
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 0,
                      endColumnIndex: 29,
                    },
                    cell: {
                      userEnteredFormat: {
                        textFormat: {
                          fontFamily: 'Arial',
                          fontSize: 10,
                          bold: false,
                        },
                        verticalAlignment: 'MIDDLE',
                      },
                    },
                    fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment',
                  },
                },
                {
                  updateBorders: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 1 + Math.max(1, rowCount),
                      startColumnIndex: 0,
                      endColumnIndex: 12,
                    },
                    top: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    bottom: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    left: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    right: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
                  },
                },
              ],
            };

            await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(formatBody),
            });
          }
        } catch (formatErr) {
          console.warn('Không thể tự động áp dụng định dạng lên Google Sheet:', formatErr);
        }
      }
      return true;
    } else {
      const currentYear = new Date().getFullYear();
      const annualInterestList = getDynamicAnnualInterestHistory(books, settlements).filter(
        (r) => r.year <= currentYear
      );
      const balanceGrowthList = getDynamicBalanceGrowthHistory(books, settlements).filter(
        (r) => r.year < currentYear
      );
      const excelBuffer = await getSavingsExcelArrayBuffer(books, annualInterestList, balanceGrowthList);
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const res = await fetchWithRetry(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: blob,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (
          res.status === 401 ||
          err?.error?.status === 'UNAUTHENTICATED' ||
          err?.error?.code === 401 ||
          err?.error?.message?.includes('invalid authentication credentials')
        ) {
          setGoogleAccessToken(null);
          throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
        }
        if (res.status === 404) {
           throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
        }
        throw new Error(err?.error?.message || `Không thể cập nhật file lên Google Drive (Mã ${res.status})`);
      }

      return true;
    }
  } catch (error: any) {
    if (error?.message?.includes('hết hạn') || error?.message?.includes('invalid authentication credentials')) {
      console.warn('Lỗi phiên đăng nhập Google Drive:', error.message);
    } else {
      console.error('Lỗi khi đẩy dữ liệu lên Google Drive:', error);
    }
    throw error;
  }
}

/**
 * Create a brand new Excel file on the user's real Google Drive
 */
export async function createRealGoogleDriveFile(
  accessToken: string,
  fileName: string,
  books: SavingsBook[],
  settlements: SettlementAdjustment[] = [],
  userEmail?: string
): Promise<{ id: string; name: string; webViewLink: string; linkedTimestamp?: string }> {
  try {
    const annualInterestList = getDynamicAnnualInterestHistory(books, settlements);
    const balanceGrowthList = getDynamicBalanceGrowthHistory(books, settlements);
    const excelBuffer = await getSavingsExcelArrayBuffer(books, annualInterestList, balanceGrowthList, settlements);
    const fileBlob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const metadata = {
      name: fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json; charset=UTF-8' })
    );
    form.append('file', fileBlob);

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
    const res = await fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (
        res.status === 401 ||
        err?.error?.status === 'UNAUTHENTICATED' ||
        err?.error?.code === 401 ||
        err?.error?.message?.includes('invalid authentication credentials')
      ) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      throw new Error(err?.error?.message || `Không thể tạo file mới trên Google Drive (Mã ${res.status})`);
    }

    const data = await res.json();
    const linkedTimestamp = new Date().toISOString();
    const webViewLink = data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;

    try {
      const currentMaster = await getMasterSyncStateFromDrive(accessToken);
      await saveMasterSyncStateOnDrive(accessToken, {
        status: 'active',
        lastAction: 'create_and_link',
        activeFileId: data.id,
        activeFileName: data.name,
        activeFileUrl: webViewLink,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        linkedTimestamp,
        linkedAccountEmail: userEmail || 'Google User',
        adminEmail: currentMaster?.adminEmail || userEmail?.toLowerCase() || 'admin',
        members: currentMaster?.members || [],
        updatedAt: linkedTimestamp,
      });
    } catch (saveErr) {
      console.warn('Failed to update master sync state on newly created drive file:', saveErr);
    }

    return {
      id: data.id,
      name: data.name,
      webViewLink,
      linkedTimestamp,
    };
  } catch (error: any) {
    if (error?.message?.includes('hết hạn') || error?.message?.includes('invalid authentication credentials')) {
      console.warn('Lỗi phiên đăng nhập Google Drive:', error.message);
    } else {
      console.error('Lỗi khi tạo file mới trên Google Drive:', error);
    }
    throw error;
  }
}

export type { MasterSyncState };

export const MASTER_STATE_FILENAME = 'so_tiet_kiem_backup.json';

export function applyMasterStateToSettings(
  masterState: MasterSyncState | null,
  currentUserEmail: string | undefined,
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  currentSettings?: AppSettings,
  accessToken?: string
) {
  if (!masterState) return;

  const cleanUserEmail = currentUserEmail?.toLowerCase();
  const adminEmail = masterState.adminEmail?.toLowerCase() || masterState.linkedAccountEmail?.toLowerCase();

  let resolvedRole: UserRole = 'ADMIN';
  if (cleanUserEmail && adminEmail && cleanUserEmail !== adminEmail) {
    const matchedMember = masterState.members?.find(
      (m) => m.email.toLowerCase() === cleanUserEmail
    );
    if (matchedMember) {
      resolvedRole = matchedMember.role;
    } else {
      resolvedRole = 'VIEWER';
    }
  }

  const newMembers = masterState.members && masterState.members.length > 0 ? masterState.members : [];
  const newFileUrl = masterState.activeFileId ? (masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${masterState.activeFileId}/edit`) : undefined;
  const newFileName = masterState.activeFileId ? masterState.activeFileName : undefined;
  const newTimestamp = masterState.activeFileId ? masterState.linkedTimestamp : undefined;

  if (accessToken && cleanUserEmail && adminEmail && cleanUserEmail === adminEmail && currentSettings?.members) {
    const missingMembers = currentSettings.members.filter(
      (oldM) => !newMembers.some((newM) => newM.email.trim().toLowerCase() === oldM.email.trim().toLowerCase())
    );
    for (const missingM of missingMembers) {
      if (missingM.email) {
        console.info(`[Master State Auto Cleanup] Admin detected self-exited member ${missingM.email}. Revoking permissions on Drive...`);
        removeMemberFromDriveMaster(accessToken, missingM.email).catch(() => {});
      }
    }
  }

  if (accessToken && cleanUserEmail && adminEmail && cleanUserEmail === adminEmail) {
    if (masterState.activeFileId) {
      synchronizeDrivePermissionsWithJsonMembers(
        accessToken,
        masterState.activeFileId,
        newMembers,
        adminEmail
      ).catch(() => {});
    }

    getMasterPointerFileId(accessToken).then((pointerId) => {
      if (pointerId) {
        synchronizeDrivePermissionsWithJsonMembers(
          accessToken,
          pointerId,
          newMembers,
          adminEmail
        ).catch(() => {});
      }
    }).catch(() => {});
  }

  if (currentSettings) {
    const hasRoleChange = currentSettings.currentRole !== resolvedRole;
    const hasMembersChange = JSON.stringify(currentSettings.members || []) !== JSON.stringify(newMembers);
    const hasOwnerChange = Boolean(adminEmail && currentSettings.workspaceOwnerEmail !== adminEmail);
    const hasFileChange = Boolean(newFileUrl && currentSettings.googleSheetUrl !== newFileUrl);
    const hasFileNameChange = Boolean(newFileName && currentSettings.googleSheetName !== newFileName);
    const hasTimestampChange = Boolean(newTimestamp && currentSettings.lastLocalLinkTimestamp !== newTimestamp);

    if (!hasRoleChange && !hasMembersChange && !hasOwnerChange && !hasFileChange && !hasFileNameChange && !hasTimestampChange) {
      return;
    }
  }

  setSettings((prev) => {
    const updates: Partial<AppSettings> = {};

    if (prev.currentRole !== resolvedRole) {
      updates.currentRole = resolvedRole;
    }

    if (newMembers.length > 0 && JSON.stringify(prev.members || []) !== JSON.stringify(newMembers)) {
      updates.members = newMembers;
    }

    if (adminEmail && prev.workspaceOwnerEmail !== adminEmail) {
      updates.workspaceOwnerEmail = adminEmail;
    }

    if (masterState.activeFileId && masterState.status !== 'unlinked') {
      if (newFileUrl && prev.googleSheetUrl !== newFileUrl) {
        updates.googleSheetUrl = newFileUrl;
      }
      if (newFileName && prev.googleSheetName !== newFileName) {
        updates.googleSheetName = newFileName;
      }
      if (newTimestamp && prev.lastLocalLinkTimestamp !== newTimestamp) {
        updates.lastLocalLinkTimestamp = newTimestamp;
      }
    }

    if (Object.keys(updates).length === 0) {
      return prev;
    }

    return { ...prev, ...updates };
  });
}

export function formatIsoToVietnamTime(isoStr?: string): string {
  try {
    const d = isoStr ? new Date(isoStr) : new Date();
    if (isNaN(d.getTime())) return isoStr || '';
    return (
      d.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' (GMT+7)'
    );
  } catch {
    return (isoStr ? new Date(isoStr) : new Date()).toLocaleString('vi-VN') + ' (GMT+7)';
  }
}

export async function getMasterSyncStateFromDrive(accessToken: string): Promise<MasterSyncState | null> {
  try {
    const firestoreMaster = await getWorkspaceMasterStateFromFirestore();
    if (firestoreMaster) {
      return firestoreMaster;
    }

    if (accessToken) {
      const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
      searchUrl.searchParams.set('pageSize', '10');
      searchUrl.searchParams.set('supportsAllDrives', 'true');
      searchUrl.searchParams.set('includeItemsFromAllDrives', 'true');
      searchUrl.searchParams.set('fields', 'files(id, name, trashed)');
      searchUrl.searchParams.set('q', `name = '${MASTER_STATE_FILENAME}' and trashed = false`);

      const res = await fetchWithRetry(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        const files: any[] = data.files || [];
        if (files.length > 0) {
          const pointerFileId = files[0].id;
          const contentRes = await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${pointerFileId}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (contentRes.ok) {
            const state = await contentRes.json();
            if (state && (state.activeFileId || state.status)) {
              saveWorkspaceMasterStateToFirestore(state).catch(() => {});
              return state as MasterSyncState;
            }
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.warn('Error reading master sync pointer:', err);
    return null;
  }
}

export async function getMasterPointerFileId(accessToken: string): Promise<string | null> {
  try {
    const cached = localStorage.getItem(MASTER_POINTER_FILE_ID_KEY);
    if (cached) return cached;
  } catch {}
  return null;
}

export async function saveMasterSyncStateOnDrive(
  accessToken: string,
  state: MasterSyncState
): Promise<string | null> {
  try {
    const nowIso = new Date().toISOString();
    const nowVi = formatIsoToVietnamTime(nowIso);
    const linkedIso = state.linkedTimestamp || nowIso;
    const linkedVi = state.linkedLocalTimeVi || formatIsoToVietnamTime(linkedIso);

    const existingMaster = await getWorkspaceMasterStateFromFirestore().catch(() => null);

    const mergedMembers =
      state.members !== undefined
        ? state.members
        : existingMaster?.members || [];

    const mergedAdminEmail =
      state.adminEmail || existingMaster?.adminEmail || state.linkedAccountEmail || 'Google User';

    const preparedState: MasterSyncState = {
      ...existingMaster,
      ...state,
      schemaVersion: 1,
      adminEmail: mergedAdminEmail,
      members: mergedMembers,
      linkedTimestamp: linkedIso,
      linkedLocalTimeVi: linkedVi,
      updatedAt: state.updatedAt || nowIso,
      updatedAtVi: nowVi,
    };

    await saveWorkspaceMasterStateToFirestore(preparedState);

    if (accessToken) {
      try {
        const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
        searchUrl.searchParams.set('pageSize', '10');
        searchUrl.searchParams.set('supportsAllDrives', 'true');
        searchUrl.searchParams.set('includeItemsFromAllDrives', 'true');
        searchUrl.searchParams.set('fields', 'files(id, name)');
        searchUrl.searchParams.set('q', `name = '${MASTER_STATE_FILENAME}' and trashed = false`);

        fetchWithRetry(searchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(async (searchRes) => {
          if (searchRes.ok) {
            const d = await searchRes.json();
            const legacyFiles = d.files || [];
            for (const f of legacyFiles) {
              fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      } catch {}
    }

    if (preparedState.activeFileId && accessToken) {
      await synchronizeDrivePermissionsWithJsonMembers(
        accessToken,
        preparedState.activeFileId,
        preparedState.members || [],
        preparedState.adminEmail
      ).catch(() => {});
    }

    return 'firestore_workspace_doc';
  } catch (err) {
    console.warn('Error saving master sync pointer to Firestore:', err);
    return null;
  }
}

export async function setMasterSyncLinked(
  accessToken: string,
  fileId: string,
  userEmail?: string,
  previousFileId?: string,
  fileName?: string,
  fileUrl?: string,
  existingLinkedTimestamp?: string
): Promise<string> {
  const email = userEmail || 'Google User';
  const isSwitching = Boolean(previousFileId && previousFileId !== fileId);

  let resolvedLinkedTimestamp = existingLinkedTimestamp;

  if (!resolvedLinkedTimestamp && !isSwitching) {
    try {
      const currentMaster = await getWorkspaceMasterStateFromFirestore();
      if (currentMaster && currentMaster.activeFileId === fileId && currentMaster.linkedTimestamp) {
        resolvedLinkedTimestamp = currentMaster.linkedTimestamp;
      }
    } catch {}
  }

  let resolvedName = fileName;
  let resolvedUrl = fileUrl;
  let resolvedMime: string | undefined;

  try {
    const meta = await getRealGoogleDriveFileMetadata(accessToken, fileId);
    if (meta) {
      if (!resolvedName) resolvedName = meta.name;
      if (!resolvedUrl) resolvedUrl = meta.webViewLink || `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
      resolvedMime = meta.mimeType;
    }
  } catch {
    // fallback
  }

  if (!resolvedLinkedTimestamp) {
    resolvedLinkedTimestamp = new Date().toISOString();
  }

  if (isSwitching && previousFileId) {
    try {
      const currentMaster = await getWorkspaceMasterStateFromFirestore();
      if (currentMaster && currentMaster.members) {
        for (const member of currentMaster.members) {
          if (member.role !== 'ADMIN' && member.email) {
            revokeFilePermission(accessToken, previousFileId, member.email).catch(() => {});
          }
        }
      }
    } catch (revokeErr) {
      console.warn('Failed to revoke previous file permissions on switch:', revokeErr);
    }
  }

  try {
    const actionType: 'link' | 'switch' | 'create_and_link' = isSwitching ? 'switch' : 'link';
    const currentMaster = await getWorkspaceMasterStateFromFirestore();
    const finalMembers = currentMaster?.members || [];
    const finalAdminEmail = currentMaster?.adminEmail || email.toLowerCase();

    await saveWorkspaceMasterStateToFirestore({
      status: 'active',
      lastAction: actionType,
      activeFileId: fileId,
      activeFileName: resolvedName || 'Bảng tính tiết kiệm',
      activeFileUrl: resolvedUrl || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      mimeType: resolvedMime,
      linkedTimestamp: resolvedLinkedTimestamp,
      linkedAccountEmail: email,
      adminEmail: finalAdminEmail,
      members: finalMembers,
      updatedAt: new Date().toISOString(),
    });

    await synchronizeDrivePermissionsWithJsonMembers(
      accessToken,
      fileId,
      finalMembers,
      finalAdminEmail
    );
  } catch (saveErr) {
    console.warn('Failed to update master sync state on Firestore:', saveErr);
  }

  return resolvedLinkedTimestamp;
}

export async function touchMasterSyncStateOnDrive(
  accessToken: string,
  fileId: string,
  userEmail?: string,
  knownLinkedTimestamp?: string,
  fileName?: string,
  fileUrl?: string
): Promise<void> {
  try {
    const currentMaster = await getWorkspaceMasterStateFromFirestore();
    const nowIso = new Date().toISOString();

    if (currentMaster && (currentMaster.status === 'unlinked' || currentMaster.lastAction === 'unlink')) {
      return;
    }

    if (currentMaster && (currentMaster.activeFileId === fileId || !currentMaster.activeFileId)) {
      await saveWorkspaceMasterStateToFirestore({
        ...currentMaster,
        status: 'active',
        lastAction: currentMaster.lastAction === 'unlink' ? 'link' : (currentMaster.lastAction || 'link'),
        activeFileId: fileId,
        activeFileName: currentMaster.activeFileName || fileName || 'Bảng tính tiết kiệm',
        activeFileUrl: currentMaster.activeFileUrl || fileUrl || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
        linkedTimestamp: currentMaster.linkedTimestamp || knownLinkedTimestamp || nowIso,
        linkedAccountEmail: userEmail || currentMaster.linkedAccountEmail || 'Google User',
        updatedAt: nowIso,
      });
    }
  } catch (err) {
    console.warn('Failed to touch master sync state on Firestore:', err);
  }
}

export async function setMasterSyncUnlinked(
  accessToken: string,
  userEmail?: string
): Promise<void> {
  try {
    const currentMaster = await getWorkspaceMasterStateFromFirestore();
    if (!currentMaster) {
      return;
    }

    const cleanUser = userEmail?.trim().toLowerCase();
    const adminEmail = (currentMaster.adminEmail || currentMaster.linkedAccountEmail || '').trim().toLowerCase();
    if (cleanUser && adminEmail && cleanUser !== adminEmail) {
      console.warn(`[Central Hub Sync] Tài khoản ${cleanUser} không phải Admin (${adminEmail}). Từ chối hủy liên kết.`);
      return;
    }

    try {
      if (currentMaster.activeFileId && currentMaster.members && currentMaster.members.length > 0) {
        const activeId = currentMaster.activeFileId;
        for (const member of currentMaster.members) {
          if (member.role !== 'ADMIN' && member.email) {
            revokeFilePermission(accessToken, activeId, member.email).catch(() => {});
          }
        }
      }
    } catch (revokeErr) {
      console.warn('Failed to revoke member permissions on unlink:', revokeErr);
    }

    const nowIso = new Date().toISOString();
    await saveWorkspaceMasterStateToFirestore({
      status: 'unlinked',
      lastAction: 'unlink',
      activeFileId: '',
      activeFileName: '',
      activeFileUrl: '',
      linkedTimestamp: nowIso,
      linkedAccountEmail: userEmail || 'Google User',
      adminEmail: currentMaster.adminEmail || userEmail?.toLowerCase() || 'admin',
      members: currentMaster.members || [],
      updatedAt: nowIso,
    });
  } catch (saveErr) {
    console.warn('Failed to update master sync state to unlinked on Firestore:', saveErr);
  }
}

export async function autoDiscoverLatestCentralHub(
  accessToken: string,
  _userEmail?: string
): Promise<{ id: string; name: string; webViewLink?: string; mimeType?: string; linkedTimestamp?: string } | null> {
  try {
    const masterState = await getWorkspaceMasterStateFromFirestore();
    if (!masterState) return null;

    if (masterState.status === 'unlinked' || masterState.lastAction === 'unlink' || !masterState.activeFileId) {
      return null;
    }

    try {
      const meta = await getRealGoogleDriveFileMetadata(accessToken, masterState.activeFileId);
      if (meta && !meta.isDeleted) {
        return {
          id: masterState.activeFileId,
          name: meta.name || masterState.activeFileName,
          mimeType: meta.mimeType || masterState.mimeType,
          webViewLink: meta.webViewLink || masterState.activeFileUrl,
          linkedTimestamp: masterState.linkedTimestamp,
        };
      }
      return null;
    } catch (metaErr: any) {
      console.warn('[Central Hub Sync] Error checking active file metadata for current account:', metaErr);
      return null;
    }
  } catch (err) {
    console.warn('Error auto-discovering central hub from Firestore:', err);
    return null;
  }
}

export async function revokeFilePermission(
  accessToken: string,
  fileId: string,
  userEmail: string
): Promise<boolean> {
  try {
    if (!fileId || !userEmail) return false;
    const cleanEmail = userEmail.trim().toLowerCase();

    const listUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,emailAddress,role,type)`;
    const listRes = await fetchWithRetry(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      console.warn(`Failed to list permissions for file ${fileId}: HTTP ${listRes.status}`);
      return false;
    }

    const data = await listRes.json();
    const permissions: Array<{ id: string; emailAddress?: string; role?: string; type?: string }> = data.permissions || [];

    const userPerm = permissions.find(
      (p) => p.type === 'user' && p.emailAddress?.trim().toLowerCase() === cleanEmail
    );

    if (!userPerm || !userPerm.id) {
      return false;
    }

    const delUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${userPerm.id}`;
    const delRes = await fetchWithRetry(delUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return delRes.ok || delRes.status === 204;
  } catch (err) {
    console.warn(`Error in revokeFilePermission for ${userEmail} on file ${fileId}:`, err);
    return false;
  }
}

export async function removeMemberFromDriveMaster(
  accessToken: string,
  memberEmailToRemove: string
): Promise<void> {
  try {
    const currentMaster = await getWorkspaceMasterStateFromFirestore();
    if (!currentMaster || !currentMaster.members) return;

    const cleanTarget = memberEmailToRemove.trim().toLowerCase();
    const updatedMembers = currentMaster.members.filter(
      (m) => m.email.trim().toLowerCase() !== cleanTarget
    );

    await saveWorkspaceMasterStateToFirestore({
      ...currentMaster,
      members: updatedMembers,
      updatedAt: new Date().toISOString(),
    });

    if (currentMaster.activeFileId) {
      await revokeFilePermission(accessToken, currentMaster.activeFileId, cleanTarget).catch(() => {});
    }
  } catch (err) {
    console.warn('Lỗi khi xóa thành viên khỏi Master State:', err);
  }
}

export async function updateMemberRoleOnDrive(
  accessToken: string,
  fileId: string,
  userEmail: string,
  newRole: 'EDITOR' | 'VIEWER'
): Promise<boolean> {
  try {
    if (!fileId || !userEmail) return false;
    const cleanEmail = userEmail.trim().toLowerCase();
    const driveRole = newRole === 'EDITOR' ? 'writer' : 'reader';

    await revokeFilePermission(accessToken, fileId, cleanEmail);

    return await shareFileWithUserEmail(accessToken, fileId, cleanEmail, driveRole);
  } catch (err) {
    console.warn(`Lỗi khi cập nhật role cho ${userEmail} trên Google Drive:`, err);
    return false;
  }
}

export async function shareFileWithUserEmail(
  accessToken: string,
  fileId: string,
  userEmail: string,
  role: 'reader' | 'writer'
): Promise<boolean> {
  try {
    if (!fileId || !userEmail) return false;
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        type: 'user',
        emailAddress: userEmail,
      }),
    });
    return response.ok;
  } catch (err) {
    console.warn('Failed to share Google Drive file permission:', err);
    return false;
  }
}

export async function synchronizeDrivePermissionsWithJsonMembers(
  accessToken: string,
  fileId: string,
  members: any[],
  adminEmail?: string
): Promise<void> {
  try {
    if (!fileId || !accessToken) return;
    const cleanAdminEmail = adminEmail?.trim().toLowerCase();
    const activeMembers = members || [];

    const adminEmailsSet = new Set<string>();
    if (cleanAdminEmail && cleanAdminEmail !== 'admin' && cleanAdminEmail !== 'google user') {
      adminEmailsSet.add(cleanAdminEmail);
    }
    activeMembers.forEach((m) => {
      if (m?.role === 'ADMIN' && m?.email) {
        adminEmailsSet.add(m.email.trim().toLowerCase());
      }
    });

    const nonAdminMembers = activeMembers.filter(
      (m) => m && m.email && m.role !== 'ADMIN'
    );
    const memberMap = new Map<string, any>();
    nonAdminMembers.forEach((m) => {
      memberMap.set(m.email.trim().toLowerCase(), m);
    });

    const listUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,emailAddress,role,type,displayName)&supportsAllDrives=true&pageSize=100`;
    const listRes = await fetchWithRetry(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      console.warn(`[Permission Sync] Failed to list permissions for file ${fileId}: HTTP ${listRes.status}`);
      return;
    }

    const data = await listRes.json();
    const permissions: Array<{ id: string; emailAddress?: string; role?: string; type?: string; displayName?: string }> = data.permissions || [];

    const deletePermission = async (pId: string, desc: string) => {
      console.info(`[Permission Sync] Thu hồi quyền truy cập Drive: ${desc} (permId: ${pId}) trên file ${fileId}`);
      const delUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${pId}?supportsAllDrives=true`;
      const delRes = await fetchWithRetry(delUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!delRes.ok && delRes.status !== 204) {
        console.warn(`[Permission Sync] Thất bại khi thu hồi quyền ${pId} (${desc}) trên file ${fileId}: HTTP ${delRes.status}`);
      } else {
        console.info(`[Permission Sync] Đã thu hồi quyền thành công: ${desc} trên file ${fileId}`);
      }
    };

    for (const p of permissions) {
      if (p.role === 'owner') continue;

      const emailClean = p.emailAddress?.trim().toLowerCase();

      if (emailClean && adminEmailsSet.has(emailClean)) {
        continue;
      }

      if (nonAdminMembers.length === 0) {
        await deletePermission(p.id, emailClean || p.displayName || p.type || p.id);
        continue;
      }

      if (p.type === 'anyone' || p.type === 'domain') {
        await deletePermission(p.id, `Public/Domain Link (${p.type})`);
        continue;
      }

      const memberInJson = emailClean ? memberMap.get(emailClean) : null;

      if (!memberInJson) {
        await deletePermission(p.id, emailClean || p.displayName || p.type || p.id);
      } else {
        const expectedDriveRole = memberInJson.role === 'EDITOR' ? 'writer' : 'reader';
        if (p.role !== expectedDriveRole) {
          console.info(`[Permission Sync] Cập nhật role cho ${p.emailAddress} thành ${expectedDriveRole} để khớp với JSON`);
          await deletePermission(p.id, `${emailClean} (đổi role)`);
          if (emailClean) {
            await shareFileWithUserEmail(accessToken, fileId, emailClean, expectedDriveRole).catch(() => {});
          }
        }
      }
    }

    if (nonAdminMembers.length > 0) {
      const driveEmails = new Set(
        permissions
          .filter((p) => p.type === 'user' && p.emailAddress)
          .map((p) => p.emailAddress!.trim().toLowerCase())
      );

      for (const m of nonAdminMembers) {
        if (!m.email) continue;
        const emailClean = m.email.trim().toLowerCase();
        if (adminEmailsSet.has(emailClean)) continue;

        if (!driveEmails.has(emailClean)) {
          console.info(`[Permission Sync] Cấp quyền mới cho thành viên từ JSON: ${m.email}`);
          const driveRole = m.role === 'EDITOR' ? 'writer' : 'reader';
          await shareFileWithUserEmail(accessToken, fileId, emailClean, driveRole).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[Permission Sync] Error synchronizing Drive permissions with JSON:', err);
  }
}
