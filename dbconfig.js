require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    port: 1433,
    options: {
        encrypt: true, // Requerido por Azure
        trustServerCertificate: false // Más seguro
    }
};

module.exports = dbConfig;





