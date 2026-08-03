const express = require('express');
const {
  register,
  login,
  getMe,
  verifyEmail,
  resendCode,
  googleLogin,
  updateProfile,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/register', registerLimiter, register);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-code', authLimiter, resendCode);
router.post('/login', authLimiter, login);
router.post('/google-login', authLimiter, googleLogin);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

module.exports = router;
