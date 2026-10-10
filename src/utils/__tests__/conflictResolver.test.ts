import { describe, expect, it } from 'vitest';
import { SavingsBook, SettlementAdjustment } from '../../types';
import { getBookIdentityKeys, getPrimaryBookIdentityKey } from '../bookIdentity';
import { mergeBooksAndSettlements } from '../conflictResolver';

const baseBook: SavingsBook = {
  id: 'local-book-id',
  bookCode: 'CERT-01',
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
};

const settlement: SettlementAdjustment = {
  id: 'settlement-1',
  bookCode: 'CERT-01',
  bankId: 'shb',
  owner: 'Chồng',
  principal: 100_000_000,
  settlementDate: '2026-06-01',
  settlementYear: 2026,
  settlementType: 'early',
  actualInterestVND: 3_000_000,
  timestamp: 1,
};

const merge = (overrides: Partial<Parameters<typeof mergeBooksAndSettlements>[0]> = {}) =>
  mergeBooksAndSettlements({
    localBooks: [],
    remoteBooks: [],
    localSettlements: [],
    remoteSettlements: [],
    deletedBookIds: [],
    ...overrides,
  });

describe('mergeBooksAndSettlements', () => {
  it('retains independent local and remote books', () => {
    const remoteBook = { ...baseBook, id: 'remote-id', bookCode: 'CERT-02' };
    const result = merge({
      localBooks: [baseBook],
      remoteBooks: [remoteBook],
    });

    expect(result.mergedBooks).toHaveLength(2);
  });

  it('matches a tombstone by business identity when Sheet IDs differ', () => {
    const remoteBook = { ...baseBook, id: 'sheet-generated-id' };
    const result = merge({
      remoteBooks: [remoteBook],
      deletedBookIds: ['local-book-id'],
      deletedBooks: [{
        bookId: 'local-book-id',
        identityKeys: getBookIdentityKeys(baseBook),
        timestamp: 10,
      }],
    });

    expect(result.mergedBooks).toHaveLength(0);
  });

  it('reports same-field financial edits and applies the selected side', () => {
    const localBook = { ...baseBook, principal: 110_000_000 };
    const remoteBook = { ...baseBook, principal: 120_000_000 };
    const args = {
      localBooks: [localBook],
      remoteBooks: [remoteBook],
      baselineBooks: [baseBook],
    };

    expect(merge(args).conflicts[0].changedFields).toContain('principal');
    expect(merge({ ...args, conflictChoices: { [getPrimaryBookIdentityKey(baseBook)]: 'local' } }).mergedBooks[0].principal)
      .toBe(110_000_000);
  });

  it('merges non-overlapping financial field edits', () => {
    const result = merge({
      localBooks: [{ ...baseBook, principal: 110_000_000 }],
      remoteBooks: [{ ...baseBook, interestRate: 5.5 }],
      baselineBooks: [baseBook],
    });

    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedBooks[0]).toMatchObject({
      principal: 110_000_000,
      interestRate: 5.5,
    });
  });

  it('keeps a remote deletion when local still matches the shared baseline', () => {
    const result = merge({
      localBooks: [baseBook],
      remoteBooks: [],
      baselineBooks: [baseBook],
    });

    expect(result.mergedBooks).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports a conflict when local edit races with a remote deletion', () => {
    const result = merge({
      localBooks: [{ ...baseBook, principal: 110_000_000 }],
      remoteBooks: [],
      baselineBooks: [baseBook],
    });

    expect(result.conflicts[0].changedFields).toContain('deletedOnDrive');
  });

  it('applies settlement tombstones and keeps independent settlement rows', () => {
    const result = merge({
      localSettlements: [settlement],
      remoteSettlements: [settlement, { ...settlement, id: 'settlement-2', bookCode: 'CERT-02' }],
      deletedSettlementIds: ['settlement-1'],
    });

    expect(result.mergedSettlements.map((item) => item.id)).toEqual(['settlement-2']);
  });
});
