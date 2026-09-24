const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let credentials;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch (err) {
    console.warn('Invalid JSON in GOOGLE_SERVICE_ACCOUNT_KEY, ignoring credentials env var');
  }
}

const auth = new google.auth.GoogleAuth({
  scopes: SCOPES,
  credentials: credentials || undefined,
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

module.exports = { getSheetsClient };
