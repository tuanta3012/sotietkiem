import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { getRealGoogleDriveFileMetadata } from './googleDriveService';
import type { RealDriveFile } from './googleDriveService';

declare module '@codetrix-studio/capacitor-google-auth' {
  interface GoogleAuthPlugin {
    pickDriveFile(): Promise<{ accessToken?: string | null; fileIds?: string[] }>;
  }
}

const GOOGLE_PICKER_APP_ID = '864440372329';
const SHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PICKER_MIME_TYPES = `${SHEET_MIME_TYPE},${XLSX_MIME_TYPE}`;

interface PickerDocument {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
}

interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}

interface PickerView {
  setMimeTypes(mimeTypes: string): PickerView;
  setIncludeFolders(includeFolders: boolean): PickerView;
  setOwnedByMe(ownedByMe: boolean): PickerView;
  setMode(mode: string): PickerView;
}

interface Picker {
  setTitle(title: string): Picker;
  setDeveloperKey(key: string): Picker;
  setAppId(appId: string): Picker;
  setOAuthToken(token: string): Picker;
  setLocale(locale: string): Picker;
  setOrigin(origin: string): Picker;
  setSelectableMimeTypes(mimeTypes: string): Picker;
  setMaxItems(maximum: number): Picker;
  setSize(width: number, height: number): Picker;
  addView(view: PickerView): Picker;
  setCallback(callback: (response: PickerResponse) => void): Picker;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerNamespace {
  PickerBuilder: new () => Picker;
  DocsView: new (viewId: string) => PickerView;
  ViewId: { DOCS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
}

interface GoogleApiLoader {
  load(api: string, options: { callback: () => void; onerror: () => void }): void;
}

declare global {
  interface Window {
    gapi?: GoogleApiLoader;
    google?: { picker: GooglePickerNamespace };
  }
}

let pickerApiPromise: Promise<GooglePickerNamespace> | null = null;

const loadPickerApi = (): Promise<GooglePickerNamespace> => {
  if (window.google?.picker && window.gapi) return Promise.resolve(window.google.picker);
  if (pickerApiPromise) return pickerApiPromise;

  pickerApiPromise = new Promise((resolve, reject) => {
    const loadPicker = () => {
      if (!window.gapi) {
        pickerApiPromise = null;
        reject(new Error('Không thể tải Google Picker API.'));
        return;
      }

      window.gapi.load('picker', {
        callback: () => {
          const picker = window.google?.picker;
          if (picker) resolve(picker);
          else {
            pickerApiPromise = null;
            reject(new Error('Google Picker API không sẵn sàng.'));
          }
        },
        onerror: () => {
          pickerApiPromise = null;
          reject(new Error('Không thể tải Google Picker API.'));
        },
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]'
    );
    if (existingScript) {
      if (window.gapi) loadPicker();
      else {
        existingScript.addEventListener('load', loadPicker, { once: true });
        existingScript.addEventListener(
          'error',
          () => {
            pickerApiPromise = null;
            reject(new Error('Không thể tải Google Picker API.'));
          },
          { once: true }
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = loadPicker;
    script.onerror = () => {
      pickerApiPromise = null;
      reject(new Error('Không thể tải Google Picker API.'));
    };
    document.head.appendChild(script);
  });

  return pickerApiPromise;
};

const getPickerApiKey = (): string => {
  const env = (import.meta as ImportMeta & { env?: { VITE_GOOGLE_PICKER_API_KEY?: string } }).env;
  const apiKey = env?.VITE_GOOGLE_PICKER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Google Picker chưa được cấu hình cho môi trường này. Hãy cung cấp VITE_GOOGLE_PICKER_API_KEY khi build ứng dụng.'
    );
  }
  return apiKey;
};

const ensurePickerCentered = () => {
  const reposition = () => {
    const dialogs = document.querySelectorAll<HTMLElement>('.picker-dialog');
    dialogs.forEach((dialog) => {
      dialog.style.setProperty('top', '50%', 'important');
      dialog.style.setProperty('left', '50%', 'important');
      dialog.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
      dialog.style.setProperty('margin', '0', 'important');
      dialog.style.setProperty('max-width', 'calc(100vw - 16px)', 'important');
      dialog.style.setProperty('max-height', 'calc(100dvh - 32px)', 'important');
      dialog.style.setProperty('border-radius', '16px', 'important');
      dialog.style.setProperty('overflow', 'hidden', 'important');
      dialog.style.setProperty('box-shadow', '0 25px 50px -12px rgba(0, 0, 0, 0.45)', 'important');
      dialog.style.setProperty('z-index', '100001', 'important');
    });

    const bgs = document.querySelectorAll<HTMLElement>('.picker-dialog-bg');
    bgs.forEach((bg) => {
      bg.style.setProperty('z-index', '100000', 'important');
      bg.style.setProperty('background-color', 'rgba(15, 23, 42, 0.75)', 'important');
      bg.style.setProperty('backdrop-filter', 'blur(2px)', 'important');
    });
  };

  reposition();
  const observer = new MutationObserver(() => {
    reposition();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  setTimeout(() => observer.disconnect(), 120000);
};

const pickWebDriveFile = async (accessToken: string): Promise<RealDriveFile | null> => {
  const apiKey = getPickerApiKey();
  const pickerApi = await loadPickerApi();
  const pickerWidth = Math.min(1051, Math.max(566, window.innerWidth - 24));
  const pickerHeight = Math.min(650, Math.max(350, window.innerHeight - 48));

  return new Promise((resolve, reject) => {
    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
      .setMimeTypes(PICKER_MIME_TYPES)
      .setIncludeFolders(false)
      .setOwnedByMe(false)
      .setMode(pickerApi.DocsViewMode.LIST);

    const picker = new pickerApi.PickerBuilder()
      .setTitle('Dữ liệu sổ tiết kiệm')
      .setDeveloperKey(apiKey)
      .setAppId(GOOGLE_PICKER_APP_ID)
      .setOAuthToken(accessToken)
      .setLocale('vi')
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .setSelectableMimeTypes(PICKER_MIME_TYPES)
      .setMaxItems(1)
      .setSize(pickerWidth, pickerHeight)
      .addView(view)
      .setCallback((response) => {
        if (response.action === pickerApi.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (response.action !== pickerApi.Action.PICKED) return;

        const document = response.docs?.[0];
        if (!document?.id) {
          reject(new Error('Google Picker không trả về file đã chọn.'));
          return;
        }

        const mimeType = document.mimeType || '';
        if (mimeType !== SHEET_MIME_TYPE && mimeType !== XLSX_MIME_TYPE) {
          reject(new Error('Chỉ hỗ trợ Google Sheets và file Excel .xlsx.'));
          return;
        }
        resolve({
          id: document.id,
          name: document.name || 'File sổ tiết kiệm',
          mimeType,
          webViewLink: document.url,
          isSheetOrExcel: true,
        });
      })
      .build();
    picker.setVisible(true);
    ensurePickerCentered();
  });
};

export const pickGoogleDriveFile = async (
  accessToken?: string
): Promise<{ file: RealDriveFile; accessToken?: string } | null> => {
  const platform = Capacitor.getPlatform();
  if (platform !== 'web' && platform !== 'android') {
    throw new Error('Google Picker hiện được hỗ trợ trên Web và Android.');
  }

  if (platform === 'android') {
    const result = await GoogleAuth.pickDriveFile();
    const fileId = result.fileIds?.[0];
    if (!fileId) return null;

    const pickerAccessToken = result.accessToken || accessToken;
    if (!pickerAccessToken) {
      throw new Error('Google Picker không trả về quyền truy cập file đã chọn.');
    }

    const metadata = await getRealGoogleDriveFileMetadata(pickerAccessToken, fileId);
    if (!metadata) {
      throw new Error('Không thể đọc thông tin file vừa chọn từ Google Drive.');
    }
    if (metadata.mimeType !== SHEET_MIME_TYPE && metadata.mimeType !== XLSX_MIME_TYPE) {
      throw new Error('Chỉ hỗ trợ Google Sheets và file Excel .xlsx.');
    }

    return {
      file: {
        id: metadata.id,
        name: metadata.name || 'File sổ tiết kiệm',
        mimeType: metadata.mimeType,
        modifiedTime: metadata.modifiedTime,
        webViewLink: metadata.webViewLink,
        isSheetOrExcel: true,
      },
      accessToken: pickerAccessToken,
    };
  }

  if (!accessToken) {
    throw new Error('Cần đăng nhập Google trước khi mở Picker.');
  }
  const file = await pickWebDriveFile(accessToken);
  return file ? { file, accessToken } : null;
};
