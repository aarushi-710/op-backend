const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const operatorRoutes = require('./routes/operatorRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const cron = require('node-cron');
const { sendAttendanceEmail } = require('./controllers/attendanceController');
const getAttendanceModel = require('./models/Attendance');
const getOperatorModel = require('./models/Operator');

const app = express();

// Connect to database
connectDB().catch((error) => {
  console.error('Failed to connect to MongoDB:', error.message);
  process.exit(1);
});

// CORS configuration for frontend
app.use(cors({ origin: 'https://op-frontend-five.vercel.app' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/attendance', attendanceRoutes);

// Schedule to run at 7:00 AM every day
cron.schedule('2 7 * * *', async () => {
  try {
    const line = 'line1'; // Change as needed
    const Attendance = getAttendanceModel(line);
    const Operator = getOperatorModel(line);
    const today = new Date();
    const date = today.toISOString().split('T')[0];
    const todayAttendance = await Attendance.find({ date }).populate('operatorId');
    const formattedAttendance = todayAttendance.map(a => ({
      operatorName: a.operatorId?.name || 'Unknown',
      employeeId: a.operatorId?.employeeId || 'N/A',
      station: a.operatorId?.station || 'N/A',
      timestamp: a.timestamp,
      status: a.status,
    }));
    await sendAttendanceEmail(formattedAttendance);
    console.log('Attendance email sent automatically at 7:00 AM');
  } catch (err) {
    console.error('Error sending scheduled attendance email:', err.message);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));