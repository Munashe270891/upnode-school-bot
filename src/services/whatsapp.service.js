const axios = require('axios');
const { TOKEN, BASE_URL } = require('../config/meta');
const { query } = require('../config/database');

function buildApiUrl(path) {
  return `${BASE_URL}/${path}`;
}

async function safeIncrement(schoolId, column) {
  const allowed = ['queries_used_this_month', 'media_used_this_month'];
  if (!allowed.includes(column)) return;
  try {
    await query(
      `UPDATE schools SET ${column} = COALESCE(${column},0) + 1 WHERE id = $1`,
      [schoolId]
    );
  } catch (err) {
    console.error('Failed to increment usage counter', column, 'for school', schoolId, err.message || err);
  }
}

async function sendTextMessage(schoolId, recipientPhone, text) {
  const url = buildApiUrl('messages');
  const payload = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'text',
    text: { body: text }
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    await safeIncrement(schoolId, 'queries_used_this_month');
    return res.data;
  } catch (err) {
    console.error('sendTextMessage error', err.response ? err.response.data : err.message);
    return { error: err.response ? err.response.data : err.message };
  }
}

async function sendMediaMessage(schoolId, recipientPhone, mediaUrl, type = 'image', caption) {
  const url = buildApiUrl('messages');
  let field = type;
  if (type === 'pdf') field = 'document';
  if (type === 'voice') field = 'audio';

  const mediaObj = { link: mediaUrl };
  if (caption && (field === 'image' || field === 'video' || field === 'document')) {
    mediaObj.caption = caption;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: field,
  };
  payload[field] = mediaObj;

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    await safeIncrement(schoolId, 'media_used_this_month');
    return res.data;
  } catch (err) {
    console.error('sendMediaMessage error', err.response ? err.response.data : err.message);
    return { error: err.response ? err.response.data : err.message };
  }
}

async function sendInteractiveButtons(schoolId, recipientPhone, bodyText, buttons = []) {
  const url = buildApiUrl('messages');

  const actionButtons = buttons.map((b, i) => {
    if (typeof b === 'string') {
      return { type: 'reply', reply: { id: `btn_${i}`, title: b } };
    }
    return { type: 'reply', reply: { id: b.id || `btn_${i}`, title: b.title || String(b) } };
  });

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: actionButtons }
    }
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    await safeIncrement(schoolId, 'queries_used_this_month');
    return res.data;
  } catch (err) {
    console.error('sendInteractiveButtons error', err.response ? err.response.data : err.message);
    return { error: err.response ? err.response.data : err.message };
  }
}

module.exports = { sendTextMessage, sendMediaMessage, sendInteractiveButtons };
