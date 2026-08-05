const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');

const profileFieldsByRole = {
  student: ['name', 'headline', 'bio', 'skills', 'resumeUrl', 'location'],
  admin: ['name', 'headline', 'bio', 'location'],
};

const getProfileCompleteness = (user) => {
  const requiredFields = profileFieldsByRole[user.role] || profileFieldsByRole.student;
  const profile = user.profile || {};
  const completed = requiredFields.filter((field) => {
    if (field === 'name') {
      return Boolean(user.name?.trim());
    }
    if (field === 'skills') {
      return Array.isArray(profile.skills) && profile.skills.length > 0;
    }
    return Boolean(profile[field]);
  }).length;

  return Math.round((completed / requiredFields.length) * 100);
};

// @desc    Get personal dashboard data
// @route   GET /api/dashboard
// @access  Private
exports.getDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const orders = await Order.find({ user: user._id })
      .sort({ createdAt: -1 })
      .populate('products', 'title category price fileUrl thumbnailUrl')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        role: user.role,
        summary: {
          purchases: orders.length,
          completedOrders: orders.filter((order) => order.status === 'Completed').length,
          profileCompleteness: getProfileCompleteness(user),
        },
        orders,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc    Remove an item from the user's library
// @route   DELETE /api/dashboard/library/:orderId/:productId
// @access  Private
exports.removeFromLibrary = async (req, res) => {
  try {
    const { orderId, productId } = req.params;

    const order = await Order.findOne({
      _id: orderId,
      user: req.user.id,
      status: 'Completed',
      products: productId,
    });

    if (!order) {
      return res.status(404).json({ message: 'Item not found in your library' });
    }

    order.products.pull(productId);

    if (order.products.length === 0) {
      await order.deleteOne();
    } else {
      const remainingProducts = await Product.find({ _id: { $in: order.products } });
      order.totalAmount = remainingProducts.reduce((sum, product) => sum + product.price, 0);
      await order.save();
    }

    res.status(200).json({ success: true, message: 'Item removed from your library' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
