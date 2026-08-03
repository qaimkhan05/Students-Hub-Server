const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
  const emailUser = String(process.env.EMAIL_USER || '').trim();
  // Gmail displays app passwords with spaces; spaces are only formatting.
  const emailPass = String(process.env.EMAIL_PASS || '').replace(/\s/g, '');

  if (!emailUser || !emailPass) {
    const error = new Error('Email service is not configured');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass,
    },
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
