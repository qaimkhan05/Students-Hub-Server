const mongoose = require('mongoose');

const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 5;

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB Connection Error: ${err.message}`);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Will try to reconnect automatically.');
});

const connectDB = async () => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000,
        bufferCommands: false,
        maxPoolSize: 10,
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return conn;
    } catch (error) {
      lastError = error;
      console.error(
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(`MongoDB connection failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
};

module.exports = connectDB;
