import firebaseConfig from '../../firebase-applet-config.json';
import { Capacitor } from '@capacitor/core';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let isGapiLoading = false;
let isPickerLoaded = false;

/**
 * Tải script gapi.js nếu chưa có
 */
function loadGapiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.gapi) {
      resolve();
      return;
    }

    if (isGapiLoading) {
      const interval = setInterval(() => {
        if (window.gapi) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      return;
    }

    isGapiLoading = true;
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      isGapiLoading = false;
      resolve();
    };
    script.onerror = () => {
      isGapiLoading = false;
      reject(new Error('Không thể tải Google API script. Vui lòng kiểm tra kết nối mạng.'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Khởi tạo module Google Picker từ gapi
 */
async function loadPickerModule(): Promise<void> {
  if (isPickerLoaded && window.google?.picker) return;
  await loadGapiScript();
  return new Promise((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error('gapi.load không khả dụng'));
      return;
    }
    window.gapi.load('picker', {
      callback: () => {
        isPickerLoaded = true;
        resolve();
      },
      onerror: () => {
        reject(new Error('Không thể tải Google Picker module'));
      },
      timeout: 10000,
      ontimeout: () => {
        reject(new Error('Quá thời gian tải Google Picker module'));
      },
    });
  });
}

export interface PickedGoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

/**
 * Dọn sạch mọi iframe hoặc overlay của Google Picker bị treo trong DOM
 */
export function dismissGooglePicker(): void {
  try {
    const selectors = [
      '.picker-dialog',
      '.picker-dialog-bg',
      '[class*="picker-dialog"]',
      'iframe[src*="google.com/picker"]',
      'iframe[src*="picker"]',
      '.picker-popup',
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        try {
          el.remove();
        } catch {}
      });
    });
  } catch {}
}

/**
 * Mở cửa sổ Google Picker chính thức để người dùng chọn bảng tính hoặc file bất kỳ từ Google Drive.
 * Trên môi trường Native Android APK và điện thoại di động, Google cấm Cookie bên thứ ba trong WebView
 * nên iframe Picker không thể nhận session và không thể giao tiếp hai chiều với popup ngoài. Do đó
 * trên điện thoại, ứng dụng hỗ trợ chọn trực tiếp từ danh sách file hoặc tạo file mới.
 */
export async function openGooglePicker(accessToken: string): Promise<PickedGoogleDriveFile | null> {
  const isMobile =
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' && (window.innerWidth < 768 || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent)));

  if (isMobile) {
    dismissGooglePicker();
    throw new Error(
      'NATIVE_PICKER_UNSUPPORTED: Khung Google Picker iframe không tương thích với màn hình điện thoại di động / ứng dụng Android APK. Vui lòng chọn file trong danh sách bên dưới hoặc bấm Tạo file mới trên Drive để liên kết.'
    );
  }

  if (!accessToken) {
    throw new Error('Vui lòng đăng nhập Google trước khi chọn file.');
  }

  await loadPickerModule();

  if (!window.google?.picker) {
    throw new Error('Google Picker chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
  }

  return new Promise((resolve, reject) => {
    try {
      const google = window.google;
      const pickerOrigin =
        window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
          ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
          : window.location.origin;

      const projectNumber = (firebaseConfig as any).messagingSenderId || '864440372329';

      // Chỉ hiển thị danh sách file Google Sheets (và bảng tính Excel) dạng DANH SÁCH (LIST) thay vì Icon/Grid
      const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setIncludeFolders(false)
        .setMode(google.picker.DocsViewMode.LIST)
        .setMimeTypes('application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // Tính toán kích thước vừa vặn theo màn hình thực tế (cả điện thoại và máy tính)
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 360;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
      const pickerWidth = Math.max(320, Math.min(viewportWidth - 16, 700));
      const pickerHeight = Math.max(380, Math.min(viewportHeight - 32, 560));

      const builder = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setAppId(projectNumber)
        .setOrigin(pickerOrigin)
        .setSize(pickerWidth, pickerHeight)
        .addView(sheetsView)
        .setTitle('Chọn File Bảng Tính (Google Sheets)')
        .setLocale('vi')
        .setCallback((data: any) => {
          const action = data[google.picker.Response.ACTION] || data.action;
          if (action === google.picker.Action.PICKED || action === 'picked') {
            const doc =
              (data[google.picker.Response.DOCUMENTS] && data[google.picker.Response.DOCUMENTS][0]) ||
              (data.docs && data.docs[0]);
            if (doc) {
              const fileId = doc[google.picker.Document.ID] || doc.id;
              const fileName = doc[google.picker.Document.NAME] || doc.name || 'So_tiet_kiem';
              const mimeType =
                doc[google.picker.Document.MIME_TYPE] || doc.mimeType || 'application/vnd.google-apps.spreadsheet';
              const fileUrl =
                doc[google.picker.Document.URL] ||
                doc.url ||
                `https://docs.google.com/spreadsheets/d/${fileId}/edit`;

              dismissGooglePicker();
              resolve({
                id: fileId,
                name: fileName,
                mimeType,
                url: fileUrl,
              });
            } else {
              dismissGooglePicker();
              resolve(null);
            }
          } else if (action === google.picker.Action.CANCEL || action === 'cancel') {
            dismissGooglePicker();
            resolve(null);
          } else if (action === 'error' || data.error) {
            console.warn('[GooglePicker] Callback received error:', data);
            dismissGooglePicker();
            reject(new Error(data.error?.message || 'Lỗi từ Google Picker API.'));
          }
        });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err: any) {
      console.error('[GooglePicker] Lỗi khởi tạo picker:', err);
      dismissGooglePicker();
      reject(new Error(`Không thể mở cửa sổ Google Drive: ${err?.message || err}`));
    }
  });
}
