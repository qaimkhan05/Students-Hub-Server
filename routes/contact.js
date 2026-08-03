const express = require('express');
const { submitContact } = require('../controllers/contactController');
const { contactLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/', contactLimiter, submitContact);

module.exports = router;
