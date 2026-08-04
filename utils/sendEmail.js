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

const sendWithResend = async ({ to, subject, text, html, replyTo, from }) => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const sender = String(process.env.RESEND_FROM_EMAIL || '').trim();

  if (!apiKey || !sender) {
    const error = new Error('RESEND_API_KEY or RESEND_FROM_EMAIL is not configured');
    error.code = 'RESEND_NOT_CONFIGURED';
    throw error;
  }

  const resend = new Resend(apiKey);
  const response = await resend.emails.send({
    from,
    to: [to],
    reply_to: replyTo,
    subject,
    text,
    html,
  });

  if (response?.error) {
    const error = new Error(response.error.message || 'Resend delivery failed');
    error.code = response.error.name || 'RESEND_SEND_FAILED';
    throw error;
  }

  log(`SUCCESS via Resend (${response?.data?.id || 'unknown'})`);
  return response;
};

const sendWithSmtp = async ({ to, subject, text, html, replyTo, fromName, emailUser, emailPass }) => {
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
    log(`SMTP transporter verification failed: ${verifyError.code || verifyError.message}`);
    throw verifyError;
  }

  const message = {
    from: `${fromName} <${emailUser}>`,
    replyTo,
    to,
    subject,
    text,
    html,
  };

  try {
    const info = await transporter.sendMail(message);
    log(`SUCCESS via ${SMTP_HOST} (${info.messageId})`);
    return info;
  } catch (err) {
    log(`Gmail SMTP send failed: ${err.code || err.message}`);
    throw err;
  }
};

const sendEmail = async (options) => {
  const emailUser = String(process.env.EMAIL_USER || '').trim();
  const emailPass = String(process.env.EMAIL_PASS || '').replace(/\s/g, '');
  const fromName = String(process.env.FROM_NAME || DEFAULT_FROM_NAME).trim();
  const replyTo = String(process.env.EMAIL_USER || '').trim();
  const fallbackFrom = `${fromName} <${emailUser}>`;
  const to = normalizeEmail(options.email);

  const resendFrom = String(process.env.RESEND_FROM_EMAIL || '').trim();
  const resendEnabled = Boolean(process.env.RESEND_API_KEY && resendFrom);

  if (resendEnabled) {
    try {
      return await sendWithResend({
        to,
        subject: options.subject,
        text: options.message,
        html: options.html,
        replyTo,
        from: resendFrom,
      });
    } catch (err) {
      log(`Resend failed, falling back to SMTP: ${err.code || err.message}`);
    }
  } else {
    log('Resend not configured; using Gmail SMTP fallback');
  }

  return sendWithSmtp({
    to,
    subject: options.subject,
    text: options.message,
    html: options.html,
    replyTo,
    fromName,
    emailUser,
    emailPass,
  });
};

module.exports = sendEmail;
