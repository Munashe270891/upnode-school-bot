const { query } = require('../config/database');
const { sendTextMessage, sendInteractiveButtons } = require('../services/whatsapp.service');
const license = require('../services/license.service');
const { addStudentProfile } = require('../services/db.service');

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

async function clearSessionMeta(phone, schoolId) {
  try {
    await query('UPDATE sessions SET meta = $3, updated_at = now() WHERE phone = $1 AND school_id = $2', [phone, schoolId, {}]);
  } catch (err) {
    console.error('clearSessionMeta error', err && err.message ? err.message : err);
  }
}

async function addTeacher(schoolId, adminPhone, targetPhone, name) {
  try {
    // insert or update user as teacher
    const res = await query('INSERT INTO users (school_id, phone, role, name) VALUES ($1,$2,$3,$4) ON CONFLICT (school_id, phone) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name RETURNING *', [schoolId, targetPhone, 'teacher', name]);
    await sendTextMessage(schoolId, adminPhone, `✅ Teacher ${name} (${targetPhone}) added.`);
    return res && res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    console.error('addTeacher error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to add teacher.');
    return null;
  }
}

async function removeTeacher(schoolId, adminPhone, targetPhone) {
  try {
    const res = await query('DELETE FROM users WHERE school_id = $1 AND phone = $2 AND role = $3 RETURNING *', [schoolId, targetPhone, 'teacher']);
    if (res && res.rowCount && res.rowCount > 0) {
      await sendTextMessage(schoolId, adminPhone, `✅ Removed teacher ${targetPhone}.`);
      return true;
    }
    await sendTextMessage(schoolId, adminPhone, `No teacher found with phone ${targetPhone}.`);
    return false;
  } catch (err) {
    console.error('removeTeacher error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to remove teacher.');
    return false;
  }
}

async function reviewWork(schoolId, adminPhone) {
  try {
    const rows = await query('SELECT id, teacher_id, type, content, target_classes, created_at FROM records WHERE school_id = $1 AND visibility = $2 ORDER BY created_at DESC LIMIT 10', [schoolId, 'private_admin']);
    if (!rows || !rows.rows || rows.rows.length === 0) {
      await sendTextMessage(schoolId, adminPhone, 'No pending teacher submissions for review.');
      return [];
    }

    const list = rows.rows.map(r => `#${r.id} by teacher ${r.teacher_id} (${r.type}) — ${r.target_classes || ''} — ${r.content ? String(r.content).slice(0,80) : ''}`);
    await sendTextMessage(schoolId, adminPhone, `Pending submissions:\n${list.join('\n\n')}\n\nReply 'publish <id>' to publish or 'reject <id>' to reject.`);
    return rows.rows;
  } catch (err) {
    console.error('reviewWork error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to fetch pending work.');
    return [];
  }
}

async function publishRecord(schoolId, adminPhone, recordId) {
  try {
    const res = await query('UPDATE records SET visibility = $1 WHERE id = $2 AND school_id = $3 RETURNING *', ['public_class', recordId, schoolId]);
    if (res && res.rowCount && res.rowCount > 0) {
      await sendTextMessage(schoolId, adminPhone, `✅ Published record ${recordId}.`);
      return res.rows[0];
    }
    await sendTextMessage(schoolId, adminPhone, `Record ${recordId} not found.`);
    return null;
  } catch (err) {
    console.error('publishRecord error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to publish record.');
    return null;
  }
}

async function rejectRecord(schoolId, adminPhone, recordId) {
  try {
    const res = await query('DELETE FROM records WHERE id = $1 AND school_id = $2 RETURNING *', [recordId, schoolId]);
    if (res && res.rowCount && res.rowCount > 0) {
      await sendTextMessage(schoolId, adminPhone, `✅ Rejected and removed record ${recordId}.`);
      return true;
    }
    await sendTextMessage(schoolId, adminPhone, `Record ${recordId} not found.`);
    return false;
  } catch (err) {
    console.error('rejectRecord error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to reject record.');
    return false;
  }
}

async function updateFees(schoolId, adminPhone, studentId, amount) {
  try {
    // privacy: ensure admin scoped to school, we assume caller is verified admin elsewhere
    const res = await query('UPDATE students SET fees_balance = $1 WHERE id = $2 AND school_id = $3 RETURNING *', [amount, studentId, schoolId]);
    if (res && res.rowCount && res.rowCount > 0) {
      await sendTextMessage(schoolId, adminPhone, `✅ Updated fees for student ${studentId} to ${amount}.`);
      return res.rows[0];
    }
    await sendTextMessage(schoolId, adminPhone, `Student ${studentId} not found.`);
    return null;
  } catch (err) {
    console.error('updateFees error', err && err.message ? err.message : err);
    await sendTextMessage(schoolId, adminPhone, 'Failed to update fees.');
    return null;
  }
}

async function startStudentOnboard(schoolId, adminPhone) {
  await sendTextMessage(schoolId, adminPhone, 'Starting student onboarding. Reply with the student name:');
  const meta = { onboarding: { step: 'name', data: {} } };
  await upsertSessionMeta(adminPhone, schoolId, meta);
  return { action: 'started_onboard' };
}

async function processOnboardReply(schoolId, adminPhone, raw, sessionMeta) {
  const ob = sessionMeta && sessionMeta.onboarding ? sessionMeta.onboarding : null;
  if (!ob) return null;
  const step = ob.step;
  const data = ob.data || {};
  if (step === 'name') {
    data.name = raw.trim();
    ob.step = 'class';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter class (e.g., 3A):');
    return { action: 'collected_name' };
  }
  if (step === 'class') {
    data.class = raw.trim();
    ob.step = 'age';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter age:');
    return { action: 'collected_class' };
  }
  if (step === 'age') {
    data.age = parseInt(raw.trim(), 10) || null;
    ob.step = 'address';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter address:');
    return { action: 'collected_age' };
  }
  if (step === 'address') {
    data.address = raw.trim();
    ob.step = 'parent_name';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter parent name:');
    return { action: 'collected_address' };
  }
  if (step === 'parent_name') {
    data.parent_name = raw.trim();
    ob.step = 'parent_phone';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter parent phone:');
    return { action: 'collected_parent_name' };
  }
  if (step === 'parent_phone') {
    data.parent_phone = raw.trim();
    ob.step = 'fees_balance';
    ob.data = data;
    await upsertSessionMeta(adminPhone, schoolId, { onboarding: ob });
    await sendTextMessage(schoolId, adminPhone, 'Enter fees balance (numeric):');
    return { action: 'collected_parent_phone' };
  }
  if (step === 'fees_balance') {
    data.fees_balance = parseFloat(raw.trim()) || 0;

    // Before finalizing, check license limits
    const canAdd = await license.canAddStudent(schoolId);
    if (!canAdd.allowed) {
      if (canAdd.reason === 'starter_blocked') {
        await sendTextMessage(schoolId, adminPhone, 'Cannot add student: Starter tier limit reached.');
        await clearSessionMeta(adminPhone, schoolId);
        return { action: 'blocked_by_tier' };
      }
      await sendTextMessage(schoolId, adminPhone, 'Cannot add student: tier limits reached.');
      await clearSessionMeta(adminPhone, schoolId);
      return { action: 'blocked_by_tier' };
    }

    // proceed to create student
    const student = await addStudentProfile(schoolId, {
      name: data.name,
      class: data.class,
      age: data.age,
      address: data.address,
      parent_name: data.parent_name,
      parent_phone: data.parent_phone,
      student_phone: '',
      fees_balance: data.fees_balance
    });

    if (student) {
      await sendTextMessage(schoolId, adminPhone, `✅ Student ${student.name} added successfully.`);
    } else {
      await sendTextMessage(schoolId, adminPhone, 'Failed to add student.');
    }
    await clearSessionMeta(adminPhone, schoolId);
    return { action: 'onboard_complete', student };
  }

  return null;
}

async function handleAdmin(schoolId, adminPhone, parsedIntent = {}, rawMessage = '', session = {}) {
  try {
    const text = (rawMessage || '').toString().trim();

    // If there is an ongoing onboarding session, process reply
    const sessionMeta = session && session.meta ? session.meta : {};
    if (sessionMeta && sessionMeta.onboarding) {
      const r = await processOnboardReply(schoolId, adminPhone, text, sessionMeta);
      if (r) return r;
    }

    // staff management commands
    const addTeacherMatch = text.match(/^add\s+teacher\s+(\+?\d+)\s+(.+)$/i);
    if (addTeacherMatch) {
      const phone = addTeacherMatch[1];
      const name = addTeacherMatch[2];
      return await addTeacher(schoolId, adminPhone, phone, name);
    }

    const removeTeacherMatch = text.match(/^remove\s+teacher\s+(\+?\d+)$/i);
    if (removeTeacherMatch) {
      const phone = removeTeacherMatch[1];
      return await removeTeacher(schoolId, adminPhone, phone);
    }

    // review work
    if (/\breview\b/i.test(text) || /review work/i.test(text)) {
      return await reviewWork(schoolId, adminPhone);
    }

    // publish or reject
    const publishMatch = text.match(/^publish\s+(\d+)$/i);
    if (publishMatch) {
      const id = publishMatch[1];
      return await publishRecord(schoolId, adminPhone, id);
    }
    const rejectMatch = text.match(/^reject\s+(\d+)$/i);
    if (rejectMatch) {
      const id = rejectMatch[1];
      return await rejectRecord(schoolId, adminPhone, id);
    }

    // start onboarding
    if (/^add\s+student$/i.test(text) || /^start\s+onboard$/i.test(text)) {
      return await startStudentOnboard(schoolId, adminPhone);
    }

    // fees update: 'update fees <studentId> <amount>'
    const feesMatch = text.match(/^update\s+fees\s+(\d+)\s+([0-9]+(?:\.[0-9]+)?)$/i);
    if (feesMatch) {
      const studentId = feesMatch[1];
      const amount = parseFloat(feesMatch[2]);
      // ask for confirmation
      await sendInteractiveButtons(schoolId, adminPhone, `Confirm update fees for student ${studentId} to ${amount}?`, ['YES','NO']);
      // store pending action
      const meta = { pendingFeeAction: { studentId, amount } };
      await upsertSessionMeta(adminPhone, schoolId, meta);
      return { action: 'awaiting_fee_confirm' };
    }

    // confirm pending fee action
    if (sessionMeta && sessionMeta.pendingFeeAction) {
      const reply = text.toLowerCase();
      if (reply === '1' || reply === 'yes' || reply === 'y' || reply === 'confirm') {
        const { studentId, amount } = sessionMeta.pendingFeeAction;
        const updated = await updateFees(schoolId, adminPhone, studentId, amount);
        await clearSessionMeta(adminPhone, schoolId);
        return updated ? { action: 'fees_updated', updated } : { action: 'fees_update_failed' };
      } else {
        await sendTextMessage(schoolId, adminPhone, 'Fee update cancelled.');
        await clearSessionMeta(adminPhone, schoolId);
        return { action: 'fees_update_cancelled' };
      }
    }

    // default
    await sendTextMessage(schoolId, adminPhone, "Admin commands: 'add teacher <phone> <name>', 'remove teacher <phone>', 'add student', 'review', 'publish <id>', 'reject <id>', 'update fees <studentId> <amount>'.");
    return { action: 'noop' };
  } catch (err) {
    console.error('handleAdmin error', err && err.message ? err.message : err);
    try { await sendTextMessage(schoolId, adminPhone, 'Admin action failed.'); } catch (e) {}
    return { action: 'error' };
  }
}

module.exports = { handleAdmin };
