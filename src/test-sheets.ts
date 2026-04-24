import 'dotenv/config';
import { google } from 'googleapis';

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
const privateKey = process.env.GOOGLE_PRIVATE_KEY_B64
  ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
  : (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

console.log('email:', email);
console.log('key starts with:', privateKey.slice(0, 27));
console.log('key has real newlines:', privateKey.includes('\n'));

const auth = new google.auth.JWT({
  email,
  key: privateKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

auth.authorize((err, tokens) => {
  if (err) { console.error('Auth failed:', err.message); return; }
  console.log('\nAuth OK — token type:', tokens?.token_type);

  const sheets = google.sheets({ version: 'v4', auth });
  const tabTitle = `Test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] },
  }).then(res => {
    const sheetId = res.data.replies?.[0].addSheet?.properties?.sheetId;
    console.log(`Tab created: "${tabTitle}" (gid=${sheetId})`);
    console.log(`URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}#gid=${sheetId}`);
  }).catch(e => {
    console.error('Failed:', e.message, e.errors);
  });
});
