require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./config/database');

const app = express();
app.set('trust proxy', true);

// Enforce domain context: only allow requests for bot.upnode.co.zw
app.use((req, res, next) => {
  const host = (req.hostname || (req.headers && req.headers.host) || '').split(':')[0];
  if (host && host !== 'bot.upnode.co.zw') {
    return res.status(403).send('Forbidden');
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/admin', express.static(path.join(__dirname, '../admin-panel')));

app.get('/', (req, res) => res.redirect('https://www.upnode.co.zw'));

// Placeholder webhook endpoints
app.post('/webhook/whatsapp', (req, res) => {
  console.log('Received WhatsApp webhook:', req.body || '<no body>');
  res.sendStatus(200);
});

app.post('/webhook/paynow', (req, res) => {
  console.log('Received Paynow webhook:', req.body || '<no body>');
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server started on https://bot.upnode.co.zw:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize database or start server', err);
    process.exit(1);
  }
}

start();
