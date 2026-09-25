import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellRing,
  AlertTriangle,
  Calendar,
  X,
  ChevronRight,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';
import { SavingsBook } from '../types';
import {
  getUpcomingMaturityBooks,
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendMaturityBrowserNotification,
  UpcomingMaturityItem,
} from '../utils/notificationService';
import { formatShortVND, formatDateVN, formatRelativeDays } from '../utils/formatters';

interface MaturityReminderAlertProps {
  books: SavingsBook[];
  privacyMode: boolean;
  onSelectBook?: (book: SavingsBook) => void;
  husbandName?: string;
  wifeName?: string;
}

export const MaturityReminderAlert: React.FC<MaturityReminderAlertProps> = ({
  books,
  privacyMode,
  onSelectBook,
  husbandName,
  wifeName,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [justSentTest, setJustSentTest] = useState(false);

  const upcomingItems: UpcomingMaturityItem[] = React.useMemo(() => {
    return getUpcomingMaturityBooks(books, 7);
  }, [books]);

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  if (upcomingItems.length === 0 || isDismissed) {
    return null;
  }

  const totalUpcomingAmount = upcomingItems.reduce((sum, i) => sum + i.book.principal, 0);

  const handleEnableNotification = async () => {
    const granted = await requestNotificationPermission();
    const currentPerm = getNotificationPermission();
    setPermission(currentPerm);
    if (granted) {
      sendMaturityBrowserNotification(books, {
        withinDays: 7,
        privacyMode,
        husbandName,
        wifeName,
      });
      setJustSentTest(true);
      setTimeout(() => setJustSentTest(false), 4000);
    }
  };

  const handleSendTestNotification = () => {
    if (permission === 'granted') {
      sendMaturityBrowserNotification(books, {
        withinDays: 7,
        privacyMode,
        husbandName,
        wifeName,
      });
      setJustSentTest(true);
      setTimeout(() => setJustSentTest(false), 4000);
    } else {
      handleEnableNotification();
    }
  };

  return (
    <div
      id="maturity-reminder-banner"
      className="mb-4 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/5 border border-amber-400/40 rounded-2xl p-3 sm:p-4 shadow-sm backdrop-blur-xs animate-in fade-in slide-in-from-top-2 duration-300 relative overflow-hidden"
    >
      {/* Decorative background glow */}
      <div className="absolute -top-12 -right-12 w-36 h-36 bg-amber-400/15 rounded-full blur-2xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 relative z-10">
        {/* Left icon & summary message */}
        <div className="flex items-start space-x-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-600 shadow-xs">
            <BellRing className="w-5 h-5 animate-bounce" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center space-x-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-slate-950 uppercase tracking-wider">
                Nhắc nhở kỳ hạn 7 ngày
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-900">
                Có {upcomingItems.length} sổ tiết kiệm sắp đến hạn ({formatShortVND(totalUpcomingAmount, privacyMode)})
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Các sổ dưới đây cần chuẩn bị kế hoạch tất toán hoặc tái tục gối đầu:
            </p>

            {/* List of upcoming book chips */}
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {upcomingItems.map((item) => {
                const isDueToday = item.daysRemaining === 0;
                const isDueTomorrow = item.daysRemaining === 1;

                return (
                  <button
                    key={item.book.id}
                    onClick={() => onSelectBook?.(item.book)}
                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white hover:bg-amber-50 border border-amber-300 text-slate-800 transition-all hover:border-amber-500 shadow-2xs group cursor-pointer"
                    title="Bấm để xem chi tiết sổ"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.bank.primaryColor }}
                    />
                    <strong className="font-semibold text-slate-900">{item.bank.shortName}</strong>
                    <span className="text-slate-500">
                      • {formatShortVND(item.book.principal, privacyMode)}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${
                        isDueToday
                          ? 'bg-rose-100 text-rose-700'
                          : isDueTomorrow
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-orange-50 text-orange-700'
                      }`}
                    >
                      {formatRelativeDays(item.daysRemaining)}
                    </span>
                    <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-amber-600 transition-colors" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right action buttons: Browser notification toggle & dismiss */}
        <div className="flex items-center space-x-2 self-end sm:self-start shrink-0 pt-1 sm:pt-0">
          {isNotificationSupported() && (
            <>
              {permission === 'granted' ? (
                <button
                  onClick={handleSendTestNotification}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-white/90 hover:bg-white text-emerald-700 text-xs font-bold rounded-xl border border-emerald-300 shadow-2xs transition-all hover:shadow-xs cursor-pointer"
                  title="Thông báo trình duyệt đã sẵn sàng. Bấm để gửi lại thông báo nhắc nhở."
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{justSentTest ? 'Đã gửi thông báo!' : 'Đã bật thông báo'}</span>
                </button>
              ) : (
                <button
                  onClick={handleEnableNotification}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer hover:shadow-sm"
                  title="Cho phép trình duyệt gửi thông báo đẩy khi có sổ đến hạn"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Bật thông báo trình duyệt</span>
                </button>
              )}
            </>
          )}

          {/* Dismiss button */}
          <button
            onClick={() => setIsDismissed(true)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
            title="Ẩn thông báo này trong phiên hiện tại"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
