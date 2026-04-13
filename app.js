const express = require('express'); // Restarting for OTP schema fix
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const os = require('os');
require('dotenv').config();

const db = require('./models'); // make sure this points to your updated Sequelize setup with PostgreSQL

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = '0.0.0.0';

// ========== Middlewares ==========
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(morgan('dev'));
// ========== Routes ==========
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const resourceRoutes = require('./routes/resource.routes');
const taskRoutes = require('./routes/task.routes');
const couponRoutes = require('./routes/coupon.routes');
const leaveRoutes = require('./routes/leave.routes');
const notificationRoutes = require('./routes/notification.routes');
const path = require('path');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notificationRoutes);

// Serve static files from uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));
// ========== Get Local IP ==========
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ========== Start Server ==========
db.sequelize.authenticate()
  .then(() => {
    // Initialize cron jobs for task acknowledgment
    require('./jobs/morning-awareness');
    const { runTaskEscalation } = require('./jobs/task-escalation');
    const { handleRecurrence } = require('./jobs/task-recurrence');
    const { runStart10MinReminderJob, runOtpProgressSummaryJob, runDocumentSummaryJob, runPreTaskCreatorSummaryJob } = require('./jobs/task-notifications');
    const cron = require('node-cron');

    // Daily task escalation check at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('[CRON] Starting daily task escalation check...');
      await runTaskEscalation();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    // Daily task recurrence check at 00:05
    cron.schedule('5 0 * * *', async () => {
      console.log('[CRON] Starting daily task recurrence check...');
      await handleRecurrence();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    // 10-Minute Pre-Task Reminder: Runs every minute
    cron.schedule('* * * * *', async () => {
      await runStart10MinReminderJob();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    // 2-Hour Pre-Task Creator Summary check: Runs every minute
    cron.schedule('* * * * *', async () => {
      await runPreTaskCreatorSummaryJob();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    // OTP Progress Summary Check: Runs every minute, triggering internally for 15m after start/end
    cron.schedule('* * * * *', async () => {
      await runOtpProgressSummaryJob();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    // Document Summary Job: Runs daily at 9:00 PM (21:00)
    cron.schedule('0 21 * * *', async () => {
      console.log('[CRON] Starting document summary check at 9 PM...');
      await runDocumentSummaryJob();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    const localIP = getLocalIP();
    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running at:`);
      console.log(`→ Local:   http://localhost:${PORT}`);
      console.log(`→ Network: http://${localIP}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to database:', err.message);
  });

