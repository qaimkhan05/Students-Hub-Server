const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a product title'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Please add a description'],
  },
  price: {
    type: Number,
    required: [true, 'Please add a price'],
  },
  category: {
    type: String,
    required: [true, 'Please add a category'],
    enum: ['Notes', 'Coding Projects', 'Templates', 'Books', 'Other'],
  },
  fileUrl: {
    type: String,
    required: [true, 'Please add a file URL'],
  },
  thumbnailUrl: {
    type: String,
    required: [true, 'Please add a thumbnail URL'],
  },
  salesCount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Product', productSchema);
