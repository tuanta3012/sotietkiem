import React, { useState } from 'react';
import {
  X,
  Users,
  UserPlus,
  ShieldAlert,
  Trash2,
  CheckCircle2,
  Crown,
  Edit3,
  Eye,
  LogOut,
  Mail,
  UserCheck,
  CloudOff,
  FolderSync,
  Copy,
  Send,
  Settings,
  ExternalLink,
  Check,
} from 'lucide-react';
import { AppSettings, AuthUser, WorkspaceMember, UserRole, canManageMembers } from '../types';
import { sendInviteEmail } from '../utils/googleDriveService';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  settings: AppSettings;
  onSaveMembers: (updatedMembers: WorkspaceMember[]) => Promise<void>;
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void;
  onLeaveWorkspace?: () => void;
  onOpenSyncModal?: () => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  settings,
  onSaveMembers,
  onUpdateSettings,
  onLeaveWorkspace,
  onOpenSyncModal,
}) => {
  if (!isOpen) return null;

  const userEmail = currentUser?.email?.trim().toLowerCase();
  const ownerEmail = settings.workspaceOwnerEmail?.trim().toLowerCase();
  const isOwner = Boolean(userEmail && ownerEmail && userEmail === ownerEmail);
  const currentRole: UserRole = isOwner
    ? 'ADMIN'
    : (settings.currentRole || (currentUser?.role === 'admin' ? 'ADMIN' : 'ADMIN'));
  const isAdmin = canManageMembers(currentRole);

  const [members, setMembers] = useState<WorkspaceMember[]>(() => {
    if (settings.members && settings.members.length > 0) {
      return settings.members;
    }
    if (currentUser?.email) {
      return [
        {
          id: 'owner-1',
          email: currentUser.email.toLowerCase(),
          name: currentUser.name || 'Admin',
          role: 'ADMIN',
          addedAt: new Date().toISOString(),
        },
      ];
    }
    return [];
  });

  React.useEffect(() => {
    if (settings.members && settings.members.length > 0) {
      setMembers((prev) => {
        const prevStr = JSON.stringify(prev);
        const nextStr = JSON.stringify(settings.members);
        return prevStr === nextStr ? prev : (settings.members || prev);
      });
    }
  }, [settings.members]);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('VIEWER');
  const [autoSendEmail, setAutoSendEmail] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showWebhookConfig, setShowWebhookConfig] = useState(false);
  const [webhookUrlInput, setWebhookUrlInput] = useState(settings.inviteWebhookUrl || '');
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);
  const [sendingEmailMemberId, setSendingEmailMemberId] = useState<string | null>(null);

  const hasLinkedDriveFile = Boolean(settings.googleSheetUrl && settings.googleSheetUrl.trim().length > 0);

  // Extract fileId from googleSheetUrl
  const fileMatch = settings.googleSheetUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl?.match(/id=([a-zA-Z0-9-_]+)/);
  const currentFileId = fileMatch ? fileMatch[1] : (settings.googleSheetUrl?.length && !settings.googleSheetUrl.includes('/') ? settings.googleSheetUrl : '');

  // Helper to generate smart invite link
  const getInviteLink = (memberEmail?: string) => {
    if (!currentFileId) return '';
    const workspaceName = settings.googleSheetName || 'Sổ Tiết Kiệm Gia Đình';
    const adminName = currentUser?.name || 'Admin';
    return `https://tuanta3012.github.io/sotietkiem/connect.html?fileId=${encodeURIComponent(currentFileId)}&workspaceName=${encodeURIComponent(workspaceName)}&adminName=${encodeURIComponent(adminName)}`;
  };

  const handleCopyInviteLink = (memberId: string, memberEmail?: string) => {
    const link = getInviteLink(memberEmail);
    if (!link) {
      setErrorMsg('Chưa có file Google Drive để tạo link mời.');
      return;
    }
    navigator.clipboard.writeText(link).then(() => {
      setCopiedMemberId(memberId);
      setSuccessMsg(`Đã sao chép link mời! Bạn có thể dán gửi qua Zalo/Tin nhắn.`);
      setTimeout(() => {
        setCopiedMemberId(null);
        setSuccessMsg(null);
      }, 3000);
    }).catch(() => {
      setErrorMsg('Không thể sao chép vào bộ nhớ tạm.');
    });
  };

  const handleSaveWebhook = () => {
    if (onUpdateSettings) {
      onUpdateSettings({ inviteWebhookUrl: webhookUrlInput.trim() });
    }
    setSuccessMsg('Đã lưu cấu hình Webhook gửi email.');
    setShowWebhookConfig(false);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  const handleSendEmailToExistingMember = async (member: WorkspaceMember) => {
    const webhook = settings.inviteWebhookUrl || webhookUrlInput;
    if (!webhook || !webhook.trim()) {
      setShowWebhookConfig(true);
      setErrorMsg('Vui lòng nhập Webhook URL của Google Apps Script trước.');
      return;
    }
    if (!currentFileId) {
      setErrorMsg('Không tìm thấy File ID Google Drive.');
      return;
    }

    setSendingEmailMemberId(member.id);
    setErrorMsg(null);
    try {
      const res = await sendInviteEmail(
        webhook,
        member.email,
        currentFileId,
        settings.googleSheetName || 'Sổ Tiết Kiệm Gia Đình',
        currentUser?.name || 'Admin',
        member.role
      );
      setSuccessMsg(`Đã gửi email lời mời tới ${member.email}!`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg('Lỗi gửi email: ' + (err?.message || err));
    } finally {
      setSendingEmailMemberId(null);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasLinkedDriveFile) {
      setErrorMsg('Vui lòng kết nối hoặc tạo file Google Drive trước khi thêm thành viên.');
      return;
    }
    if (!newName.trim() || !newEmail.trim()) {
      setErrorMsg('Vui lòng nhập tên và Gmail thành viên.');
      return;
    }

    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMsg('Địa chỉ Gmail không hợp lệ.');
      return;
    }

    if (members.some((m) => m.email.toLowerCase() === cleanEmail)) {
      setErrorMsg('Email đã tồn tại trong danh sách.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const newMember: WorkspaceMember = {
      id: `member-${Date.now()}`,
      email: cleanEmail,
      name: newName.trim(),
      role: newRole,
      addedAt: new Date().toISOString(),
      addedBy: currentUser?.email || 'Admin',
    };

    const updated = [...members, newMember];
    try {
      await onSaveMembers(updated);
      setMembers(updated);
      setNewName('');
      setNewEmail('');

      let emailNotice = '';
      const webhook = settings.inviteWebhookUrl || webhookUrlInput;
      if (autoSendEmail && webhook && webhook.trim() && currentFileId) {
        try {
          await sendInviteEmail(
            webhook,
            cleanEmail,
            currentFileId,
            settings.googleSheetName || 'Sổ Tiết Kiệm Gia Đình',
            currentUser?.name || 'Admin',
            newRole
          );
          emailNotice = ' & Đã gửi email mời';
        } catch (mailErr) {
          console.warn('Lỗi gửi email mời tự động:', mailErr);
        }
      }

      setSuccessMsg(`Đã thêm thành viên ${cleanEmail}${emailNotice}!`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err) {
      setErrorMsg('Lỗi khi lưu thành viên.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (memberId: string, targetRole: UserRole) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const updated = members.map((m) => (m.id === memberId ? { ...m, role: targetRole } : m));

    try {
      setMembers(updated);
      await onSaveMembers(updated);
      setSuccessMsg('Đã cập nhật quyền.');
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (err) {
      setErrorMsg('Không thể cập nhật quyền.');
    }
  };

  const handleRemoveMember = async (memberId: string, memberEmail: string) => {
    if (!window.confirm(`Thu hồi quyền truy cập của ${memberEmail}?`)) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const updated = members.filter((m) => m.id !== memberId);
    try {
      setMembers(updated);
      await onSaveMembers(updated);
      setSuccessMsg(`Đã xóa ${memberEmail}`);
      setTimeout(() => setSuccessMsg(null), 2500);
    } catch (err) {
      setErrorMsg('Lỗi khi xóa thành viên.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        
        {/* Compact Header */}
        <div className="bg-slate-900 text-white p-3 sm:p-3.5 flex items-center justify-between border-b border-slate-800 pr-10 relative">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-5 h-5 text-emerald-400 shrink-0" />
            <h2 className="text-sm sm:text-base font-bold tracking-tight text-white truncate">
              Quản lý thành viên
            </h2>
          </div>

          <button
            onClick={onClose}
            className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scroll Content */}
        <div className="p-3 sm:p-4 space-y-3.5 max-h-[82vh] overflow-y-auto text-slate-800">
          
          {/* Account status bar */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 text-xs">
            <div className="truncate min-w-0 font-medium text-slate-700">
              <span className="text-slate-400 mr-1">Tài khoản:</span>
              <span className="font-semibold text-slate-900 truncate">{currentUser?.email || 'Chưa đăng nhập'}</span>
            </div>
            <div className="shrink-0">
              {currentRole === 'ADMIN' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  <Crown className="w-3 h-3 text-amber-600" />
                  Admin
                </span>
              )}
              {currentRole === 'EDITOR' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                  <Edit3 className="w-3 h-3 text-blue-600" />
                  Sửa
                </span>
              )}
              {currentRole === 'VIEWER' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <Eye className="w-3 h-3 text-emerald-600" />
                  Xem
                </span>
              )}
            </div>
          </div>

          {/* Feedback messages */}
          {successMsg && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-1.5 animate-in fade-in">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form Thêm Thành Viên (Dành cho ADMIN) */}
          {!hasLinkedDriveFile ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <CloudOff className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Chưa liên kết file Google Drive</span>
              </div>
              <p className="text-amber-800 leading-relaxed text-[11px]">
                Ứng dụng chưa kết nối với file Google Sheet nào trên Google Drive. Để thêm và cấp quyền cho các thành viên gia đình, bạn cần kết nối hoặc tạo mới một file Google Sheet trước.
              </p>
              {onOpenSyncModal && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSyncModal();
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-xs"
                >
                  <FolderSync className="w-4 h-4" />
                  <span>Kết nối hoặc Tạo file Google Drive ngay</span>
                </button>
              )}
            </div>
          ) : isAdmin ? (
            <form onSubmit={handleAddMember} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                <span>Thêm thành viên mới</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <input
                    type="text"
                    placeholder="Tên (Ví dụ: Vợ, Con...)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>

                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="email"
                    placeholder="Gmail Google"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    required
                  />
                </div>
              </div>

              {/* Roles Compact Pill Selector */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewRole('VIEWER')}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                    newRole === 'VIEWER'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>👁️ Chỉ xem</span>
                </button>

                <button
                  type="button"
                  onClick={() => setNewRole('EDITOR')}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                    newRole === 'EDITOR'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5 shrink-0" />
                  <span>✏️ Được sửa</span>
                </button>
              </div>

              {/* Auto send email checkbox */}
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoSendEmail}
                  onChange={(e) => setAutoSendEmail(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5"
                />
                <span>Tự động gửi email mời qua Google Apps Script Webhook</span>
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Đang lưu...' : 'Thêm & Cấp quyền'}</span>
              </button>
            </form>
          ) : (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs">
              Bạn ở vai trò <strong>{currentRole === 'EDITOR' ? 'Quyền sửa' : 'Chỉ xem'}</strong>. Chỉ tài khoản <strong>Admin</strong> mới có quyền thêm/chỉnh thành viên.
            </div>
          )}

          {/* Webhook Configuration Accordion (For Admin) */}
          {isAdmin && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
              <button
                type="button"
                onClick={() => setShowWebhookConfig(!showWebhookConfig)}
                className="w-full p-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-100/80 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-slate-500" />
                  <span>Cấu hình Webhook Gửi Email (Google Apps Script)</span>
                </div>
                <span className="text-[10px] text-emerald-600 font-bold">
                  {settings.inviteWebhookUrl ? 'Đã cấu hình' : 'Tùy chọn'}
                </span>
              </button>

              {showWebhookConfig && (
                <div className="p-2.5 pt-0 border-t border-slate-200/60 space-y-2 mt-1 bg-white">
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Dán URL Web App triển khai từ Google Apps Script (file <code className="text-emerald-600 font-mono">Code.gs</code>) để hệ thống tự động gửi email HTML lời mời.
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      type="url"
                      placeholder="https://script.google.com/macros/s/.../exec"
                      value={webhookUrlInput}
                      onChange={(e) => setWebhookUrlInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveWebhook}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
                    >
                      Lưu
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div>
            <div className="text-xs font-bold text-slate-800 flex items-center justify-between gap-1.5 mb-2">
              <div className="flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Thành viên ({members.length})</span>
              </div>
              {hasLinkedDriveFile && (
                <span className="text-[10px] text-slate-400 font-normal">
                  Nhấp vào 📋 để sao chép link mời
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              {members.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  Chưa có thành viên nào.
                </div>
              ) : (
                members.map((member) => {
                  const isSelf = currentUser?.email && member.email.toLowerCase() === currentUser.email.toLowerCase();
                  const isOwner = member.role === 'ADMIN';
                  const isCopied = copiedMemberId === member.id;
                  const isSendingMail = sendingEmailMemberId === member.id;

                  return (
                    <div
                      key={member.id}
                      className="p-2 sm:p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            member.role === 'ADMIN'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : member.role === 'EDITOR'
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          }`}
                        >
                          {member.name ? member.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-slate-800 truncate max-w-[90px] sm:max-w-[120px]">
                              {member.name}
                            </span>
                            {isSelf && (
                              <span className="text-[9px] bg-slate-100 text-slate-600 px-1 py-0.2 rounded font-semibold shrink-0">
                                Bạn
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate max-w-[110px] sm:max-w-[150px]">
                            {member.email}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Copy Invite Link Action */}
                        {!isSelf && hasLinkedDriveFile && (
                          <button
                            type="button"
                            onClick={() => handleCopyInviteLink(member.id, member.email)}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                            title="Sao chép liên kết mời để gửi qua Zalo/Tin nhắn"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Send/Resend Email Action */}
                        {!isSelf && hasLinkedDriveFile && (
                          <button
                            type="button"
                            onClick={() => handleSendEmailToExistingMember(member)}
                            disabled={isSendingMail}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-40"
                            title="Gửi email lời mời qua Webhook"
                          >
                            <Send className={`w-3.5 h-3.5 ${isSendingMail ? 'animate-pulse text-blue-600' : ''}`} />
                          </button>
                        )}

                        {isAdmin && !isOwner ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={member.role}
                              onChange={(e) => handleRoleChange(member.id, e.target.value as UserRole)}
                              className="text-[11px] py-1 px-1.5 bg-slate-100 border border-slate-200 rounded-md font-semibold text-slate-700 outline-none"
                            >
                              <option value="VIEWER">👁️ Xem</option>
                              <option value="EDITOR">✏️ Sửa</option>
                              <option value="ADMIN">👑 Admin</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => handleRemoveMember(member.id, member.email)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                              title="Thu hồi quyền"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              member.role === 'ADMIN'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : member.role === 'EDITOR'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {member.role === 'ADMIN' ? '👑 Admin' : member.role === 'EDITOR' ? '✏️ Sửa' : '👁️ Xem'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Autonomy / Leave Workspace Option */}
          {onLeaveWorkspace && (
            <div className="pt-2 border-t border-slate-100">
              {!showLeaveConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowLeaveConfirm(true)}
                  className="w-full py-1.5 px-2 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Rời không gian (Tự tạo sổ riêng)</span>
                </button>
              ) : (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-2 text-rose-900 animate-in fade-in">
                  <div className="font-bold flex items-center gap-1">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Xác nhận rời không gian chia sẻ?</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Ứng dụng sẽ ngắt liên kết và đưa bạn về Không gian cá nhân riêng biệt.
                  </p>
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setShowLeaveConfirm(false)}
                      className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded-md font-semibold text-xs"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLeaveConfirm(false);
                        onLeaveWorkspace();
                        onClose();
                      }}
                      className="px-2.5 py-1 bg-rose-600 text-white rounded-md font-bold text-xs"
                    >
                      Xác nhận rời
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 transition-colors"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
};
