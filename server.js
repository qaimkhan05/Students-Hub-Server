const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');
const connectDB = require('./config/db');
const validateEnv = require('./utils/validateEnv');

// Load env vars
dotenv.config();

validateEnv();

console.error(
  `[env] EMAIL_USER=${process.env.EMAIL_USER ? 'set' : 'MISSING'}, ` +
    `EMAIL_PASS=${process.env.EMAIL_PASS ? 'set' : 'MISSING'}, ` +
    `CONTACT_EMAIL=${process.env.CONTACT_EMAIL ? 'set' : 'MISSING'}`
);

// Connect to database
connectDB();

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Body parser
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Enable CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Security Headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/samples', express.static(path.join(__dirname, 'samples')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Student Hub Pakistan API' });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
  });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
}

module.exports = app;

