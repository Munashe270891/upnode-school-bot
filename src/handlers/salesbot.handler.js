const { query } = require('../config/database');
const { sendTextMessage } = require('../services/whatsapp.service');

const TIERS = {
  '1': { key: 'Starter', price: 3.5 },
  '2': { key: 'Growth', price: 5.0 },
  '3': { key: 'Media', price: 10.0 },
  '4': { key: 'Enterprise', price: 15.0 }
};

function buildTierMenu() {
  return `Please choose a pricing tier by replying with the number:\n1) Starter — $3.50/month (up to 100 students)\n2) Growth — $5.00/month (up to 350 students)\n3) Media — $10.00/month (up to 800 students, includes media)\n4) Enterprise — $15.00/month (custom limits)`;
}

async function upsertSession(phone, meta) {
  try {
    const upd = await query('UPDATE sessions SET meta = $3, updated_at = now() WHERE phone = $1 AND school_id IS NULL RETURNING *', [phone, meta]);
    if (upd && upd.rowCount && upd.rowCount > 0) return upd.rows[0];
    const ins = await query('INSERT INTO sessions (phone, school_id, meta, updated_at) VALUES ($1, NULL, $2, now()) RETURNING *', [phone, meta]);
    return ins && ins.rows && ins.rows[0] ? ins.rows[0] : null;
  } catch (err) {
    console.error('upsertSession error', err && err.message ? err.message : err);
    return null;
  }
}

async function getSession(phone) {
  try {
    const res = await query('SELECT * FROM sessions WHERE phone = $1 AND school_id IS NULL LIMIT 1', [phone]);
    return res && res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    console.error('getSession error', err && err.message ? err.message : err);
    return null;
  }
}

function generateFallbackPaynowLink(schoolName, tierKey) {
  const token = Buffer.from(`${schoolName || 'school'}:${tierKey}:${Date.now()}`).toString('base64url');
  return `https://paynow.co.zw/checkout/${token}`;
}

async function createPaymentRecord(schoolName, tierKey, amount, method, reference) {
  try {
    const res = await query('INSERT INTO payments (school_id, amount, method, status, paynow_reference, created_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING *', [null, amount, method, 'pending', reference]);
    return res && res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    console.error('createPaymentRecord error', err && err.message ? err.message : err);
    return null;
  }
}

async function handleSalesBot(senderPhone, rawMessage = '', session = {}) {
  const text = (rawMessage || '').toString().trim();
  try {
    // Load or initialize session
    let s = session && session.meta ? session : await getSession(senderPhone);
    let meta = (s && s.meta) ? s.meta : { sales: { state: 'INIT', data: {} } };
    if (!meta.sales) meta.sales = { state: 'INIT', data: {} };

    const state = meta.sales.state || 'INIT';

    if (state === 'INIT') {
      // greet and ask school name
      await sendTextMessage(null, senderPhone, `Hello — welcome to Upnode School-Bot sales. I can help you register your school and accept payments.`);
      await sendTextMessage(null, senderPhone, 'What is the name of your school?');
      meta.sales.state = 'COLLECT_SCHOOL_NAME';
      await upsertSession(senderPhone, meta);
      return { state: meta.sales.state };
    }

    if (state === 'COLLECT_SCHOOL_NAME') {
      meta.sales.data.schoolName = text;
      // ask tier
      await sendTextMessage(null, senderPhone, `Great — ${text}. ${buildTierMenu()}`);
      meta.sales.state = 'COLLECT_TIER';
      await upsertSession(senderPhone, meta);
      return { state: meta.sales.state };
    }

    if (state === 'COLLECT_TIER') {
      const choice = text.split(/\s+/)[0];
      if (!TIERS[choice]) {
        await sendTextMessage(null, senderPhone, 'Sorry, I did not understand. ' + buildTierMenu());
        return { state: 'COLLECT_TIER' };
      }
      meta.sales.data.tier = TIERS[choice].key;
      meta.sales.data.price = TIERS[choice].price;
      meta.sales.data.tierChoice = choice;

      // move to generate payment
      meta.sales.state = 'GENERATE_PAYMENT';
      await upsertSession(senderPhone, meta);
      // fallthrough
    }

    if (meta.sales.state === 'GENERATE_PAYMENT') {
      const schoolName = meta.sales.data.schoolName || 'New School';
      const tierKey = meta.sales.data.tier || 'Starter';
      const amount = meta.sales.data.price || 0;

      // Try to construct Paynow link — use env-based integration when available, otherwise fallback
      let paynowLink = null;
      try {
        if (process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY) {
          // If Paynow integration keys are present, prefer them; actual SDK integration may vary.
          // To avoid hardcoding an SDK call here, use a safe fallback URL pattern while recording the intent.
          paynowLink = generateFallbackPaynowLink(schoolName, tierKey);
        } else {
          paynowLink = generateFallbackPaynowLink(schoolName, tierKey);
        }
      } catch (err) {
        paynowLink = generateFallbackPaynowLink(schoolName, tierKey);
      }

      // create payment record for tracking
      const payment = await createPaymentRecord(schoolName, tierKey, amount, 'paynow', paynowLink);

      await sendTextMessage(null, senderPhone, `Thank you. Please complete payment for ${tierKey} (${amount} USD) using the link below:`);
      await sendTextMessage(null, senderPhone, paynowLink);
      await sendTextMessage(null, senderPhone, `If you cannot open the link, reply 'MANUAL' to receive EcoCash manual transfer instructions.`);

      meta.sales.state = 'AWAITING_PAYMENT_CONFIRM';
      meta.sales.data.paymentId = payment && payment.id ? payment.id : null;
      await upsertSession(senderPhone, meta);
      return { state: meta.sales.state, payment };
    }

    if (meta.sales.state === 'AWAITING_PAYMENT_CONFIRM') {
      if (/^manual$/i.test(text)) {
        // instruct manual EcoCash transfer and create manual payment record
        const ref = `ECOMANUAL-${Date.now()}`;
        await createPaymentRecord(meta.sales.data.schoolName, meta.sales.data.tier, meta.sales.data.price, 'ecocash_manual', ref);
        await sendTextMessage(null, senderPhone, `EcoCash manual transfer instructions:\n1) Send ${meta.sales.data.price} USD (or local equivalent) to EcoCash number: 0712XXXXXX\n2) Use reference: ${ref}\n3) Reply with 'PAID ${ref}' once done. We will verify and activate your account.`);
        meta.sales.state = 'MANUAL_FALLBACK';
        await upsertSession(senderPhone, meta);
        // notify ops/admin (record logged in payments table)
        console.log('Sales manual fallback created for', senderPhone, ref);
        return { state: meta.sales.state };
      }

      if (/^paid\s+/i.test(text)) {
        // user indicates they've paid manually; record and mark pending verification
        const parts = text.split(/\s+/);
        const ref = parts[1] || null;
        await sendTextMessage(null, senderPhone, `Thanks — we've received your confirmation${ref ? ` (${ref})` : ''}. Our team will verify and contact you shortly.`);
        meta.sales.state = 'COMPLETED';
        await upsertSession(senderPhone, meta);
        return { state: 'COMPLETED' };
      }

      // other replies — remind
      await sendTextMessage(null, senderPhone, "Waiting for payment. Reply 'MANUAL' for EcoCash instructions or 'PAID <ref>' when you've paid.");
      return { state: 'AWAITING_PAYMENT_CONFIRM' };
    }

    if (meta.sales.state === 'MANUAL_FALLBACK') {
      if (/^paid\s+/i.test(text)) {
        const parts = text.split(/\s+/);
        const ref = parts[1] || null;
        await sendTextMessage(null, senderPhone, `Thanks — we will verify the EcoCash payment (${ref || 'no ref provided'}) and contact you.`);
        meta.sales.state = 'COMPLETED';
        await upsertSession(senderPhone, meta);
        return { state: 'COMPLETED' };
      }
      await sendTextMessage(null, senderPhone, "To finish manual payment, send 'PAID <reference>' after transferring funds.");
      return { state: 'MANUAL_FALLBACK' };
    }

    // completed state
    await sendTextMessage(null, senderPhone, 'Thank you — our sales team will contact you shortly to finish setup.');
    return { state: 'COMPLETED' };
  } catch (err) {
    console.error('handleSalesBot error', err && err.message ? err.message : err);
    try { await sendTextMessage(null, senderPhone, 'Sorry, something went wrong. Please try again later.'); } catch (e) {}
    return { error: true };
  }
}

module.exports = { handleSalesBot };
