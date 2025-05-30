const getAttendanceModel = require('../models/Attendance');
const getOperatorModel = require('../models/Operator');
const nodemailer = require('nodemailer');

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
      // Log the raw attendance document to debug
      console.log('Raw attendance document:', a);
      return {
        _id: a._id,
        operatorName: a.operatorId?.name || 'Unknown',
        employeeId: a.operatorId?.employeeId || 'N/A',
        station: a.operatorId?.station || 'N/A',
        timestamp: a.timestamp || new Date(a.date + 'T00:00:00.000Z').toISOString(), // Fallback if timestamp is missing
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
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD for daily filtering
    const finalTimestamp = now.toISOString(); // Full ISO 8601 timestamp
    console.log('Marking attendance with timestamp:', finalTimestamp);

    // Find the latest attendance for this operator on this date
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

    // Check if attendance is marked for all stations
    const Operator = getOperatorModel(line);
    const allOperators = await Operator.find({});
    const todayAttendance = await Attendance.find({ date });
    const attendedOperatorIds = todayAttendance.map(a => a.operatorId.toString());
    const allMarked = allOperators.every(op => attendedOperatorIds.includes(op._id.toString()));

    if (allMarked) {
      try {
        console.log('All stations marked, sending attendance email...');
        // Prepare formatted data
        const formattedAttendance = await Promise.all(todayAttendance.map(async (a) => {
          const op = await Operator.findById(a.operatorId);
          return {
            operatorName: op?.name || 'Unknown',
            employeeId: op?.employeeId || 'N/A',
            station: op?.station || 'N/A',
            timestamp: a.timestamp,
            status: a.status,
          };
        }));
        await sendAttendanceEmail(formattedAttendance);
        console.log('Attendance email sent!');
      } catch (err) {
        console.error('Error sending attendance email:', err);
      }
    }

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
    console.error('Error marking attendance:', error);
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
  let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'engg.datanalytics.padget@dixoninfo.com',
      pass: 'jhjy piwi slyp yxqz'
    }
  });

  let html = `<h3>Attendance Data</h3><table border="1"><tr>
    <th>Operator Name</th><th>Employee ID</th><th>Station</th><th>Timestamp</th><th>Status</th>
    </tr>`;
  attendanceData.forEach(a => {
    html += `<tr>
      <td>${a.operatorName}</td>
      <td>${a.employeeId}</td>
      <td>${a.station}</td>
      <td>${a.timestamp}</td>
      <td>${a.status}</td>
    </tr>`;
  });
  html += `</table>`;

  await transporter.sendMail({
    from: '"Attendance System" <engg.datanalytics.padget@dixoninfo.com>',
    to: 'btbte21074_aarushi@banasthali.in',
    subject: 'All Stations Attendance Marked',
    html: html
  });
}


