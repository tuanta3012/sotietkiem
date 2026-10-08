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
import { getSecureItem, setSecureItem, removeSecureItem } from './secureStorage';
import firebaseConfig from '../../firebase-applet-config.json';
import { SavingsBook, SettlementAdjustment, WorkspaceMember, UserRole, AppSettings, MasterSyncState, BankInfo } from '../types';
import { parseWorkbook, parseMatrixData, getSavingsExcelArrayBuffer, ParseExcelResult } from './excelParser';
import { translateBooksToSheetMatrix, translateBooksToDataRows, deduplicateSettlementAdjustments, translateDateToSheet } from './dataTranslator';
import { getOwnerLabel } from './formatters';
import {
  getDynamicAnnualInterestHistory,
  getDynamicBalanceGrowthHistory,
  loadStaticHistoryFromStorage,
  saveStaticHistoryToStorage,
} from '../data/historicalGrowth';
import { recordSyncAuditLog, getSyncAuditLogs, SyncAuditLogEntry } from './syncAuditLog';
import { getBankShortCode, getAllBanks, updateBanksFromRemote } from '../data/banks';


// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure local persistence to keep user logged in across refreshes
try {
  setPersistence(auth, browserLocalPersistence);
} catch (e) {
  console.warn('Could not set persistence:', e);
}

// Provider with drive.file scope (non-sensitive scope paired with Google Picker API)
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');

// Check if user has migrated to drive scope
const isScopeMigrated = (() => {
  try {
    return localStorage.getItem('drive_scope_migrated_v3') === 'true';
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

// App Tag identifier for Google Drive file appProperties
export const DRIVE_APP_TAG = {
  key: 'app_id',
  value: 'com.tietkiemgiadinh.app',
  typeKey: 'type',
  typeValue: 'savings_vault',
};

/**
 * Gắn nhãn appProperties lên Google Drive file (metadata ẩn)
 */
export async function tagVaultWithAppProperties(
  accessToken: string,
  fileId: string
): Promise<boolean> {
  try {
    if (!accessToken || !fileId) return false;

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,appProperties`;
    const res = await fetchWithRetry(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appProperties: {
          [DRIVE_APP_TAG.key]: DRIVE_APP_TAG.value,
          [DRIVE_APP_TAG.typeKey]: DRIVE_APP_TAG.typeValue,
        },
      }),
    });

    return res.ok;
  } catch (err) {
    console.warn('[Drive Tagging] Không thể gắn nhãn appProperties lên file:', err);
    return false;
  }
}

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
  isAppTagged?: boolean;
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

      // Secure storage backup
      setSecureItem(TOKEN_KEY, token).catch(() => {});
      setSecureItem(TOKEN_EXPIRES_AT_KEY, expiresAt).catch(() => {});
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
      localStorage.removeItem('google_drive_ever_logged_in');
      Preferences.remove({ key: TOKEN_KEY }).catch(() => {});
      Preferences.remove({ key: TOKEN_EXPIRES_AT_KEY }).catch(() => {});
      Preferences.remove({ key: 'google_drive_ever_logged_in' }).catch(() => {});

      // Secure storage clean
      removeSecureItem(TOKEN_KEY).catch(() => {});
      removeSecureItem(TOKEN_EXPIRES_AT_KEY).catch(() => {});
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
      setSecureItem(ID_TOKEN_KEY, session.idToken).catch(() => {});
    }
    if (session.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
      Preferences.set({ key: REFRESH_TOKEN_KEY, value: session.refreshToken }).catch(() => {});
      setSecureItem(REFRESH_TOKEN_KEY, session.refreshToken).catch(() => {});
    }
    if (session.userProfile) {
      const json = JSON.stringify(session.userProfile);
      localStorage.setItem(USER_PROFILE_KEY, json);
      Preferences.set({ key: USER_PROFILE_KEY, value: json }).catch(() => {});
      setSecureItem(USER_PROFILE_KEY, json).catch(() => {});
    }
  } catch (err) {
    console.warn('Error saving Google Auth Session:', err);
  }
}

/**
 * Restore Google Auth Session credentials from native secure storage (used at app startup)
 */
export async function restoreGoogleAuthSession(): Promise<boolean> {
  try {
    const token = await getSecureItem(TOKEN_KEY);
    const expiresAt = await getSecureItem(TOKEN_EXPIRES_AT_KEY);
    const refreshToken = await getSecureItem(REFRESH_TOKEN_KEY);
    const idToken = await getSecureItem(ID_TOKEN_KEY);
    const userProfile = await getSecureItem(USER_PROFILE_KEY);

    if (token) {
      cachedAccessToken = token;
      localStorage.setItem(TOKEN_KEY, token);
      if (expiresAt) localStorage.setItem(TOKEN_EXPIRES_AT_KEY, expiresAt);
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      if (idToken) localStorage.setItem(ID_TOKEN_KEY, idToken);
      if (userProfile) localStorage.setItem(USER_PROFILE_KEY, userProfile);
      localStorage.setItem('google_drive_ever_logged_in', 'true');
      console.info('[SecureStorage] Successfully restored Google OAuth credentials from native secure storage.');
      return true;
    }
  } catch (err) {
    console.warn('[SecureStorage] Failed to restore session from secure storage:', err);
  }
  return false;
}

let isGoogleAuthInitialized = false;

/**
 * Ensures GoogleAuth native plugin is initialized exactly once on mobile platforms.
 */
export async function ensureGoogleAuthInitialized(): Promise<void> {
  if (isGoogleAuthInitialized || !Capacitor.isNativePlatform()) return;
  try {
    await (GoogleAuth as any).initialize({
      clientId: firebaseConfig.oAuthClientId,
      serverClientId: firebaseConfig.oAuthClientId,
      scopes: [
        'email',
        'profile',
        'openid',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
      grantOfflineAccess: false,
    });
    isGoogleAuthInitialized = true;
  } catch (err) {
    console.warn('[GoogleAuth] Initialize warning/error:', err);
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

  // Prevent overlapping auth requests
  if (isSigningIn) {
    console.info('[Silent Auth] Tiến trình đăng nhập khác đang chạy, bỏ qua silent refresh.');
    return null;
  }

  // 1. Silent Refresh on Native Platforms (Android/iOS)
  if (Capacitor.isNativePlatform()) {
    console.info('[Silent Auth] Đang gia hạn phiên làm việc ngầm trên Native...');
    try {
      await ensureGoogleAuthInitialized();

      // Try silent refresh using offline refresh token with a strict 8-second timeout to prevent native hangs
      try {
        const refreshPromise = GoogleAuth.refresh();
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT_REFRESH: Quá thời gian gia hạn phiên Google (8 giây).')), 8000)
        );
        const refreshResult = await Promise.race([refreshPromise, timeoutPromise]);
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
        console.warn('[Silent Auth] GoogleAuth.refresh() failed or timed out:', refreshErr);
      }
    } catch (nativeErr) {
      console.warn('[Silent Auth] Native silent refresh failed:', nativeErr);
    }
  }

  // 2. Web Platform / AI Studio Preview Flow
  // On Web, if Firebase auth session is preserved, but access token expired, we let re-auth handle it gracefully
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
        
        // Auto sign-in to Firebase Auth using stored idToken and silent refreshed accessToken
        const savedIdToken = getGoogleIdToken();
        if (silentToken && savedIdToken) {
          try {
            console.info('[initGoogleAuth] Re-authenticating Firebase Auth with Google Credentials...');
            const credential = GoogleAuthProvider.credential(savedIdToken, silentToken);
            const fbCredential = await signInWithCredential(auth, credential);
            if (fbCredential?.user) {
              console.info('[initGoogleAuth] Firebase Auth successfully re-authenticated silently.');
              if (onSuccess) onSuccess(fbCredential.user, silentToken);
              return;
            }
          } catch (fbErr) {
            console.warn('[initGoogleAuth] Silent Firebase re-auth failed:', fbErr);
          }
        }

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
 * Check if running inside highly restricted in-app browsers/WebViews (Zalo, Facebook, Messenger, etc.)
 */
export const isInAppBrowser = (): boolean => {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /FBAN|FBAV/i.test(ua) || // Facebook
    /Instagram/i.test(ua) || // Instagram
    /Zalo/i.test(ua) || // Zalo
    /Line/i.test(ua) || // Line
    /MicroMessenger/i.test(ua) || // WeChat
    /Kakaotalk/i.test(ua) // KakaoTalk
  );
};

/**
 * Check if the user is returning from a Google OAuth redirect
 */
export const checkRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (Capacitor.isNativePlatform()) {
    // Native platforms use signInWithCredential/GoogleAuth.signIn, so redirect flows don't apply.
    return null;
  }
  try {
    const result = await getRedirectResult(auth);
    sessionStorage.removeItem('pending_google_redirect_auth');
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken =
        credential?.accessToken ||
        (result as any)?._tokenResponse?.oauthAccessToken ||
        (result as any)?.credential?.accessToken ||
        (result as any)?._tokenResponse?.accessToken ||
        '';
      if (accessToken) {
        const expiresAt = Date.now() + 3500 * 1000;
        saveGoogleAuthSession({
          accessToken,
          idToken: credential?.idToken || (result as any)?._tokenResponse?.idToken || undefined,
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
          accessToken,
        };
      }
    }
  } catch (error: any) {
    sessionStorage.removeItem('pending_google_redirect_auth');
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
  try {
    sessionStorage.setItem('pending_google_redirect_auth', 'true');
  } catch {}
  await signInWithRedirect(auth, provider);
};

function signInWithGoogleGIS(): Promise<{ user: User; accessToken: string }> {
  return new Promise((resolve, reject) => {
    const initGsi = () => {
      try {
        const clientId = (firebaseConfig as any).oAuthClientId || '864440372329-fgoo89lqp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com';
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file email profile openid',
          callback: async (resp: any) => {
            if (resp.error) {
              reject(new Error(resp.error_description || resp.error));
              return;
            }
            const accessToken = resp.access_token;
            if (!accessToken) {
              reject(new Error('Không nhận được Access Token từ Google.'));
              return;
            }

            try {
              const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const profile = await userInfoRes.json();
              const user: User = {
                uid: profile.sub || 'google_user',
                email: profile.email || 'user@gmail.com',
                displayName: profile.name || profile.given_name || 'Chủ Tài Khoản',
                photoURL: profile.picture || undefined,
              } as any;

              resolve({ user, accessToken });
            } catch {
              const user: User = {
                uid: 'google_user',
                email: 'user@gmail.com',
                displayName: 'Chủ Tài Khoản',
              } as any;
              resolve({ user, accessToken });
            }
          },
        });
        client.requestAccessToken({ prompt: 'consent' });
      } catch (err: any) {
        reject(err);
      }
    };

    if (!window.google?.accounts?.oauth2) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => initGsi();
      script.onerror = () => reject(new Error('Không thể tải thư viện Google Identity Services.'));
      document.body.appendChild(script);
    } else {
      initGsi();
    }
  });
}

/**
 * Sign in with Google Popup and obtain real OAuth Access Token
 */
export const signInWithGoogle = async (autoFallbackToRedirect = false): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;

    // 1. Native App (Capacitor) Flow
    if (Capacitor.isNativePlatform()) {
      console.info('[Google Sign-In] Khởi chạy GoogleAuth trên thiết bị Native App...');
      await ensureGoogleAuthInitialized();

      let nativeResult: any;
      try {
        // DO NOT call GoogleAuth.signOut() here!
        // Calling signOut() synchronously right before signIn() interrupts native GoogleSignInClient state on Android,
        // causing the signIn intent callback to be lost or hang indefinitely.
        const signInPromise = GoogleAuth.signIn();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'TIMEOUT: Quá thời gian thao tác chọn tài khoản Google (25 giây). Vui lòng kiểm tra lại thiết bị hoặc bấm Đăng nhập lại.'
                )
              ),
            25000
          )
        );
        nativeResult = await Promise.race([signInPromise, timeoutPromise]);
      } catch (signInErr: any) {
        console.error('[Google Sign-In Native Error]', signInErr);
        const rawMsg = String(signInErr?.message || signInErr || '');
        if (
          rawMsg.includes('Something went wrong') ||
          rawMsg.includes('10') ||
          rawMsg.includes('12500') ||
          rawMsg.includes('10002')
        ) {
          throw new Error(
            'Lỗi xác thực Google trên Android (Mã 10/12500: Cần thêm mã SHA-1 Fingerprint của file APK vào Firebase Console > Project Settings).'
          );
        }
        if (rawMsg.includes('canceled') || rawMsg.includes('12501') || rawMsg.includes('closed')) {
          throw new Error('Bạn đã hủy thao tác chọn tài khoản Google.');
        }
        throw new Error(rawMsg || 'Đăng nhập Google trên thiết bị Android không thành công.');
      }

      const idToken = nativeResult.authentication?.idToken || (nativeResult as any).idToken;
      let accessToken = nativeResult.authentication?.accessToken || (nativeResult as any).accessToken;
      const refreshToken = nativeResult.authentication?.refreshToken || (nativeResult as any).refreshToken;

      if (!idToken && !accessToken) {
        throw new Error('Không nhận được ID Token / Access Token từ Google Authentication gốc.');
      }

      // Nếu native Google Client không trả về accessToken riêng biệt, sử dụng idToken làm token truy cập
      if (!accessToken) {
        accessToken = idToken;
      }

      const expiresAt = Date.now() + 3500 * 1000;
      saveGoogleAuthSession({
        accessToken,
        idToken: idToken || undefined,
        refreshToken: refreshToken || undefined,
        expiresAt,
        userProfile: {
          email: nativeResult.email || undefined,
          name: nativeResult.displayName || undefined,
          photoUrl: nativeResult.imageUrl || undefined,
        },
      });

      console.info('[Google Sign-In] Đang xác thực với Firebase bằng Google Credential...');
      const credential = GoogleAuthProvider.credential(idToken || null, accessToken !== idToken ? accessToken : null);
      
      const signInFirebasePromise = signInWithCredential(auth, credential);
      const signInFirebaseTimeout = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_FIREBASE: Quá thời gian xác thực với Firebase (15 giây).')), 15000)
      );

      const firebaseUserCredential = await Promise.race([signInFirebasePromise, signInFirebaseTimeout]).catch((fbErr) => {
        console.warn('[Firebase Auth Native Signin Fallback] Sử dụng tài khoản offline tạm thời do lỗi kết nối Firebase:', fbErr);
        return { user: { email: nativeResult.email || 'user@google.com', displayName: nativeResult.displayName || 'Chủ Tài Khoản', photoURL: nativeResult.imageUrl || undefined } as any };
      });
      const user = firebaseUserCredential.user;

      localStorage.setItem('drive_scope_migrated_v2', 'true');

      return {
        user,
        accessToken,
      };
    }

    // 2. Web / AI Studio Preview Flow
    // Đảm bảo Google luôn mở màn hình cho phép người dùng tích chọn quyền Drive
    provider.setCustomParameters({
      prompt: 'consent',
      access_type: 'offline',
    });
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken =
      credential?.accessToken ||
      (result as any)?._tokenResponse?.oauthAccessToken ||
      (result as any)?.credential?.accessToken ||
      (result as any)?._tokenResponse?.accessToken ||
      getGoogleAccessToken() ||
      '';

    if (!accessToken) {
      throw new Error('Không nhận được mã truy cập (Access Token) từ Google Authentication.');
    }

    const expiresAt = Date.now() + 3500 * 1000;
    saveGoogleAuthSession({
      accessToken,
      idToken: credential?.idToken || (result as any)?._tokenResponse?.idToken || undefined,
      expiresAt,
      userProfile: {
        email: result.user.email || undefined,
        name: result.user.displayName || undefined,
        photoUrl: result.user.photoURL || undefined,
      },
    });
    localStorage.setItem('drive_scope_migrated_v2', 'true');
    provider.setCustomParameters({ prompt: 'select_account' });

    return {
      user: result.user,
      accessToken,
    };
  } catch (error: any) {
    const errString = String(error?.message || error || '');
    if (
      errString.includes('getprojectconfig-are-blocked') ||
      errString.includes('identitytoolkit') ||
      errString.includes('auth/requests-to-this-api')
    ) {
      console.info('[Google Sign-In] Firebase Auth backend project config is blocked. Falling back to Google Identity Services (GIS)...');
      try {
        const gisResult = await signInWithGoogleGIS();
        const expiresAt = Date.now() + 3500 * 1000;
        saveGoogleAuthSession({
          accessToken: gisResult.accessToken,
          expiresAt,
          userProfile: {
            email: gisResult.user.email || undefined,
            name: gisResult.user.displayName || undefined,
            photoUrl: (gisResult.user as any).photoURL || undefined,
          },
        });
        localStorage.setItem('drive_scope_migrated_v2', 'true');
        return gisResult;
      } catch (gisErr: any) {
        console.warn('GIS fallback sign-in error:', gisErr);
      }
    }

    if (error?.message?.includes('Khung xem trước') || error?.message?.includes('Tab trình duyệt')) {
      console.info('Opened application in new tab for Google auth:', error.message);
      throw error;
    }
    if (error?.code === 'auth/popup-blocked' || error?.message?.includes('popup-blocked')) {
      console.warn('Google Sign In popup blocked:', error?.message);
      if (autoFallbackToRedirect && !isRunningInIframe()) {
        try {
          sessionStorage.setItem('pending_google_redirect_auth', 'true');
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
    recordSyncAuditLog({
      type: 'SYNC_ERROR',
      title: 'Lỗi đăng nhập / xác thực Google',
      status: 'error',
      summary: `Đăng nhập Google thất bại: ${error?.message || error}`,
      errorMessage: error?.stack || error?.message || String(error),
    });
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
 * If the token is missing, expired, or invalid, it will automatically try silent-refresh,
 * and if that also fails, it will call signInWithGoogle() to re-authorize.
 */
export async function validateAndEnsureToken(): Promise<string> {
  // 1. Nếu token hiện tại còn hạn hợp lệ, trả về ngay lập tức (0ms, không tạo thêm request mạng thừa)
  if (isGoogleTokenValid()) {
    const existing = getGoogleAccessToken();
    if (existing) return existing;
  }

  // 2. Thử làm mới ngầm (Silent Refresh) nếu có phiên hợp lệ
  const silentToken = await trySilentRefresh();
  if (silentToken) return silentToken;

  // 3. Fallback: Nếu không có token hoặc đã hết hạn hoàn toàn, yêu cầu đăng nhập lại
  const res = await signInWithGoogle();
  return res.accessToken;
}

/**
 * Sign out (removes all saved tokens, sessions, and credentials)
 */
export async function signOutGoogle(): Promise<void> {
  // 1. Dọn sạch toàn bộ Token, User Profile và Session trong Storage trước
  cachedAccessToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(ID_TOKEN_KEY);
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem('google_drive_ever_logged_in');
    localStorage.removeItem(MASTER_POINTER_FILE_ID_KEY);
    localStorage.removeItem('savings_auth_user_v3');
    localStorage.removeItem('savings_settings_v3');

    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRES_AT_KEY);

    Preferences.remove({ key: TOKEN_KEY }).catch(() => {});
    Preferences.remove({ key: TOKEN_EXPIRES_AT_KEY }).catch(() => {});
    Preferences.remove({ key: REFRESH_TOKEN_KEY }).catch(() => {});
    Preferences.remove({ key: ID_TOKEN_KEY }).catch(() => {});
    Preferences.remove({ key: USER_PROFILE_KEY }).catch(() => {});
    Preferences.remove({ key: 'google_drive_ever_logged_in' }).catch(() => {});
    Preferences.remove({ key: 'savings_auth_user_v3' }).catch(() => {});

    // Secure storage clean
    removeSecureItem(TOKEN_KEY).catch(() => {});
    removeSecureItem(TOKEN_EXPIRES_AT_KEY).catch(() => {});
    removeSecureItem(REFRESH_TOKEN_KEY).catch(() => {});
    removeSecureItem(ID_TOKEN_KEY).catch(() => {});
    removeSecureItem(USER_PROFILE_KEY).catch(() => {});
  } catch (storageErr) {
    console.warn('Storage cleanup error:', storageErr);
  }

  // 2. Đăng xuất Firebase Auth an toàn
  try {
    await signOut(auth);
  } catch (fbErr) {
    console.warn('Firebase signOut error:', fbErr);
  }

  // 3. Đăng xuất Native GoogleAuth có bọc try/catch chống sập ứng dụng
  if (Capacitor.isNativePlatform()) {
    try {
      await ensureGoogleAuthInitialized();
      await (GoogleAuth as any).signOut();
    } catch (err) {
      console.warn('[GoogleAuth] Native signOut safe warning:', err);
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
 * It also translates CORS/Adblock/Shield-blocked requests into crystal clear troubleshooting steps.
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
      
      // If it fails after all retries, analyze if it is likely blocked by an Adblocker or sandbox iframe
      const isIframe = window.self !== window.top;
      let adblockWarning = 'Lỗi kết nối (Failed to fetch). ';
      if (error?.name === 'AbortError') {
        adblockWarning += 'Kết nối tới Google Drive bị quá thời gian chờ (Timeout sau 15s). Vui lòng kiểm tra kết nối mạng và thử lại.';
      } else if (isIframe) {
        adblockWarning += 'Trình duyệt hoặc phần mềm chặn quảng cáo (Adblock / Brave Shields) đã chặn kết nối Google Drive API từ môi trường xem trước (iframe) của AI Studio. Vui lòng bấm vào biểu tượng "Mở trong tab mới" (ở góc trên bên phải màn hình AI Studio) để chạy ứng dụng trực tiếp, hoặc tạm thời vô hiệu hóa Adblock cho trang web này.';
      } else {
        adblockWarning += 'Không thể kết nối tới máy chủ Google Drive. Vui lòng kiểm tra lại đường truyền internet của bạn hoặc tạm thời tắt các phần mềm chặn quảng cáo (Adblock / Brave Shields).';
      }
      throw new Error(adblockWarning);
    }
    throw error;
  }
}

let memoryDriveFilesCache: RealDriveFile[] | null = null;

export function getCachedRealDriveFiles(): RealDriveFile[] | null {
  if (memoryDriveFilesCache && memoryDriveFilesCache.length > 0) {
    return memoryDriveFilesCache;
  }
  try {
    const saved = sessionStorage.getItem('cached_real_drive_files_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryDriveFilesCache = parsed;
        return parsed;
      }
    }
  } catch {}
  return null;
}

export function setCachedRealDriveFiles(files: RealDriveFile[]): void {
  memoryDriveFilesCache = files;
  try {
    sessionStorage.setItem('cached_real_drive_files_v1', JSON.stringify(files));
  } catch {}
}

/**
 * List real files from the user's Google Drive (All spreadsheets and table files)
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
    url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink, shared, appProperties)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('q', query);

    // Speed optimization: Retrieve sync state directly from local storage instead of slow Sheets API cell lookups
    const localState = getLocalMasterPointerState();
    const activeFileId = localState && localState.status === 'active' ? localState.activeFileId : getLocalMasterPointerFileId();

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
      if (res.status === 403 && errorData?.error?.message?.includes('insufficient authentication scopes')) {
        setGoogleAccessToken(null);
        throw new Error('Tài khoản Google chưa cấp quyền Google Drive (drive.file). Vui lòng đăng xuất và đăng nhập lại để cấp quyền.');
      }
      throw new Error(errorData?.error?.message || `Lỗi từ Google Drive API (Mã ${res.status})`);
    }

    const data = await res.json();
    const rawFiles: any[] = data.files || [];

    // Filter to relevant spreadsheet files or master JSON backup file
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
      const isTagged =
        f.appProperties?.[DRIVE_APP_TAG.key] === DRIVE_APP_TAG.value ||
        f.appProperties?.app_id === DRIVE_APP_TAG.value ||
        f.appProperties?.app_identifier === 'com.tietkiemgiadinh.app';
      const linkedTimestamp = isHub ? (localState?.linkedTimestamp || localState?.updatedAt) : undefined;

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
        isAppTagged: isTagged,
        linkedTimestamp,
      };
    });

    // Also include current activeFileId if present and not already in mappedFiles
    const localPointerId = activeFileId || getLocalMasterPointerFileId();
    if (localPointerId && !mappedFiles.some((m) => m.id === localPointerId)) {
      mappedFiles.push({
        id: localPointerId,
        name: localState?.activeFileName || 'File_So_Tiet_Kiem_Drive',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: localState?.activeFileUrl || `https://docs.google.com/spreadsheets/d/${localPointerId}/edit`,
        isSheetOrExcel: true,
        isCentralHub: true,
        isAppTagged: true,
        linkedTimestamp: localState?.linkedTimestamp,
      });
    }

    // Filter out unrelated files (e.g., "Kho sach", "Bookstore", "Quản lý sách", "Kho hàng") if not tagged
    let filteredFiles = mappedFiles.filter((f) => {
      if (f.isAppTagged || f.isCentralHub) return true;
      const lower = f.name.toLowerCase();
      // Unrelated apps filter
      if (
        lower.includes('kho sach') ||
        lower.includes('kho sách') ||
        lower.includes('bookstore') ||
        lower.includes('ban hang') ||
        lower.includes('bán hàng') ||
        lower.includes('kho hang') ||
        lower.includes('kho hàng')
      ) {
        return false;
      }
      return true;
    });

    // Fallback: If no files remain after filtering, show all mapped files so nothing is hidden by mistake
    if (filteredFiles.length === 0 && mappedFiles.length > 0) {
      filteredFiles = mappedFiles;
    }

    // Sort files: Central hub & Tagged files always placed at the very top
    filteredFiles.sort((a, b) => {
      if (a.isCentralHub && !b.isCentralHub) return -1;
      if (!a.isCentralHub && b.isCentralHub) return 1;
      if (a.isAppTagged && !b.isAppTagged) return -1;
      if (!a.isAppTagged && b.isAppTagged) return 1;
      return 0;
    });

    setCachedRealDriveFiles(filteredFiles);

    return filteredFiles;
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
  isTrashed?: boolean;
  needsPickerAccess?: boolean;
  permissionDenied?: boolean;
} | null> {
  if (!accessToken || !fileId) return null;
  try {
    const driveRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,modifiedTime,version,trashed&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (driveRes.ok) {
      const data = await driveRes.json();
      if (data?.trashed) {
        return { id: fileId, name: data.name || '', mimeType: '', isDeleted: true, isTrashed: true };
      }
      return {
        id: data.id || fileId,
        name: data.name || 'Sổ tiết kiệm',
        mimeType: data.mimeType || 'application/vnd.google-apps.spreadsheet',
        webViewLink: data.webViewLink,
        modifiedTime: data.modifiedTime,
        version: data.version,
        isDeleted: false,
      };
    }

    if (driveRes.status === 404) {
      return {
        id: fileId,
        name: '',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
        needsPickerAccess: true,
        isDeleted: false,
      };
    }

    if (driveRes.status === 403) {
      return {
        id: fileId,
        name: '',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
        permissionDenied: true,
        isDeleted: false,
      };
    }

    return null;
  } catch (err) {
    console.warn('Không thể tải tên file từ Google Drive API:', err);
    return null;
  }
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
    let resolvedMime = mimeType;

    // 1. Get file metadata directly from Google Drive API
    const metaRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (metaRes.status === 401) {
      setGoogleAccessToken(null);
      throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
    }
    if (metaRes.status === 404) {
      throw new Error('NEEDS_PICKER_ACCESS: Tệp Google Drive cần được mở bằng Google Picker để cấp quyền sử dụng file.');
    }
    if (metaRes.status === 403) {
      throw new Error('PERMISSION_DENIED: Tài khoản chưa được cấp quyền truy cập file này trên Google Drive. Vui lòng liên hệ Admin để cấp quyền.');
    }

    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta?.trashed) {
        throw new Error('FILE_TRASHED: File liên kết đã bị chuyển vào thùng rác trên Google Drive.');
      }
      resolvedMime = meta.mimeType || resolvedMime;
    }

    // 2. Fetch binary content directly from Google Drive API
    let fetchUrl: string;
    if (!resolvedMime || resolvedMime === 'application/vnd.google-apps.spreadsheet') {
      // Export Google Sheet as Excel binary (.xlsx)
      fetchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
    } else {
      // Download binary file (Excel or CSV)
      fetchUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    }

    const res = await fetchWithRetry(fetchUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      if (res.status === 404) {
        throw new Error('NEEDS_PICKER_ACCESS: Tệp Google Drive cần được mở bằng Google Picker để cấp quyền sử dụng file.');
      }
      if (res.status === 403) {
        throw new Error('PERMISSION_DENIED: Tài khoản chưa có quyền đọc nội dung file này trên Google Drive.');
      }
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Không thể tải nội dung file từ Google Drive (Mã ${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const parsedBinary = await parseWorkbook(arrayBuffer);
    return parsedBinary;
  } catch (error: any) {
    if (
      error?.message?.includes('hết hạn') ||
      error?.message?.includes('invalid authentication credentials') ||
      error?.message?.includes('FILE_TRASHED') ||
      error?.message?.includes('NEEDS_PICKER_ACCESS') ||
      error?.message?.includes('PERMISSION_DENIED')
    ) {
      console.warn('Thông báo tệp Google Drive:', error.message);
    } else {
      console.error('Lỗi khi đọc file từ Google Drive:', error);
    }
    throw error;
  }
}

/**
 * Upload and update an existing file on Google Drive (Real 2-way sync Push)
 * Works for both native Google Sheets (via Sheets API) and binary Excel files (.xlsx)
 */
export async function updateRealGoogleDriveFile(
  accessToken: string,
  fileId: string,
  books: SavingsBook[],
  settlements: SettlementAdjustment[] = []
): Promise<boolean> {
  try {
    // 0. Check if file is trashed or deleted first
    const metaCheck = await getRealGoogleDriveFileMetadata(accessToken, fileId);
    if (metaCheck?.isDeleted) {
      throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc chuyển vào thùng rác trên Google Drive.');
    }
    // 1. Get file metadata to check if it's a native Google Sheet or an uploaded Excel file
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
      // fallback for other network errors
    }

    if (isGoogleSheet) {
      // 0. Fetch first sheet title to prefix ranges safely (in case user has custom sheet name)
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
              sheetPrefix = /[\s!@#$%^&*()\-+=\[\]{};:",.<>?\/\\|]/.test(firstProp.title)
                ? `'${firstProp.title}'!`
                : `${firstProp.title}!`;
            }
            if (firstProp.sheetId !== undefined) {
              targetSheetId = firstProp.sheetId;
            }
          }
        }
      } catch {
        // fallback
      }

      // 1. Translate App SavingsBook[] to exact 12-column data rows (starting at Row 2)
      // Note: Sổ đã tất toán đã bị loại bỏ khỏi books, nên dataRows chỉ gồm các sổ đang hoạt động
      const dataRows = translateBooksToDataRows(books);
      const rowCount = dataRows.length;

      // 2. Clear ONLY the book rows range (A2:L35 max), preserving Row 1 Headers and Columns N..S
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

      // 3. Đọc dữ liệu các cột N:AC hiện có từ Google Sheet để bảo toàn dữ liệu lịch sử
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

      // 3.1. Tính toán LÃI HÀNG NĂM & SỐ CUỐI NĂM
      const annualInterestList = getDynamicAnnualInterestHistory(books, settlements);
      const balanceGrowthList = getDynamicBalanceGrowthHistory(books, settlements);
      const activityLogList = deduplicateSettlementAdjustments(settlements || []);

      const batchDataPayload: { range: string; majorDimension: string; values: any[][] }[] = [];
      const updatedRangesAudit: string[] = [];

      // A. CẬP NHẬT DANH MỤC SỔ TIẾT KIỆM (A2:L...)
      const targetRange = `${sheetPrefix}A2:L${1 + rowCount}`;
      batchDataPayload.push({
        range: targetRange,
        majorDimension: 'ROWS',
        values: dataRows,
      });
      updatedRangesAudit.push(`A2:L${1 + rowCount}`);

      // Xóa triệt để các hàng sổ cũ dôi dư (ví dụ vừa tất toán sổ làm giảm số lượng sổ từ 18 xuống 17)
      // Giúp ngăn ngừa việc PULL lại từ Sheet làm "hồi sinh" sổ cũ đã tất toán!
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

      // B. BẢO VỆ & CẬP NHẬT LÃI HÀNG NĂM (Cột N & O)
      // Tìm các năm hiện có ở cột N (index 0)
      const existingAnnualMap = new Map<number, number>(); // year -> sheet row (1-indexed)
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
        // Sheet ĐÃ CÓ các năm cũ: TUYỆT ĐỐI KHÔNG GHI ĐÈ các hàng cũ!
        // Chỉ cập nhật hoặc ghi tiếp cho các năm 2026, 2027, 2028
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
      } else if (annualInterestList && annualInterestList.length > 0) {
        const annualRows = annualInterestList.map((a) => [a.year, a.interestEarnedMillion]);
        batchDataPayload.push({
          range: `${sheetPrefix}N2:O${1 + annualRows.length}`,
          majorDimension: 'ROWS',
          values: annualRows,
        });
        updatedRangesAudit.push(`N2:O${1 + annualRows.length} (Cập nhật Lãi Hàng Năm)`);
      }

      // C. BẢO VỆ & CẬP NHẬT SỐ DƯ CUỐI NĂM & THU NHẬP NĂM (Cột Q, R, S)
      const existingBalanceMap = new Map<number, number>(); // year -> sheet row (1-indexed)
      for (let i = 1; i < existingMatrixNtoAC.length; i++) {
        const yrRaw = parseInt(String(existingMatrixNtoAC[i]?.[3] || '').replace(/\D/g, ''), 10);
        if (yrRaw >= 2000 && yrRaw <= 2099) {
          existingBalanceMap.set(yrRaw, i + 1);
        }
      }

      if (balanceGrowthList && balanceGrowthList.length > 0) {
        if (existingBalanceMap.size > 0) {
          // Sheet đã có các dòng số dư: Cập nhật hoặc thêm mới các năm chưa có
          balanceGrowthList.forEach((rec) => {
            let targetRow = existingBalanceMap.get(rec.year);
            if (!targetRow) {
              const maxBalRow = Math.max(...Array.from(existingBalanceMap.values()), 1);
              targetRow = maxBalRow + 1;
              existingBalanceMap.set(rec.year, targetRow);
            }
            batchDataPayload.push({
              range: `${sheetPrefix}Q${targetRow}:S${targetRow}`,
              majorDimension: 'ROWS',
              values: [[rec.year, rec.balanceMillion, rec.annualIncomeMillion !== undefined ? rec.annualIncomeMillion : '']],
            });
            updatedRangesAudit.push(`Q${targetRow}:S${targetRow} (Năm ${rec.year})`);
          });
        } else {
          // Sheet chưa có dữ liệu số dư: Ghi toàn bộ danh sách
          const fullBalances = balanceGrowthList.map((b) => [
            b.year,
            b.balanceMillion,
            b.annualIncomeMillion !== undefined ? b.annualIncomeMillion : '',
          ]);
          batchDataPayload.push({
            range: `${sheetPrefix}Q2:S${1 + fullBalances.length}`,
            majorDimension: 'ROWS',
            values: fullBalances,
          });
          updatedRangesAudit.push(`Q2:S${1 + fullBalances.length} (Khởi tạo Bảng Số Dư)`);
        }
      }

      // D. BẢO VỆ & CẬP NHẬT NHẬT KÝ BIẾN ĐỘNG / TẤT TOÁN (Cột U..AC)
      // Tự động nhận diện cấu trúc 9 cột (có ID biến động ở U) hoặc cấu trúc cũ 8 cột (bắt đầu bằng Ngày ở U)
      let colUHeader = '';
      if (existingMatrixNtoAC.length > 0 && existingMatrixNtoAC[0]) {
        colUHeader = String(existingMatrixNtoAC[0][7] || '').toLowerCase().normalize('NFC').trim();
      }
      const is9ColLayout = colUHeader.includes('id');

      let maxExistingActivityRow = 1;
      existingMatrixNtoAC.slice(1).forEach((r, idx) => {
        const rowNum = idx + 2;
        // Kiểm tra xem hàng này ở cột U..AC có dữ liệu không (indices 7..15 trong N:AC)
        const checkIndices = is9ColLayout ? [7, 8, 9, 10, 11, 12, 13, 14, 15] : [7, 8, 9, 10, 11, 12, 13, 14];
        const hasData = checkIndices.some(
          (cIdx) => r[cIdx] !== undefined && String(r[cIdx]).trim() !== ''
        );
        if (hasData) {
          maxExistingActivityRow = Math.max(maxExistingActivityRow, rowNum);
        }
      });
      const existingActivityCount = Math.max(0, maxExistingActivityRow - 1);

      if (activityLogList.length > 0) {
        const activityRows = activityLogList.map((s, idx) => {
          const cleanCode = (s.bookCode || 'SO').replace(/\s+/g, '').toUpperCase();
          const shortBank = getBankShortCode(s.bankId, cleanCode);
          // Thống nhất kiểu ID biến động theo dạng ADJ_{index}_{Mã_Sổ} (ví dụ ADJ_1_SEA-2609-1100)
          const standardizedId = `ADJ_${idx + 1}_${cleanCode}`;

          if (is9ColLayout) {
            return [
              standardizedId,
              translateDateToSheet(s.settlementDate || '', 'yyyy-mm-dd'),
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
              translateDateToSheet(s.settlementDate || '', 'yyyy-mm-dd'),
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

        // Nếu số dòng nhật ký hiện có trên Sheet nhiều hơn số dòng app ghi (ví dụ Sheet đang có 4 dòng, nhưng app chỉ ghi 1 dòng):
        // Bắt buộc xóa sạch các dòng dôi dư để dọn sạch nhật ký thừa
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
          updatedRangesAudit.push(`U${clearStartRow}:${clearColLetter}${clearEndRow} (Dọn sạch ${clearRowCount} dòng nhật ký thừa trên Sheet)`);
        }

        const targetColLetter = is9ColLayout ? 'AC' : 'AB';
        batchDataPayload.push({
          range: `${sheetPrefix}U2:${targetColLetter}${1 + activityRows.length}`,
          majorDimension: 'ROWS',
          values: activityRows,
        });
        updatedRangesAudit.push(`U2:${targetColLetter}${1 + activityRows.length} (${activityRows.length} dòng nhật ký)`);
      }
      // Lưu ý: Nếu existingActivityCount > 0 và activityLogList rỗng, TUYỆT ĐỐI KHÔNG GHI ĐÈ để bảo vệ dòng dữ liệu cũ trong Sheet!

      // 4. Batch update chính xác vào các ô được chỉ định (KHÔNG DÙNG PADDING Ô TRỐNG ĐỂ XÓA DỮ LIỆU)
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

          if (
            putRes.status === 401 ||
            err?.error?.status === 'UNAUTHENTICATED' ||
            err?.error?.code === 401 ||
            err?.error?.message?.includes('invalid authentication credentials') ||
            err?.error?.message?.includes('Invalid Credentials')
          ) {
            setGoogleAccessToken(null);
            throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
          }
          if (putRes.status === 404) {
            throw new Error('FILE_NOT_FOUND: File liên kết đã bị xóa hoặc không còn tồn tại trên Google Drive.');
          }
          throw new Error(errMsg);
        }

        // 5. Đồng bộ định dạng font (Arial 10pt), kẻ khung viền (Borders) và sao chép định dạng đồng đều cho toàn bộ các dòng
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
                // 1. Format Cột F (5) & Cột G (6) Ngày gửi & Ngày đáo hạn dạng DATE (dd/mm/yyyy)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 5,
                      endColumnIndex: 7,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'DATE',
                          pattern: 'dd/mm/yyyy',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 2. Format Cột V (21) Ngày biến động dạng DATE (dd/mm/yyyy)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 21,
                      endColumnIndex: 22,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'DATE',
                          pattern: 'dd/mm/yyyy',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 3. Format Cột E (4) Tiền gửi dạng NUMBER (#,##0)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 4,
                      endColumnIndex: 5,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 4. Format Cột J (9) & K (10) Tiền lãi dạng NUMBER (#,##0.0#)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 9,
                      endColumnIndex: 11,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0.0#',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 5. Format Cột O (14), R (17), S (18), AA (26) dạng NUMBER (#,##0)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 14,
                      endColumnIndex: 15,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 17,
                      endColumnIndex: 19,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 26,
                      endColumnIndex: 27,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 6. Format Cột AB (27) Lãi thực nhận biến động dạng NUMBER (#,##0.0#)
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 100,
                      startColumnIndex: 27,
                      endColumnIndex: 28,
                    },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: 'NUMBER',
                          pattern: '#,##0.0#',
                        },
                      },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                  },
                },
                // 7. Ép phông chữ Arial 10pt Bold cho tiêu đề hàng 1
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
                // 8. Phông chữ Arial 10pt cho các dòng dữ liệu
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
                // 9. Kẻ khung viền mỏng
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
      // Binary Excel (.xlsx) file on Google Drive
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
          err?.error?.message?.includes('invalid authentication credentials') ||
          err?.error?.message?.includes('Invalid Credentials')
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

    const cleanFileName = fileName.replace(/\.xlsx$/i, '').trim() || 'So_tiet_kiem';

    const metadata = {
      name: cleanFileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      appProperties: {
        [DRIVE_APP_TAG.key]: DRIVE_APP_TAG.value,
        [DRIVE_APP_TAG.typeKey]: DRIVE_APP_TAG.typeValue,
      },
    };

    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json; charset=UTF-8' })
    );
    form.append('file', fileBlob);

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,appProperties';
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
        err?.error?.message?.includes('invalid authentication credentials') ||
        err?.error?.message?.includes('Invalid Credentials')
      ) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      throw new Error(err?.error?.message || `Không thể tạo Google Sheet mới trên Google Drive (Mã ${res.status})`);
    }

    const data = await res.json();
    const linkedTimestamp = new Date().toISOString();
    const webViewLink = data.webViewLink || `https://docs.google.com/spreadsheets/d/${data.id}/edit`;

    const effectiveOwnerEmail = (
      userEmail ||
      getGoogleUserProfile()?.email ||
      auth.currentUser?.email ||
      ''
    ).trim().toLowerCase();

    const initialMembers: WorkspaceMember[] = effectiveOwnerEmail
      ? [
          {
            id: `owner-${Date.now()}`,
            email: effectiveOwnerEmail,
            name: getGoogleUserProfile()?.name || auth.currentUser?.displayName || 'Admin',
            role: 'ADMIN',
            addedAt: linkedTimestamp,
          },
        ]
      : [];

    // Save Master Sync State on Drive for this new file (Single Source of Truth)
    try {
      await saveMasterSyncStateOnDrive(accessToken, {
        status: 'active',
        lastAction: 'create_and_link',
        activeFileId: data.id,
        activeFileName: data.name,
        activeFileUrl: webViewLink,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        linkedTimestamp,
        linkedAccountEmail: effectiveOwnerEmail || 'Google User',
        adminEmail: effectiveOwnerEmail || 'admin',
        members: initialMembers,
        settlements,
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

/**
 * Delete a file on the user's real Google Drive
 */
export async function deleteRealGoogleDriveFile(
  accessToken: string,
  fileId: string
): Promise<boolean> {
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
    const res = await fetchWithRetry(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok && res.status !== 404) {
      if (res.status === 401) {
        setGoogleAccessToken(null);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm đăng nhập lại.');
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Không thể xóa tệp trên Google Drive (Mã ${res.status})`);
    }
    return true;
  } catch (error: any) {
    console.error('Lỗi khi xóa tệp trên Google Drive:', error);
    throw error;
  }
}

/**
 * Stamp central hub metadata (appProperties, description, linked_timestamp) on a linked Google Drive file.
 * Ensures any device logging in with the same account can auto-discover this file as the central data hub (Single Source of Truth).
 * Automatically un-stamps any previous files so only 1 file on Drive remains marked as active central hub.
 */
/**
 * Master Sync State stored directly on user's Google Drive as a single source of truth
 */
export type { MasterSyncState };

export const MASTER_STATE_FILENAME = 'so_tiet_kiem_backup.json';

/**
 * Helper to sync MasterSyncState into AppSettings and compute current role dynamically.
 * Accepts optional currentSettings to compare and skip redundant setSettings calls (avoiding app re-renders).
 */
export function applyMasterStateToSettings(
  masterState: MasterSyncState | null,
  currentUserEmail: string | undefined,
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>,
  currentSettings?: AppSettings,
  accessToken?: string
) {
  if (!masterState) return;

  const cleanUserEmail = currentUserEmail?.trim().toLowerCase();
  const adminEmail = (masterState.adminEmail || masterState.linkedAccountEmail || '').trim().toLowerCase();

  let resolvedRole: UserRole = 'ADMIN';
  if (cleanUserEmail) {
    if (adminEmail && cleanUserEmail === adminEmail) {
      resolvedRole = 'ADMIN';
    } else if (masterState.members && masterState.members.length > 0) {
      const matchedMember = masterState.members.find(
        (m) => m.email && m.email.trim().toLowerCase() === cleanUserEmail
      );
      if (matchedMember && matchedMember.role) {
        resolvedRole = matchedMember.role.toUpperCase() as UserRole;
      } else {
        resolvedRole = 'VIEWER';
      }
    } else {
      resolvedRole = 'ADMIN';
    }
  }

  const newMembers = masterState.members && masterState.members.length > 0 ? masterState.members : [];
  const newFileUrl = masterState.activeFileId ? (masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${masterState.activeFileId}/edit`) : undefined;
  const newFileName = masterState.activeFileId ? masterState.activeFileName : undefined;
  const newTimestamp = masterState.activeFileId ? masterState.linkedTimestamp : undefined;

  // Auto-revoke permissions if Admin detects members who self-exited on Drive
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

  // Tự động rà soát và đồng bộ quyền Google Drive (file Excel và file JSON master) khớp với danh sách members trong JSON khi Admin đăng nhập/đồng bộ:
  // Nếu JSON không có danh sách user (danh sách members rỗng hoặc chỉ có Admin), toàn bộ quyền chia sẻ cho người khác phải bị thu hồi ngay!
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

  // Jump out early if currentSettings provided and nothing changed
  if (currentSettings) {
    const hasRoleChange = currentSettings.currentRole !== resolvedRole;
    const hasMembersChange = JSON.stringify(currentSettings.members || []) !== JSON.stringify(newMembers);
    const hasOwnerChange = Boolean(adminEmail && currentSettings.workspaceOwnerEmail !== adminEmail);
    const hasFileChange = Boolean(newFileUrl && currentSettings.googleSheetUrl !== newFileUrl);
    const hasFileNameChange = Boolean(newFileName && newFileName !== 'File_So_Tiet_Kiem_Drive' && currentSettings.googleSheetName !== newFileName);
    const hasTimestampChange = Boolean(newTimestamp && currentSettings.lastLocalLinkTimestamp !== newTimestamp);

    if (!hasRoleChange && !hasMembersChange && !hasOwnerChange && !hasFileChange && !hasFileNameChange && !hasTimestampChange) {
      return; // Skip setSettings completely to prevent unnecessary re-renders
    }
  }

  setSettings((prev) => {
    const updates: Partial<AppSettings> = {};

    // Merge prev.members and newMembers to preserve local optimistic member additions
    const memberMap = new Map<string, WorkspaceMember>();
    (prev.members || []).forEach((m) => {
      if (m && m.email) memberMap.set(m.email.trim().toLowerCase(), m);
    });
    newMembers.forEach((m) => {
      if (m && m.email) memberMap.set(m.email.trim().toLowerCase(), m);
    });
    const mergedMembersList = Array.from(memberMap.values());

    if (mergedMembersList.length > 0 && JSON.stringify(prev.members || []) !== JSON.stringify(mergedMembersList)) {
      updates.members = mergedMembersList;
    }

    if (adminEmail && prev.workspaceOwnerEmail !== adminEmail) {
      updates.workspaceOwnerEmail = adminEmail;
    }

    if (masterState.activeFileId && masterState.status !== 'unlinked') {
      if (newFileUrl && prev.googleSheetUrl !== newFileUrl) {
        updates.googleSheetUrl = newFileUrl;
      }
      if (newFileName && newFileName !== 'File_So_Tiet_Kiem_Drive' && prev.googleSheetName !== newFileName) {
        updates.googleSheetName = newFileName;
      }
      if (newTimestamp && prev.lastLocalLinkTimestamp !== newTimestamp) {
        updates.lastLocalLinkTimestamp = newTimestamp;
      }
    }

    if (Object.keys(updates).length === 0) {
      return prev; // Return prev unchanged so React skips re-render
    }

    return { ...prev, ...updates };
  });
}

/**
 * Helper to get current Vietnam time formatted nicely for human reading in JSON
 */
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

function getVietnamTimeFormatted(): string {
  return formatIsoToVietnamTime();
}

const LOCAL_MASTER_STATE_KEY = 'master_sync_state_local_v2';
const LOCAL_ACTIVE_FILE_ID_KEY = 'last_linked_file_id_v2';

export function getLocalMasterPointerFileId(): string | null {
  try {
    return localStorage.getItem(LOCAL_ACTIVE_FILE_ID_KEY) || localStorage.getItem(MASTER_POINTER_FILE_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function isExplicitlyUnlinked(): boolean {
  try {
    return (
      localStorage.getItem('explicitly_unlinked') === 'true' ||
      sessionStorage.getItem('explicitly_unlinked') === 'true'
    );
  } catch {
    return false;
  }
}

export function addUnlinkedFileId(fileId: string): void {
  try {
    if (!fileId) return;
    const current = getUnlinkedFileIds();
    if (!current.includes(fileId)) {
      current.push(fileId);
      const str = JSON.stringify(current);
      localStorage.setItem('unlinked_file_ids_v1', str);
      Preferences.set({ key: 'unlinked_file_ids_v1', value: str }).catch(() => {});
    }
  } catch {}
}

export function getUnlinkedFileIds(): string[] {
  try {
    const raw = localStorage.getItem('unlinked_file_ids_v1');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {}
  return [];
}

export function isFileUnlinked(fileId: string): boolean {
  if (!fileId) return false;
  return getUnlinkedFileIds().includes(fileId);
}

export function setExplicitlyUnlinked(unlinked: boolean): void {
  try {
    if (unlinked) {
      localStorage.setItem('explicitly_unlinked', 'true');
      sessionStorage.setItem('explicitly_unlinked', 'true');
      Preferences.set({ key: 'explicitly_unlinked', value: 'true' }).catch(() => {});
      saveLocalMasterPointerFileId(null);
      saveLocalMasterPointerState(null);
    } else {
      localStorage.removeItem('explicitly_unlinked');
      sessionStorage.removeItem('explicitly_unlinked');
      Preferences.remove({ key: 'explicitly_unlinked' }).catch(() => {});
    }
  } catch {}
}

export function saveLocalMasterPointerFileId(fileId: string | null): void {
  try {
    if (fileId) {
      localStorage.setItem(LOCAL_ACTIVE_FILE_ID_KEY, fileId);
      localStorage.setItem(MASTER_POINTER_FILE_ID_KEY, fileId);
    } else {
      localStorage.removeItem(LOCAL_ACTIVE_FILE_ID_KEY);
      localStorage.removeItem(MASTER_POINTER_FILE_ID_KEY);
    }
  } catch {}
}

export function getLocalMasterPointerState(): MasterSyncState | null {
  try {
    const raw = localStorage.getItem(LOCAL_MASTER_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveLocalMasterPointerState(state: MasterSyncState | null): void {
  try {
    if (state) {
      localStorage.setItem(LOCAL_MASTER_STATE_KEY, JSON.stringify(state));
      if (state.activeFileId) {
        saveLocalMasterPointerFileId(state.activeFileId);
      }
    } else {
      localStorage.removeItem(LOCAL_MASTER_STATE_KEY);
    }
  } catch {}
}

/**
 * Đọc cấu hình Master Workspace và phân quyền trực tiếp từ Tab ẩn __CONFIG__ của Google Sheet
 */
export async function readMasterSyncStateFromGoogleSheet(
  accessToken: string,
  fileId: string
): Promise<MasterSyncState | null> {
  try {
    if (!accessToken || !fileId) return null;

    // 1. Lấy dữ liệu dải ô cấu hình từ tab ẩn __CONFIG__
    const configRange = '__CONFIG__!A1:B30';
    const res = await fetchWithRetry(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(configRange)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.status === 404 || res.status === 403) {
      return null;
    }

    if (res.ok) {
      const data = await res.json();
      const rows: any[][] = data.values || [];
      if (rows.length > 0) {
        // Đọc danh sách Key-Value từ tab __CONFIG__
        const kvMap = new Map<string, any>();
        let metadataParsed: any = {};
        for (const row of rows) {
          if (row[0] !== undefined) {
            const key = String(row[0]).trim().toLowerCase();
            const val = row[1];
            kvMap.set(key, val);
            if (key === '__metadata_json__' && typeof val === 'string') {
              try {
                metadataParsed = JSON.parse(val) || {};
              } catch {}
            }
          }
        }

        let membersList: WorkspaceMember[] = Array.isArray(metadataParsed.members) ? metadataParsed.members : [];
        const rawMembers = kvMap.get('members json') || kvMap.get('members');
        if (typeof rawMembers === 'string') {
          try {
            const p = JSON.parse(rawMembers);
            if (Array.isArray(p) && p.length > 0) membersList = p;
          } catch {}
        }

        let settlementsList: SettlementAdjustment[] = Array.isArray(metadataParsed.settlements) ? metadataParsed.settlements : [];
        const rawSettlements = kvMap.get('settlements json') || kvMap.get('settlements');
        if (typeof rawSettlements === 'string') {
          try {
            const p = JSON.parse(rawSettlements);
            if (Array.isArray(p) && p.length > 0) settlementsList = p;
          } catch {}
        }

        let banksConfigList: BankInfo[] | undefined = Array.isArray(metadataParsed.banksConfig) ? metadataParsed.banksConfig : undefined;
        const rawBanks = kvMap.get('banks config json') || kvMap.get('banks config');
        if (typeof rawBanks === 'string') {
          try {
            const p = JSON.parse(rawBanks);
            if (Array.isArray(p) && p.length > 0) banksConfigList = p;
          } catch {}
        }
        if (Array.isArray(banksConfigList) && banksConfigList.length > 0) {
          updateBanksFromRemote(banksConfigList);
        }

        let auditLogsList: SyncAuditLogEntry[] | undefined = Array.isArray(metadataParsed.auditLogs) ? metadataParsed.auditLogs : undefined;
        const rawAudit = kvMap.get('audit logs json') || kvMap.get('audit logs');
        if (typeof rawAudit === 'string') {
          try {
            const p = JSON.parse(rawAudit);
            if (Array.isArray(p) && p.length > 0) auditLogsList = p;
          } catch {}
        }

        return {
          status: metadataParsed.status || (kvMap.get('status') as any) || 'active',
          lastAction: metadataParsed.lastAction || (kvMap.get('last action') as any) || 'link',
          activeFileId: fileId,
          activeFileName: metadataParsed.activeFileName || kvMap.get('vault name') || '',
          activeFileUrl: metadataParsed.activeFileUrl || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          linkedTimestamp: metadataParsed.linkedTimestamp || kvMap.get('linked timestamp') || '',
          linkedLocalTimeVi: metadataParsed.linkedLocalTimeVi || kvMap.get('linked local time') || '',
          linkedAccountEmail: metadataParsed.linkedAccountEmail || kvMap.get('linked account') || '',
          adminEmail: metadataParsed.adminEmail || kvMap.get('admin email') || '',
          schemaVersion: metadataParsed.schemaVersion || 2,
          updatedAt: metadataParsed.updatedAt || kvMap.get('updated at') || '',
          updatedAtVi: metadataParsed.updatedAtVi || '',
          members: membersList,
          settlements: [],
          banksConfig: banksConfigList || getAllBanks(),
          auditLogs: auditLogsList || getSyncAuditLogs(),
        };
      }
    }

    return null;
  } catch (err) {
    console.warn('[Sheet Config] Lỗi đọc tab cấu hình __CONFIG__ từ Google Sheet:', err);
    return null;
  }
}

/**
 * Ghi trạng thái Master Workspace và thông tin thành viên trực tiếp vào Tab ẩn __CONFIG__ của Google Sheet
 */
export async function saveMasterSyncStateToGoogleSheet(
  accessToken: string,
  fileId: string,
  state: MasterSyncState
): Promise<boolean> {
  try {
    if (!accessToken || !fileId) return false;

    const effectiveBanksConfig =
      Array.isArray(state.banksConfig) && state.banksConfig.length > 0
        ? state.banksConfig
        : getAllBanks();

    const effectiveAuditLogs =
      Array.isArray(state.auditLogs) && state.auditLogs.length > 0
        ? state.auditLogs
        : getSyncAuditLogs();

    // Loại bỏ các danh sách chi tiết quá lớn để tránh vượt quá giới hạn 50,000 ký tự của một ô trong Google Sheets
    const lightweightAuditLogs = effectiveAuditLogs.slice(0, 15).map((log) => {
      if (log.details) {
        const {
          columns_A_to_M_books,
          columns_U_to_AC_settlements,
          columns_N_to_P_annualInterest,
          columns_Q_to_S_balanceGrowth,
          ...restDetails
        } = log.details;
        return {
          ...log,
          details: restDetails,
        };
      }
      return log;
    });

    const nowIso = state.updatedAt || new Date().toISOString();
    const nowVi = state.updatedAtVi || formatIsoToVietnamTime(nowIso);
    const coreMetadataPayload = JSON.stringify({
      schemaVersion: 2,
      status: state.status || 'active',
      lastAction: state.lastAction || 'link',
      activeFileId: state.activeFileId || fileId,
      activeFileName: state.activeFileName || '',
      activeFileUrl: state.activeFileUrl || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      adminEmail: state.adminEmail || '',
      linkedAccountEmail: state.linkedAccountEmail || '',
      linkedTimestamp: state.linkedTimestamp || '',
      linkedLocalTimeVi: state.linkedLocalTimeVi || '',
      updatedAt: nowIso,
      updatedAtVi: nowVi,
      appProperties: {
        [DRIVE_APP_TAG.key]: DRIVE_APP_TAG.value,
        [DRIVE_APP_TAG.typeKey]: DRIVE_APP_TAG.typeValue,
      },
    });

    const values: (string | number)[][] = [
      ['__METADATA_JSON__', coreMetadataPayload],
      ['Vault Name', state.activeFileName || ''],
      ['Admin Email', state.adminEmail || ''],
      ['Linked Account', state.linkedAccountEmail || ''],
      ['Status', state.status || 'active'],
      ['Last Action', state.lastAction || 'link'],
      ['Linked Timestamp', state.linkedLocalTimeVi || state.linkedTimestamp || ''],
      ['Updated At', nowVi],
      ['Members JSON', JSON.stringify(state.members || [])],
      ['Banks Config', JSON.stringify(effectiveBanksConfig)],
      ['Audit Logs JSON', JSON.stringify(lightweightAuditLogs)],
    ];

    // 0. Kiểm tra mimeType file trước: Google Sheets API v4 chỉ hoạt động với native Google Sheets
    const metaCheck = await getRealGoogleDriveFileMetadata(accessToken, fileId);
    if (metaCheck?.mimeType && metaCheck.mimeType !== 'application/vnd.google-apps.spreadsheet') {
      console.info('[Sheet Config] File liên kết là file Office Excel (.xlsx), tự động bỏ qua ghi tab __CONFIG__ qua Sheets API.');
      return true;
    }

    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values:batchUpdate`;
    const writeData = () => fetchWithRetry(batchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `__CONFIG__!A1:B${values.length}`,
            majorDimension: 'ROWS',
            values: values,
          }
        ]
      }),
    });

    // 1. Thử ghi dữ liệu trực tiếp lên tab __CONFIG__
    let updateRes = await writeData();

    // 2. Nếu thất bại vì tab __CONFIG__ chưa tồn tại, tiến hành tạo mới rồi thử ghi lại
    let errJson: any = null;
    if (!updateRes.ok) {
      errJson = await updateRes.json().catch(() => ({}));
      
      // Chấp nhận mọi lỗi 400 (vì khi chưa có tab __CONFIG__ thì API ghi luôn báo lỗi 400 dải ô không tồn tại độc lập với ngôn ngữ vùng của người dùng)
      if (updateRes.status === 400) {
        console.warn('[Sheet Config] Tab __CONFIG__ chưa tồn tại hoặc dải ô không hợp lệ, tiến hành tạo mới...');
        
        const createRes = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title: '__CONFIG__',
                    hidden: true,
                    gridProperties: { rowCount: 50, columnCount: 5 }
                  }
                }
              }
            ]
          }),
        });

        if (createRes.ok) {
          updateRes = await writeData();
          if (!updateRes.ok) {
            errJson = await updateRes.json().catch(() => ({}));
          }
        }
      }
    }

    if (!updateRes.ok) {
      const finalErr = errJson || await updateRes.json().catch(() => ({}));
      console.warn('[Sheet Config] Bỏ qua ghi tab __CONFIG__:', finalErr?.error?.message || 'Ghi tab không khả thi');
    } else {
      ensureConfigSheetIsHidden(accessToken, fileId).catch(() => {});
    }

    return true;
  } catch (err: any) {
    console.warn('[Sheet Config] Lỗi hệ thống khi ghi tab cấu hình:', err);
    return false;
  }
}

/**
 * Đảm bảo tab __CONFIG__ luôn ở trạng thái ẩn (hidden: true) trên Google Sheets
 */
export async function ensureConfigSheetIsHidden(accessToken: string, fileId: string): Promise<void> {
  try {
    const metaRes = await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    const sheets = meta.sheets || [];
    const configSheet = sheets.find((s: any) => s.properties?.title === '__CONFIG__');
    if (configSheet && configSheet.properties && !configSheet.properties.hidden) {
      const sheetId = configSheet.properties.sheetId;
      await fetchWithRetry(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  hidden: true,
                },
                fields: 'hidden',
              },
            },
          ],
        }),
      });
      console.info('[Sheet Config] Đã tự động ẩn tab __CONFIG__ thành công.');
    }
  } catch (err) {
    console.warn('[Sheet Config] Không thể ẩn tab __CONFIG__:', err);
  }
}

/**
 * Nạp trạng thái Master Sync Pointer trực tiếp từ Google Sheet liên kết (hoặc bộ nhớ cục bộ)
 */
export async function getMasterSyncStateFromDrive(
  accessToken: string,
  explicitFileId?: string
): Promise<MasterSyncState | null> {
  try {
    const targetFileId = explicitFileId || getLocalMasterPointerFileId();
    const localState = getLocalMasterPointerState();

    if (targetFileId && accessToken) {
      const sheetState = await readMasterSyncStateFromGoogleSheet(accessToken, targetFileId);
      if (sheetState) {
        // Merge members intelligently so local optimistic member additions are never lost
        if (localState?.members && localState.members.length > 0) {
          const memberMap = new Map<string, WorkspaceMember>();
          (sheetState.members || []).forEach((m) => m && m.email && memberMap.set(m.email.trim().toLowerCase(), m));
          (localState.members || []).forEach((m) => m && m.email && memberMap.set(m.email.trim().toLowerCase(), m));
          sheetState.members = Array.from(memberMap.values());
        }
        saveLocalMasterPointerState(sheetState);
        return sheetState;
      }
    }

    // Do not fall back to cached localState if we are explicitly asking for a different file ID
    if (localState && (!targetFileId || localState.activeFileId === targetFileId)) {
      return localState;
    }

    return null;
  } catch (err) {
    console.warn('Error reading master sync pointer from sheet:', err);
    const localState = getLocalMasterPointerState();
    if (localState && (!explicitFileId || localState.activeFileId === explicitFileId)) {
      return localState;
    }
    return null;
  }
}

/**
 * Lấy file ID của file master pointer trên Google Drive (nếu có để dọn dẹp)
 */
export async function getMasterPointerFileId(accessToken: string): Promise<string | null> {
  return getLocalMasterPointerFileId();
}

/**
 * Lưu trạng thái Master Workspace trực tiếp vào Tab ẩn __CONFIG__ của Google Sheet và đồng bộ quyền Google Drive
 */
export async function saveMasterSyncStateOnDrive(
  accessToken: string,
  state: MasterSyncState
): Promise<string | null> {
  try {
    const nowIso = new Date().toISOString();
    const nowVi = formatIsoToVietnamTime(nowIso);
    const linkedIso = state.linkedTimestamp || nowIso;
    const linkedVi = state.linkedLocalTimeVi || formatIsoToVietnamTime(linkedIso);

    const existingLocal = getLocalMasterPointerState();

    const mergedMembers =
      state.members !== undefined
        ? state.members
        : existingLocal?.members || [];

    const mergedAdminEmail =
      state.adminEmail || existingLocal?.adminEmail || state.linkedAccountEmail || 'Google User';

    const mergedBanksConfig =
      state.banksConfig !== undefined && Array.isArray(state.banksConfig) && state.banksConfig.length > 0
        ? state.banksConfig
        : existingLocal?.banksConfig && existingLocal.banksConfig.length > 0
        ? existingLocal.banksConfig
        : getAllBanks();

    const mergedAuditLogs =
      state.auditLogs !== undefined && Array.isArray(state.auditLogs) && state.auditLogs.length > 0
        ? state.auditLogs
        : existingLocal?.auditLogs && existingLocal.auditLogs.length > 0
        ? existingLocal.auditLogs
        : getSyncAuditLogs();

    const preparedState: MasterSyncState = {
      ...existingLocal,
      ...state,
      schemaVersion: 2,
      adminEmail: mergedAdminEmail,
      members: mergedMembers,
      banksConfig: mergedBanksConfig,
      auditLogs: mergedAuditLogs,
      linkedTimestamp: linkedIso,
      linkedLocalTimeVi: linkedVi,
      updatedAt: state.updatedAt || nowIso,
      updatedAtVi: nowVi,
    };

    // 1. Lưu vào bộ nhớ cục bộ trên máy
    saveLocalMasterPointerState(preparedState);

    // 2. Ghi trực tiếp vào tab ẩn __CONFIG__ của Google Sheet
    if (preparedState.activeFileId && accessToken) {
      await saveMasterSyncStateToGoogleSheet(accessToken, preparedState.activeFileId, preparedState).catch(() => {});

      // 3. Đồng bộ quyền truy cập Google Drive cho danh sách thành viên
      await synchronizeDrivePermissionsWithJsonMembers(
        accessToken,
        preparedState.activeFileId,
        preparedState.members || [],
        preparedState.adminEmail
      ).catch(() => {});
    }

    return 'sheet_config_tab';
  } catch (err) {
    console.warn('Error saving master sync pointer to Sheet Config:', err);
    return null;
  }
}

/**
 * Thiết lập file Google Sheet liên kết hoạt động
 */
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

  // Auto-tag file with appProperties on Google Drive
  if (accessToken && fileId) {
    tagVaultWithAppProperties(accessToken, fileId).catch(() => {});
  }

  // 1. Xác định và bảo toàn linkedTimestamp
  let resolvedLinkedTimestamp = existingLinkedTimestamp;

  if (!resolvedLinkedTimestamp && !isSwitching) {
    try {
      const currentMaster = await getMasterSyncStateFromDrive(accessToken, fileId);
      if (currentMaster && currentMaster.activeFileId === fileId && currentMaster.linkedTimestamp) {
        resolvedLinkedTimestamp = currentMaster.linkedTimestamp;
      }
    } catch {}
  }

  // 2. Lấy metadata của file
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

  // Thu hồi quyền của thành viên trên file cũ nếu chuyển sang file mới
  if (isSwitching && previousFileId) {
    try {
      const currentMaster = await getMasterSyncStateFromDrive(accessToken, previousFileId);
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

  // 3. Cập nhật Master State vào tab ẩn __CONFIG__ của Sheet và bộ nhớ máy
  try {
    const actionType: 'link' | 'switch' | 'create_and_link' = isSwitching ? 'switch' : 'link';
    const currentMaster = await getMasterSyncStateFromDrive(accessToken, fileId);
    const finalMembers = currentMaster?.members || [];
    const finalAdminEmail = currentMaster?.adminEmail || email.toLowerCase();

    await saveMasterSyncStateOnDrive(accessToken, {
      status: 'active',
      lastAction: actionType,
      activeFileId: fileId,
      activeFileName: resolvedName || 'Bảng tính tiết kiệm',
      activeFileUrl: resolvedUrl || `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      mimeType: resolvedMime || 'application/vnd.google-apps.spreadsheet',
      linkedTimestamp: resolvedLinkedTimestamp,
      linkedAccountEmail: email,
      adminEmail: finalAdminEmail,
      members: finalMembers,
      updatedAt: new Date().toISOString(),
    });
  } catch (saveErr) {
    console.warn('Failed to update master sync state on Sheet Config:', saveErr);
  }

  return resolvedLinkedTimestamp;
}

/**
 * Cập nhật updatedAt trên Tab __CONFIG__ của Sheet sau mỗi lần đồng bộ dữ liệu thành công
 */
export async function touchMasterSyncStateOnDrive(
  accessToken: string,
  fileId: string,
  userEmail?: string,
  knownLinkedTimestamp?: string,
  fileName?: string,
  fileUrl?: string
): Promise<void> {
  try {
    const currentMaster = await getMasterSyncStateFromDrive(accessToken, fileId);
    const nowIso = new Date().toISOString();

    if (currentMaster && (currentMaster.status === 'unlinked' || currentMaster.lastAction === 'unlink')) {
      return;
    }

    if (currentMaster && (currentMaster.activeFileId === fileId || !currentMaster.activeFileId)) {
      await saveMasterSyncStateOnDrive(accessToken, {
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
    console.warn('Failed to touch master sync state on Sheet Config:', err);
  }
}

/**
 * Cập nhật trạng thái 'unlinked' khi người dùng hủy liên kết và thu hồi quyền Google Drive của các thành viên
 */
export async function setMasterSyncUnlinked(
  accessToken: string,
  userEmail?: string,
  explicitFileId?: string
): Promise<void> {
  try {
    setExplicitlyUnlinked(true);

    const targetFileId = explicitFileId || getLocalMasterPointerFileId();
    if (targetFileId) {
      addUnlinkedFileId(targetFileId);
    }
    const activeId = targetFileId;
    const nowIso = new Date().toISOString();

    const adminEmailVal = userEmail || 'admin';

    // 1. Revoke non-admin member Google Drive permissions in parallel
    if (activeId && accessToken) {
      try {
        const currentMaster = getLocalMasterPointerState();
        if (currentMaster?.members && currentMaster.members.length > 0) {
          const revokePromises = currentMaster.members
            .filter((m) => m.role !== 'ADMIN' && m.email)
            .map((m) => revokeFilePermission(accessToken, activeId, m.email).catch(() => {}));
          await Promise.allSettled(revokePromises);
        }
      } catch (revokeErr) {
        console.warn('Failed to revoke member permissions on unlink:', revokeErr);
      }
    }

    // 2. Record "unlinked" state on Google Sheet __CONFIG__ tab
    if (activeId && accessToken) {
      const unlinkedSheetState: MasterSyncState = {
        status: 'unlinked',
        lastAction: 'unlink',
        activeFileId: activeId,
        activeFileName: '',
        activeFileUrl: '',
        linkedTimestamp: nowIso,
        linkedAccountEmail: userEmail || 'Google User',
        adminEmail: adminEmailVal,
        updatedAt: nowIso,
      };

      await saveMasterSyncStateToGoogleSheet(accessToken, activeId, unlinkedSheetState).catch((sheetErr) => {
        console.warn('[Unlink Sync] Lỗi ghi trạng thái unlinked lên Google Sheet:', sheetErr);
      });
    }

    // 3. Clear local pointer state
    saveLocalMasterPointerFileId(null);
    saveLocalMasterPointerState(null);
  } catch (saveErr) {
    console.warn('Failed to update master sync state to unlinked:', saveErr);
    saveLocalMasterPointerFileId(null);
    saveLocalMasterPointerState(null);
  }
}

export interface DiscoveredVault {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

/**
 * Quét tất cả tệp Sổ Tiết Kiệm mà tài khoản có quyền truy cập dựa trên nhãn appProperties
 */
export async function scanUserAccessibleVaults(
  accessToken: string
): Promise<DiscoveredVault[]> {
  try {
    if (!accessToken) return [];

    const query = `(appProperties has { key='${DRIVE_APP_TAG.key}' and value='${DRIVE_APP_TAG.value}' } or appProperties has { key='app_id' and value='com.tietkiemgiadinh.app' } or appProperties has { key='app_identifier' and value='com.tietkiemgiadinh.app' }) and trashed = false`;

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', '20');
    url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, webViewLink, appProperties)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');

    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.warn(`[Vault Scan] Lỗi gọi Drive API: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
      appProperties: f.appProperties,
    }));
  } catch (err) {
    console.warn('[Vault Scan] Lỗi khi quét kho tự động:', err);
    return [];
  }
}

/**
 * Tự động tìm kiếm file trung tâm đang hoạt động
 */
export async function autoDiscoverLatestCentralHub(
  accessToken: string,
  _userEmail?: string
): Promise<{ id: string; name: string; webViewLink?: string; mimeType?: string; linkedTimestamp?: string } | null> {
  try {
    if (isExplicitlyUnlinked()) {
      console.info('[Central Hub Sync] Thiết bị đã hủy liên kết chủ động. Bỏ qua tự động quét tìm.');
      return null;
    }
    const targetFileId = getLocalMasterPointerFileId();
    if (targetFileId && !isFileUnlinked(targetFileId)) {
      // 1. Kiểm tra metadata file trực tiếp trên Google Drive từ pointer cục bộ
      const meta = await getRealGoogleDriveFileMetadata(accessToken, targetFileId);
      if (meta && !meta.isDeleted) {
        const masterState = await getMasterSyncStateFromDrive(accessToken, targetFileId).catch(() => null);
        if (masterState && masterState.status === 'active' && masterState.lastAction !== 'unlink') {
          setExplicitlyUnlinked(false);
          return {
            id: targetFileId,
            name: meta.name || masterState.activeFileName || 'Sổ tiết kiệm',
            mimeType: meta.mimeType || masterState.mimeType || 'application/vnd.google-apps.spreadsheet',
            webViewLink: meta.webViewLink || masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${targetFileId}/edit`,
            linkedTimestamp: masterState.linkedTimestamp || new Date().toISOString(),
          };
        }
      }
    }

    // 2. TỰ ĐỘNG KHÁM PHÁ THEO NHÃN appProperties (Siêu tốc cho User B)
    const taggedVaults = await scanUserAccessibleVaults(accessToken);
    if (taggedVaults.length > 0) {
      for (const vault of taggedVaults) {
        if (!vault.id || isFileUnlinked(vault.id)) continue;
        const masterState = await getMasterSyncStateFromDrive(accessToken, vault.id).catch(() => null);
        if (masterState && masterState.status === 'active' && masterState.lastAction !== 'unlink') {
          saveLocalMasterPointerFileId(vault.id);
          saveLocalMasterPointerState(masterState);
          setExplicitlyUnlinked(false);
          return {
            id: vault.id,
            name: vault.name || masterState.activeFileName || 'Sổ tiết kiệm',
            mimeType: vault.mimeType || 'application/vnd.google-apps.spreadsheet',
            webViewLink: vault.webViewLink || masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${vault.id}/edit`,
            linkedTimestamp: masterState.linkedTimestamp || vault.modifiedTime || new Date().toISOString(),
          };
        }
      }
    }

    // 3. Fallback: Duyệt danh sách file mở rộng nếu các tệp cũ chưa kịp gắn nhãn
    const driveFiles = await listRealGoogleDriveFiles(accessToken).catch(() => []);
    if (driveFiles && driveFiles.length > 0) {
      for (const file of driveFiles) {
        if (!file.id || !file.isSheetOrExcel || isFileUnlinked(file.id)) continue;
        const masterState = await getMasterSyncStateFromDrive(accessToken, file.id).catch(() => null);
        if (masterState && masterState.status === 'active' && masterState.lastAction !== 'unlink') {
          // Gắn nhãn bổ sung cho file cũ để lần sau truy vấn siêu tốc
          tagVaultWithAppProperties(accessToken, file.id).catch(() => {});
          saveLocalMasterPointerFileId(file.id);
          saveLocalMasterPointerState(masterState);
          setExplicitlyUnlinked(false);
          return {
            id: file.id,
            name: file.name || masterState.activeFileName || 'Sổ tiết kiệm',
            mimeType: file.mimeType || 'application/vnd.google-apps.spreadsheet',
            webViewLink: file.webViewLink || masterState.activeFileUrl || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
            linkedTimestamp: masterState.linkedTimestamp || file.modifiedTime || new Date().toISOString(),
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.warn('Error auto-discovering central hub from Drive:', err);
    return null;
  }
}

/**
 * Thu hồi quyền Google Drive của một email thành viên cụ thể
 */
export async function revokeFilePermission(
  accessToken: string,
  fileId: string,
  userEmail: string
): Promise<boolean> {
  try {
    if (!fileId || !userEmail) return false;
    const cleanEmail = userEmail.trim().toLowerCase();

    // 1. Lấy danh sách quyền hiện tại của file
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

    // 2. Tìm bản ghi quyền của email mục tiêu (chỉ kiểu 'user')
    const userPerm = permissions.find(
      (p) => p.type === 'user' && p.emailAddress?.trim().toLowerCase() === cleanEmail
    );

    if (!userPerm || !userPerm.id) {
      return false;
    }

    // 3. Xóa quyền trên Google Drive
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

/**
 * Xóa thành viên khỏi danh sách và thu hồi quyền Google Drive
 */
export async function removeMemberFromDriveMaster(
  accessToken: string,
  memberEmailToRemove: string
): Promise<void> {
  try {
    const currentMaster = await getMasterSyncStateFromDrive(accessToken);
    if (!currentMaster || !currentMaster.members) return;

    const cleanTarget = memberEmailToRemove.trim().toLowerCase();
    const updatedMembers = currentMaster.members.filter(
      (m) => m.email.trim().toLowerCase() !== cleanTarget
    );

    await saveMasterSyncStateOnDrive(accessToken, {
      ...currentMaster,
      members: updatedMembers,
      updatedAt: new Date().toISOString(),
    });

    // Thu hồi quyền truy cập Drive trên Google Sheet liên kết
    if (currentMaster.activeFileId) {
      await revokeFilePermission(accessToken, currentMaster.activeFileId, cleanTarget).catch(() => {});
    }
  } catch (err) {
    console.warn('Lỗi khi xóa thành viên khỏi Master State:', err);
  }
}

/**
 * Cập nhật vai trò (Role) của thành viên trên Google Drive và lưu vào Tab __CONFIG__
 */
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

    // 1. Thu hồi quyền cũ để tránh xung đột vai trò
    await revokeFilePermission(accessToken, fileId, cleanEmail);

    // 2. Cấp quyền mới tương ứng
    const shareSuccess = await shareFileWithUserEmail(accessToken, fileId, cleanEmail, driveRole);

    // 3. Cập nhật role vào danh sách members trong tab __CONFIG__
    try {
      const currentMaster = await getMasterSyncStateFromDrive(accessToken, fileId);
      if (currentMaster && currentMaster.members) {
        const updatedMembers = currentMaster.members.map((m) =>
          m.email.trim().toLowerCase() === cleanEmail ? { ...m, role: newRole } : m
        );
        await saveMasterSyncStateOnDrive(accessToken, {
          ...currentMaster,
          members: updatedMembers,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {}

    return shareSuccess;
  } catch (err) {
    console.warn(`Lỗi khi cập nhật role cho ${userEmail} trên Google Drive:`, err);
    return false;
  }
}

/**
 * Grant Google Drive file permissions to a specific email address (e.g., 'reader' or 'writer')
 */
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

/**
 * Synchronizes Google Drive permissions of a file with the list of members in the Master Sync State.
 * - If the JSON member list has NO users (is empty or only has Admin): ALL permissions on Drive
 *   (both Excel and JSON files) are revoked, retaining ONLY the Admin / Owner.
 * - Any user on Drive not present in the JSON member list is immediately revoked.
 * - Any member in the JSON list is granted or updated to the correct role (EDITOR -> writer, VIEWER -> reader).
 */
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

    // Tập hợp tất cả email Admin (từ adminEmail và các member có role ADMIN)
    const adminEmailsSet = new Set<string>();
    if (cleanAdminEmail && cleanAdminEmail !== 'admin' && cleanAdminEmail !== 'google user') {
      adminEmailsSet.add(cleanAdminEmail);
    }
    activeMembers.forEach((m) => {
      if (m?.role === 'ADMIN' && m?.email) {
        adminEmailsSet.add(m.email.trim().toLowerCase());
      }
    });

    // Danh sách thành viên được chia sẻ (non-admin: EDITOR hoặc VIEWER)
    const nonAdminMembers = activeMembers.filter(
      (m) => m && m.email && m.role !== 'ADMIN'
    );
    const memberMap = new Map<string, any>();
    nonAdminMembers.forEach((m) => {
      memberMap.set(m.email.trim().toLowerCase(), m);
    });

    // 1. Lấy danh sách quyền Google Drive hiện tại của file
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

    // Helper xóa permission an toàn và ghi log rõ ràng
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

    // 2. Duyệt qua từng permission trên Drive để đối chiếu
    for (const p of permissions) {
      // Tuyệt đối không xóa Owner của file
      if (p.role === 'owner') continue;

      const emailClean = p.emailAddress?.trim().toLowerCase();

      // Nếu là Admin đã xác định, giữ nguyên quyền
      if (emailClean && adminEmailsSet.has(emailClean)) {
        continue;
      }

      // TH1: File JSON không có danh sách user chia sẻ (danh sách members rỗng hoặc chỉ có Admin)
      // -> Đã thống nhất nếu JSON không có user thì các file liên quan (JSON + Excel) PHẢI REMOVE HẾT QUYỀN ĐI, CHỈ CÒN ADMIN!
      if (nonAdminMembers.length === 0) {
        await deletePermission(p.id, emailClean || p.displayName || p.type || p.id);
        continue;
      }

      // TH2: Có danh sách user chia sẻ trong JSON
      // Thu hồi link chia sẻ công khai hoặc chia sẻ theo domain
      if (p.type === 'anyone' || p.type === 'domain') {
        await deletePermission(p.id, `Public/Domain Link (${p.type})`);
        continue;
      }

      const memberInJson = emailClean ? memberMap.get(emailClean) : null;

      // Nếu user trên Drive KHÔNG có trong danh sách chia sẻ của JSON -> Thu hồi quyền!
      if (!memberInJson) {
        await deletePermission(p.id, emailClean || p.displayName || p.type || p.id);
      } else {
        // User có trong JSON, kiểm tra role (EDITOR -> writer, VIEWER -> reader)
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

    // 3. Nếu có thành viên trong JSON chưa được cấp quyền trên Drive, cấp quyền cho họ
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

