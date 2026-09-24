function teacherAddSuccess(teacherName = 'Teacher', content = '', targetClass = '') {
  const classPart = targetClass ? ` for class ${targetClass}` : '';
  return `✅ Hi ${teacherName} — thank you!

Your entry${classPart} has been saved as a private draft and will be reviewed by school admin before publishing.

• Preview: ${content || '<no content>'}
• Status: Private draft

If you need this published immediately, please contact your school admin.

— Upnode Technologies 🤝`;
}

function parentHomeworkResponse(targetClass = '', homeworkList = []) {
  const header = targetClass ? `📚 Homework for ${targetClass}` : '📚 Homework';
  const items = Array.isArray(homeworkList) && homeworkList.length > 0
    ? homeworkList.map((h, i) => `
${i + 1}. ${h}`).join('')
    : '\nNo homework found for this class.';

  return `${header}\n${items}\n\nTips: Reply with the number to ask for details, or send "Teacher" to contact class teacher.\n\nPowered by Upnode Technologies — Zimbabwe's friendly school bot 🇿🇼`;
}

function parentFeesResponse(studentName = '', className = '', balance = 0, details = null) {
  const header = `💳 Fees for ${studentName}${className ? ` (${className})` : ''}`;
  let breakdown = '';

  if (Array.isArray(details)) {
    breakdown = details.map(d => `• ${d.label}: ${d.amount}`).join('\n');
  } else if (details && typeof details === 'object') {
    breakdown = Object.keys(details).map(k => `• ${k}: ${details[k]}`).join('\n');
  } else if (typeof details === 'string') {
    breakdown = details;
  } else {
    breakdown = 'No further breakdown available.';
  }

  return `${header}\n\nOutstanding balance: ${balance}\n\nBreakdown:\n${breakdown}\n\nIf you believe this is incorrect, reply with "Dispute" and we will notify the school admin.\n\n— Upnode Technologies`;
}

function strangerResponse(schoolName = 'This school', principalPhone = '') {
  const phoneLine = principalPhone ? `Contact the principal at ${principalPhone}` : 'Contact the school for enrollment details.';
  return `👋 Hello — you’ve reached the official information channel for ${schoolName}.

This number provides school information, notices and enrolment guidance. ${phoneLine}

To enrol or ask about school fees and classes, please call or message the principal.

Powered by Upnode Technologies — building friendly school bots for Zimbabwe 🇿🇼`;
}

function helpMessage(role = 'stranger') {
  const r = (role || 'stranger').toString().toLowerCase();
  if (r === 'admin') {
    return `🛠️ Admin Help Menu

• Send "Add teacher <Name>" — add a teacher
• Send "Broadcast <message>" — send to all parents/teachers
• Send "Students" — view student count and quotas

Replies are sent privately. — Upnode Technologies`;
  }

  if (r === 'teacher') {
    return `👩‍🏫 Teacher Help Menu

• "Add homework <Class> <text>" — add homework draft
• "Records" — list your recent drafts
• "Publish <id>" — ask admin to publish a draft

Need more help? Reply "Admin" to contact your school admin. — Upnode Technologies`;
  }

  if (r === 'parent') {
    return `👪 Parent Help Menu

• "Homework <Class>" — get homework for a class
• "Fees <StudentName>" — get fees balance
• "Report <StudentName>" — get latest reports

For enrolment or fee disputes, contact your school office. — Upnode Technologies`;
  }

  if (r === 'student') {
    return `🎒 Student Help Menu

• "Homework" — get your class homework
• "Teachers" — contact your teachers

Be respectful in messages. — Upnode Technologies`;
  }

  // stranger/default
  return `ℹ️ Welcome to the school info bot.

• To find homework, send "Homework <Class>" (e.g., Homework 3A)
• To check fees, send "Fees <StudentName>"
• For enrolment, send "Enrol" or contact the school directly

This service is provided by Upnode Technologies — friendly school automation for Zimbabwe 🇿🇼`;
}

module.exports = {
  teacherAddSuccess,
  parentHomeworkResponse,
  parentFeesResponse,
  strangerResponse,
  helpMessage
};
