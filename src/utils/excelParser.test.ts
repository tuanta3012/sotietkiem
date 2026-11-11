import { describe, expect, it } from 'vitest';
import { getXLSX, parseMatrixData } from './excelParser';
import { STANDARDIZED_SHEET_HEADERS } from './dataSchema';

describe('spreadsheet library compatibility', () => {
  it('reads and writes an XLSX workbook through the existing API', async () => {
    const XLSX = await getXLSX();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Ngân hàng', 'Tiền gốc'], ['SEA', 10_000_000]]),
      'Sổ tiết kiệm'
    );

    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const reopened = XLSX.read(buffer, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(reopened.Sheets['Sổ tiết kiệm'], { header: 1 });

    expect(rows).toEqual([['Ngân hàng', 'Tiền gốc'], ['SEA', 10_000_000]]);
  });

  it('prevents side-by-side activity log headers (columns U..AC) from overwriting main book attributes', () => {
    // Row 0: Headers (Standardized 29 columns)
    const headerRow = [...STANDARDIZED_SHEET_HEADERS];
    
    // Row 1: SHB book in main table (A..L), but SEA settlement activity in side table (U..AC)
    const dataRow = [
      'SHB',        // 0: A - Ngân hàng
      'Vợ yêu',     // 1: B - Chủ sổ
      'Tại quầy',   // 2: C - Hình thức
      '7,4%',       // 3: D - Lãi suất
      3600,         // 4: E - Tiền gửi (3.600 Tr)
      '09/12/2025', // 5: F - Gửi
      '09/12/2026', // 6: G - Đáo hạn
      12,           // 7: H - Kỳ
      28,           // 8: I - Thời gian còn
      266.4,        // 9: J - Tiền lãi theo sổ
      266.4,        // 10: K - Tiền lãi 1 năm
      '12/26',      // 11: L - Tháng đáo hạn
      '',           // 12: M - Separator
      2025, 2350,   // 13..14: N..O - Lãi hàng năm
      '',           // 15: P - Separator
      2025, 34500, 3600, // 16..18: Q..S - Số cuối năm
      '',           // 19: T - Separator
      'ADJ_1_SEA',  // 20: U - ID biến động
      '10/11/2026', // 21: V - Ngày biến động
      'Tất toán đúng hạn', // 22: W - Loại biến động
      'SEA-2609-1100',     // 23: X - Mã sổ (CỦA BIẾN ĐỘNG)
      'SEA',               // 24: Y - Ngân hàng (CỦA BIẾN ĐỘNG)
      'Chồng béo',         // 25: Z - Chủ sở hữu (CỦA BIẾN ĐỘNG)
      1100,                // 26: AA - Tiền gốc biến động
      74.8,                // 27: AB - Tiền lãi biến động
      'Ghi chú test',      // 28: AC - Ghi chú
    ];

    const result = parseMatrixData([headerRow, dataRow]);
    expect(result.success).toBe(true);
    expect(result.books.length).toBe(1);

    const book = result.books[0];
    // Must be SHB, NOT SEA!
    expect(book.bankId).toBe('shb');
    // Must be 'Vợ yêu', NOT 'Chồng béo'!
    expect(book.owner).toBe('Vợ yêu');
    // Principal must be 3,600,000,000, NOT 1,100,000,000!
    expect(book.principal).toBe(3600000000);
    // bookCode should NOT be 'SEA-2609-1100'
    expect(book.bookCode).not.toContain('SEA');
  });
});
