const User = require('../models/User');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');
const { OAuth2Client } = require('google-auth-library');

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClient = new OAuth2Client({
  clientId: googleClientId,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
});
const VERIFICATION_WINDOW_MS = 10 * 60 * 1000;
const SELF_SERVICE_ROLES = ['student'];
const ALLOW_DEV_VERIFICATION_FALLBACK =
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_VERIFICATION !== 'false';
const PHONE_REGEX = /^\+?[0-9\s()-]{10,20}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MINIMUM_STUDENT_AGE = 13;

const normalizeText = (value = '') => String(value).trim();
const normalizeEmail = (email = '') => normalizeText(email).toLowerCase();
const normalizePhone = (phone = '') => normalizeText(phone).replace(/\s+/g, ' ');
const normalizeDateOfBirth = (dateOfBirth = '') => normalizeText(dateOfBirth);
const normalizeRole = (role) => (SELF_SERVICE_ROLES.includes(role) ? role : 'student');
const createVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const toPlainProfile = (profile = {}) =>
  (typeof profile?.toObject === 'function' ? profile.toObject() : { ...(profile || {}) });
const isValidPhoneNumber = (phone = '') => PHONE_REGEX.test(phone);
const isValidDateOnly = (value = '') => {
  if (!DATE_ONLY_REGEX.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const hasMinimumAge = (dateOfBirth, minimumAge = MINIMUM_STUDENT_AGE) => {
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const today = new Date();

  if (Number.isNaN(dob.getTime())) {
    return false;
  }

  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDifference = today.getUTCMonth() - dob.getUTCMonth();
  const dayDifference = today.getUTCDate() - dob.getUTCDate();

  if (monthDifference < 0 || (monthDifference === 0 && dayDifference < 0)) {
    age -= 1;
  }

  return age >= minimumAge;
};

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
  profile: user.profile || {},
});

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

const buildVerificationEmail = (name, code, title, intro) => {
  const message = `${title}: ${code}. It expires in 10 minutes.`;
  const safeName = escapeHtml(name || 'there');
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeCode = escapeHtml(code);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 18px; background: #ffffff;">
      <div style="margin-bottom: 20px;">
        <p style="display: inline-block; margin: 0; background: #eff6ff; color: #1d4ed8; padding: 8px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">Student Hub Pakistan</p>
      </div>
      <h2 style="color: #0f172a; margin: 0 0 12px;">${safeTitle}</h2>
      <p style="color: #475569; line-height: 1.7; margin: 0 0 12px;">Hello <strong>${safeName}</strong>,</p>
      <p style="color: #475569; line-height: 1.7; margin: 0 0 20px;">${safeIntro}</p>
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%); border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 18px;">
        <span style="display: inline-block; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: 0.35em; padding-left: 0.35em;">${safeCode}</span>
      </div>
      <p style="color: #64748b; line-height: 1.7; margin: 0 0 8px;">This code expires in 10 minutes.</p>
      <p style="color: #94a3b8; line-height: 1.7; margin: 0;">If you did not request this action, you can ignore this email.</p>
    </div>
  `;

  return { message, html };
};

const deliverVerificationCode = async (user, title, intro) => {
  const { message, html } = buildVerificationEmail(user.name, user.verificationCode, title, intro);
  const isDevFallbackEnabled = process.env.NODE_ENV !== 'production' && ALLOW_DEV_VERIFICATION_FALLBACK;

  try {
    await sendEmail({ email: user.email, subject: title, message, html });

    if (process.env.NODE_ENV !== 'production') {
      console.info(`Verification email sent to ${user.email}`);
    }
  } catch (err) {
    if (isDevFallbackEnabled) {
      console.warn(`Email delivery unavailable (${err.message}). Verification code for ${user.email}: ${user.verificationCode}`);
    } else {
      console.error('Verification email delivery failed:', err);
      throw new Error('Unable to send verification email right now. Please try again later.');
    }
  }

  const delivery = {
    delivered: true,
    message: 'Verification code sent to your email',
  };

  if (isDevFallbackEnabled) {
    delivery.devVerificationCode = user.verificationCode;
  }

  return delivery;
};

const issueFreshVerificationCode = async (user) => {
  user.verificationCode = createVerificationCode();
  user.verificationCodeExpire = Date.now() + VERIFICATION_WINDOW_MS;
  await user.save();

  return deliverVerificationCode(
    user,
    'Verify your Student Hub email',
    'Use this code to verify your Student Hub account and unlock your dashboard.'
  );
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const name = normalizeText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const phone = normalizePhone(req.body.phone);
    const dateOfBirth = normalizeDateOfBirth(req.body.dateOfBirth);
    const location = normalizeText(req.body.location);
    const role = normalizeRole(req.body.role);
    const verificationCode = createVerificationCode();
    const verificationCodeExpire = Date.now() + VERIFICATION_WINDOW_MS;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Full name, email, and password are required',
      });
    }

    if (name.length < 3) {
      return res.status(400).json({ message: 'Full name must be at least 3 characters long' });
    }

    if (phone && !isValidPhoneNumber(phone)) {
      return res.status(400).json({ message: 'Please enter a valid mobile number' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    let user = await User.findOne({ email }).select('+password');

    if (user?.googleId) {
      return res.status(400).json({ message: 'This email is already linked to Google. Please continue with Google.' });
    }

    if (user?.isVerified) {
      return res.status(409).json({
        message: 'This email is already taken. Please log in instead.',
        emailTaken: true,
      });
    }

    if (user) {
      user.name = name;
      user.password = password;
      user.role = role;
      user.isVerified = false;
      user.verificationCode = verificationCode;
      user.verificationCodeExpire = verificationCodeExpire;
      user.profile = {
        ...toPlainProfile(user.profile),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(phone ? { phone } : {}),
        ...(location ? { location } : {}),
      };
    } else {
      user = new User({
        name,
        email,
        password,
        role,
        isVerified: false,
        verificationCode,
        verificationCodeExpire,
        profile: {
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(phone ? { phone } : {}),
          ...(location ? { location } : {}),
        },
      });
    }

    await user.save();

    const delivery = await deliverVerificationCode(
      user,
      'Verify your Student Hub email',
      'Thank you for creating your account. Enter the following code to confirm your email address.'
    );

    res.status(201).json({
      success: true,
      email: user.email,
      message: delivery.message,
      devVerificationCode: delivery.devVerificationCode,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message: 'This email is already taken. Please log in instead.',
        emailTaken: true,
      });
    }

    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// @desc    Verify email
// @route   POST /api/auth/verify-email
// @access  Public
exports.verifyEmail = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();

    const user = await User.findOne({
      email,
      verificationCode: code,
      verificationCodeExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpire = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// @desc    Resend verification code
// @route   POST /api/auth/resend-code
// @access  Public
exports.resendCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    if (user.googleId) {
      return res.status(400).json({ message: 'This account uses Google sign-in and does not need email verification.' });
    }

    const delivery = await issueFreshVerificationCode(user);

    res.status(200).json({
      success: true,
      message: delivery.message,
      devVerificationCode: delivery.devVerificationCode,
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide an email and password' });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.password && user.googleId) {
      return res.status(400).json({ message: 'This account uses Google sign-in. Please continue with Google.' });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isLegacyManagedAccount =
      ['admin', 'employer'].includes(user.role) &&
      !user.isVerified &&
      !user.verificationCode &&
      !user.googleId;

    if (isLegacyManagedAccount) {
      user.isVerified = true;
      user.lastLoginAt = new Date();
      await user.save();
      return sendTokenResponse(user, 200, res);
    }

    if (!user.isVerified) {
      let delivery = {};

      if (!user.verificationCode || !user.verificationCodeExpire || user.verificationCodeExpire <= Date.now()) {
        delivery = await issueFreshVerificationCode(user);
      }

      return res.status(401).json({
        message: delivery.message || 'Please verify your email first',
        email: user.email,
        notVerified: true,
        devVerificationCode: delivery.devVerificationCode,
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// @desc    Google Login / Signup
// @route   POST /api/auth/google-login
// @access  Public
exports.googleLogin = async (req, res) => {
  try {
    if (!googleClientId) {
      return res.status(500).json({ message: 'Google sign-in is not configured on the server' });
    }

    const idToken = String(req.body.idToken || '').trim();
    const role = req.body.role;
    if (!idToken) {
      return res.status(400).json({ message: 'Google credential is required' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    const googleId = payload?.sub;
    const email = normalizeEmail(payload?.email);
    const name = normalizeText(payload?.name || email.split('@')[0]);

    if (!googleId || !email) {
      return res.status(401).json({ message: 'Google did not return a valid account identity' });
    }

    if (payload?.email_verified !== true) {
      return res.status(401).json({ message: 'Please use a verified Google email address' });
    }

    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        isVerified: true,
        role: normalizeRole(role),
        lastLoginAt: new Date(),
      });
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
      }

      user.isVerified = true;
      user.verificationCode = undefined;
      user.verificationCodeExpire = undefined;
      user.lastLoginAt = new Date();
      await user.save();
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'This Google account is already linked to another user' });
    }
    res.status(err.statusCode || 400).json({ message: err.message || 'Google authentication failed' });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: serializeUser(user),
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

// @desc    Update current user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.body.name) {
      user.name = req.body.name.trim();
    }

    const nextProfile = req.body.profile || {};
    const currentProfile = toPlainProfile(user.profile);
    const incomingSkills = Array.isArray(nextProfile.skills)
      ? nextProfile.skills
      : String(nextProfile.skills || '')
          .split(',')
          .map((skill) => skill.trim())
          .filter(Boolean);
    const normalizedPhone =
      nextProfile.phone !== undefined ? normalizePhone(nextProfile.phone) : currentProfile.phone;
    const normalizedDateOfBirth =
      nextProfile.dateOfBirth !== undefined
        ? normalizeDateOfBirth(nextProfile.dateOfBirth)
        : currentProfile.dateOfBirth;

    if (normalizedPhone && !isValidPhoneNumber(normalizedPhone)) {
      return res.status(400).json({ message: 'Please enter a valid mobile number' });
    }

    if (normalizedDateOfBirth) {
      if (!isValidDateOnly(normalizedDateOfBirth)) {
        return res.status(400).json({ message: 'Please enter a valid date of birth' });
      }

      if (!hasMinimumAge(normalizedDateOfBirth)) {
        return res.status(400).json({
          message: `Date of birth must reflect an age of at least ${MINIMUM_STUDENT_AGE}`,
        });
      }
    }

    user.profile = {
      ...currentProfile,
      headline: nextProfile.headline ?? currentProfile.headline,
      bio: nextProfile.bio ?? currentProfile.bio,
      skills: nextProfile.skills !== undefined ? incomingSkills : currentProfile.skills,
      resumeUrl: nextProfile.resumeUrl ?? currentProfile.resumeUrl,
      companyName: nextProfile.companyName ?? currentProfile.companyName,
      website: nextProfile.website ?? currentProfile.website,
      phone: nextProfile.phone !== undefined ? normalizedPhone : currentProfile.phone,
      dateOfBirth:
        nextProfile.dateOfBirth !== undefined ? normalizedDateOfBirth : currentProfile.dateOfBirth,
      location: nextProfile.location !== undefined ? normalizeText(nextProfile.location) : currentProfile.location,
    };

    await user.save();

    res.status(200).json({
      success: true,
      data: serializeUser(user),
      message: 'Profile updated successfully',
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
};

const sendTokenResponse = (user, statusCode, res, message = '') => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

  const response = {
    success: true,
    token,
    user: serializeUser(user),
  };

  if (message) {
    response.message = message;
  }

  res.status(statusCode).json(response);
};
