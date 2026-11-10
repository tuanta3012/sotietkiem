import { describe, expect, it } from 'vitest';
import { SavingsBook } from '../types';
import { sortAndReindexBooks } from './dataTranslator';

const makeBook = (overrides: Partial<SavingsBook> = {}): SavingsBook => ({
  id: 'book-shared-code',
  bookCode: 'SEA-2609-1100',
  bankId: 'seabank',
  owner: 'Owner',
  depositType: 'online',
  principal: 3_450_000_000,
  interestRate: 6.8,
  termMonths: 12,
  startDate: '2025-11-10',
  maturityDate: '2026-11-10',
  rolloverOption: 'none',
  status: 'active',
  ...overrides,
});

describe('sortAndReindexBooks', () => {
  it('repairs duplicate internal IDs without changing displayed book codes', () => {
    const first = makeBook();
    const second = makeBook({
      principal: 3_600_000_000,
      startDate: '2025-12-09',
      maturityDate: '2026-12-09',
    });

    const result = sortAndReindexBooks([first, second]);

    expect(result).toHaveLength(2);
    expect(result[0].bookCode).toBe(first.bookCode);
    expect(result[1].bookCode).toBe(second.bookCode);
    expect(new Set(result.map((book) => book.id)).size).toBe(2);
    expect(sortAndReindexBooks(result).map((book) => book.id)).toEqual(result.map((book) => book.id));
  });
});
