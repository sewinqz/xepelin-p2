import { google } from 'googleapis';
import type { Article } from './types';

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  // Accept key as Base64 (GOOGLE_PRIVATE_KEY_B64) or raw with literal \n (GOOGLE_PRIVATE_KEY)
  const rawKey  = process.env.GOOGLE_PRIVATE_KEY_B64
    ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
    : (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY(_B64) env vars');
  }

  return new google.auth.JWT({
    email,
    key: rawKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

const HEADERS = ['Titular', 'Categoría', 'Autor', 'Tiempo de lectura', 'Fecha de publicación', 'URL'];

export async function writeToSheet(
  category: string,
  articles: Article[],
): Promise<string> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID env var');

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // ── Create a new tab for this category + timestamp ────────────────────────
  const tabTitle = `${category} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`.slice(0, 100);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabTitle } } }],
    },
  });

  // ── Write headers + rows ──────────────────────────────────────────────────
  const rows = [
    HEADERS,
    ...articles.map(a => [a.title, a.category, a.author, a.readingTime, a.date, a.url]),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabTitle}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  // ── Bold the header row ───────────────────────────────────────────────────
  const meta  = await sheets.spreadsheets.get({ spreadsheetId });
  const tab   = meta.data.sheets!.find(s => s.properties?.title === tabTitle);
  const tabId = tab?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      }],
    },
  });

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}#gid=${tabId}`;
}
