import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../../../controller/Authorization/login.mjs', import.meta.url), 'utf8');
const start = source.indexOf('// Step 3: Generate / reuse one token per configured company');
const end = source.indexOf('// Step 4:', start);
assert.ok(start >= 0 && end > start);

for (const userTypeId of [0, 1, 2]) {
  test(`company session keeps its own type ${userTypeId} and user identity`, async () => {
    const row = {
      Global_User_ID: 80, Local_User_ID: 8, Company_Id: 3,
      UserTypeId: userTypeId, Autheticate_Id: 'company-token',
    };
    const sessions = [];
    const lookups = [];
    class Request {
      input() { return this; }
      async query() { return { rowsAffected: [1] }; }
    }
    const result = await vm.runInNewContext(`(async () => {
      ${source.slice(start, end)}
      return companiesWithTokens;
    })()`, {
      allCompsResult: { recordset: [row] },
      matchedUser: { Global_User_ID: 90, UserTypeId: 2 },
      password: 'test-password', portalPool: {}, portalDbName: 'TestPortal',
      sql: { Request, NVarChar: () => 'NVarChar', BigInt: 'BigInt' },
      getCompanyConfig: () => ({ name: 'Test company', database: 'TestCompany' }),
      verifyPasswordCombined: () => true,
      getTokenForCompany: (...args) => { lookups.push(args); return null; },
      storeTokenSession: (...args) => sessions.push(args),
      generateToken: () => 'new-token',
    });
    assert.deepEqual(lookups[0], [80, 3]);
    assert.equal(sessions[0][1], 80);
    assert.equal(sessions[0][2], 8);
    assert.equal(sessions[0][3], 3);
    assert.equal(sessions[0][6].UserTypeId, userTypeId);
    assert.equal(sessions[0][6], row);
    assert.equal(result[0].UserTypeId, userTypeId);
  });
}
