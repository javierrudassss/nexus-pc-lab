const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
require('dotenv').config();
const connectPgSimple = require('connect-pg-simple');
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedDevices = new Set(['desktop', 'laptop', 'mobile']);
const allowedComponents = new Set(['cpu', 'mobo', 'ram', 'gpu', 'psu']);
const rateLimits = new Map();
const database = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        max: 5,
        connectionTimeoutMillis: 5000
    })
    : null;
const scrypt = promisify(crypto.scrypt);
const sessionSecret = process.env.SESSION_SECRET;
const dummyPasswordHash = `${Buffer.alloc(16).toString('hex')}:${Buffer.alloc(64).toString('hex')}`;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));
app.use(session({
    name: 'nexus.sid',
    secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
    store: database
        ? new (connectPgSimple(session))({
            pool: database,
            tableName: 'user_sessions',
            createTableIfMissing: true,
            pruneSessionInterval: 15 * 60
        })
        : undefined,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

function requireDatabase(_request, response, next) {
    if (!database) {
        response.status(503).json({ error: 'La base de datos no está configurada. Define DATABASE_URL para habilitar las cuentas y proyectos.' });
        return;
    }
    next();
}

function requireSameOrigin(request, response, next) {
    const origin = request.get('origin');
    let expectedOrigin;
    try {
        expectedOrigin = `${request.protocol}://${request.get('host')}`;
    } catch {
        response.status(403).json({ error: 'No se pudo validar el origen de la solicitud.' });
        return;
    }
    if (!origin || origin !== expectedOrigin) {
        response.status(403).json({ error: 'La solicitud debe originarse desde este sitio.' });
        return;
    }
    next();
}

function createRateLimiter({ limit, windowMs, message, keyPrefix }) {
    return (request, response, next) => {
        const key = `${keyPrefix}:${request.ip}`;
        const now = Date.now();
        const current = rateLimits.get(key);
        if (!current || now >= current.resetAt) {
            rateLimits.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }
        if (current.count >= limit) {
            response.status(429).json({ error: message });
            return;
        }
        current.count += 1;
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimits) {
        if (now >= value.resetAt) rateLimits.delete(key);
    }
}, 15 * 60 * 1000).unref();

const limitAccountCreation = createRateLimiter({
    limit: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Demasiados intentos de registro. Intenta de nuevo en 15 minutos.',
    keyPrefix: 'register'
});
const limitSignIn = createRateLimiter({
    limit: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.',
    keyPrefix: 'login'
});
const limitProjectChanges = createRateLimiter({
    limit: 30,
    windowMs: 60 * 1000,
    message: 'Alcanzaste el límite temporal de guardados. Intenta de nuevo en un minuto.',
    keyPrefix: 'projects'
});

function requireAuthentication(request, response, next) {
    if (!request.session.user) {
        response.status(401).json({ error: 'Inicia sesión para ver y guardar tus proyectos.' });
        return;
    }
    next();
}

function validateCredentials(body, registration = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'El cuerpo de la solicitud debe ser un objeto JSON.';
    }
    if (registration &&
        (typeof body.displayName !== 'string' || body.displayName.trim().length < 2 || body.displayName.trim().length > 60)) {
        return 'Tu nombre debe tener entre 2 y 60 caracteres.';
    }
    if (typeof body.email !== 'string' || body.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        return 'Escribe un correo electrónico válido.';
    }
    if (typeof body.password !== 'string' || Buffer.byteLength(body.password, 'utf8') > 128) {
        return 'La contraseña no puede superar 128 bytes.';
    }
    if (registration && body.password.length < 12) {
        return 'La contraseña debe tener al menos 12 caracteres.';
    }
    return null;
}

function validateProject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'El cuerpo de la solicitud debe ser un objeto JSON.';
    }
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80) {
        return 'El nombre debe tener entre 1 y 80 caracteres.';
    }
    if (!allowedDevices.has(body.device)) {
        return 'El tipo de equipo no es válido.';
    }
    if (!body.components || typeof body.components !== 'object' || Array.isArray(body.components)) {
        return 'La configuración de componentes no es válida.';
    }
    const keys = Object.keys(body.components);
    if (keys.some(key => !allowedComponents.has(key))) {
        return 'La configuración contiene piezas no reconocidas.';
    }
    if (keys.some(key => body.components[key] !== null &&
        (typeof body.components[key] !== 'string' || body.components[key].length > 50))) {
        return 'Cada pieza debe ser un identificador válido o null.';
    }
    return null;
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    const [saltHex, keyHex] = storedHash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expectedKey = Buffer.from(keyHex, 'hex');
    const derivedKey = await scrypt(password, salt, expectedKey.length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(expectedKey, derivedKey);
}

function startAuthenticatedSession(request, response, user, statusCode) {
    request.session.regenerate(error => {
        if (error) {
            response.status(500).json({ error: 'No se pudo crear una sesión segura. Intenta nuevamente.' });
            return;
        }
        request.session.user = {
            id: user.id,
            email: user.email,
            displayName: user.display_name
        };
        request.session.save(saveError => {
            if (saveError) {
                response.status(500).json({ error: 'No se pudo guardar la sesión. Intenta nuevamente.' });
                return;
            }
            response.status(statusCode).json({ user: request.session.user });
        });
    });
}

app.get('/api/health', async (_request, response, next) => {
    if (!database) {
        response.status(503).json({ status: 'error', error: 'DATABASE_URL no está configurada.' });
        return;
    }
    try {
        await database.query('SELECT 1');
        response.json({ status: 'ok' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/me', requireDatabase, (request, response) => {
    response.json({ user: request.session.user || null });
});

app.post('/api/auth/register', requireDatabase, requireSameOrigin, limitAccountCreation, async (request, response, next) => {
    const validationError = validateCredentials(request.body, true);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }
    const email = request.body.email.trim().toLowerCase();
    try {
        const passwordHash = await hashPassword(request.body.password);
        const result = await database.query(
            'INSERT INTO users (display_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name',
            [request.body.displayName.trim(), email, passwordHash]
        );
        startAuthenticatedSession(request, response, result.rows[0], 201);
    } catch (error) {
        if (error.code === '23505') {
            response.status(409).json({ error: 'Ya existe una cuenta con ese correo electrónico.' });
            return;
        }
        next(error);
    }
});

app.post('/api/auth/login', requireDatabase, requireSameOrigin, limitSignIn, async (request, response, next) => {
    const validationError = validateCredentials(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }
    const email = request.body.email.trim().toLowerCase();
    try {
        const result = await database.query(
            'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
            [email]
        );
        const user = result.rows[0];
        const passwordIsValid = await verifyPassword(
            request.body.password,
            user ? user.password_hash : dummyPasswordHash
        );
        if (!user || !passwordIsValid) {
            response.status(401).json({ error: 'El correo o la contraseña no son correctos.' });
            return;
        }
        startAuthenticatedSession(request, response, user, 200);
    } catch (error) {
        next(error);
    }
});

app.post('/api/auth/logout', requireDatabase, requireSameOrigin, (request, response, next) => {
    request.session.destroy(error => {
        if (error) {
            next(error);
            return;
        }
        response.clearCookie('nexus.sid', {
            httpOnly: true,
            secure: request.secure,
            sameSite: 'lax'
        });
        response.json({ ok: true });
    });
});

app.get('/api/projects', requireDatabase, requireAuthentication, async (request, response, next) => {
    const offset = Number(request.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) {
        response.status(400).json({ error: 'El desplazamiento de la lista no es válido.' });
        return;
    }
    try {
        const result = await database.query(
            'SELECT id, name, device, components, created_at, updated_at FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 101 OFFSET $2',
            [request.session.user.id, offset]
        );
        response.json({ projects: result.rows.slice(0, 100), hasMore: result.rows.length > 100 });
    } catch (error) {
        next(error);
    }
});

app.post('/api/projects', requireDatabase, requireSameOrigin, requireAuthentication, limitProjectChanges, async (request, response, next) => {
    const validationError = validateProject(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }
    try {
        const result = await database.query(
            'INSERT INTO projects (owner_id, name, device, components) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, name, device, components, created_at, updated_at',
            [request.session.user.id, request.body.name.trim(), request.body.device, JSON.stringify(request.body.components)]
        );
        response.status(201).json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.put('/api/projects/:id', requireDatabase, requireSameOrigin, requireAuthentication, limitProjectChanges, async (request, response, next) => {
    const projectId = Number(request.params.id);
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
        response.status(400).json({ error: 'El identificador del proyecto no es válido.' });
        return;
    }
    const validationError = validateProject(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }
    try {
        const result = await database.query(
            'UPDATE projects SET name = $1, device = $2, components = $3::jsonb, updated_at = NOW() WHERE id = $4 AND owner_id = $5 RETURNING id, name, device, components, created_at, updated_at',
            [request.body.name.trim(), request.body.device, JSON.stringify(request.body.components), projectId, request.session.user.id]
        );
        if (!result.rowCount) {
            response.status(404).json({ error: 'No se encontró ese proyecto en tu cuenta.' });
            return;
        }
        response.json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.use((request, response, next) => {
    if (/^\/(?:server\.js|package(?:-lock)?\.json|render\.yaml|\.env(?:\..*)?|node_modules|\.git)(?:\/|$)/i.test(request.path)) {
        response.sendStatus(404);
        return;
    }
    next();
});

app.use(express.static(path.resolve(__dirname), { index: 'index.html' }));

app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
        response.status(400).json({ error: 'El JSON enviado no tiene un formato válido.' });
        return;
    }
    if (error.type === 'entity.too.large') {
        response.status(413).json({ error: 'La solicitud supera el tamaño máximo permitido.' });
        return;
    }
    console.error('Error en la solicitud:', error);
    response.status(500).json({ error: 'Ocurrió un error interno. Revisa los registros del servidor.' });
});

async function start() {
    if (database) {
        if (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret, 'utf8') < 32) {
            throw new Error('Define SESSION_SECRET con al menos 32 bytes para habilitar sesiones seguras.');
        }
        await database.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                display_name VARCHAR(60) NOT NULL,
                email VARCHAR(254) NOT NULL UNIQUE,
                password_hash VARCHAR(200) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await database.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                name VARCHAR(80) NOT NULL,
                device VARCHAR(16) NOT NULL CHECK (device IN ('desktop', 'laptop', 'mobile')),
                components JSONB NOT NULL CHECK (jsonb_typeof(components) = 'object'),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await database.query(`
            ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE
        `);
        await database.query('CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_id, updated_at DESC)');
    } else {
        console.warn('DATABASE_URL no está configurada. El sitio funciona, pero las cuentas y proyectos requieren una base de datos.');
    }
    app.listen(port, '0.0.0.0', () => {
        console.log(`Nexus PC Lab disponible en http://localhost:${port}`);
    });
}

start().catch(error => {
    console.error('No se pudo iniciar el servidor o preparar la base de datos:', error);
    process.exitCode = 1;
});
