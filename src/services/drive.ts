import { getAccessToken } from './auth';
import { DriveFileItem } from '../types';

export const listDriveExcelFiles = async (searchQuery: string = ''): Promise<DriveFileItem[]> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Google Drive access requires authentication. Please sign in with Google.');
  }

// Filter for Google Sheets, Excel (.xlsx, .xls), CSV, TSV, and OpenDocument spreadsheets
export const listDriveExcelFiles = async (searchQuery: string = ''): Promise<DriveFileItem[]> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Google Drive access requires authentication. Please sign in with Google.');
  }

  const spreadsheetMimeTypes = [
    "mimeType = 'application/vnd.google-apps.spreadsheet'",
    "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
    "mimeType = 'application/vnd.ms-excel'",
    "mimeType = 'text/csv'",
    "mimeType = 'text/tab-separated-values'",
    "mimeType = 'text/comma-separated-values'",
    "mimeType = 'application/csv'",
    "mimeType = 'application/vnd.oasis.opendocument.spreadsheet'",
    "name contains '.xlsx'",
    "name contains '.xls'",
    "name contains '.csv'",
    "name contains '.tsv'",
    "name contains '.ods'",
  ].join(' or ');

  let q = `trashed = false and (${spreadsheetMimeTypes})`;
  if (searchQuery.trim()) {
    q += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`;
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, size)');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '40');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Failed to fetch files from Google Drive (${res.status})`);
  }

  const data = await res.json();
  return (data.files || []).map((file: any) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    size: file.size,
  }));
};

export const fetchDriveFileBinary = async (fileId: string, mimeType?: string): Promise<ArrayBuffer> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Authentication expired. Please re-sign in to access Google Drive.');
  }

  // Google Sheets (Docs Editors) cannot be downloaded via ?alt=media; they must be exported.
  // Exporting as application/vnd.openxmlformats-officedocument.spreadsheetml.sheet produces a standard .xlsx buffer.
  const isGoogleDoc = mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType?.startsWith('application/vnd.google-apps');

  const downloadUrl = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  let res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // If direct media download fails because it was actually a Google Sheets file without explicit mimeType
  if (!res.ok && !isGoogleDoc) {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
    const exportRes = await fetch(exportUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (exportRes.ok) {
      return await exportRes.arrayBuffer();
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Failed to download file from Google Drive (${res.status})`);
  }

  return await res.arrayBuffer();
};

export const fetchDriveFileMetadata = async (fileId: string): Promise<DriveFileItem> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Authentication required.');
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime,size`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to check file status on Google Drive (${res.status})`);
  }

  return await res.json();
};
