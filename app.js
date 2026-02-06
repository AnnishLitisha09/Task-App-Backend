const express = require('express');
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
db.sequelize.sync({ alter: true }) // will update your tables schema without dropping data
  .then(() => {
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
