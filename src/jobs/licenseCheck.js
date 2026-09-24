const cron = require('node-cron');
const { query } = require('../config/database');
const { sendTextMessage } = require('../services/whatsapp.service');
const license = require('../services/license.service');

async function runLicenseCheck() {
  try {
    const schoolsRes = await query('SELECT id, name, principal_phone, tier, expiry_date FROM schools');
    const schools = (schoolsRes && schoolsRes.rows) || [];

    const now = new Date();

    for (const s of schools) {
      const schoolId = s.id;
      const name = s.name || 'Your school';
      const adminPhone = s.principal_phone || null;
      const tier = (s.tier || '').toString().toLowerCase();
      const expiry = s.expiry_date ? new Date(s.expiry_date) : null;

      // Student count
      const cntRes = await query('SELECT COUNT(*)::int AS cnt FROM students WHERE school_id = $1', [schoolId]);
      const studentCount = cntRes && cntRes.rows && cntRes.rows[0] ? Number(cntRes.rows[0].cnt) : 0;

      // Tier-specific warnings (Starter grace rules)
      if (tier.includes('starter')) {
        if (studentCount >= 115 && studentCount < 120) {
          // warn admin at 115
          const msg = `⚠️ Warning from Upnode: ${name} has ${studentCount} students which is approaching the Starter tier limit (100). At 120 students additions will be blocked. Please consider upgrading.`;
          if (adminPhone) await sendTextMessage(schoolId, adminPhone, msg);
          console.log('licenseCheck: warned starter tier for', schoolId, studentCount);
        }

        if (studentCount >= 120) {
          // block new student additions — attempt to mark Enrollment Only Mode
          const msg = `🚫 Limit reached: ${name} has ${studentCount} students. Starter tier hard limit reached — new student additions will be blocked until you upgrade. Contact sales at https://bot.upnode.co.zw.`;
          if (adminPhone) await sendTextMessage(schoolId, adminPhone, msg);

          try {
            // attempt to mark school as enrollment only by updating tier to a special value
            await query('UPDATE schools SET tier = $1 WHERE id = $2', ['enrollment_only', schoolId]);
            console.log('licenseCheck: set enrollment_only for', schoolId);
          } catch (err) {
            console.error('licenseCheck: failed to set enrollment_only for', schoolId, err && err.message ? err.message : err);
          }
        }
      }

      // Expiry checks
      if (expiry) {
        const diffMs = expiry - now;
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysLeft <= 7 && daysLeft > 0) {
          const msg = `🔔 Reminder from Upnode: Your subscription for ${name} expires in ${daysLeft} day(s) on ${expiry.toDateString()}. Please renew to avoid service disruption.`;
          if (adminPhone) await sendTextMessage(schoolId, adminPhone, msg);
          console.log('licenseCheck: expiry reminder sent for', schoolId, daysLeft);
        } else if (daysLeft <= 0) {
          // expired: transition to Enrollment Only Mode
          const msg = `❗ Your subscription for ${name} has expired on ${expiry.toDateString()}. The system has switched to Enrollment Only Mode. To fully reactivate messaging services please renew your subscription at https://bot.upnode.co.zw`;
          if (adminPhone) await sendTextMessage(schoolId, adminPhone, msg);

          try {
            await query('UPDATE schools SET tier = $1 WHERE id = $2', ['enrollment_only', schoolId]);
            console.log('licenseCheck: expired - set enrollment_only for', schoolId);
          } catch (err) {
            console.error('licenseCheck: failed to mark expired enrollment for', schoolId, err && err.message ? err.message : err);
          }
        }
      }

      // Query usage warnings
      try {
        const hasQueries = await license.checkQueryLimit(schoolId);
        if (!hasQueries && adminPhone) {
          const msg = `📈 ${name} has reached its monthly query allowance. Messaging features are limited until quota resets or you upgrade.`;
          await sendTextMessage(schoolId, adminPhone, msg);
          console.log('licenseCheck: query limit reached for', schoolId);
        }
      } catch (err) {
        console.error('licenseCheck: checkQueryLimit failed for', schoolId, err && err.message ? err.message : err);
      }
    }
  } catch (err) {
    console.error('runLicenseCheck error', err && err.message ? err.message : err);
  }
}

function initLicenseCron() {
  // schedule daily at midnight
  cron.schedule('0 0 * * *', () => {
    console.log('Running daily license check...');
    runLicenseCheck().catch(err => console.error('License check failed', err));
  });

  // run once at startup
  runLicenseCheck().catch(err => console.error('Initial license check failed', err));
}

module.exports = { initLicenseCron, runLicenseCheck };
