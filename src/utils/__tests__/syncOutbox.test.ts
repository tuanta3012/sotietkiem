import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavingsBook } from '../../types';

const storage = vi.hoisted(() => ({
  value: null as unknown,
  failWrites: false,
}));

vi.mock('../fileStorage', () => ({
  FILE_NAMES: { SYNC_OUTBOX: 'sync_outbox.json' },
  readCustomJsonFile: async (_filename: string, fallback: unknown) => storage.value ?? fallback,
  writeCustomJsonFile: async (_filename: string, value: unknown) => {
    if (storage.failWrites) return false;
    storage.value = value;
    return true;
  },
}));

import {
  acknowledgeDeletedBooks,
  acknowledgeSyncedMutations,
  getOutboxData,
  recordBookDelete,
  recordBookUpsert,
} from '../syncOutbox';

const book = (id: string): SavingsBook => ({
  id,
  bookCode: `${id}-CODE`,
  bankId: 'shb',
  owner: 'Chồng',
  depositType: 'online',
  principal: 100_000_000,
  interestRate: 5,
  termMonths: 12,
  startDate: '2026-01-01',
  maturityDate: '2027-01-01',
  rolloverOption: 'principal_and_interest',
  status: 'active',
});

describe('sync outbox persistence', () => {
  beforeEach(() => {
    storage.value = null;
    storage.failWrites = false;
  });

  it('serializes concurrent mutations and only acknowledges selected mutation IDs', async () => {
    await Promise.all([
      recordBookUpsert(book('book-a')),
      recordBookUpsert(book('book-b')),
      recordBookUpsert(book('book-c')),
    ]);

    const queued = await getOutboxData();
    expect(queued.pendingMutations).toHaveLength(3);

    await acknowledgeSyncedMutations([queued.pendingMutations[0].id]);
    expect((await getOutboxData()).pendingMutations).toHaveLength(2);

    storage.failWrites = true;
    await expect(recordBookUpsert(book('book-d'))).rejects.toThrow('Không thể lưu hàng đợi');
    expect((await getOutboxData()).pendingMutations).toHaveLength(2);
  });

  it('does not acknowledge a newer delete for the same book', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await recordBookDelete(book('book-a'));
    const syncedSnapshot = (await getOutboxData()).deletedBooks;

    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    await recordBookDelete(book('book-a'));
    await acknowledgeDeletedBooks(syncedSnapshot);

    expect((await getOutboxData()).deletedBooks[0].timestamp).toBe(
      new Date('2026-01-01T00:00:01.000Z').getTime()
    );
    vi.useRealTimers();
  });
});
