const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const license = require('../services/license.service');
const { authenticateUser } = require('../services/auth.service');
const { parseMessage } = require('../services/parser.service');
const { sendTextMessage } = require('../services/whatsapp.service');
const strangerHandler = require('../handlers/stranger.handler');
const parentHandler = require('../handlers/parent.handler');
const teacherHandler = require('../handlers/teacher.handler');
const adminHandler = require('../handlers/admin.handler');

// Verification endpoint for Meta webhook
router.get('/webhook/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

async function getSchoolIdByPhoneId(phoneId) {
  try {
    const r = await query('SELECT id FROM schools WHERE whatsapp_phone_id = $1 LIMIT 1', [phoneId]);
    if (r && r.rows && r.rows[0]) return r.rows[0].id;
    return null;
  } catch (err) {
    console.error('getSchoolIdByPhoneId error', err && err.message ? err.message : err);
    return null;
  }
}

async function getSession(phone, schoolId) {
  try {
    const r = await query('SELECT * FROM sessions WHERE phone = $1 AND school_id = $2 LIMIT 1', [phone, schoolId]);
    return r && r.rows && r.rows[0] ? r.rows[0] : null;
  } catch (err) {
    console.error('getSession error', err && err.message ? err.message : err);
    return null;
  }
}

// Inbound messages
router.post('/webhook/whatsapp', express.json(), async (req, res) => {
  try {
    const body = req.body || {};

    const entries = body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        // ignore statuses (delivery receipts)
        if (Array.isArray(value.statuses) && value.statuses.length > 0) continue;

        const metadata = value.metadata || {};
        const phoneId = metadata.phone_number_id || (value && value.metadata && value.metadata.phone_number_id) || null;

        const messages = value.messages || [];
        for (const message of messages) {
          const from = message.from;
          let text = '';
          if (message.type === 'text' && message.text) text = message.text.body || '';
          else if (message.type === 'button' && message.button) text = message.button.text || message.button.payload || '';
          else if (message.type === 'interactive' && message.interactive) {
            // button_reply or list_reply
            const ir = message.interactive;
            if (ir.type === 'button' && ir.button_reply) text = ir.button_reply.title || ir.button_reply.id || '';
            if (ir.type === 'list' && ir.list_reply) text = ir.list_reply.title || ir.list_reply.id || '';
          } else if (message.type === 'text' && message.body) text = message.body;

          const incoming = (text || '').toString().trim();

          // Determine school
          const schoolId = await getSchoolIdByPhoneId(phoneId);

          // Check license/query limits before processing
          if (schoolId) {
            const hasQueries = await license.checkQueryLimit(schoolId);
            if (!hasQueries) {
              await sendTextMessage(schoolId, from, 'Your school has reached its monthly query limit. Please upgrade your plan to continue using this service. Visit https://bot.upnode.co.zw or contact your admin.');
              continue;
            }
          }

          // Authenticate sender
          const auth = await authenticateUser(from, phoneId);
          const role = auth && auth.role ? auth.role : 'stranger';
          const parsed = parseMessage(incoming);
          const session = await getSession(from, schoolId);

          if (role === 'stranger') {
            await strangerHandler.handleStranger(schoolId, from, incoming);
            continue;
          }

          if (role === 'parent' || role === 'student') {
            const linked = auth.linkedStudents || [];
            await parentHandler.handleParentOrStudent(schoolId, from, linked, parsed);
            continue;
          }

          if (role === 'teacher') {
            const teacherName = (auth.user && auth.user.name) || '';
            await teacherHandler.handleTeacher(schoolId, from, teacherName, parsed, incoming, session);
            continue;
          }

          if (role === 'admin') {
            await adminHandler.handleAdmin(schoolId, from, parsed, incoming, session);
            continue;
          }
        }
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('webhook error', err && err.message ? err.message : err);
    return res.sendStatus(500);
  }
});

module.exports = router;
