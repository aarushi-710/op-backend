const express = require('express');
const router = express.Router();
const { getAttendance, markAttendance, exportAttendance, sendAttendanceNow } = require('../controllers/attendanceController');

router.get('/:line/:date', getAttendance);
router.post('/:line', markAttendance);
router.get('/export/:line', exportAttendance);
router.post('/send-attendance', sendAttendanceNow);

module.exports = router;