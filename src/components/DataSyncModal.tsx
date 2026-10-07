import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import {
  CheckCircle,
  CheckCircle2,
  X,
  ExternalLink,
  FolderOpen,
  Search,
  RefreshCw,
  FileSpreadsheet,
  ShieldCheck,
  Trash2,
  Cloud,
  LogIn,
  LogOut,
  AlertCircle,
  AlertTriangle,
  Lock,
  Globe,
  UserCheck,
  Link2,
  Unlink,
  Download,
  Upload,
  HardDrive,
  Sparkles,
  Plus,
  FileText,
  Copy,
  RotateCcw,
  FolderPlus,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { SavingsBook, AppSettings, AuthUser, SettlementAdjustment, WorkspaceMember, canChangeDriveFile } from '../types';
import { exportSavingsBooksToExcel, exportStandardTemplateExcel, parseExcelFile } from '../utils/excelParser';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CANONICAL_COLUMNS } from '../utils/dataSchema';
import { getDynamicAnnualInterestHistory, getDynamicBalanceGrowthHistory, clearStaticHistoryFromStorage } from '../data/historicalGrowth';
import { formatVND, formatShortVND } from '../utils/formatters';

import {
  initGoogleAuth,
  signInWithGoogle,
  signInWithGoogleRedirect,
  signOutGoogle,
  getGoogleAccessToken,
  ensureGoogleAccessToken,
  validateAndEnsureToken,
  listRealGoogleDriveFiles,
  downloadRealGoogleDriveFile,
  updateRealGoogleDriveFile,
  createRealGoogleDriveFile,
  deleteRealGoogleDriveFile,
  getRealGoogleDriveFileMetadata,
  getMasterSyncStateFromDrive,
  setMasterSyncLinked,
  setMasterSyncUnlinked,
  autoDiscoverLatestCentralHub,
  isExplicitlyUnlinked,
  setExplicitlyUnlinked,
  RealDriveFile,
} from '../utils/googleDriveService';

interface DataSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: SavingsBook[];
  settlements?: SettlementAdjustment[];
  onImportBooks: (newBooks: SavingsBook[], mode: 'replace' | 'append') => void;
  onClearBooks: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  appUser?: AuthUser | null;
  onLoginOnline?: (user: AuthUser, accessToken?: string) => void;
  onTriggerManualSync?: () => Promise<void>;
  onDriveFileNotFound?: () => void;
  onMarkAsRemoteUpdate?: (
    newBooks?: SavingsBook[],
    newAdjs?: SettlementAdjustment[],
    newUrl?: string,
    newModifiedTime?: string
  ) => void;
  onStartFileSwitch?: () => void;
  onFinishFileSwitch?: (
    newBooks: SavingsBook[],
    newAdjs?: SettlementAdjustment[],
    newUrl?: string,
    newFileName?: string,
    stampTime?: string,
    fileModTime?: string
  ) => void;
  onCancelFileSwitch?: () => void;
}

export const DataSyncModal: React.FC<DataSyncModalProps> = ({
  isOpen,
  onClose,
  books,
  settlements = [],
  onImportBooks,
  onClearBooks,
  settings,
  onUpdateSettings,
  appUser,
  onLoginOnline,
  onTriggerManualSync,
  onDriveFileNotFound,
  onMarkAsRemoteUpdate,
  onStartFileSwitch,
  onFinishFileSwitch,
  onCancelFileSwitch,
}) => {
  // Google Auth state
  const { showToast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(getGoogleAccessToken());
  const hasGoogleToken = Boolean(accessToken || getGoogleAccessToken());
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  // Offline file overwrite confirmation state
  const [pendingOfflineFile, setPendingOfflineFile] = useState<File | null>(null);
  const [showOverwriteWarning, setShowOverwriteWarning] = useState<boolean>(false);

  // Drive state
  const [realFiles, setRealFiles] = useState<RealDriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>(
    settings.googleSheetName || (settings.googleSheetUrl?.includes('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms') ? 'Example Spreadsheet' : '')
  );
  const [isFetchingFileName, setIsFetchingFileName] = useState<boolean>(false);
  const [sheetUrl, setSheetUrl] = useState<string>(settings.googleSheetUrl || '');
  const [discoveredHub, setDiscoveredHub] = useState<{ id: string; name: string; webViewLink?: string; mimeType?: string; linkedTimestamp?: string } | null>(null);
  const [isDiscoveringHub, setIsDiscoveringHub] = useState<boolean>(false);
  
  // Sync messages & steps
  const [syncStatusStep, setSyncStatusStep] = useState<string | null>(null);
  const [googleSyncMessage, setGoogleSyncMessage] = useState<string | null>(null);
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(settings.lastSyncTime || null);

  // Sync messages toast effect (only when modal is open and user performs actions)
  useEffect(() => {
    if (isOpen && googleSyncMessage) {
      showToast(googleSyncMessage, 'success');
    }
  }, [isOpen, googleSyncMessage, showToast]);

  useEffect(() => {
    if (isOpen && syncErrorMessage) {
      showToast(syncErrorMessage, 'error');
    }
  }, [isOpen, syncErrorMessage, showToast]);
  const [showDrivePickerModal, setShowDrivePickerModal] = useState<boolean>(false);
  const [isCreatingNewFile, setIsCreatingNewFile] = useState<boolean>(false);
  const [showCreateFileDialog, setShowCreateFileDialog] = useState<boolean>(false);
  const [newFileNameInput, setNewFileNameInput] = useState<string>('So_tiet_kiem');
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  // Clear confirmation
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [isUnlinking, setIsUnlinking] = useState<boolean>(false);
  const [fileIsDeleted, setFileIsDeleted] = useState<boolean>(false);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [showSchemaGuide, setShowSchemaGuide] = useState<boolean>(false);

  const handleDownloadStandardTemplate = async () => {
    try {
      await exportStandardTemplateExcel('Mau_Bang_Du_Lieu_So_Tiet_Kiem_Chuan.xlsx');
      setGoogleSyncMessage('Đã tải thành công file Mẫu Bảng Dữ Liệu Chuẩn (.xlsx) kèm hướng dẫn định nghĩa 19 trường thông tin.');
    } catch (e: any) {
      setSyncErrorMessage('Lỗi khi xuất file mẫu chuẩn: ' + (e?.message || 'Không xác định'));
    }
  };

  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const onUpdateSettingsRef = React.useRef(onUpdateSettings);
  onUpdateSettingsRef.current = onUpdateSettings;

  const isLoadingFilesRef = React.useRef(false);

  // Sync settings when modified externally
  useEffect(() => {
    setSelectedFileName(settings.googleSheetName || '');
    setSheetUrl(settings.googleSheetUrl || '');
    setLastSyncTime(settings.lastSyncTime || null);
    if (!settings.googleSheetUrl) {
      setSelectedFileId('');
    }
  }, [settings.googleSheetName, settings.googleSheetUrl, settings.lastSyncTime]);

  // Extract file ID from URL if present
  useEffect(() => {
    if (sheetUrl) {
      const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || sheetUrl.match(/id=([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        setSelectedFileId(match[1]);
      } else if (sheetUrl.length > 20 && !sheetUrl.includes('/')) {
        setSelectedFileId(sheetUrl);
      }
    }
  }, [sheetUrl]);

  // Listen to Google Auth
  useEffect(() => {
    const unsubscribe = initGoogleAuth(
      (user, token) => {
        setCurrentUser(user);
        if (token) setAccessToken(token);
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
        setRealFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  // Kiểm tra liên kết file trung tâm từ Google Drive khi mở modal
  useEffect(() => {
    let isMounted = true;
    const token = accessToken || getGoogleAccessToken();
    if (isOpen && token) {
      (async () => {
        try {
          const master = await getMasterSyncStateFromDrive(token);
          if (!isMounted) return;
          const cur = settingsRef.current;
          if (!master || master.status === 'unlinked' || !master.activeFileId) {
            if (cur.googleSheetUrl || cur.googleSheetName) {
              console.info('[DataSyncModal] Không có file liên kết active -> Đặt app về trạng thái chưa liên kết');
              setSelectedFileName('');
              setSheetUrl('');
              setSelectedFileId('');
              setLastSyncTime(null);
              onUpdateSettingsRef.current({
                googleSheetUrl: undefined,
                googleSheetName: undefined,
                lastSyncTime: undefined,
              });
            }
          } else if (master.status === 'active' && master.activeFileId) {
            const masterUrl = master.activeFileUrl || `https://docs.google.com/spreadsheets/d/${master.activeFileId}/edit`;
            const masterName = master.activeFileName || 'Bảng tính tiết kiệm';
            if (cur.googleSheetUrl !== masterUrl || cur.googleSheetName !== masterName) {
              setSelectedFileName(masterName);
              setSheetUrl(masterUrl);
              setSelectedFileId(master.activeFileId);
              onUpdateSettingsRef.current({
                googleSheetUrl: masterUrl,
                googleSheetName: masterName,
                workspaceOwnerEmail: master.adminEmail,
                members: master.members || [],
              });
            }
          }
        } catch (err) {
          console.warn('[DataSyncModal] Lỗi kiểm tra master workspace state:', err);
        }
      })();
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, accessToken]);

  // Tự động kiểm tra và lấy tên file thật từ Google Drive khi modal mở hoặc có token
  useEffect(() => {
    let isMounted = true;
    const token = accessToken || getGoogleAccessToken();
    if (selectedFileId && token && isOpen) {
      setIsFetchingFileName(true);
      getRealGoogleDriveFileMetadata(token, selectedFileId)
        .then((meta) => {
          if (isMounted) {
            if (meta?.isDeleted) {
              setFileIsDeleted(true);
            } else if (meta?.name) {
              if (settingsRef.current.googleSheetName !== meta.name) {
                setSelectedFileName(meta.name);
                onUpdateSettingsRef.current({ googleSheetName: meta.name });
              }
              setFileIsDeleted(false);
            } else {
              setFileIsDeleted(false);
            }
          }
        })
        .catch((err) => {
          console.warn('Lỗi kiểm tra tên file trên Google Drive:', err);
        })
        .finally(() => {
          if (isMounted) setIsFetchingFileName(false);
        });
    } else {
      setFileIsDeleted(false);
    }
    return () => {
      isMounted = false;
    };
  }, [selectedFileId, accessToken, isOpen]);

  // Fetch real Google Drive files when token is available and modal is open
  useEffect(() => {
    if (accessToken && isOpen) {
      loadGoogleDriveFiles(accessToken);
    }
  }, [accessToken, isOpen, showDrivePickerModal]);

  const loadGoogleDriveFiles = async (token: string) => {
    if (isLoadingFilesRef.current) return;
    isLoadingFilesRef.current = true;
    setIsLoadingFiles(true);
    setSyncErrorMessage(null);
    try {
      const files = await listRealGoogleDriveFiles(token);
      setRealFiles(files);
      if (selectedFileId && !selectedFileName) {
        const found = files.find((f) => f.id === selectedFileId);
        if (found && settingsRef.current.googleSheetName !== found.name) {
          setSelectedFileName(found.name);
          onUpdateSettingsRef.current({ googleSheetName: found.name });
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('hết hạn') || err?.message?.includes('invalid authentication credentials')) {
        console.warn('Lỗi phiên Google Drive:', err.message);
        setAccessToken(null);
        setSyncErrorMessage('Phiên đăng nhập Google đã hết hạn. Vui lòng bấm "Đăng nhập Google" lại.');
      } else {
        console.error('Lỗi khi tải file Google Drive:', err);
        setSyncErrorMessage(err.message || 'Không thể tải danh sách file từ Google Drive của bạn.');
      }
    } finally {
      isLoadingFilesRef.current = false;
      setIsLoadingFiles(false);
    }
  };

  const validateTokenOrPrompt = async (): Promise<string | null> => {
    setIsAuthenticating(true);
    setSyncErrorMessage(null);
    try {
      const validToken = await validateAndEnsureToken();
      setAccessToken(validToken);
      // Synchronize online user profile if we have one
      if (currentUser) {
        const onlineUser: AuthUser = {
          email: currentUser.email || '',
          name: currentUser.displayName || 'Chủ Tài Khoản',
          role: 'admin',
          title: 'Quản trị viên (Admin)',
          isOffline: false,
        };
        onLoginOnline?.(onlineUser, validToken);
      }
      return validToken;
    } catch (err: any) {
      setSyncErrorMessage(err.message || 'Xác thực Google Drive không thành công hoặc bị hủy.');
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Làm mới tên file thủ công từ Google Drive
  const handleRefreshFileName = async () => {
    if (!selectedFileId) return;
    const token = await validateTokenOrPrompt();
    if (!token) return;

    setIsFetchingFileName(true);
    setSyncErrorMessage(null);
    try {
      const meta = await getRealGoogleDriveFileMetadata(token, selectedFileId);
      if (meta?.isDeleted) {
        setFileIsDeleted(true);
        setSyncErrorMessage(`⚠️ File "${selectedFileName || 'liên kết'}" đã bị xóa hoặc không còn tồn tại trên Google Drive!`);
      } else if (meta?.name) {
        setSelectedFileName(meta.name);
        onUpdateSettings({ googleSheetName: meta.name });
        setFileIsDeleted(false);
        setGoogleSyncMessage(`✅ Tên file mới nhất từ Google Drive: "${meta.name}"`);
      } else {
        setSyncErrorMessage('Không tìm thấy thông tin tên file từ Google Drive.');
      }
    } catch (err: any) {
      setSyncErrorMessage(`Lỗi lấy tên file: ${err.message || 'Không thể kết nối Google Drive.'}`);
    } finally {
      setIsFetchingFileName(false);
    }
  };

  const handleManualSyncClick = async () => {
    if (isManualSyncing) return;
    setIsManualSyncing(true);
    setSyncErrorMessage(null);
    setGoogleSyncMessage(null);
    setSyncStatusStep('Đang khởi động đồng bộ thủ công 2 chiều...');
    try {
      const token = await validateTokenOrPrompt();
      if (!token) {
        setIsManualSyncing(false);
        setSyncStatusStep(null);
        return;
      }

      // Check file name & existence
      if (selectedFileId) {
        setIsFetchingFileName(true);
        try {
          const meta = await getRealGoogleDriveFileMetadata(token, selectedFileId);
          if (meta?.isDeleted) {
            setFileIsDeleted(true);
            setSheetUrl('');
            setSelectedFileName('');
            setSelectedFileId(null);
            onUpdateSettings({ googleSheetUrl: undefined, googleSheetName: undefined });
            setExplicitlyUnlinked(true);
            setSyncErrorMessage(`❌ Đồng bộ thất bại: File liên kết đã bị xóa trên Google Drive. Đã tự động hủy liên kết!`);
            onDriveFileNotFound();
            return;
          } else if (meta?.name) {
            setSelectedFileName(meta.name);
            onUpdateSettings({ googleSheetName: meta.name });
            setFileIsDeleted(false);
          }
        } catch (err) {
          console.warn('Không lấy được metadata file khi đồng bộ thủ công:', err);
        } finally {
          setIsFetchingFileName(false);
        }
      }

      // Trigger the actual manual 2-way sync
      if (onTriggerManualSync) {
        setSyncStatusStep('Đang tải dữ liệu và cập nhật 2 chiều với Google Drive...');
        await onTriggerManualSync();
        const nowStr = new Date().toLocaleString('vi-VN');
        setLastSyncTime(nowStr);
        setGoogleSyncMessage(`✅ Đã hoàn tất đồng bộ thủ công 2 chiều thành công (${nowStr})!`);
      }
    } catch (err: any) {
      setSyncErrorMessage(`Lỗi đồng bộ thủ công: ${err.message || 'Không thể kết nối.'}`);
    } finally {
      setIsManualSyncing(false);
      setSyncStatusStep(null);
    }
  };

  const handleSignInGoogle = async () => {
    setIsAuthenticating(true);
    setSyncErrorMessage(null);
    try {
      const res = await signInWithGoogle();
      setCurrentUser(res.user);
      setAccessToken(res.accessToken);
      setGoogleSyncMessage(`Đã đăng nhập Google: ${res.user.email}`);

      // Update AuthUser in App.tsx to Online
      const onlineUser: AuthUser = {
        email: res.user.email || '',
        name: res.user.displayName || 'Chủ Tài Khoản',
        role: 'admin',
        title: 'Quản trị viên (Admin)',
        isOffline: false,
      };
      onLoginOnline?.(onlineUser, res.accessToken);

      await loadGoogleDriveFiles(res.accessToken);
    } catch (err: any) {
      setSyncErrorMessage(err.message || 'Đăng nhập Google thất bại. Vui lòng thử lại.');
    } finally {
      setIsAuthenticating(false);
    }
  };



  // Open Drive picker and trigger sign-in if needed
  const handleOpenDrivePicker = async () => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Bạn đang tham gia không gian với vai trò Thành viên. Chỉ Admin mới có quyền đổi file liên kết Google Drive.');
      return;
    }
    setShowDrivePickerModal(true);
    setSyncErrorMessage(null);
    const token = await validateTokenOrPrompt();
    if (token) {
      loadGoogleDriveFiles(token);
    }
  };

  // Mở cửa sổ Google Picker hoặc mở hộp thoại nhập Link trên thiết bị di động


  // Select a file from real Google Drive
  const handleSelectRealFile = async (file: RealDriveFile) => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Bạn đang tham gia không gian với vai trò Thành viên. Chỉ Admin mới có quyền chọn file liên kết.');
      return;
    }
    // Nếu app đang có dữ liệu và chưa có sheetUrl, xác nhận trước khi nạp thay thế
    if (books.length > 0 && !sheetUrl) {
      const confirmReplace = window.confirm(
        `Ứng dụng hiện đang có ${books.length} sổ tiết kiệm trên máy.\n\nKhi chọn liên kết file "${file.name}", hệ thống sẽ nạp dữ liệu từ file này về thay thế dữ liệu máy.\n\nBạn có muốn tiếp tục liên kết file này không?`
      );
      if (!confirmReplace) return;
    }

    const previousFileId =
      selectedFileId ||
      (settings.googleSheetUrl
        ? (settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/) || [])[1]
        : null);

    // Kích hoạt khóa chuyển đổi file triệt để để chặn vòng lặp
    onStartFileSwitch?.();

    setSelectedFileId(file.id);
    setSelectedFileName(file.name);
    setFileIsDeleted(false);
    setExplicitlyUnlinked(false);
    const link = file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    setSheetUrl(link);
    setShowDrivePickerModal(false);

    const token = await validateTokenOrPrompt();
    if (!token) {
      onCancelFileSwitch?.();
      return;
    }

    // Update Master Sync Pointer on Google Drive
    let stampTime = '';
    try {

      stampTime = await setMasterSyncLinked(
        token,
        file.id,
        currentUser?.email || appUser?.email,
        previousFileId && previousFileId !== file.id ? previousFileId : undefined,
        file.name,
        link,
        previousFileId === file.id ? settings.lastLocalLinkTimestamp : undefined
      );
    } catch (metaErr) {
      console.warn('Failed to update master sync state on select:', metaErr);
    }

    // Auto 2-way sync: Pull real data from the selected file into the app
    setSyncStatusStep(`Đang tự động đồng bộ dữ liệu 2 chiều từ file "${file.name}" trên Google Drive...`);
    setGoogleSyncMessage(null);
    setSyncErrorMessage(null);

    try {
      const parseResult = await downloadRealGoogleDriveFile(token, file.id, file.mimeType);
      const nowStr = new Date().toLocaleString('vi-VN');

      if (parseResult.success && parseResult.books.length > 0) {
        let fileModTime: string | undefined;
        try {
          const meta = await getRealGoogleDriveFileMetadata(token, file.id);
          fileModTime = meta?.modifiedTime;
        } catch {}

        if (onFinishFileSwitch) {
          onFinishFileSwitch(
            parseResult.books,
            parseResult.settlements,
            link,
            file.name,
            stampTime || new Date().toISOString(),
            fileModTime
          );
        } else {
          onMarkAsRemoteUpdate?.(parseResult.books, parseResult.settlements, link, fileModTime);
          onImportBooks(parseResult.books, 'replace');
          onUpdateSettings({
            googleSheetUrl: link,
            googleSheetName: file.name,
            lastSyncTime: nowStr,
            autoSync: true,
            lastLocalLinkTimestamp: stampTime || new Date().toISOString(),
          });
        }
        setLastSyncTime(nowStr);
        setGoogleSyncMessage(
          `⚡ Đã liên kết và đồng bộ thành công ${parseResult.books.length} sổ tiết kiệm từ file "${file.name}" trên Google Drive (${nowStr})`
        );
      } else {
        onCancelFileSwitch?.();
        setSyncErrorMessage(
          `File "${file.name}" không chứa dữ liệu sổ tiết kiệm hợp lệ hoặc rỗng. File trên Drive vẫn được giữ nguyên vẹn 100%.`
        );
      }
    } catch (err: any) {
      onCancelFileSwitch?.();
      setSyncErrorMessage(`Lỗi đọc file Google Drive: ${err.message || 'Không thể đọc nội dung file.'}`);
    } finally {
      setSyncStatusStep(null);
    }
  };

  // Connect via URL input or Share link
  const handleConnectByUrl = async (urlToConnect: string) => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Chỉ Admin mới có quyền dán đường dẫn liên kết file.');
      return;
    }
    if (!urlToConnect.trim()) {
      setSyncErrorMessage('Vui lòng nhập đường dẫn liên kết Google Drive hoặc Google Sheet.');
      return;
    }

    // Nếu app đang có dữ liệu và chưa có sheetUrl, xác nhận trước khi nạp thay thế
    if (books.length > 0 && !sheetUrl) {
      const confirmReplace = window.confirm(
        `Ứng dụng hiện đang có ${books.length} sổ tiết kiệm trên máy.\n\nKhi chọn liên kết URL này, hệ thống sẽ nạp dữ liệu từ file trên Drive về thay thế dữ liệu máy.\n\nBạn có muốn tiếp tục không?`
      );
      if (!confirmReplace) return;
    }

    const previousFileId =
      selectedFileId ||
      (settings.googleSheetUrl
        ? (settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/) || [])[1]
        : null);

    const cleanUrl = urlToConnect.trim();
    setSheetUrl(cleanUrl);
    setShowDrivePickerModal(false);
    setExplicitlyUnlinked(false);

    // Support docs.google.com/spreadsheets/d/<ID>, drive.google.com/file/d/<ID>, or raw ID
    const match = cleanUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || cleanUrl.match(/id=([a-zA-Z0-9-_]+)/);
    const fileId = match ? match[1] : (cleanUrl.length > 20 && !cleanUrl.includes('/') ? cleanUrl : null);

    const token = await validateTokenOrPrompt();
    if (!token) return;

    if (fileId && token) {
      onStartFileSwitch?.();
      setSelectedFileId(fileId);
      setSyncStatusStep('Đang đồng bộ dữ liệu từ Google Drive...');
      try {
        // Cố gắng lấy tên file thật từ Google Drive
        let realName = selectedFileName;
        let fileModTime: string | undefined;
        try {
          const meta = await getRealGoogleDriveFileMetadata(token, fileId);
          if (meta?.name) {
            realName = meta.name;
            setSelectedFileName(meta.name);
          }
          fileModTime = meta?.modifiedTime;
        } catch {
          // ignore
        }

        // Update Master Sync Pointer on Google Drive (Single Source of Truth)
        let stampTime = '';
        try {
          stampTime = await setMasterSyncLinked(
            token,
            fileId,
            currentUser?.email || appUser?.email,
            previousFileId && previousFileId !== fileId ? previousFileId : undefined,
            realName,
            cleanUrl,
            previousFileId === fileId ? settings.lastLocalLinkTimestamp : undefined
          );
        } catch (metaErr) {
          console.warn('Failed to update master sync state on connect URL:', metaErr);
        }

        const parseResult = await downloadRealGoogleDriveFile(token, fileId);
        const nowStr = new Date().toLocaleString('vi-VN');
        if (parseResult.success && parseResult.books.length > 0) {
          if (onFinishFileSwitch) {
            onFinishFileSwitch(
              parseResult.books,
              parseResult.settlements,
              cleanUrl,
              realName || undefined,
              stampTime || new Date().toISOString(),
              fileModTime
            );
          } else {
            onMarkAsRemoteUpdate?.(parseResult.books, parseResult.settlements, cleanUrl, fileModTime);
            onImportBooks(parseResult.books, 'replace');
            onUpdateSettings({
              googleSheetUrl: cleanUrl,
              googleSheetName: realName || undefined,
              lastSyncTime: nowStr,
              autoSync: true,
              lastLocalLinkTimestamp: stampTime || new Date().toISOString(),
            });
          }
          setLastSyncTime(nowStr);
          setGoogleSyncMessage(`⚡ Đã liên kết và đồng bộ ${parseResult.books.length} sổ từ file "${realName || 'Google Drive'}" (${nowStr})`);
        } else {
          onCancelFileSwitch?.();
          setSyncErrorMessage(parseResult.errors[0] || 'Không tìm thấy dữ liệu sổ tiết kiệm hợp lệ trong file này.');
        }
      } catch (err: any) {
        onCancelFileSwitch?.();
        setSyncErrorMessage(`Lỗi kết nối link: ${err.message}`);
      } finally {
        setSyncStatusStep(null);
      }
    } else {
      setSyncErrorMessage('Không tìm thấy ID file hợp lệ trong đường dẫn bạn vừa nhập. Vui lòng kiểm tra lại link Google Sheets.');
    }
  };

  // Auto-discover latest central hub file (A1) on login or mount if no sheetUrl is linked yet
  useEffect(() => {
    let isMounted = true;
    const token = accessToken || getGoogleAccessToken();
    if (token && !sheetUrl && isOpen) {
      setIsDiscoveringHub(true);
      autoDiscoverLatestCentralHub(token, currentUser?.email || appUser?.email)
        .then(async (latestHub) => {
          if (!isMounted) return;
          setIsDiscoveringHub(false);
          if (latestHub) {
            // Tự động kết nối và đồng bộ ngay lập tức không cần hỏi lại
            setExplicitlyUnlinked(false);

            setSelectedFileId(latestHub.id);
            setSelectedFileName(latestHub.name);
            const link = latestHub.webViewLink || `https://docs.google.com/spreadsheets/d/${latestHub.id}/edit`;
            setSheetUrl(link);
            setSyncStatusStep(`Đang tự động đồng bộ dữ liệu từ file trung tâm "${latestHub.name}"...`);
            
            try {
              const parseResult = await downloadRealGoogleDriveFile(token, latestHub.id, latestHub.mimeType);
              const nowStr = new Date().toLocaleString('vi-VN');
              if (parseResult.success) {
                if (parseResult.books && parseResult.books.length > 0) {
                  if (onFinishFileSwitch) {
                    onFinishFileSwitch(
                      parseResult.books,
                      parseResult.settlements,
                      link,
                      latestHub.name,
                      latestHub.linkedTimestamp
                    );
                  } else {
                    onImportBooks(parseResult.books, 'replace');
                    onUpdateSettings({
                      googleSheetUrl: link,
                      googleSheetName: latestHub.name,
                      lastSyncTime: nowStr,
                      autoSync: true,
                      lastLocalLinkTimestamp: latestHub.linkedTimestamp,
                    });
                  }
                }
                setLastSyncTime(nowStr);
                setGoogleSyncMessage(`⚡ Đã tự động kết nối và đồng bộ file trung tâm "${latestHub.name}" (${nowStr})`);
              }
            } catch (err: any) {
              console.warn('Auto-sync discovered hub download failed:', err);
            } finally {
              if (isMounted) setSyncStatusStep(null);
            }
          }
          setDiscoveredHub(null);
        })
        .catch((err) => {
          if (isMounted) {
            setIsDiscoveringHub(false);
            setDiscoveredHub(null);
          }
          console.warn('Auto-discover central hub failed:', err);
        });
    } else {
      setDiscoveredHub(null);
    }
    return () => {
      isMounted = false;
    };
  }, [accessToken, sheetUrl, isOpen]);

  // Create a brand new Excel file on the user's real Google Drive
  const handleCreateNewDriveFile = async () => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Chỉ Admin mới có quyền tạo file liên kết mới.');
      return;
    }
    if (!newFileNameInput.trim()) return;

    const token = await validateTokenOrPrompt();
    if (!token) return;

    setIsCreatingNewFile(true);
    setSyncErrorMessage(null);
    try {
      const previousFileId =
        selectedFileId ||
        (settings.googleSheetUrl
          ? (settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/) || [])[1]
          : null);

      const userEmail = (currentUser?.email || appUser?.email || '').trim().toLowerCase();
      const userName = currentUser?.displayName || appUser?.name || 'Admin';
      const created = await createRealGoogleDriveFile(
        token,
        newFileNameInput.trim(),
        books,
        settlements,
        userEmail
      );

      onMarkAsRemoteUpdate?.(books, settlements, created.webViewLink);

      setSelectedFileId(created.id);
      setSelectedFileName(created.name);
      setSheetUrl(created.webViewLink);
      setShowCreateFileDialog(false);
      setShowDrivePickerModal(false);

      const nowStr = new Date().toLocaleString('vi-VN');
      setLastSyncTime(nowStr);
      const initialMember: WorkspaceMember = {
        id: `owner-${Date.now()}`,
        email: userEmail,
        name: userName,
        role: 'ADMIN',
        addedAt: new Date().toISOString(),
      };

      onUpdateSettings({
        googleSheetUrl: created.webViewLink,
        googleSheetName: created.name,
        lastSyncTime: nowStr,
        autoSync: true,
        currentRole: 'ADMIN',
        workspaceOwnerEmail: userEmail,
        members: userEmail ? [initialMember] : [],
        lastLocalLinkTimestamp: created.linkedTimestamp || new Date().toISOString(),
      });

      setGoogleSyncMessage(
        `✅ Đã tạo file "${created.name}" trên Google Drive và kích hoạt đồng bộ 2 chiều tự động (${nowStr}).`
      );
      await loadGoogleDriveFiles(accessToken);
    } catch (err: any) {
      setSyncErrorMessage(`Lỗi tạo file trên Google Drive: ${err.message}`);
    } finally {
      setIsCreatingNewFile(false);
    }
  };

  // Delete a specific file from Google Drive
  const handleDeleteDriveFile = async (e: React.MouseEvent, file: RealDriveFile) => {
    e.stopPropagation();
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Chỉ Admin mới có quyền xóa file trên Google Drive.');
      return;
    }

    const confirmDelete = window.confirm(
      `Bạn có chắc chắn muốn xóa file "${file.name}" khỏi Google Drive không?\n\nHành động này sẽ xóa vĩnh viễn file trên Drive và không thể hoàn tác.`
    );
    if (!confirmDelete) return;

    const token = await validateTokenOrPrompt();
    if (!token) return;

    setDeletingFileId(file.id);
    setSyncErrorMessage(null);
    try {
      await deleteRealGoogleDriveFile(token, file.id);

      // If deleted file was currently linked, clear link
      if (selectedFileId === file.id) {
        setSelectedFileId('');
        setSelectedFileName('');
        setSheetUrl('');
        onUpdateSettings({
          googleSheetUrl: '',
          googleSheetName: '',
        });
      }

      setGoogleSyncMessage(`Đã xóa file "${file.name}" khỏi Google Drive.`);
      await loadGoogleDriveFiles(token);
    } catch (err: any) {
      setSyncErrorMessage(`Lỗi khi xóa file: ${err.message}`);
    } finally {
      setDeletingFileId(null);
    }
  };

  // Re-pull and repair data from Google Drive
  const handleRefreshFromDrive = async () => {
    if (!selectedFileId) return;
    const token = await validateTokenOrPrompt();
    if (!token) return;
    setSyncStatusStep('Đang tải và tự động sửa các ô dữ liệu từ Google Drive...');
    try {
      const res = await downloadRealGoogleDriveFile(token, selectedFileId);
      const nowStr = new Date().toLocaleString('vi-VN');
      if (res.success && res.books.length > 0) {
        onImportBooks(res.books, 'replace');
        setLastSyncTime(nowStr);
        onUpdateSettings({ lastSyncTime: nowStr });
        setGoogleSyncMessage(`⚡ Đã tải và tự động sửa cấu trúc thành công ${res.books.length} sổ tiết kiệm từ Google Drive (${nowStr}).`);
      } else {
        setSyncErrorMessage('Không tìm thấy sổ hợp lệ nào.');
      }
    } catch (err: any) {
      if (err?.message?.includes('FILE_NOT_FOUND')) {
        setSheetUrl('');
        setSelectedFileId('');
        setSelectedFileName('');
        onUpdateSettings({ googleSheetUrl: '', googleSheetName: '' });
        setExplicitlyUnlinked(true);
        onDriveFileNotFound?.();
        setSyncErrorMessage('File liên kết trên Google Drive đã bị xóa hoặc không còn tồn tại. Đã tự động hủy liên kết.');
      } else {
        setSyncErrorMessage(`Lỗi tải file: ${err.message}`);
      }
    } finally {
      setSyncStatusStep(null);
    }
  };

  // Safeguarded disconnect and clear
  const handleSafeguardedDisconnectAndClear = async () => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Chỉ Admin mới có quyền hủy liên kết file.');
      return;
    }
    onStartFileSwitch?.();
    setIsUnlinking(true);
    setSyncStatusStep('Đang hủy liên kết và làm sạch dữ liệu trên ứng dụng...');

    // Lấy File ID từ selectedFileId hoặc fallback qua settings.googleSheetUrl để đảm bảo tính chính xác tuyệt đối
    const currentUrl = settings.googleSheetUrl;
    let fileIdToUnlink = selectedFileId;
    if (!fileIdToUnlink && currentUrl) {
      const match = currentUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || currentUrl.match(/id=([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        fileIdToUnlink = match[1];
      }
    }

    const token = accessToken || getGoogleAccessToken();
    if (token) {
      try {
        await setMasterSyncUnlinked(token, currentUser?.email || appUser?.email, fileIdToUnlink);
      } catch (err) {
        console.warn('Lỗi khi ghi nhận unlink lên Google Drive:', err);
      }
    }

    await new Promise((res) => setTimeout(res, 400));
    const nowStr = new Date().toLocaleString('vi-VN');

    onClearBooks();
    try {
      localStorage.setItem('savings_books_v3', JSON.stringify([]));
      localStorage.setItem('savings_settlements_v3', JSON.stringify([]));
      localStorage.setItem('savings_books_cleared', 'true');
      clearStaticHistoryFromStorage();
      setExplicitlyUnlinked(true);
    } catch {
      // ignore
    }

    if (onFinishFileSwitch) {
      onFinishFileSwitch([], [], '', '', '', '');
    }
    onUpdateSettings({ googleSheetUrl: undefined, googleSheetName: undefined, lastSyncTime: undefined, lastLocalLinkTimestamp: undefined, autoSync: true });
    setSheetUrl('');
    setSelectedFileId('');
    setSelectedFileName('');
    setLastSyncTime(null);
    setIsUnlinking(false);
    setSyncStatusStep(null);
    setShowClearConfirm(false);
    setGoogleSyncMessage(`✅ Đã hủy liên kết thành công. Dữ liệu trên Google Drive của bạn được giữ nguyên vẹn 100% (${nowStr}).`);
  };

  // PHƯƠNG ÁN A: 1-Click tự động tạo file Google Sheet mới trên Drive và kích hoạt đồng bộ
  const handleQuickCreateDriveFile = async () => {
    if (!canChangeDriveFile(settings.currentRole)) {
      setSyncErrorMessage('🔒 Chỉ Admin mới có quyền tạo file liên kết mới.');
      return;
    }
    const token = await validateTokenOrPrompt();
    if (!token) return;

    setIsCreatingNewFile(true);
    setSyncErrorMessage(null);
    setSyncStatusStep('Đang tự động khởi tạo file bảng tính mới trên Google Drive của bạn...');

    try {
      const previousFileId =
        selectedFileId ||
        (settings.googleSheetUrl
          ? (settings.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl.match(/id=([a-zA-Z0-9-_]+)/) || [])[1]
          : null);

      const defaultName = 'So_tiet_kiem';
      const userEmail = (currentUser?.email || appUser?.email || '').trim().toLowerCase();
      const userName = currentUser?.displayName || appUser?.name || 'Admin';
      const created = await createRealGoogleDriveFile(token, defaultName, books, settlements, userEmail);

      onMarkAsRemoteUpdate?.(books, settlements, created.webViewLink);

      setSelectedFileId(created.id);
      setSelectedFileName(created.name);
      setSheetUrl(created.webViewLink);
      setFileIsDeleted(false);
      setExplicitlyUnlinked(false);

      const nowStr = new Date().toLocaleString('vi-VN');
      setLastSyncTime(nowStr);
      const initialMember: WorkspaceMember = {
        id: `owner-${Date.now()}`,
        email: userEmail,
        name: userName,
        role: 'ADMIN',
        addedAt: new Date().toISOString(),
      };

      onUpdateSettings({
        googleSheetUrl: created.webViewLink,
        googleSheetName: created.name,
        lastSyncTime: nowStr,
        autoSync: true,
        currentRole: 'ADMIN',
        workspaceOwnerEmail: userEmail,
        members: userEmail ? [initialMember] : [],
        lastLocalLinkTimestamp: created.linkedTimestamp || new Date().toISOString(),
      });

      setGoogleSyncMessage(
        `✅ Tuyệt vời! Đã tạo mới file "${created.name}" trên Google Drive và kích hoạt đồng bộ 2 chiều tự động (${nowStr}).`
      );
      await loadGoogleDriveFiles(token);
    } catch (err: any) {
      setSyncErrorMessage(`Lỗi tạo file trên Google Drive: ${err.message}`);
    } finally {
      setIsCreatingNewFile(false);
      setSyncStatusStep(null);
    }
  };

  // CHẾ ĐỘ OFFLINE: Xuất bản sao lưu Excel về máy tính/điện thoại
  const handleExportBackup = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const annualHistory = getDynamicAnnualInterestHistory(books, settlements);
      const balanceHistory = getDynamicBalanceGrowthHistory(books, settlements);
      await exportSavingsBooksToExcel(books, `So_Tiet_Kiem_Backup_${today}.xlsx`, annualHistory, balanceHistory, settlements);
      setGoogleSyncMessage(`✅ Đã tải bản sao lưu Excel (.xlsx) về máy thành công.`);
    } catch (err: any) {
      setSyncErrorMessage('Lỗi khi xuất file sao lưu: ' + err.message);
    }
  };

  // CHẾ ĐỘ OFFLINE: Khôi phục dữ liệu từ file sao lưu trên máy (có cảnh báo chống xung đột ghi đè)
  const handleSelectOfflineFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Nếu app đang có dữ liệu, hiển thị cảnh báo xác nhận nạp đè
    if (books.length > 0) {
      setPendingOfflineFile(file);
      setShowOverwriteWarning(true);
    } else {
      executeImportOfflineFile(file);
    }
    e.target.value = '';
  };

  const executeImportOfflineFile = async (file: File) => {
    setSyncStatusStep('Đang đọc file sao lưu từ thiết bị...');
    setSyncErrorMessage(null);
    setShowOverwriteWarning(false);
    setPendingOfflineFile(null);
    try {
      const res = await parseExcelFile(file);
      if (res.success && res.books.length > 0) {
        onImportBooks(res.books, 'replace');
        setGoogleSyncMessage(`✅ Đã nạp thành công ${res.books.length} sổ tiết kiệm từ file "${file.name}"!`);
      } else {
        setSyncErrorMessage('File không hợp lệ hoặc không tìm thấy cấu trúc sổ tiết kiệm.');
      }
    } catch (err: any) {
      setSyncErrorMessage('Lỗi khi nạp file sao lưu: ' + err.message);
    } finally {
      setSyncStatusStep(null);
    }
  };

  if (!isOpen) return null;

  const isOnlineUser = Boolean(
    (appUser && !appUser.isOffline) ||
    Boolean(currentUser) ||
    Boolean(getGoogleAccessToken())
  );
  const hasExistingData = Boolean(books && books.length > 0);
  const totalPrincipal = books.reduce((sum, b) => sum + (b.principal || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className={`p-1.5 rounded-lg shrink-0 ${
              isOnlineUser
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}>
              {isOnlineUser ? <Cloud className="w-4 h-4" /> : <HardDrive className="w-4 h-4" />}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-white truncate">
                  {isOnlineUser ? 'Đồng Bộ Google Drive' : 'Dữ Liệu & Sao Lưu'}
                </h2>
                <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                  isOnlineUser ? 'bg-emerald-600 text-emerald-50' : 'bg-amber-500 text-slate-950'
                }`}>
                  {isOnlineUser ? 'Online' : 'Offline'}
                </span>
              </div>
              {isOnlineUser && (
                <p className="text-[11px] text-slate-400 truncate">
                  {appUser?.email || currentUser?.email || ''}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3.5 sm:p-4 overflow-y-auto space-y-3 flex-1 text-xs">
          {/* LUỒNG DÀNH CHO USER ONLINE (GOOGLE DRIVE) */}
          {isOnlineUser ? (
            !sheetUrl ? (
              <div className="space-y-2">
                {isDiscoveringHub && (
                  <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-center gap-2 text-indigo-800 text-xs font-semibold animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    <span>Đang tìm file trên Drive...</span>
                  </div>
                )}
                {!canChangeDriveFile(settings.currentRole) ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-bold">
                      <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Chưa chọn file liên kết</span>
                    </div>
                    <p className="text-[11px] text-amber-800">
                      Vui lòng yêu cầu Admin ({settings.workspaceOwnerEmail || 'Admin'}) kết nối file Google Drive.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Nút tạo Google Sheet mới với tên tùy chọn */}
                    <button
                      onClick={() => {
                        setNewFileNameInput(`So_tiet_kiem_${new Date().getFullYear()}`);
                        setShowCreateFileDialog(true);
                      }}
                      disabled={isCreatingNewFile}
                      className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60 shadow-xs"
                    >
                      <Plus className="w-4 h-4 text-emerald-200" />
                      <span>Tạo Google Sheet mới trên Drive</span>
                    </button>

                    {/* Danh sách file khả dụng trên Drive (drive.file) */}
                    <div className="space-y-2 bg-slate-50 p-2.5 sm:p-3 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between text-[11px] text-slate-700 font-bold px-0.5">
                        <span className="flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Bảng tính trên Drive ({realFiles.length})</span>
                        </span>
                        <button
                          type="button"
                          disabled={isLoadingFiles}
                          onClick={() => accessToken && loadGoogleDriveFiles(accessToken)}
                          className="text-slate-500 hover:text-emerald-700 p-1 rounded cursor-pointer transition-colors"
                          title="Tải lại danh sách"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin text-emerald-600' : ''}`} />
                        </button>
                      </div>

                      {/* File Items */}
                      {isLoadingFiles ? (
                        <div className="py-6 text-center text-slate-500 space-y-1.5 bg-white rounded-lg border border-slate-100">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto text-emerald-600" />
                          <p className="text-[11px]">Đang tải danh sách file...</p>
                        </div>
                      ) : realFiles.length > 0 ? (
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white max-h-52 overflow-y-auto">
                          {realFiles.map((file) => {
                            const isSelected = selectedFileId === file.id;
                            return (
                              <div
                                key={file.id}
                                onClick={() => handleSelectRealFile(file)}
                                className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                                  isSelected ? 'bg-emerald-50/90 border-l-4 border-l-emerald-600' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center space-x-2 min-w-0 pr-2">
                                  <span className="p-1 bg-emerald-100 text-emerald-700 rounded-md shrink-0">
                                    <FileSpreadsheet className="w-3.5 h-3.5" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 text-xs truncate" title={file.name}>
                                      {file.name}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('vi-VN') : ''}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteDriveFile(e, file)}
                                    disabled={deletingFileId === file.id}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Xóa file khỏi Google Drive"
                                  >
                                    {deletingFileId === file.id ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-[10px] shrink-0 transition-colors">
                                    {isSelected ? 'Đang dùng' : 'Chọn'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-4 px-2 text-center bg-white rounded-lg border border-dashed border-slate-200 space-y-1">
                          <p className="text-[11px] font-medium text-slate-600">Chưa có file bảng tính nào trên Drive</p>
                          <p className="text-[10px] text-slate-400">Bấm nút ở trên để tạo file mới</p>
                        </div>
                      )}
                    </div>

                    {/* Khu vực Chọn file từ máy & Xuất Excel */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-slate-600" />
                          <span>Dữ liệu trên máy</span>
                        </span>
                        <span className="text-[9px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.2 rounded">Thiết bị</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs cursor-pointer shadow-2xs">
                          <Upload className="w-3.5 h-3.5 text-white" />
                          <span>Nhập file từ máy</span>
                          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleSelectOfflineFile} className="hidden" />
                        </label>
                        <button
                          type="button"
                          onClick={handleExportBackup}
                          className="flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-700 border border-slate-300 font-semibold text-xs cursor-pointer shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                          <span>Xuất file Excel</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* KHI ĐÃ LIÊN KẾT VỚI FILE DRIVE */
              <div className="space-y-3">
                <div className="space-y-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  {fileIsDeleted ? (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs space-y-2">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>File trên Drive đã bị xóa!</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setNewFileNameInput(`So_tiet_kiem_${new Date().getFullYear()}`);
                            setShowCreateFileDialog(true);
                          }}
                          disabled={isCreatingNewFile}
                          className="flex-1 py-1.5 px-2 bg-emerald-600 text-white rounded-lg font-bold text-xs"
                        >
                          Tạo file mới
                        </button>
                        <button
                          onClick={handleOpenDrivePicker}
                          className="flex-1 py-1.5 px-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-bold text-xs"
                        >
                          Chọn file khác
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <FileSpreadsheet className="w-4 h-4" />
                          </div>
                          <h4 className="font-bold text-slate-900 text-xs truncate" title={selectedFileName || 'So_tiet_kiem'}>
                            {selectedFileName || 'So_tiet_kiem'}
                          </h4>
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            type="button"
                            onClick={handleManualSyncClick}
                            disabled={isManualSyncing || isFetchingFileName}
                            className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white rounded border border-slate-200 cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${isManualSyncing || isFetchingFileName ? 'animate-spin text-emerald-600' : ''}`} />
                            <span>{!hasGoogleToken ? 'Cấp quyền' : 'Đồng bộ'}</span>
                          </button>
                          <a
                            href={sheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-0.5 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200"
                          >
                            <span>Mở</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      {!hasGoogleToken && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Phiên hết hạn. Bấm <strong>&quot;Cấp quyền&quot;</strong> để đồng bộ.</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                        <span className="text-emerald-700 font-medium flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          <span>Đồng bộ 2 chiều</span>
                        </span>
                        {lastSyncTime && <span>Cập nhật: <strong className="text-slate-700">{lastSyncTime}</strong></span>}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          id="btn-link-google-drive"
                          disabled={!canChangeDriveFile(settings.currentRole)}
                          onClick={handleOpenDrivePicker}
                          className={`w-full py-2 px-2.5 rounded-lg font-bold text-xs flex items-center justify-center space-x-1 border ${
                            !canChangeDriveFile(settings.currentRole)
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 cursor-pointer'
                          }`}
                        >
                          <Link2 className="w-3.5 h-3.5 text-slate-500" />
                          <span>Đổi file</span>
                        </button>

                        <button
                          id="btn-unlink-and-clear-data"
                          disabled={!canChangeDriveFile(settings.currentRole)}
                          onClick={() => setShowClearConfirm(true)}
                          className={`w-full py-2 px-2.5 rounded-lg font-bold text-xs flex items-center justify-center space-x-1 border ${
                            !canChangeDriveFile(settings.currentRole)
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
                              : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 cursor-pointer'
                          }`}
                        >
                          <Unlink className="w-3.5 h-3.5 text-rose-600" />
                          <span>Hủy liên kết</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Khu vực Chọn file từ máy & Xuất Excel khi đã liên kết */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-slate-600" />
                      <span>Dữ liệu trên máy</span>
                    </span>
                    <span className="text-[9px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.2 rounded">Thiết bị</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs cursor-pointer shadow-2xs">
                      <Upload className="w-3.5 h-3.5 text-white" />
                      <span>Nhập file từ máy</span>
                      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleSelectOfflineFile} className="hidden" />
                    </label>
                    <button
                      type="button"
                      onClick={handleExportBackup}
                      className="flex items-center justify-center space-x-1.5 py-2 px-2.5 rounded-lg bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-700 border border-slate-300 font-semibold text-xs cursor-pointer shadow-2xs"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      <span>Xuất file Excel</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* LUỒNG DÀNH CHO USER OFFLINE */
            <div className="space-y-2.5">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-xs">Đồng bộ Online Google Drive</h4>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-600 text-white">Drive</span>
                </div>
                <button
                  onClick={handleSignInGoogle}
                  disabled={isAuthenticating}
                  className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60"
                >
                  {isAuthenticating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang đăng nhập...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>Đăng nhập Google</span>
                    </>
                  )}
                </button>
              </div>

              {/* Offline File Management */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-slate-600" />
                    Sao lưu trên máy
                  </span>
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">Offline</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="flex items-center justify-center space-x-1 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải file .xlsx</span>
                  </button>
                  <label className="flex items-center justify-center space-x-1 py-2 px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    <span>Nạp file .xlsx</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleSelectOfflineFile} className="hidden" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Trạng thái xử lý hoặc thông báo */}
          {syncStatusStep && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg flex items-center space-x-2 text-[11px] animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />
              <span className="font-medium">{syncStatusStep}</span>
            </div>
          )}

          {googleSyncMessage && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-lg flex items-start space-x-2 text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{googleSyncMessage}</span>
            </div>
          )}

          {syncErrorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-950 rounded-xl space-y-1.5 text-[11px]">
              <div className="flex items-start space-x-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed flex-1">{syncErrorMessage}</span>
              </div>
              {(syncErrorMessage.toLowerCase().includes('popup') ||
                syncErrorMessage.toLowerCase().includes('chặn') ||
                syncErrorMessage.toLowerCase().includes('đăng nhập')) && (
                <div className="pt-1 flex flex-wrap gap-2 border-t border-rose-200/80">
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] flex items-center space-x-1 cursor-pointer shadow-xs"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Mở ở Tab mới</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await signInWithGoogleRedirect();
                      } catch (e: any) {
                        setSyncErrorMessage(e?.message || 'Không thể đăng nhập chuyển hướng.');
                      }
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-[10px] flex items-center space-x-1 cursor-pointer shadow-xs"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Đăng nhập Redirect</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* CỬA SỔ CHỌN FILE GOOGLE DRIVE GỌN NHẸ CHO MOBILE */}
      {showDrivePickerModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95">
            {/* Header gọn nhẹ */}
            <div className="bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-2.5 min-w-0">
                <span className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
                  <FolderOpen className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-sm truncate">
                    Chọn File Google Drive
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    {currentUser?.email || 'Chưa đăng nhập Google'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDrivePickerModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nội dung */}
            <div className="p-3 sm:p-4 overflow-y-auto space-y-3 flex-1 text-xs">
              {!currentUser && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                  <p className="font-semibold text-amber-900 text-xs">
                    Vui lòng đăng nhập Google để xem và chọn file
                  </p>
                  <button
                    disabled={isAuthenticating}
                    onClick={handleSignInGoogle}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Đăng nhập Google</span>
                  </button>
                </div>
              )}

              {/* Nút hành động chính: Tạo file mới trên Drive */}
              <button
                type="button"
                onClick={() => {
                  setNewFileNameInput(`So_tiet_kiem_${new Date().getFullYear()}`);
                  setShowCreateFileDialog(true);
                }}
                disabled={isLoadingFiles || !currentUser}
                className="w-full flex items-center justify-center space-x-1.5 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold rounded-xl text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-emerald-200 shrink-0" />
                <span className="truncate">➕ Tạo bảng tính mới trên Drive</span>
              </button>

              {/* Danh sách file khả dụng */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-700 font-bold px-0.5">
                  <span className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    <span>File khả dụng ({realFiles.length}):</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedFileId && <span className="text-emerald-600 font-semibold">Đã chọn 1 file</span>}
                    <button
                      type="button"
                      disabled={isLoadingFiles || !accessToken}
                      onClick={() => accessToken && loadGoogleDriveFiles(accessToken)}
                      className="p-1 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Làm mới danh sách"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin text-emerald-600' : ''}`} />
                    </button>
                  </div>
                </div>

                {isLoadingFiles ? (
                  <div className="py-8 text-center text-slate-500 space-y-1.5 bg-slate-50 rounded-xl border border-slate-100">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-emerald-600" />
                    <p className="text-xs">Đang tải danh sách file...</p>
                  </div>
                ) : realFiles.length === 0 ? (
                  <div className="py-6 px-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Chưa có file nào liên kết</p>
                    <p className="text-[11px] text-slate-500">
                      Bấm <strong>"Tạo bảng tính mới trên Drive"</strong> để bắt đầu đồng bộ.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                    {realFiles.map((file) => {
                      const isSelected = selectedFileId === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => handleSelectRealFile(file)}
                          className={`p-2.5 sm:p-3 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-50/90 border-l-4 border-l-emerald-600' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                            <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg shrink-0">
                              <FileSpreadsheet className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 text-xs flex items-center space-x-1.5">
                                <span className="truncate">{file.name}</span>
                                {file.isCentralHub && (
                                  <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-sm shrink-0">
                                    Trung tâm
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 flex items-center space-x-2 mt-0.5">
                                <span>{file.size}</span>
                                <span>&bull;</span>
                                <span>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('vi-VN') : ''}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => handleDeleteDriveFile(e, file)}
                              disabled={deletingFileId === file.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Xóa file khỏi Google Drive"
                            >
                              {deletingFileId === file.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <span
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] shrink-0 transition-all ${
                                isSelected
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-emerald-600 hover:text-white'
                              }`}
                            >
                              {isSelected ? 'Đang dùng' : 'Chọn'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer gọn */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
              <button
                onClick={() => setShowDrivePickerModal(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG TẠO FILE TRÊN DRIVE VỚI TÊN TÙY CHỌN */}
      {showCreateFileDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3">
              <span className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
                <FileSpreadsheet className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Tạo File Mới Trên Google Drive</h3>
                <p className="text-xs text-slate-500">Đặt tên tùy thích cho file bảng tính của bạn</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <label className="font-bold text-slate-800 block">Tên file muốn tạo:</label>
              <input
                type="text"
                value={newFileNameInput}
                onChange={(e) => setNewFileNameInput(e.target.value)}
                placeholder="So_tiet_kiem"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                disabled={isCreatingNewFile}
                onClick={() => setShowCreateFileDialog(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                disabled={isCreatingNewFile || !newFileNameInput.trim()}
                onClick={handleCreateNewDriveFile}
                className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {isCreatingNewFile ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang tạo trên Drive...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Tạo &amp; Liên kết</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3">
              <span className="p-3 bg-rose-100 text-rose-600 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Hủy Liên Kết &amp; Dọn Sạch Dữ Liệu</h3>
                <p className="text-xs text-slate-500">Tự động sao lưu lên Google Drive trước khi dọn dẹp</p>
              </div>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-slate-700 bg-rose-50 p-4 rounded-xl border border-rose-200">
              <div className="flex items-start space-x-2 text-rose-950 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Cam kết bảo vệ dữ liệu Google Drive của bạn:</span>
              </div>
              <p className="text-slate-800">
                1. Hệ thống sẽ tự động cập nhật và sao lưu toàn bộ sổ tiết kiệm lên Google Drive của bạn trước.
              </p>
              <p className="text-slate-800">
                2. Sau khi đã đẩy dữ liệu an toàn lên Drive, ứng dụng mới làm sạch 100% dữ liệu nội bộ trên thiết bị của bạn.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                disabled={isUnlinking}
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                disabled={isUnlinking}
                onClick={handleSafeguardedDisconnectAndClear}
                className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-sm transition-all disabled:opacity-50"
              >
                {isUnlinking ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang sao lưu &amp; Dọn sạch...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Sao Lưu &amp; Dọn Sạch Dữ Liệu</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Overwrite Confirmation Modal */}
      {showOverwriteWarning && pendingOfflineFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-amber-300 p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3">
              <span className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Xác Nhận Nạp File Đè Dữ Liệu</h3>
                <p className="text-xs text-slate-500">Bảo vệ dữ liệu, tránh mất mát thông tin</p>
              </div>
            </div>

            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-2 leading-relaxed">
              <p className="font-bold">
                ⚠️ Ứng dụng hiện đang có sẵn {books.length} sổ tiết kiệm ({formatVND(totalPrincipal)}).
              </p>
              <p>
                Việc nạp file <strong>"{pendingOfflineFile.name}"</strong> từ máy tính/điện thoại sẽ <strong>THAY THẾ TOÀN BỘ</strong> danh sách sổ hiện tại trên app.
              </p>
              <p className="text-[11px] text-amber-800">
                Nếu bạn muốn giữ lại dữ liệu hiện tại, vui lòng bấm "Hủy bỏ" và bấm "Tải bản sao lưu về máy" trước khi tiếp tục.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setShowOverwriteWarning(false);
                  setPendingOfflineFile(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
              >
                Hủy bỏ
              </button>
              <button
                onClick={() => pendingOfflineFile && executeImportOfflineFile(pendingOfflineFile)}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs"
              >
                Xác Nhận Nạp Đè
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
