const { query } = require('../config/database');

const TIERS = {
  starter: { students: 100, queries: 2500, media: Infinity },
  growth: { students: 350, queries: 7000, media: Infinity },
  media: { students: 800, queries: 15000, media: 100 },
  enterprise: { students: Infinity, queries: 30000, media: 300 }
};

async function getSchoolById(schoolId) {
  const res = await query('SELECT id, tier, queries_used_this_month, media_used_this_month FROM schools WHERE id = $1 LIMIT 1', [schoolId]);
  return res && res.rows && res.rows[0] ? res.rows[0] : null;
}

async function getStudentCount(schoolId) {
  const res = await query('SELECT COUNT(*)::int AS cnt FROM students WHERE school_id = $1', [schoolId]);
  return res && res.rows && res.rows[0] ? parseInt(res.rows[0].cnt, 10) : 0;
}

function tierKey(tierRaw) {
  if (!tierRaw) return 'starter';
  const t = String(tierRaw).toLowerCase();
  if (t.includes('starter')) return 'starter';
  if (t.includes('growth')) return 'growth';
  if (t.includes('media')) return 'media';
  if (t.includes('enterprise')) return 'enterprise';
  return 'starter';
}

async function checkQueryLimit(schoolId) {
  try {
    const school = await getSchoolById(schoolId);
    if (!school) return false;
    const tk = tierKey(school.tier);
    const limit = TIERS[tk].queries;
    const used = Number(school.queries_used_this_month || 0);
    return used < limit;
  } catch (err) {
    console.error('checkQueryLimit error', err && err.message ? err.message : err);
    return false;
  }
}

async function checkMediaLimit(schoolId) {
  try {
    const school = await getSchoolById(schoolId);
    if (!school) return false;
    const tk = tierKey(school.tier);
    const limit = TIERS[tk].media;
    const used = Number(school.media_used_this_month || 0);
    return used < limit;
  } catch (err) {
    console.error('checkMediaLimit error', err && err.message ? err.message : err);
    return false;
  }
}

async function canAddStudent(schoolId) {
  try {
    const school = await getSchoolById(schoolId);
    if (!school) return { allowed: false, reason: 'no_school' };

    const tk = tierKey(school.tier);
    const limits = TIERS[tk];
    const count = await getStudentCount(schoolId);

    // Starter grace rules: warn at 115, block at 120
    if (tk === 'starter') {
      if (count >= 120) return { allowed: false, reason: 'starter_blocked' };
      if (count >= 115) return { allowed: true, warning: true, reason: 'starter_warn' };
      return { allowed: true };
    }

    if (limits.students !== Infinity && count >= limits.students) {
      return { allowed: false, reason: 'tier_limit_reached' };
    }

    return { allowed: true };
  } catch (err) {
    console.error('canAddStudent error', err && err.message ? err.message : err);
    return { allowed: false, reason: 'error' };
  }
}

function canAddStudentField() {
  return true;
}

module.exports = { checkQueryLimit, checkMediaLimit, canAddStudent, canAddStudentField };
