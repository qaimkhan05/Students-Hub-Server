const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../models/User');

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

const setAdmin = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  let user = await User.findOne({ email: adminEmail });

  if (!user) {
    user = await User.create({
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
    console.log(`Created admin account: ${adminEmail}`);
  } else {
    user.name = 'Admin User';
    user.role = 'admin';
    user.isVerified = true;
    user.password = adminPassword;
    user.verificationCode = undefined;
    user.verificationCodeExpire = undefined;
    user.googleId = undefined;
    await user.save();
    console.log(`Promoted to admin: ${adminEmail}`);
  }

  const otherAdmins = await User.find({ role: 'admin', email: { $ne: adminEmail } });
  for (const other of otherAdmins) {
    other.role = 'student';
    await other.save();
    console.log(`Demoted old admin to student: ${other.email}`);
  }

  console.log('Admin credentials are set. Password is hashed with bcrypt before being stored.');
  await mongoose.disconnect();
  process.exit(0);
};

setAdmin().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
