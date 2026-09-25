import React from 'react';
import {
  Calendar,
  Clock,
  TrendingUp,
  Landmark,
  User,
  ArrowRight,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { SavingsBook } from '../types';
import { getBankById } from '../data/banks';
import {
  formatVND,
  formatMillionVND,
  formatShortVND,
  formatDateVN,
  formatRelativeDays,
  getOwnerLabel,
  getOwnerBadgeStyle,
} from '../utils/formatters';
import { calculateInterest, getDaysBetween, getAdjustedMaturityDate } from '../utils/calculator';
import { getBankTagForBook } from '../utils/dataTranslator';

interface SavingsBookCardProps {
  book: SavingsBook;
  currentDateStr: string;
  privacyMode: boolean;
  husbandName: string;
  wifeName: string;
  onSelectForAnalysis: (book: SavingsBook) => void;
  onEdit: (book: SavingsBook) => void;
  onDelete: (bookId: string) => void;
}

export const SavingsBookCard: React.FC<SavingsBookCardProps> = ({
  book,
  currentDateStr,
  privacyMode,
  husbandName,
  wifeName,
  onSelectForAnalysis,
  onEdit,
  onDelete,
}) => {
  const bank = getBankById(book.bankId);
  const adjustedMaturityDate = getAdjustedMaturityDate(book.maturityDate, book.depositType, book.bankId);
  const effectiveMaturityDate = adjustedMaturityDate || book.maturityDate;

  const totalDays = Math.max(1, getDaysBetween(book.startDate, effectiveMaturityDate));
  const passedDays = Math.max(0, getDaysBetween(book.startDate, currentDateStr));
  const remainingDays = getDaysBetween(currentDateStr, effectiveMaturityDate);

  const percentProgress = Math.min(100, Math.max(0, Math.round((passedDays / totalDays) * 100)));
  const fullTermInterest = calculateInterest(book.principal, book.interestRate, totalDays);

  const isMatured = remainingDays <= 0;
  const isCloseToMaturity = remainingDays > 0 && remainingDays <= 45;

  return (
    <div
      id={`book-card-${book.id}`}
      className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col justify-between"
    >
      {/* Top Bank Strip & Tags */}
      <div>
        <div
          className="px-4 py-3 flex items-center justify-between border-b"
          style={{ backgroundColor: bank.bgLight, borderColor: bank.borderColor }}
        >
          <div className="flex items-center space-x-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-xs"
              style={{ backgroundColor: bank.primaryColor, color: bank.textColor }}
            >
              <Landmark className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-bold text-slate-900 text-sm tracking-tight">
                  {bank.shortName}
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                  {getBankTagForBook(book.bankId, book.owner, bank.code)}
                </span>
              </div>
              <div className="flex items-center space-x-1 text-[11px] text-slate-600">
                <span>{book.depositType === 'online' ? 'Online' : 'Tại quầy'}</span>
                {book.tag && (
                  <>
                    <span>&bull;</span>
                    <span className="text-emerald-700 font-medium">{book.tag}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Owner Badge & Deposit Type */}
          <div className="flex items-center space-x-1.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border shadow-2xs ${
                getOwnerBadgeStyle(book.owner).badgeClass
              }`}
            >
              <User className="w-3 h-3 mr-1 opacity-70" />
              {getOwnerLabel(book.owner)}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                book.depositType === 'counter'
                  ? 'bg-amber-50 text-amber-900 border-amber-200/80'
                  : 'bg-teal-50 text-teal-800 border-teal-200/80'
              }`}
            >
              {book.depositType === 'counter' ? 'Tại quầy' : 'Online'}
            </span>
          </div>
        </div>

        {/* Top Accent Progress Line immediately showing maturity progress at a glance */}
        <div className="w-full h-1 bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              isMatured
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : isCloseToMaturity
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-indigo-500 to-blue-500'
            }`}
            style={{ width: `${percentProgress}%` }}
          />
        </div>

        {/* Card Body */}
        <div className="p-4 space-y-3.5">
          {/* Principal & Interest Rate */}
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium block">
                Số tiền gốc
              </span>
              <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-mono">
                {formatMillionVND(book.principal, privacyMode)}
              </span>
            </div>

            <div className="text-right">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium block">
                Lãi suất / Kỳ hạn
              </span>
              <div className="flex items-baseline justify-end space-x-1">
                <span className="text-base font-bold text-emerald-600">
                  {book.interestRate}%
                </span>
                <span className="text-xs text-slate-500">/ năm ({book.termMonths}T)</span>
              </div>
            </div>
          </div>

          {/* Progress Bar of Term & Maturity Indicator */}
          <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center text-slate-600 font-medium">
                <Clock className="w-3.5 h-3.5 mr-1 text-slate-400 shrink-0" />
                Đã gửi: <strong className="ml-1 text-slate-800">{passedDays}/{totalDays} ngày</strong>
              </span>
              <span className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${
                isMatured
                  ? 'bg-emerald-100 text-emerald-800'
                  : isCloseToMaturity
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-indigo-50 text-indigo-700'
              }`}>
                {percentProgress}% kỳ hạn
              </span>
            </div>

            {/* Progress Track */}
            <div className="w-full h-2.5 bg-slate-200/80 rounded-full overflow-hidden p-0.5 relative">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isMatured
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-xs'
                    : isCloseToMaturity
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-xs'
                    : 'bg-gradient-to-r from-indigo-500 to-blue-500'
                }`}
                style={{ width: `${percentProgress}%` }}
              />
            </div>

            {/* Status Footer under Progress Bar */}
            <div className="flex flex-col gap-0.5 pt-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  Từ <strong className="text-slate-700">{formatDateVN(book.startDate, false)}</strong>
                </span>
                <span className="text-slate-500">
                  Đến <strong className="text-slate-900 font-bold">{formatDateVN(effectiveMaturityDate, false)}</strong>
                  <span className={`ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded font-mono ${
                    remainingDays < 0
                      ? 'bg-rose-100 text-rose-800'
                      : remainingDays === 0
                      ? 'bg-rose-600 text-white'
                      : remainingDays <= 45
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-indigo-50 text-indigo-800'
                  }`}>
                    {remainingDays < 0 ? `Quá ${Math.abs(remainingDays)}N` : remainingDays === 0 ? 'Hôm nay' : `Còn ${remainingDays}N`}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Expected Interest & Status Pill Grid */}
          <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl text-xs border border-slate-100">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-medium">
                Trạng thái kỳ hạn
              </span>
              <div className="mt-1">
                {isMatured ? (
                  <span className="inline-flex items-center text-rose-800 font-bold bg-rose-100 px-2 py-0.5 rounded-md text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 mr-1 text-rose-600 shrink-0" />
                    {remainingDays === 0 ? 'Đáo hạn hôm nay!' : `Đã quá hạn ${Math.abs(remainingDays)} ngày`}
                  </span>
                ) : isCloseToMaturity ? (
                  <span className="inline-flex items-center text-amber-950 font-bold bg-amber-100 px-2 py-0.5 rounded-md text-[11px] animate-pulse">
                    <AlertCircle className="w-3.5 h-3.5 mr-1 text-amber-700 shrink-0" />
                    Còn {remainingDays} ngày nữa
                  </span>
                ) : (
                  <span className="inline-flex items-center text-slate-800 font-bold bg-slate-100 px-2 py-0.5 rounded-md text-[11px]">
                    <Clock className="w-3.5 h-3.5 mr-1 text-slate-500 shrink-0" />
                    Còn {remainingDays} ngày (~{Math.round(remainingDays / 30.417)}T)
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-slate-400 block text-[10px] uppercase font-medium">
                Tiền lãi cả kỳ
              </span>
              <div className="font-semibold text-emerald-700 mt-1 flex items-center justify-end font-mono">
                <TrendingUp className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                <span>+{formatMillionVND(fullTermInterest, privacyMode)}</span>
              </div>
            </div>
          </div>

          {/* Note tooltip preview if exists */}
          {book.note && (
            <div className="pt-0.5 text-right">
              <span className="text-[11px] text-slate-500 italic truncate max-w-full block" title={book.note}>
                📝 {book.note}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="px-4 py-2.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
        {/* Analyze Loan vs Break button */}
        <button
          id={`btn-analyze-book-${book.id}`}
          onClick={() => onSelectForAnalysis(book)}
          className="flex items-center space-x-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>Tính Vay vs Rút sớm</span>
          <ArrowRight className="w-3 h-3 ml-0.5" />
        </button>

        <div className="flex items-center space-x-1">
          <button
            id={`btn-edit-book-${book.id}`}
            onClick={() => onEdit(book)}
            title="Chỉnh sửa thông tin sổ"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            id={`btn-delete-book-${book.id}`}
            onClick={() => onDelete(book.id)}
            title="Xóa sổ này"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
