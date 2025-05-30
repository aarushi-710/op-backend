const getAttendanceModel = require('../models/Attendance');
const getOperatorModel = require('../models/Operator');
const nodemailer = require('nodemailer');
const { stringify } = require('csv-stringify/sync');
const fs = require('fs');

exports.getAttendance = async (req, res) => {
  const { line, date } = req.params;
  const Attendance = getAttendanceModel(line);
  try {
    if (!line || !date) {
      return res.status(400).json({ message: 'Line and date parameters are required' });
    }
    const attendance = await Attendance.find({ date: { $regex: `^${date}`, $options: 'i' } }).populate({
      path: 'operatorId',
      model: getOperatorModel(line),
    });
    const formattedAttendance = attendance.map((a) => {
      console.log('Raw attendance document:', a);
      return {
        _id: a._id,
        operatorName: a.operatorId?.name || 'Unknown',
        employeeId: a.operatorId?.employeeId || 'N/A',
        station: a.operatorId?.station || 'N/A',
        timestamp: a.timestamp || new Date(a.date + 'T00:00:00.000Z').toISOString(),
        status: a.status,
      };
    });
    res.status(200).json(formattedAttendance);
  } catch (error) {
    console.error(`Error fetching attendance for line ${line} on date ${date}:`, error.message);
    res.status(500).json({ message: 'Failed to fetch attendance', error: error.message });
  }
};

exports.markAttendance = async (req, res) => {
  const { line } = req.params;
  const { operatorId, timestamp } = req.body;
  const Attendance = getAttendanceModel(line);
  try {
    if (!operatorId) {
      return res.status(400).json({ message: 'Operator ID is required' });
    }
    const now = new Date(timestamp || Date.now());
    if (isNaN(now.getTime())) {
      return res.status(400).json({ message: 'Invalid timestamp provided' });
    }
    const date = now.toISOString().split('T')[0];
    const finalTimestamp = now.toISOString();
    console.log('Marking attendance with timestamp:', finalTimestamp);

    const lastAttendance = await Attendance.findOne({ operatorId, date }).sort({ timestamp: -1 });

    if (lastAttendance) {
      const lastTime = new Date(lastAttendance.timestamp);
      const diffMs = now - lastTime;
      const diffMinutes = diffMs / (1000 * 60);
      if (diffMinutes < 10) {
        return res.status(400).json({ message: 'Attendance already marked for this operator within the last 10 minutes' });
      }
    }

    const newAttendance = new Attendance({
      operatorId,
      date,
      timestamp: finalTimestamp,
      status: 'Present',
    });
    await newAttendance.save();

    const Operator = getOperatorModel(line);
    const allOperators = await Operator.find({});
    const todayAttendance = await Attendance.find({ date });
    const attendedOperatorIds = todayAttendance.map(a => a.operatorId.toString());
    const allMarked = allOperators.every(op => attendedOperatorIds.includes(op._id.toString()));

    console.log(`DEBUG: Total operators: ${allOperators.length}, Attended operators: ${attendedOperatorIds.length}, All marked: ${allMarked}`);

    const populatedAttendance = await Attendance.findById(newAttendance._id).populate({
      path: 'operatorId',
      model: getOperatorModel(line),
    });
    const formattedAttendance = {
      _id: populatedAttendance._id,
      operatorName: populatedAttendance.operatorId?.name || 'Unknown',
      employeeId: populatedAttendance.operatorId?.employeeId || 'N/A',
      station: populatedAttendance.operatorId?.station || 'N/A',
      timestamp: populatedAttendance.timestamp,
      status: populatedAttendance.status,
    };
    res.status(201).json(formattedAttendance);
  } catch (error) {
    console.error('Error marking attendance:', error.message);
    res.status(500).json({ message: 'Error marking attendance', error: error.message });
  }
};

exports.exportAttendance = async (req, res) => {
  const { line } = req.params;
  const { from, to } = req.query;
  const Attendance = getAttendanceModel(line);
  const Operator = getOperatorModel(line);
  try {
    if (!from || !to) {
      return res.status(400).json({ message: 'From and to dates are required' });
    }
    const attendance = await Attendance.find({
      date: { $gte: from, $lte: to },
    }).populate({
      path: 'operatorId',
      model: Operator,
    });
    const data = attendance.map((a) => ({
      Date: a.timestamp || new Date(a.date + 'T00:00:00.000Z').toISOString(),
      'Operator Name': a.operatorId?.name || 'Unknown',
      'Employee ID': a.operatorId?.employeeId || 'N/A',
      Station: a.operatorId?.station || 'N/A',
      Status: a.status,
    }));
    res.status(200).json(data);
  } catch (error) {
    console.error(`Error exporting attendance for line ${line}:`, error.message);
    res.status(500).json({ message: 'Failed to export attendance', error: error.message });
  }
};

async function sendAttendanceEmail(attendanceData) {
  console.log('DEBUG: Preparing to send email with attendance data:', attendanceData);

  const csvFilePath = 'attendance_data.csv';
  try {
    const csvContent = stringify(attendanceData, {
      header: true,
      columns: [
        { key: 'operatorName', header: 'Operator Name' },
        { key: 'employeeId', header: 'Employee ID' },
        { key: 'station', header: 'Station' },
        { key: 'timestamp', header: 'Timestamp' },
        { key: 'status', header: 'Status' }
      ]
    });

    console.log('DEBUG: Writing CSV file to', csvFilePath);
    fs.writeFileSync(csvFilePath, csvContent);
    console.log('DEBUG: CSV file created successfully');

    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'engg.datanalytics.padget@dixoninfo.com',
        pass: process.env.SMTP_PASSWORD || 'jhjy piwi slyp yxqz'
      }
    });

    let mailOptions = {
      from: '"Attendance System" <engg.datanalytics.padget@dixoninfo.com>',
      to: 'btbte21074_aarushi@banasthali.in',
      subject: 'Key part 3 operators working today for line1',
      text: 'Please find attached the attendance data for Line 1.',
      attachments: [
        {
          filename: 'attendance_data.csv',
          path: csvFilePath
        }
      ]
    };

    console.log('DEBUG: Sending email to', mailOptions.to);
    await transporter.sendMail(mailOptions);
    console.log('DEBUG: Attendance email with CSV attachment sent successfully');
  } catch (error) {
    console.error('DEBUG: Failed to send attendance email:', error.message);
    throw error;
  } finally {
    if (fs.existsSync(csvFilePath)) {
      console.log('DEBUG: Cleaning up CSV file:', csvFilePath);
      fs.unlinkSync(csvFilePath);
      console.log('DEBUG: CSV file deleted successfully');
    } else {
      console.log('DEBUG: No CSV file to clean up');
    }
  }
}

exports.sendAttendanceNow = async (req, res) => {
  try {
    console.log('DEBUG: /send-attendance endpoint hit');
    const line = req.query.line || 'line1';
    const Attendance = getAttendanceModel(line);
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
    res.json({ message: 'Attendance email sent!' });
  } catch (err) {
    console.error('DEBUG: Error in sendAttendanceNow:', err);
    res.status(500).json({ message: 'Failed to send attendance email', error: err.message });
  }
};

module.exports = {
  getAttendance,
  markAttendance,
  exportAttendance,
  sendAttendanceEmail,
  sendAttendanceNow
};