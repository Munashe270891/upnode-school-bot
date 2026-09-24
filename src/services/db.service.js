const { query } = require('../config/database');

async function getPublicRecords(schoolId, targetClass) {
  try {
    const res = await query(
      `SELECT * FROM records WHERE school_id = $1 AND visibility = 'public_class' AND target_classes @> $2`,
      [schoolId, targetClass ? [targetClass] : []]
    );
    return res.rows;
  } catch (err) {
    console.error('getPublicRecords error', err.message || err);
    return [];
  }
}

async function getPrivateRecordsForAdmin(schoolId) {
  try {
    const res = await query(
      `SELECT * FROM records WHERE school_id = $1 AND visibility = 'private_admin' ORDER BY created_at DESC`,
      [schoolId]
    );
    return res.rows;
  } catch (err) {
    console.error('getPrivateRecordsForAdmin error', err.message || err);
    return [];
  }
}

async function getStudentPrivateData(schoolId, studentId, requestingPhone) {
  try {
    const res = await query(
      `SELECT id, name, class, age, address, parent_name, parent_phone, student_phone, textbooks_borrowed, uniform_status, fees_balance, other_charges, report_term1, report_term2, report_term3 FROM students WHERE id = $1 AND school_id = $2 LIMIT 1`,
      [studentId, schoolId]
    );

    if (!res || !res.rows || res.rows.length === 0) return null;

    const student = res.rows[0];

    // Authorization: only parent or the student phone may view private data
    const requester = (requestingPhone || '').toString();
    if (requester === (student.parent_phone || '').toString() || requester === (student.student_phone || '').toString()) {
      return student; // authorized: return full private profile
    }

    return null; // unauthorized
  } catch (err) {
    console.error('getStudentPrivateData error', err.message || err);
    return null;
  }
}

async function saveRecord(schoolId, teacherId, type, targetClasses = [], content, visibility = 'public_class') {
  try {
    const res = await query(
      `INSERT INTO records (school_id, teacher_id, type, target_classes, content, visibility, created_at) VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
      [schoolId, teacherId, type, targetClasses, content, visibility]
    );
    return res.rows[0];
  } catch (err) {
    console.error('saveRecord error', err.message || err);
    return null;
  }
}

async function addStudentProfile(schoolId, studentData) {
  const {
    name,
    class: className,
    age,
    address,
    parent_name,
    parent_phone,
    student_phone,
    textbooks_borrowed = [],
    uniform_status = null,
    fees_balance = 0,
    other_charges = {},
    report_term1 = null,
    report_term2 = null,
    report_term3 = null
  } = studentData;

  try {
    const res = await query(
      `INSERT INTO students (school_id, name, class, age, address, parent_name, parent_phone, student_phone, textbooks_borrowed, uniform_status, fees_balance, other_charges, report_term1, report_term2, report_term3, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now()) RETURNING *`,
      [
        schoolId,
        name,
        className,
        age,
        address,
        parent_name,
        parent_phone,
        student_phone,
        textbooks_borrowed,
        uniform_status,
        fees_balance,
        other_charges,
        report_term1,
        report_term2,
        report_term3
      ]
    );
    return res.rows[0];
  } catch (err) {
    console.error('addStudentProfile error', err.message || err);
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
