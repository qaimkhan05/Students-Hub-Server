const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_SECURE = false;
const DEFAULT_FROM_NAME = 'Student Hub Pakistan';

const log = (...args) => console.error('[MAIL]', ...args);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const createSmtpTransporter = (emailUser, emailPass) =>
  nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: true,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    socketOptions: {
      family: 4,
    },
    tls: {
      servername: SMTP_HOST,
      rejectUnauthorized: false,
    },
  });

const getEmailConfig = () => {
  const emailUser = String(process.env.EMAIL_USER || '').trim();
  const emailPass = String(process.env.EMAIL_PASS || '').trim();
  const fromName = String(process.env.FROM_NAME || DEFAULT_FROM_NAME).trim();
  const resendFrom = String(process.env.RESEND_FROM_EMAIL || '').trim();

  return {
    emailUser,
    emailPass,
    fromName,
    resendApiKey: String(process.env.RESEND_API_KEY || '').trim(),
    resendFrom,
    replyTo: emailUser,
    resendEnabled: Boolean(process.env.RESEND_API_KEY && resendFrom),
  };
};

const sendWithResend = async ({ to, subject, text, html, replyTo }) => {
  const { resendApiKey: apiKey, resendFrom } = getEmailConfig();

  if (!apiKey || !resendFrom) {
    const error = new Error('RESEND_API_KEY or RESEND_FROM_EMAIL is not configured');
    error.code = 'RESEND_NOT_CONFIGURED';
    throw error;
  }

  const resend = new Resend(apiKey);
  const response = await resend.emails.send({
    from: resendFrom,
    to: [to],
    reply_to: replyTo || undefined,
    subject,
    text,
    html,
  });

  if (response?.error) {
    const error = new Error(`Resend delivery failed: ${response.error.message}`);
    error.code = response.error.name || 'RESEND_SEND_FAILED';
    throw error;
  }

  log(`SUCCESS via Resend (${response?.data?.id || 'unknown'})`);
  return { provider: 'resend', messageId: response?.data?.id || null };
};

const sendWithSmtp = async ({ to, subject, text, html, replyTo }) => {
  const { emailUser, emailPass, fromName } = getEmailConfig();

  if (!emailUser || !emailPass) {
    const error = new Error('EMAIL_USER or EMAIL_PASS is not set on this server');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const transporter = createSmtpTransporter(emailUser, emailPass);

  try {
    await transporter.verify();
    log('SMTP transporter verified');
  } catch (verifyError) {
    log(`SMTP transporter verification failed (continuing anyway): ${verifyError.code || verifyError.message}`);
  }

  const message = {
    from: `${fromName} <${emailUser}>`,
    replyTo: replyTo || emailUser,
    to,
    subject,
    text,
    html,
  };

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const info = await transporter.sendMail(message);
      log(`SUCCESS via ${SMTP_HOST} (${info.messageId})`);
      return { provider: 'gmail-smtp', messageId: info.messageId };
    } catch (err) {
      lastError = err;
      log(`Gmail SMTP send attempt ${attempt} failed: ${err.code || err.message}`);
      if (attempt === 1 && err.responseCode && err.responseCode < 500) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError;
};

const sendEmail = async (options) => {
  const { resendEnabled } = getEmailConfig();
  const to = normalizeEmail(options.email);
  const errors = [];

  if (resendEnabled) {
    try {
      return await sendWithResend({
        to,
        subject: options.subject,
        text: options.message,
        html: options.html,
        replyTo: options.replyTo,
      });
    } catch (err) {
      errors.push({ provider: 'resend', message: err.message });
      log(`Resend failed, falling back to SMTP: ${err.message}`);
    }
  } else {
    log('Resend not configured; using Gmail SMTP fallback');
  }

  try {
    return await sendWithSmtp({
      to,
      subject: options.subject,
      text: options.message,
      html: options.html,
      replyTo: options.replyTo,
    });
  } catch (err) {
    errors.push({ provider: 'gmail-smtp', message: err.message });
    const wrapped = new Error(
      `Email delivery failed. ${errors.map((e) => `${e.provider}: ${e.message}`).join(' | ')}`
    );
    wrapped.providerErrors = errors;
    throw wrapped;
  }
};

module.exports = sendEmail;
module.exports.sendWithResend = sendWithResend;
module.exports.sendWithSmtp = sendWithSmtp;
module.exports.getEmailConfig = getEmailConfig;
module.exports.SMTP_HOST = SMTP_HOST;
module.exports.SMTP_PORT = SMTP_PORT;
