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
} from 'lucide-react';
import { AppSettings, AuthUser, WorkspaceMember, UserRole, canManageMembers } from '../types';
import { getGoogleAccessToken, ensureGoogleAccessToken, getLocalMasterPointerFileId, revokeFilePermission } from '../utils/googleDriveService';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  settings: AppSettings;
  onSaveMembers: (updatedMembers: WorkspaceMember[]) => Promise<void>;
  onLeaveWorkspace?: () => void;
  onOpenSyncModal?: () => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  settings,
  onSaveMembers,
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
    return settings.members || [];
  });

  React.useEffect(() => {
    setMembers((prev) => {
      const incoming = settings.members || [];
      const prevStr = JSON.stringify(prev);
      const nextStr = JSON.stringify(incoming);
      return prevStr === nextStr ? prev : incoming;
    });
  }, [settings.members]);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('VIEWER');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddedSuccess, setIsAddedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; email: string; name?: string } | null>(null);

  const hasLinkedDriveFile = Boolean(settings.googleSheetUrl && settings.googleSheetUrl.trim().length > 0);

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasLinkedDriveFile) {
      setErrorMsg('Vui lòng kết nối hoặc tạo file Google Drive trước khi thêm thành viên.');
      return;
    }
    if (!newName.trim() || !newEmail.trim()) {
      setErrorMsg('Vui lòng nhập tên và Gmail thành viên.');
      return;
    }

    let cleanEmail = newEmail.trim().toLowerCase();
    
    // Auto-append @gmail.com if it's just a username
    if (cleanEmail && !cleanEmail.includes('@')) {
      cleanEmail = `${cleanEmail}@gmail.com`;
    }

    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMsg('Địa chỉ Gmail không hợp lệ.');
      return;
    }

    const effectiveAdmin = ownerEmail || (isAdmin ? userEmail : '');
    if (cleanEmail === userEmail || cleanEmail === ownerEmail || (effectiveAdmin && cleanEmail === effectiveAdmin)) {
      setErrorMsg('Tài khoản này là Admin của sổ, không cần thêm vào danh sách chia sẻ.');
      return;
    }

    if (members.some((m) => m.email.toLowerCase() === cleanEmail)) {
      setErrorMsg('Email này đã tồn tại trong danh sách thành viên.');
      return;
    }

    setErrorMsg(null);

    const newMember: WorkspaceMember = {
      id: `member-${Date.now()}`,
      email: cleanEmail,
      name: newName.trim(),
      role: newRole,
      addedAt: new Date().toISOString(),
      addedBy: currentUser?.email || 'Admin',
    };

    const updated = [...members.filter((m) => m.email.toLowerCase() !== cleanEmail), newMember];
    
    // Cập nhật giao diện ngay lập tức cho UX siêu mượt mà
    setMembers(updated);
    setNewName('');
    setNewEmail('');

    // Xử lý ngầm ở phía dưới đảm bảo chắc chắn thực thi kèm cơ chế tự động thử lại (retry)
    onSaveMembers(updated).catch((err: any) => {
      console.warn('Background member save failed, retrying:', err);
      onSaveMembers(updated).catch((retryErr) => {
        console.error('Background member save retry failed:', retryErr);
      });
    });
  };

  const handleRoleChange = (memberId: string, targetRole: UserRole) => {
    setErrorMsg(null);
    const updated = members.map((m) => (m.id === memberId ? { ...m, role: targetRole } : m));
    setMembers(updated);
    onSaveMembers(updated).catch((err) => {
      console.warn('Background role update failed, retrying:', err);
      onSaveMembers(updated).catch(() => {});
    });
  };

  const executeRemoveMember = async (memberId: string, memberEmail: string) => {
    setErrorMsg(null);
    const updated = members.filter((m) => m.id !== memberId);
    setMembers(updated);

    try {
      let token = getGoogleAccessToken();
      if (!token) {
        token = await ensureGoogleAccessToken().catch(() => null);
      }
      const fileMatch = settings.googleSheetUrl?.match(/\/d\/([a-zA-Z0-9-_]+)/) || settings.googleSheetUrl?.match(/id=([a-zA-Z0-9-_]+)/);
      const fileId = fileMatch ? fileMatch[1] : (settings.googleSheetUrl && settings.googleSheetUrl.length > 20 && !settings.googleSheetUrl.includes('/') ? settings.googleSheetUrl : getLocalMasterPointerFileId());
      if (token && fileId && memberEmail) {
        // Import dynamic to avoid circular dependencies if necessary
        const { synchronizeDrivePermissionsWithJsonMembers } = await import('../utils/googleDriveService');
        
        await revokeFilePermission(token, fileId, memberEmail).catch(() => {});
        
        // Cập nhật lại quyền trên Drive sau khi xóa để đảm bảo đồng bộ
        await synchronizeDrivePermissionsWithJsonMembers(
          token,
          fileId,
          updated,
          settings.workspaceOwnerEmail || currentUser?.email
        );
      }
    } catch (revokeErr) {
      console.warn('Direct revoke permission warning:', revokeErr);
    }

    onSaveMembers(updated).catch((err) => {
      console.warn('Background remove member failed, retrying:', err);
      onSaveMembers(updated).catch((retryErr) => {
        console.error('Background remove member retry failed:', retryErr);
        setErrorMsg('Không thể đồng bộ việc xóa thành viên lên Google Drive.');
      });
    });
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
          
          {/* Feedback messages */}
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
                    type="text"
                    placeholder="Gmail hoặc Username"
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

              <button
                type="submit"
                className="w-full py-2 px-3 rounded-lg font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Thêm & Cấp quyền</span>
              </button>
            </form>
          ) : (
            <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs">
              Bạn ở vai trò <strong>{currentRole === 'EDITOR' ? 'Quyền sửa' : 'Chỉ xem'}</strong>. Chỉ tài khoản <strong>Admin</strong> mới có quyền thêm/chỉnh thành viên.
            </div>
          )}

          {/* Members List (Hiển thị đầy đủ cả Admin và các thành viên được chia sẻ) */}
          <div>
            {(() => {
              const effectiveAdminEmail = (ownerEmail || userEmail || '').trim().toLowerCase();
              let list = [...members];
              const hasAdmin = list.some((m) => {
                const mRole = String(m.role || '').toUpperCase();
                const mEmail = (m.email || '').trim().toLowerCase();
                return mRole === 'ADMIN' || (effectiveAdminEmail && mEmail === effectiveAdminEmail);
              });

              if (!hasAdmin && effectiveAdminEmail) {
                list.push({
                  id: 'owner-admin-member',
                  email: effectiveAdminEmail,
                  name: currentUser?.name || 'Admin',
                  role: 'ADMIN',
                  addedAt: new Date().toISOString(),
                });
              }

              list.sort((a, b) => {
                const aRole = String(a.role || '').toUpperCase();
                const bRole = String(b.role || '').toUpperCase();
                const aEmail = (a.email || '').trim().toLowerCase();
                const bEmail = (b.email || '').trim().toLowerCase();
                const aAdmin = aRole === 'ADMIN' || (effectiveAdminEmail && aEmail === effectiveAdminEmail);
                const bAdmin = bRole === 'ADMIN' || (effectiveAdminEmail && bEmail === effectiveAdminEmail);

                if (aAdmin && !bAdmin) return -1;
                if (!aAdmin && bAdmin) return 1;

                const timeA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
                const timeB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
                return timeB - timeA;
              });

              return (
                <>
                  <div className="text-xs font-bold text-slate-800 flex items-center justify-between gap-1.5 mb-2">
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Thành viên ({list.length})</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {list.length === 0 ? (
                      <div className="text-center py-4 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        Chưa có thành viên nào.
                      </div>
                    ) : (
                      list.map((member) => {
                        const mRole = String(member.role || '').toUpperCase();
                        const mEmail = (member.email || '').trim().toLowerCase();
                        const isThisAdmin = mRole === 'ADMIN' || (effectiveAdminEmail && mEmail === effectiveAdminEmail);
                        const isSelf = userEmail && mEmail === userEmail;

                        return (
                          <div
                            key={member.id}
                            className={`p-2 sm:p-2.5 bg-white border rounded-xl flex items-center justify-between gap-2 shadow-2xs ${
                              isThisAdmin ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                  isThisAdmin
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : member.role === 'EDITOR'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                    : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                }`}
                              >
                                {isThisAdmin ? <Crown className="w-3.5 h-3.5 text-amber-600" /> : (member.name ? member.name.charAt(0).toUpperCase() : 'U')}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-800 truncate max-w-[100px] sm:max-w-[130px]">
                                    {member.name}
                                  </span>
                                  {isSelf && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                      Bạn
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[130px] sm:max-w-[160px]">
                                  {member.email}
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0">
                              {isThisAdmin ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                                  <Crown className="w-3 h-3 text-amber-600" />
                                  Admin
                                </span>
                              ) : isAdmin ? (
                                <div className="flex items-center gap-1">
                                  <select
                                    value={member.role}
                                    onChange={(e) => handleRoleChange(member.id, e.target.value as UserRole)}
                                    className="text-[11px] py-1 px-1.5 bg-slate-100 border border-slate-200 rounded-md font-semibold text-slate-700 outline-none"
                                  >
                                    <option value="VIEWER">👁️ Xem</option>
                                    <option value="EDITOR">✏️ Sửa</option>
                                  </select>

                                  <button
                                    type="button"
                                    onClick={() => setMemberToRemove({ id: member.id, email: member.email, name: member.name })}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                    title="Thu hồi quyền"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    member.role === 'EDITOR'
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}
                                >
                                  {member.role === 'EDITOR' ? '✏️ Sửa' : '👁️ Xem'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
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

      {/* Red Confirmation Modal Popup for Member Removal */}
      {memberToRemove && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
            <div className="p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-slate-900">
                  Xác Nhận Thu Hồi Quyền?
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Bạn có chắc chắn muốn thu hồi quyền truy cập của thành viên <span className="font-semibold text-slate-800">{memberToRemove.name}</span> ({memberToRemove.email}) không?
                </p>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMemberToRemove(null)}
                className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-300 transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { id, email } = memberToRemove;
                  setMemberToRemove(null);
                  await executeRemoveMember(id, email);
                }}
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-all active:scale-98 flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Thu Hồi Quyền</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
