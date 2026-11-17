import 'dotenv/config';
import './config/dbContext.mjs';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import AuthorizationRouter from './routes/authorization.mjs';
import dbconnect from './middleware/otherDB.mjs';
import { connectDB } from './config/dbconfig.mjs';
import { loginSpec, swaggerHtml } from './config/swagger.mjs';
import swaggerUi from 'swagger-ui-dist';
import ProjectRouter from './modules/projects/index.mjs';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
    res.locals.requestId = crypto.randomUUID();
    res.locals.startedAt = process.hrtime.bigint();
    next();
});
app.get('/api-docs/openapi.json', (req, res) => res.json(loginSpec));
app.use('/api-docs/assets', express.static(swaggerUi.getAbsoluteFSPath(), { index: false }));
app.get(['/api-docs', '/api-docs/'], (req, res) => res.type('html').send(swaggerHtml));
for (const prefix of ['/api/authorization', '/api/configuration/login', '/api/login']) {
    app.use(prefix, dbconnect, AuthorizationRouter);
}
app.use('/api/projects', dbconnect, ProjectRouter);
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    const messages = { 400: 'Invalid request', 413: 'Request body too large', 415: 'Unsupported content type', 500: 'Internal server error' };
    res.status(status).json({ success: false, data: null, message: messages[status] });
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await connectDB();
        const port = process.env.PORT || 9002;
        app.listen(port, () => console.log(`Project management backend listening on port ${port}`));
    } catch {
        console.error('Database connection failed. Check local configuration.');
        process.exitCode = 1;
    }
}
