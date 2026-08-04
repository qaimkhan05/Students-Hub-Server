const dns = require('dns');
const net = require('net');
const nodemailer = require('nodemailer');

const SMTP_HOST = 'smtp.gmail.com';
const FALLBACK_IPV4 = ['64.233.184.109', '142.250.145.109'];

const log = (...args) => console.error('[SMTP]', ...args);

const isIpv4 = (value) => net.isIP(value) === 4;

const resolveIpv4Candidates = async () => {
  const candidates = [];
  const add = (value) => {
    const candidate = String(value || '').trim();
    if (isIpv4(candidate) && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  const methods = [
    {
      label: 'dns.lookup (system DNS)',
      run: () => dns.promises.lookup(SMTP_HOST, { family: 4, all: true }),
    },
    {
      label: 'fresh Resolver.resolve4 (system DNS)',
      run: () =>
        new Promise((resolve, reject) => {
          const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
          resolver.resolve4(SMTP_HOST, (err, addresses) =>
            err ? reject(err) : resolve(addresses)
          );
        }),
    },
  ];

  for (const method of methods) {
    try {
      const result = await method.run();
      const addresses = (result || []).map((item) =>
        typeof item === 'string' ? item : item.address
      );
      addresses.forEach(add);
      if (addresses.length) {
        log(`${method.label}:`, addresses.join(', '));
      }
    } catch (err) {
      log(`${method.label} failed (${err.code || err.message})`);
    }
  }

  FALLBACK_IPV4.forEach(add);
  log('IPv4 candidates:', candidates.length ? candidates.join(', ') : '(none)');
  return candidates;
};

const sendEmail = async (options) => {
  const emailUser = String(process.env.EMAIL_USER || '').trim();
  // Gmail displays app passwords with spaces; spaces are only formatting.
  const emailPass = String(process.env.EMAIL_PASS || '').replace(/\s/g, '');
  const fromName = String(process.env.FROM_NAME || 'Student Hub Pakistan').trim();

  if (!emailUser || !emailPass) {
    log('EMAIL_USER or EMAIL_PASS is not set on this server');
    const error = new Error('Email service is not configured');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const candidates = await resolveIpv4Candidates();
  if (!candidates.length) {
    log('no IPv4 candidates resolved - falling back to hostname');
    candidates.push(SMTP_HOST);
  }

  const message = {
    from: `${fromName} <${emailUser}>`,
    replyTo: emailUser,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  let lastError = null;

  for (const host of candidates) {
    const transporter = nodemailer.createTransport({
      host,
      servername: SMTP_HOST,
      port: 587,
      secure: false,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });

    try {
      const info = await transporter.sendMail(message);
      log(`SUCCESS via ${host} (${info.messageId})`);
      return;
    } catch (err) {
      lastError = err;
      log(`attempt ${host} failed: ${err.code || err.message}`);
    }
  }

  throw lastError || new Error('SMTP delivery failed');
};

module.exports = sendEmail;
