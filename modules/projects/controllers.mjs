import { ProjectModel } from './models.mjs';
import { ProjectService, apiError } from './services.mjs';

export function integer(value, name, { min = 1, max = 2147483647 } = {}) {
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value)) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
        throw apiError(400, `${name} must be an integer between ${min} and ${max}`);
    return Number(value);
}
function text(value, name, max, optional = false) {
    if (optional && (value === undefined || value === null)) return null;
    if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max)
        throw apiError(400, `${name} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters`);
    return value.trim();
}
function date(value, name) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
        throw apiError(400, `${name} must be an ISO date-time`);
    return new Date(value);
}
export function fieldsFor(action, body = {}) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw apiError(400, 'JSON object required');
    const optionalId = (value, name, max = 2147483647) => value === undefined || value === null ? null : integer(value, name, { max });
    if (['createProject', 'updateProject'].includes(action)) {
        const result = {
            name: text(body.Project_Name, 'Project_Name', 500), description: text(body.Project_Desc, 'Project_Desc', 20000, true),
            head: optionalId(body.Project_Head, 'Project_Head'), start: date(body.Est_Start_Dt, 'Est_Start_Dt'),
            end: date(body.Est_End_Dt, 'Est_End_Dt'), status: integer(body.Project_Status ?? 0, 'Project_Status', { min: 0 }),
        };
        if (result.start && result.end && result.end < result.start) throw apiError(400, 'Est_End_Dt must not precede Est_Start_Dt');
        if (action === 'createProject' && body.stages !== undefined) {
            if (!Array.isArray(body.stages) || body.stages.length > 100)
                throw apiError(400, 'stages must be an array of at most 100 stages');
            result.stages = body.stages.map(stage => fieldsFor('createStage', stage));
        }
        return result;
    }
    if (['createStage', 'updateStage'].includes(action)) return {
        stageName: text(body.Stage_Name, 'Stage_Name', 200),
        sortOrder: integer(body.Sort_Order ?? 0, 'Sort_Order', { min: 0 }),
        active: integer(body.IsActive ?? 1, 'IsActive', { min: 0, max: 1 }),
    };
    if (['createTaskType', 'updateTaskType'].includes(action)) return {
        taskType: text(body.Task_Type, 'Task_Type', 200), stageId: optionalId(body.stage_Id, 'stage_Id', Number.MAX_SAFE_INTEGER),
        status: integer(body.Status ?? 0, 'Status', { min: 0 }),
    };
    if (['createTopic', 'updateTopic'].includes(action)) {
        const result = { topic: text(body.Topic, 'Topic', 100), topicDescription: text(body.Description, 'Description', 250, true) };
        if (action === 'createTopic') {
            if (!Array.isArray(body.memberIds ?? []) || (body.memberIds ?? []).length > 100) throw apiError(400, 'memberIds must be an array of at most 100 local user IDs');
            result.memberIds = (body.memberIds ?? []).map(value => integer(value, 'memberIds'));
        }
        return result;
    }
    if (action === 'addMember') return { memberId: integer(body.User_Id, 'User_Id') };
    if (action === 'createMessage') return { message: text(body.Message, 'Message', 10000) };
    return {};
}

export function requireProjectAuth(req, res, next) {
    if (!req.authenticateId || !req.authenticatedCompanyId || !req.localUserId || !req.db ||
        Number(req.authenticatedCompanyId) !== Number(req.dbID))
        return res.status(401).json({ success: false, data: null, message: 'A valid company login with a local user identity is required' });
    next();
}

function contextFor(req) {
    const result = {
        companyId: integer(req.authenticatedCompanyId, 'Authenticated company'),
        userId: integer(req.localUserId, 'Authenticated local user'),
    };
    for (const key of ['projectId', 'stageId', 'topicId', 'fileId', 'taskTypeId'])
        if (req.params[key] !== undefined) result[key] = integer(req.params[key], key, ['stageId', 'fileId'].includes(key) ? { max: Number.MAX_SAFE_INTEGER } : {});
    if (req.params.fileKey !== undefined) {
        if (typeof req.params.fileKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.fileKey))
            throw apiError(400, 'fileKey must be a UUID');
        result.fileKey = req.params.fileKey.toLowerCase();
    }
    return result;
}
export const pageFor = (req, includeSearch = false) => ({
    offset: integer(req.query.offset ?? 0, 'offset', { min: 0, max: 1000000 }),
    limit: integer(req.query.limit ?? 50, 'limit', { max: 100 }),
    ...(includeSearch ? { search: text(req.query.search ?? '', 'search', 500, true) ?? '' } : {}),
});

export const handle = (action, serviceFactory = pool => new ProjectService(new ProjectModel(pool))) => async (req, res, next) => {
    try {
        const context = contextFor(req);
        const service = serviceFactory(req.db);
        if (action === 'download' || action === 'downloadByKey') {
            const file = await service.download(context, action === 'downloadByKey');
            res.set('X-Content-Type-Options', 'nosniff');
            return res.download(file.path, file.name, { headers: { 'Content-Type': 'application/octet-stream' } }, error => {
                if (error) next(error);
            });
        }
        let data;
        if (action === 'upload') {
            const fileName = text(req.query.fileName, 'fileName', 500);
            if (/[\\/\x00-\x1f\x7f]/.test(fileName) || fileName === '.' || fileName === '..') throw apiError(400, 'Invalid fileName');
            if (!Buffer.isBuffer(req.body)) throw apiError(415, 'Send the file as application/octet-stream');
            if (!req.body.length) throw apiError(400, 'File is empty');
            if (req.body.length > 10 * 1024 * 1024) throw apiError(413, 'File exceeds 10 MB');
            const fileType = (req.get('content-type') || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
            const maxFileTypeLength = context.stageId ? 100 : 50;
            if (!fileType) throw apiError(400, 'Content-Type cannot be empty');
            data = await service.upload(context, fileName, req.body,
                fileType.length <= maxFileTypeLength ? fileType : 'application/octet-stream');
        } else if (action === 'files') data = await service.files(context, pageFor(req));
        else data = await service.run(action, context, { ...fieldsFor(action, req.body), ...pageFor(req, action === 'projects') });
        const created = action.startsWith('create') || action === 'upload';
        return res.status(created ? 201 : 200).json({ success: true, data, message: created ? 'Created successfully' : 'Request successful' });
    } catch (error) { next(error); }
};

export function projectErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const stageRoute = /\/(stages|task-types)(\/|$)/.test(req.originalUrl?.split('?')[0] || '') ||
        (req.method === 'POST' && /\/api\/projects\/?$/.test(req.originalUrl?.split('?')[0] || '') && req.body?.stages?.length > 0);
    const missingStageSchema = stageRoute && ([207, 208].includes(error.number) || [207, 208].includes(error.originalError?.info?.number));
    const status = missingStageSchema ? 503 : ([400, 401, 403, 404, 413, 415].includes(error.status) ? error.status : 500);
    if (status === 500) return next(error);
    return res.status(status).json({ success: false, data: null,
        message: missingStageSchema ? 'Required stage or task-type tables/columns are missing or incompatible in the selected company database. Verify tbl_Project_Stage, tbl_Project_Stage_Files, and tbl_Task_Type.stage_Id.' : error.message });
}
