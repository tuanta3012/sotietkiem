import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { SavingsBook, SettlementAdjustment, BookStatus, canEditData } from '../types';
import { sortAndReindexBooks, normalizeOwner, deduplicateSettlementAdjustments, normalizeDateToISO } from '../utils/dataTranslator';
import { formatDateVN, getOwnerLabel, formatDecimal } from '../utils/formatters';
import { calculateInterest, getDaysBetween } from '../utils/calculator';
import { getSortedBanksByUsage } from '../data/banks';
import { clearStaticHistoryFromStorage } from '../data/historicalGrowth';
import { recordSyncAuditLog } from '../utils/syncAuditLog';
import {
  getSavingsBooksFromFile,
  saveSavingsBooksToFile,
  getSettlementsFromFile,
  saveSettlementsToFile,
  migrateFromLocalStorageIfNeeded,
  clearAllLocalAppFiles,
} from '../utils/fileStorage';
import {
  recordBookUpsert,
  recordBookDelete,
  recordBookSettle,
  clearOutbox,
} from '../utils/syncOutbox';

interface UseSavingsBooksProps {
  currentRole?: string;
  onPushToDrive?: (books: SavingsBook[], adjustments?: SettlementAdjustment[]) => void;
  onShowSyncStatus?: (msg: string) => void;
}

export function useSavingsBooks({ currentRole, onPushToDrive, onShowSyncStatus }: UseSavingsBooksProps = {}) {
  // Trạng thái nạp dữ liệu ban đầu từ File Storage
  const [isLoadingStorage, setIsLoadingStorage] = useState<boolean>(true);

  // Khởi tạo state với dữ liệu đồng bộ nhanh từ localStorage (để render tức thì không giật)
  const [books, setBooks] = useState<SavingsBook[]>(() => {
    try {
      const isCleared = localStorage.getItem('savings_books_cleared');
      if (isCleared === 'true') return [];
      const saved = localStorage.getItem('savings_books_v3');
      if (saved !== null) {
        const parsed: SavingsBook[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return sortAndReindexBooks(parsed);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [settlementAdjustments, setSettlementAdjustments] = useState<SettlementAdjustment[]>(() => {
    try {
      const saved = localStorage.getItem('savings_settlements_v3');
      if (saved !== null) {
        const parsed: SettlementAdjustment[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((a) => ({
            ...a,
            owner: normalizeOwner(a.owner, a.bankId, a.bookCode),
          }));
          return deduplicateSettlementAdjustments(normalized);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [banksVersion, setBanksVersion] = useState<number>(0);

  // Filters for Cards view
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'maturity' | 'principal' | 'rate'>('maturity');

  // Lưu trữ callback onPushToDrive trong ref để tránh re-trigger không cần thiết
  const onPushToDriveRef = useRef(onPushToDrive);
  onPushToDriveRef.current = onPushToDrive;

  const onShowSyncStatusRef = useRef(onShowSyncStatus);
  onShowSyncStatusRef.current = onShowSyncStatus;

  // Khóa chống nhấp đúp hoặc gọi chồng lấn cho cùng 1 sổ
  const actionLockRef = useRef<Record<string, number>>({});
  const isInitialLoadDoneRef = useRef<boolean>(false);

  // 1. Tự động kiểm tra Migration & Nạp dữ liệu bất đồng bộ từ Filesystem khi khởi động
  useEffect(() => {
    let isMounted = true;
    const initStorage = async () => {
      try {
        await migrateFromLocalStorageIfNeeded();
        const fileBooks = await getSavingsBooksFromFile();
        const fileSettlements = await getSettlementsFromFile();

        if (isMounted) {
          if (Array.isArray(fileBooks) && fileBooks.length > 0) {
            setBooks(sortAndReindexBooks(fileBooks));
          }
          if (Array.isArray(fileSettlements) && fileSettlements.length > 0) {
            const normalized = fileSettlements.map((a) => ({
              ...a,
              owner: normalizeOwner(a.owner, a.bankId, a.bookCode),
            }));
            setSettlementAdjustments(deduplicateSettlementAdjustments(normalized));
          }
        }
      } catch (err) {
        console.warn('[useSavingsBooks] Lỗi nạp dữ liệu từ Filesystem:', err);
      } finally {
        if (isMounted) {
          setIsLoadingStorage(false);
          isInitialLoadDoneRef.current = true;
        }
      }
    };

    initStorage();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Tự động lưu dữ liệu bất đồng bộ vào Filesystem và localStorage khi books thay đổi
  useEffect(() => {
    if (!isInitialLoadDoneRef.current) return;
    saveSavingsBooksToFile(books).catch((err) => {
      console.error('[useSavingsBooks] Lỗi lưu books vào file:', err);
    });
  }, [books]);

  // 3. Tự động lưu bản ghi tất toán vào Filesystem và localStorage
  useEffect(() => {
    if (!isInitialLoadDoneRef.current) return;
    const deduped = deduplicateSettlementAdjustments(settlementAdjustments);
    saveSettlementsToFile(deduped).catch((err) => {
      console.error('[useSavingsBooks] Lỗi lưu settlements vào file:', err);
    });
  }, [settlementAdjustments]);

  // Loại bỏ các sổ đã tất toán nếu còn sót trong books (không tự tạo thêm nhật ký ma)
  useEffect(() => {
    if (books.some((b) => b.status === 'settled')) {
      setBooks((prev) => prev.filter((b) => b.status !== 'settled'));
    }
  }, [books]);

  const activeBooks = useMemo(() => books.filter((b) => b.status === 'active'), [books]);
  const sortedBanksInfo = useMemo(() => getSortedBanksByUsage(books), [books, banksVersion]);

  const totalPrincipal = useMemo(
    () => activeBooks.reduce((sum, b) => sum + b.principal, 0),
    [activeBooks]
  );

  const totalEstimatedInterest = useMemo(() => {
    return activeBooks.reduce((sum, b) => {
      const days = Math.max(1, getDaysBetween(b.startDate, b.maturityDate));
      return sum + calculateInterest(b.principal, b.interestRate, days);
    }, 0);
  }, [activeBooks]);

  const filteredBooks = useMemo(() => {
    return activeBooks
      .filter((b) => {
        if (ownerFilter !== 'all' && getOwnerLabel(b.owner) !== getOwnerLabel(ownerFilter)) return false;
        if (bankFilter !== 'all' && b.bankId !== bankFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCode = b.bookCode.toLowerCase().includes(q);
          const matchBank = b.bankId.toLowerCase().includes(q);
          const matchTag = b.tag?.toLowerCase().includes(q);
          const matchNote = b.note?.toLowerCase().includes(q);
          if (!matchCode && !matchBank && !matchTag && !matchNote) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'maturity') {
          return a.maturityDate.localeCompare(b.maturityDate);
        }
        if (sortBy === 'principal') {
          return b.principal - a.principal;
        }
        return b.interestRate - a.interestRate;
      });
  }, [activeBooks, ownerFilter, bankFilter, searchQuery, sortBy]);

  const handleUpdateBook = useCallback(
    async (updatedBook: SavingsBook) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền chỉnh sửa hoặc tác động vào dữ liệu.');
        return;
      }
      const updated = books.map((b) => (b.id === updatedBook.id ? updatedBook : b));
      const nextBooks = sortAndReindexBooks(updated);
      setBooks(nextBooks);

      // Ghi nhận biến động vào vùng đệm Outbox để đồng bộ ngầm chuẩn xác
      await recordBookUpsert(updatedBook).catch((err) => console.warn('Lỗi ghi Outbox upsert:', err));

      if (onPushToDriveRef.current) {
        onPushToDriveRef.current(nextBooks, settlementAdjustments);
      }
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleSaveBook = useCallback(
    async (savedBook: SavingsBook) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền lưu hoặc thêm dữ liệu.');
        return;
      }
      const exists = books.some((b) => b.id === savedBook.id);
      const updated = exists
        ? books.map((b) => (b.id === savedBook.id ? savedBook : b))
        : [savedBook, ...books];
      const nextBooks = sortAndReindexBooks(updated);
      setBooks(nextBooks);

      // Ghi nhận biến động vào vùng đệm Outbox
      await recordBookUpsert(savedBook).catch((err) => console.warn('Lỗi ghi Outbox upsert:', err));

      if (onPushToDriveRef.current) {
        onPushToDriveRef.current(nextBooks, settlementAdjustments);
      }
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleDeleteBook = useCallback(
    async (bookId: string) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền xóa dữ liệu.');
        return false;
      }
      if (window.confirm('Bạn có chắc muốn xóa sổ tiết kiệm này khỏi danh mục không?')) {
        const updated = books.filter((b) => b.id !== bookId);
        const nextBooks = sortAndReindexBooks(updated);
        setBooks(nextBooks);

        // Ghi nhận xóa vào vùng đệm Outbox để chống Google Sheets hồi sinh lại sổ này
        await recordBookDelete(bookId).catch((err) => console.warn('Lỗi ghi Outbox delete:', err));

        if (onPushToDriveRef.current) {
          onPushToDriveRef.current(nextBooks, settlementAdjustments);
        }
        return true;
      }
      return false;
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleSettleBook = useCallback(
    async (
      bookId: string,
      extra?: { isEarlySettled: boolean; settlementDate: string; actualInterestVND: number }
    ) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền tất toán sổ tiết kiệm.');
        return;
      }
      const now = Date.now();
      if (actionLockRef.current[bookId] && now - actionLockRef.current[bookId] < 1200) {
        return;
      }
      actionLockRef.current[bookId] = now;

      const bookToSettle = books.find((b) => b.id === bookId);
      if (!bookToSettle) return;

      const isEarly = extra?.isEarlySettled ?? false;
      const rawSettlementDate = extra?.settlementDate || new Date().toISOString().slice(0, 10);
      const settlementDate = normalizeDateToISO(rawSettlementDate) || rawSettlementDate;
      const settlementYear = parseInt(settlementDate.slice(0, 4), 10) || new Date().getFullYear();
      const daysTotal = Math.max(1, getDaysBetween(bookToSettle.startDate, bookToSettle.maturityDate));
      const expectedTermInterest =
        bookToSettle.expectedTermInterest ??
        Math.round((bookToSettle.principal * (bookToSettle.interestRate / 100) * daysTotal) / 365);
      const actualInterestVND = extra?.actualInterestVND ?? expectedTermInterest;
      const lostInterestVND = isEarly ? Math.max(0, expectedTermInterest - actualInterestVND) : 0;

      const originalMaturityYear = bookToSettle.maturityDate
        ? parseInt(bookToSettle.maturityDate.slice(0, 4), 10)
        : settlementYear;

      const cleanBookCode = (bookToSettle.bookCode || '').replace(/\s+/g, '').toUpperCase();
      const isAlreadySettled = settlementAdjustments.some((a) => {
        const aCode = (a.bookCode || '').replace(/\s+/g, '').toUpperCase();
        const sameCode = cleanBookCode && aCode && cleanBookCode === aCode;
        const sameBank = a.bankId.toLowerCase() === bookToSettle.bankId.toLowerCase();
        const samePrincipal = Number(a.principal) === Number(bookToSettle.principal);
        const sameDate = normalizeDateToISO(a.settlementDate) === settlementDate;
        const sameType = a.settlementType === (isEarly ? 'early' : 'maturity');

        if (sameCode && sameDate && sameType && samePrincipal) return true;
        return sameBank && samePrincipal && sameDate && sameType;
      });

      let updatedAdjustments = settlementAdjustments;
      let newAdjustment: SettlementAdjustment | null = null;

      if (!isAlreadySettled) {
        const nextIdx = settlementAdjustments.length + 1;
        newAdjustment = {
          id: `ADJ_${nextIdx}_${cleanBookCode || 'SO'}`,
          bookCode: bookToSettle.bookCode,
          bankId: bookToSettle.bankId,
          owner: bookToSettle.owner,
          principal: bookToSettle.principal,
          settlementDate,
          settlementYear,
          settlementType: isEarly ? 'early' : 'maturity',
          actualInterestVND,
          expectedTermInterest,
          lostInterestVND,
          reinvested: false,
          note: isEarly
            ? (originalMaturityYear > settlementYear
                ? `Tất toán trước hạn ngày ${formatDateVN(settlementDate)}. Lãi thực nhận năm ${settlementYear}: +${formatDecimal(actualInterestVND / 1_000_000, 1)} Tr. Lãi bị mất năm ${originalMaturityYear}: -${formatDecimal(expectedTermInterest / 1_000_000, 1)} Tr.`
                : `Tất toán trước hạn ngày ${formatDateVN(settlementDate)}. Lãi thực nhận năm ${settlementYear}: +${formatDecimal(actualInterestVND / 1_000_000, 1)} Tr. Lãi bị mất năm ${settlementYear}: -${formatDecimal(lostInterestVND / 1_000_000, 1)} Tr.`
              )
            : `Tất toán đúng hạn ngày ${formatDateVN(settlementDate)}. Lãi nhận đủ năm ${settlementYear}: +${formatDecimal(actualInterestVND / 1_000_000, 1)} Tr.`,
          timestamp: Date.now(),
          originalMaturityYear,
        };
        updatedAdjustments = deduplicateSettlementAdjustments([newAdjustment, ...settlementAdjustments]);
        setSettlementAdjustments(updatedAdjustments);

        // Ghi nhận vào vùng đệm Outbox
        await recordBookSettle(bookId, newAdjustment).catch((err) => console.warn('Lỗi ghi Outbox settle:', err));

        // Ghi nhật ký kiểm toán cho thao tác tất toán sổ
        recordSyncAuditLog({
          type: 'SETTLEMENT_CHANGE',
          title: isEarly ? 'Tất toán sổ tiết kiệm trước hạn' : 'Tất toán sổ tiết kiệm đúng hạn',
          status: 'info',
          summary: `Sổ ${bookToSettle.bookCode || bookToSettle.bankId.toUpperCase()} (${(bookToSettle.principal / 1_000_000).toLocaleString('vi-VN')} Tr) đã được tất toán vào ngày ${formatDateVN(settlementDate)}.`,
          details: {
            bookCode: bookToSettle.bookCode,
            bankId: bookToSettle.bankId,
            owner: getOwnerLabel(bookToSettle.owner),
            principalMillion: bookToSettle.principal / 1_000_000,
            settlementDate,
            settlementType: isEarly ? 'early' : 'maturity',
            actualInterestMillion: actualInterestVND / 1_000_000,
            lostInterestMillion: lostInterestVND / 1_000_000,
          },
        });
      }

      const remainingBooks = books.filter((b) => b.id !== bookId);
      const nextBooks = sortAndReindexBooks(remainingBooks);
      setBooks(nextBooks);

      if (onPushToDriveRef.current) {
        onPushToDriveRef.current(nextBooks, updatedAdjustments);
      }
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleRolloverBook = useCallback(
    async (
      oldBookId: string,
      rolloverConfig: {
        newPrincipal: number;
        newInterestRate: number;
        newTermMonths: number;
        newStartDate: string;
        newMaturityDate: string;
      }
    ) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền tái tục sổ tiết kiệm.');
        return;
      }
      const now = Date.now();
      if (actionLockRef.current[oldBookId] && now - actionLockRef.current[oldBookId] < 1200) {
        return;
      }
      actionLockRef.current[oldBookId] = now;

      const oldBook = books.find((b) => b.id === oldBookId);
      if (!oldBook) return;

      const rawSettlementDate = rolloverConfig.newStartDate;
      const settlementDate = normalizeDateToISO(rawSettlementDate) || rawSettlementDate;
      const settlementYear = parseInt(settlementDate.slice(0, 4), 10) || new Date().getFullYear();
      const daysTotal = Math.max(1, getDaysBetween(oldBook.startDate, oldBook.maturityDate));
      const expectedTermInterest =
        oldBook.expectedTermInterest ??
        Math.round((oldBook.principal * (oldBook.interestRate / 100) * daysTotal) / 365);

      const cleanBookCode = (oldBook.bookCode || '').replace(/\s+/g, '').toUpperCase();
      const isAlreadyRolled = settlementAdjustments.some((a) => {
        const aCode = (a.bookCode || '').replace(/\s+/g, '').toUpperCase();
        const sameCode = cleanBookCode && aCode && cleanBookCode === aCode;
        const sameBank = a.bankId.toLowerCase() === oldBook.bankId.toLowerCase();
        const samePrincipal = Number(a.principal) === Number(oldBook.principal);
        const sameDate = normalizeDateToISO(a.settlementDate) === settlementDate;

        if (sameCode && sameDate && samePrincipal) return true;
        return sameBank && samePrincipal && sameDate;
      });

      let updatedAdjustments = settlementAdjustments;
      if (!isAlreadyRolled) {
        const newAdjustment: SettlementAdjustment = {
          id: 'rollover_' + Math.random().toString(36).substring(2, 9),
          bookCode: oldBook.bookCode,
          bankId: oldBook.bankId,
          owner: oldBook.owner,
          principal: oldBook.principal,
          settlementDate,
          settlementYear,
          settlementType: 'maturity',
          actualInterestVND: expectedTermInterest,
          expectedTermInterest,
          lostInterestVND: 0,
          reinvested: true,
          note: `Tất toán đáo hạn & tái tục chu kỳ mới từ ${formatDateVN(settlementDate)}. Lãi ghi nhận: ${formatDecimal(
            expectedTermInterest / 1_000_000,
            2
          )} Tr.`,
          timestamp: Date.now(),
        };

        updatedAdjustments = deduplicateSettlementAdjustments([newAdjustment, ...settlementAdjustments]);
        setSettlementAdjustments(updatedAdjustments);

        // Ghi nhận tất toán sổ cũ vào vùng đệm Outbox
        await recordBookSettle(oldBookId, newAdjustment).catch((err) => console.warn('Lỗi ghi Outbox settle:', err));

        // Ghi nhật ký kiểm toán cho thao tác tất toán & tái tục
        recordSyncAuditLog({
          type: 'SETTLEMENT_CHANGE',
          title: 'Tất toán & Tái tục chu kỳ mới',
          status: 'info',
          summary: `Sổ ${oldBook.bookCode || oldBook.bankId.toUpperCase()} đã đáo hạn và được tái tục thành sổ mới ${(
            rolloverConfig.newPrincipal / 1_000_000
          ).toLocaleString('vi-VN')} Tr (Lãi suất: ${rolloverConfig.newInterestRate}%).`,
          details: {
            oldBookCode: oldBook.bookCode,
            bankId: oldBook.bankId,
            owner: getOwnerLabel(oldBook.owner),
            oldPrincipalMillion: oldBook.principal / 1_000_000,
            newPrincipalMillion: rolloverConfig.newPrincipal / 1_000_000,
            newInterestRate: rolloverConfig.newInterestRate,
            settlementDate,
            interestEarnedMillion: expectedTermInterest / 1_000_000,
          },
        });
      }

      const newBook: SavingsBook = {
        id: 'book_' + Math.random().toString(36).substring(2, 9),
        bookCode: '', // sortAndReindexBooks tự sinh chuẩn
        bankId: oldBook.bankId,
        owner: oldBook.owner,
        depositType: oldBook.depositType,
        principal: rolloverConfig.newPrincipal,
        interestRate: rolloverConfig.newInterestRate,
        termMonths: rolloverConfig.newTermMonths,
        startDate: rolloverConfig.newStartDate,
        maturityDate: rolloverConfig.newMaturityDate,
        rolloverOption: oldBook.rolloverOption,
        status: 'active' as BookStatus,
        note: `Tái tục chu kỳ mới từ sổ gốc ${oldBook.bookCode || ''}. Gốc cũ: ${(
          oldBook.principal / 1_000_000
        ).toLocaleString('vi-VN')} Tr.`,
      };

      // Ghi nhận sổ mới tạo vào Outbox
      await recordBookUpsert(newBook).catch((err) => console.warn('Lỗi ghi Outbox upsert:', err));

      const withoutOld = books.filter((b) => b.id !== oldBookId);
      const updated = [newBook, ...withoutOld];
      const nextBooks = sortAndReindexBooks(updated);
      setBooks(nextBooks);

      if (onPushToDriveRef.current) {
        onPushToDriveRef.current(nextBooks, updatedAdjustments);
      }
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleImportBooks = useCallback(
    async (newBooks: SavingsBook[], mode: 'replace' | 'merge' = 'replace') => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền nhập hoặc thay thế dữ liệu.');
        return;
      }
      let finalBooks = newBooks;
      if (mode === 'merge') {
        const existingMap = new Map<string, SavingsBook>(books.map((b) => [b.id, b]));
        newBooks.forEach((b) => existingMap.set(b.id, b));
        finalBooks = Array.from(existingMap.values());
      }
      const reindexed = sortAndReindexBooks(finalBooks);
      setBooks(reindexed);

      for (const b of reindexed) {
        await recordBookUpsert(b).catch(() => {});
      }

      if (onPushToDriveRef.current) {
        onPushToDriveRef.current(reindexed, settlementAdjustments);
      }
    },
    [books, settlementAdjustments, currentRole]
  );

  const handleDeleteSettlementAdjustment = useCallback(
    (id: string) => {
      if (!canEditData(currentRole)) {
        alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền xóa nhật ký tất toán.');
        return;
      }
      setSettlementAdjustments((prev) => {
        const next = prev.filter((a) => a.id !== id);
        saveSettlementsToFile(next).catch(() => {});
        if (onPushToDriveRef.current) {
          onPushToDriveRef.current(books, next);
        }
        return next;
      });
      onShowSyncStatusRef.current?.('Đã xóa 1 bản ghi nhật ký tất toán.');
    },
    [books, currentRole]
  );

  const handleDeleteAllAppData = useCallback(async () => {
    if (!canEditData(currentRole)) {
      alert('Tài khoản của bạn ở vai trò "Chỉ xem (Viewer)". Bạn không có quyền xóa toàn bộ dữ liệu.');
      return;
    }
    setBooks([]);
    setSettlementAdjustments([]);
    try {
      await clearAllLocalAppFiles();
      await clearOutbox();
      clearStaticHistoryFromStorage();
    } catch {
      // ignore
    }
    onShowSyncStatus?.('Đã xóa toàn bộ dữ liệu trên ứng dụng.');
  }, [onShowSyncStatus, currentRole]);

  return {
    books,
    setBooks,
    settlementAdjustments,
    setSettlementAdjustments,
    activeBooks,
    totalPrincipal,
    totalEstimatedInterest,
    sortedBanksInfo,
    banksVersion,
    setBanksVersion,
    searchQuery,
    setSearchQuery,
    ownerFilter,
    setOwnerFilter,
    bankFilter,
    setBankFilter,
    sortBy,
    setSortBy,
    filteredBooks,
    handleUpdateBook,
    handleSaveBook,
    handleDeleteBook,
    handleSettleBook,
    handleRolloverBook,
    handleImportBooks,
    handleDeleteSettlementAdjustment,
    handleDeleteAllAppData,
    isLoadingStorage,
  };
}
