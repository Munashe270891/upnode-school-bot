const { query } = require('../config/database');
const { strangerResponse } = require('../services/messageTemplates.service');
const { sendTextMessage } = require('../services/whatsapp.service');

async function handleStranger(schoolId, senderPhone, incomingMessage) {
  try {
    const res = await query('SELECT name, principal_phone FROM schools WHERE id = $1 LIMIT 1', [schoolId]);
    const school = res && res.rows && res.rows[0] ? res.rows[0] : null;

    const schoolName = school && school.name ? school.name : 'this school';
    const principalPhone = school && school.principal_phone ? school.principal_phone : '';

    const reply = strangerResponse(schoolName, principalPhone);

    // Send reply but do not include any sensitive fields or database rows
    const sent = await sendTextMessage(schoolId, senderPhone, reply);
    return sent;
  } catch (err) {
    console.error('handleStranger error', err && err.message ? err.message : err);
    // Fail silently to the caller; do not expose internals to the stranger
    try {
      await sendTextMessage(schoolId, senderPhone, 'Sorry, an error occurred. Please contact the school directly.');
    } catch (e) {
      // swallow
    }
    return null;
  }
}

module.exports = { handleStranger };
