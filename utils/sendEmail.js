const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_ALTERNATE_PORT = 465;
const SMTP_SECURE = false;
const DEFAULT_FROM_NAME = 'Student Hub Pakistan';
const CONNECTION_TIMEOUT_MS = 6000;
const SMTP_DEADLINE_MS = 20000;

const log = (...args) => console.error('[MAIL]', ...args);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Resolve smtp.gmail.com to IPv4 literals and pin them as the connect host.
// Nodemailer's built-in resolver mixes IPv4 and IPv6 and picks randomly; on
// Railway IPv6 egress is unavailable (ENETUNREACH/ETIMEDOUT), so forcing IPv4
// keeps Gmail SMTP reachable. STARTTLS still uses smtp.gmail.com as the TLS
// servername, so the certificate check stays valid.
const resolveSmtpIpv4 = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = (addresses) => {
      if (!done) {
        done = true;
        resolve(addresses || []);
      }
    };

    try {
      const resolver = new dns.Resolver({ timeout: 4000, tries: 1 });
      resolver.setServers(['8.8.8.8', '1.1.1.1']);
      resolver.resolve4(SMTP_HOST, (err, addresses) => {
        if (!err && addresses && addresses.length) {
          finish(addresses.slice(0, 4));
        } else {
          finish([]);
        }
      });
    } catch {
      finish([]);
    }
  });

let smtpHostsPromise;

// Returns candidate connect hosts (IPv4 literals). Falls back to the hostname
// when resolution fails so nodemailer can try its own resolver. Failures are
// not cached so a later, successful resolution is still picked up.
const getSmtpHosts = async () => {
  if (smtpHostsPromise) {
    const hosts = await smtpHostsPromise;
    if (hosts.length) {
      return hosts;
    }
    smtpHostsPromise = undefined;
  }

  const hosts = await resolveSmtpIpv4();

  if (!hosts.length) {
    smtpHostsPromise = Promise.resolve([]);
    return [SMTP_HOST];
  }

  smtpHostsPromise = Promise.resolve(hosts);
  return hosts;
};

const createTransport = (host, port) => {
  const { emailUser, emailPass } = getEmailConfig();
  const secure = port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    servername: SMTP_HOST,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: 20000,
    tls: {
      servername: SMTP_HOST,
      rejectUnauthorized: false,
    },
  });
};

// Quick TCP pre-flight: if smtp.gmail.com is unreachable from this server we
// bail out in seconds instead of letting every port/IP combo time out.
const canReachGmail = () =>
  new Promise(async (resolve) => {
    try {
      const [hosts] = await Promise.all([getSmtpHosts()]);
      const hostsToProbe = hosts.length ? hosts : [SMTP_HOST];
      const ipv4 = hostsToProbe[0];

      const socket = net.connect({
        host: ipv4,
        port: SMTP_PORT,
        timeout: CONNECTION_TIMEOUT_MS,
      });

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
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

  if (!(await canReachGmail())) {
    const error = new Error(
      'Gmail SMTP (smtp.gmail.com) is not reachable from this server. ' +
        'Your hosting provider may be blocking outbound connections to Gmail. ' +
        'Configure RESEND_API_KEY / RESEND_FROM_EMAIL to enable email delivery.'
    );
    error.code = 'SMTP_UNREACHABLE';
    throw error;
  }

  const hosts = (await getSmtpHosts()).length ? await getSmtpHosts() : [SMTP_HOST];
  const message = {
    from: `${fromName} <${emailUser}>`,
    replyTo: replyTo || emailUser,
    to,
    subject,
    text,
    html,
  };

  const deadline = Date.now() + SMTP_DEADLINE_MS;
  const errors = [];

  for (const host of hosts.slice(0, 2)) {
    for (const port of [SMTP_PORT, SMTP_ALTERNATE_PORT]) {
      if (Date.now() > deadline) {
        break;
      }

      const transporter = createTransport(host, port);

      try {
        const info = await transporter.sendMail(message);
        log(`SUCCESS via ${host}:${port} (${info.messageId})`);
        return { provider: 'gmail-smtp', messageId: info.messageId };
      } catch (err) {
        errors.push(`${host}:${port} -> ${err.code || err.message}`);
        log(`Gmail SMTP send via ${host}:${port} failed: ${err.code || err.message}`);
      }
    }
  }

  const error = new Error(`Gmail SMTP delivery failed: ${errors.join(' | ')}`);
  error.code = 'SMTP_SEND_FAILED';
  throw error;
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
