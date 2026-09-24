const { query } = require('../config/database');
const { saveRecord } = require('../services/db.service');
const { sendTextMessage, sendInteractiveButtons } = require('../services/whatsapp.service');
const { teacherAddSuccess } = require('../services/messageTemplates.service');

async function findTeacherUser(schoolId, phone) {
  const res = await query('SELECT * FROM users WHERE school_id = $1 AND phone = $2 AND role = $3 LIMIT 1', [schoolId, phone, 'teacher']);
  return res && res.rows && res.rows[0] ? res.rows[0] : null;
}

async function upsertSessionMeta(phone, schoolId, meta) {
  try {
    const upd = await query('UPDATE sessions SET meta = $3, updated_at = now() WHERE phone = $1 AND school_id = $2 RETURNING *', [phone, schoolId, meta]);
    if (upd && upd.rowCount && upd.rowCount > 0) return upd.rows[0];
    const ins = await query('INSERT INTO sessions (phone, school_id, meta, updated_at) VALUES ($1,$2,$3,now()) RETURNING *', [phone, schoolId, meta]);
    return ins && ins.rows && ins.rows[0] ? ins.rows[0] : null;
  } catch (err) {
    console.error('upsertSessionMeta error', err && err.message ? err.message : err);
    return null;
  }
}

async function handleTeacher(schoolId, teacherPhone, teacherName, parsedIntent = {}, rawMessage = '', session = {}) {
  try {
    // First, check if session contains a pending record action (visibility confirmation)
    const pending = session && session.meta && session.meta.pendingRecordAction ? session.meta.pendingRecordAction : null;
    if (pending && pending.action === 'confirm_visibility' && pending.recordId) {
      const reply = (rawMessage || '').toString().trim().toLowerCase();
      if (reply === '1' || reply === 'yes' || reply === 'y') {
        // confirm: update record visibility
        // ensure teacher owns the record
        const teacherUser = await findTeacherUser(schoolId, teacherPhone);
        if (!teacherUser) {
          await sendTextMessage(schoolId, teacherPhone, 'Unable to verify your teacher account.');
          return { action: 'no_teacher' };
        }

        const res = await query('UPDATE records SET visibility = $1 WHERE id = $2 AND school_id = $3 AND teacher_id = $4 RETURNING *', ['public_class', pending.recordId, schoolId, teacherUser.id]);
        if (res && res.rowCount && res.rowCount > 0) {
          await sendTextMessage(schoolId, teacherPhone, '✅ The item is now public for the class. Parents will receive the update once published.');
          // clear pending action
          await upsertSessionMeta(teacherPhone, schoolId, {});
          return { action: 'made_public', record: res.rows[0] };
        }

        await sendTextMessage(schoolId, teacherPhone, 'Could not update visibility — confirm the item exists and you are its author.');
        return { action: 'update_failed' };
      } else {
        // any other reply treat as keep private
        await sendTextMessage(schoolId, teacherPhone, 'Okay — the item remains private for admin review.');
        await upsertSessionMeta(teacherPhone, schoolId, {});
        return { action: 'kept_private' };
      }
    }

    // handle add_homework intent
    if (parsedIntent && parsedIntent.intent === 'add_homework') {
      const teacherUser = await findTeacherUser(schoolId, teacherPhone);
      if (!teacherUser) {
        await sendTextMessage(schoolId, teacherPhone, 'Unable to verify your teacher account. Please contact admin.');
        return { action: 'no_teacher' };
      }

      const targetClass = parsedIntent.targetClass || (teacherUser.classes && teacherUser.classes.length ? teacherUser.classes[0] : null);

      // enforce that teacher can only add for their assigned classes
      if (targetClass && Array.isArray(teacherUser.classes) && teacherUser.classes.length > 0) {
        const allowed = teacherUser.classes.map(c => String(c).toLowerCase());
        if (!allowed.includes(String(targetClass).toLowerCase())) {
          await sendTextMessage(schoolId, teacherPhone, `You are not assigned to class ${targetClass}. You may only add records for your assigned classes.`);
          return { action: 'not_allowed_class' };
        }
      }

      const content = (parsedIntent.arguments && parsedIntent.arguments.content) ? parsedIntent.arguments.content : rawMessage;
      const record = await saveRecord(schoolId, teacherUser.id, 'homework', targetClass ? [targetClass] : [], content, 'private_admin');

      if (!record) {
        await sendTextMessage(schoolId, teacherPhone, 'Failed to save the homework. Please try again later.');
        return { action: 'save_failed' };
      }

      // confirmation to teacher
      await sendTextMessage(schoolId, teacherPhone, teacherAddSuccess(teacherName, content, targetClass));

      // Ask if they want to make it public
      await sendInteractiveButtons(schoolId, teacherPhone, 'Make public? Reply 1=YES, 2=NO', ['YES', 'NO']);

      // store pending action in session meta so next reply can confirm
      const meta = { pendingRecordAction: { action: 'confirm_visibility', recordId: record.id } };
      await upsertSessionMeta(teacherPhone, schoolId, meta);

      return { action: 'saved_private', record };
    }

    // default: acknowledge
    await sendTextMessage(schoolId, teacherPhone, "I can help you add homework. Send 'Add homework <Class> <content>' or 'help' for options.");
    return { action: 'noop' };
  } catch (err) {
    console.error('handleTeacher error', err && err.message ? err.message : err);
    try { await sendTextMessage(schoolId, teacherPhone, 'Sorry, an error occurred.'); } catch (e) {}
    return { action: 'error' };
  }
}

module.exports = { handleTeacher };
