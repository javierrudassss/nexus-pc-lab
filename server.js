const path = require('node:path');
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const allowedDevices = new Set(['desktop', 'laptop', 'mobile']);
const allowedComponents = new Set(['cpu', 'mobo', 'ram', 'gpu', 'psu']);
const writeLimits = new Map();
const database = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        max: 5,
        connectionTimeoutMillis: 5000
    })
    : null;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

function requireDatabase(_request, response, next) {
    if (!database) {
        response.status(503).json({ error: 'La base de datos no está configurada. Define DATABASE_URL para habilitar los proyectos.' });
        return;
    }
    next();
}

function limitPublicWrites(request, response, next) {
    const now = Date.now();
    const key = request.ip;
    const current = writeLimits.get(key);
    if (!current || now - current.startedAt >= 60_000) {
        writeLimits.set(key, { startedAt: now, count: 1 });
        next();
        return;
    }
    if (current.count >= 20) {
        response.status(429).json({ error: 'Se alcanzó el límite temporal de guardados. Intenta de nuevo en un minuto.' });
        return;
    }
    current.count += 1;
    next();
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

app.get('/api/projects', requireDatabase, async (request, response, next) => {
    const offset = Number(request.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) {
        response.status(400).json({ error: 'El desplazamiento de la lista no es válido.' });
        return;
    }
    try {
        const result = await database.query(
            'SELECT id, name, device, components, created_at, updated_at FROM projects ORDER BY updated_at DESC LIMIT 101 OFFSET $1',
            [offset]
        );
        response.json({ projects: result.rows.slice(0, 100), hasMore: result.rows.length > 100 });
    } catch (error) {
        next(error);
    }
});

app.post('/api/projects', requireDatabase, limitPublicWrites, async (request, response, next) => {
    const validationError = validateProject(request.body);
    if (validationError) {
        response.status(400).json({ error: validationError });
        return;
    }
    try {
        const result = await database.query(
            'INSERT INTO projects (name, device, components) VALUES ($1, $2, $3::jsonb) RETURNING id, name, device, components, created_at, updated_at',
            [request.body.name.trim(), request.body.device, JSON.stringify(request.body.components)]
        );
        response.status(201).json(result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.put('/api/projects/:id', requireDatabase, limitPublicWrites, async (request, response, next) => {
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
            'UPDATE projects SET name = $1, device = $2, components = $3::jsonb, updated_at = NOW() WHERE id = $4 RETURNING id, name, device, components, created_at, updated_at',
            [request.body.name.trim(), request.body.device, JSON.stringify(request.body.components), projectId]
        );
        if (!result.rowCount) {
            response.status(404).json({ error: 'No se encontró ese proyecto.' });
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
    } else {
        console.warn('DATABASE_URL no está configurada. El sitio funciona, pero guardar proyectos requiere una base de datos.');
    }
    app.listen(port, '0.0.0.0', () => {
        console.log(`Nexus PC Lab disponible en http://localhost:${port}`);
    });
}

start().catch(error => {
    console.error('No se pudo iniciar el servidor o preparar la base de datos:', error);
    process.exitCode = 1;
});
