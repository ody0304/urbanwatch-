// dbconfig.js
require('dotenv').config();

// Extraemos el nombre del servidor (parte antes del primer punto) para el usuario completo
const serverName = process.env.DB_SERVER.split('.')[0];  // e.g. "urbanwatchs-sqlsrv"

module.exports = {
  user: `${process.env.DB_USER}@${serverName}`,  // e.g. "adminurbanwatchs@urbanwatchs-sqlsrv"
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: true,               // obligatorio en Azure
    trustServerCertificate: false
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};







