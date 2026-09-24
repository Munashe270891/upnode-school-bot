const { getSheetsClient } = require('../config/sheets');
const { query } = require('../config/database');

function normalizeHeader(h) {
  return (h || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

async function getSpreadsheetIdForSchool(schoolId) {
  try {
    const res = await query(
      `SELECT COALESCE(spreadsheet_id, sheets_spreadsheet_id) AS sheet_id FROM schools WHERE id = $1 LIMIT 1`,
      [schoolId]
    );
    if (!res || !res.rows || res.rows.length === 0) return null;
    return res.rows[0].sheet_id || null;
  } catch (err) {
    console.error('getSpreadsheetIdForSchool error', err.message || err);
    return null;
  }
}

async function fetchSheetRows(spreadsheetId, sheetName) {
  if (!spreadsheetId) return { headers: [], rows: [] };
  try {
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    const vals = resp.data.values || [];
    if (vals.length === 0) return { headers: [], rows: [] };
    const headers = vals[0].map(normalizeHeader);
    const rows = vals.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] !== undefined ? r[i] : null;
      });
      return obj;
    });
    return { headers, rows };
  } catch (err) {
    // Handle rate limits and missing sheets gracefully
    const code = err && err.code ? err.code : (err && err.response && err.response.status);
    console.error('fetchSheetRows error', sheetName, code || '', err.message || err);
    return { headers: [], rows: [] };
  }
}

function matchTargetClassInRecord(record, targetClass) {
  if (!targetClass) return true;
  const tc = (targetClass || '').toString().toLowerCase();
  const raw = (record.target_classes || record.targetclasses || '') + '';
  const parts = raw.split(/[;,|]/).map(p => p.trim().toLowerCase()).filter(Boolean);
  return parts.includes(tc.toLowerCase());
}

async function getPublicRecords(schoolId, targetClass) {
  const spreadsheetId = await getSpreadsheetIdForSchool(schoolId);
  const { rows } = await fetchSheetRows(spreadsheetId, 'Records');
  const filtered = rows.filter(r => {
    const visibility = (r.visibility || '').toString().toLowerCase();
    return visibility === 'public_class' && matchTargetClassInRecord(r, targetClass);
  });
  return filtered;
}

async function getPrivateRecordsForAdmin(schoolId) {
  const spreadsheetId = await getSpreadsheetIdForSchool(schoolId);
  const { rows } = await fetchSheetRows(spreadsheetId, 'Records');
  return rows.filter(r => (r.visibility || '').toString().toLowerCase() === 'private_admin');
}

async function getStudentPrivateData(schoolId, studentId, requestingPhone) {
  const spreadsheetId = await getSpreadsheetIdForSchool(schoolId);
  const { rows } = await fetchSheetRows(spreadsheetId, 'Students');
  if (!rows || rows.length === 0) return null;

  // find student by id field if present, otherwise by name fallback (not ideal)
  const student = rows.find(r => {
    if (r.id && String(r.id) === String(studentId)) return true;
    return false;
  });

  if (!student) return null;

  const requester = (requestingPhone || '').toString();
  const parentPhone = (student.parent_phone || '').toString();
  const studentPhone = (student.student_phone || '').toString();
  if (requester === parentPhone || requester === studentPhone) {
    // return selected private fields only
    return {
      id: student.id,
      name: student.name,
      class: student.class,
      age: student.age,
      address: student.address,
      parent_name: student.parent_name,
      parent_phone: student.parent_phone,
      student_phone: student.student_phone,
      textbooks_borrowed: student.textbooks_borrowed,
      uniform_status: student.uniform_status,
      fees_balance: student.fees_balance,
      other_charges: student.other_charges,
      report_term1: student.report_term1,
      report_term2: student.report_term2,
      report_term3: student.report_term3
    };
  }

  return null;
}

async function saveRecord(schoolId, teacherId, type, targetClasses = [], content, visibility = 'public_class') {
  const spreadsheetId = await getSpreadsheetIdForSchool(schoolId);
  if (!spreadsheetId) {
    console.warn('saveRecord: no spreadsheet configured for school', schoolId);
    return null;
  }

  try {
    const sheets = await getSheetsClient();
    // Fetch headers to align columns
    const { headers } = await fetchSheetRows(spreadsheetId, 'Records');
    const row = {};
    // standard columns we expect
    const now = new Date().toISOString();
    row.school_id = String(schoolId);
    row.teacher_id = String(teacherId || '');
    row.type = type;
    row.target_classes = Array.isArray(targetClasses) ? targetClasses.join(',') : (targetClasses || '');
    row.content = content;
    row.visibility = visibility;
    row.created_at = now;

    // build values in header order
    const values = headers.length > 0 ? headers.map(h => row[h] || '') : [row.school_id, row.teacher_id, row.type, row.target_classes, row.content, row.visibility, row.created_at];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Records',
      valueInputOption: 'RAW',
      resource: { values: [values] }
    });
    return row;
  } catch (err) {
    console.error('saveRecord error', err && err.message ? err.message : err);
    return null;
  }
}

async function addStudentProfile(schoolId, studentData) {
  const spreadsheetId = await getSpreadsheetIdForSchool(schoolId);
  if (!spreadsheetId) {
    console.warn('addStudentProfile: no spreadsheet configured for school', schoolId);
    return null;
  }

  try {
    const sheets = await getSheetsClient();
    const { headers } = await fetchSheetRows(spreadsheetId, 'Students');

    const row = {
      id: studentData.id || '',
      name: studentData.name || '',
      class: studentData.class || studentData.className || '',
      age: studentData.age || '',
      address: studentData.address || '',
      parent_name: studentData.parent_name || '',
      parent_phone: studentData.parent_phone || '',
      student_phone: studentData.student_phone || '',
      textbooks_borrowed: JSON.stringify(studentData.textbooks_borrowed || []),
      uniform_status: studentData.uniform_status || '',
      fees_balance: studentData.fees_balance || '',
      other_charges: JSON.stringify(studentData.other_charges || {}),
      report_term1: studentData.report_term1 || '',
      report_term2: studentData.report_term2 || '',
      report_term3: studentData.report_term3 || '',
      created_at: new Date().toISOString()
    };

    const values = headers.length > 0 ? headers.map(h => row[h] || '') : Object.values(row);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Students',
      valueInputOption: 'RAW',
      resource: { values: [values] }
    });

    return row;
  } catch (err) {
    console.error('addStudentProfile error', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = {
  getPublicRecords,
  getPrivateRecordsForAdmin,
  getStudentPrivateData,
  saveRecord,
  addStudentProfile
};
