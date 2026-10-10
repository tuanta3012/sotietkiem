import { describe, expect, it } from 'vitest';
import { parseMatrixData } from '../excelParser';
import { STANDARDIZED_SHEET_HEADERS } from '../dataSchema';

function makeSheet(rate = '6.5%', startDate = '2026-01-01') {
  const headers = [...STANDARDIZED_SHEET_HEADERS];
  const row: Array<string | number> = Array(headers.length).fill('');
  row[0] = 'SHB';
  row[1] = 'Chồng';
  row[2] = 'Online';
  row[3] = rate;
  row[4] = 1000;
  row[5] = startDate;
  row[6] = '2027-01-01';
  row[7] = 12;
  return [headers, row];
}

describe('parseMatrixData strict schema mode', () => {
  it('accepts a valid savings sheet without relying on positional defaults', () => {
    const result = parseMatrixData(makeSheet(), { strictSchema: true });

    expect(result.success).toBe(true);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].interestRate).toBe(6.5);
  });

  it('rejects a renamed required column before interpreting rows', () => {
    const matrix = makeSheet();
    matrix[0][4] = 'Số dư';

    const result = parseMatrixData(matrix, { strictSchema: true });

    expect(result.success).toBe(false);
    expect(result.books).toHaveLength(0);
    expect(result.errors.join(' ')).toContain('principal');
  });

  it('rejects invalid financial dates instead of substituting defaults', () => {
    const result = parseMatrixData(makeSheet('6.5%', 'not-a-date'), { strictSchema: true });

    expect(result.success).toBe(false);
    expect(result.books).toHaveLength(0);
    expect(result.errors.join(' ')).toContain('ngày mở');
  });
});
