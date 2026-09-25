import { AnnualInterestRecord, BalanceGrowthRecord, SavingsBook, SettlementAdjustment } from '../types';
import { deduplicateSettlementAdjustments } from '../utils/dataTranslator';

// Dữ liệu lịch sử chuẩn xác từ bảng tổng kết của người dùng (2019 - 2025/2026)
export const DEFAULT_HISTORICAL_ANNUALS: AnnualInterestRecord[] = [
  { year: 2022, interestEarnedMillion: 1554, interestEarnedVND: 1554000000 },
  { year: 2023, interestEarnedMillion: 1583, interestEarnedVND: 1583000000 },
  { year: 2024, interestEarnedMillion: 2503, interestEarnedVND: 2503000000 },
  { year: 2025, interestEarnedMillion: 1986, interestEarnedVND: 1986000000 },
  { year: 2026, interestEarnedMillion: 2059, interestEarnedVND: 2059000000 },
];

export const DEFAULT_HISTORICAL_BALANCES: BalanceGrowthRecord[] = [
  { year: 2019, balanceMillion: 14000, balanceVND: 14000000000, annualIncomeMillion: undefined, annualIncomeVND: undefined },
  { year: 2020, balanceMillion: 18000, balanceVND: 18000000000, annualIncomeMillion: 4000, annualIncomeVND: 4000000000 },
  { year: 2021, balanceMillion: 19965, balanceVND: 19965000000, annualIncomeMillion: 1965, annualIncomeVND: 1965000000 },
  { year: 2022, balanceMillion: 23300, balanceVND: 23300000000, annualIncomeMillion: 3335, annualIncomeVND: 3335000000 },
  { year: 2023, balanceMillion: 27100, balanceVND: 27100000000, annualIncomeMillion: 3800, annualIncomeVND: 3800000000 },
  { year: 2024, balanceMillion: 32790, balanceVND: 32790000000, annualIncomeMillion: 5690, annualIncomeVND: 5690000000 },
  { year: 2025, balanceMillion: 35289, balanceVND: 35289000000, annualIncomeMillion: 2499, annualIncomeVND: 2499000000 },
];

export const ANNUAL_INTEREST_HISTORY: AnnualInterestRecord[] = [...DEFAULT_HISTORICAL_ANNUALS];
export const BALANCE_GROWTH_HISTORY: BalanceGrowthRecord[] = [...DEFAULT_HISTORICAL_BALANCES];

export function isUsingSampleData(books?: SavingsBook[]): boolean {
  return false;
}

const DEFAULT_SAMPLE_ANNUALS: AnnualInterestRecord[] = [...DEFAULT_HISTORICAL_ANNUALS];

const DEFAULT_SAMPLE_BALANCES: BalanceGrowthRecord[] = [...DEFAULT_HISTORICAL_BALANCES];

// In-memory cache for ultra-fast, zero-lag synchronous rendering
let inMemoryStaticAnnuals: AnnualInterestRecord[] | null = null;
let inMemoryStaticBalances: BalanceGrowthRecord[] | null = null;

/**
 * Lưu dữ liệu lịch sử tĩnh (data tĩnh - các năm trước năm hiện tại) vào in-memory cache & localStorage
 * BẢO VỆ CHỐNG GHI ĐÈ: Tự động hợp nhất (merge) với dữ liệu lịch sử đã có, tuyệt đối không để các lần đồng bộ lỗi xóa trắng các năm cũ!
 */
export function saveStaticHistoryToStorage(
  annuals: AnnualInterestRecord[] = [],
  balances: BalanceGrowthRecord[] = []
): void {
  try {
    const currentYear = new Date().getFullYear();
    // Lãi hàng năm static chốt bao gồm các năm <= currentYear (ví dụ <= 2026)
    const staticAnnuals = annuals.filter(a => a.year <= currentYear);
    // Số dư cuối năm static chốt bao gồm các năm < currentYear (ví dụ < 2026)
    const staticBalances = balances.filter(b => b.year < currentYear);

    // Hợp nhất an toàn với dữ liệu lịch sử hiện có
    const existing = loadStaticHistoryFromStorage();
    const annualsMap = new Map<number, AnnualInterestRecord>();
    existing.staticAnnuals.forEach(a => annualsMap.set(a.year, a));
    staticAnnuals.forEach(a => {
      // Chỉ ghi đè nếu dữ liệu mới có số tiền hợp lệ > 0
      if (a.interestEarnedMillion > 0 || !annualsMap.has(a.year)) {
        annualsMap.set(a.year, a);
      }
    });

    const balancesMap = new Map<number, BalanceGrowthRecord>();
    existing.staticBalances.forEach(b => balancesMap.set(b.year, b));
    staticBalances.forEach(b => {
      // Chỉ ghi đè nếu dữ liệu mới có số dư hợp lệ > 0
      if (b.balanceMillion > 0 || !balancesMap.has(b.year)) {
        balancesMap.set(b.year, b);
      }
    });

    const finalAnnuals = Array.from(annualsMap.values()).sort((a, b) => a.year - b.year);
    const finalBalances = Array.from(balancesMap.values()).sort((a, b) => a.year - b.year);

    inMemoryStaticAnnuals = finalAnnuals;
    inMemoryStaticBalances = finalBalances;

    if (typeof localStorage !== 'undefined') {
      if (finalAnnuals.length > 0) {
        localStorage.setItem('savings_static_annual_history_v1', JSON.stringify(finalAnnuals));
      }
      if (finalBalances.length > 0) {
        localStorage.setItem('savings_static_balance_history_v1', JSON.stringify(finalBalances));
      }
    }
  } catch (err) {
    console.warn('Lỗi khi lưu dữ liệu tĩnh vào storage:', err);
  }
}

/**
 * Xóa sạch toàn bộ dữ liệu lịch sử tĩnh trong cả in-memory cache & localStorage
 */
export function clearStaticHistoryFromStorage(): void {
  inMemoryStaticAnnuals = null;
  inMemoryStaticBalances = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('savings_static_annual_history_v1');
      localStorage.removeItem('savings_static_balance_history_v1');
    }
  } catch (err) {
    console.warn('Lỗi khi xóa dữ liệu tĩnh khỏi storage:', err);
  }
}

/**
 * Đọc dữ liệu lịch sử tĩnh tức thời từ in-memory cache hoặc localStorage.
 * Nếu storage chưa có hoặc bị thiếu các năm cũ, tự động nạp fallback an toàn từ bảng lịch sử gốc.
 */
export function loadStaticHistoryFromStorage(): {
  staticAnnuals: AnnualInterestRecord[];
  staticBalances: BalanceGrowthRecord[];
} {
  const currentYear = new Date().getFullYear();

  // 1. Trả về ngay từ RAM cache nếu có đủ dữ liệu lịch sử
  if (inMemoryStaticAnnuals && inMemoryStaticAnnuals.length > 0 && inMemoryStaticBalances && inMemoryStaticBalances.length > 0) {
    return {
      staticAnnuals: inMemoryStaticAnnuals,
      staticBalances: inMemoryStaticBalances,
    };
  }

  let staticAnnuals: AnnualInterestRecord[] = [];
  let staticBalances: BalanceGrowthRecord[] = [];

  try {
    if (typeof localStorage !== 'undefined') {
      const sa = localStorage.getItem('savings_static_annual_history_v1');
      if (sa) staticAnnuals = JSON.parse(sa);
      const sb = localStorage.getItem('savings_static_balance_history_v1');
      if (sb) staticBalances = JSON.parse(sb);
    }
  } catch (err) {
    console.warn('Lỗi khi đọc dữ liệu tĩnh từ localStorage:', err);
  }

  // Nếu thiếu dữ liệu các năm cũ < currentYear, bổ sung từ DEFAULT_HISTORICAL để không bao giờ bị xóa trắng
  const pastAnnuals = staticAnnuals.filter(a => a.year < currentYear);
  if (pastAnnuals.length === 0) {
    const annualMap = new Map<number, AnnualInterestRecord>();
    DEFAULT_HISTORICAL_ANNUALS.forEach(a => annualMap.set(a.year, a));
    staticAnnuals.forEach(a => annualMap.set(a.year, a));
    staticAnnuals = Array.from(annualMap.values()).sort((a, b) => a.year - b.year);
  }

  const pastBalances = staticBalances.filter(b => b.year < currentYear);
  if (pastBalances.length === 0) {
    const balMap = new Map<number, BalanceGrowthRecord>();
    DEFAULT_HISTORICAL_BALANCES.forEach(b => balMap.set(b.year, b));
    staticBalances.forEach(b => balMap.set(b.year, b));
    staticBalances = Array.from(balMap.values()).sort((a, b) => a.year - b.year);
  }

  inMemoryStaticAnnuals = staticAnnuals;
  inMemoryStaticBalances = staticBalances;

  return { staticAnnuals, staticBalances };
}

function getOriginalMaturityYear(s: SettlementAdjustment, fallbackYear: number): number {
  if (s.originalMaturityYear) {
    const yr = parseInt(String(s.originalMaturityYear), 10);
    if (!isNaN(yr)) return yr;
  }
  if (s.settlementDate) {
    const year = parseInt(s.settlementDate.slice(0, 4), 10);
    if (!isNaN(year)) return year;
  }
  return s.settlementYear || fallbackYear;
}

/**
 * Tính toán & Kết hợp Bảng LÃI HÀNG NĂM:
 * - Các năm cũ < Năm hiện tại (ví dụ < 2026): 100% Data Tĩnh từ file/chốt sổ.
 * - Sổ đáo hạn năm nào mà tất toán trước hạn thì trừ lãi (phần lãi bị mất) vào năm đó, bất kể số lãi năm đó đã chốt hay chưa.
 * - Sổ đáo hạn năm nào mà tất toán đúng hạn/quá hạn thì lãi năm đó không thay đổi.
 */
export function getDynamicAnnualInterestHistory(
  books: SavingsBook[] = [],
  settlements: SettlementAdjustment[] = [],
  customStaticAnnuals?: AnnualInterestRecord[]
): AnnualInterestRecord[] {
  const currentYear = new Date().getFullYear(); // e.g. 2026
  const nextYear = currentYear + 1; // e.g. 2027
  const safeSettlements = deduplicateSettlementAdjustments(settlements || []);

  // 1. Lấy dữ liệu tĩnh lịch sử từ file hoặc storage
  let rawStaticAnnuals: AnnualInterestRecord[] = [];
  if (customStaticAnnuals && customStaticAnnuals.length > 0) {
    rawStaticAnnuals = customStaticAnnuals;
  } else {
    const stored = loadStaticHistoryFromStorage();
    rawStaticAnnuals = stored.staticAnnuals;
  }

  // Các năm nhỏ hơn currentYear: 100% data tĩnh
  const pastStaticAnnuals = rawStaticAnnuals.filter(a => a.year < currentYear);

  // Chúng ta sẽ tính toán động cho năm hiện tại và các năm tương lai
  const yearsToCompute = new Set<number>();
  yearsToCompute.add(currentYear);
  yearsToCompute.add(nextYear);

  // Thêm các năm từ danh sách sổ active
  const activeBooks = (books || []).filter(b => b.status !== 'settled');
  activeBooks.forEach(b => {
    if (b.maturityDate) {
      const yr = parseInt(b.maturityDate.slice(0, 4), 10);
      if (!isNaN(yr) && yr >= currentYear) {
        yearsToCompute.add(yr);
      }
    }
  });

  // Thêm các năm từ danh sách lịch sử tất toán (năm đáo hạn gốc & năm tất toán thực tế)
  safeSettlements.forEach(s => {
    const originalMaturityYear = getOriginalMaturityYear(s, currentYear);
    if (originalMaturityYear >= currentYear) {
      yearsToCompute.add(originalMaturityYear);
    }
    if (s.settlementYear && s.settlementYear >= currentYear) {
      yearsToCompute.add(s.settlementYear);
    }
  });

  // Thêm các năm có sẵn trong rawStaticAnnuals mà >= currentYear
  rawStaticAnnuals.forEach(a => {
    if (a.year >= currentYear) {
      yearsToCompute.add(a.year);
    }
  });

  const dynamicRecords: AnnualInterestRecord[] = [];

  yearsToCompute.forEach(yr => {
    // Tìm xem năm này có bản chốt tĩnh từ file/Sheets không
    const staticRec = rawStaticAnnuals.find(a => a.year === yr);

    let interestVND = 0;

    if (staticRec) {
      // TRƯỜNG HỢP ĐÃ CÓ BẢN CHỐT TĨNH (ví dụ năm 2026 chốt tại 31/12/2025)
      let netAdjustmentVND = 0;

      // 1. Điều chỉnh từ các giao dịch tất toán:
      safeSettlements.forEach(s => {
        const originalMaturityYear = getOriginalMaturityYear(s, currentYear);

        // a) Sổ tất toán trong năm yr (s.settlementYear === yr):
        if (s.settlementYear === yr) {
          if (originalMaturityYear === yr) {
            // Sổ vốn dĩ đáo hạn năm yr: nếu rút trước hạn thì trừ phần lãi bị mất
            if (s.settlementType === 'early') {
              const expected = s.expectedTermInterest || 0;
              const actual = s.actualInterestVND || 0;
              const lost = expected - actual;
              if (lost > 0) {
                netAdjustmentVND -= lost;
              }
            }
          } else {
            // Sổ vốn dĩ đáo hạn năm KHÁC (ví dụ 2027), nhưng lại tất toán sớm trong năm yr (ví dụ 2026):
            // Sổ này chưa từng có trong base chốt của năm yr.
            // Số tiền lãi không kỳ hạn thực nhận (actualInterestVND) được thu về trong năm yr -> Cộng thêm vào năm yr!
            netAdjustmentVND += (s.actualInterestVND || 0);
          }
        } else {
          // b) Sổ tất toán ở năm khác (s.settlementYear !== yr):
          if (originalMaturityYear === yr) {
            // Sổ vốn dĩ đáo hạn năm yr (đã được tính trong base của yr), nhưng bị tất toán sớm ở năm khác:
            // Toàn bộ lãi dự kiến ban đầu không còn được nhận ở năm yr nữa -> Trừ khỏi năm yr!
            const expected = s.expectedTermInterest || 0;
            netAdjustmentVND -= expected;
          }
        }
      });

      // 2. Điều chỉnh từ các sổ ngắn hạn mở mới sau ngày chốt (startDate thuộc năm yr) và đáo hạn trong năm yr:
      activeBooks.forEach(b => {
        const maturityYear = b.maturityDate ? parseInt(b.maturityDate.slice(0, 4), 10) : currentYear;
        if (maturityYear === yr) {
          const startYear = b.startDate ? parseInt(b.startDate.slice(0, 4), 10) : 0;
          if (startYear === yr) {
            const startMs = new Date(b.startDate).getTime();
            const matMs = new Date(b.maturityDate).getTime();
            const daysTotal = Math.max(1, Math.round((matMs - startMs) / (1000 * 3600 * 24)));
            const termInt = b.expectedTermInterest ?? Math.round((b.principal * (b.interestRate / 100) * daysTotal) / 365);
            netAdjustmentVND += termInt;
          }
        }
      });

      interestVND = Math.max(0, staticRec.interestEarnedVND + netAdjustmentVND);
    } else {
      // TRƯỜNG HỢP CHƯA CÓ BẢN CHỐT TĨNH (ví dụ năm 2027, 2028: Tính toán hoàn toàn động)
      let dynamicSumVND = 0;

      // Cộng lãi dự kiến của các sổ ACTIVE đáo hạn trong năm yr
      activeBooks.forEach(b => {
        const maturityYear = b.maturityDate ? parseInt(b.maturityDate.slice(0, 4), 10) : currentYear;
        if (maturityYear === yr) {
          const startMs = new Date(b.startDate).getTime();
          const matMs = new Date(b.maturityDate).getTime();
          const daysTotal = Math.max(1, Math.round((matMs - startMs) / (1000 * 3600 * 24)));
          const termInt = b.expectedTermInterest ?? Math.round((b.principal * (b.interestRate / 100) * daysTotal) / 365);
          dynamicSumVND += termInt;
        }
      });

      // Cộng lãi thực nhận của các sổ ĐÃ TẤT TOÁN trong năm yr (s.settlementYear === yr)
      (settlements || []).forEach(s => {
        if (s.settlementYear === yr) {
          dynamicSumVND += (s.actualInterestVND || 0);
        }
      });

      interestVND = dynamicSumVND;
    }

    dynamicRecords.push({
      year: yr,
      interestEarnedMillion: Math.round(interestVND / 1_000_000),
      interestEarnedVND: interestVND,
    });
  });

  const allRecords = [
    ...pastStaticAnnuals,
    ...dynamicRecords,
  ];

  const uniqueMap = new Map<number, AnnualInterestRecord>();
  allRecords.forEach(r => uniqueMap.set(r.year, r));
  return Array.from(uniqueMap.values()).sort((a, b) => a.year - b.year);
}

/**
 * Tính toán & Kết hợp Bảng SỐ DƯ CUỐI NĂM & THU NHẬP NĂM:
 * - Dữ liệu tĩnh lịch sử (Năm cũ < Năm hiện tại): Trích xuất trực tiếp từ file Google Sheet/Excel (2019 - 2025).
 * - Dữ liệu động (Năm hiện tại): Tổng gốc danh mục sổ active hiện tại & Thu nhập năm 2026 = Số dư 2026 - Số dư 2025 (data tĩnh).
 */
export function getDynamicBalanceGrowthHistory(
  books: SavingsBook[] = [],
  _settlements: SettlementAdjustment[] = [],
  customStaticBalances?: BalanceGrowthRecord[]
): BalanceGrowthRecord[] {
  const currentYear = new Date().getFullYear(); // e.g. 2026

  // 1. Lấy dữ liệu tĩnh lịch sử (< currentYear)
  let staticBalances: BalanceGrowthRecord[] = [];
  if (customStaticBalances && customStaticBalances.length > 0) {
    staticBalances = customStaticBalances.filter(b => b.year < currentYear);
  } else {
    const stored = loadStaticHistoryFromStorage();
    staticBalances = stored.staticBalances.filter(b => b.year < currentYear);
  }

  staticBalances.sort((a, b) => a.year - b.year);

  const activeBooks = (books || []).filter(b => b.status !== 'settled');

  // 2. Số dư động năm hiện tại (2026)
  const currentYearBalanceVND = activeBooks.reduce((sum, b) => sum + b.principal, 0);
  const currentYearBalanceMil = Math.round(currentYearBalanceVND / 1_000_000);

  // 3. Thu nhập năm 2026 = Số dư 2026 - Số dư 2025 (Mốc lịch sử tĩnh gần nhất)
  let lastStaticBalanceMil: number | undefined = undefined;
  if (staticBalances.length > 0) {
    lastStaticBalanceMil = staticBalances[staticBalances.length - 1].balanceMillion;
  }

  let currentYearIncomeMil: number | undefined = undefined;
  let currentYearIncomeVND: number | undefined = undefined;

  if (lastStaticBalanceMil !== undefined) {
    currentYearIncomeMil = currentYearBalanceMil - lastStaticBalanceMil;
    currentYearIncomeVND = currentYearIncomeMil * 1_000_000;
  }

  const dynamicCurrentYearRecord: BalanceGrowthRecord = {
    year: currentYear,
    balanceMillion: currentYearBalanceMil,
    balanceVND: currentYearBalanceVND,
    annualIncomeMillion: currentYearIncomeMil,
    annualIncomeVND: currentYearIncomeVND,
  };

  const allRecords = [
    ...staticBalances,
    dynamicCurrentYearRecord,
  ];

  const uniqueMap = new Map<number, BalanceGrowthRecord>();
  allRecords.forEach(r => uniqueMap.set(r.year, r));

  const sorted = Array.from(uniqueMap.values()).sort((a, b) => a.year - b.year);

  // Tự động tính toán lại Thu nhập năm cho các hàng lịch sử nếu bị thiếu
  let prevBal: number | undefined = undefined;
  return sorted.map(r => {
    let incMil = r.annualIncomeMillion;
    let incVnd = r.annualIncomeVND;

    if (prevBal !== undefined && (incMil === undefined || incMil === null)) {
      incMil = r.balanceMillion - prevBal;
      incVnd = incMil * 1_000_000;
    }

    prevBal = r.balanceMillion;

    return {
      ...r,
      annualIncomeMillion: incMil,
      annualIncomeVND: incVnd,
    };
  });
}




