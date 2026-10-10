import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { STANDARDIZED_SHEET_HEADERS } from '../dataSchema';
import {
  autoDiscoverLatestCentralHub,
  downloadRealGoogleDriveFile,
  listAppCreatedDriveFiles,
} from '../googleDriveService';

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

  it('scans all spreadsheet pages, keeps app-labeled files, and returns newest first', async () => {
    const firstPageFiles = [
      {
        id: 'older-sheet',
        name: 'Family savings',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        appProperties: { STK_APP_ID: 'com.tietkiemgiadinh.app' },
      },
      {
        id: 'not-labeled',
        name: 'Unrelated workbook',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: '2026-03-01T00:00:00.000Z',
      },
    ];
    const secondPageFiles = [
      {
        id: 'newer-excel',
        name: 'Portfolio copy',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: '2026-09-01T00:00:00.000Z',
        description: 'Created by com.tietkiemgiadinh.app',
      },
      {
        id: 'unsupported-file',
        name: 'Labeled document',
        mimeType: 'application/pdf',
        modifiedTime: '2026-10-01T00:00:00.000Z',
        appProperties: { STK_APP_ID: 'com.tietkiemgiadinh.app' },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/drive/v3/files') && url.searchParams.has('q')) {
        const pageToken = url.searchParams.get('pageToken');
        return Response.json(
          pageToken
            ? { files: secondPageFiles }
            : { files: firstPageFiles, nextPageToken: 'next-page' }
        );
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    const files = await listAppCreatedDriveFiles('member-access-token');
    const listRequests = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith('/drive/v3/files') && url.searchParams.has('q'));

    expect(listRequests).toHaveLength(2);
    expect(listRequests[0].searchParams.get('orderBy')).toBe('modifiedTime desc');
    expect(listRequests[0].searchParams.get('q')).toContain("mimeType='application/vnd.google-apps.spreadsheet'");
    expect(listRequests[0].searchParams.get('q')).toContain(
      "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'"
    );
    expect(listRequests[0].searchParams.get('q')).toContain("mimeType='application/vnd.ms-excel'");
    expect(listRequests[1].searchParams.get('pageToken')).toBe('next-page');
    expect(files.map((file) => file.id)).toEqual(['newer-excel', 'older-sheet']);
  });

  it('auto-links the newest active labeled sheet when the signed-in email is a configured member', async () => {
    const masterState = {
      status: 'active',
      lastAction: 'link',
      activeFileId: 'shared-hub',
      activeFileName: 'Family portfolio 2026',
      activeFileUrl: 'https://docs.google.com/spreadsheets/d/shared-hub/edit',
      adminEmail: 'admin@example.com',
      members: [{ id: 'member-1', email: 'member@example.com', role: 'EDITOR' }],
      linkedTimestamp: '2026-10-01T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/drive/v3/files') && url.searchParams.has('q')) {
        return Response.json({
          files: [
            {
              id: 'shared-hub',
              name: 'Family portfolio 2026',
              mimeType: 'application/vnd.google-apps.spreadsheet',
              modifiedTime: '2026-10-09T00:00:00.000Z',
              webViewLink: masterState.activeFileUrl,
              appProperties: {
                STK_APP_ID: 'com.tietkiemgiadinh.app',
                STK_MASTER_STATE_JSON: JSON.stringify(masterState),
              },
            },
          ],
        });
      }
      if (url.hostname === 'sheets.googleapis.com') {
        return Response.json({}, { status: 404 });
      }
      if (url.pathname.endsWith('/drive/v3/files/shared-hub')) {
        return Response.json({
          id: 'shared-hub',
          name: masterState.activeFileName,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          webViewLink: masterState.activeFileUrl,
          modifiedTime: '2026-10-09T00:00:00.000Z',
          appProperties: {
            STK_APP_ID: 'com.tietkiemgiadinh.app',
            STK_MASTER_STATE_JSON: JSON.stringify(masterState),
          },
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });

    await expect(
      autoDiscoverLatestCentralHub('member-access-token', 'MEMBER@example.com')
    ).resolves.toMatchObject({
      id: 'shared-hub',
      name: 'Family portfolio 2026',
      linkedTimestamp: masterState.linkedTimestamp,
    });
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
