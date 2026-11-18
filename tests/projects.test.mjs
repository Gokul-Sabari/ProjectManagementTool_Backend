import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sql from 'mssql';
import { ProjectService } from '../modules/projects/services.mjs';
import { ProjectModel } from '../modules/projects/models.mjs';
import { fieldsFor, integer, handle, pageFor, requireProjectAuth, projectErrorHandler } from '../modules/projects/controllers.mjs';
import ProjectRouter, { projectPaths, projectSchemas } from '../modules/projects/index.mjs';
import { app } from '../app.mjs';

const context = { companyId: 2, userId: 8, projectId: 10, topicId: 20 };
test('project list query validates a bounded search term', () => {
    assert.deepEqual(pageFor({ query: { offset: '0', limit: '50', search: '  ERP  ' } }, true), {
        offset: 0, limit: 50, search: 'ERP',
    });
    assert.throws(() => pageFor({ query: { search: 'x'.repeat(501) } }, true), { status: 400 });
    assert.throws(() => pageFor({ query: { search: ['ERP', 'HR'] } }, true), { status: 400 });
});
test('project list applies search before pagination and remains company-scoped', async () => {
    const inputs = {};
    let statement;
    class Request {
        input(name, type, value) { inputs[name] = { type, value }; return this; }
        async query(value) { statement = value; return { recordset: [] }; }
    }
    const service = new ProjectService(new ProjectModel({}, { Request }));
    await service.run('projects', context, { offset: 0, limit: 50, search: 'ERP' });
    assert.match(statement, /WHERE Company_id=@companyId AND Del_Flag=0/);
    assert.match(statement, /CHARINDEX\(LOWER\(@search\),LOWER\(Project_Name\)\)>0/);
    assert.match(statement, /CHARINDEX\(LOWER\(@search\),LOWER\(COALESCE\(Project_Desc,N''\)\)\)>0/);
    assert.match(statement, /OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    assert.equal(inputs.companyId.value, 2);
    assert.equal(inputs.search.value, 'ERP');
});
test('discussion members and messages include display names for chat headings', async () => {
    const statements = [];
    class Request {
        input() { return this; }
        async query(statement) { statements.push(statement); return { recordset: [] }; }
    }
    const model = new ProjectModel({}, { Request });
    await model.members({ topicId: 20, offset: 0, limit: 50 });
    await model.messages({ topicId: 20, offset: 0, limit: 50 });
    await model.files({ topicId: 20, projectId: 10, offset: 0, limit: 50 }, false);
    assert.match(statements[0], /LEFT JOIN dbo\.tbl_Users u ON u\.UserId=m\.User_Id/);
    assert.match(statements[0], /AS User_Name/);
    assert.match(statements[1], /LEFT JOIN dbo\.tbl_Users u ON u\.UserId=m\.User_Id/);
    assert.match(statements[1], /AS User_Name/);
    assert.match(statements[2], /LEFT JOIN dbo\.tbl_Users u ON u\.UserId=f\.User_Id/);
    assert.match(statements[2], /AS User_Name/);
});
test('task-type listing maps stages within the project and company without hiding unassigned types', async () => {
    const rows = [
        { Task_Type_Id: 12, stage_Id: 4, Stage_Name: 'Design', Stage_Sort_Order: 4 },
        { Task_Type_Id: 13, stage_Id: null, Stage_Name: null, Stage_Sort_Order: null },
    ];
    const inputs = {};
    let statement;
    class Request {
        input(name, type, value) { inputs[name] = value; return this; }
        async query(value) { statement = value; return { recordset: rows }; }
    }
    const service = new ProjectService(new ProjectModel({}, { Request }));
    // The service checks project ownership before executing the task-type query.
    service.model.project = async p => { assert.equal(p.companyId, 2); return [{ Project_Id: 10 }]; };
    assert.deepEqual(await service.run('taskTypes', context, { offset: 0, limit: 50 }), rows);
    assert.match(statement, /LEFT JOIN dbo\.tbl_Project_Stage s ON s\.Id=t\.stage_Id/);
    assert.match(statement, /s\.Project_Id=t\.Project_Id AND s\.Company_Id=@companyId/);
    assert.match(statement, /t\.Project_Id=@projectId/);
    assert.match(statement, /OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    assert.equal(inputs.companyId, 2);
    assert.equal(inputs.projectId, 10);
    const response = projectPaths['/api/projects/{projectId}/task-types'].get.responses[200].content['application/json'];
    assert.equal(response.schema.properties.data.items.$ref, '#/components/schemas/TaskType');
    assert.equal(response.example.data[0].Stage_Name, 'Design');
});
test('stage and stage-file queries bind BIGINT IDs and return chronological metadata', async () => {
    const inputs = {};
    const statements = [];
    class Request {
        input(name, type, value) { inputs[name] = { type, value }; return this; }
        async query(statement) { statements.push(statement); return { recordset: [] }; }
    }
    const model = new ProjectModel({}, { Request });
    const stageId = 3000000000;
    await model.stage({ stageId, projectId: 10, companyId: 2 });
    assert.equal(inputs.stageId.type, sql.BigInt);
    assert.equal(inputs.stageId.value, stageId);
    await model.files({ stageId, projectId: 10, companyId: 2, offset: 0, limit: 50 }, true);
    assert.match(statements[1], /f\.Stage_Id=@stageId AND f\.Project_Id=@projectId AND f\.Company_Id=@companyId/);
    assert.match(statements[1], /ORDER BY f\.CreatedAt ASC,f\.Id ASC/);
    assert.match(statements[1], /f\.Stage_Id,f\.Project_Id,f\.Company_Id/);
    assert.match(statements[1], /RIGHT\(f\.File_Path,36\) AS Download_Key/);
    assert.doesNotMatch(statements[1], /SELECT f\.File_Path/);
    await model.createFile({
        stageId, projectId: 10, companyId: 2, userId: 8, fileName: 'requirements.pdf',
        filePath: '2/stages/3000000000/2026-11-18/12345678-1234-1234-1234-123456789012', fileType: 'application/pdf', fileSize: 10,
    }, true);
    assert.equal(inputs.stageId.type, sql.BigInt);
    assert.equal(inputs.fileSize.type, sql.BigInt);
    assert.match(statements[2], /INSERT dbo\.tbl_Project_Stage_Files\(Stage_Id,Project_Id,Company_Id,User_Id,File_Name,File_Path,File_Type,File_Size,CreatedAt\)/);
    assert.match(statements[2], /SYSUTCDATETIME\(\)/);
    assert.match(statements[2], /OUTPUT INSERTED\.Id,INSERTED\.Stage_Id,INSERTED\.Project_Id,INSERTED\.Company_Id/);
    await model.file({ stageId, projectId: 10, companyId: 2, fileId: 4000000000 }, true);
    assert.equal(inputs.fileId.type, sql.BigInt);
    await model.fileByKey({ stageId, projectId: 10, companyId: 2, fileKey: '12345678-1234-1234-1234-123456789012' }, true);
    assert.equal(inputs.fileKey.type.type, sql.NVarChar);
    assert.equal(inputs.fileKey.type.length, 36);
    assert.match(statements[4], /RIGHT\(File_Path,36\)=@fileKey AND Stage_Id=@stageId AND Project_Id=@projectId AND Company_Id=@companyId/);
});
test('project creation validates nested stages before writing', () => {
    for (const stages of [null, {}, [null], [{}], [{ Stage_Name: ' ' }], Array(101).fill({ Stage_Name: 'x' })]) {
        assert.throws(() => fieldsFor('createProject', { Project_Name: 'Portal', stages }), { status: 400 });
    }
    assert.deepEqual(fieldsFor('createProject', { Project_Name: 'Portal', stages: [
        { Stage_Name: ' Design ', IsActive: 0, Company_Id: 999, Project_Id: 999 },
    ] }).stages, [{ stageName: 'Design', sortOrder: 0, active: 0 }]);
});

test('project and nested stages share a transaction and authenticated company', async () => {
    const tx = {};
    const service = new ProjectService({
        transaction: async work => work(tx),
        createProject: async (p, connection) => {
            assert.equal(connection, tx);
            assert.equal(p.stages, undefined);
            return [{ Project_Id: 42, Project_Name: p.name }];
        },
        createStage: async (p, connection) => {
            assert.equal(connection, tx);
            assert.equal(p.projectId, 42);
            assert.equal(p.companyId, 2);
            assert.equal(p.active, 0);
            return [{ Id: 7, Stage_Name: p.stageName }];
        },
    });
    const result = await service.run('createProject', { companyId: 2, userId: 8 },
        fieldsFor('createProject', { Project_Name: 'Portal', stages: [{ Stage_Name: 'Design', IsActive: 0 }] }));
    assert.equal(result.Project_Id, 42);
    assert.deepEqual(result.stages, [{ Id: 7, Stage_Name: 'Design' }]);
});

test('nested stage failure rolls back project creation', async () => {
    const calls = [];
    class Transaction {
        async begin() { calls.push('begin'); }
        async commit() { calls.push('commit'); }
        async rollback() { calls.push('rollback'); }
    }
    const model = new ProjectModel({}, { Transaction });
    model.createProject = async () => { calls.push('project'); return [{ Project_Id: 42 }]; };
    model.createStage = async () => { throw new Error('stage failed'); };
    await assert.rejects(new ProjectService(model).run('createProject', { companyId: 2, userId: 8 },
        { name: 'Portal', stages: [{ stageName: 'Design' }] }), /stage failed/);
    assert.deepEqual(calls, ['begin', 'project', 'rollback']);
});

test('project-only requests do not require stage schema or transaction', async () => {
    const service = new ProjectService({ createProject: async p => {
        assert.equal(p.stages, undefined);
        return [{ Project_Id: 42 }];
    } });
    for (const stages of [undefined, []]) {
        assert.deepEqual(await service.run('createProject', { companyId: 2, userId: 8 }, { name: 'Portal', stages }), { Project_Id: 42 });
    }
});

test('validation rejects malformed IDs, invalid dates, overlong names and oversized membership arrays', () => {
    for (const value of ['1 OR 1=1', '1x', '-1', '1.5', {}, 2147483648]) assert.throws(() => integer(value, 'id'), { status: 400 });
    assert.throws(() => fieldsFor('createProject', { Project_Name: '  ' }), { status: 400 });
    assert.throws(() => fieldsFor('createProject', { Project_Name: 'x', Est_Start_Dt: 'tomorrow' }), { status: 400 });
    assert.throws(() => fieldsFor('createProject', { Project_Name: 'x', Est_Start_Dt: '2026-11-20T00:00:00Z', Est_End_Dt: '2026-11-19T00:00:00Z' }), { status: 400 });
    assert.throws(() => fieldsFor('createTopic', { Topic: 'topic', memberIds: Array(101).fill(1) }), { status: 400 });
    assert.throws(() => fieldsFor('createTopic', { Topic: 'x'.repeat(101) }), { status: 400 });
    assert.equal(fieldsFor('createTaskType', { Task_Type: ' Design ', stage_Id: 4 }).stageId, 4);
    assert.equal(fieldsFor('createTaskType', { Task_Type: ' Design ', stage_Id: '3000000000' }).stageId, 3000000000);
    assert.throws(() => fieldsFor('createTaskType', { Task_Type: ' Design ', stage_Id: Number.MAX_SAFE_INTEGER + 1 }), { status: 400 });
});

test('a project in a different company cannot be used for nested reads or writes', async () => {
    let accessed = false;
    const service = new ProjectService({ project: async p => { assert.equal(p.companyId, 2); return []; }, createStage: () => { accessed = true; } });
    await assert.rejects(service.run('createStage', context, { stageName: 'Design' }), { status: 404 });
    assert.equal(accessed, false);
});

test('all authenticated company users can read discussion messages and download files', async () => {
    let messageRead = false;
    let fileAccess = false;
    const service = new ProjectService({
        project: async () => [{}], topic: async () => [{}],
        messages: async () => { messageRead = true; return []; },
        file: async () => [{ File_Path: '2/12345678-1234-1234-1234-123456789012', File_Name: 'notes.txt' }],
    }, { access: async () => { fileAccess = true; } });
    await service.run('messages', context, { offset: 0, limit: 50 });
    await service.download({ ...context, fileId: 1 });
    assert.equal(messageRead, true);
    assert.equal(fileAccess, true);
});

test('discussion listing is scoped to the company and project, not topic membership', async () => {
    let statement;
    class Request {
        input() { return this; }
        async query(value) { statement = value; return { recordset: [] }; }
    }
    const model = new ProjectModel({}, { Request });
    await model.topics({ companyId: 2, projectId: 10, userId: 999, offset: 0, limit: 50 });
    assert.match(statement, /WHERE t\.Project_Id=@projectId AND t\.Company_id=@companyId/);
    assert.doesNotMatch(statement, /tbl_Discussion_Group_Members/);
});

test('topic creation atomically adds its creator and deduplicated members', async () => {
    const members = [];
    const transaction = {};
    const service = new ProjectService({
        project: async () => [{}], localUser: async () => [{}],
        transaction: async work => work(transaction),
        createTopic: async (p, tx) => { assert.equal(tx, transaction); assert.equal(p.companyId, 2); return [{ Id: 30 }]; },
        addMember: async (p, tx) => { assert.equal(tx, transaction); members.push(p); },
    });
    const result = await service.run('createTopic', context, { topic: 'Review', memberIds: [8, 9, 9] });
    assert.equal(result.Id, 30);
    assert.deepEqual(members, [{ topicId: 30, memberId: 8 }, { topicId: 30, memberId: 9 }]);
});

test('upload removes bytes if inserting metadata fails', async () => {
    const writes = [], removed = [];
    const service = new ProjectService({
        project: async () => [{}], stage: async () => [{}],
        createFile: async (record, stage) => {
            assert.equal(stage, true);
            assert.equal(record.companyId, 2);
            assert.equal(record.stageId, 3);
            assert.equal(record.fileType, 'image/png');
            assert.match(record.filePath, /^2\/stages\/3\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}$/);
            throw new Error('database unavailable');
        },
    }, { mkdir: async () => {}, writeFile: async (...args) => writes.push(args), unlink: async file => removed.push(file) });
    await assert.rejects(service.upload({ companyId: 2, userId: 8, projectId: 10, stageId: 3 }, 'image.png', Buffer.from('image'), 'image/png'), /database unavailable/);
    assert.equal(writes.length, 1);
    assert.deepEqual(removed, [writes[0][0]]);
    assert.equal(writes[0][2].flag, 'wx');
});

test('discussion uploads keep files with MIME types longer than the legacy column', async () => {
    let upload;
    const req = {
        authenticateId: 'token', authenticatedCompanyId: 2, localUserId: 8, db: {}, dbID: 2,
        params: { projectId: '10', topicId: '20' }, query: { fileName: 'notes.docx' },
        body: Buffer.from('document'),
        get: () => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const res = {
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
    };
    await handle('upload', () => ({
        upload: async (...args) => { upload = args; return { Id: 1 }; },
    }))(req, res, error => { if (error) throw error; });
    assert.equal(res.code, 201);
    assert.equal(upload[0].topicId, 20);
    assert.equal(upload[3], 'application/octet-stream');
});

test('downloads reject absolute, traversal and other-company stored paths', async () => {
    for (const filePath of ['../../.env', 'C:/private/file', '1/12345678-1234-1234-1234-123456789012']) {
        const service = new ProjectService({
            project: async () => [{}], topic: async () => [{}],
            file: async () => [{ File_Path: filePath }],
        });
        await assert.rejects(service.download({ ...context, fileId: 1 }), { status: 404 });
    }
});

test('downloads accept company-scoped stage and discussion date paths', async () => {
    const accessed = [];
    const service = new ProjectService({
        project: async () => [{}], stage: async () => [{}], topic: async () => [{}],
        file: async (p, stage) => [{
            File_Path: stage
                ? '2/stages/3/2026-11-18/12345678-1234-1234-1234-123456789012'
                : '2/discussions/20/2026-11-18/12345678-1234-1234-1234-123456789012',
            File_Name: 'file.png',
        }],
    }, { access: async filePath => accessed.push(filePath) });
    await service.download({ ...context, stageId: 3, fileId: 1 });
    await service.download({ ...context, fileId: 1 });
    assert.equal(accessed.length, 2);
});

test('key-based downloads find stage files when their nullable database ID is missing', async () => {
    let queried = false;
    const service = new ProjectService({
        project: async () => [{}], stage: async () => [{}],
        fileByKey: async (params, stage) => {
            queried = true;
            assert.equal(params.fileKey, '12345678-1234-1234-1234-123456789012');
            assert.equal(stage, true);
            return [{ File_Path: '2/stages/3/2026-11-18/12345678-1234-1234-1234-123456789012', File_Name: 'file.docx' }];
        },
    }, { access: async () => {} });
    const result = await service.download({
        companyId: 2, userId: 8, projectId: 10, stageId: 3,
        fileKey: '12345678-1234-1234-1234-123456789012',
    }, true);
    assert.equal(queried, true);
    assert.equal(result.name, 'file.docx');
});

test('model binds project names and company identity as SQL parameters', async () => {
    const inputs = {};
    let statement;
    const connection = {};
    class Request {
        constructor(pool) { assert.equal(pool, connection); }
        input(name, type, value) { assert.ok(type); inputs[name] = value; return this; }
        async query(text) { statement = text; return { recordset: [{ Project_Id: 1 }] }; }
    }
    const model = new ProjectModel(connection, { Request });
    const name = "project'); SELECT secret --";
    await model.createProject({ companyId: 2, userId: 8, name });
    assert.equal(statement.includes(name), false);
    assert.ok(statement.includes('@name'));
    assert.ok(statement.includes('@companyId'));
    assert.equal(inputs.name, name);
    assert.equal(inputs.companyId, 2);
});

test('database transaction rolls back a failed multi-step operation', async () => {
    const calls = [];
    class Transaction {
        async begin() { calls.push('begin'); }
        async commit() { calls.push('commit'); }
        async rollback() { calls.push('rollback'); }
    }
    const model = new ProjectModel({}, { Transaction });
    await assert.rejects(model.transaction(async () => { throw new Error('member insert failed'); }), /member insert failed/);
    assert.deepEqual(calls, ['begin', 'rollback']);
});

test('controllers use authenticated identities and ignore spoofed author/company fields', async () => {
    let values;
    const controller = handle('createProject', () => ({ run: async (...args) => { values = args; return { Project_Id: 1 }; } }));
    const req = { authenticatedCompanyId: 2, localUserId: 8, params: {}, query: {}, body: { Project_Name: 'Demo', Company_id: 99, Entry_By: 99 }, db: {} };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller(req, res, error => { throw error; });
    assert.equal(res.code, 201);
    assert.deepEqual(values[1], { companyId: 2, userId: 8 });
    assert.equal(values[2].companyId, undefined);
    assert.equal(values[2].userId, undefined);
});

async function withServer(application, work) {
    const server = application.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await work(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

test('company header alone does not grant access to project APIs', async () => {
    const application = express();
    application.use((req, res, next) => { req.db = {}; req.dbID = 2; next(); });
    application.use('/api/projects', ProjectRouter);
    await withServer(application, async base => {
        const response = await fetch(base + '/api/projects');
        assert.equal(response.status, 401);
        assert.equal((await response.json()).success, false);
    });
});

test('mismatched authenticated and selected databases fail authorization', () => {
    const res = { status(value) { this.code = value; return this; }, json() {} };
    requireProjectAuth({ authenticateId: 'token', authenticatedCompanyId: 2, localUserId: 8, db: {}, dbID: 1 }, res, () => assert.fail('must not authorize'));
    assert.equal(res.code, 401);
});

test('missing stage schema returns an actionable JSON 503', () => {
    const res = { status(value) { this.code = value; return this; }, json(body) { this.body = body; } };
    projectErrorHandler({ number: 208 }, { originalUrl: '/api/projects/1/stages' }, res, () => assert.fail('handled schema error'));
    assert.equal(res.code, 503);
    assert.ok(res.body.message.includes('tbl_Project_Stage_Files'));
});

test('Swagger documents safe BIGINT stage-file metadata for list and upload', () => {
    const filesPath = projectPaths['/api/projects/{projectId}/stages/{stageId}/files'];
    const responseSchema = filesPath.get.responses[200].content['application/json'].schema.properties.data.items;
    assert.equal(responseSchema.$ref, '#/components/schemas/ProjectStageFile');
    assert.equal(filesPath.post.responses[201].content['application/json'].schema.properties.data.$ref, '#/components/schemas/UploadedProjectStageFile');
    assert.equal(projectSchemas.ProjectStageFile.properties.Stage_Id.maximum, Number.MAX_SAFE_INTEGER);
    assert.equal(projectSchemas.ProjectStageFile.properties.File_Type.maxLength, 100);
    assert.equal('User_Name' in projectSchemas.UploadedProjectStageFile.properties, false);
});

test('Swagger exposes implemented routes, bearer auth, binary uploads and local UI assets', async () => {
    await withServer(app, async base => {
        const response = await fetch(base + '/api-docs/openapi.json');
        const spec = await response.json();
        assert.equal(response.status, 200);
        assert.equal(spec.components.securitySchemes.CompanyToken.scheme, 'bearer');
        assert.ok(spec.paths['/api/projects'].post);
        for (const route of Object.keys(projectPaths)) assert.ok(spec.paths[route]);
        assert.equal(spec.paths['/api/projects/{projectId}/stages/{stageId}/files'].post.requestBody.content['image/*'].schema.format, 'binary');
        const asset = await fetch(base + '/api-docs/assets/swagger-ui-bundle.js');
        assert.equal(asset.status, 200);
        await asset.arrayBuffer();
        const missingRoute = await fetch(base + '/api/not-found');
        assert.equal(missingRoute.status, 404);
        await missingRoute.json();
    });
});

test('every documented project operation has a registered route', () => {
    const actual = new Set(ProjectRouter.stack.filter(layer => layer.route).flatMap(layer => {
        const route = '/api/projects' + (layer.route.path === '/' ? '' : layer.route.path.replace(/:(\w+)/g, '{$1}'));
        return Object.keys(layer.route.methods).map(method => method + ' ' + route);
    }));
    const documented = new Set(Object.entries(projectPaths).flatMap(([route, methods]) => Object.keys(methods).map(method => method + ' ' + route)));
    assert.deepEqual(actual, documented);
});

test('project Swagger documents all supplied master columns and typed complete responses', () => {
    const schema = projectPaths['/api/projects/{projectId}'].get.responses[200].content['application/json'];
    assert.equal(schema.schema.properties.data.$ref, '#/components/schemas/Project');
    assert.deepEqual(Object.keys(schema.example.data), [
        'Project_Id', 'Project_Name', 'Project_Desc', 'Company_id', 'Project_Head',
        'Est_Start_Dt', 'Est_End_Dt', 'Project_Status', 'Entry_By', 'Entry_Date',
        'Update_By', 'Update_Date', 'IsActive', 'Del_Flag',
    ]);
    assert.equal(schema.example.data.Project_Name, 'PURCHASE WORK');
    assert.equal(schema.example.data.Project_Desc, null);
    assert.equal(schema.example.data.Update_By, null);
    assert.equal(schema.example.data.Del_Flag, false);
    const body = projectPaths['/api/projects'].post.requestBody.content['application/json'].example;
    assert.equal(fieldsFor('createProject', body).start.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(fieldsFor('createProject', body).end.toISOString(), '2027-03-31T00:00:00.000Z');
    assert.equal('Company_id' in body, false);
});

test('project creation and update return the complete saved record', async () => {
    const record = projectPaths['/api/projects/{projectId}'].get.responses[200].content['application/json'].example.data;
    const statements = [];
    class Request {
        input() { return this; }
        async query(statement) { statements.push(statement); return { recordset: [record] }; }
    }
    const service = new ProjectService(new ProjectModel({}, { Request }));
    const fields = fieldsFor('createProject', { Project_Name: 'PURCHASE WORK' });
    assert.deepEqual(await service.run('createProject', context, fields), record);
    assert.deepEqual(await service.run('updateProject', context, fields), record);
    assert.ok(statements.filter(statement => /INSERT|UPDATE/.test(statement)).every(statement => statement.includes('OUTPUT INSERTED.*')));
    await service.run('projects', context, { offset: 0, limit: 50 });
    const listStatement = statements.at(-1);
    for (const column of ['Company_id', 'Entry_By', 'Entry_Date', 'Update_By', 'Update_Date', 'Del_Flag']) assert.ok(listStatement.includes(column));
});
