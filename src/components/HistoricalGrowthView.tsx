import React, { useState, useMemo } from 'react';
import { SavingsBook, AppSettings, SettlementAdjustment } from '../types';
import { getDynamicAnnualInterestHistory, getDynamicBalanceGrowthHistory } from '../data/historicalGrowth';
import { formatVND, formatShortVND } from '../utils/formatters';
import { 
  TrendingUp, 
  Coins, 
  Calendar, 
  BarChart3, 
  ArrowUpRight, 
  PiggyBank, 
  Award, 
  ShieldCheck,
  Percent,
  Cloud,
} from 'lucide-react';

interface HistoricalGrowthViewProps {
  settings: AppSettings;
  books?: SavingsBook[];
  settlements?: SettlementAdjustment[];
  onOpenSyncModal?: () => void;
}

export const HistoricalGrowthView: React.FC<HistoricalGrowthViewProps> = ({
  settings,
  books = [],
  settlements = [],
  onOpenSyncModal,
}) => {
  const [selectedYear, setSelectedYear] = useState<number | null>(2026);

  if (books.length === 0 || !settings.googleSheetUrl) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center shadow-xs space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto border border-indigo-200">
          <TrendingUp className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          <h3 className="text-lg font-bold text-slate-900">
            {!settings.googleSheetUrl ? 'Chưa Liên Kết Dữ Liệu Lịch Sử Google Drive' : 'Chưa Có Dữ Liệu Lịch Sử Tăng Trưởng'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            {!settings.googleSheetUrl
              ? 'Bảng lịch sử số dư (2019-2025) và lãi hàng năm chỉ hiển thị khi bạn kết nối ứng dụng với file Google Drive có lưu lịch sử tài chính.'
              : 'Dữ liệu trên ứng dụng đã được dọn sạch hoàn toàn sau khi hủy liên kết. Hãy mở cửa sổ Google Drive để kết nối lại dữ liệu của bạn.'}
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

  // Dynamic history synchronized in real-time with current active books and settlements
  const dynamicAnnualInterest = useMemo(
    () => getDynamicAnnualInterestHistory(books, settlements),
    [books, settlements]
  );
  const dynamicBalanceGrowth = useMemo(
    () => getDynamicBalanceGrowthHistory(books, settlements),
    [books, settlements]
  );

  // Thống kê tổng hợp
  const totalInterest5Years = dynamicAnnualInterest.reduce((s, r) => s + r.interestEarnedVND, 0);
  const averageInterestPerYear = dynamicAnnualInterest.length > 0 ? totalInterest5Years / dynamicAnnualInterest.length : 0;
  
  const currentBooksPrincipal = books.reduce((s, b) => s + b.principal, 0);
  const startBalance = dynamicBalanceGrowth[0]?.balanceVND || currentBooksPrincipal;
  const currentBalance = currentBooksPrincipal > 0 ? currentBooksPrincipal : (dynamicBalanceGrowth[dynamicBalanceGrowth.length - 1]?.balanceVND || 0);
  const totalWealthGained = currentBalance - startBalance;
  const percentageGained = startBalance > 0 ? (totalWealthGained / startBalance) * 100 : 0;
  
  const firstYear = dynamicBalanceGrowth[0]?.year || 2026;
  const lastYear = dynamicBalanceGrowth[dynamicBalanceGrowth.length - 1]?.year || 2026;
  const yearsSpan = Math.max(1, lastYear - firstYear);
  const cagr = startBalance > 0 && currentBalance > 0 && yearsSpan > 0 && lastYear > firstYear
    ? (Math.pow(currentBalance / startBalance, 1 / yearsSpan) - 1) * 100
    : 0;

  // Dynamic max values for SVG scaling
  const maxBalanceMillion = Math.max(...dynamicBalanceGrowth.map(x => x.balanceMillion), 1000);
  const maxInterestMillion = Math.max(...dynamicAnnualInterest.map(x => x.interestEarnedMillion), 100);



  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 text-white rounded-2xl p-6 shadow-md border border-indigo-800/40">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <TrendingUp className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold tracking-tight">
                Hành Trình Tích Lũy Tài Sản &amp; Thu Nhập Lãi Tiết Kiệm ({firstYear} - {lastYear})
              </h2>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl">
              Thống kê tăng trưởng quy mô tài sản và lãi tiết kiệm sinh ra từ danh mục sổ tiết kiệm hiện có: 
              Quy mô số dư hiện tại đạt <strong> {formatShortVND(currentBalance, settings.privacyMode)}</strong>, 
              mang lại dòng tiền lãi thụ động ổn định.
            </p>
          </div>

          <div className="bg-indigo-900/60 border border-indigo-500/30 rounded-xl p-3.5 text-center shrink-0">
            <span className="text-[11px] uppercase tracking-wider text-indigo-300 font-bold block">
              Tốc độ tăng trưởng (CAGR)
            </span>
            <span className="text-2xl font-black text-amber-300 block">
              {cagr > 0 ? `+${cagr.toFixed(1)}% / năm` : 'Ổn định'}
            </span>
            <span className="text-[10px] text-slate-300">{books.length} sổ tiết kiệm đang hoạt động</span>
          </div>
        </div>

        {/* 4 Overview Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6 pt-5 border-t border-indigo-800/50">
          <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
            <span className="text-xs text-indigo-200 font-medium block">
              Số dư khởi điểm ({firstYear})
            </span>
            <span className="text-lg sm:text-xl font-black text-white block mt-0.5">
              {formatVND(startBalance, settings.privacyMode)}
            </span>
            <span className="text-[11px] text-indigo-300">
              {Math.round(startBalance / 1_000_000).toLocaleString('vi-VN')} Triệu VNĐ
            </span>
          </div>

          <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
            <span className="text-xs text-indigo-200 font-medium block">
              Số dư hiện tại (2026)
            </span>
            <span className="text-lg sm:text-xl font-black text-emerald-300 block mt-0.5">
              {formatVND(currentBalance, settings.privacyMode)}
            </span>
            <span className="text-[11px] text-emerald-400 font-semibold">
              {totalWealthGained >= 0 ? '+' : ''}{formatVND(totalWealthGained, settings.privacyMode)} ({percentageGained >= 0 ? '+' : ''}{percentageGained.toFixed(0)}%)
            </span>
          </div>

          <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
            <span className="text-xs text-indigo-200 font-medium block">
              Tổng lãi các năm
            </span>
            <span className="text-lg sm:text-xl font-black text-amber-300 block mt-0.5">
              {formatVND(totalInterest5Years, settings.privacyMode)}
            </span>
            <span className="text-[11px] text-amber-400 font-semibold">
              {dynamicAnnualInterest.reduce((s, x) => s + x.interestEarnedMillion, 0).toLocaleString('vi-VN')} Triệu VNĐ
            </span>
          </div>

          <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
            <span className="text-xs text-indigo-200 font-medium block">
              Lãi bình quân / năm
            </span>
            <span className="text-lg sm:text-xl font-black text-amber-300 block mt-0.5">
              {formatVND(averageInterestPerYear, settings.privacyMode)}
            </span>
            <span className="text-[11px] text-indigo-300">
              ~{Math.round(averageInterestPerYear / 1_000_000).toLocaleString('vi-VN')} Triệu VNĐ / năm
            </span>
          </div>
        </div>
      </div>

      {/* Main Growth Visual Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CHART 1: TĂNG TRƯỞNG QUY MÔ SỐ DƯ (2019 - 2026) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                <BarChart3 className="w-4 h-4" />
              </span>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                Quy Mô Số Dư Cuối Năm ({firstYear} - {lastYear})
              </h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">Đơn vị: Tỷ VNĐ</span>
          </div>

          {/* Bar / Column Chart */}
          <div className="h-64 flex items-end justify-between gap-2 sm:gap-3 pt-6 pb-2 px-2 border-b border-slate-200">
            {dynamicBalanceGrowth.map((item) => {
              const heightPercent = (item.balanceMillion / maxBalanceMillion) * 100;
              const isSelected = selectedYear === item.year;
              return (
                <div
                  key={item.year}
                  onClick={() => setSelectedYear(item.year)}
                  className="flex-1 flex flex-col items-center cursor-pointer group h-full justify-end"
                >
                  {/* Tooltip / Value on top */}
                  <span className={`text-[10px] sm:text-xs font-bold mb-1.5 transition-colors ${
                    isSelected ? 'text-indigo-600 font-black scale-110' : 'text-slate-500 group-hover:text-slate-800'
                  }`}>
                    {(item.balanceMillion / 1000).toFixed(1)}T
                  </span>

                  {/* Column Bar */}
                  <div className="w-full max-w-[40px] bg-slate-100 rounded-t-xl overflow-hidden flex flex-col justify-end transition-all relative">
                    <div
                      className={`w-full rounded-t-xl transition-all duration-500 ${
                        item.year >= 2026
                          ? 'bg-gradient-to-t from-emerald-600 to-teal-400'
                          : isSelected
                          ? 'bg-gradient-to-t from-indigo-600 to-indigo-400'
                          : 'bg-gradient-to-t from-slate-400 to-slate-300 group-hover:from-indigo-400 group-hover:to-indigo-300'
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>

                  {/* Year Label */}
                  <span className={`text-[11px] sm:text-xs font-semibold mt-2 text-center ${
                    isSelected ? 'text-indigo-700 font-bold' : 'text-slate-600'
                  }`}>
                    {item.year === 2026 ? '2026 (Tạm tính)' : item.year}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>{dynamicBalanceGrowth[0]?.year}: {((dynamicBalanceGrowth[0]?.balanceMillion || 0) / 1000).toFixed(1)} Tỷ VNĐ</span>
            <span className="text-[10px] text-emerald-600 font-semibold">* Số liệu Thực tế chốt số</span>
            <span className="font-bold text-emerald-700">{lastYear}: {formatShortVND(currentBalance, settings.privacyMode)}</span>
          </div>
        </div>

        {/* CHART 2: TIỀN LÃI HÀNG NĂM */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                <Coins className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  Tiền Lãi Nhận Về Hàng Năm ({dynamicAnnualInterest[0]?.year || 2026} - {dynamicAnnualInterest[dynamicAnnualInterest.length - 1]?.year || 2028})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tổng tiền lãi qua các năm (thực nhận) và các năm tương lai (dự kiến tạm tính)
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-500">Đơn vị: Triệu VNĐ</span>
          </div>

          {/* Bar Chart for Interest */}
          <div className="h-64 flex items-end justify-between gap-3 sm:gap-4 pt-6 pb-2 px-4 border-b border-slate-200">
            {dynamicAnnualInterest.map((item) => {
              const heightPercent = maxInterestMillion > 0 ? (item.interestEarnedMillion / maxInterestMillion) * 100 : 0;
              const isSelected = selectedYear === item.year;
              return (
                <div
                  key={item.year}
                  onClick={() => setSelectedYear(item.year)}
                  className="flex-1 flex flex-col items-center cursor-pointer group h-full justify-end"
                >
                  {/* Tooltip / Value on top */}
                  <span className={`text-[10px] sm:text-xs font-bold mb-1.5 transition-colors ${
                    isSelected ? 'text-amber-600 font-black scale-110' : 'text-slate-500 group-hover:text-slate-800'
                  }`}>
                    {item.interestEarnedMillion.toLocaleString('vi-VN')}
                  </span>

                  {/* Column Bar */}
                  <div className="w-full max-w-[44px] bg-slate-100 rounded-t-xl overflow-hidden flex flex-col justify-end transition-all relative">
                    <div
                      className={`w-full rounded-t-xl transition-all duration-500 ${
                        item.year >= 2026
                          ? 'bg-gradient-to-t from-amber-500 to-yellow-400'
                          : isSelected
                          ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                          : 'bg-gradient-to-t from-slate-400 to-slate-300 group-hover:from-amber-400 group-hover:to-amber-300'
                      }`}
                      style={{ height: `${Math.max(5, heightPercent)}%` }}
                    />
                  </div>

                  {/* Year Label */}
                  <span className={`text-[11px] sm:text-xs font-semibold mt-2 text-center ${
                    isSelected ? 'text-amber-700 font-bold' : 'text-slate-600'
                  }`}>
                    {item.year >= 2027 ? `${item.year} (Tạm tính)` : item.year}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>{dynamicAnnualInterest[0]?.year}: {dynamicAnnualInterest[0]?.interestEarnedMillion?.toLocaleString('vi-VN')} Triệu</span>
            <span className="text-[10px] text-emerald-600 font-semibold">* Số liệu chốt sổ</span>
            <span className="font-bold text-amber-700">
              Năm &gt;= 2027: Tạm tính
            </span>
          </div>
        </div>
      </div>


    </div>
  );
};
