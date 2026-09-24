const { query } = require('../config/database');

async function authenticateUser(phone, whatsappPhoneId) {
  // Step 1: find school by whatsapp phone id
  const schoolRes = await query('SELECT * FROM schools WHERE whatsapp_phone_id = $1 LIMIT 1', [whatsappPhoneId]);
  if (!schoolRes || !schoolRes.rows || schoolRes.rows.length === 0) {
    return { role: 'stranger' };
  }

  const school = schoolRes.rows[0];

  // Step 2: look up user in users table scoped to school
  const userRes = await query('SELECT * FROM users WHERE school_id = $1 AND phone = $2 LIMIT 1', [school.id, phone]);
  if (userRes && userRes.rows && userRes.rows.length > 0) {
    const user = userRes.rows[0];
    return { role: user.role || 'stranger', user, school };
  }

  // Step 4: search students where parent_phone or student_phone matches
  const studentsRes = await query(
    'SELECT id, name, class, age, parent_name, parent_phone, student_phone FROM students WHERE school_id = $1 AND (parent_phone = $2 OR student_phone = $2)',
    [school.id, phone]
  );

  if (studentsRes && studentsRes.rows && studentsRes.rows.length > 0) {
    const linkedStudents = studentsRes.rows;

    // Determine role: if any student_phone matches exactly, treat as 'student', otherwise 'parent'
    const isStudent = linkedStudents.some(s => s.student_phone === phone);
    const role = isStudent ? 'student' : 'parent';
    return { role, linkedStudents, school };
  }

  return { role: 'stranger', school };
}

module.exports = { authenticateUser };
