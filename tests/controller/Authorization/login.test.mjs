import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';
import LoginController, { verifyPasswordCombined } from '../../../controller/Authorization/login.mjs';

import { companyConfigs } from '../../../middleware/otherDB.mjs';

function createMockReqRes({ body = {}, headers = {} } = {}) {
    const req = {
        body,
        headers,
        header(name) { return this.headers[name.toLowerCase()] ?? this.headers[name] ?? null; },
        get(name) { return this.header(name); }
    };
    const res = {
        statusCode: null,
        jsonData: null,
        locals: {},
        req,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.jsonData = data; return this; }
    };
    return { req, res };
}

describe('controller/Authorization/login.mjs', () => {
    it('accepts raw HTTPS passwords for legacy plaintext credentials without decrypting the request', () => {
        assert.equal(verifyPasswordCombined('correct-password', 'correct-password'), true);
        assert.equal(verifyPasswordCombined('wrong-password', 'correct-password'), false);
        assert.equal(verifyPasswordCombined('correct-password', ''), false);
    });

    it('rejects missing, malformed and non-string credentials', () => {
        for (const value of ['', null, undefined, 123, {}, []]) {
            assert.equal(verifyPasswordCombined(value, 'correct-password'), false);
            assert.equal(verifyPasswordCombined('correct-password', value), false);
        }
        assert.equal(verifyPasswordCombined('wrong-password', 'not-valid-ciphertext'), false);
    });

    it('supports CryptoJS credentials and rejects incorrect passwords', () => {
        const previousKey = process.env.passwordKey;
        process.env.passwordKey = 'mock-login-test-key';
        try {
            const encrypted = CryptoJS.AES.encrypt('correct-password', process.env.passwordKey).toString();
            const encryptedAgain = CryptoJS.AES.encrypt('correct-password', process.env.passwordKey).toString();
            const wrong = CryptoJS.AES.encrypt('wrong-password', process.env.passwordKey).toString();
            assert.equal(verifyPasswordCombined('correct-password', encrypted), true);
            assert.equal(verifyPasswordCombined(encrypted, 'correct-password'), true);
            assert.equal(verifyPasswordCombined(encryptedAgain, encrypted), true);
            assert.equal(verifyPasswordCombined('wrong-password', encrypted), false);
            assert.equal(verifyPasswordCombined(wrong, encrypted), false);
        } finally {
            if (previousKey === undefined) delete process.env.passwordKey;
            else process.env.passwordKey = previousKey;
        }
    });

    it('supports existing legacy CBC credentials', () => {
        // The controller captures the configured legacy key when imported.
        if (!process.env.passwordKey) return;
        const cipher = crypto.createCipheriv(
            'aes-256-cbc', Buffer.from(process.env.passwordKey.padEnd(32, '0')), Buffer.alloc(16, 0)
        );
        const encrypted = cipher.update('correct-password', 'utf8', 'hex') + cipher.final('hex');
        assert.equal(verifyPasswordCombined('correct-password', encrypted), true);
        assert.equal(verifyPasswordCombined('wrong-password', encrypted), false);
    });

    it('login should reject missing username/password with HTTP 400', async () => {
        const { req, res } = createMockReqRes({ body: {} });
        await LoginController.login(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.jsonData.success, false);
    });

    it('login should reject unconfigured companyId with HTTP 401', async () => {
        const { req, res } = createMockReqRes({
            body: { username: 'test', password: 'pwd', companyId: 99999 }
        });
        const previous = new Map(companyConfigs);
        companyConfigs.clear();
        companyConfigs.set(1, { id: 1, name: 'Test company' });
        try {
            await LoginController.login(req, res);
        } finally {
            companyConfigs.clear();
            for (const [key, value] of previous) companyConfigs.set(key, value);
        }

        assert.equal(res.statusCode, 401);
        assert.equal(res.jsonData.message, 'Please select correct company');
    });

    it('globalLogin should reject missing credentials with HTTP 400', async () => {
        const { req, res } = createMockReqRes({ body: {} });
        await LoginController.globalLogin(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.jsonData.success, false);
    });
});
