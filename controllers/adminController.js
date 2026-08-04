const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();
const MANAGEABLE_ROLES = ['student', 'employer', 'moderator', 'admin'];

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isOwner: String(user.email || '').trim().toLowerCase() === OWNER_EMAIL,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
  profile: user.profile || {},
});

// @desc    Get admin dashboard stats
// @route   GET /api/admin/stats
// @access  Private (Admin)
exports.getStats = async (req, res) => {
  try {
    const [totalUsers, totalProducts, totalOrders, revenueTotals, recentOrders, recentUsers] =
      await Promise.all([
        User.countDocuments(),
        Product.countDocuments(),
        Order.countDocuments(),
        Order.aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalAmount' },
            },
          },
        ]),
        Order.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('user', 'name email')
          .populate('products', 'title'),
        User.find().sort({ createdAt: -1 }).limit(5),
      ]);

    const usersByRoleDocs = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const usersByRole = usersByRoleDocs.reduce(
      (result, item) => ({ ...result, [item._id]: item.count }),
      { student: 0, employer: 0, moderator: 0, admin: 0 }
    );

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalProducts,
        totalOrders,
        totalRevenue: revenueTotals[0]?.totalRevenue || 0,
        usersByRole,
        recentOrders,
        recentUsers: recentUsers.map(serializeUser),
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private (Admin)
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: users.map(serializeUser) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Update user
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isOwner = String(user.email || '').trim().toLowerCase() === OWNER_EMAIL;

    if (isOwner && req.body.role && req.body.role !== user.role) {
      return res.status(403).json({ message: 'The owner account role cannot be changed' });
    }

    if (req.user.id === user.id && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ message: 'You cannot remove your own admin role' });
    }

    if (req.body.name) {
      user.name = req.body.name.trim();
    }

    // Keep the legacy role accepted so existing records can still be managed safely.
    if (req.body.role && MANAGEABLE_ROLES.includes(req.body.role)) {
      user.role = req.body.role;
    }

    if (typeof req.body.isVerified === 'boolean') {
      user.isVerified = req.body.isVerified;
      if (req.body.isVerified) {
        user.verificationCode = undefined;
        user.verificationCodeExpire = undefined;
      }
    }

    if (req.body.profile) {
      user.profile = { ...user.profile, ...req.body.profile };
    }

    await user.save();
    res.status(200).json({
      success: true,
      data: serializeUser(user),
      message: 'User updated successfully',
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Delete a user and their purchase records
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
exports.deleteUser = async (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({ message: 'You cannot delete your own admin account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (String(user.email || '').trim().toLowerCase() === OWNER_EMAIL) {
      return res.status(403).json({ message: 'The owner account cannot be deleted' });
    }

    await Order.deleteMany({ user: user._id });
    await user.deleteOne();

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Get all orders
// @route   GET /api/admin/orders
// @access  Private (Admin)
exports.getOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .populate('user', 'name email')
      .populate('products', 'title category price');
    res.status(200).json({ success: true, data: orders });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Update order status
// @route   PUT /api/admin/orders/:id
// @access  Private (Admin)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Pending', 'Completed', 'Failed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: 'after', runValidators: true }
    )
      .populate('user', 'name email')
      .populate('products', 'title category price');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json({ success: true, data: order, message: 'Order updated successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Delete an order
// @route   DELETE /api/admin/orders/:id
// @access  Private (Admin)
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const products = await Product.find({ _id: { $in: order.products || [] } }).select('_id salesCount');
    await Promise.all(
      products.map((product) =>
        Product.updateOne(
          { _id: product._id },
          { salesCount: Math.max(0, (product.salesCount || 0) - 1) }
        )
      )
    );

    await order.deleteOne();
    res.status(200).json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
