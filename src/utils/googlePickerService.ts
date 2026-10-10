/**
 * Google Picker API Integration Service (Hybrid Model)
 *
 * Cung cấp cổng chọn/kết nối file CSDL Google Sheet thông qua Google Picker API chuẩn.
 * Hỗ trợ hiển thị cả file cá nhân (My Drive) và file được chia sẻ (Shared with me / Shared Drives),
 * giúp thành viên (như app.hay.ai) dễ dàng tìm và kết nối các file CSDL do Admin chia sẻ.
 */

import { STK_APP_ID } from './googleDriveService';

// Cấu hình biến môi trường
export const GOOGLE_API_KEY =
  (import.meta as any).env?.VITE_GOOGLE_API_KEY || 'AIzaSyC52c1CvjuL2Cna8x1U9_p6lc_xwEHFlqk';

export const GOOGLE_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '864440372329-fgoo89lqp196nvcptmfc7pquofuj8agt.apps.googleusercontent.com';

export const GOOGLE_APP_ID =
  (import.meta as any).env?.VITE_GOOGLE_APP_ID || '864440372329';

export interface PickedGoogleSheetFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  modifiedTime?: string;
}

export interface GooglePickerOptions {
  accessToken: string;
  apiKey?: string;
  appId?: string;
  onSelect: (file: PickedGoogleSheetFile) => void;
  onCancel?: () => void;
  onError?: (error: Error) => void;
}

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

let pickerLoadPromise: Promise<void> | null = null;

/**
 * Tải SDK Google Picker (`gapi.load('picker')`)
 * Tự động chờ thư viện hoặc chèn script nếu chưa sẵn sàng.
 */
export function loadGooglePickerSdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Môi trường trình duyệt không khả dụng.'));
  }

  // Nếu google.picker đã nạp sẵn
  if (window.google?.picker) {
    return Promise.resolve();
  }

  if (pickerLoadPromise) {
    return pickerLoadPromise;
  }

  pickerLoadPromise = new Promise<void>((resolve, reject) => {
    let timeoutId: any;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      pickerLoadPromise = null;
      reject(new Error('Hết thời gian tải Google Picker SDK (timeout 15s). Vui lòng kiểm tra kết nối mạng.'));
    }, 15000);

    const initPicker = () => {
      if (!window.gapi) {
        cleanup();
        pickerLoadPromise = null;
        reject(new Error('Không tìm thấy đối tượng window.gapi để nạp Google Picker.'));
        return;
      }

      try {
        window.gapi.load('picker', {
          callback: () => {
            cleanup();
            if (window.google?.picker) {
              resolve();
            } else {
              pickerLoadPromise = null;
              reject(new Error('Google Picker chưa được khởi tạo thành công sau khi nạp.'));
            }
          },
          onerror: (err: any) => {
            cleanup();
            pickerLoadPromise = null;
            reject(new Error(`Lỗi nạp thư viện Google Picker: ${err?.message || err}`));
          },
        });
      } catch (err: any) {
        cleanup();
        pickerLoadPromise = null;
        reject(err);
      }
    };

    // Kiểm tra window.gapi đã có chưa
    if (window.gapi) {
      initPicker();
    } else {
      // Đợi script apis.google.com/js/api.js nạp xong
      const existingScript = document.querySelector('script[src*="apis.google.com/js/api.js"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => initPicker());
        existingScript.addEventListener('error', () => {
          cleanup();
          pickerLoadPromise = null;
          reject(new Error('Không thể tải file script Google API (apis.google.com/js/api.js)'));
        });
      } else {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.async = true;
        script.defer = true;
        script.onload = () => initPicker();
        script.onerror = () => {
          cleanup();
          pickerLoadPromise = null;
          reject(new Error('Lỗi kết nối khi tải script apis.google.com/js/api.js'));
        };
        document.head.appendChild(script);
      }
    }
  });

  return pickerLoadPromise;
}

/**
 * Mở cửa sổ popup Google Picker cho phép người dùng chọn File CSDL Google Sheet.
 * Cấu hình đầy đủ:
 * - Developer Key (API Key)
 * - OAuth Token (Access Token của người dùng đang đăng nhập)
 * - View file cá nhân: DocsView(SPREADSHEETS)
 * - View file chia sẻ: DocsView(SPREADSHEETS).setEnableDrives(true).setOwnedByMe(false)
 * - View tổng hợp: DocsView().setEnableDrives(true) với mimeType Google Sheet & Excel
 */
export async function openGooglePicker(options: GooglePickerOptions): Promise<void> {
  const { accessToken, apiKey = GOOGLE_API_KEY, appId = GOOGLE_APP_ID, onSelect, onCancel, onError } = options;

  if (!accessToken) {
    const err = new Error('Không tìm thấy Google Access Token. Vui lòng đăng nhập Google trước khi chọn file.');
    onError?.(err);
    throw err;
  }

  try {
    // 1. Đảm bảo SDK Google Picker đã sẵn sàng
    await loadGooglePickerSdk();

    const google = window.google;
    if (!google?.picker) {
      throw new Error('Google Picker API chưa sẵn sàng trên trình duyệt.');
    }

    // 2. Cấu hình các View hiển thị file ở định dạng Danh sách (List mode) và chỉ định dạng Google Sheet hoặc Excel
    // - Giữ truy vấn nhãn ứng dụng hiện tại để giới hạn danh sách file
    // - Ẩn hoàn toàn folder (setIncludeFolders(false))
    const listMode = google.picker.DocsViewMode?.LIST || 'list';
    const spreadsheetMimeTypes =
      'application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

    // View 1: Bảng tính của tôi (My Drive) - lọc file ứng dụng
    const viewMySpreadsheets = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setMimeTypes(spreadsheetMimeTypes)
      .setMode(listMode)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setQuery(STK_APP_ID)
      .setLabel('Drive của tôi');

    // View 2: Bảng tính được chia sẻ với tôi (Shared with me) - lọc file ứng dụng
    const viewSharedWithMe = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setMimeTypes(spreadsheetMimeTypes)
      .setMode(listMode)
      .setEnableDrives(true)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setOwnedByMe(false)
      .setQuery(STK_APP_ID)
      .setLabel('Được chia sẻ với tôi');

    // View 3: Toàn bộ bảng tính (bao gồm Shared Drives) - lọc file ứng dụng
    const viewAllDrivesSpreadsheets = new google.picker.DocsView()
      .setMimeTypes(spreadsheetMimeTypes)
      .setMode(listMode)
      .setEnableDrives(true)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setQuery(STK_APP_ID)
      .setLabel('Tất cả Drive');

    // 3. Xác định Origin an toàn cho iFrame hoặc trình duyệt
    let pickerOrigin = window.location.origin;
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
        pickerOrigin = window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1];
      }
    } catch {
      pickerOrigin = window.location.origin;
    }

    // Cơ chế khóa vị trí cưỡng bức căn giữa màn hình (đặc biệt hữu ích trên màn hình điện thoại)
    let centerLockInterval: any = null;
    let centerMutationObserver: MutationObserver | null = null;

    const enforceCenterPosition = () => {
      try {
        const dialogs = document.querySelectorAll<HTMLElement>('.picker-dialog');
        dialogs.forEach((dialog) => {
          dialog.style.setProperty('position', 'fixed', 'important');
          dialog.style.setProperty('top', '50%', 'important');
          dialog.style.setProperty('left', '50%', 'important');
          dialog.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
          dialog.style.setProperty('margin', '0', 'important');
          dialog.style.setProperty('z-index', '100000', 'important');
        });

        const bgs = document.querySelectorAll<HTMLElement>('.picker-dialog-bg');
        bgs.forEach((bg) => {
          bg.style.setProperty('position', 'fixed', 'important');
          bg.style.setProperty('top', '0', 'important');
          bg.style.setProperty('left', '0', 'important');
          bg.style.setProperty('width', '100vw', 'important');
          bg.style.setProperty('height', '100vh', 'important');
          bg.style.setProperty('z-index', '99999', 'important');
        });
      } catch {
        // ignore
      }
    };

    const cleanupCenterLock = () => {
      if (centerLockInterval) {
        clearInterval(centerLockInterval);
        centerLockInterval = null;
      }
      if (centerMutationObserver) {
        centerMutationObserver.disconnect();
        centerMutationObserver = null;
      }
    };

    // 4. Xây dựng Google Picker Builder với tiêu đề "Dữ liệu sổ tiết kiệm"
    const builder = new google.picker.PickerBuilder()
      .setDeveloperKey(apiKey)
      .setOAuthToken(accessToken)
      .addView(viewMySpreadsheets)
      .addView(viewSharedWithMe)
      .addView(viewAllDrivesSpreadsheets)
      .setOrigin(pickerOrigin)
      .setTitle('Dữ liệu sổ tiết kiệm')
      .setCallback((data: any) => {
        // Người dùng chọn 1 file
        if (data.action === google.picker.Action.PICKED) {
          cleanupCenterLock();
          const docs = data[google.picker.Response.DOCUMENTS] || data.docs || [];
          const doc = docs[0];
          if (doc && doc.id) {
            console.log('[Google Picker] Đã chọn file thành công:', doc);
            onSelect({
              id: doc.id,
              name: doc.name || 'Google Sheet',
              mimeType: doc.mimeType || 'application/vnd.google-apps.spreadsheet',
              url: doc.url || `https://docs.google.com/spreadsheets/d/${doc.id}/edit`,
              modifiedTime: doc.lastEditedUtc ? new Date(doc.lastEditedUtc).toISOString() : undefined,
            });
          }
        } else if (data.action === google.picker.Action.CANCEL) {
          cleanupCenterLock();
          console.log('[Google Picker] Người dùng đã đóng/hủy chọn file.');
          onCancel?.();
        }
      });

    // Kích hoạt tính năng hỗ trợ Shared Drives
    if (google.picker.Feature?.SUPPORT_DRIVES) {
      builder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);
    }
    if (google.picker.Feature?.SUPPORT_TEAM_DRIVES) {
      builder.enableFeature(google.picker.Feature.SUPPORT_TEAM_DRIVES);
    }

    // Gán App ID nếu có
    if (appId) {
      builder.setAppId(appId);
    }

    // Điều chỉnh kích thước hiển thị thân thiện trên Mobile & Desktop
    if (typeof window !== 'undefined') {
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const isMobile = screenWidth < 768;

      const width = isMobile ? Math.max(300, screenWidth - 16) : Math.min(screenWidth - 40, 840);
      const height = isMobile ? Math.max(380, screenHeight - 32) : Math.min(screenHeight - 60, 650);
      builder.setSize(width, height);
    }

    const picker = builder.build();
    picker.setVisible(true);

    // Bắt đầu khóa vị trí căn giữa ngay khi hiển thị để ngăn hiện tượng bị giật/nhảy lên trên
    enforceCenterPosition();
    centerLockInterval = setInterval(enforceCenterPosition, 60);

    if (typeof document !== 'undefined' && document.body) {
      centerMutationObserver = new MutationObserver(() => enforceCenterPosition());
      centerMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    // Tự động dừng khóa sau 10 giây nếu modal đã ổn định
    setTimeout(() => {
      if (centerLockInterval) {
        clearInterval(centerLockInterval);
        centerLockInterval = setInterval(enforceCenterPosition, 300);
      }
    }, 10000);
  } catch (err: any) {
    console.error('[Google Picker] Lỗi khởi tạo Picker:', err);
    onError?.(err);
    throw err;
  }
}
