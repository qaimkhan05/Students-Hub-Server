const express = require('express');
const { health, test } = require('../controllers/emailController');

const router = express.Router();

router.get('/health', health);
router.post('/health/test', test);

module.exports = router;
