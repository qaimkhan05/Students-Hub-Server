const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');

const SAMPLE_ASSETS = [
  {
    fileUrl: '/samples/air-university-past-papers.pdf',
    thumbnailUrl: '/samples/images/air-university.png',
    keywords: ['air university'],
  },
  {
    fileUrl: '/samples/szabist-notes.zip',
    thumbnailUrl: '/samples/images/szabist-university.png',
    keywords: ['szabist'],
  },
  {
    fileUrl: '/samples/bahria-cbt-sample.pdf',
    thumbnailUrl: '/samples/images/bahria-university.png',
    keywords: ['bahria'],
  },
];

const pickAssets = (product, index) => {
  const title = String(product.title || '').toLowerCase();
  const match = SAMPLE_ASSETS.find((assets) => assets.keywords.some((keyword) => title.includes(keyword)));
  return match || SAMPLE_ASSETS[index % SAMPLE_ASSETS.length];
};

const fixProductAssets = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const products = await Product.find();
  let updated = 0;

  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const assets = pickAssets(product, i);

    if (product.thumbnailUrl !== assets.thumbnailUrl || product.fileUrl !== assets.fileUrl) {
      product.thumbnailUrl = assets.thumbnailUrl;
      product.fileUrl = assets.fileUrl;
      await product.save();
      updated += 1;
      console.log(`Updated: ${product.title} -> ${product.fileUrl}`);
    }
  }

  const demoStudentEmail = 'student@studenthub.pk';
  let demoStudent = await User.findOne({ email: demoStudentEmail });

  if (!demoStudent) {
    demoStudent = await User.create({
      name: 'Ayesha Khan',
      email: demoStudentEmail,
      password: 'student123',
      role: 'student',
      isVerified: true,
      profile: {
        headline: 'Student',
        bio: 'Learning and building useful digital skills.',
        skills: ['React', 'JavaScript', 'Tailwind CSS'],
        location: 'Karachi',
      },
    });
    console.log('Created demo student account (student@studenthub.pk / student123)');
  }

  let ordersAdded = 0;
  for (const product of products) {
    const existingOrder = await Order.findOne({
      user: demoStudent._id,
      status: 'Completed',
      products: product._id,
    });

    if (!existingOrder) {
      await Order.create({
        user: demoStudent._id,
        products: [product._id],
        totalAmount: product.price,
        status: 'Completed',
        transactionId: `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      });
      ordersAdded += 1;
      console.log(`Order added for demo student: ${product.title}`);
    }
  }

  console.log(`\nDone. Products updated: ${updated}, orders added: ${ordersAdded}`);
  await mongoose.disconnect();
};

fixProductAssets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
