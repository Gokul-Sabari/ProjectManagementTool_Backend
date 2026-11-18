import test from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { asyncLocalStorage } from '../config/dbContext.mjs';
import * as responses from '../res.mjs';
import { LocalDateTime, encryptPasswordFun, decryptPasswordFun } from '../helper_functions.mjs';
import { ProjectService } from '../modules/projects/services.mjs';
import { ProjectModel } from '../modules/projects/models.mjs';
import { fieldsFor, pageFor, handle, projectErrorHandler } from '../modules/projects/controllers.mjs';

const context = { companyId: 2, userId: 8, projectId: 10, topicId: 20, stageId: 3 };
const response = () => ({ locals: { requestId: 'test-request' }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

for (const [name, status, success] of [
    ['success', 200, true], ['dataFound', 200, true], ['noData', 200, true],
    ['failed', 400, false], ['invalidInput', 400, false],
]) test(`response helper ${name} returns its public envelope`, () => {
    const res = response();
    responses[name](res);
    assert.equal(res.code, status);
    assert.equal(res.body.success, success);
    assert.deepEqual(res.body.data, []);
    assert.deepEqual(res.body.others, {});
    assert.equal(typeof res.body.message, 'string');
});

test('sentData handles populated and empty results', () => {
    for (const data of [[], [{ Id: 1 }]]) {
        const res = response();
        responses.sentData(res, data, { total: data.length });
        assert.deepEqual(res.body.data, data);
        assert.equal(res.body.others.total, data.length);
        assert.equal(res.body.message, data.length ? 'data found' : 'No data');
    }
});

test('password helpers round trip Unicode with an explicit test key', t => {
    const previous = process.env.passwordKey;
    t.after(() => { if (previous === undefined) delete process.env.passwordKey; else process.env.passwordKey = previous; });
    process.env.passwordKey = 'component-test-key';
    const ciphertext = encryptPasswordFun('secret 🔒');
    assert.notEqual(ciphertext, 'secret 🔒');
    assert.equal(decryptPasswordFun(ciphertext), 'secret 🔒');
});

test('LocalDateTime applies the documented five-and-a-half-hour offset', () => {
    const before = Date.now();
    const actual = Date.parse(LocalDateTime()) - 5.5 * 3600000;
    assert.ok(actual >= before && actual <= Date.now());
});

test('database context isolates simultaneous company requests and explicit overrides', async () => {
    await Promise.all([{}, {}].map(pool => asyncLocalStorage.run(pool, async () => {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(new sql.Request().parent, pool);
        assert.equal(new sql.Transaction().parent, pool);
        const explicit = {};
        assert.equal(new sql.Request(explicit).parent, explicit);
        assert.equal(new sql.Transaction(explicit).parent, explicit);
    })));
    assert.equal(asyncLocalStorage.getStore(), undefined);
});

for (const [action, body, expected] of [
    ['updateStage', { Stage_Name: ' Review ', IsActive: 0 }, { stageName: 'Review', sortOrder: 0, active: 0 }],
    ['updateTaskType', { Task_Type: ' Build ' }, { taskType: 'Build', stageId: null, status: 0 }],
    ['createTopic', { Topic: ' Review ' }, { topic: 'Review', topicDescription: null, memberIds: [] }],
    ['updateTopic', { Topic: ' Review ', Description: ' Notes ' }, { topic: 'Review', topicDescription: 'Notes' }],
    ['addMember', { User_Id: '9' }, { memberId: 9 }],
    ['createMessage', { Message: ' Hello ' }, { message: 'Hello' }],
]) test(`controller validates and normalizes ${action}`, () => assert.deepEqual(fieldsFor(action, body), expected));

for (const [action, body] of [
    ['createStage', { Stage_Name: 'x', IsActive: 2 }],
    ['createStage', { Stage_Name: 'x', Sort_Order: -1 }],
    ['createTaskType', { Task_Type: 'x', stage_Id: 0 }],
    ['createTopic', { Topic: 'x', memberIds: ['invalid'] }],
    ['addMember', { User_Id: null }], ['createMessage', { Message: ' ' }],
    ['createMessage', { Message: 'x'.repeat(10001) }], ['createProject', null],
]) test(`controller rejects invalid ${action}: ${JSON.stringify(body)?.slice(0, 80)}`, () => assert.throws(() => fieldsFor(action, body), { status: 400 }));

test('pagination defaults and upper bounds are enforced', () => {
    assert.deepEqual(pageFor({ query: {} }), { offset: 0, limit: 50 });
    for (const query of [{ offset: -1 }, { offset: 1000001 }, { limit: 0 }, { limit: 101 }, { limit: ['2'] }])
        assert.throws(() => pageFor({ query }), { status: 400 });
});

for (const action of ['stages', 'taskTypes', 'topics', 'createStage', 'updateStage', 'createTaskType', 'updateTaskType', 'updateTopic', 'members', 'messages', 'createMessage']) {
    test(`service dispatches ${action} only after checking its parent`, async () => {
        const calls = [];
        const rows = [{ Id: 99 }];
        const model = Object.fromEntries(['project', 'stage', 'topic'].map(name => [name, async () => { calls.push(name); return [{}]; }]));
        model[action] = async p => { calls.push(action); assert.equal(p.companyId, 2); return rows; };
        const result = await new ProjectService(model).run(action, context, { stageId: 3 });
        assert.equal(calls[0], 'project');
        assert.equal(calls.at(-1), action);
        assert.deepEqual(result, action.startsWith('create') && action !== 'createMessage' || ['updateStage', 'updateTaskType'].includes(action) ? rows[0] : rows);
    });
    test(`service blocks ${action} when the project is inaccessible`, async () => {
        const model = { project: async () => [], [action]: () => assert.fail('operation must not run') };
        await assert.rejects(new ProjectService(model).run(action, context, {}), { status: 404 });
    });
}

test('invalid project heads and discussion members prevent writes', async () => {
    const service = new ProjectService({ project: async () => [{}], topic: async () => [{}], localUser: async () => [],
        createProject: () => assert.fail('must not write'), transaction: () => assert.fail('must not begin') });
    for (const [action, fields] of [['createProject', { head: 9 }], ['createTopic', { memberIds: [9] }], ['addMember', { memberId: 9 }]])
        await assert.rejects(service.run(action, context, fields), { status: 400 });
});

test('model transaction commits results and preserves original errors if rollback fails', async () => {
    const calls = [];
    class Transaction {
        async begin(level) { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); calls.push('begin'); }
        async commit() { calls.push('commit'); }
        async rollback() { calls.push('rollback'); throw new Error('rollback failed'); }
    }
    const model = new ProjectModel({}, { Transaction });
    assert.equal(await model.transaction(async tx => { assert.ok(tx instanceof Transaction); return 42; }), 42);
    assert.deepEqual(calls, ['begin', 'commit']);
    const original = new Error('write failed');
    await assert.rejects(model.transaction(async () => { throw original; }), error => error === original);
    assert.deepEqual(calls, ['begin', 'commit', 'begin', 'rollback']);
});

for (const [fileName, body, status] of [
    ['../secret', Buffer.from('x'), 400], ['a/b', Buffer.from('x'), 400],
    ['..', Buffer.from('x'), 400], ['file', {}, 415], ['file', Buffer.alloc(0), 400],
    ['file', Buffer.alloc(10 * 1024 * 1024 + 1), 413],
]) test(`upload controller rejects ${fileName} with ${status} (${body.length ?? 'JSON'} bytes)`, async () => {
    let error;
    await handle('upload', () => ({ upload: () => assert.fail('must not upload') }))({
        authenticatedCompanyId: 2, localUserId: 8, params: { projectId: '10', stageId: '3' }, query: { fileName }, body,
    }, response(), value => { error = value; });
    assert.equal(error.status, status);
});

test('downloads return 404 for missing metadata and missing content', async () => {
    for (const rows of [[], [{ File_Path: '2/12345678-1234-1234-1234-123456789012' }]]) {
        const service = new ProjectService({ project: async () => [{}], stage: async () => [{}], file: async () => rows },
            { access: async () => { throw new Error('ENOENT'); } });
        await assert.rejects(service.download(context), { status: 404 });
    }
});

test('project error handler forwards unknown errors and errors after headers are sent', () => {
    for (const [error, headersSent] of [[new Error('private database detail'), false], [{ status: 400 }, true]]) {
        const res = response(); res.headersSent = headersSent;
        let forwarded;
        projectErrorHandler(error, { originalUrl: '/api/projects' }, res, value => { forwarded = value; });
        assert.equal(forwarded, error);
        assert.equal(res.body, undefined);
    }
});

// Exercise every query method with a driver double: no company database is modified.
for (const method of Object.getOwnPropertyNames(ProjectModel.prototype).filter(name => !['constructor', 'query', 'transaction'].includes(name))) {
    test(`model ${method} binds all SQL placeholders and propagates driver failures`, async () => {
        const params = { ...context, memberId: 9, taskTypeId: 4, fileId: 5,
            name: "name'); DROP TABLE example;--", description: null, head: null,
            start: null, end: null, status: 0, stageName: 'Design', sortOrder: 0, active: 1,
            taskType: 'Build', topic: 'Review', topicDescription: null, message: 'Hello',
            offset: 0, limit: 50, search: '', fileName: 'notes.txt', filePath: 'managed/path',
            fileKey: '12345678-1234-1234-1234-123456789012', fileType: 'text/plain', fileSize: 5 };
        const failure = new Error('driver unavailable');
        for (const stage of [false, true]) {
            const bound = new Map();
            let fail = false;
            class Request {
                input(name, type, value) { assert.ok(type, name); bound.set(name, value); return this; }
                async query(statement) {
                    for (const [, name] of statement.matchAll(/@(\w+)/g)) assert.ok(bound.has(name), `unbound ${name}`);
                    assert.equal(statement.includes(params.name), false);
                    if (fail) throw failure;
                    return { recordset: [{ Id: 1 }] };
                }
            }
            const model = new ProjectModel({}, { Request });
            const invoke = () => ['files', 'createFile', 'file', 'fileByKey'].includes(method) ? model[method](params, stage) : model[method](params);
            assert.deepEqual(await invoke(), [{ Id: 1 }]);
            fail = true;
            await assert.rejects(invoke(), error => error === failure);
        }
    });
}
