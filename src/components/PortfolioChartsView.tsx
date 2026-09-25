import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
} from 'recharts';
import { SavingsBook, AppSettings, SettlementAdjustment } from '../types';
import { getDynamicAnnualInterestHistory, getDynamicBalanceGrowthHistory } from '../data/historicalGrowth';
import { getBankById } from '../data/banks';
import { formatVND, formatDateVN, formatAdaptiveVND, formatAdaptiveShortVND, formatShortVND } from '../utils/formatters';
import { getDaysBetween } from '../utils/calculator';
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Calendar,
  Coins,
  ShieldCheck,
  Award,
  Layers,
  Sparkles,
  ArrowUpRight,
  Filter,
  Cloud,
} from 'lucide-react';

interface PortfolioChartsViewProps {
  books: SavingsBook[];
  settings: AppSettings;
  currentDateStr: string;
  settlements?: SettlementAdjustment[];
  onOpenOptimizer: () => void;
  onOpenSyncModal?: () => void;
}

export const PortfolioChartsView: React.FC<PortfolioChartsViewProps> = ({
  books,
  settings,
  currentDateStr,
  settlements = [],
  onOpenOptimizer,
  onOpenSyncModal,
}) => {
  const [activeChartTab, setActiveChartTab] = useState<
    'all' | 'cashflow' | 'banks' | 'terms' | 'rates' | 'growth' | 'loss-curve'
  >('all');

  // Format helper
  const fmtMillion = (valVND: number) => {
    return (valVND / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  };

  // Dynamic history records synchronized in real-time with current active books & settlements
  const dynamicAnnualInterest = useMemo(
    () => getDynamicAnnualInterestHistory(books, settlements),
    [books, settlements]
  );
  const dynamicBalanceGrowth = useMemo(
    () => getDynamicBalanceGrowthHistory(books, settlements),
    [books, settlements]
  );

  // Total active principal in millions
  const totalActivePrincipalMil = useMemo(() => {
    const sum = books.filter(b => b.status === 'active').reduce((acc, b) => acc + b.principal, 0);
    return Math.max(1, Math.round(sum / 1_000_000));
  }, [books]);

  // Weighted average interest rate across active books
  const averageRate = useMemo(() => {
    const activeBooks = books.filter(b => b.status === 'active');
    const totalPrincipal = activeBooks.reduce((s, b) => s + b.principal, 0);
    if (totalPrincipal === 0) return 0;
    const weightedRate = activeBooks.reduce((s, b) => s + b.principal * b.interestRate, 0);
    return weightedRate / totalPrincipal;
  }, [books]);

  // 1. DATA FOR CASHFLOW MATURITY TIMELINE (Theo tháng đáo hạn 2026 - 2028)
  const monthlyCashflowData = useMemo(() => {
    const map = new Map<string, { monthKey: string; monthLabel: string; principalMillion: number; interestMillion: number; totalMillion: number; bookCount: number }>();

    for (const book of books) {
      if (book.status !== 'active') continue;
      const ym = book.maturityDate.slice(0, 7); // Format: 'YYYY-MM'
      const [year, month] = ym.split('-');
      const monthLabel = `T${parseInt(month, 10)}/${year.slice(2)}`;

      const daysTotal = Math.max(1, getDaysBetween(book.startDate, book.maturityDate));
      const termInterest = book.expectedTermInterest ?? Math.round((book.principal * (book.interestRate / 100) * daysTotal) / 365);

      if (!map.has(ym)) {
        map.set(ym, {
          monthKey: ym,
          monthLabel,
          principalMillion: 0,
          interestMillion: 0,
          totalMillion: 0,
          bookCount: 0,
        });
      }

      const entry = map.get(ym)!;
      entry.principalMillion += Math.round(book.principal / 1_000_000);
      entry.interestMillion += Math.round(termInterest / 1_000_000);
      entry.totalMillion = entry.principalMillion + entry.interestMillion;
      entry.bookCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [books]);

  // 2. DATA FOR BANK DISTRIBUTION
  const bankDistributionData = useMemo(() => {
    const map = new Map<string, { name: string; valueMillion: number; bookCount: number; color: string }>();

    for (const book of books) {
      if (book.status !== 'active') continue;
      const bank = getBankById(book.bankId);
      const name = bank.shortName || bank.name;
      const color = bank.primaryColor || '#dc2626';

      if (!map.has(book.bankId)) {
        map.set(book.bankId, { name, valueMillion: 0, bookCount: 0, color });
      }

      const item = map.get(book.bankId)!;
      item.valueMillion += Math.round(book.principal / 1_000_000);
      item.bookCount += 1;
    }

    return Array.from(map.values());
  }, [books]);

  // 3. DATA FOR TERM DISTRIBUTION (Kỳ hạn 12T, 13T, 18T)
  const termDistributionData = useMemo(() => {
    const map = new Map<number, { term: string; termMonths: number; valueMillion: number; bookCount: number; color: string }>();

    const colors: Record<number, string> = {
      12: '#0ea5e9', // sky-500
      13: '#10b981', // emerald-500
      18: '#8b5cf6', // purple-500
    };

    for (const book of books) {
      if (book.status !== 'active') continue;
      const term = book.termMonths;

      if (!map.has(term)) {
        map.set(term, {
          term: `${term} Tháng`,
          termMonths: term,
          valueMillion: 0,
          bookCount: 0,
          color: colors[term] || '#64748b',
        });
      }

      const item = map.get(term)!;
      item.valueMillion += Math.round(book.principal / 1_000_000);
      item.bookCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => a.termMonths - b.termMonths);
  }, [books]);

  // 4. DATA FOR INTEREST RATE BRACKETS
  const rateBracketsData = useMemo(() => {
    const brackets = [
      { range: '7.0% - 7.5%', min: 7.0, max: 7.5, valueMillion: 0, bookCount: 0 },
      { range: '7.5% - 8.0%', min: 7.5, max: 8.0, valueMillion: 0, bookCount: 0 },
      { range: '8.0% - 8.5%', min: 8.0, max: 8.5, valueMillion: 0, bookCount: 0 },
      { range: '8.5% - 9.0%', min: 8.5, max: 9.0, valueMillion: 0, bookCount: 0 },
      { range: '≥ 9.0% (Đỉnh)', min: 9.0, max: 10.0, valueMillion: 0, bookCount: 0 },
    ];

    for (const book of books) {
      if (book.status !== 'active') continue;
      const rate = book.interestRate;
      for (const b of brackets) {
        if (rate >= b.min && (rate < b.max || (b.max === 10.0 && rate <= 10.0))) {
          b.valueMillion += Math.round(book.principal / 1_000_000);
          b.bookCount += 1;
          break;
        }
      }
    }

    return brackets;
  }, [books]);

  // 5. DATA FOR LOSS CURVE COMPARISON (Rút sớm vs Vay cầm cố)
  const lossCurveData = useMemo(() => {
    const maxMil = totalActivePrincipalMil;
    const targetSteps = [
      Math.round(maxMil * 0.1),
      Math.round(maxMil * 0.25),
      Math.round(maxMil * 0.5),
      Math.round(maxMil * 0.75),
      maxMil,
    ].filter(v => v > 0);

    // Sắp xếp các sổ theo ngày đáo hạn để mô phỏng chiến lược
    const sortedBooks = [...books].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

    return targetSteps.map((targetMil) => {
      const targetVND = targetMil * 1_000_000;
      let accumulated = 0;
      let earlyWithdrawLossVND = 0;
      let loanCostVND = 0;

      for (const book of sortedBooks) {
        if (accumulated >= targetVND) break;
        const daysTotal = Math.max(1, getDaysBetween(book.startDate, book.maturityDate));
        const daysToMaturity = Math.max(1, getDaysBetween(currentDateStr, book.maturityDate));
        const daysElapsed = Math.max(0, daysTotal - daysToMaturity);

        const expectedTermInterest = book.expectedTermInterest ?? Math.round((book.principal * (book.interestRate / 100) * daysTotal) / 365);
        const demandInterest = Math.round((book.principal * (0.2 / 100) * daysElapsed) / 365);
        const lostInterest = expectedTermInterest - demandInterest;

        // Vay cầm cố VIP: Lãi vay = Lãi sổ + 1.5%
        const loanRate = book.interestRate + 1.5;
        const bookLoanCost = Math.round((book.principal * (loanRate / 100) * daysToMaturity) / 365);

        accumulated += book.principal;
        earlyWithdrawLossVND += lostInterest;
        loanCostVND += bookLoanCost;
      }

      const savingsVND = Math.max(0, earlyWithdrawLossVND - loanCostVND);

      return {
        targetLabel: `${(targetMil / 1000).toFixed(0)} Tỷ`,
        targetMil,
        earlyWithdrawLossMillion: Math.round(earlyWithdrawLossVND / 1_000_000),
        loanCostMillion: Math.round(loanCostVND / 1_000_000),
        savedMillion: Math.round(savingsVND / 1_000_000),
      };
    });
  }, [books, currentDateStr]);

  // Total summary for header
  const totalPrincipal = books.reduce((s, b) => s + b.principal, 0);
  const totalTermInterest = books.reduce((s, b) => {
    const daysTotal = Math.max(1, getDaysBetween(b.startDate, b.maturityDate));
    return s + (b.expectedTermInterest ?? Math.round((b.principal * (b.interestRate / 100) * daysTotal) / 365));
  }, 0);

  // Top peak cashflow months dynamically computed from active books
  const sortedCashflowMonths = useMemo(() => {
    return [...monthlyCashflowData].sort((a, b) => b.totalMillion - a.totalMillion);
  }, [monthlyCashflowData]);

  const peakCashflowMonth = sortedCashflowMonths[0] ?? null;

  if (books.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center shadow-xs space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-200">
          <BarChart3 className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          <h3 className="text-lg font-bold text-slate-900">
            Chưa Có Dữ Liệu Sổ Tiết Kiệm Để Phân Tích Biểu Đồ
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Toàn bộ dữ liệu trên ứng dụng đã được dọn sạch hoàn toàn sau khi hủy liên kết. Hãy mở cửa sổ Google Drive để kết nối lại dữ liệu của bạn.
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
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-teal-950 text-white rounded-2xl p-6 shadow-md border border-emerald-800/40">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <BarChart3 className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold tracking-tight">
                Trung Tâm Biểu Đồ &amp; Phân Tích Danh Mục Sổ Tiết Kiệm ({formatAdaptiveShortVND(totalPrincipal, settings.privacyMode)})
              </h2>
            </div>
            <p className="text-sm text-emerald-200/90 max-w-3xl">
              Hệ thống trực quan hóa chuyên sâu: Dòng tiền đáo hạn từng tháng, cơ cấu ngân hàng &amp; kỳ hạn, 
              phân bổ lãi suất đỉnh cao, và đường cong so sánh thiệt hại khi cần huy động vốn mua nhà.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onOpenOptimizer}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center space-x-1.5"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Chạy Bài Toán Vay Mua Nhà</span>
            </button>
          </div>
        </div>

        {/* Filter Tab Chips */}
        <div className="flex items-center space-x-2 mt-6 pt-4 border-t border-emerald-800/40 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveChartTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'all'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            Tất cả Biểu đồ (Tổng quan)
          </button>
          <button
            onClick={() => setActiveChartTab('cashflow')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'cashflow'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            1. Dòng tiền Đáo hạn Hàng tháng
          </button>
          <button
            onClick={() => setActiveChartTab('banks')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'banks'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            2. Cơ cấu Ngân hàng
          </button>
          <button
            onClick={() => setActiveChartTab('terms')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'terms'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            3. Cơ cấu Kỳ hạn (12T, 13T, 18T)
          </button>
          <button
            onClick={() => setActiveChartTab('rates')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'rates'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            4. Dải Lãi suất (7.4% - 9.3%)
          </button>
          <button
            onClick={() => setActiveChartTab('loss-curve')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'loss-curve'
                ? 'bg-amber-400 text-slate-950 shadow-xs font-black'
                : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            5. So sánh Thiệt hại Vay vs Rút sớm
          </button>
          <button
            onClick={() => setActiveChartTab('growth')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeChartTab === 'growth'
                ? 'bg-indigo-500 text-white shadow-xs'
                : 'bg-white/10 text-emerald-200 hover:bg-white/20'
            }`}
          >
            6. Lịch sử Tăng trưởng (2019-2026)
          </button>
        </div>
      </div>

      {/* CHART 1: MONTHLY CASHFLOW MATURITY TIMELINE */}
      {(activeChartTab === 'all' || activeChartTab === 'cashflow') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Calendar className="w-5 h-5 text-teal-600 mr-2" />
                Biểu Đồ Dòng Tiền Đáo Hạn &amp; Lãi Gối Đầu Hàng Tháng
              </h3>
              <p className="text-xs text-slate-500">
                Thống kê số tiền gốc và tiền lãi thực nhận về tài khoản theo từng mốc tháng đáo hạn của {books.length} sổ (Đơn vị: Triệu VNĐ)
              </p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <span className="flex items-center text-slate-700">
                <span className="w-3 h-3 bg-teal-600 rounded mr-1.5"></span> Tiền gốc
              </span>
              <span className="flex items-center text-slate-700">
                <span className="w-3 h-3 bg-amber-500 rounded mr-1.5"></span> Tiền lãi
              </span>
            </div>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyCashflowData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(1)}T`}
                />
                <Tooltip
                  formatter={(val: any, name: any) => [
                    `${Number(val).toLocaleString('vi-VN')} Tr VNĐ`,
                    name === 'principalMillion' ? 'Tiền gốc' : name === 'interestMillion' ? 'Tiền lãi' : 'Tổng dòng tiền',
                  ]}
                  labelFormatter={(label) => `Tháng đáo hạn: ${label}`}
                  contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                />
                <Legend
                  formatter={(value) => (value === 'principalMillion' ? 'Tiền Gốc' : 'Tiền Lãi')}
                />
                <Bar dataKey="principalMillion" name="principalMillion" stackId="a" fill="#0d9488" radius={[0, 0, 0, 0]} />
                <Bar dataKey="interestMillion" name="interestMillion" stackId="a" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-slate-500 block">Tháng dòng tiền về lớn nhất:</span>
              <span className="font-bold text-slate-900 text-sm">
                {peakCashflowMonth
                  ? `${peakCashflowMonth.monthLabel} (${(peakCashflowMonth.totalMillion / 1000).toFixed(2)} Tỷ)`
                  : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                {peakCashflowMonth
                  ? `Gốc: ${peakCashflowMonth.principalMillion.toLocaleString('vi-VN')} Tr + Lãi: ${peakCashflowMonth.interestMillion.toLocaleString('vi-VN')} Tr`
                  : ''}
              </span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-slate-500 block">Số tháng có sổ đáo hạn:</span>
              <span className="font-bold text-teal-700 text-sm">
                {monthlyCashflowData.length} mốc tháng gối đầu
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                {monthlyCashflowData[0]?.monthLabel || 'N/A'} đến {monthlyCashflowData[monthlyCashflowData.length - 1]?.monthLabel || 'N/A'}
              </span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-slate-500 block">Tổng gốc nhận về:</span>
              <span className="font-bold text-emerald-700 text-sm">
                {formatAdaptiveVND(totalPrincipal, settings.privacyMode)}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                {books.length} sổ tiết kiệm
              </span>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-slate-500 block">Tổng lãi nhận về:</span>
              <span className="font-bold text-amber-600 text-sm">
                +{formatAdaptiveVND(totalTermInterest, settings.privacyMode)}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Lãi suất BQ {averageRate.toFixed(2)}%/năm
              </span>
            </div>
          </div>

          {/* Detailed Top Cashflow Highlights */}
          {sortedCashflowMonths.length > 0 && (
            <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between font-bold text-emerald-900">
                <span className="flex items-center">
                  <TrendingUp className="w-3.5 h-3.5 mr-1 text-emerald-700" />
                  Top các tháng có dòng tiền (Gốc + Lãi) về tài khoản lớn nhất:
                </span>
                <span className="text-[11px] font-normal text-emerald-700">Tự động tính từ 18 sổ</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-1">
                {sortedCashflowMonths.slice(0, 4).map((m, idx) => (
                  <div key={m.monthKey} className="bg-white p-2 rounded-lg border border-emerald-100 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        #{idx + 1}. {m.monthLabel}
                      </span>
                      <span className="font-extrabold text-emerald-700">
                        {(m.totalMillion / 1000).toFixed(2)} Tỷ
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
                      <span>Gốc: {m.principalMillion.toLocaleString('vi-VN')} Tr</span>
                      <span>Lãi: {m.interestMillion.toLocaleString('vi-VN')} Tr</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GRID 2 CHARTS: BANK ALLOCATION & TERM ALLOCATION */}
      {(activeChartTab === 'all' || activeChartTab === 'banks' || activeChartTab === 'terms') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 2: Bank Distribution */}
          {(activeChartTab === 'all' || activeChartTab === 'banks') && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center">
                    <PieChartIcon className="w-4 h-4 text-red-600 mr-2" />
                    Cơ Cấu Tỷ Trọng Theo Ngân Hàng
                  </h3>
                  <p className="text-xs text-slate-500">
                    Phân bổ vốn giữa SeABank (Chính &amp; TK2) và SHB
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-lg">
                  2 Ngân hàng VIP
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={bankDistributionData}
                      dataKey="valueMillion"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                    >
                      {bankDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => `${Number(val).toLocaleString('vi-VN')} Tr VNĐ`}
                      contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {bankDistributionData.map((item) => (
                  <div key={item.name} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="font-semibold text-slate-700 block truncate">{item.name}</span>
                    <span className="font-bold text-slate-900 block mt-0.5">
                      {(item.valueMillion / 1000).toFixed(1)} Tỷ
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {((item.valueMillion / totalActivePrincipalMil) * 100).toFixed(1)}% ({item.bookCount} sổ)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chart 3: Term Distribution */}
          {(activeChartTab === 'all' || activeChartTab === 'terms') && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center">
                    <Layers className="w-4 h-4 text-emerald-600 mr-2" />
                    Cơ Cấu Tiền Gửi Theo Kỳ Hạn
                  </h3>
                  <p className="text-xs text-slate-500">
                    Phân bổ kỳ hạn gửi của các sổ tiết kiệm đang hoạt động
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg">
                  Kỳ hạn dài tối ưu lãi
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={termDistributionData}
                      dataKey="valueMillion"
                      nameKey="term"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      label={((props: any) => `${props.term || props.name}: ${((props.percent || 0) * 100).toFixed(1)}%`) as any}
                    >
                      {termDistributionData.map((entry, index) => (
                        <Cell key={`term-cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => `${Number(val).toLocaleString('vi-VN')} Tr VNĐ`}
                      contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {termDistributionData.map((item) => (
                  <div key={item.term} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="font-semibold text-slate-700 block">{item.term}</span>
                    <span className="font-bold text-slate-900 block mt-0.5">
                      {(item.valueMillion / 1000).toFixed(1)} Tỷ
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {((item.valueMillion / totalActivePrincipalMil) * 100).toFixed(1)}% ({item.bookCount} sổ)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CHART 4: INTEREST RATE BRACKETS */}
      {(activeChartTab === 'all' || activeChartTab === 'rates') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <Coins className="w-5 h-5 text-amber-500 mr-2" />
                Phân Bổ Vốn Theo Các Dải Lãi Suất (%/Năm)
              </h3>
              <p className="text-xs text-slate-500">
                Cho thấy tỷ lệ tiền gửi tập trung ở các vùng lãi suất
              </p>
            </div>
            <span className="px-3 py-1 bg-amber-50 text-amber-800 text-xs font-bold rounded-lg">
              Lãi suất bình quân: {averageRate.toFixed(2)}%/năm
            </span>
          </div>

          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rateBracketsData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(1)}T`}
                />
                <Tooltip
                  formatter={(val: any) => [`${Number(val).toLocaleString('vi-VN')} Tr VNĐ`, 'Số tiền gửi']}
                  labelFormatter={(label) => `Dải lãi suất: ${label}`}
                  contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                />
                <Bar dataKey="valueMillion" fill="#f59e0b" radius={[6, 6, 0, 0]}>
                  {rateBracketsData.map((entry, index) => (
                    <Cell
                      key={`rate-cell-${index}`}
                      fill={entry.min >= 9.0 ? '#e11d48' : entry.min >= 8.5 ? '#f97316' : '#10b981'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 flex items-start space-x-2">
            <Award className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>Nhận định danh mục:</strong> Danh mục hiện đang được phân bổ trên các mức lãi suất tối ưu với lãi suất bình quân <strong>{averageRate.toFixed(2)}%/năm</strong>.
            </p>
          </div>
        </div>
      )}

      {/* CHART 5: LOSS CURVE COMPARISON (RÚT SỚM VS VAY CẦM CỐ) */}
      {(activeChartTab === 'all' || activeChartTab === 'loss-curve') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center">
                <TrendingUp className="w-5 h-5 text-rose-600 mr-2" />
                Đường Cong So Sánh Thiệt Hại: Rút Sớm Toàn Bộ vs Vay Cầm Cố VIP
              </h3>
              <p className="text-xs text-slate-500">
                Mô phỏng mức mất tiền lãi thực tế theo từng quy mô huy động vốn lên đến {(totalActivePrincipalMil / 1000).toFixed(1)} Tỷ VNĐ (Đơn vị: Triệu VNĐ)
              </p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <span className="flex items-center text-rose-700 font-semibold">
                <span className="w-3 h-3 bg-rose-500 rounded mr-1.5"></span> Thiệt hại Rút sớm
              </span>
              <span className="flex items-center text-indigo-700 font-semibold">
                <span className="w-3 h-3 bg-indigo-600 rounded mr-1.5"></span> Chi phí Vay cầm cố
              </span>
              <span className="flex items-center text-emerald-700 font-bold">
                <span className="w-3 h-3 bg-emerald-500 rounded mr-1.5"></span> Tiền bảo toàn được
              </span>
            </div>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lossCurveData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="targetLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(val) => `${val.toLocaleString('vi-VN')} Tr`}
                />
                <Tooltip
                  formatter={(val: any, name: any) => [
                    `${Number(val).toLocaleString('vi-VN')} Tr VNĐ`,
                    name === 'earlyWithdrawLossMillion'
                      ? 'Thiệt hại nếu Rút sớm'
                      : name === 'loanCostMillion'
                      ? 'Chi phí Lãi vay cầm cố VIP'
                      : 'Số tiền Lãi giữ lại được',
                  ]}
                  labelFormatter={(label) => `Số tiền cần huy động: ${label}`}
                  contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                />
                <Legend
                  formatter={(val) =>
                    val === 'earlyWithdrawLossMillion'
                      ? 'Mất tiền nếu Rút sớm'
                      : val === 'loanCostMillion'
                      ? 'Chi phí Vay cầm cố VIP'
                      : 'Tiền lãi tiết kiệm được'
                  }
                />
                <Line
                  type="monotone"
                  dataKey="earlyWithdrawLossMillion"
                  name="earlyWithdrawLossMillion"
                  stroke="#ef4444"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="loanCostMillion"
                  name="loanCostMillion"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="savedMillion"
                  name="savedMillion"
                  stroke="#10b981"
                  strokeWidth={3}
                  strokeDasharray="4 4"
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-950 space-y-1">
            <span className="font-bold block text-sm text-emerald-900">
              Kết luận phân tích bài toán huy động vốn:
            </span>
            <p>
              Đường nét đứt màu xanh lá cây đại diện cho <strong>khoản tiền lãi giữ lại được</strong> khi chọn giải pháp Vay cầm cố thay vì rút sớm.
              Ví dụ: Khi huy động <strong>5 Tỷ đồng</strong>, nếu rút sớm sẽ mất trắng hơn <strong>120 triệu tiền lãi</strong>, nhưng nếu vay cầm cố VIP bù trừ tức thì, gia đình chỉ tốn khoảng <strong>35 triệu tiền lãi vay</strong>, giữ lại được hơn <strong>85 triệu đồng</strong>!
            </p>
          </div>
        </div>
      )}

      {/* CHART 6: HISTORICAL GROWTH & ANNUAL INTEREST */}
      {(activeChartTab === 'all' || activeChartTab === 'growth') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Balance growth 2019-2026 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center">
              <TrendingUp className="w-4 h-4 text-indigo-600 mr-2" />
              Tăng Trưởng Số Dư Cuối Năm (2019 - 2026)
            </h3>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dynamicBalanceGrowth}>
                  <defs>
                    <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}T`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: any) => [`${(Number(val) / 1000).toFixed(1)} Tỷ VNĐ`, 'Số dư cuối năm']}
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="balanceMillion" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#balanceGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Annual interest 2022-2026 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center">
                <Coins className="w-4 h-4 text-amber-600 mr-2" />
                Dòng Tiền Lãi Tiết Kiệm Nhận Về Hàng Năm (2022 - 2026)
              </h3>
              <p className="text-[11px] text-slate-500 ml-6">
                Tổng lãi thực nhận của toàn bộ các sổ tất toán trong năm (chốt số kỳ 31/12)
              </p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dynamicAnnualInterest}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(val) => `${val.toLocaleString('vi-VN')} Tr`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: any) => [`${Number(val).toLocaleString('vi-VN')} Triệu VNĐ`, 'Tiền lãi thực nhận']}
                    contentStyle={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: '12px', fontSize: '12px' }}
                  />
                  <Bar dataKey="interestEarnedMillion" fill="#f59e0b" radius={[6, 6, 0, 0]}>
                    {dynamicAnnualInterest.map((entry, index) => (
                      <Cell key={`hist-cell-${index}`} fill={entry.year === 2024 ? '#e11d48' : '#f59e0b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
