const express = require('express');
const { getDashboard, removeFromLibrary } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', getDashboard);
router.delete('/library/:orderId/:productId', removeFromLibrary);

module.exports = router;
