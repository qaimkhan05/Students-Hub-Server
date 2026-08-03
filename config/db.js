const mongoose = require('mongoose');

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB Connection Error: ${err.message}`);
});

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
