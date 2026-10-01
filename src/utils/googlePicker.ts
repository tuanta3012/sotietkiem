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
let currentPickerInstance: any = null;

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
 * Đóng cửa sổ Google Picker nếu đang mở
 */
export function dismissGooglePicker(): void {
  try {
    if (currentPickerInstance && typeof currentPickerInstance.setVisible === 'function') {
      currentPickerInstance.setVisible(false);
    }
    // Dọn dẹp DOM nếu picker iframe vẫn tồn tại
    const pickerEls = document.querySelectorAll('.picker-dialog, .picker-dialog-bg, [class*="picker"]');
    pickerEls.forEach((el) => {
      if (el.tagName.toLowerCase() === 'div' && el.parentElement === document.body) {
        el.remove();
      }
    });
  } catch (err) {
    console.warn('[GooglePicker] Lỗi khi dismiss Google Picker:', err);
  } finally {
    currentPickerInstance = null;
  }
}

/**
 * Mở cửa sổ Google Picker chính thức để người dùng chọn bảng tính hoặc file bất kỳ từ Google Drive
 */
export async function openGooglePicker(accessToken: string): Promise<PickedGoogleDriveFile | null> {
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
      let pickerOrigin = window.location.origin;
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
        pickerOrigin = window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1];
      }
      if (pickerOrigin === 'null' || !pickerOrigin || pickerOrigin.startsWith('file:')) {
        pickerOrigin = 'https://localhost';
      }

      const projectNumber = (firebaseConfig as any).messagingSenderId || '864440372329';

      // Tính toán kích thước vừa vặn cho mọi thiết bị (Điện thoại, Tablet, Desktop)
      const pickerWidth = Math.max(320, Math.min(window.innerWidth - 20, 850));
      const pickerHeight = Math.max(380, Math.min(window.innerHeight - 30, 650));

      // Chỉ hiển thị danh sách file Google Sheets (và bảng tính Excel) dạng DANH SÁCH (LIST) thay vì Icon/Grid
      const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setIncludeFolders(false)
        .setMode(google.picker.DocsViewMode.LIST)
        .setMimeTypes('application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

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

              currentPickerInstance = null;
              resolve({
                id: fileId,
                name: fileName,
                mimeType,
                url: fileUrl,
              });
            } else {
              currentPickerInstance = null;
              resolve(null);
            }
          } else if (action === google.picker.Action.CANCEL || action === 'cancel') {
            currentPickerInstance = null;
            resolve(null);
          } else if (action === 'error' || data.error) {
            console.warn('[GooglePicker] Callback received error:', data);
            currentPickerInstance = null;
            reject(new Error(data.error?.message || 'Lỗi từ Google Picker API.'));
          }
        });

      const picker = builder.build();
      currentPickerInstance = picker;
      picker.setVisible(true);
    } catch (err: any) {
      currentPickerInstance = null;
      console.error('[GooglePicker] Lỗi khởi tạo picker:', err);
      reject(new Error(`Không thể mở cửa sổ Google Drive: ${err?.message || err}`));
    }
  });
}
