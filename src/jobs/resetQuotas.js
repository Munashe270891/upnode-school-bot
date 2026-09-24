const cron = require('node-cron');
const { query } = require('../config/database');

async function runReset() {
  try {
    // Reset both counters in a single optimized query only for rows that need it
    const res = await query(
      `UPDATE schools
       SET queries_used_this_month = 0,
           media_used_this_month = 0
       WHERE COALESCE(queries_used_this_month,0) <> 0
          OR COALESCE(media_used_this_month,0) <> 0`
    );
    console.log('resetQuotas: monthly reset executed');
    return res;
  } catch (err) {
    console.error('resetQuotas: failed to reset monthly quotas', err && err.message ? err.message : err);
    throw err;
  }
}

function initQuotaResetCron() {
  // schedule to run at 00:00 on the 1st day of every month
  cron.schedule('0 0 1 * *', async () => {
    console.log('Running monthly quota reset...');
    try {
      await runReset();
    } catch (err) {
      console.error('initQuotaResetCron: monthly reset failed', err && err.message ? err.message : err);
    }
  });

  // run once at startup to ensure counters are correct when app starts on the 1st
  runReset().catch(err => console.error('Initial quota reset failed', err && err.message ? err.message : err));
}

module.exports = { initQuotaResetCron, runReset };
