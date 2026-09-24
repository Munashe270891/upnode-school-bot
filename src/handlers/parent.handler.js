const { query } = require('../config/database');
const { sendTextMessage, sendInteractiveButtons } = require('../services/whatsapp.service');
const { getPublicRecords, getStudentPrivateData } = require('../services/db.service');
const { parentHomeworkResponse, parentFeesResponse } = require('../services/messageTemplates.service');

async function getSessionMeta(phone, schoolId) {
  try {
    const res = await query('SELECT meta FROM sessions WHERE phone = $1 AND school_id = $2 LIMIT 1', [phone, schoolId]);
    if (res && res.rows && res.rows[0]) return res.rows[0].meta || {};
    return {};
  } catch (err) {
    console.error('getSessionMeta error', err && err.message ? err.message : err);
    return {};
  }
}

async function handleParentOrStudent(schoolId, senderPhone, linkedStudents = [], parsedIntent = {}) {
  try {
    // If multiple linked students and no active selection, prompt for choice
    if (Array.isArray(linkedStudents) && linkedStudents.length > 1) {
      const meta = await getSessionMeta(senderPhone, schoolId);
      const selected = meta && meta.selectedStudent;
      if (!selected) {
        // send interactive selection
        const buttons = linkedStudents.map((s, i) => `${i + 1}. ${s.name}`);
        await sendInteractiveButtons(schoolId, senderPhone, 'Please reply with the number of the child you are querying:', buttons);
        return { action: 'awaiting_child_selection' };
      }
      // resolve selected student by id or by index
      let student = linkedStudents.find(s => String(s.id) === String(selected));
      if (!student) {
        const idx = parseInt(String(selected), 10) - 1;
        if (!Number.isNaN(idx) && linkedStudents[idx]) student = linkedStudents[idx];
      }

      if (!student) {
        // fall back to first child
        student = linkedStudents[0];
      }

      return await handleIntentForStudent(schoolId, senderPhone, student, parsedIntent);
    }

    // single linked student or none
    const student = Array.isArray(linkedStudents) && linkedStudents.length === 1 ? linkedStudents[0] : null;
    if (!student && parsedIntent.intent === 'get_homework') {
      // allow class-based queries even without linked student
      const targetClass = parsedIntent.targetClass;
      const records = await getPublicRecords(schoolId, targetClass);
      const hwList = (records || []).map(r => r.content || r);
      const msg = parentHomeworkResponse(targetClass || '', hwList);
      await sendTextMessage(schoolId, senderPhone, `${msg}\n\nReply 'homework' or 'fees' anytime.`);
      return { action: 'sent_homework' };
    }

    if (!student && parsedIntent.intent === 'get_fees') {
      await sendTextMessage(schoolId, senderPhone, 'To check fees, please register as a parent with the school or provide your child name.');
      return { action: 'need_registration' };
    }

    if (student) {
      return await handleIntentForStudent(schoolId, senderPhone, student, parsedIntent);
    }

    // default reply
    await sendTextMessage(schoolId, senderPhone, "Reply 'homework' to get class homework or 'fees' to check balances.\nReply 'help' for more options.");
    return { action: 'sent_help_footer' };
  } catch (err) {
    console.error('handleParentOrStudent error', err && err.message ? err.message : err);
    try { await sendTextMessage(schoolId, senderPhone, 'Sorry, something went wrong. Please try again later.'); } catch (e) {}
    return { action: 'error' };
  }
}

async function handleIntentForStudent(schoolId, senderPhone, student, parsedIntent) {
  const footer = "Reply 'homework' or 'fees' anytime";
  const intent = parsedIntent && parsedIntent.intent ? parsedIntent.intent : 'unknown';

  if (intent === 'get_homework') {
    const targetClass = parsedIntent.targetClass || student.class;
    const records = await getPublicRecords(schoolId, targetClass);
    const hwList = (records || []).map(r => r.content || r);
    const msg = parentHomeworkResponse(targetClass || student.class || '', hwList);
    await sendTextMessage(schoolId, senderPhone, `${msg}\n\n${footer}`);
    return { action: 'sent_homework', student };
  }

  if (intent === 'get_fees') {
    // privacy enforced inside getStudentPrivateData
    const privateData = await getStudentPrivateData(schoolId, student.id, senderPhone);
    if (!privateData) {
      await sendTextMessage(schoolId, senderPhone, 'Sorry, you are not authorized to view this student\'s private data.');
      return { action: 'unauthorized', student };
    }

    const details = {
      'Fees Balance': privateData.fees_balance,
      'Other Charges': privateData.other_charges || {}
    };
    const msg = parentFeesResponse(privateData.name || '', privateData.class || '', privateData.fees_balance || 0, details);
    await sendTextMessage(schoolId, senderPhone, `${msg}\n\n${footer}`);
    return { action: 'sent_fees', student };
  }

  // fallback: provide a short help hint
  await sendTextMessage(schoolId, senderPhone, `I can help with homework and fees. ${footer}`);
  return { action: 'sent_fallback', student };
}

module.exports = { handleParentOrStudent };
