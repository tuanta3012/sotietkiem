import { afterEach, describe, expect, it, vi } from 'vitest';
import { STANDARDIZED_SHEET_HEADERS } from '../dataSchema';
import { downloadRealGoogleDriveFile } from '../googleDriveService';

function makeValues() {
  const row: Array<string | number> = Array(STANDARDIZED_SHEET_HEADERS.length).fill('');
  row[0] = 'SHB';
  row[1] = 'Chồng';
  row[2] = 'Online';
  row[3] = '6.5%';
  row[4] = 1000;
  row[5] = '2026-01-01';
  row[6] = '2027-01-01';
  row[7] = 12;
  return [STANDARDIZED_SHEET_HEADERS, row];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared Drive file access', () => {
  it('reads a shared spreadsheet when the authorized member has API access', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/drive/v3/files/shared-sheet?')) {
        return Response.json({
          id: 'shared-sheet',
          name: 'Shared savings',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          modifiedTime: '2026-10-10T00:00:00.000Z',
        });
      }
      if (url.includes('fields=sheets(properties(title,sheetId))')) {
        return Response.json({ sheets: [{ properties: { title: 'Sổ', sheetId: 0 } }] });
      }
      if (url.includes('/values/')) return Response.json({ values: makeValues() });
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadRealGoogleDriveFile('member-access-token', 'shared-sheet');

    expect(result.success).toBe(true);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].bankId).toBe('shb');
  });

  it('does not describe an inaccessible or 404 file as definitely deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 404 })));

    try {
      await downloadRealGoogleDriveFile('member-access-token', 'shared-sheet');
      throw new Error('Expected the unavailable file request to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('FILE_UNAVAILABLE');
      expect((error as Error).message).not.toContain('FILE_NOT_FOUND');
    }
  });
});
