import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  Landmark,
  User,
  Filter,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  Cloud,
} from 'lucide-react';
import { SavingsBook, AppSettings } from '../types';
import { getBankById } from '../data/banks';
import {
  formatVND,
  formatShortVND,
  formatDateVN,
  formatRelativeDays,
  getOwnerLabel,
  getOwnerBadgeStyle,
} from '../utils/formatters';
import { calculateInterest, getDaysBetween } from '../utils/calculator';
import { getBankTagForBook } from '../utils/dataTranslator';
import { CustomSelect } from './CustomSelect';

interface TimelineViewProps {
  books: SavingsBook[];
  currentDateStr: string;
  settings: AppSettings;
  onSelectForAnalysis: (book: SavingsBook) => void;
  onOpenSyncModal?: () => void;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  books,
  currentDateStr,
  settings,
  onSelectForAnalysis,
  onOpenSyncModal,
}) => {
  const [filterOwner, setFilterOwner] = useState<string>('all');

  const uniqueOwnerTags = useMemo(() => {
    const list: string[] = [];
    books.forEach((b) => {
      if (b.owner) {
        const lbl = getOwnerLabel(b.owner);
        if (!list.includes(lbl)) {
          list.push(lbl);
        }
      }
    });
    return list;
  }, [books]);

  const activeBooks = useMemo(() => {
    return books.filter((b) => {
      if (b.status !== 'active') return false;
      if (filterOwner !== 'all' && getOwnerLabel(b.owner) !== filterOwner && b.owner !== filterOwner) return false;
      return true;
    });
  }, [books, filterOwner]);

  // Group books by maturity month (YYYY-MM)
  const monthlyGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        monthLabel: string;
        yearMonth: string;
        books: SavingsBook[];
        totalPrincipal: number;
        totalInterest: number;
      }
    >();

    // Sort books by maturity date
    const sorted = [...activeBooks].sort((a, b) =>
      a.maturityDate.localeCompare(b.maturityDate)
    );

    for (const book of sorted) {
      const [year, month] = book.maturityDate.split('-');
      const yearMonth = `${year}-${month}`;
      const monthLabel = `Tháng ${parseInt(month, 10)}/${year}`;

      const totalDays = Math.max(1, getDaysBetween(book.startDate, book.maturityDate));
      const interest = calculateInterest(book.principal, book.interestRate, totalDays);

      if (!map.has(yearMonth)) {
        map.set(yearMonth, {
          monthLabel,
          yearMonth,
          books: [],
          totalPrincipal: 0,
          totalInterest: 0,
        });
      }

      const group = map.get(yearMonth)!;
      group.books.push(book);
      group.totalPrincipal += book.principal;
      group.totalInterest += interest;
    }

    return Array.from(map.values()).sort((a, b) =>
      a.yearMonth.localeCompare(b.yearMonth)
    );
  }, [activeBooks]);

  if (books.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center shadow-xs space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto border border-teal-200">
          <Calendar className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          <h3 className="text-lg font-bold text-slate-900">
            Chưa Có Lịch Đáo Hạn Sổ Tiết Kiệm
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Dữ liệu trên ứng dụng đã được dọn sạch hoàn toàn sau khi hủy liên kết. Hãy mở cửa sổ Google Drive để kết nối lại dữ liệu của bạn.
          </p>
        </div>
        {onOpenSyncModal && (
          <button
            onClick={onOpenSyncModal}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all active:scale-95"
          >
            <Cloud className="w-4 h-4" />
            <span>Mở Cửa Sổ Đồng Bộ Google Drive</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-teal-600" />
            Lịch Đáo Hạn Gối Đầu &amp; Dự Báo Dòng Tiền
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Theo dõi các khoản tiền gửi đáo hạn so le theo từng tháng, giúp gia đình chủ động dòng tiền tái tục hoặc chi dùng.
          </p>
        </div>

        {/* Filter by Owner */}
        <div className="flex items-center space-x-2 text-xs shrink-0 min-w-[180px]">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="text-slate-500 font-medium shrink-0">Chủ sở hữu:</span>
          <CustomSelect
            value={filterOwner}
            onChange={(val) => setFilterOwner(String(val))}
            options={[
              { value: 'all', label: `Tất cả (${books.length} sổ)` },
              ...uniqueOwnerTags.map((tag) => ({
                value: tag,
                label: `${tag} (${books.filter((b) => getOwnerLabel(b.owner) === tag).length} sổ)`,
              })),
            ]}
            size="sm"
          />
        </div>
      </div>

      {/* Visual Bar Chart: Monthly Maturing Principal & Interest */}
      {monthlyGroups.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center">
                <BarChart3 className="w-4 h-4 text-teal-600 mr-2" />
                Biểu Đồ Dòng Tiền Đáo Hạn Từng Tháng (Gốc &amp; Lãi)
              </h3>
              <p className="text-xs text-slate-500">
                Đơn vị: Triệu VNĐ &bull; Hiển thị dòng tiền hồi về theo lịch gối đầu liên tiếp
              </p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <span className="flex items-center text-slate-700">
                <span className="w-3 h-3 bg-teal-600 rounded mr-1.5"></span> Gốc
              </span>
              <span className="flex items-center text-slate-700">
                <span className="w-3 h-3 bg-amber-500 rounded mr-1.5"></span> Lãi
              </span>
            </div>
          </div>

          <div className="h-64 w-full pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthlyGroups.map((g) => ({
                  monthLabel: g.monthLabel.replace('Tháng ', 'T'),
                  principalMillion: Math.round(g.totalPrincipal / 1_000_000),
                  interestMillion: Math.round(g.totalInterest / 1_000_000),
                  totalMillion: Math.round((g.totalPrincipal + g.totalInterest) / 1_000_000),
                }))}
                margin={{ top: 15, right: 15, left: 0, bottom: 15 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(1)}T`}
                />
                <Tooltip
                  formatter={(val: any, name: any) => [
                    `${Number(val).toLocaleString('vi-VN')} Tr VNĐ`,
                    name === 'principalMillion' ? 'Tiền Gốc' : 'Tiền Lãi',
                  ]}
                  labelFormatter={(label) => `Đáo hạn: ${label}`}
                  contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                />
                <Bar dataKey="principalMillion" name="principalMillion" stackId="a" fill="#0d9488" />
                <Bar dataKey="interestMillion" name="interestMillion" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Monthly Timeline Cards */}
      <div className="space-y-6">
        {monthlyGroups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 text-sm">
            Không có sổ tiết kiệm nào phù hợp với bộ lọc.
          </div>
        ) : (
          monthlyGroups.map((group) => {
            return (
              <div
                key={group.yearMonth}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden"
              >
                {/* Month Group Header */}
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-3">
                    <div className="px-3 py-1 bg-teal-600 text-white rounded-lg text-xs font-bold shadow-xs">
                      {group.monthLabel}
                    </div>
                    <span className="text-xs text-slate-500 font-medium">
                      ({group.books.length} sổ đáo hạn)
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 text-xs">
                    <div>
                      <span className="text-slate-400">Gốc về: </span>
                      <strong className="text-slate-800 font-semibold">
                        {formatVND(group.totalPrincipal, settings.privacyMode)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Lãi thu về: </span>
                      <strong className="text-emerald-600 font-bold">
                        +{formatVND(group.totalInterest, settings.privacyMode)}
                      </strong>
                    </div>
                    <div className="pl-2 border-l border-slate-200 font-bold text-slate-900">
                      Tổng tiền về:{' '}
                      <span className="text-teal-700">
                        {formatVND(group.totalPrincipal + group.totalInterest, settings.privacyMode)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Books in this Month */}
                <div className="p-4 divide-y divide-slate-100">
                  {group.books.map((book) => {
                    const bank = getBankById(book.bankId);
                    const daysRemaining = getDaysBetween(currentDateStr, book.maturityDate);
                    const isMatured = daysRemaining <= 0;
                    const totalDays = Math.max(1, getDaysBetween(book.startDate, book.maturityDate));
                    const interest = calculateInterest(book.principal, book.interestRate, totalDays);

                    return (
                      <div
                        key={book.id}
                        className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/70 px-2 rounded-xl transition-colors"
                      >
                        {/* Book identity */}
                        <div className="flex items-center space-x-3">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-xs"
                            style={{ backgroundColor: bank.primaryColor, color: bank.textColor }}
                          >
                            {getBankTagForBook(book.bankId, book.owner, bank.code)}
                          </div>

                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900 text-sm">
                                {bank.shortName}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-md font-bold border shadow-2xs ${
                                  getOwnerBadgeStyle(book.owner).badgeClass
                                }`}
                              >
                                {getOwnerLabel(book.owner)}
                              </span>
                              {book.tag && (
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                  {book.tag}
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-500 mt-0.5 flex items-center space-x-2">
                              <span>Kỳ hạn {book.termMonths}T ({book.interestRate}%/năm)</span>
                              <span>&bull;</span>
                              <span>Ngày đáo hạn: <strong className="text-slate-700">{formatDateVN(book.maturityDate)}</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* Financial figures */}
                        <div className="flex items-center justify-between md:justify-end space-x-6 text-xs pl-12 md:pl-0">
                          <div>
                            <span className="text-slate-400 block text-[10px]">Tiền gốc</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {formatVND(book.principal, settings.privacyMode)}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 block text-[10px]">Tiền lãi cả kỳ</span>
                            <span className="font-semibold text-emerald-600 text-sm">
                              +{formatVND(interest, settings.privacyMode)}
                            </span>
                          </div>

                          <div>
                            <span className="text-slate-400 block text-[10px]">Thời gian</span>
                            <span className={`font-semibold ${isMatured ? 'text-emerald-700' : 'text-slate-700'}`}>
                              {formatRelativeDays(daysRemaining)}
                            </span>
                          </div>

                          <button
                            onClick={() => onSelectForAnalysis(book)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="So sánh vay cầm cố sổ này"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
