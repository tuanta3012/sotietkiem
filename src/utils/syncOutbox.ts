import { SavingsBook, SettlementAdjustment } from '../types';
import { readCustomJsonFile, writeCustomJsonFile, FILE_NAMES } from './fileStorage';
import { getBookIdentityKeys } from './bookIdentity';

export type MutationType =
  | 'ADD_OR_UPDATE_BOOK'
  | 'DELETE_BOOK'
  | 'SETTLE_BOOK'
  | 'DELETE_SETTLEMENT';

export interface OutboxMutation {
  id: string;
  type: MutationType;
  bookId: string;
  bookData?: SavingsBook;
  settlementData?: SettlementAdjustment;
  settlementId?: string;
  timestamp: number;
}

export interface BookTombstone {
  bookId: string;
  identityKeys: string[];
  timestamp: number;
}

export interface SyncOutboxData {
  pendingMutations: OutboxMutation[];
  deletedBookIds: string[];
  deletedBooks: BookTombstone[];
  deletedSettlementIds: string[];
  lastLocalModified: number;
}

const DEFAULT_OUTBOX: SyncOutboxData = {
  pendingMutations: [],
  deletedBookIds: [],
  deletedBooks: [],
  deletedSettlementIds: [],
  lastLocalModified: 0,
};

let inMemoryOutboxCache: SyncOutboxData | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function newMutationId(): string {
  return globalThis.crypto?.randomUUID?.() ||
    `mut_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

export async function getOutboxData(): Promise<SyncOutboxData> {
  if (inMemoryOutboxCache) return inMemoryOutboxCache;
  const data = await readCustomJsonFile<Partial<SyncOutboxData>>(FILE_NAMES.SYNC_OUTBOX, {});
  const legacyDeletedIds = Array.isArray(data.deletedBookIds) ? data.deletedBookIds : [];
  inMemoryOutboxCache = {
    pendingMutations: Array.isArray(data.pendingMutations) ? data.pendingMutations : [],
    deletedBookIds: legacyDeletedIds,
    deletedBooks: Array.isArray(data.deletedBooks)
      ? data.deletedBooks
      : legacyDeletedIds.map((bookId) => ({ bookId, identityKeys: [], timestamp: 0 })),
    deletedSettlementIds: Array.isArray(data.deletedSettlementIds) ? data.deletedSettlementIds : [],
    lastLocalModified: typeof data.lastLocalModified === 'number' ? data.lastLocalModified : 0,
  };
  return inMemoryOutboxCache;
}

async function updateOutboxData(
  update: (outbox: SyncOutboxData) => SyncOutboxData
): Promise<void> {
  const write = writeQueue.then(async () => {
    const current = await getOutboxData();
    const data = update(current);
    const success = await writeCustomJsonFile(FILE_NAMES.SYNC_OUTBOX, data);
    if (!success) throw new Error('Không thể lưu hàng đợi đồng bộ vào bộ nhớ thiết bị.');
    inMemoryOutboxCache = data;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('savings-outbox-updated'));
    }
  });
  writeQueue = write.catch(() => {});
  await write;
}

export async function recordBookUpsert(book: SavingsBook): Promise<void> {
  const now = Date.now();
  const identityKeys = new Set(getBookIdentityKeys(book));
  const mutation: OutboxMutation = {
    id: newMutationId(), type: 'ADD_OR_UPDATE_BOOK', bookId: book.id, bookData: book, timestamp: now,
  };
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: [...outbox.pendingMutations.filter((item) => item.bookId !== book.id), mutation],
    deletedBookIds: outbox.deletedBookIds.filter((id) => id !== book.id),
    deletedBooks: outbox.deletedBooks.filter(
      (item) => item.bookId !== book.id && !item.identityKeys.some((key) => identityKeys.has(key))
    ),
    lastLocalModified: now,
  }));
}

export async function recordBookDelete(book: SavingsBook): Promise<void> {
  const now = Date.now();
  const tombstone: BookTombstone = {
    bookId: book.id,
    identityKeys: getBookIdentityKeys(book),
    timestamp: now,
  };
  const mutation: OutboxMutation = {
    id: newMutationId(), type: 'DELETE_BOOK', bookId: book.id, bookData: book, timestamp: now,
  };
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: [
      ...outbox.pendingMutations.filter((item) => item.bookId !== book.id),
      mutation,
    ],
    deletedBookIds: [...new Set([...outbox.deletedBookIds, book.id])],
    deletedBooks: [...outbox.deletedBooks.filter((item) => item.bookId !== book.id), tombstone],
    lastLocalModified: now,
  }));
}

export async function recordBookSettle(
  bookId: string,
  settlement: SettlementAdjustment,
  book?: SavingsBook
): Promise<void> {
  const now = Date.now();
  const tombstone: BookTombstone | null = book
    ? { bookId, identityKeys: getBookIdentityKeys(book), timestamp: now }
    : null;
  const mutation: OutboxMutation = {
    id: newMutationId(), type: 'SETTLE_BOOK', bookId, settlementData: settlement, bookData: book, timestamp: now,
  };
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: [
      ...outbox.pendingMutations.filter((item) => item.bookId !== bookId),
      mutation,
    ],
    deletedBookIds: [...new Set([...outbox.deletedBookIds, bookId])],
    deletedBooks: tombstone
      ? [...outbox.deletedBooks.filter((item) => item.bookId !== bookId), tombstone]
      : outbox.deletedBooks,
    lastLocalModified: now,
  }));
}

export async function recordBookRollover(
  oldBook: SavingsBook,
  newBook: SavingsBook,
  settlement: SettlementAdjustment
): Promise<void> {
  const now = Date.now();
  const settleMutation: OutboxMutation = {
    id: newMutationId(),
    type: 'SETTLE_BOOK',
    bookId: oldBook.id,
    settlementData: settlement,
    bookData: oldBook,
    timestamp: now,
  };
  const upsertMutation: OutboxMutation = {
    id: newMutationId(),
    type: 'ADD_OR_UPDATE_BOOK',
    bookId: newBook.id,
    bookData: newBook,
    timestamp: now,
  };
  const tombstone: BookTombstone = {
    bookId: oldBook.id,
    identityKeys: getBookIdentityKeys(oldBook),
    timestamp: now,
  };
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: [
      ...outbox.pendingMutations.filter(
        (item) => item.bookId !== oldBook.id && item.bookId !== newBook.id
      ),
      settleMutation,
      upsertMutation,
    ],
    deletedBookIds: [...new Set([...outbox.deletedBookIds, oldBook.id])],
    deletedBooks: [...outbox.deletedBooks.filter((item) => item.bookId !== oldBook.id), tombstone],
    lastLocalModified: now,
  }));
}

export async function recordSettlementDelete(settlement: SettlementAdjustment): Promise<void> {
  const now = Date.now();
  const mutation: OutboxMutation = {
    id: newMutationId(),
    type: 'DELETE_SETTLEMENT',
    bookId: `settlement:${settlement.id}`,
    settlementId: settlement.id,
    settlementData: settlement,
    timestamp: now,
  };
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: [
      ...outbox.pendingMutations.filter((item) => item.settlementId !== settlement.id),
      mutation,
    ],
    deletedSettlementIds: [...new Set([...outbox.deletedSettlementIds, settlement.id])],
    lastLocalModified: now,
  }));
}

export async function acknowledgeSyncedMutations(mutationIds: string[]): Promise<void> {
  const idSet = new Set(mutationIds);
  await updateOutboxData((outbox) => ({
    ...outbox,
    pendingMutations: outbox.pendingMutations.filter((mutation) => !idSet.has(mutation.id)),
  }));
}

export async function acknowledgeDeletedBooks(syncedTombstones: BookTombstone[]): Promise<void> {
  const syncedKeys = new Set(syncedTombstones.map((item) => `${item.bookId}:${item.timestamp}`));
  await updateOutboxData((outbox) => {
    const acknowledgedIds = new Set(
      outbox.deletedBooks
        .filter((item) => syncedKeys.has(`${item.bookId}:${item.timestamp}`))
        .map((item) => item.bookId)
    );
    return {
      ...outbox,
      deletedBookIds: outbox.deletedBookIds.filter((id) => !acknowledgedIds.has(id)),
      deletedBooks: outbox.deletedBooks.filter(
        (item) => !syncedKeys.has(`${item.bookId}:${item.timestamp}`)
      ),
    };
  });
}

export async function acknowledgeDeletedSettlements(deletedIds: string[]): Promise<void> {
  const idSet = new Set(deletedIds);
  await updateOutboxData((outbox) => ({
    ...outbox,
    deletedSettlementIds: outbox.deletedSettlementIds.filter((id) => !idSet.has(id)),
  }));
}

export async function getDeletedBookIds(): Promise<string[]> {
  return (await getOutboxData()).deletedBookIds;
}

export async function clearOutbox(): Promise<void> {
  await updateOutboxData(() => ({ ...DEFAULT_OUTBOX }));
}
