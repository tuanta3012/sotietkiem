import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { STANDARDIZED_SHEET_HEADERS } from '../dataSchema';
import { autoDiscoverLatestCentralHub, downloadRealGoogleDriveFile } from '../googleDriveService';

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

  it('falls back to Drive export when Sheets API cannot resolve a shared spreadsheet', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(makeValues()), 'Sổ');
    const workbookBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
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
      if (url.includes('fields=sheets(properties(title,sheetId))') || url.includes('/values/')) {
        return Response.json({}, { status: 404 });
      }
      if (url.includes('/export?mimeType=')) {
        return new Response(workbookBytes);
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadRealGoogleDriveFile('member-access-token', 'shared-sheet');

    expect(result.success).toBe(true);
    expect(result.books).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      expect.anything()
    );
  });

  it('explains when Google has not granted this app access to the picked file', async () => {
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
      if (url.includes('fields=sheets(properties(title,sheetId))') || url.includes('/values/')) {
        return Response.json({}, { status: 404 });
      }
      if (url.includes('/export?mimeType=')) {
        return Response.json(
          {
            error: {
              message: 'The user has not granted the app 864440372329 read access to the file shared-sheet.',
            },
          },
          { status: 403 }
        );
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadRealGoogleDriveFile('member-access-token', 'shared-sheet')).rejects.toThrow(
      'PICKER_ACCESS_NOT_GRANTED:'
    );
  });

  it('does not auto-reconnect a workspace after the user explicitly left it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'explicitly_unlinked' ? 'true' : null),
    });

    await expect(autoDiscoverLatestCentralHub('member-access-token', 'member@example.com')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
