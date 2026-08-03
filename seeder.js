const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

mongoose.connect(process.env.MONGO_URI);

const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';

if (!adminEmail || !adminPassword) {
  console.error('Missing admin credentials. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server .env file.');
  process.exit(1);
}

if (adminPassword.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters long.');
  process.exit(1);
}

const seedData = async () => {
  try {
    await User.deleteMany();
    await Product.deleteMany();
    await Order.deleteMany();

    await User.create({
      name: 'Admin User',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      isVerified: true,
      profile: {
        headline: 'Platform administrator',
        bio: 'Managing users, products, orders, and platform quality.',
        location: 'Islamabad',
      },
    });

    const student = await User.create({
      name: 'Ayesha Khan',
      email: 'student@studenthub.pk',
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

    const products = await Product.create([
      {
        title: 'Air University Past Papers',
        description: 'Previous session past papers compiled for quick revision.',
        price: 500,
        category: 'Notes',
        fileUrl: '/samples/air-university-past-papers.pdf',
        thumbnailUrl: '/samples/images/air-university.png',
      },
      {
        title: 'Szabist University Past Papers',
        description: 'Important past paper bundle with notes for Szabist students.',
        price: 800,
        category: 'Notes',
        fileUrl: '/samples/szabist-notes.zip',
        thumbnailUrl: '/samples/images/szabist-university.png',
      },
      {
        title: 'Bahria University Past Paper',
        description: 'Subject-wise sample question set for the undergraduate CBT exam.',
        price: 650,
        category: 'Notes',
        fileUrl: '/samples/bahria-cbt-sample.pdf',
        thumbnailUrl: '/samples/images/bahria-university.png',
      },
    ]);

    await Order.create({
      user: student._id,
      products: products.map((product) => product._id),
      totalAmount: products.reduce((sum, product) => sum + product.price, 0),
      status: 'Completed',
      transactionId: 'TXN-DEMO-SEED',
    });

    console.log('Data Seeded Successfully');
    process.exit();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

seedData();
