const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { query } = require('../config/database');
const { sendTextMessage } = require('../services/whatsapp.service');

// Accept both form-urlencoded (Paynow) and JSON
router.post('/webhook/paynow', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  const body = req.body || {};

  // Try common reference/status fields used by gateways
  const reference = (body.reference || body.payment_reference || body.paynow_reference || body.transaction_reference || body.id || '').toString();
  const statusRaw = (body.status || body.payment_status || body.result || body.transaction_status || body.status_text || '').toString().toLowerCase();

  if (!reference) {
    console.warn('Paynow webhook received without reference');
    return res.sendStatus(200);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find matching payment record by exact or partial match on reference
    const payRes = await client.query(
      `SELECT * FROM payments WHERE paynow_reference = $1 OR paynow_reference LIKE '%' || $1 || '%' LIMIT 1 FOR UPDATE`,
      [reference]
    );

    if (!payRes || !payRes.rows || payRes.rows.length === 0) {
      console.warn('Paynow webhook: no payment record for reference', reference);
      await client.query('COMMIT');
      return res.sendStatus(200);
    }

    const payment = payRes.rows[0];

    // Determine payment success
    const success = /paid|ok|success/.test(statusRaw);

    if (!success) {
      // mark as rejected or pending depending on status
      await client.query('UPDATE payments SET status = $1 WHERE id = $2', [statusRaw || 'pending', payment.id]);
      await client.query('COMMIT');
      return res.sendStatus(200);
    }

    // mark payment as paid
    await client.query('UPDATE payments SET status = $1 WHERE id = $2', ['paid', payment.id]);

    // If payment is linked to a school, extend its expiry_date
    if (payment.school_id) {
      // lock school row
      const schoolRes = await client.query('SELECT expiry_date FROM schools WHERE id = $1 FOR UPDATE', [payment.school_id]);
      if (schoolRes && schoolRes.rows && schoolRes.rows[0]) {
        const curr = schoolRes.rows[0].expiry_date;

        // Decide extension: if reference suggests annual invoice, extend by 1 year, else by 1 month
        const refLower = (payment.paynow_reference || '').toString().toLowerCase();
        const isAnnual = /year|annual|yr|annum/.test(refLower);
        const interval = isAnnual ? '1 year' : '1 month';

        await client.query(`UPDATE schools SET expiry_date = COALESCE(expiry_date, now()) + INTERVAL '${interval}' WHERE id = $1`, [payment.school_id]);

        // Optionally, set an active flag or similar here if present
      }
    }

    await client.query('COMMIT');

    // Notify school's principal by looking up the school and principal phone
    try {
      let schoolId = payment.school_id;
      if (schoolId) {
        const sres = await query('SELECT name, principal_phone, expiry_date FROM schools WHERE id = $1 LIMIT 1', [schoolId]);
        if (sres && sres.rows && sres.rows[0]) {
          const school = sres.rows[0];
          const phone = school.principal_phone;
          const expiry = school.expiry_date ? new Date(school.expiry_date).toLocaleString() : 'soon';
          if (phone) {
            const msg = `✅ Payment received. Your account for ${school.name} has been activated until ${expiry}. Thank you — Upnode Technologies`;
            await sendTextMessage(schoolId, phone, msg);
          }
        }
      }
    } catch (notifyErr) {
      console.error('Failed to notify principal after Paynow webhook', notifyErr && notifyErr.message ? notifyErr.message : notifyErr);
    }

    return res.sendStatus(200);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('paynow webhook processing error', err && err.message ? err.message : err);
    return res.sendStatus(500);
  } finally {
    client.release();
  }
});

module.exports = router;
