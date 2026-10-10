import { describe, expect, it } from 'vitest';
import { SavingsBook, SettlementAdjustment } from '../../types';
import { booksHaveSameSheetData, settlementsHaveSameSheetData } from '../useDriveSync';

const localBook: SavingsBook = {
  id: 'local-random-id',
  bookCode: 'SHB-01',
  bankId: 'shb',
  owner: 'Chồng',
  depositType: 'online',
  principal: 1_000_000_000,
  interestRate: 6.5,
  termMonths: 12,
  startDate: '2026-01-01',
  maturityDate: '2027-01-01',
  rolloverOption: 'principal_and_interest',
  status: 'active',
};

const settlement: SettlementAdjustment = {
  id: 'settlement-1',
  bookCode: 'SHB-01',
  bankId: 'shb',
  owner: 'Chồng',
  principal: 1_000_000_000,
  settlementDate: '2026-06-01',
  settlementYear: 2026,
  settlementType: 'early',
  actualInterestVND: 10_000_000,
  timestamp: 1,
};

describe('sync conflict snapshot comparison', () => {
  it('ignores generated book IDs that are not stored in the Sheet', () => {
    expect(
      booksHaveSameSheetData(
        [{ ...localBook, principal: 1_000_400_000, interestRate: 6.504, bookCode: 'LOCAL-CODE' }],
        [{ ...localBook, id: 'drive-generated-id', principal: 1_000_000_000, interestRate: 6.5, bookCode: 'DRIVE-CODE' }]
      )
    ).toBe(true);
  });

  it('detects financial data changes in books and settlement records', () => {
    expect(booksHaveSameSheetData([localBook], [{ ...localBook, principal: 900_000_000 }])).toBe(false);
    expect(settlementsHaveSameSheetData([settlement], [{ ...settlement, actualInterestVND: 11_000_000 }])).toBe(false);
    expect(settlementsHaveSameSheetData([settlement], [{ ...settlement, timestamp: 2 }])).toBe(true);
  });
});
