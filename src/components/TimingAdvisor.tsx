import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Sparkles,
  Calendar,
  Clock,
  TrendingDown,
  ArrowRight,
  ShieldCheck,
  Zap,
  Info,
  DollarSign,
  CheckCircle2,
} from 'lucide-react';
import { SavingsBook } from '../types';
import { getBankById } from '../data/banks';
import { formatVND, formatShortVND, formatMillionVND, formatDateVN } from '../utils/formatters';
import { analyzeBookMobilization, getDaysBetween } from '../utils/calculator';
import { DatePickerVN } from './DatePickerVN';

interface TimingAdvisorProps {
  books: SavingsBook[];
  currentDateStr: string;
  targetAmount: number;
  loanMargin: number;
  demandRate: number;
  isVipMode: boolean;
  ltvPercent: number;
  bankMargins: Record<string, number>;
  bankLTVs?: Record<string, number>;
  bankSettlementTypes?: Record<string, 'UPFRONT' | 'MATURITY'>;
  privacyMode: boolean;
  onSelectOptimalDate: (dateStr: string) => void;
}

export interface CandidateDateResult {
  dateStr: string;
  label: string;
  daysFromStart: number;
  freeMaturedCash: number;
  maturedBooksCount: number;
  maturedBooksList: string[];
  optimalCost: number;
  optimalCashRaised: number;
  savingsVsStart: number;
  rationale: string;
}

export const TimingAdvisor: React.FC<TimingAdvisorProps> = ({
  books,
  currentDateStr,
  targetAmount,
  loanMargin,
  demandRate,
  isVipMode,
  ltvPercent,
  bankMargins,
  bankLTVs,
  bankSettlementTypes,
  privacyMode,
  onSelectOptimalDate,
}) => {
  // Time range settings
  const [startDateStr, setStartDateStr] = useState<string>(currentDateStr);
  const [endDateStr, setEndDateStr] = useState<string>(() => {
    // Default 6 months from now
    const d = new Date(currentDateStr);
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  });

  const activeBooks = useMemo(() => books.filter((b) => b.status === 'active'), [books]);

  // Preset quick ranges
  const setQuickRange = (months: number) => {
    const start = new Date(currentDateStr);
    const end = new Date(currentDateStr);
    end.setMonth(end.getMonth() + months);
    setStartDateStr(start.toISOString().slice(0, 10));
    setEndDateStr(end.toISOString().slice(0, 10));
  };

  // Helper to evaluate optimal cost at any given date
  const evaluateDate = (evalDateStr: string): CandidateDateResult => {
    const analyses = activeBooks.map((b) =>
      analyzeBookMobilization(
        b,
        evalDateStr,
        loanMargin,
        demandRate,
        isVipMode ? 1.0 : ltvPercent / 100,
        bankMargins,
        isVipMode,
        true,
        bankLTVs
      )
    );

    // Matured books on or before this date
    const matured = analyses.filter((a) => a.isMatured);
    const freeMaturedCash = matured.reduce((sum, a) => sum + a.cashFromEarlySettlement, 0);
    const maturedBooksList = matured.map((a) => `${getBankById(a.book.bankId).shortName} (${formatShortVND(a.book.principal, false)}đ)`);

    // Scored items
    const scored = analyses
      .map((a) => {
        let cost = 0;
        let cash = 0;
        if (a.isMatured) {
          cost = 0;
          cash = a.cashFromEarlySettlement;
        } else if (a.recommendedAction === 'PLEDGE') {
          cost = a.loanInterestCost;
          const bId = a.projectedBook.bankId;
          const isUpfront = (bankSettlementTypes?.[bId] ?? 'UPFRONT') === 'UPFRONT';
          cash = isUpfront ? a.netCashDisbursedUpfront : a.maxLoanAmount;
        } else {
          cost = a.lossFromEarlySettlement;
          cash = a.cashFromEarlySettlement;
        }
        const costRatio = cash > 0 ? cost / cash : 999;
        return { a, cost, cash, costRatio };
      })
      .sort((x, y) => x.costRatio - y.costRatio);

    let accumulatedCash = 0;
    let totalCost = 0;

    for (const item of scored) {
      if (accumulatedCash < targetAmount) {
        accumulatedCash += item.cash;
        totalCost += item.cost;
      }
    }

    const daysFromStart = getDaysBetween(startDateStr, evalDateStr);
    const [y, m, d] = evalDateStr.split('-');
    const label = `${d}/${m}`;

    let rationale = '';
    if (freeMaturedCash >= targetAmount) {
      rationale = `Tiền mặt từ các sổ đã đáo hạn (${formatShortVND(freeMaturedCash, false)}đ) đã đủ 100% số vốn cần huy động. Chi phí = 0đ!`;
    } else if (freeMaturedCash > 0) {
      rationale = `Đã có sẵn ${formatShortVND(freeMaturedCash, false)}đ tiền mặt tự do, chỉ cần vay/rút thêm ${formatShortVND(targetAmount - freeMaturedCash, false)}đ.`;
    } else {
      rationale = 'Chưa có sổ nào đáo hạn trước ngày này, phải vay thế chấp hoặc tất toán sớm.';
    }

    return {
      dateStr: evalDateStr,
      label,
      daysFromStart,
      freeMaturedCash,
      maturedBooksCount: matured.length,
      maturedBooksList,
      optimalCost: totalCost,
      optimalCashRaised: accumulatedCash,
      savingsVsStart: 0, // Will be computed vs baseline
      rationale,
    };
  };

  // Baseline evaluation at start date
  const baselineResult = useMemo(() => evaluateDate(startDateStr), [
    startDateStr,
    activeBooks,
    targetAmount,
    loanMargin,
    demandRate,
    isVipMode,
    ltvPercent,
    bankMargins,
  ]);

  // Generate candidate milestone dates between startDateStr and endDateStr
  const candidateMilestones = useMemo(() => {
    const datesSet = new Set<string>();
    datesSet.add(startDateStr);
    datesSet.add(endDateStr);

    // Add 1 day after each active book's maturity date if in range
    activeBooks.forEach((b) => {
      if (b.maturityDate >= startDateStr && b.maturityDate <= endDateStr) {
        datesSet.add(b.maturityDate);
        // Also the day immediately after maturity when funds are available
        const nextDay = new Date(b.maturityDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = nextDay.toISOString().slice(0, 10);
        if (nextDayStr <= endDateStr) {
          datesSet.add(nextDayStr);
        }
      }
    });

    const sortedDates = Array.from(datesSet).sort();
    return sortedDates.map((d) => {
      const res = evaluateDate(d);
      res.savingsVsStart = Math.max(0, baselineResult.optimalCost - res.optimalCost);
      return res;
    });
  }, [
    startDateStr,
    endDateStr,
    activeBooks,
    targetAmount,
    loanMargin,
    demandRate,
    isVipMode,
    ltvPercent,
    bankMargins,
    baselineResult.optimalCost,
  ]);

  // Find Top 3 Optimal Golden Windows (where cost is lowest and savings vs start is highest)
  const topGoldenWindows = useMemo(() => {
    // Filter dates strictly after start date with savings > 0
    const filtered = candidateMilestones.filter((c) => c.dateStr > startDateStr && c.savingsVsStart > 0);
    
    // Sort by optimalCost ascending, then by daysFromStart ascending
    const sorted = [...filtered].sort((a, b) => {
      if (a.optimalCost !== b.optimalCost) return a.optimalCost - b.optimalCost;
      return a.daysFromStart - b.daysFromStart;
    });

    // Remove consecutive dates that yield almost identical results
    const unique: CandidateDateResult[] = [];
    for (const item of sorted) {
      if (!unique.some((u) => Math.abs(u.optimalCost - item.optimalCost) < 500_000 && Math.abs(u.daysFromStart - item.daysFromStart) <= 3)) {
        unique.push(item);
      }
      if (unique.length >= 3) break;
    }

    return unique;
  }, [candidateMilestones, startDateStr]);

  // Chart data formatted
  const chartData = useMemo(() => {
    return candidateMilestones.map((m) => ({
      date: m.dateStr,
      label: m.label,
      costMillion: Math.round(m.optimalCost / 1_000_000),
      freeCashMillion: Math.round(m.freeMaturedCash / 1_000_000),
      savingsMillion: Math.round(m.savingsVsStart / 1_000_000),
      rationale: m.rationale,
    }));
  }, [candidateMilestones]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-6">
      {/* Header Advisor Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-xs">
              <Sparkles className="w-5 h-5" />
            </span>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              Tư vấn thời điểm giải ngân tối ưu
            </h3>
          </div>
          <p className="text-xs text-slate-600 max-w-3xl">
            Thương lượng lùi mốc thanh toán trùng hoặc sau ngày có sổ lớn đáo hạn để bảo toàn trọn vẹn tiền lãi và giảm chi phí vay thế chấp.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs font-semibold self-start sm:self-auto bg-emerald-50 px-3 py-1.5 rounded-xl text-emerald-800 border border-emerald-200">
          <Clock className="w-4 h-4 text-emerald-600" />
          <span>Mục tiêu: {formatMillionVND(targetAmount, privacyMode)}</span>
        </div>
      </div>

      {/* Date Range Selectors */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-700">Dự kiến từ ngày:</span>
              <div className="w-48">
                <DatePickerVN
                  value={startDateStr}
                  onChange={(val) => setStartDateStr(val)}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-700">Đến ngày:</span>
              <div className="w-48">
                <DatePickerVN
                  value={endDateStr}
                  onChange={(val) => setEndDateStr(val)}
                />
              </div>
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500 text-[11px] mr-1">Khoảng nhanh:</span>
            <button
              onClick={() => setQuickRange(1)}
              className="px-2 py-1 rounded bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 font-medium"
            >
              1 Tháng
            </button>
            <button
              onClick={() => setQuickRange(3)}
              className="px-2 py-1 rounded bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 font-medium"
            >
              3 Tháng
            </button>
            <button
              onClick={() => setQuickRange(6)}
              className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold"
            >
              6 Tháng
            </button>
            <button
              onClick={() => setQuickRange(12)}
              className="px-2 py-1 rounded bg-white hover:bg-slate-200 text-slate-700 border border-slate-200 font-medium"
            >
              1 Năm
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200 text-slate-600">
          <span>
            Chi phí thiệt hại nếu giải ngân ngay hôm nay ({formatDateVN(startDateStr)}):{' '}
            <strong className="text-rose-600 font-bold font-mono">
              {formatMillionVND(baselineResult.optimalCost, privacyMode)}
            </strong>
          </span>
          <span className="text-[11px] text-slate-500">
            Quét qua {candidateMilestones.length} mốc đáo hạn trong danh mục
          </span>
        </div>
      </div>

      {/* Top Golden Windows Cards */}
      <div className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider font-bold text-slate-700 flex items-center">
          <Zap className="w-4 h-4 text-amber-500 mr-1.5" />
          Thời điểm giải ngân tối ưu
        </h4>

        {topGoldenWindows.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
            Trong khoảng thời gian này không có sổ tiết kiệm nào đáo hạn để tạo ra bước nhảy dòng tiền lớn.
            Hai vợ chồng có thể giải ngân bất kỳ lúc nào hoặc nới rộng khoảng thời gian tìm kiếm sang 6-12 tháng.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topGoldenWindows.map((win, idx) => {
              const isBest = idx === 0;
              return (
                <div
                  key={win.dateStr}
                  className={`rounded-2xl p-4 border flex flex-col justify-between transition-all relative overflow-hidden ${
                    isBest
                      ? 'bg-gradient-to-b from-emerald-500/15 via-white to-emerald-500/5 border-emerald-500 shadow-sm ring-1 ring-emerald-500/30'
                      : 'bg-white border-slate-200 shadow-2xs hover:border-emerald-300'
                  }`}
                >
                  {isBest && (
                    <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-bl-lg">
                      🥇 Tối Ưu Nhất
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isBest ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">
                          {formatDateVN(win.dateStr)}
                        </div>
                        <span className="text-[11px] text-slate-500">
                          (Sau {win.daysFromStart} ngày từ hôm nay)
                        </span>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 text-xs">
                      <div className="flex justify-between items-baseline">
                        <span className="text-slate-500">Chi phí còn lại:</span>
                        <span className="font-bold text-emerald-700 text-sm font-mono">
                          {win.optimalCost === 0 ? '0 Tr VNĐ' : formatMillionVND(win.optimalCost, privacyMode)}
                        </span>
                      </div>

                      <div className="flex justify-between items-baseline text-emerald-700 font-semibold">
                        <span>Tiết kiệm thêm:</span>
                        <span className="font-bold font-mono">+{formatMillionVND(win.savingsVsStart, privacyMode)}</span>
                      </div>

                      <div className="pt-1.5 border-t border-slate-200 text-[11px] text-slate-600 flex justify-between">
                        <span>Tiền mặt tự do đã về:</span>
                        <strong className="text-slate-800 font-mono">
                          {formatMillionVND(win.freeMaturedCash, privacyMode)}
                        </strong>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {win.rationale}
                    </p>
                  </div>

                  <div className="pt-3 mt-2 border-t border-slate-100">
                    <button
                      onClick={() => onSelectOptimalDate(win.dateStr)}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 shadow-2xs ${
                        isBest
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                      }`}
                    >
                      <span>Áp Dụng Ngày Này</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cost Timeline Curve Chart */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h4 className="text-xs uppercase tracking-wider font-bold text-slate-700 flex items-center">
            <TrendingDown className="w-4 h-4 text-emerald-600 mr-1.5" />
            Đồ thị thay đổi chi phí theo ngày giải ngân
          </h4>
          <span className="text-[11px] text-slate-500">
            Đơn vị: Triệu VNĐ
          </span>
        </div>

        <div className="h-56 w-full bg-slate-50/70 p-2 rounded-xl border border-slate-200">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickFormatter={(val) => `${val} Tr`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1 max-w-xs">
                        <div className="font-bold text-amber-400">{formatDateVN(data.date)}</div>
                        <div className="text-slate-200">
                          Chi phí thiệt hại: <strong className="text-white">{data.costMillion} Triệu đ</strong>
                        </div>
                        <div className="text-emerald-400">
                          Tiết kiệm so với mốc đầu: <strong>+{data.savingsMillion} Triệu đ</strong>
                        </div>
                        <div className="text-slate-400 text-[11px] pt-1 border-t border-slate-700">
                          {data.rationale}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="stepAfter"
                dataKey="costMillion"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#costGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
