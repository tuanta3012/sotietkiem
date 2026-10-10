import { SavingsBook, SettlementAdjustment } from '../types';
import { readCustomJsonFile, writeCustomJsonFile, FILE_NAMES } from './fileStorage';

export type MutationType = 'ADD_OR_UPDATE_BOOK' | 'DELETE_BOOK' | 'SETTLE_BOOK';

export interface OutboxMutation {
  id: string;
  type: MutationType;
  bookId: string;
  bookData?: SavingsBook;
  settlementData?: SettlementAdjustment;
  timestamp: number;
}

export interface SyncOutboxData {
  pendingMutations: OutboxMutation[];
  deletedBookIds: string[];
  lastLocalModified: number;
}

const DEFAULT_OUTBOX: SyncOutboxData = {
  pendingMutations: [],
  deletedBookIds: [],
  lastLocalModified: 0,
};

let inMemoryOutboxCache: SyncOutboxData | null = null;

/**
 * Lấy toàn bộ dữ liệu vùng đệm Outbox từ Filesystem
 */
export async function getOutboxData(): Promise<SyncOutboxData> {
  if (inMemoryOutboxCache) {
    return inMemoryOutboxCache;
  }
  const data = await readCustomJsonFile<SyncOutboxData>(FILE_NAMES.SYNC_OUTBOX, DEFAULT_OUTBOX);
  inMemoryOutboxCache = {
    pendingMutations: Array.isArray(data.pendingMutations) ? data.pendingMutations : [],
    deletedBookIds: Array.isArray(data.deletedBookIds) ? data.deletedBookIds : [],
    lastLocalModified: typeof data.lastLocalModified === 'number' ? data.lastLocalModified : 0,
  };
  return inMemoryOutboxCache;
}

/**
 * Lưu dữ liệu vùng đệm Outbox xuống Filesystem
 */
async function saveOutboxData(data: SyncOutboxData): Promise<void> {
  inMemoryOutboxCache = data;
  await writeCustomJsonFile(FILE_NAMES.SYNC_OUTBOX, data);
}

/**
 * Ghi nhận hành động thêm hoặc sửa sổ tiết kiệm vào Outbox
 */
export async function recordBookUpsert(book: SavingsBook): Promise<void> {
  const outbox = await getOutboxData();
  const now = Date.now();

  // Nếu cuốn sổ này từng nằm trong danh sách xóa, gỡ nó ra khỏi deletedBookIds
  const nextDeleted = outbox.deletedBookIds.filter((id) => id !== book.id);

  // Cập nhật mutation: Nếu đã có mutation cho bookId này, thay thế bằng bản mới nhất
  const filteredMutations = outbox.pendingMutations.filter((m) => m.bookId !== book.id);
  const newMutation: OutboxMutation = {
    id: `mut_${now}_${Math.random().toString(36).substring(2, 7)}`,
    type: 'ADD_OR_UPDATE_BOOK',
    bookId: book.id,
    bookData: book,
    timestamp: now,
  };

  await saveOutboxData({
    pendingMutations: [...filteredMutations, newMutation],
    deletedBookIds: nextDeleted,
    lastLocalModified: now,
  });
}

/**
 * Ghi nhận hành động xóa sổ tiết kiệm vào Outbox
 * Quan trọng: Lưu bookId vào deletedBookIds để ngăn Google Sheets "hồi sinh" cuốn sổ này khi merge!
 */
export async function recordBookDelete(bookId: string): Promise<void> {
  const outbox = await getOutboxData();
  const now = Date.now();

  // Bổ sung bookId vào deletedBookIds nếu chưa có
  const nextDeleted = outbox.deletedBookIds.includes(bookId)
    ? outbox.deletedBookIds
    : [...outbox.deletedBookIds, bookId];

  // Xóa các mutation thêm/sửa trước đó của bookId này
  const filteredMutations = outbox.pendingMutations.filter((m) => m.bookId !== bookId);
  const newMutation: OutboxMutation = {
    id: `mut_${now}_${Math.random().toString(36).substring(2, 7)}`,
    type: 'DELETE_BOOK',
    bookId,
    timestamp: now,
  };

  await saveOutboxData({
    pendingMutations: [...filteredMutations, newMutation],
    deletedBookIds: nextDeleted,
    lastLocalModified: now,
  });
}

/**
 * Ghi nhận hành động tất toán sổ tiết kiệm vào Outbox
 */
export async function recordBookSettle(
  bookId: string,
  settlement: SettlementAdjustment
): Promise<void> {
  const outbox = await getOutboxData();
  const now = Date.now();

  const nextDeleted = outbox.deletedBookIds.includes(bookId)
    ? outbox.deletedBookIds
    : [...outbox.deletedBookIds, bookId];

  const filteredMutations = outbox.pendingMutations.filter((m) => m.bookId !== bookId);
  const newMutation: OutboxMutation = {
    id: `mut_${now}_${Math.random().toString(36).substring(2, 7)}`,
    type: 'SETTLE_BOOK',
    bookId,
    settlementData: settlement,
    timestamp: now,
  };

  await saveOutboxData({
    pendingMutations: [...filteredMutations, newMutation],
    deletedBookIds: nextDeleted,
    lastLocalModified: now,
  });
}

/**
 * Xóa danh sách các mutation đã được đồng bộ thành công lên Google Drive
 */
export async function acknowledgeSyncedMutations(mutationIds: string[]): Promise<void> {
  const outbox = await getOutboxData();
  const idSet = new Set(mutationIds);
  const remaining = outbox.pendingMutations.filter((m) => !idSet.has(m.id));
  await saveOutboxData({
    ...outbox,
    pendingMutations: remaining,
  });
}

/**
 * Xóa các ID sổ đã được xóa thành công trên Google Sheets
 */
export async function acknowledgeDeletedBooks(deletedIds: string[]): Promise<void> {
  const outbox = await getOutboxData();
  const idSet = new Set(deletedIds);
  const remaining = outbox.deletedBookIds.filter((id) => !idSet.has(id));
  await saveOutboxData({
    ...outbox,
    deletedBookIds: remaining,
  });
}

/**
 * Lấy danh sách ID các sổ đã xóa cục bộ
 */
export async function getDeletedBookIds(): Promise<string[]> {
  const outbox = await getOutboxData();
  return outbox.deletedBookIds;
}

/**
 * Làm rỗng vùng đệm Outbox khi liên kết file mới hoặc dọn dẹp
 */
export async function clearOutbox(): Promise<void> {
  inMemoryOutboxCache = {
    pendingMutations: [],
    deletedBookIds: [],
    lastLocalModified: 0,
  };
  await saveOutboxData(inMemoryOutboxCache);
}
