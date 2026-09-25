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
} from 'lucide-react';
import { User } from 'firebase/auth';
import { SavingsBook, AppSettings, AuthUser, SettlementAdjustment, canChangeDriveFile } from '../types';
import { exportSavingsBooksToExcel, exportStandardTemplateExcel, parseExcelFile } from '../utils/excelParser';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CANONICAL_COLUMNS } from '../utils/dataSchema';
import { getDynamicAnnualInterestHistory, getDynamicBalanceGrowthHistory, clearStaticHistoryFromStorage } from '../data/historicalGrowth';
import { formatVND, formatShortVND } from '../utils/formatters';
import {
  getWorkspaceMasterStateFromFirestore,
  saveWorkspaceMasterStateToFirestore,
} from '../utils/firebaseFirestoreService';
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
  getRealGoogleDriveFileMetadata,
  getMasterSyncStateFromDrive,
  setMasterSyncLinked,
  setMasterSyncUnlinked,
  autoDiscoverLatestCentralHub,
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
  const [driveSearchQuery, setDriveSearchQuery] = useState<string>('');
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
  const [customLinkInput, setCustomLinkInput] = useState<string>('');
  const [isCreatingNewFile, setIsCreatingNewFile] = useState<boolean>(false);
  const [showCreateFileDialog, setShowCreateFileDialog] = useState<boolean>(false);
  const [newFileNameInput, setNewFileNameInput] = useState<string>('So_Tiet_Kiem_Gia_Dinh_2026.xlsx');

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

  // Kiểm tra liên kết file trung tâm từ Firestore & Google Drive khi mở modal
  useEffect(() => {
    let isMounted = true;
    const token = accessToken || getGoogleAccessToken();
    if (isOpen) {
      (async () => {
        try {
          const firestoreMaster = await getWorkspaceMasterStateFromFirestore();
          const master = firestoreMaster || (token ? await getMasterSyncStateFromDrive(token) : null);
          if (!isMounted) return;
          if (!master || master.status === 'unlinked' || !master.activeFileId) {
            console.info('[DataSyncModal] Không có file liên kết active -> Đặt app về trạng thái chưa liên kết');
            setSelectedFileName('');
            setSheetUrl('');
            setSelectedFileId('');
            setLastSyncTime(null);
            onUpdateSettings({
              googleSheetUrl: undefined,
              googleSheetName: undefined,
              lastSyncTime: undefined,
            });
          } else if (master.status === 'active' && master.activeFileId) {
            setSelectedFileName(master.activeFileName || 'Bảng tính tiết kiệm');
            setSheetUrl(master.activeFileUrl || `https://docs.google.com/spreadsheets/d/${master.activeFileId}/edit`);
            setSelectedFileId(master.activeFileId);
            onUpdateSettings({
              googleSheetUrl: master.activeFileUrl || `https://docs.google.com/spreadsheets/d/${master.activeFileId}/edit`,
              googleSheetName: master.activeFileName || 'Bảng tính tiết kiệm',
              workspaceOwnerEmail: master.adminEmail,
              members: master.members || [],
            });
          }
        } catch (err) {
          console.warn('[DataSyncModal] Lỗi kiểm tra master workspace state:', err);
        }
      })();
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, accessToken, onUpdateSettings]);

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
              setSelectedFileName(meta.name);
              onUpdateSettings({ googleSheetName: meta.name });
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

  // Fetch real Google Drive files when token is available and picker is opened
  useEffect(() => {
    if (accessToken && showDrivePickerModal) {
      loadGoogleDriveFiles(accessToken, driveSearchQuery);
    }
  }, [accessToken, showDrivePickerModal]);

  const loadGoogleDriveFiles = async (token: string, search?: string) => {
    setIsLoadingFiles(true);
    setSyncErrorMessage(null);
    try {
      const files = await listRealGoogleDriveFiles(token, search);
      setRealFiles(files);
      if (selectedFileId && !selectedFileName) {
        const found = files.find((f) => f.id === selectedFileId);
        if (found) {
          setSelectedFileName(found.name);
          onUpdateSettings({ googleSheetName: found.name });
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
            try {
              sessionStorage.setItem('explicitly_unlinked', 'true');
            } catch {}
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
      loadGoogleDriveFiles(token, driveSearchQuery);
    }
  };

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
    try { sessionStorage.removeItem('explicitly_unlinked'); } catch {}
    const link = file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    setSheetUrl(link);
    setShowDrivePickerModal(false);

    const token = await validateTokenOrPrompt();
    if (!token) {
      onCancelFileSwitch?.();
      return;
    }

    // Update Master Sync Pointer on Firestore & Google Drive
    let stampTime = '';
    try {
      saveWorkspaceMasterStateToFirestore({
        status: 'active',
        lastAction: 'link',
        activeFileId: file.id,
        activeFileName: file.name,
        activeFileUrl: link,
        adminEmail: currentUser?.email || appUser?.email,
        members: settings.members,
      }).catch(() => {});

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
    try { sessionStorage.removeItem('explicitly_unlinked'); } catch {}

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
            try {
              sessionStorage.removeItem('explicitly_unlinked');
            } catch {}

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

      const created = await createRealGoogleDriveFile(
        token,
        newFileNameInput.trim(),
        books
      );

      onMarkAsRemoteUpdate?.(books, undefined, created.webViewLink);

      setSelectedFileId(created.id);
      setSelectedFileName(created.name);
      setSheetUrl(created.webViewLink);
      setShowCreateFileDialog(false);
      setShowDrivePickerModal(false);

      const nowStr = new Date().toLocaleString('vi-VN');
      setLastSyncTime(nowStr);
      onUpdateSettings({
        googleSheetUrl: created.webViewLink,
        googleSheetName: created.name,
        lastSyncTime: nowStr,
        autoSync: true,
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
        try { sessionStorage.setItem('explicitly_unlinked', 'true'); } catch {}
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

    if (selectedFileId) {
      const token = accessToken || getGoogleAccessToken();
      if (token) {
        try {
          await setMasterSyncUnlinked(token, currentUser?.email || appUser?.email);
        } catch {
          // ignore
        }
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
      sessionStorage.setItem('explicitly_unlinked', 'true');
    } catch {
      // ignore
    }

    if (onFinishFileSwitch) {
      onFinishFileSwitch([], [], '', '', '', '');
    } else {
      onUpdateSettings({ googleSheetUrl: '', googleSheetName: '', lastSyncTime: undefined, autoSync: true });
    }
    setSheetUrl('');
    setSelectedFileId('');
    setSelectedFileName('');
    setCustomLinkInput('');
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

      const nowYear = new Date().getFullYear();
      const defaultName = `So_Tiet_Kiem_Gia_Dinh_${nowYear}.xlsx`;
      const created = await createRealGoogleDriveFile(token, defaultName, books, settlements);

      onMarkAsRemoteUpdate?.(books, settlements, created.webViewLink);

      setSelectedFileId(created.id);
      setSelectedFileName(created.name);
      setSheetUrl(created.webViewLink);
      setFileIsDeleted(false);
      try { sessionStorage.removeItem('explicitly_unlinked'); } catch {}

      const nowStr = new Date().toLocaleString('vi-VN');
      setLastSyncTime(nowStr);
      onUpdateSettings({
        googleSheetUrl: created.webViewLink,
        googleSheetName: created.name,
        lastSyncTime: nowStr,
        autoSync: true,
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
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white flex items-center justify-between border-b border-emerald-800/40">
          <div className="flex items-center space-x-3">
            <span className={`p-2 rounded-xl border ${
              isOnlineUser
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}>
              {isOnlineUser ? <Cloud className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>{isOnlineUser ? 'Đồng Bộ Google Drive Cá Nhân' : 'Quản Lý Dữ Liệu & Sao Lưu'}</span>
                {isOnlineUser ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600/80 text-[10px] font-semibold text-emerald-100 flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> Trực tuyến (Online)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500 text-[10px] font-bold text-slate-950 flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> Ngoại tuyến (Offline)
                  </span>
                )}
              </h2>
              <p className="text-xs text-emerald-200/80">
                {isOnlineUser ? (
                  <>Tài khoản Google: <strong className="text-white">{appUser?.email || currentUser?.email || 'Đã kết nối'}</strong></>
                ) : (
                  <>Chế độ ngoại tuyến: Dữ liệu được lưu trữ an toàn ngay trên máy của bạn.</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3 sm:p-5 overflow-y-auto space-y-3.5 flex-1 text-xs">

          {/* Connected File Information & 2-Way Sync Status */}
          <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 text-[11px]">
                Google Drive liên kết:
              </span>
              {sheetUrl ? (
                fileIsDeleted ? (
                  <div className="flex items-center space-x-1 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse"></span>
                    <span className="font-bold text-rose-900 text-[10px]">Đã bị xóa trên Drive</span>
                  </div>
                ) : !hasGoogleToken ? (
                  <div className="flex items-center space-x-1 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                    <span className="font-bold text-amber-950 text-[10px]">Hết hạn phiên</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                    <span className="font-bold text-emerald-900 text-[10px]">Đã kết nối</span>
                  </div>
                )
              ) : (
                <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Chưa liên kết
                </span>
              )}
            </div>

            {sheetUrl ? (
              <div className="space-y-2 bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                {fileIsDeleted && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                    <div className="flex items-center gap-1.5 text-rose-950 text-xs font-bold">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>File &quot;{selectedFileName}&quot; đã bị xóa trên Drive. Dữ liệu trên app vẫn an toàn.</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Bạn muốn tạo file mới bù lại trên Google Drive để tiếp tục đồng bộ hay chọn file khác?
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleQuickCreateDriveFile}
                        disabled={isCreatingNewFile}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center space-x-1 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                        <span>⚡ Tạo File Mới Bù Lại (1-Click)</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenDrivePicker}
                        className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs flex items-center space-x-1 cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                        <span>📂 Chọn File Khác</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* File Title and Actions */}
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
                  <div className="flex items-center space-x-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4
                        className="font-bold text-slate-900 text-xs truncate"
                        title={selectedFileName || 'File Google Drive'}
                      >
                        {selectedFileName || (isFetchingFileName ? 'Đang tải...' : 'Spreadsheet')}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleManualSyncClick}
                      disabled={isManualSyncing || isFetchingFileName}
                      title={!hasGoogleToken ? "Cấp lại quyền & Đồng bộ" : "Đồng bộ ngay"}
                      className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-medium text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 rounded border border-slate-200 transition-colors cursor-pointer"
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

                {/* Google Access Token Expired Warning */}
                {!hasGoogleToken && !fileIsDeleted && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Phiên kết nối Google đã hết hạn. Bấm <strong>&quot;Cấp quyền&quot;</strong> để tiếp tục đồng bộ.</span>
                  </div>
                )}

                {/* Status & Last Sync */}
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-emerald-600" />
                    <span>Tự động 2 chiều</span>
                  </span>
                  {lastSyncTime && (
                    <span>Cập nhật: <strong className="text-slate-700">{lastSyncTime}</strong></span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-[11px] py-0.5">
                Chưa kết nối file Drive. Tạo hoặc chọn file bên dưới để tự động đồng bộ.
              </div>
            )}
          </div>

          {/* CHỌN PHƯƠNG THỨC ĐỒNG BỘ THEO LUỒNG ONLINE HOẶC OFFLINE */}
          {isOnlineUser ? (
            /* =================== LUỒNG DÀNH CHO USER ONLINE (GOOGLE DRIVE) =================== */
            !sheetUrl ? (
              <div className="space-y-2.5">
                {isDiscoveringHub && (
                  <div className="p-3 bg-indigo-50/90 border border-indigo-200 rounded-xl flex items-center justify-center gap-2 text-indigo-800 text-xs font-semibold animate-pulse shadow-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                    <span>Đang quét tìm và tự động kết nối file trung tâm trên Google Drive...</span>
                  </div>
                )}
                {!canChangeDriveFile(settings.currentRole) ? (
                  <div className="p-3 bg-amber-50/80 border border-amber-200 text-amber-900 rounded-xl space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-amber-900">
                      <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Chưa chọn file liên kết trung tâm</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      Bạn đang tham gia không gian với vai trò <strong>{settings.currentRole === 'EDITOR' ? 'Chỉnh sửa (Editor)' : 'Xem (Viewer)'}</strong>. Vui lòng yêu cầu Admin (<strong>{settings.workspaceOwnerEmail || 'Admin'}</strong>) kết nối file Google Drive trung tâm.
                    </p>
                  </div>
                ) : hasExistingData ? (
                  /* TRƯỜNG HỢP A1: APP ĐANG CÓ SẴN DỮ LIỆU */
                  <div className="space-y-2.5">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Tạo File Mới Trên Google Drive</span>
                        </h4>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-600 text-white uppercase">
                          Khuyên dùng
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        Đẩy <strong>{books.length} sổ</strong> ({(totalPrincipal / 1_000_000).toLocaleString('vi-VN')} Tr VNĐ) lên file mới trên Drive và bật đồng bộ 2 chiều.
                      </p>

                      <button
                        onClick={handleQuickCreateDriveFile}
                        disabled={isCreatingNewFile}
                        className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {isCreatingNewFile ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Đang tạo file...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                            <span>⚡ Tạo File Mới &amp; Đồng Bộ (1-Click)</span>
                          </>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenDrivePicker}
                      className="w-full py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer border border-slate-200"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                      <span>📂 Chọn file sẵn có trên Google Drive</span>
                    </button>
                  </div>
                ) : (
                  /* TRƯỜNG HỢP A2: APP CHƯA CÓ DỮ LIỆU */
                  <div className="space-y-2">
                    <button
                      id="btn-link-google-drive"
                      onClick={handleOpenDrivePicker}
                      className="flex items-center justify-center space-x-1.5 w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all cursor-pointer"
                    >
                      <FolderOpen className="w-4 h-4 text-white" />
                      <span>📂 Chọn file sẵn có trên Google Drive</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* KHI ĐÃ LIÊN KẾT VỚI FILE DRIVE */
              <div className="space-y-2">
                {!canChangeDriveFile(settings.currentRole) && (
                  <div className="p-2.5 bg-amber-50/80 border border-amber-200 text-amber-900 rounded-xl flex items-start space-x-2 text-xs">
                    <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <p className="font-bold">Không gian chia sẻ ({settings.currentRole === 'EDITOR' ? 'Người chỉnh sửa / Editor' : 'Người xem / Viewer'})</p>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Bạn đang sử dụng file liên kết do Admin (<strong>{settings.workspaceOwnerEmail || 'Admin'}</strong>) thiết lập. Thao tác <strong>Đổi file hoặc Hủy liên kết</strong> chỉ dành riêng cho Admin.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  <button
                    id="btn-link-google-drive"
                    disabled={!canChangeDriveFile(settings.currentRole)}
                    onClick={handleOpenDrivePicker}
                    className={`flex items-center justify-center space-x-1.5 w-full py-2.5 px-3 rounded-xl font-bold text-xs transition-all ${
                      !canChangeDriveFile(settings.currentRole)
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                    }`}
                    title={!canChangeDriveFile(settings.currentRole) ? 'Chỉ Admin mới có quyền đổi file liên kết' : ''}
                  >
                    {!canChangeDriveFile(settings.currentRole) ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" />
                    )}
                    <span>Đổi File Google Drive</span>
                  </button>

                  <button
                    id="btn-unlink-and-clear-data"
                    disabled={!canChangeDriveFile(settings.currentRole)}
                    onClick={() => setShowClearConfirm(true)}
                    className={`flex items-center justify-center space-x-1.5 w-full py-2.5 px-3 rounded-xl font-bold text-xs transition-all ${
                      !canChangeDriveFile(settings.currentRole)
                        ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                        : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer'
                    }`}
                    title={!canChangeDriveFile(settings.currentRole) ? 'Chỉ Admin mới có quyền hủy liên kết' : ''}
                  >
                    {!canChangeDriveFile(settings.currentRole) ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <Unlink className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    <span>Hủy liên kết</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* =================== LUỒNG DÀNH CHO USER OFFLINE =================== */
            <div className="space-y-2.5">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-xs">
                    Chuyển sang chế độ Online
                  </h4>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-600 text-white uppercase">
                    Google Drive
                  </span>
                </div>
                <p className="text-[11px] text-slate-600">
                  Đăng nhập Google để tự động đồng bộ {hasExistingData && `${books.length} sổ `}giữa các thiết bị.
                </p>
                <button
                  onClick={handleSignInGoogle}
                  disabled={isAuthenticating}
                  className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60"
                >
                  {isAuthenticating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang đăng nhập...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>⚡ Đăng nhập Google</span>
                    </>
                  )}
                </button>
              </div>

              {/* Khối Xử Lý Dữ Liệu Ngoại Tuyến (Offline) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-slate-600" />
                    Quản lý file trên máy (Offline)
                  </span>
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">
                    Nội bộ
                  </span>
                </div>

                {hasExistingData ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-600">
                      Đang có <strong>{books.length} sổ</strong> ({(totalPrincipal / 1_000_000).toLocaleString('vi-VN')} Tr VNĐ) trên máy.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleExportBackup}
                        className="flex items-center justify-center space-x-1 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải file .xlsx</span>
                      </button>
                      <label
                        className="flex items-center justify-center space-x-1 py-2 px-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-slate-500" />
                        <span>Nạp file sao lưu</span>
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={handleSelectOfflineFile}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label
                    className="flex items-center justify-center space-x-1 w-full py-2 px-3 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    <span>📂 Nạp file Excel (.xlsx)</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleSelectOfflineFile}
                      className="hidden"
                    />
                  </label>
                )}
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
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-950 rounded-xl space-y-2 text-[11px]">
              <div className="flex items-start space-x-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed flex-1">{syncErrorMessage}</span>
              </div>
              {(syncErrorMessage.toLowerCase().includes('popup') ||
                syncErrorMessage.toLowerCase().includes('chặn') ||
                syncErrorMessage.toLowerCase().includes('đăng nhập')) && (
                <div className="pt-1.5 flex flex-wrap gap-2 border-t border-rose-200/80">
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] flex items-center space-x-1 transition-colors cursor-pointer shadow-sm"
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
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-[10px] flex items-center space-x-1 transition-colors cursor-pointer shadow-sm"
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
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* CỬA SỔ CHỌN FILE GOOGLE DRIVE THỰC TẾ */}
      {showDrivePickerModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-300 overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95">
            {/* Drive Picker Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                  <FolderOpen className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Chọn File Trên Google Drive Của Bạn
                  </h3>
                  <p className="text-xs text-slate-400">
                    {currentUser ? (
                      <>Tài khoản: <strong className="text-emerald-300">{currentUser.email}</strong></>
                    ) : (
                      <>Chưa kết nối tài khoản Google</>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDrivePickerModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drive Picker Content */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {!currentUser && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                  <p className="font-bold text-amber-900">
                    Vui lòng đăng nhập Google để xem danh sách file từ Google Drive của bạn
                  </p>
                  <button
                    disabled={isAuthenticating}
                    onClick={handleSignInGoogle}
                    className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Đăng Nhập Google Sync</span>
                  </button>
                </div>
              )}

              {/* Search Bar & Refresh */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Tìm kiếm file trên Google Drive..."
                    value={driveSearchQuery}
                    onChange={(e) => {
                      setDriveSearchQuery(e.target.value);
                      if (accessToken) {
                        loadGoogleDriveFiles(accessToken, e.target.value);
                      }
                    }}
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <button
                  disabled={isLoadingFiles || !accessToken}
                  onClick={() => accessToken && loadGoogleDriveFiles(accessToken, driveSearchQuery)}
                  className="p-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-slate-700 disabled:opacity-50"
                  title="Tải lại danh sách file"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
              </div>

              {/* Real Drive Files List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Danh sách file trên Google Drive ({realFiles.length} file):
                  </span>
                </div>

                {isLoadingFiles ? (
                  <div className="py-12 text-center text-slate-500 space-y-2 bg-slate-50 rounded-xl border border-slate-200">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600" />
                    <p className="text-xs font-medium">Đang tải danh sách file từ Google Drive...</p>
                  </div>
                ) : realFiles.length === 0 ? (
                  <div className="py-6 px-4 text-center bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-slate-800">
                        {driveSearchQuery
                          ? `Không tìm thấy file nào khớp với "${driveSearchQuery}".`
                          : 'Chưa tìm thấy file bảng tính khả dụng trên Google Drive.'}
                      </p>
                      <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                        Bạn có thể <strong>Tạo file mới</strong> trực tiếp trên Drive, <strong>Dán link Google Sheets</strong> ở bên dưới, hoặc <strong>Đăng nhập lại</strong> để cấp toàn quyền Drive.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        onClick={() => setShowCreateFileDialog(true)}
                        className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        <span>Tạo File Mới Trên Google Drive</span>
                      </button>

                      <button
                        onClick={handleSignInGoogle}
                        className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold border border-slate-300 rounded-xl text-xs shadow-2xs transition-all"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Cấp lại quyền Google Drive</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto">
                    {realFiles.map((file) => {
                      const isSelected = selectedFileId === file.id;
                      return (
                        <div
                          key={file.id}
                          onClick={() => handleSelectRealFile(file)}
                          className={`p-3.5 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-50/90 border-l-4 border-l-emerald-600' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                              <FileSpreadsheet className="w-5 h-5" />
                            </span>
                            <div>
                              <div className="font-bold text-slate-900 text-xs flex items-center space-x-2">
                                <span>{file.name}</span>
                                {isSelected && (
                                  <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full">
                                    Đang liên kết
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center space-x-3 mt-0.5">
                                <span>Kích thước: {file.size}</span>
                                <span>&bull;</span>
                                <span>
                                  Cập nhật: {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('vi-VN') : 'Không rõ'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectRealFile(file);
                            }}
                            className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all ${
                              isSelected
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-700'
                            }`}
                          >
                            {isSelected ? 'Đang liên kết' : 'Chọn & Liên kết'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Drive Picker Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <a
                href="https://drive.google.com"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:underline flex items-center font-medium text-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Mở Google Drive cá nhân (tab mới)
              </a>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowDrivePickerModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG TẠO FILE TRÊN DRIVE NẾU CHƯA CÓ */}
      {showCreateFileDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-3">
              <span className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
                <FileSpreadsheet className="w-6 h-6" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Tạo File Mới Trên Google Drive</h3>
                <p className="text-xs text-slate-500">Lưu trữ danh mục sổ tiết kiệm vào Drive của bạn</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <label className="font-bold text-slate-800 block">Tên file muốn tạo:</label>
              <input
                type="text"
                value={newFileNameInput}
                onChange={(e) => setNewFileNameInput(e.target.value)}
                placeholder="So_Tiet_Kiem_Gia_Dinh_2026.xlsx"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                disabled={isCreatingNewFile}
                onClick={() => setShowCreateFileDialog(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
              >
                Hủy
              </button>
              <button
                disabled={isCreatingNewFile}
                onClick={handleCreateNewDriveFile}
                className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm disabled:opacity-50"
              >
                {isCreatingNewFile ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang tạo trên Drive...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Tạo &amp; Liên Kết Ngay</span>
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
