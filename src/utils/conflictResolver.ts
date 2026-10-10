import { SavingsBook, SettlementAdjustment, BookStatus } from '../types';
import { sortAndReindexBooks, deduplicateSettlementAdjustments, normalizeDateToISO } from './dataTranslator';
import { BookTombstone, OutboxMutation } from './syncOutbox';
import { getBookIdentityKeys } from './bookIdentity';

export interface MergeParams {
  localBooks: SavingsBook[];
  remoteBooks: SavingsBook[];
  localSettlements: SettlementAdjustment[];
  remoteSettlements: SettlementAdjustment[];
  deletedBookIds: string[];
  deletedBooks?: BookTombstone[];
  deletedSettlementIds?: string[];
  pendingMutations?: OutboxMutation[];
  baselineBooks?: SavingsBook[] | null;
  baselineSettlements?: SettlementAdjustment[] | null;
  conflictChoices?: Record<string, 'local' | 'remote'>;
}

export interface BookConflict {
  identityKey: string;
  bookCode: string;
  localBook: SavingsBook;
  remoteBook?: SavingsBook;
  changedFields: Array<'principal' | 'interestRate' | 'termMonths' | 'owner' | 'depositType' | 'startDate' | 'maturityDate' | 'deletedOnDrive'>;
}

export interface MergeResult {
  mergedBooks: SavingsBook[];
  mergedSettlements: SettlementAdjustment[];
  hasChangesToPush: boolean;
  newFromRemoteCount: number;
  newFromLocalCount: number;
  deletedCount: number;
  conflicts: BookConflict[];
}

/**
 * Kiểm tra xem 2 cuốn sổ có giống nhau về mặt dữ liệu bảng tính hay không
 */
export function areBooksEqual(a: SavingsBook, b: SavingsBook): boolean {
  return (
    (a.bookCode || '').replace(/\s+/g, '').toUpperCase() === (b.bookCode || '').replace(/\s+/g, '').toUpperCase() &&
    a.bankId.toLowerCase() === b.bankId.toLowerCase() &&
    Number(a.principal) === Number(b.principal) &&
    Number(a.interestRate) === Number(b.interestRate) &&
    Number(a.termMonths) === Number(b.termMonths) &&
    normalizeDateToISO(a.startDate) === normalizeDateToISO(b.startDate) &&
    normalizeDateToISO(a.maturityDate) === normalizeDateToISO(b.maturityDate) &&
    a.owner === b.owner &&
    (a.depositType || 'counter') === (b.depositType || 'counter') &&
    (a.status || 'active') === (b.status || 'active') &&
    (a.rolloverOption || 'both') === (b.rolloverOption || 'both')
  );
}

/**
 * Kiểm tra xem 2 danh sách sổ có hoàn toàn đồng nhất dữ liệu không
 */
export function booksHaveSameSheetData(a: SavingsBook[], b: SavingsBook[]): boolean {
  if (a.length !== b.length) return false;
  const mapA = new Map<string, SavingsBook>();
  for (const item of a) {
    const key = `${item.id || ''}_${(item.bookCode || '').replace(/\s+/g, '').toUpperCase()}_${item.bankId}_${item.principal}`;
    mapA.set(key, item);
  }
  for (const item of b) {
    const key = `${item.id || ''}_${(item.bookCode || '').replace(/\s+/g, '').toUpperCase()}_${item.bankId}_${item.principal}`;
    const match = mapA.get(key);
    if (!match || !areBooksEqual(match, item)) {
      return false;
    }
  }
  return true;
}

/**
 * Kiểm tra xem 2 danh sách tất toán có đồng nhất không
 */
export function settlementsHaveSameSheetData(a: SettlementAdjustment[], b: SettlementAdjustment[]): boolean {
  if (a.length !== b.length) return false;
  const dedupedA = deduplicateSettlementAdjustments(a);
  const dedupedB = deduplicateSettlementAdjustments(b);
  if (dedupedA.length !== dedupedB.length) return false;

  const setB = new Set(
    dedupedB.map(
      (s) =>
        `${(s.bookCode || '').replace(/\s+/g, '').toUpperCase()}_${s.bankId.toLowerCase()}_${s.principal}_${normalizeDateToISO(s.settlementDate)}_${s.settlementType}`
    )
  );

  for (const s of dedupedA) {
    const key = `${(s.bookCode || '').replace(/\s+/g, '').toUpperCase()}_${s.bankId.toLowerCase()}_${s.principal}_${normalizeDateToISO(s.settlementDate)}_${s.settlementType}`;
    if (!setB.has(key)) return false;
  }
  return true;
}

/**
 * Tạo signature duy nhất cho 1 cuốn sổ để so khớp thực thể (kể cả khi ID trên máy khác nhau)
 */
function getBookEntityKey(b: SavingsBook): string {
  return getBookIdentityKeys(b)[0];
}

function getChangedFinancialFields(
  base: SavingsBook,
  local: SavingsBook,
  remote: SavingsBook
): BookConflict['changedFields'] {
  const fields: BookConflict['changedFields'] = [
    'principal', 'interestRate', 'termMonths', 'owner', 'depositType', 'startDate', 'maturityDate',
  ];
  return fields.filter((field) =>
    JSON.stringify(local[field]) !== JSON.stringify(base[field]) &&
    JSON.stringify(remote[field]) !== JSON.stringify(base[field]) &&
    JSON.stringify(local[field]) !== JSON.stringify(remote[field])
  );
}

function getSettlementIdentity(settlement: SettlementAdjustment): string {
  return [
    (settlement.bookCode || '').replace(/\s+/g, '').toUpperCase(),
    settlement.bankId.toLowerCase(),
    settlement.owner,
    Number(settlement.principal),
    normalizeDateToISO(settlement.settlementDate),
    settlement.settlementType,
  ].join('|');
}

/**
 * Thuật toán Hợp nhất Dữ liệu Cấp độ Bản ghi (Granular Record-Level Merging)
 * 
 * 1. Tất toán (Settlements): Hợp nhất toàn diện cả local & remote, chống trùng lặp.
 * 2. Bảo toàn trạng thái tất toán: Bất kỳ cuốn sổ nào đã có lịch sử tất toán đều bị gỡ khỏi danh sách sổ active.
 * 3. Chống hồi sinh sổ đã xóa: Bất kỳ sổ nào có ID hoặc entity key nằm trong `deletedBookIds` đều bị loại bỏ, không kéo từ Sheets về.
 * 4. Bản ghi không xung đột: Sổ mới ở Local và sổ mới ở Remote đều được giữ lại nguyên vẹn (Gia đình thêm sổ ở 2 máy khác nhau).
 * 5. Xung đột cùng 1 sổ: Ưu tiên mutation mới nhất hoặc phiên bản cập nhật gần nhất.
 */
export function mergeBooksAndSettlements({
  localBooks,
  remoteBooks,
  localSettlements,
  remoteSettlements,
  deletedBookIds,
  deletedBooks = [],
  deletedSettlementIds = [],
  pendingMutations = [],
  baselineBooks = null,
  baselineSettlements = null,
  conflictChoices = {},
}: MergeParams): MergeResult {
  const deletedSet = new Set(deletedBookIds);
  const deletedIdentityKeys = new Set(deletedBooks.flatMap((item) => item.identityKeys));

  // 1. Hợp nhất danh sách tất toán
  const deletedSettlementSet = new Set(deletedSettlementIds);
  const remoteSettlementKeys = new Set(remoteSettlements.map(getSettlementIdentity));
  const baselineSettlementKeys = new Set((baselineSettlements || []).map(getSettlementIdentity));
  const combinedSettlements = deduplicateSettlementAdjustments([
    ...remoteSettlements,
    ...localSettlements.filter((settlement) =>
      !(
        baselineSettlementKeys.has(getSettlementIdentity(settlement)) &&
        !remoteSettlementKeys.has(getSettlementIdentity(settlement))
      )
    ),
  ]).filter((settlement) => !deletedSettlementSet.has(settlement.id));

  // Tập hợp các định danh đã tất toán để loại bỏ khỏi active books
  const settledSignatures = new Set<string>();
  for (const s of combinedSettlements) {
    const code = (s.bookCode || '').replace(/\s+/g, '').toUpperCase();
    if (code) {
      settledSignatures.add(`CODE_${s.bankId.toLowerCase()}_${code}`);
    }
    settledSignatures.add(`BANK_PRINCIPAL_${s.bankId.toLowerCase()}_${s.principal}`);
  }

  // Lập bản đồ mutations theo bookId
  const mutationMap = new Map<string, OutboxMutation>();
  const identityMutationMap = new Map<string, OutboxMutation>();
  for (const mut of pendingMutations) {
    mutationMap.set(mut.bookId, mut);
    if (mut.bookData) {
      for (const key of getBookIdentityKeys(mut.bookData)) identityMutationMap.set(key, mut);
    }
  }

  // Chuẩn bị danh sách merged books
  const mergedMap = new Map<string, SavingsBook>();
  let newFromRemoteCount = 0;
  let newFromLocalCount = 0;
  let deletedCount = 0;
  const conflicts: BookConflict[] = [];

  // 2. Duyệt qua remoteBooks (dữ liệu từ Google Sheets)
  for (const rBook of remoteBooks) {
    // Nếu cuốn sổ này đã bị xóa ở local -> BỎ QUA, không tải lại
    if (
      deletedSet.has(rBook.id) ||
      getBookIdentityKeys(rBook).some((key) => deletedIdentityKeys.has(key))
    ) {
      deletedCount++;
      continue;
    }

    const entityKey = getBookEntityKey(rBook);
    const code = (rBook.bookCode || '').replace(/\s+/g, '').toUpperCase();
    const isSettledByCode = code ? settledSignatures.has(`CODE_${rBook.bankId.toLowerCase()}_${code}`) : false;

    if (rBook.status === 'settled' || isSettledByCode) {
      // Đã tất toán -> không đưa vào active books
      continue;
    }

    // Kiểm tra xem local có cuốn sổ này không
    const localMatch = localBooks.find(
      (lb) => lb.id === rBook.id || getBookIdentityKeys(lb).some((key) =>
        getBookIdentityKeys(rBook).includes(key)
      )
    );

    if (!localMatch) {
      // Sổ mới trên Google Sheets do thành viên gia đình khác tạo -> Kéo về máy
      mergedMap.set(entityKey, { ...rBook, status: 'active' as BookStatus });
      newFromRemoteCount++;
    } else {
      // Cả hai bên đều có cuốn sổ này
      const localMutation =
        mutationMap.get(localMatch.id) ||
        getBookIdentityKeys(localMatch).map((key) => identityMutationMap.get(key)).find(Boolean);
      const baseline = baselineBooks?.find((book) =>
        getBookIdentityKeys(book).some((key) => getBookIdentityKeys(localMatch).includes(key))
      );
      if (baseline) {
        const changedFields = getChangedFinancialFields(baseline, localMatch, rBook);
        const choice = conflictChoices[entityKey];
        if (changedFields.length > 0 && !choice) {
          conflicts.push({
            identityKey: entityKey,
            bookCode: localMatch.bookCode || rBook.bookCode,
            localBook: localMatch,
            remoteBook: rBook,
            changedFields,
          });
        }
        const mergedBook: SavingsBook = { ...rBook };
        const financialFields: Array<keyof SavingsBook> = [
          'principal', 'interestRate', 'termMonths', 'owner', 'depositType', 'startDate', 'maturityDate',
        ];
        for (const field of financialFields) {
          const localChanged = JSON.stringify(localMatch[field]) !== JSON.stringify(baseline[field]);
          const remoteChanged = JSON.stringify(rBook[field]) !== JSON.stringify(baseline[field]);
          const valuesConflict =
            localChanged &&
            remoteChanged &&
            JSON.stringify(localMatch[field]) !== JSON.stringify(rBook[field]);
          if (localChanged && (!remoteChanged || (valuesConflict && choice === 'local'))) {
            Object.assign(mergedBook, { [field]: localMatch[field] });
          }
        }
        mergedMap.set(entityKey, { ...mergedBook, status: 'active' as BookStatus });
      } else if (localMutation?.type === 'ADD_OR_UPDATE_BOOK' && localMutation.bookData) {
        mergedMap.set(entityKey, { ...localMutation.bookData, status: 'active' as BookStatus });
      } else {
        mergedMap.set(entityKey, { ...rBook, status: 'active' as BookStatus });
      }
    }
  }

  // 3. Duyệt qua localBooks (dữ liệu trên máy)
  for (const lBook of localBooks) {
    // Nếu sổ này đã bị đánh dấu xóa trong outbox -> BỎ QUA
    if (
      deletedSet.has(lBook.id) ||
      getBookIdentityKeys(lBook).some((key) => deletedIdentityKeys.has(key))
    ) {
      continue;
    }

    const entityKey = getBookEntityKey(lBook);
    const code = (lBook.bookCode || '').replace(/\s+/g, '').toUpperCase();
    const isSettledByCode = code ? settledSignatures.has(`CODE_${lBook.bankId.toLowerCase()}_${code}`) : false;

    if (lBook.status === 'settled' || isSettledByCode) {
      // Đã tất toán -> Bỏ qua
      continue;
    }

    const baseline = baselineBooks?.find((book) =>
      getBookIdentityKeys(book).some((key) => getBookIdentityKeys(lBook).includes(key))
    );
    const remoteMatch = remoteBooks.find((book) =>
      book.id === lBook.id ||
      getBookIdentityKeys(book).some((key) => getBookIdentityKeys(lBook).includes(key))
    );
    if (baseline && !remoteMatch) {
      if (!areBooksEqual(baseline, lBook)) {
        const conflict: BookConflict = {
          identityKey: entityKey,
          bookCode: lBook.bookCode,
          localBook: lBook,
          changedFields: ['deletedOnDrive'],
        };
        const choice = conflictChoices[entityKey];
        if (!choice) conflicts.push(conflict);
        if (choice === 'local') {
          mergedMap.set(entityKey, { ...lBook, status: 'active' as BookStatus });
        }
      }
      continue;
    }

    if (!mergedMap.has(entityKey)) {
      // Sổ mới tạo tại local (chưa có trên Sheets hoặc offline) -> Giữ lại để đẩy lên Sheets!
      mergedMap.set(entityKey, { ...lBook, status: 'active' as BookStatus });
      newFromLocalCount++;
    }
  }

  // 4. Sắp xếp và đánh lại chỉ số chuẩn hóa
  const finalBookList = Array.from(mergedMap.values());
  const finalReindexedBooks = sortAndReindexBooks(finalBookList);

  // 5. Kiểm tra xem dữ liệu merged có khác với remote không để quyết định đẩy ngược lên Drive
  const hasChangesToPush =
    !booksHaveSameSheetData(finalReindexedBooks, remoteBooks) ||
    !settlementsHaveSameSheetData(combinedSettlements, remoteSettlements) ||
    deletedCount > 0 ||
    newFromLocalCount > 0;

  return {
    mergedBooks: finalReindexedBooks,
    mergedSettlements: combinedSettlements,
    hasChangesToPush,
    newFromRemoteCount,
    newFromLocalCount,
    deletedCount,
    conflicts,
  };
}
