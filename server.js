const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const dbConfig = require('./dbconfig');

const app = express();
const PORT = process.env.PORT || 3000;

console.log("Driver activo:", dbConfig.driver || 'default (tedious)');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

require('dotenv').config();
console.log("Conectando con config:");
console.log(dbConfig);

// Configuración de correo electrónico
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS?.replace(/\s/g, '') || 'czhh gxlh tfjg nvtd'.replace(/\s/g, '')
    }
});

// Ruta ejemplo para conexión a la base de datos
app.get('/api/prueba', async (req, res) => {
    try {
        await sql.connect(dbConfig);
        const result = await sql.query('SELECT TOP 5 * FROM Ciudadanos');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al conectar con la base de datos');
    }
});

// Ruta de comprobación de salud
app.get('/saludz', (req, res) => {
  res.status(200).send('OK');
});


app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

async function crearTablas() {
    try {
        await sql.connect(dbConfig);
        
        // Crear tabla de ciudadanos
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='Ciudadanos' AND xtype='U'
            )
            CREATE TABLE Ciudadanos (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Nombre NVARCHAR(100),
                Correo NVARCHAR(100) UNIQUE,
                Contrasena NVARCHAR(100)
            )
        `);

        // Crear tabla para tokens de recuperación
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='PasswordResetTokens' AND xtype='U'
            )
            CREATE TABLE PasswordResetTokens (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Correo NVARCHAR(100) NOT NULL,
                Token NVARCHAR(255) NOT NULL,
                FechaCreacion DATETIME DEFAULT GETDATE(),
                Usado BIT DEFAULT 0,
                INDEX IX_Token (Token),
                INDEX IX_Correo (Correo)
            )
        `);

        console.log("Tablas verificadas/creadas correctamente.");
    } catch (err) {
        console.error("Error al crear/verificar tablas:", err);
    }
}
crearTablas();

// Registro
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password } = req.body;
    try {
        await sql.connect(dbConfig);
        await sql.query`
            INSERT INTO Ciudadanos (Nombre, Correo, Contrasena)
            VALUES (${nombre}, ${email}, ${password})
        `;
        res.status(200).send('Registro exitoso');
    } catch (err) {
        console.error(err);
        if (err.number === 2627) { // Error de duplicado
            res.status(400).json({ message: 'El correo electrónico ya está registrado' });
        } else {
            res.status(500).send('Error en el registro');
        }
    }
});

// Inicio de sesión
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT * FROM Ciudadanos
            WHERE Correo = ${email} AND Contrasena = ${password}
        `;
        if (result.recordset.length > 0) {
            res.status(200).json({ success: true });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al iniciar sesión');
    }
});

// Recuperación de contraseña - Enviar enlace
app.post('/api/recover-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        await sql.connect(dbConfig);
        
        // Verificar si el correo existe en la base de datos
        const userResult = await sql.query`
            SELECT * FROM Ciudadanos WHERE Correo = ${email}
        `;
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No existe una cuenta asociada a este correo electrónico' 
            });
        }
        
        // Generar token único
        const token = crypto.randomBytes(32).toString('hex');
        
        // Guardar token en la base de datos
        await sql.query`
            INSERT INTO PasswordResetTokens (Correo, Token)
            VALUES (${email}, ${token})
        `;
        
        // Crear enlace de recuperación
        const resetLink = `http://localhost:${PORT}/reset-password.html?token=${token}`;
        
        // Configurar email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'URBANWATCH - Recuperación de Contraseña',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #2457c5; color: white; padding: 20px; text-align: center;">
                        <h1>URBANWATCH</h1>
                    </div>
                    <div style="padding: 30px; background-color: #f9f9f9;">
                        <h2 style="color: #333;">Recuperación de Contraseña</h2>
                        <p>Hemos recibido una solicitud para restablecer la contraseña de su cuenta.</p>
                        <p>Haga clic en el siguiente enlace para crear una nueva contraseña:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #2C7A7B; color: white; padding: 12px 30px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block;">
                                Restablecer Contraseña
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px;">
                            Si no solicitó este cambio, puede ignorar este correo. 
                            Este enlace expirará en 1 hora por seguridad.
                        </p>
                        <p style="color: #666; font-size: 12px;">
                            Si el botón no funciona, copie y pegue este enlace en su navegador:<br>
                            <a href="${resetLink}">${resetLink}</a>
                        </p>
                    </div>
                </div>
            `
        };
        
        // Enviar email
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Se ha enviado un enlace de recuperación a su correo electrónico' 
        });
        
    } catch (err) {
        console.error('Error en recuperación de contraseña:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error al procesar la solicitud de recuperación' 
        });
    }
});

// Verificar token de recuperación
app.get('/api/verify-reset-token/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        await sql.connect(dbConfig);
        
        const result = await sql.query`
            SELECT * FROM PasswordResetTokens 
            WHERE Token = ${token} 
            AND Usado = 0 
            AND DATEDIFF(hour, FechaCreacion, GETDATE()) < 1
        `;
        
        if (result.recordset.length > 0) {
            res.json({ success: true, email: result.recordset[0].Correo });
        } else {
            res.status(400).json({ 
                success: false, 
                message: 'Token inválido o expirado' 
            });
        }
    } catch (err) {
        console.error('Error verificando token:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error al verificar el token' 
        });
    }
});

// Restablecer contraseña
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    
    try {
        await sql.connect(dbConfig);
        
        // Verificar token válido
        const tokenResult = await sql.query`
            SELECT * FROM PasswordResetTokens 
            WHERE Token = ${token} 
            AND Usado = 0 
            AND DATEDIFF(hour, FechaCreacion, GETDATE()) < 1
        `;
        
        if (tokenResult.recordset.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Token inválido o expirado' 
            });
        }
        
        const email = tokenResult.recordset[0].Correo;
        
        // Actualizar contraseña
        await sql.query`
            UPDATE Ciudadanos 
            SET Contrasena = ${newPassword}
            WHERE Correo = ${email}
        `;
        
        // Marcar token como usado
        await sql.query`
            UPDATE PasswordResetTokens 
            SET Usado = 1 
            WHERE Token = ${token}
        `;
        
        res.json({ 
            success: true, 
            message: 'Contraseña actualizada correctamente' 
        });
        
    } catch (err) {
        console.error('Error restableciendo contraseña:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error al restablecer la contraseña' 
        });
    }
});

// Limpiar tokens expirados (ejecutar periódicamente)
setInterval(async () => {
    try {
        await sql.connect(dbConfig);
        await sql.query`
            DELETE FROM PasswordResetTokens 
            WHERE DATEDIFF(hour, FechaCreacion, GETDATE()) > 24
        `;
    } catch (err) {
        console.error('Error limpiando tokens expirados:', err);
    }
}, 3600000); // Cada hora

async function crearTablaSupervisores() {
    try {
        await sql.connect(dbConfig);

        // Crear la tabla con el campo Dependencia y CodigoSupervisor
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='Supervisores' AND xtype='U'
            )
            CREATE TABLE Supervisores (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Nombre NVARCHAR(100),
                Correo NVARCHAR(100) UNIQUE,
                Contrasena NVARCHAR(100),
                Dependencia NVARCHAR(50),
                CodigoSupervisor NVARCHAR(20)
            );
        `);

        // Verificar si las columnas existen, si no, agregarlas
        const dependenciaExists = await sql.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Supervisores' AND COLUMN_NAME = 'Dependencia'
        `);

        if (dependenciaExists.recordset.length === 0) {
            await sql.query(`ALTER TABLE Supervisores ADD Dependencia NVARCHAR(50)`);
            console.log("Columna Dependencia agregada.");
        }

        const codigoExists = await sql.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'Supervisores' AND COLUMN_NAME = 'CodigoSupervisor'
        `);

        if (codigoExists.recordset.length === 0) {
            await sql.query(`ALTER TABLE Supervisores ADD CodigoSupervisor NVARCHAR(20)`);
            console.log("Columna CodigoSupervisor agregada.");
        }

        console.log("Tabla Supervisores verificada/creada con todas las columnas.");
    } catch (err) {
        console.error("Error al crear/verificar tabla Supervisores:", err);
    }
}

crearTablaSupervisores();

// ENDPOINT DE DEBUG
app.get('/api/debug-supervisores', async (req, res) => {
    try {
        await sql.connect(dbConfig);
        const result = await sql.query('SELECT * FROM Supervisores');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ENDPOINT PARA RESETEAR SUPERVISORES CON CÓDIGOS
app.get('/api/reset-supervisores', async (req, res) => {
    try {
        await sql.connect(dbConfig);
        
        // Eliminar supervisores existentes
        await sql.query('DELETE FROM Supervisores');
        
        // Recrear con datos correctos incluyendo códigos de supervisor
        await sql.query(`
            INSERT INTO Supervisores (Nombre, Correo, Contrasena, Dependencia, CodigoSupervisor) VALUES
            ('Ana', 'ana@urbanwatch.mx', 'agua123', 'agua', 'AGUA2025'),
            ('Carlos', 'carlos@urbanwatch.mx', 'luz456', 'alumbrado', 'LUZ2025'),
            ('María', 'maria@urbanwatch.mx', 'baches789', 'baches', 'BACHES2025'),
            ('Pedro', 'pedro@urbanwatch.mx', 'limpio321', 'basura', 'LIMPIO2025')
        `);
        
        res.json({ success: true, message: 'Supervisores reseteados correctamente con códigos de supervisor' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Login de supervisor
app.post('/api/login-supervisor', async (req, res) => {
    const { email, password, dependencia } = req.body;
    
    console.log('🔍 Intento de login:', { email, password, dependencia });
    
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT * FROM Supervisores
            WHERE Correo = ${email} AND Contrasena = ${password} AND Dependencia = ${dependencia}
        `;
        
        console.log('📊 Resultado de la base de datos:', result.recordset);
        
        if (result.recordset.length > 0) {
            const supervisor = result.recordset[0];
            console.log('✅ Login exitoso para:', supervisor.Nombre);
            res.status(200).json({ 
                success: true, 
                supervisor: {
                    id: supervisor.Id,
                    nombre: supervisor.Nombre,
                    correo: supervisor.Correo,
                    dependencia: supervisor.Dependencia
                }
            });
        } else {
            console.log('❌ Login fallido - credenciales no encontradas');
            res.status(401).json({ success: false, message: 'Credenciales inválidas o dependencia incorrecta' });
        }
    } catch (err) {
        console.error('💥 Error en login:', err);
        res.status(500).send('Error al iniciar sesión del supervisor');
    }
});

// NUEVOS ENDPOINTS PARA RECUPERACIÓN DE CONTRASEÑA

// Verificar email y dependencia para recuperación
app.post('/api/verificar-supervisor', async (req, res) => {
    const { email, dependencia } = req.body;
    
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT Id, Nombre, CodigoSupervisor FROM Supervisores
            WHERE Correo = ${email} AND Dependencia = ${dependencia}
        `;
        
        if (result.recordset.length > 0) {
            // Solo devolver que existe, no el código completo por seguridad
            res.status(200).json({ 
                success: true, 
                supervisorFound: true,
                nombre: result.recordset[0].Nombre
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'No se encontró un supervisor con ese email y dependencia' 
            });
        }
    } catch (err) {
        console.error('Error al verificar supervisor:', err);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// Verificar código de supervisor y cambiar contraseña
app.post('/api/cambiar-contrasena', async (req, res) => {
    const { email, dependencia, codigoSupervisor, nuevaContrasena } = req.body;
    
    console.log('🔍 Cambio de contraseña - Datos recibidos:', { 
        email, 
        dependencia, 
        codigoSupervisor, 
        nuevaContrasena: '***' 
    });
    
    try {
        await sql.connect(dbConfig);
        
        // Primero buscar el supervisor para debug
        const debug = await sql.query`
            SELECT * FROM Supervisores
            WHERE Correo = ${email} AND Dependencia = ${dependencia}
        `;
        console.log('🔎 Supervisor encontrado:', debug.recordset);
        
        const result = await sql.query`
            SELECT Id FROM Supervisores
            WHERE Correo = ${email} AND Dependencia = ${dependencia} AND CodigoSupervisor = ${codigoSupervisor}
        `;
        
        console.log('✅ Resultado con código:', result.recordset);
        
        if (result.recordset.length > 0) {
            // Actualizar contraseña
            await sql.query`
                UPDATE Supervisores 
                SET Contrasena = ${nuevaContrasena}
                WHERE Correo = ${email} AND Dependencia = ${dependencia}
            `;
            
            console.log('🎉 Contraseña actualizada correctamente');
            res.status(200).json({ 
                success: true, 
                message: 'Contraseña actualizada correctamente' 
            });
        } else {
            console.log('❌ Código incorrecto o supervisor no encontrado');
            res.status(401).json({ 
                success: false, 
                message: 'Código de supervisor incorrecto' 
            });
        }
    } catch (err) {
        console.error('💥 Error al cambiar contraseña:', err);
        res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});

// TABLA EMPLEADOS CON DEPENDENCIA
async function crearTablaEmpleados() {
    try {
        await sql.connect(dbConfig);

        // Crear la tabla si no existe
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='Empleados' AND xtype='U'
            )
            CREATE TABLE Empleados (
                IdEmpleado NVARCHAR(10) PRIMARY KEY,
                Nombre NVARCHAR(100),
                Correo NVARCHAR(100) UNIQUE,
                Departamento NVARCHAR(100),
                Dependencia NVARCHAR(50),
                Activo BIT DEFAULT 1
            );
        `);

        // Agregar la columna Activo si no existe
        const columnaActivo = await sql.query(`
            SELECT * FROM sys.columns
            WHERE Name = N'Activo' AND Object_ID = Object_ID(N'Empleados')
        `);

        if (columnaActivo.recordset.length === 0) {
            await sql.query(`ALTER TABLE Empleados ADD Activo BIT DEFAULT 1;`);
            console.log("Columna 'Activo' agregada.");
        }

        // Agregar la columna Dependencia si no existe
        const columnaDependencia = await sql.query(`
            SELECT * FROM sys.columns
            WHERE Name = N'Dependencia' AND Object_ID = Object_ID(N'Empleados')
        `);

        if (columnaDependencia.recordset.length === 0) {
            await sql.query(`ALTER TABLE Empleados ADD Dependencia NVARCHAR(50);`);
            console.log("Columna 'Dependencia' agregada.");
        }

        console.log("Tabla Empleados verificada/creada.");
    } catch (err) {
        console.error("Error al crear/verificar tabla Empleados:", err);
    }
}
crearTablaEmpleados();

// Función para convertir dependencia a departamento
function getDepartamentoFromDependencia(dependencia) {
    const departamentos = {
        'agua': 'Agua',
        'alumbrado': 'Alumbrado Público', 
        'baches': 'Baches y Calles',
        'basura': 'Basura y Limpieza'
    };
    return departamentos[dependencia] || dependencia;
}

// ENDPOINT PARA ALTA DE EMPLEADO CON DEPENDENCIA
app.post('/api/alta-empleado', async (req, res) => {
    const { nombre, correo, idEmpleado, dependencia } = req.body;
    try {
        await sql.connect(dbConfig);
        
        // El departamento será igual al nombre de la dependencia
        const departamento = getDepartamentoFromDependencia(dependencia);
        
        await sql.query`
            INSERT INTO Empleados (IdEmpleado, Nombre, Correo, Departamento, Dependencia)
            VALUES (${idEmpleado}, ${nombre}, ${correo}, ${departamento}, ${dependencia})
        `;
        res.status(200).send('Empleado registrado correctamente');
    } catch (err) {
        console.error(err);
        
        // Verificar si es error de ID duplicado
        if (err.number === 2627 && err.message.includes('PK__Empleado')) {
            res.status(400).send(`Error: Ya existe un empleado con ID "${idEmpleado}". Use un ID diferente.`);
        } 
        // Verificar si es error de email duplicado
        else if (err.number === 2627 && (err.message.includes('UQ__Empleado') || err.message.includes('Correo'))) {
            res.status(400).send(`Error: Ya existe un empleado con el correo "${correo}". Use un correo diferente.`);
        }
        else {
            res.status(500).send('Error al registrar empleado: ' + err.message);
        }
    }
});

// ENDPOINT PARA OBTENER EMPLEADOS POR DEPENDENCIA
app.get('/api/empleados/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT * FROM Empleados 
            WHERE Activo = 1 AND Dependencia = ${dependencia}
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al obtener empleados');
    }
});

// TABLA BAJA EMPLEADOS
async function crearTablaBajaEmpleados() {
    try {
        await sql.connect(dbConfig);
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='BajaEmpleados' AND xtype='U'
            )
            CREATE TABLE BajaEmpleados (
                IdBaja INT PRIMARY KEY IDENTITY(1,1),
                IdEmpleado NVARCHAR(10) FOREIGN KEY REFERENCES Empleados(IdEmpleado),
                Correo NVARCHAR(100),
                FechaBaja DATETIME DEFAULT GETDATE()
            );
        `);
        console.log("Tabla BajaEmpleados verificada/creada.");
    } catch (err) {
        console.error("Error al crear/verificar tabla BajaEmpleados:", err);
    }
}
crearTablaBajaEmpleados();

// ENDPOINT PARA BAJA DE EMPLEADO
app.post('/api/baja-empleado', async (req, res) => {
    const { idEmpleado, correo } = req.body;
    let pool, tran;
    try {
        pool = await sql.connect(dbConfig);
        tran = new sql.Transaction(pool);
        await tran.begin();

        const existe = await tran.request().query`
            SELECT * FROM Empleados WHERE IdEmpleado = ${idEmpleado}
        `;
        console.log("¿Empleado existe antes de baja lógica?:", existe.recordset.length > 0);

        if (existe.recordset.length === 0) {
            await tran.rollback();
            return res.status(404).send('Empleado no encontrado, no se puede dar de baja.');
        }

        // 1. Registrar en tabla BajaEmpleados
        await tran.request().query`
            INSERT INTO BajaEmpleados (IdEmpleado, Correo)
            VALUES (${idEmpleado}, ${correo})
        `;

        // 2. Marcar al empleado como inactivo
        await tran.request().query`
            UPDATE Empleados
            SET Activo = 0
            WHERE IdEmpleado = ${idEmpleado}
        `;

        await tran.commit();
        res.status(200).send('Empleado dado de baja correctamente');
    } catch (err) {
        if (tran) await tran.rollback();
        console.error("Error en baja-empleado:", err);
        res.status(500).send('Error al dar de baja al empleado');
    }
});

// ENDPOINT PARA OBTENER BAJAS POR DEPENDENCIA
app.get('/api/bajas/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT b.IdEmpleado, ISNULL(e.Nombre, '—') AS Nombre, b.Correo, ISNULL(e.Departamento, '—') AS Departamento, b.FechaBaja
            FROM BajaEmpleados b
            LEFT JOIN Empleados e ON b.IdEmpleado = e.IdEmpleado
            WHERE e.Dependencia = ${dependencia} OR e.Dependencia IS NULL
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error('Error al obtener empleados dados de baja:', err);
        res.status(500).send('Error al obtener empleados dados de baja');
    }
});

// LOGIN DE EMPLEADO
app.post('/api/login-empleado', async (req, res) => {
    const { email, password } = req.body;

    try {
        await sql.connect(dbConfig);

        const result = await sql.query`
            SELECT * FROM Empleados
            WHERE Correo = ${email} AND IdEmpleado = ${password} AND Activo = 1
        `;

        if (result.recordset.length > 0) {
            res.status(200).json({ success: true, empleado: result.recordset[0] });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas o empleado inactivo' });
        }
    } catch (err) {
        console.error("Error al iniciar sesión del empleado:", err);
        res.status(500).send('Error al iniciar sesión del empleado');
    }
});

async function crearTablaReportes() {
    try {
        await sql.connect(dbConfig);
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='Reportes' AND xtype='U'
            )
            CREATE TABLE Reportes (
                IdReporte INT PRIMARY KEY IDENTITY(1,1),
                Categoria NVARCHAR(50),
                Direccion NVARCHAR(200),
                Titulo NVARCHAR(100),
                Descripcion NVARCHAR(MAX),
                Urgencia NVARCHAR(20),
                Imagen1 NVARCHAR(MAX),
                Imagen2 NVARCHAR(MAX),
                Imagen3 NVARCHAR(MAX),
                CorreoCiudadano NVARCHAR(100),
                FechaCreacion DATETIME DEFAULT GETDATE()
            );
        `);

        const result = await sql.query(`
            SELECT * FROM sys.columns
            WHERE Name = N'CorreoCiudadano' AND Object_ID = Object_ID(N'Reportes');
        `);

        if (result.recordset.length === 0) {
            await sql.query(`
                ALTER TABLE Reportes ADD CorreoCiudadano NVARCHAR(100);
            `);
            console.log("Columna CorreoCiudadano agregada.");
        }

        console.log("Tabla Reportes verificada/creada.");
    } catch (err) {
        console.error("Error al crear/verificar tabla Reportes:", err);
    }
}

// ✅ Este llamado debe existir:
crearTablaReportes();


app.post('/api/guardar-reporte', async (req, res) => {
    const {
        categoria,
        direccion,
        titulo,
        descripcion,
        urgencia,
        imagen1,
        imagen2,
        imagen3,
        correoCiudadano
    } = req.body;

    try {
        await sql.connect(dbConfig);

        // ✅ Insertar y obtener el ID generado automáticamente
        const result = await sql.query`
            INSERT INTO Reportes (Categoria, Direccion, Titulo, Descripcion, Urgencia, Imagen1, Imagen2, Imagen3, CorreoCiudadano)
            OUTPUT INSERTED.IdReporte
            VALUES (
                ${categoria},
                ${direccion},
                ${titulo},
                ${descripcion},
                ${urgencia},
                ${imagen1},
                ${imagen2},
                ${imagen3},
                ${correoCiudadano}
            )
        `;

        const nuevoId = result.recordset[0].IdReporte;

        // ✅ Enviar correo de confirmación
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_PASS
            }
        });

        const mailOptions = {
            from: 'urbanwatch@noreply.com',
            to: correoCiudadano,
            subject: `Confirmación de Reporte URBANWATCH`,
            text: `Gracias por su reporte. El ID de seguimiento es: ${nuevoId}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("❌ Error al enviar el correo:", error);
            } else {
                console.log("📧 Correo enviado: " + info.response);
            }
        });

        res.status(200).json({ success: true, idReporte: nuevoId });
    } catch (err) {
        console.error("❌ Error al guardar el reporte:", err);
        res.status(500).send('Error al guardar el reporte');
    }
});

// 1. Crear tabla en SQL Server para el seguimiento de estado de reportes y comentarios

async function crearTablaSeguimientoYComentarios() {
    try {
        await sql.connect(dbConfig);

        // Tabla de seguimiento del estado del reporte
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='EstadoReporte' AND xtype='U'
            )
            CREATE TABLE EstadoReporte (
                IdEstado INT PRIMARY KEY IDENTITY(1,1),
                IdReporte INT FOREIGN KEY REFERENCES Reportes(IdReporte),
                Estado NVARCHAR(50),
                Fecha DATETIME DEFAULT GETDATE()
            );
        `);

        // Tabla de comentarios ciudadanos
        await sql.query(`
            IF NOT EXISTS (
                SELECT * FROM sysobjects WHERE name='Comentarios' AND xtype='U'
            )
            CREATE TABLE Comentarios (
                IdComentario INT PRIMARY KEY IDENTITY(1,1),
                IdReporte INT FOREIGN KEY REFERENCES Reportes(IdReporte),
                CorreoCiudadano NVARCHAR(100),
                Comentario NVARCHAR(MAX),
                FechaComentario DATETIME DEFAULT GETDATE()
            );
        `);

        console.log("Tablas EstadoReporte y Comentarios verificadas/creadas.");
    } catch (err) {
        console.error("Error al crear tablas de seguimiento/comentarios:", err);
    }
}
crearTablaSeguimientoYComentarios();

// 2. Endpoint para consultar el estado de un reporte por ID
app.get('/api/estado-reporte/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT Estado, Fecha FROM EstadoReporte
            WHERE IdReporte = ${id}
            ORDER BY Fecha ASC
        `;
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("Error al obtener estado del reporte:", err);
        res.status(500).send("Error al obtener estado del reporte");
    }
});

// 3. Endpoint para obtener comentarios del reporte
app.get('/api/comentarios/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT CorreoCiudadano, Comentario, FechaComentario
            FROM Comentarios
            WHERE IdReporte = ${id}
            ORDER BY FechaComentario ASC
        `;
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("Error al obtener comentarios:", err);
        res.status(500).send("Error al obtener comentarios");
    }
});

// 4. Endpoint para insertar comentario
app.post('/api/comentarios', async (req, res) => {
    const { idReporte, correoCiudadano, comentario } = req.body;
    try {
        await sql.connect(dbConfig);
        await sql.query`
            INSERT INTO Comentarios (IdReporte, CorreoCiudadano, Comentario)
            VALUES (${idReporte}, ${correoCiudadano}, ${comentario})
        `;
        res.status(200).send("Comentario agregado correctamente");
    } catch (err) {
        console.error("Error al guardar comentario:", err);
        res.status(500).send("Error al guardar comentario");
    }
});

// Endpoint para obtener información general de un reporte por ID
app.get('/api/reporte-info/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT * FROM Reportes WHERE IdReporte = ${id}
        `;
        if (result.recordset.length === 0) {
            return res.status(404).send('Reporte no encontrado');
        }
        res.status(200).json(result.recordset[0]);
    } catch (err) {
        console.error("❌ Error al obtener datos del reporte:", err);
        res.status(500).send('Error al obtener datos del reporte');
    }
});

// Endpoint para obtener reportes del ciudadano autenticado
app.get('/api/reportes-recientes/:correo', async (req, res) => {
    const { correo } = req.params;
    
    try {
        await sql.connect(dbConfig);
        const result = await sql.query`
            SELECT 
                r.IdReporte, 
                r.Categoria, 
                r.Titulo,
                r.FechaCreacion,
                ISNULL(er.Estado, 'Pendiente') as Estado
            FROM Reportes r
            LEFT JOIN (
                SELECT IdReporte, Estado, 
                       ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.CorreoCiudadano = ${correo}
            ORDER BY r.FechaCreacion DESC
        `;
        res.status(200).json(result.recordset);
    } catch (err) {
        console.error("Error al obtener reportes del ciudadano:", err);
        res.status(500).send("Error al obtener reportes");
    }
});

// ENDPOINTS PARA EL PANEL DE AUTORIDADES
// Agregar estos endpoints al archivo server.js existente (después de las funciones de creación de tablas)

// =====================================================
// ENDPOINTS PARA PANEL DE EMPLEADOS
// =====================================================

// Endpoint para obtener reportes filtrados por dependencia del empleado
app.get('/api/reportes-empleado/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    
    console.log(`🔍 Buscando reportes para dependencia: ${dependencia}`);
    
    try {
        await sql.connect(dbConfig);
        
        // Obtener reportes con su último estado
        const result = await sql.query`
            SELECT 
                r.IdReporte,
                r.Categoria,
                r.Direccion,
                r.Titulo,
                r.Descripcion,
                r.Urgencia,
                r.CorreoCiudadano,
                r.FechaCreacion,
                er.Estado as EstadoActual,
                er.Fecha as FechaUltimoEstado
            FROM Reportes r
            LEFT JOIN (
                SELECT 
                    IdReporte, 
                    Estado, 
                    Fecha,
                    ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.Categoria = ${dependencia}
            ORDER BY r.FechaCreacion DESC
        `;
        
        console.log(`📊 Reportes encontrados para ${dependencia}:`, result.recordset.length);
        res.json(result.recordset);
        
    } catch (err) {
        console.error('❌ Error al obtener reportes por empleado:', err);
        res.status(500).json({ error: 'Error al obtener reportes' });
    }
});

// Endpoint para actualizar el estado de un reporte
app.post('/api/actualizar-estado-reporte', async (req, res) => {
    const { idReporte, estado, empleadoId } = req.body;
    
    console.log(`🔄 Actualizando estado - Reporte: ${idReporte}, Estado: ${estado}, Empleado: ${empleadoId}`);
    
    try {
        await sql.connect(dbConfig);
        
        // Verificar que el reporte existe
        const reporteExiste = await sql.query`
            SELECT IdReporte, CorreoCiudadano, Titulo FROM Reportes WHERE IdReporte = ${idReporte}
        `;
        
        if (reporteExiste.recordset.length === 0) {
            return res.status(404).json({ error: 'Reporte no encontrado' });
        }
        
        // Verificar que el empleado existe y está activo
        const empleadoValido = await sql.query`
            SELECT IdEmpleado, Nombre FROM Empleados 
            WHERE IdEmpleado = ${empleadoId} AND Activo = 1
        `;
        
        if (empleadoValido.recordset.length === 0) {
            return res.status(400).json({ error: 'Empleado no válido' });
        }
        
        // Insertar nuevo estado en el historial
        await sql.query`
            INSERT INTO EstadoReporte (IdReporte, Estado)
            VALUES (${idReporte}, ${estado})
        `;
        
        console.log(`✅ Estado actualizado correctamente`);
        
        // Enviar notificación por email al ciudadano
        try {
            await enviarNotificacionEstado(idReporte, estado, reporteExiste.recordset[0]);
            console.log(`📧 Notificación enviada`);
        } catch (emailError) {
            console.log('⚠️ Error al enviar notificación por email:', emailError.message);
            // No fallar la actualización si el email falla
        }
        
        res.json({ success: true, message: 'Estado actualizado correctamente' });
        
    } catch (err) {
        console.error('❌ Error al actualizar estado:', err);
        res.status(500).json({ error: 'Error al actualizar el estado del reporte' });
    }
});

// Función para enviar notificaciones de cambio de estado por email
async function enviarNotificacionEstado(idReporte, nuevoEstado, reporteInfo) {
    try {
        const estadosMensajes = {
            'recibido': 'Su reporte ha sido recibido y está siendo evaluado por nuestro equipo.',
            'proceso': 'Su reporte está siendo atendido activamente por nuestro personal técnico.',
            'verificado': 'Su reporte ha sido verificado y confirmado. Se procederá con la reparación.',
            'reparado': 'Su reporte ha sido completado exitosamente. ¡Gracias por ayudarnos a mejorar la ciudad!'
        };
        
        const coloresEstado = {
            'recibido': '#f59e0b',
            'proceso': '#3b82f6', 
            'verificado': '#10b981',
            'reparado': '#059669'
        };
        
        const mensajeEstado = estadosMensajes[nuevoEstado] || 'El estado de su reporte ha sido actualizado.';
        const colorEstado = coloresEstado[nuevoEstado] || '#6b7280';
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: reporteInfo.CorreoCiudadano,
            subject: `URBANWATCH - Actualización Reporte #${idReporte}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #1e40af; color: white; padding: 20px; text-align: center;">
                        <h1>URBANWATCH</h1>
                        <p style="margin: 0; opacity: 0.9;">Sistema de Reportes Ciudadanos</p>
                    </div>
                    <div style="padding: 30px; background-color: #f9f9f9;">
                        <h2 style="color: #333; margin-top: 0;">Actualización de su Reporte</h2>
                        <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${colorEstado};">
                            <p><strong>ID de Reporte:</strong> #${idReporte}</p>
                            <p><strong>Título:</strong> ${reporteInfo.Titulo}</p>
                            <p><strong>Nuevo Estado:</strong> 
                                <span style="background-color: ${colorEstado}; color: white; padding: 6px 12px; border-radius: 20px; text-transform: uppercase; font-weight: bold; font-size: 12px;">
                                    ${nuevoEstado}
                                </span>
                            </p>
                        </div>
                        <div style="background-color: #e0f7fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="margin: 0; color: #006064;">
                                <strong>📋 ${mensajeEstado}</strong>
                            </p>
                        </div>
                        <p style="color: #666; font-size: 14px; line-height: 1.6;">
                            Puede consultar el estado completo de su reporte y agregar comentarios adicionales 
                            visitando nuestro portal de seguimiento.
                        </p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="http://localhost:3000/detalle-reporte.html?id=${idReporte}">
                               style="background-color: #0d7d30; color: white; padding: 12px 30px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                                📱 Ver Seguimiento Completo
                            </a>
                        </div>
                        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
                        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
                            URBANWATCH - Mejorando nuestra ciudad juntos<br>
                            Este es un mensaje automático, no responda a este correo.
                        </p>
                    </div>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`📧 Notificación enviada a ${reporteInfo.CorreoCiudadano} para reporte ${idReporte}`);
        
    } catch (error) {
        console.error('❌ Error al enviar notificación:', error);
        throw error;
    }
}

// Endpoint para obtener estadísticas del panel por dependencia
app.get('/api/estadisticas-empleado/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    
    try {
        await sql.connect(dbConfig);
        
        const result = await sql.query`
            SELECT 
                COUNT(*) as Total,
                SUM(CASE WHEN er.Estado IS NULL OR er.Estado = 'recibido' THEN 1 ELSE 0 END) as Nuevos,
                SUM(CASE WHEN er.Estado IN ('proceso', 'verificado') THEN 1 ELSE 0 END) as EnProceso,
                SUM(CASE WHEN er.Estado = 'reparado' THEN 1 ELSE 0 END) as Cerrados
            FROM Reportes r
            LEFT JOIN (
                SELECT 
                    IdReporte, 
                    Estado,
                    ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.Categoria = ${dependencia}
        `;
        
        res.json(result.recordset[0]);
        
    } catch (err) {
        console.error('❌ Error al obtener estadísticas:', err);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// Endpoint para obtener el historial completo de estados de un reporte
app.get('/api/historial-estado/:idReporte', async (req, res) => {
    const { idReporte } = req.params;
    
    try {
        await sql.connect(dbConfig);
        
        const result = await sql.query`
            SELECT 
                er.Estado,
                er.Fecha,
                'Sistema' as NombreEmpleado
            FROM EstadoReporte er
            WHERE er.IdReporte = ${idReporte}
            ORDER BY er.Fecha ASC
        `;
        
        res.json(result.recordset);
        
    } catch (err) {
        console.error('❌ Error al obtener historial:', err);
        res.status(500).json({ error: 'Error al obtener historial de estados' });
    }
});

// Endpoint para dashboard de supervisores - resumen por dependencia
app.get('/api/dashboard-supervisor/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    
    try {
        await sql.connect(dbConfig);
        
        // Estadísticas generales
        const estadisticas = await sql.query`
            SELECT 
                COUNT(*) as TotalReportes,
                SUM(CASE WHEN er.Estado IS NULL OR er.Estado = 'recibido' THEN 1 ELSE 0 END) as Pendientes,
                SUM(CASE WHEN er.Estado IN ('proceso', 'verificado') THEN 1 ELSE 0 END) as EnProceso,
                SUM(CASE WHEN er.Estado = 'reparado' THEN 1 ELSE 0 END) as Completados,
                AVG(CASE 
                    WHEN er.Estado = 'reparado' 
                    THEN DATEDIFF(day, r.FechaCreacion, er.Fecha)
                    ELSE NULL 
                END) as TiempoPromedioResolucion
            FROM Reportes r
            LEFT JOIN (
                SELECT 
                    IdReporte, 
                    Estado,
                    Fecha,
                    ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.Categoria = ${dependencia}
        `;
        
        // Reportes por urgencia
        const porUrgencia = await sql.query`
            SELECT 
                r.Urgencia,
                COUNT(*) as Cantidad,
                SUM(CASE WHEN er.Estado = 'reparado' THEN 1 ELSE 0 END) as Resueltos
            FROM Reportes r
            LEFT JOIN (
                SELECT 
                    IdReporte, 
                    Estado,
                    ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.Categoria = ${dependencia}
            GROUP BY r.Urgencia
        `;
        
        // Actividad de empleados en la dependencia
        const actividadEmpleados = await sql.query`
            SELECT 
                e.Nombre,
                e.IdEmpleado,
                COUNT(CASE WHEN r.Categoria = ${dependencia} THEN 1 END) as ReportesAsignados,
                MAX(CASE WHEN r.Categoria = ${dependencia} THEN r.FechaCreacion END) as UltimaActividad
            FROM Empleados e
            LEFT JOIN Reportes r ON e.Dependencia = r.Categoria
            WHERE e.Dependencia = ${dependencia} AND e.Activo = 1
            GROUP BY e.Nombre, e.IdEmpleado
            ORDER BY ReportesAsignados DESC
        `;
        
        res.json({
            estadisticas: estadisticas.recordset[0],
            porUrgencia: porUrgencia.recordset,
            actividadEmpleados: actividadEmpleados.recordset
        });
        
    } catch (err) {
        console.error('❌ Error en dashboard supervisor:', err);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
});

// Endpoint para exportar reportes (CSV)
app.get('/api/exportar-reportes/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    const { formato = 'csv' } = req.query;
    
    try {
        await sql.connect(dbConfig);
        
        const result = await sql.query`
            SELECT 
                r.IdReporte,
                r.Titulo,
                r.Descripcion,
                r.Categoria,
                r.Direccion,
                r.Urgencia,
                r.CorreoCiudadano,
                r.FechaCreacion,
                ISNULL(er.Estado, 'recibido') as EstadoActual,
                er.Fecha as FechaUltimoEstado
            FROM Reportes r
            LEFT JOIN (
                SELECT 
                    IdReporte, 
                    Estado,
                    Fecha,
                    ROW_NUMBER() OVER (PARTITION BY IdReporte ORDER BY Fecha DESC) as rn
                FROM EstadoReporte
            ) er ON r.IdReporte = er.IdReporte AND er.rn = 1
            WHERE r.Categoria = ${dependencia}
            ORDER BY r.FechaCreacion DESC
        `;
        
        if (formato === 'csv') {
            // Configurar headers para descarga CSV
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="reportes_${dependencia}_${new Date().toISOString().split('T')[0]}.csv"`);
            
            // Crear CSV
            let csv = 'ID,Título,Descripción,Categoría,Dirección,Urgencia,Ciudadano,Fecha Creación,Estado,Fecha Actualización\n';
            
            result.recordset.forEach(row => {
                const fechaCreacion = new Date(row.FechaCreacion).toLocaleDateString('es-ES');
                const fechaActualizacion = row.FechaUltimoEstado ? new Date(row.FechaUltimoEstado).toLocaleDateString('es-ES') : '';
                
                csv += `"${row.IdReporte}","${row.Titulo}","${row.Descripcion}","${row.Categoria}","${row.Direccion}","${row.Urgencia}","${row.CorreoCiudadano}","${fechaCreacion}","${row.EstadoActual}","${fechaActualizacion}"\n`;
            });
            
            res.send(csv);
        } else {
            res.json(result.recordset);
        }
        
    } catch (err) {
        console.error('❌ Error al exportar reportes:', err);
        res.status(500).json({ error: 'Error al exportar reportes' });
    }
});

// =====================================================
// ENDPOINTS DE PRUEBA Y DEPURACIÓN
// =====================================================

// Endpoint de prueba para verificar la conexión y datos
app.get('/api/test-reportes-empleado', async (req, res) => {
    try {
        await sql.connect(dbConfig);
        
        const reportes = await sql.query('SELECT TOP 5 * FROM Reportes ORDER BY FechaCreacion DESC');
        const estados = await sql.query('SELECT TOP 5 * FROM EstadoReporte ORDER BY Fecha DESC');
        const empleados = await sql.query('SELECT * FROM Empleados WHERE Activo = 1');
        
        res.json({
            reportes: reportes.recordset,
            estados: estados.recordset,
            empleados: empleados.recordset,
            mensaje: 'Conexión exitosa - Panel de Autoridades'
        });
        
    } catch (err) {
        console.error('❌ Error en test:', err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para verificar reportes por dependencia específica
app.get('/api/debug-reportes/:dependencia', async (req, res) => {
    const { dependencia } = req.params;
    
    try {
        await sql.connect(dbConfig);
        
        console.log(`🔍 Debug para dependencia: ${dependencia}`);
        
        // Contar reportes por categoría
        const conteo = await sql.query`
            SELECT Categoria, COUNT(*) as Total 
            FROM Reportes 
            GROUP BY Categoria
        `;
        
        // Reportes específicos de la dependencia
        const reportesDep = await sql.query`
            SELECT * FROM Reportes 
            WHERE Categoria = ${dependencia}
            ORDER BY FechaCreacion DESC
        `;
        
        // Estados de reportes
        const estadosReportes = await sql.query`
            SELECT r.IdReporte, r.Titulo, er.Estado, er.Fecha
            FROM Reportes r
            LEFT JOIN EstadoReporte er ON r.IdReporte = er.IdReporte
            WHERE r.Categoria = ${dependencia}
            ORDER BY r.IdReporte, er.Fecha
        `;
        
        res.json({
            dependencia: dependencia,
            conteoGeneral: conteo.recordset,
            reportesDependencia: reportesDep.recordset,
            estadosDetalle: estadosReportes.recordset
        });
        
    } catch (err) {
        console.error('❌ Error en debug:', err);
        res.status(500).json({ error: err.message });
    }
});



