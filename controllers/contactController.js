const sendEmail = require('../utils/sendEmail');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

const buildContactEmail = (name, email, topic, message) => {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeTopic = escapeHtml(topic);
  const safeMessage = escapeHtml(message);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 18px; background: #ffffff;">
      <div style="margin-bottom: 20px;">
        <p style="display: inline-block; margin: 0; background: #eff6ff; color: #1d4ed8; padding: 8px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Student Hub Pakistan</p>
      </div>
      <h2 style="color: #0f172a; margin: 0 0 12px;">New contact form submission</h2>
      <p style="color: #475569; line-height: 1.7; margin: 0 0 20px;">Someone just sent a message through the contact page.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; margin-bottom: 18px;">
        <p style="color: #475569; line-height: 1.7; margin: 0 0 6px;"><strong>Name:</strong> ${safeName}</p>
        <p style="color: #475569; line-height: 1.7; margin: 0 0 6px;"><strong>Email:</strong> <a href="mailto:${safeEmail}" style="color: #1d4ed8;">${safeEmail}</a></p>
        <p style="color: #475569; line-height: 1.7; margin: 0 0 6px;"><strong>Topic:</strong> ${safeTopic}</p>
        <p style="color: #475569; line-height: 1.7; margin: 0;"><strong>Message:</strong></p>
        <p style="color: #334155; line-height: 1.8; margin: 6px 0 0; white-space: pre-wrap;">${safeMessage}</p>
      </div>
      <p style="color: #94a3b8; line-height: 1.7; margin: 0;">Reply to the visitor directly at their email above.</p>
    </div>
  `;

  return { message, html };
};

// @desc    Submit a contact form message
// @route   POST /api/contact
// @access  Public
exports.submitContact = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const topic = String(req.body.topic || 'General support').trim();
    const message = String(req.body.message || '').trim();
    const recipient = String(process.env.CONTACT_EMAIL || 'qaim22994@gmail.com').trim();

    if (!name || !email || !message) {
      return res.status(400).json({ message: 'Please provide your name, email, and a message' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    if (message.length < 10) {
      return res.status(400).json({ message: 'Message must be at least 10 characters long' });
    }

    const { message: text, html } = buildContactEmail(name, email, topic, message);

    await sendEmail({
      email: recipient,
      subject: `New contact message: ${topic}`,
      message: text,
      html,
    });

    res.status(200).json({
      success: true,
      message: 'Message sent. We will get back to you soon.',
    });
  } catch (err) {
    const { name = '', email = '', topic = 'General support', message = '' } = req.body || {};
    const recipient = String(process.env.CONTACT_EMAIL || 'qaim22994@gmail.com').trim();

    console.error('Contact email delivery failed:', err);

    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_VERIFICATION !== 'false') {
      console.info('Email delivery unavailable. Contact message logged below (dev mode):');
      console.info(`  Recipient: ${recipient}`);
      console.info(`  From: ${name} <${email}> | Topic: ${topic}`);
      console.info(`  Message: ${message}`);

      return res.status(200).json({
        success: true,
        message: 'Message logged to the server console (email not configured in dev mode).',
      });
    }

    if (err.code === 'EMAIL_NOT_CONFIGURED') {
      return res.status(503).json({
        message: 'Contact email is not configured yet. Add Gmail SMTP credentials on the server to receive messages.',
      });
    }

    res.status(500).json({ message: 'Unable to send your message right now. Please try again later.' });
  }
};
