// RelistPro Email Service — powered by Resend
// Env: RESEND_API_KEY, EMAIL_FROM (default: noreply@relistpro.com)

let resend = null;
try {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch(e) { console.log('[Email] Resend not available:', e.message); }

const FROM = process.env.EMAIL_FROM || 'RelistPro <noreply@relistpro.com>';

function wrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<div style="background:#1d1d1f;padding:24px 32px"><div style="font-size:20px;font-weight:700;color:#fff">RelistPro</div></div>
<div style="padding:32px">${body}</div>
<div style="padding:16px 32px;background:#f9f9fb;font-size:12px;color:#86868b;text-align:center">
<p>&copy; ${new Date().getFullYear()} RelistPro. All rights reserved.</p>
</div></div></body></html>`;
}

async function send(to, subject, html) {
  if (!resend) { console.log('[Email] Would send to', to, ':', subject); return { ok:true, simulated:true }; }
  try {
    const r = await resend.emails.send({ from:FROM, to, subject, html });
    console.log('[Email] Sent to', to, ':', subject);
    return { ok:true, id:r.id };
  } catch(e) { console.error('[Email] Error:', e.message); return { ok:false, error:e.message }; }
}

// ═══ TEMPLATES ═══

async function sendWelcome(to, username) {
  return send(to, 'Welcome to RelistPro!', wrap('Welcome',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Welcome, ${esc(username)}!</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Thanks for joining RelistPro. You're all set to start reposting your Vinted listings faster.</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Quick start:</strong></p>
    <ol style="color:#424245;line-height:1.8;font-size:14px">
      <li>Install the Chrome extension</li>
      <li>Open any Vinted page and click the RelistPro icon</li>
      <li>Sync your wardrobe</li>
      <li>Start reposting!</li>
    </ol>
    <p style="color:#424245;font-size:14px">Need help? Reply to this email or check our FAQ.</p>`
  ));
}

async function sendPasswordResetCode(to, code) {
  return send(to, 'Password Reset Code', wrap('Password Reset',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Password Reset</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Your password reset code is:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#1d1d1f;background:#f5f5f7;padding:16px 32px;border-radius:12px">${code}</span>
    </div>
    <p style="color:#86868b;font-size:13px;text-align:center">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>`
  ));
}

async function sendPasswordChanged(to) {
  return send(to, 'Password Changed', wrap('Security Alert',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Password Changed</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Your RelistPro password was successfully changed.</p>
    <p style="color:#86868b;font-size:13px">If you didn't make this change, please reset your password immediately or contact support.</p>`
  ));
}

async function sendPlanUpgraded(to, planName) {
  return send(to, 'Plan Upgraded — ' + planName, wrap('Plan Upgraded',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">You're now on ${esc(planName)}!</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Your RelistPro plan has been upgraded. All new features are now unlocked.</p>
    <p style="color:#424245;font-size:14px">Enjoy unlimited reposting and all the Pro features. Happy selling!</p>`
  ));
}

async function sendSubscriptionCancelled(to, endDate) {
  const dateStr = endDate ? new Date(endDate).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : 'end of billing period';
  return send(to, 'Subscription Cancelled', wrap('Subscription Cancelled',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Subscription Cancelled</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Your paid plan will remain active until <strong>${dateStr}</strong>, then revert to the Free plan.</p>
    <p style="color:#424245;font-size:14px">You can resubscribe anytime from your account settings.</p>`
  ));
}

async function sendQuotaWarning(to, used, limit, planName) {
  const pct = Math.round((used/limit)*100);
  return send(to, 'Repost Quota Warning — ' + pct + '% used', wrap('Quota Warning',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Repost Quota: ${used}/${limit}</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">You've used <strong>${pct}%</strong> of your monthly reposts on the ${esc(planName)} plan.</p>
    ${used >= limit
      ? '<p style="color:#e53e3e;font-weight:600;font-size:15px">You\'ve reached your limit. Upgrade your plan to keep reposting.</p>'
      : '<p style="color:#424245;font-size:14px">Upgrade your plan for more reposts.</p>'}`
  ));
}

async function sendVerificationCode(to, code) {
  return send(to, 'Verify your email — RelistPro', wrap('Email Verification',
    `<h2 style="color:#1d1d1f;margin:0 0 12px">Verify your email</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px">Enter this code in the app to verify your email address:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#1d1d1f;background:#f5f5f7;padding:16px 32px;border-radius:12px">${code}</span>
    </div>
    <p style="color:#86868b;font-size:13px;text-align:center">This code expires in 15 minutes. If you didn't create this account, ignore this email.</p>`
  ));
}

async function sendFailureNotification(to, itemTitle, errorMsg, source) {
  return send(to, 'Action Failed — ' + (itemTitle || 'item'), wrap('Action Failed',
    `<h2 style="color:#e53e3e;margin:0 0 12px">Something went wrong</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Item:</strong> ${esc(itemTitle || 'Unknown')}</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Error:</strong> ${esc(errorMsg)}</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Source:</strong> ${esc(source)}</p>
    <p style="color:#424245;font-size:14px">Open RelistPro to retry, or reply to this email if you need help.</p>`
  ));
}

async function sendAdminFeedback(userId, username, itemTitle, errorMsg, source) {
  return send('ezaruha@icloud.com', '[RelistPro Feedback] Failure: ' + source, wrap('Failure Report',
    `<h2 style="color:#e53e3e;margin:0 0 12px">User Failure Report</h2>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>User:</strong> ${esc(username)} (${esc(userId)})</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Item:</strong> ${esc(itemTitle || 'Unknown')}</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Error:</strong> ${esc(errorMsg)}</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Source:</strong> ${esc(source)}</p>
    <p style="color:#424245;line-height:1.6;font-size:15px"><strong>Time:</strong> ${new Date().toISOString()}</p>`
  ));
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

module.exports = { sendWelcome, sendPasswordResetCode, sendPasswordChanged, sendPlanUpgraded, sendSubscriptionCancelled, sendQuotaWarning, sendVerificationCode, sendFailureNotification, sendAdminFeedback };
