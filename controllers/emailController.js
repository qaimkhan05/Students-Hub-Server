const {
  sendWithResend,
  sendWithSmtp,
  getEmailConfig,
  SMTP_HOST,
  SMTP_PORT,
} = require('../utils/sendEmail');

const maskEmail = (email = '') => {
  const value = String(email || '').trim();
  if (!value) return '(not set)';

  if (!value.includes('@')) {
    return value.length <= 3 ? `${value[0]}***` : `${value.slice(0, 3)}***`;
  }

  const [local, domain] = value.split('@');
  const maskedLocal = local.length <= 3 ? `${local[0]}***` : `${local.slice(0, 3)}***`;
  return `${maskedLocal}@${domain}`;
};

const maskSecret = (value = '') => {
  const secret = String(value || '').trim();
  if (!secret) return '(not set)';
  return `${secret.slice(0, 4)}*** (len ${secret.length})`;
};

const defaultContactEmail = () => String(process.env.CONTACT_EMAIL || 'qaim22994@gmail.com').trim();

// @desc    Show email configuration status (no email is sent)
// @route   GET /api/email/health
// @access  Public
exports.health = async (req, res) => {
  const cfg = getEmailConfig();

  res.json({
    success: true,
    environment: process.env.NODE_ENV || 'development',
    contactEmail: process.env.CONTACT_EMAIL
      ? process.env.CONTACT_EMAIL.trim()
      : `${defaultContactEmail()} (default used because CONTACT_EMAIL is not set)`,
    config: {
      resend: {
        enabled: cfg.resendEnabled,
        apiKey: maskSecret(cfg.resendApiKey),
        fromEmail: cfg.resendFrom || '(not set)',
        note: cfg.resendEnabled
          ? 'Resend is enabled. The fromEmail domain must be verified in Resend, otherwise sends fail.'
          : 'Disabled (set RESEND_API_KEY and RESEND_FROM_EMAIL to enable).',
      },
      smtp: {
        configured: Boolean(cfg.emailUser && cfg.emailPass),
        user: maskEmail(cfg.emailUser),
        pass: maskSecret(cfg.emailPass),
        host: SMTP_HOST,
        port: SMTP_PORT,
        note: 'EMAIL_PASS must be a 16-character Gmail App Password (not the normal password).',
      },
    },
  });
};

// @desc    Send a real test email to CONTACT_EMAIL using each configured provider
// @route   POST /api/email/health/test
// @access  Public
exports.test = async (req, res) => {
  const recipient = defaultContactEmail();
  const runId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const subject = `Student Hub email test ${runId}`;
  const text = `If you received this, email delivery works. Test ID: ${runId}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px;">
      <h2 style="color: #0f172a;">Student Hub email test</h2>
      <p style="color: #475569;">If you received this, email delivery works.</p>
      <p style="color: #475569;">Test ID: <strong>${runId}</strong></p>
    </div>
  `;

  const cfg = getEmailConfig();
  const results = {};

  if (cfg.resendEnabled) {
    try {
      const result = await sendWithResend({ to: recipient, subject, text, html });
      results.resend = { success: true, messageId: result.messageId };
    } catch (err) {
      results.resend = { success: false, error: err.message };
    }
  } else {
    results.resend = { skipped: true, reason: 'RESEND_API_KEY / RESEND_FROM_EMAIL not set' };
  }

  if (cfg.emailUser && cfg.emailPass) {
    try {
      const result = await sendWithSmtp({ to: recipient, subject, text, html });
      results.smtp = { success: true, messageId: result.messageId };
    } catch (err) {
      results.smtp = { success: false, error: err.message };
    }
  } else {
    results.smtp = { skipped: true, reason: 'EMAIL_USER / EMAIL_PASS not set' };
  }

  res.json({ success: true, sentTo: recipient, runId, results });
};
