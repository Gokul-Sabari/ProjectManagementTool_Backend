import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectModel } from '../modules/projects/models.mjs';
import { ProjectService } from '../modules/projects/services.mjs';
import { projectErrorHandler } from '../modules/projects/controllers.mjs';

test('stage inserts require database ID generation and explicitly write UTC creation time', async () => {
    let statement;
    class Request {
        input() { return this; }
        async query(value) { statement = value; return { recordset: [{ Id: 7, CreatedAt: new Date() }] }; }
    }
    const result = await new ProjectModel({}, { Request }).createStage({});
    assert.match(statement, /IsIdentity/);
    assert.match(statement, /sys\.default_constraints/);
    assert.match(statement, /THROW 51001/);
    assert.match(statement, /IsActive,CreatedAt\)/);
    assert.match(statement, /@active,SYSUTCDATETIME\(\)/);
    assert.equal(result[0].Id, 7);
});

test('missing legacy ID generator rolls back nested project creation', async () => {
    const calls = [];
    class Transaction {
        async begin() { calls.push('begin'); }
        async commit() { calls.push('commit'); }
        async rollback() { calls.push('rollback'); }
    }
    const error = Object.assign(new Error('Stage ID generation missing'), { number: 51001 });
    const model = new ProjectModel({}, { Transaction });
    model.createProject = async () => [{ Project_Id: 17 }];
    model.createStage = async () => { throw error; };
    await assert.rejects(new ProjectService(model).run('createProject', { companyId: 1, userId: 8 },
        { name: 'Demo', stages: [{ stageName: 'Stage 3' }] }), value => value === error);
    assert.deepEqual(calls, ['begin', 'rollback']);
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    projectErrorHandler(error, { method: 'POST', originalUrl: '/api/projects', body: { stages: [{}] } }, res, () => assert.fail('must handle'));
    assert.equal(res.code, 503);
    assert.match(res.body.message, /Stage ID generation is missing/);
    assert.match(res.body.message, /0002_repair_stage_ids\.sql/);
});

test('nested driver errors identify missing ID generation without exposing SQL details', () => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    projectErrorHandler({ originalError: { info: { number: 51001 } } },
        { method: 'POST', originalUrl: '/api/projects/17/stages' }, res, () => assert.fail('must handle'));
    assert.equal(res.code, 503);
    assert.match(res.body.message, /0002_repair_stage_ids\.sql/);
});
