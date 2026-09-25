import React, { useState } from 'react';
import { RefreshCw, CheckCircle, ShieldAlert, Cloud } from 'lucide-react';

interface DriveTokenExpiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRenewToken: () => Promise<void>;
  isReconnecting?: boolean;
}

export const DriveTokenExpiredModal: React.FC<DriveTokenExpiredModalProps> = ({
  isOpen,
  onClose,
  onRenewToken,
  isReconnecting = true,
}) => {
  const [isRenewing, setIsRenewing] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsRenewing(true);
    try {
      await onRenewToken();
      onClose();
    } catch (err) {
      console.warn('Failed to renew token from modal:', err);
    } finally {
      setIsRenewing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-slate-950/60 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-[270px] rounded-2xl shadow-xl border border-emerald-100 overflow-hidden animate-in zoom-in-95 duration-200 text-slate-800">
        {/* Header Icon Compact */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-3 text-center text-white relative">
          <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mx-auto mb-1 border border-white/30 shadow-inner">
            <Cloud className="w-4 h-4 text-white" />
          </div>
          <h3 className="font-bold text-xs text-white leading-tight">Đồng bộ Google Drive</h3>
        </div>

        {/* Content Body Compact */}
        <div className="p-3 text-center space-y-2">
          <p className="text-[11.5px] text-slate-700 leading-snug font-medium">
            Duy trì kết nối Google Drive để dữ liệu luôn đồng bộ an toàn!
          </p>

          {/* Alert Callout Compact */}
          <div className="p-2 bg-amber-50 border border-amber-200/80 rounded-lg flex items-start space-x-1.5 text-left">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-[10px] text-amber-800 font-medium leading-tight">
              Phiên kết nối đã hết hạn (60 phút). Bấm kết nối lại để tiếp tục đồng bộ.
            </span>
          </div>
        </div>

        {/* Action Buttons Compact */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-100 flex items-center space-x-1.5">
          <button
            type="button"
            disabled={isRenewing}
            onClick={onClose}
            className="flex-1 py-1.5 px-2 rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 font-medium text-[11px] transition-all cursor-pointer disabled:opacity-50"
          >
            Để sau
          </button>
          <button
            type="button"
            disabled={isRenewing}
            onClick={handleConfirm}
            className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-semibold text-[11px] shadow-sm shadow-emerald-600/20 transition-all flex items-center justify-center space-x-1 cursor-pointer disabled:opacity-50"
          >
            {isRenewing ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3 h-3" />
                <span>Kết nối lại</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
