const dns = require('dns');
const nodemailer = require('nodemailer');

const SMTP_HOST = 'smtp.gmail.com';

const resolveIpv4Host = (hostname) =>
  new Promise((resolve) => {
    const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    resolver.resolve4(hostname, (err, addresses) => {
      resolve(!err && addresses && addresses.length ? addresses[0] : null);
    });
  });

const sendEmail = async (options) => {
  const emailUser = String(process.env.EMAIL_USER || '').trim();
  // Gmail displays app passwords with spaces; spaces are only formatting.
  const emailPass = String(process.env.EMAIL_PASS || '').replace(/\s/g, '');

  if (!emailUser || !emailPass) {
    const error = new Error('Email service is not configured');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const smtpHost = (await resolveIpv4Host(SMTP_HOST)) || SMTP_HOST;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    servername: SMTP_HOST,
    port: 587,
    secure: false,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const message = {
    from: `${String(process.env.FROM_NAME || 'Student Hub Pakistan').trim()} <${emailUser}>`,
    replyTo: emailUser,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  const info = await transporter.sendMail(message);

  if (process.env.NODE_ENV !== 'production') {
    console.info('Message sent: %s', info.messageId);
  }
};

module.exports = sendEmail;
