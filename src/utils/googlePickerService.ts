import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Google Picker API Integration Service
 * Uses Google Picker SDK with scope https://www.googleapis.com/auth/drive.file
 */

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export interface PickerSelectedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

let scriptLoadPromise: Promise<void> | null = null;

/**
 * Load Google API script and Picker library dynamically
 */
export function loadGooglePickerSdk(): Promise<void> {
  if (window.google?.picker) {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.gapi) {
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Không thể nạp thư viện Google Picker.')),
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.gapi) {
        window.gapi.load('picker', {
          callback: () => resolve(),
          onerror: () => reject(new Error('Không thể khởi tạo Google Picker API.')),
        });
      } else {
        reject(new Error('Khởi tạo gapi thất bại.'));
      }
    };
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Lỗi kết nối mạng khi tải thư viện Google Picker API.'));
    };
    document.body.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Open Google Picker Dialog in clean LIST view mode
 */
export async function showGoogleDrivePicker({
  accessToken,
  viewMode = 'all',
  onFilePicked,
  onCancel,
  onError,
}: {
  accessToken: string;
  viewMode?: 'admin' | 'shared_with_me' | 'all';
  onFilePicked: (file: PickerSelectedFile) => void;
  onCancel?: () => void;
  onError?: (err: Error) => void;
}): Promise<void> {
  try {
    if (!accessToken) {
      throw new Error('Thiếu mã truy cập Google (Access Token). Vui lòng đăng nhập lại.');
    }

    await loadGooglePickerSdk();

    if (!window.google?.picker) {
      throw new Error('Google Picker API chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
    }

    const pickerOrigin =
      window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
        ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
        : window.location.origin;

    const builder = new window.google.picker.PickerBuilder();

    // Set Developer Key and App ID (Project Number) for drive.file authorization
    if (firebaseConfig.apiKey) {
      builder.setDeveloperKey(firebaseConfig.apiKey);
    }
    if (firebaseConfig.messagingSenderId) {
      builder.setAppId(firebaseConfig.messagingSenderId);
    }

    // Configure views: Spreadsheets and Shared With Me
    const spreadsheetsView = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS)
      .setMode(window.google.picker.DocsViewMode.LIST)
      .setMimeTypes('application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv');

    const sharedView = new window.google.picker.DocsView()
      .setOwnedByMe(false)
      .setMode(window.google.picker.DocsViewMode.LIST)
      .setMimeTypes('application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv');

    if (viewMode === 'shared_with_me') {
      builder.addView(sharedView);
      builder.addView(spreadsheetsView);
    } else {
      builder.addView(spreadsheetsView);
      builder.addView(sharedView);
    }

    builder.setOAuthToken(accessToken);
    builder.setOrigin(pickerOrigin);
    builder.setTitle('Chọn bảng tính Sổ tiết kiệm');

    builder.setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const doc = data.docs && data.docs[0];
        if (doc) {
          onFilePicked({
            id: doc.id,
            name: doc.name || 'So_tiet_kiem',
            mimeType: doc.mimeType || 'application/vnd.google-apps.spreadsheet',
            url: doc.url || `https://docs.google.com/spreadsheets/d/${doc.id}/edit`,
          });
        }
      } else if (data.action === window.google.picker.Action.CANCEL) {
        onCancel?.();
      }
    });

    const picker = builder.build();
    picker.setVisible(true);
  } catch (err: any) {
    console.error('Lỗi khởi chạy Google Picker:', err);
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
