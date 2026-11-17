import sql from 'mssql';
import crypto from 'node:crypto';
import CryptoJS from 'crypto-js';
import { servError, dataFound, failed, invalidInput, noData } from '../../res.mjs';
import { decryptPasswordFun, LocalDateTime } from '../../helper_functions.mjs';
import dotenv from 'dotenv';
import { getPool } from '../../config/dbconfig.mjs';
import {
    storeTokenSession,
    verifyTokenSession,
    getTokenForCompany,
    removeTokenSession,
    getCompanyConfig,
    getCompanyPool,
    getAllCompanyIds,
    isCompanyConfigured,
    getAllCompanyConfigs,
} from '../../middleware/otherDB.mjs';

dotenv.config();

const userPortalDB = process.env.USERPORTALDB || process.env.DATABASE;
const passwordKey = process.env.passwordKey;
const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = () => {
    const ts = Date.now().toString(36);
    const random = crypto.randomBytes(20).toString('hex');
    return `${ts}${random}`.substring(0, 48);
};

// AES Decryption Helper for encrypted payloads (matching Task Management)
const tryDecryptText = (val) => {
    if (!val || typeof val !== 'string') return val;
    const keys = [process.env.passwordKey, process.env.JWT_SECRET].filter(Boolean);
    for (const key of keys) {
        try {
            const bytes = CryptoJS.AES.decrypt(val, key);
            const dec = bytes.toString(CryptoJS.enc.Utf8);
            if (dec && dec.length > 0) return dec;
        } catch { }
    }
    return val;
};

// Legacy CBC decipher helper (matching Task Management password.utils.ts)
const verifyLegacyPassword = (plainPassword, storedPassword) => {
    try {
        if (plainPassword === storedPassword) return true;
        try {
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                Buffer.from(passwordKey.padEnd(32, '0')),
                Buffer.alloc(16, 0)
            );
            let decrypted = decipher.update(storedPassword, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return plainPassword === decrypted;
        } catch {
            return false;
        }
    } catch {
        return false;
    }
};

// Combined password verification (direct, AES CryptoJS, legacy decipher)
export const verifyPasswordCombined = (inputPwd, storedPwd) => {
    if (typeof inputPwd !== 'string' || !inputPwd || typeof storedPwd !== 'string' || !storedPwd) return false;
    if (inputPwd === storedPwd) return true;
    try {
        const decStored = decryptPasswordFun(storedPwd);
        if (decStored && inputPwd === decStored) return true;
        const decInput = decryptPasswordFun(inputPwd);
        if (decInput && (decInput === storedPwd || (decStored && decInput === decStored))) return true;
    } catch { }
    if (verifyLegacyPassword(inputPwd, storedPwd)) return true;
    return false;
};

const LoginController = () => {

    const getAccountsInUserPortal = async (req, res) => {
        const { username } = req.query;

        if (!username) {
            return invalidInput(res, 'username is required');
        }

        try {
            const activePortalPool = await getPool();
            const result = await new sql.Request(activePortalPool)
                .input('username', sql.NVarChar(100), String(username).trim())
                .query(`
                    SELECT Company_Id AS Local_Id, Global_User_ID
                    FROM [${userPortalDB}].[dbo].[tbl_Users]
                    WHERE LOWER(UserName) = LOWER(@username)
                      AND ISNULL(UDel_Flag, 0) = 0
                `);

            const apiBase = `${req.protocol}://${req.get('host')}/api/`;
            const configuredCompanies = new Map(
                getAllCompanyConfigs().map((c) => [
                    c.id,
                    {
                        Company_Name: c.name,
                        Local_Id: c.id,
                        Global_Id: c.id,
                        Web_Api: apiBase,
                    }
                ])
            );

            const accounts = [
                ...new Map(
                    result.recordset
                        .filter((user) => configuredCompanies.has(Number(user.Local_Id)))
                        .map((user) => {
                            const company = configuredCompanies.get(Number(user.Local_Id));
                            return [
                                company.Local_Id,
                                {
                                    ...company,
                                    Global_User_ID: String(user.Global_User_ID),
                                },
                            ];
                        })
                ).values()
            ];

            if (accounts.length > 0) {
                dataFound(res, accounts);
            } else {
                noData(res);
            }
        } catch (e) {
            servError(e, res);
        }
    };

    const globalLogin = async (req, res) => {
        return invalidInput(res, 'Select a company and use the company login endpoint');
    };

    const login = async (req, res) => {
        let body = req.body || {};

        // Support encrypted payload envelope: { payload: "..." } or { data: "..." }
        if (!body.username && !body.password && (body.payload || body.data || typeof body === 'string')) {
            const rawCipher = body.payload || body.data || body;
            const decryptedRaw = tryDecryptText(rawCipher);
            if (decryptedRaw && typeof decryptedRaw === 'string') {
                try {
                    body = JSON.parse(decryptedRaw);
                } catch { }
            }
        }

        let username = body.username ?? body.UserName ?? body.user;
        let password = body.password ?? body.Password;

        // Decrypt username and password if sent encrypted
        username = tryDecryptText(username);
        password = tryDecryptText(password);

        const rawCompanyId = body.companyId || body.Company_Id || body.company_id || body.CompanyId || req.get('Db');
        const parsedCompanyId = rawCompanyId && !isNaN(parseInt(String(rawCompanyId), 10))
            ? parseInt(String(rawCompanyId), 10)
            : undefined;

        console.log(`\n🔑 [LOGIN ATTEMPT] Username: "${username}" | Company ID: ${parsedCompanyId ?? '(multi-company mode)'}`);

        if (!username || !password) {
            console.warn(`❌ [LOGIN VALIDATION FAILED] Missing username or password`);
            return res.status(400).json({
                status: 'error',
                success: false,
                message: 'Username and password are required',
                data: null,
                others: {},
            });
        }

        const configuredCompanyIds = getAllCompanyIds();
        if (configuredCompanyIds.length === 0) {
            return res.status(401).json({
                status: 'error',
                success: false,
                message: 'No company configurations loaded',
                data: null,
                others: {},
            });
        }

        // If a specific company was requested, verify it is present in companies.json
        if (parsedCompanyId !== undefined && !isCompanyConfigured(parsedCompanyId)) {
            return res.status(401).json({
                status: 'error',
                success: false,
                message: 'Please select correct company',
                data: null,
                others: {},
            });
        }

        try {
            const portalPool = await getPool();
            const portalDbName = userPortalDB;

            // Step 1: Validate credentials against tbl_Users in User_Portal for configured companies
            const userReq = new sql.Request(portalPool);
            userReq.input('UserName', sql.NVarChar(100), String(username).trim());

            let compFilter = '';
            if (parsedCompanyId && parsedCompanyId > 0) {
                userReq.input('compFilterId', sql.BigInt, parsedCompanyId);
                compFilter = 'AND u.Company_Id = @compFilterId';
            } else {
                compFilter = `AND u.Company_Id IN (${configuredCompanyIds.join(',')})`;
            }

            const isNumeric = /^\d+$/.test(String(username).trim());
            let userMatchClause = 'LOWER(u.UserName) = LOWER(@UserName)';
            if (isNumeric) {
                userReq.input('numUsername', sql.NVarChar(100), String(username).trim());
                userMatchClause = '(LOWER(u.UserName) = LOWER(@UserName) OR u.Global_User_ID = @numUsername)';
            }

            const userResult = await userReq.query(`
                SELECT
                    u.Global_User_ID, u.Local_User_ID, u.Company_Id, u.UserName, u.Name, u.Password, u.UserTypeId, u.Autheticate_Id,
                    c.Local_Comp_Id, c.Company_Name, c.DB_Name
                FROM [${portalDbName}].[dbo].[tbl_Users] u
                LEFT JOIN [${portalDbName}].[dbo].[tbl_Company] c ON CAST(u.Company_Id AS VARCHAR) = CAST(c.Local_Comp_Id AS VARCHAR)
                WHERE ${userMatchClause} AND ISNULL(u.UDel_Flag, 0) = 0 ${compFilter}
            `);

            let allUserRows = userResult.recordset;
            let matchedUser = allUserRows.find(u => verifyPasswordCombined(password, u.Password));

            // Fallback: If not found in portal DB or password didn't match, check company DB if connected
            if (!matchedUser && req.db) {
                try {
                    const directReq = new sql.Request(req.db);
                    directReq.input('UserName', sql.NVarChar(100), String(username).trim());
                    const directResult = await directReq.query(`
                        SELECT u.UserTypeId, u.UserId, u.UserName, u.Global_User_ID, u.BranchId, b.BranchName, u.Name, ut.UserType, u.Autheticate_Id, u.Company_id, c.Company_Name, u.Password
                        FROM tbl_Users AS u
                        LEFT JOIN tbl_Branch_Master AS b ON b.BranchId = u.BranchId
                        LEFT JOIN tbl_User_Type AS ut ON ut.Id = u.UserTypeId
                        LEFT JOIN tbl_Company_Master AS c ON c.Company_id = u.Company_Id
                        WHERE LOWER(UserName) = LOWER(@UserName) AND UDel_Flag = 0
                    `);
                    const matchedDirectUser = directResult.recordset.find((row) =>
                        verifyPasswordCombined(password, row.Password)
                    );
                    if (matchedDirectUser) {
                        const { Password: _storedPassword, ...uInfo } = matchedDirectUser;
                        const ssid = `${Math.floor(100000 + Math.random() * 900000)}${LocalDateTime().trim()}`;
                        return res.status(200).json({
                            status: 'success',
                            success: true,
                            message: 'Login successfully',
                            data: {
                                user: {
                                    Global_User_ID: uInfo.Global_User_ID || String(uInfo.UserId),
                                    Local_User_ID: uInfo.UserId,
                                    Name: uInfo.Name,
                                    UserName: uInfo.UserName,
                                    UserTypeId: uInfo.UserTypeId,
                                },
                                currentCompany: [{
                                    companyId: Number(uInfo.Company_id || parsedCompanyId || 1),
                                    companyName: uInfo.Company_Name || 'Default Company',
                                    dbName: req.currentDBName || '',
                                    dbConnected: true,
                                    token: uInfo.Autheticate_Id || generateToken(),
                                    UserTypeId: uInfo.UserTypeId,
                                }],
                                serverTime: new Date().toISOString(),
                            },
                            user: uInfo,
                            sessionInfo: { InTime: new Date(), SessionId: ssid, UserId: uInfo.UserId },
                            others: {},
                        });
                    }
                } catch (dErr) {
                    console.warn('Direct fallback lookup failed:', dErr.message);
                }
            }

            if (!matchedUser) {
                console.warn(`❌ [LOGIN FAILED] Invalid credentials for User "${username}"`);
                const errMessage = parsedCompanyId ? 'Please select correct company' : 'Invalid username or password';
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: errMessage,
                    data: null,
                    others: {},
                });
            }

            // Step 2: Fetch ALL company rows for this user from configured companies
            const allReq = new sql.Request(portalPool);
            allReq.input('UserName', sql.NVarChar(100), matchedUser.UserName);
            const allCompsResult = await allReq.query(`
                SELECT
                    u.Global_User_ID, u.Local_User_ID, u.Company_Id, u.UserName, u.Name, u.Password, u.UserTypeId, u.Autheticate_Id,
                    c.Local_Comp_Id, c.Company_Name, c.DB_Name
                FROM [${portalDbName}].[dbo].[tbl_Users] u
                LEFT JOIN [${portalDbName}].[dbo].[tbl_Company] c ON CAST(u.Company_Id AS VARCHAR) = CAST(c.Local_Comp_Id AS VARCHAR)
                WHERE LOWER(u.UserName) = LOWER(@UserName) AND ISNULL(u.UDel_Flag, 0) = 0
                  AND u.Company_Id IN (${configuredCompanyIds.join(',')})
            `);

            // Step 3: Generate / reuse one token per configured company
            const companiesWithTokens = [];

            for (const row of allCompsResult.recordset) {
                const rowCompanyId = Number(row.Company_Id);
                const rowLocalUserId = row.Local_User_ID ? Number(row.Local_User_ID) : null;
                const envConfig = getCompanyConfig(rowCompanyId);

                // Strictly require company to be configured in companies.json
                if (!rowCompanyId || !envConfig) continue;

                const rowCompanyName = envConfig.name;
                const rowDbName = envConfig.database;

                // Verify password matches for this company row
                const isRowPasswordValid = verifyPasswordCombined(password, row.Password);
                if (!isRowPasswordValid) continue;

                let companyToken = getTokenForCompany(row.Global_User_ID, rowCompanyId)
                    || row.Autheticate_Id
                    || generateToken();

                storeTokenSession(
                    companyToken,
                    row.Global_User_ID,
                    rowLocalUserId,
                    rowCompanyId,
                    rowDbName,
                    rowCompanyName,
                    row
                );

                // Update tbl_Users Autheticate_Id
                try {
                    await new sql.Request(portalPool)
                        .input('token', sql.NVarChar(255), companyToken)
                        .input('globalUserId', sql.NVarChar(100), String(row.Global_User_ID))
                        .input('companyId', sql.BigInt, rowCompanyId)
                        .query(`
                            UPDATE [${portalDbName}].[dbo].[tbl_Users]
                            SET Autheticate_Id = @token
                            WHERE Global_User_ID = @globalUserId AND Company_Id = @companyId
                        `);
                } catch (_) { }

                companiesWithTokens.push({
                    companyId: rowCompanyId,
                    companyName: rowCompanyName,
                    dbName: rowDbName,
                    token: companyToken,
                    Local_User_ID: rowLocalUserId,
                    Global_User_ID: row.Global_User_ID,
                    dbConnected: true,
                    UserTypeId: row.UserTypeId,
                });
            }

            // Step 4: Ensure at least one configured company is available
            if (companiesWithTokens.length === 0) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: parsedCompanyId ? 'Please select correct company' : 'Invalid username or password',
                    data: null,
                    others: {},
                });
            }

            let activeCompany = null;
            if (parsedCompanyId) {
                activeCompany = companiesWithTokens.find(c => c.companyId === parsedCompanyId);
            }
            if (!activeCompany && companiesWithTokens.length > 0) {
                activeCompany = companiesWithTokens[0];
            }

            if (activeCompany) {
                const currentIndex = companiesWithTokens.indexOf(activeCompany);
                if (currentIndex > 0) {
                    companiesWithTokens.splice(currentIndex, 1);
                    companiesWithTokens.unshift(activeCompany);
                }
            }

            const ssid = `${Math.floor(100000 + Math.random() * 900000)}${LocalDateTime().trim()}`;

            // Pre-connect company database pool
            if (activeCompany) {
                try {
                    const activePool = await getCompanyPool(activeCompany.companyId);
                    try {
                        const sessionSP = new sql.Request(activePool)
                            .input('Id', 0)
                            .input('UserId', activeCompany.Local_User_ID || matchedUser.Local_User_ID || 1)
                            .input('SessionId', ssid)
                            .input('LogStatus', 1)
                            .input('APP_Type', 1)
                            .execute('UserLogSP');
                        await sessionSP;
                    } catch (_) { }
                } catch (cErr) {
                    console.warn(`[login] Could not pre-connect to ${activeCompany.companyName}:`, cErr.message);
                }
            }

            const companyList = companiesWithTokens.map(c => ({
                companyId: c.companyId,
                companyName: c.companyName,
                dbName: c.dbName,
                dbConnected: c.dbConnected,
                token: c.token,
                UserTypeId: c.UserTypeId,
                Local_User_ID: c.Local_User_ID,
                Global_User_ID: c.Global_User_ID,
            }));

            const encryptedCompany = CryptoJS.AES.encrypt(
                JSON.stringify(companyList),
                JWT_SECRET
            ).toString();

            const legacyUserInfo = {
                UserTypeId: activeCompany?.UserTypeId ?? matchedUser.UserTypeId,
                UserId: activeCompany?.Local_User_ID || matchedUser.Local_User_ID || matchedUser.Global_User_ID,
                UserName: matchedUser.UserName,
                Global_User_ID: matchedUser.Global_User_ID,
                BranchId: 1,
                BranchName: 'Main Branch',
                Name: matchedUser.Name,
                UserType: (activeCompany?.UserTypeId === 0 || matchedUser.UserTypeId === 0) ? 'Admin' : 'User',
                Autheticate_Id: activeCompany?.token || matchedUser.Autheticate_Id,
                Company_id: activeCompany?.companyId || matchedUser.Company_Id,
                Company_Name: activeCompany?.companyName || 'Default Company',
            };

            console.log(`✅ [LOGIN SUCCESS] User: "${matchedUser.Name}" (${matchedUser.UserName}) | Available Companies: ${companiesWithTokens.length} | Active: "${activeCompany?.companyName}" (ID: ${activeCompany?.companyId}) | Token: ${activeCompany?.token?.slice(0, 12)}...`);

            return res.status(200).json({
                status: 'success',
                success: true,
                message: 'Login successful',
                data: {
                    user: {
                        Global_User_ID: activeCompany?.Global_User_ID ?? matchedUser.Global_User_ID,
                        Local_User_ID: activeCompany?.Local_User_ID ?? matchedUser.Local_User_ID,
                        Name: matchedUser.Name,
                        UserName: matchedUser.UserName,
                        UserTypeId: activeCompany?.UserTypeId ?? matchedUser.UserTypeId,
                    },
                    currentCompany: encryptedCompany,
                    availableCompanies: companyList,
                    token: activeCompany?.token,
                    serverTime: new Date().toISOString(),
                },
                user: legacyUserInfo,
                sessionInfo: {
                    InTime: new Date(),
                    SessionId: ssid,
                    UserId: legacyUserInfo.UserId,
                },
                others: {},
            });

        } catch (e) {
            console.error(`💥 [LOGIN ERROR] Exception during login for "${username}":`, e.message);
            return servError(e, res);
        }
    };

    const switchCompany = async (req, res) => {
        try {
            const { targetCompanyId, companyId } = req.body;
            const requestedCompanyId = targetCompanyId || companyId;
            const authHeader = req.get('Authorization') || req.headers?.authorization;
            const currentToken = req.authenticateId || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim());

            if (!currentToken) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: 'Authentication required',
                    data: null,
                    others: {},
                });
            }

            if (!requestedCompanyId) {
                return res.status(400).json({
                    status: 'error',
                    success: false,
                    message: 'targetCompanyId is required',
                    data: null,
                    others: {},
                });
            }

            const targetCompIdNum = parseInt(String(requestedCompanyId), 10);
            if (!Number.isSafeInteger(targetCompIdNum) || targetCompIdNum <= 0) {
                return res.status(400).json({
                    status: 'error',
                    success: false,
                    message: 'Invalid targetCompanyId',
                    data: null,
                    others: {},
                });
            }

            const companyConfig = getCompanyConfig(targetCompIdNum);
            if (!companyConfig) {
                return res.status(404).json({
                    status: 'error',
                    success: false,
                    message: 'Company configuration not found',
                    data: null,
                    others: {},
                });
            }

            const portalPool = await getPool();
            const portalDbName = userPortalDB;

            let currentSession = verifyTokenSession(currentToken);
            let globalUserId = currentSession?.userId;
            let currentUserName = currentSession?.userName;

            if (!currentUserName || !globalUserId) {
                const userLookup = await new sql.Request(portalPool)
                    .input('token', sql.NVarChar(255), currentToken)
                    .query(`
                        SELECT TOP 1 Global_User_ID, UserName, Company_Id, Local_User_ID
                        FROM [${portalDbName}].[dbo].[tbl_Users]
                        WHERE Autheticate_Id = @token AND ISNULL(UDel_Flag, 0) = 0
                    `);
                if (userLookup.recordset.length > 0) {
                    globalUserId = userLookup.recordset[0].Global_User_ID;
                    currentUserName = userLookup.recordset[0].UserName;
                }
            }

            if (!globalUserId && !currentUserName) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: 'Invalid session',
                    data: null,
                    others: {},
                });
            }

            // Verify user access in target company by UserName or Global_User_ID
            const userAccessReq = new sql.Request(portalPool);
            userAccessReq.input('userName', sql.NVarChar(100), String(currentUserName || ''));
            userAccessReq.input('globalUserId', sql.NVarChar(100), String(globalUserId || ''));
            userAccessReq.input('companyId', sql.BigInt, targetCompIdNum);
            const userAccessRes = await userAccessReq.query(`
                SELECT TOP 1 Global_User_ID, Local_User_ID, UserName, Name, UserTypeId, Autheticate_Id
                FROM [${portalDbName}].[dbo].[tbl_Users]
                WHERE (LOWER(UserName) = LOWER(@userName) OR Global_User_ID = @globalUserId)
                  AND Company_Id = @companyId
                  AND ISNULL(UDel_Flag, 0) = 0
            `);

            if (!userAccessRes.recordset.length) {
                return res.status(403).json({
                    status: 'error',
                    success: false,
                    message: 'You do not have access to this company',
                    data: null,
                    others: {},
                });
            }

            const userAccess = userAccessRes.recordset[0];
            const compName = companyConfig.name;
            const compDbName = companyConfig.database;

            // Reuse the token already stored for this user+company if available
            let companyToken = getTokenForCompany(userAccess.Global_User_ID, targetCompIdNum) || userAccess.Autheticate_Id;
            if (!companyToken) {
                companyToken = generateToken();
            }

            storeTokenSession(
                companyToken,
                userAccess.Global_User_ID,
                userAccess.Local_User_ID,
                targetCompIdNum,
                compDbName,
                compName,
                userAccess
            );

            try {
                await new sql.Request(portalPool)
                    .input('token', sql.NVarChar(255), companyToken)
                    .input('globalUserId', sql.NVarChar(100), String(userAccess.Global_User_ID))
                    .input('companyId', sql.BigInt, targetCompIdNum)
                    .query(`
                        UPDATE [${portalDbName}].[dbo].[tbl_Users]
                        SET Autheticate_Id = @token
                        WHERE Global_User_ID = @globalUserId AND Company_Id = @companyId
                    `);
            } catch (uErr) {
                console.warn('Could not update Autheticate_Id in tbl_Users:', uErr.message);
            }

            let dbConnected = false;
            try {
                const pool = await getCompanyPool(targetCompIdNum);
                if (pool) dbConnected = true;
            } catch (cErr) {
                console.warn(`Could not pre-connect to ${compName}:`, cErr.message);
            }

            console.log(`🏢 [SWITCH COMPANY SUCCESS] User: "${userAccess.UserName}" | Company: "${compName}" (ID: ${targetCompIdNum}, DB: ${compDbName})`);

            return res.status(200).json({
                status: 'success',
                success: true,
                message: 'Company switched successfully',
                data: {
                    token: companyToken,
                    user: {
                        Global_User_ID: userAccess.Global_User_ID,
                        Local_User_ID: userAccess.Local_User_ID ? Number(userAccess.Local_User_ID) : null,
                        UserName: userAccess.UserName,
                        Name: userAccess.Name,
                        UserTypeId: userAccess.UserTypeId,
                    },
                    company: {
                        companyId: targetCompIdNum,
                        companyName: compName,
                        dbName: compDbName,
                        dbConnected,
                    },
                    serverTime: new Date().toISOString(),
                },
                others: {},
            });

        } catch (err) {
            console.error('switchCompany error:', err);
            return res.status(500).json({
                status: 'error',
                success: false,
                message: 'Internal server error',
                data: null,
                others: {},
            });
        }
    };

    const logout = async (req, res) => {
        try {
            const authHeader = req.get('Authorization') || req.headers?.authorization;
            const token = req.authenticateId || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim());

            if (!token) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: 'Authentication required',
                    data: null,
                    others: {},
                });
            }

            removeTokenSession(token);

            try {
                const portalPool = await getPool();
                const portalDbName = userPortalDB;
                await new sql.Request(portalPool)
                    .input('token', sql.NVarChar(255), token)
                    .query(`UPDATE [${portalDbName}].[dbo].[tbl_Users] SET Autheticate_Id = NULL WHERE Autheticate_Id = @token`);
            } catch (_) { }

            return res.status(200).json({
                status: 'success',
                success: true,
                message: 'Logout successful',
                data: null,
                others: {},
            });
        } catch (err) {
            console.error('Logout error:', err);
            return servError(err, res);
        }
    };

    const verifyToken = async (req, res) => {
        try {
            const authHeader = req.get('Authorization') || req.headers?.authorization;
            const token = req.authenticateId || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim());

            if (!token) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: 'No token provided',
                    data: null,
                    others: {},
                });
            }

            const session = verifyTokenSession(token);
            const portalPool = await getPool();
            const portalDbName = userPortalDB;

            let userRows = await new sql.Request(portalPool)
                .input('token', sql.NVarChar(255), token)
                .query(`
                    SELECT
                        u.Global_User_ID, u.Local_User_ID, u.UserName, u.Name, u.UserTypeId, u.Company_Id, u.Autheticate_Id,
                        c.Local_Comp_Id, c.Company_Name, c.DB_Name
                    FROM [${portalDbName}].[dbo].[tbl_Users] u
                    LEFT JOIN [${portalDbName}].[dbo].[tbl_Company] c ON CAST(u.Company_Id AS VARCHAR) = CAST(c.Local_Comp_Id AS VARCHAR)
                    WHERE u.Autheticate_Id = @token AND ISNULL(u.UDel_Flag, 0) = 0
                `);

            if (userRows.recordset.length === 0) {
                return res.status(401).json({
                    status: 'error',
                    success: false,
                    message: 'Invalid or expired token',
                    data: null,
                    others: {},
                });
            }

            const user = userRows.recordset[0];

            const allComps = await new sql.Request(portalPool)
                .input('username', sql.NVarChar(100), user.UserName)
                .query(`
                    SELECT
                        u.Global_User_ID, u.Local_User_ID, u.Company_Id, u.Autheticate_Id, u.UserTypeId,
                        c.Local_Comp_Id, c.Company_Name, c.DB_Name
                    FROM [${portalDbName}].[dbo].[tbl_Users] u
                    LEFT JOIN [${portalDbName}].[dbo].[tbl_Company] c ON CAST(u.Company_Id AS VARCHAR) = CAST(c.Local_Comp_Id AS VARCHAR)
                    WHERE LOWER(u.UserName) = LOWER(@username) AND ISNULL(u.UDel_Flag, 0) = 0
                `);

            const currentCompany = allComps.recordset.map((row) => {
                const cId = Number(row.Company_Id);
                const envCfg = getCompanyConfig(cId);
                return {
                    companyId: cId,
                    companyName: row.Company_Name || envCfg?.name || '',
                    dbName: row.DB_Name || envCfg?.database || '',
                    token: row.Autheticate_Id || '',
                    dbConnected: true,
                    UserTypeId: row.UserTypeId,
                };
            }).filter(c => c.companyId);

            return res.status(200).json({
                status: 'success',
                success: true,
                message: 'Token is valid',
                data: {
                    user: {
                        Global_User_ID: user.Global_User_ID,
                        Local_User_ID: session?.localUserId ?? (user.Local_User_ID ? Number(user.Local_User_ID) : null),
                        Name: user.Name,
                        UserName: user.UserName,
                        UserTypeId: user.UserTypeId,
                    },
                    currentCompany,
                    serverTime: new Date().toISOString(),
                },
                others: {},
            });

        } catch (err) {
            console.error('Verify token error:', err);
            return servError(err, res);
        }
    };

    const getUserByAuth = async (req, res) => {
        const Auth = req.header('Authorization');
        const Db = req.get('Db');

        if (!Auth) return invalidInput(res, 'Authorization is required');
        if (!Db || !req.db || String(req.dbID) !== String(Db)) {
            return invalidInput(res, 'A selected company database is required');
        }

        try {
            const query = `
            SELECT
                u.UserTypeId,
                u.UserId,
                u.UserName,
                u.Global_User_ID,
                u.BranchId,
                b.BranchName,
                u.Name,
                ut.UserType,
                u.Autheticate_Id,
                u.Company_Id AS Company_id,
                c.Company_Name,

                (
                    SELECT 
                        TOP (1)
                        UserId,
                        SessionId,
                        InTime
                    FROM
                        tbl_User_Log
                    WHERE
                        UserId = u.UserId
                    ORDER BY
                        InTime DESC
                        FOR JSON PATH
                )  AS session

            FROM tbl_Users AS u

            LEFT JOIN tbl_Branch_Master AS b
            ON b.BranchId = u.BranchId

            LEFT JOIN tbl_User_Type AS ut
            ON ut.Id = u.UserTypeId

            LEFT JOIN tbl_Company_Master AS c
            ON c.Company_id = u.Company_Id

            WHERE u.Autheticate_Id = @auth AND UDel_Flag= 0`;

            const request = new sql.Request(req.db);
            request.input('auth', sql.NVarChar(255), Auth);

            const result = await request.query(query);

            if (result.recordset.length > 0) {
                result.recordset[0].session = result.recordset[0].session ? JSON.parse(result.recordset[0].session) : [{
                    UserId: result.recordset[0].UserId, SessionId: new Date(), InTime: new Date()
                }]
                return dataFound(res, result.recordset);
            } else {
                return failed(res, 'User Not Found');
            }
        } catch (e) {
            return servError(e, res);
        }
    }

    const mobileApplogin = async (req, res) => {
        const Auth = req.header('Authorization')

        try {
            const query = `
             SELECT
               u.UserTypeId,
               u.UserId,
               u.UserName,
               u.BranchId,
               b.BranchName,
               u.Name,
               ut.UserType,
               u.Autheticate_Id,
               u.Company_Id AS Company_id,
               c.Company_Name,
               cc.Cost_Center_Id,
               (
                   SELECT 
                       TOP (1)
                       UserId,
                       SessionId,
                       InTime
                   FROM
                       tbl_User_Log
                   WHERE
                       UserId = u.UserId
                   ORDER BY
                       InTime DESC
                   FOR JSON PATH
               ) AS session
           FROM tbl_Users AS u
           LEFT JOIN tbl_Branch_Master AS b
               ON b.BranchId = u.BranchId
           LEFT JOIN tbl_User_Type AS ut
               ON ut.Id = u.UserTypeId
           LEFT JOIN tbl_Company_Master AS c
               ON c.Company_id = u.Company_Id
           LEFT JOIN tbl_ERP_Cost_Center AS cc
               ON cc.User_Id = u.UserId
            WHERE u.Autheticate_Id = @auth AND UDel_Flag= 0`;

            const request = new sql.Request();
            request.input('auth', Auth);

            const result = await request.query(query);

            if (result.recordset.length > 0) {
                const userInfo = result.recordset[0];

                const ssid = `${Math.floor(100000 + Math.random() * 900000)}${new Date().toISOString().trim()}`;

                try {
                    const sessionSP = new sql.Request()
                        .input('Id', 0)
                        .input('UserId', userInfo.UserId)
                        .input('SessionId', ssid)
                        .input('LogStatus', 1)
                        .input('APP_Type', 2)
                        .execute('UserLogSP');

                    await sessionSP;
                } catch (err) {
                    console.error('Error while creating login session:', err);
                }

                return res.status(200).json({
                    user: userInfo,
                    sessionInfo: {
                        InTime: new Date(),
                        SessionId: ssid,
                        UserId: userInfo.UserId
                    },
                    success: true,
                    message: 'Login successfully',
                });
            } else {
                return failed(res, 'Invalid username or password');
            }

        } catch (e) {
            console.error('Error:', e);
            servError(e, res);
        }
    };


    const getUserTypeAuth = async (req, res) => {
        try {
            const { username } = req.body;

            if (!username || !username.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Username is required"
                });
            }


            const userQuery = `
            SELECT 
              *
            FROM tbl_Users 
            WHERE UserName = @username 
                AND UDel_Flag = 0
        `;

            const userRequest = new sql.Request();
            userRequest.input('username', sql.VarChar, username);
            const userResult = await userRequest.query(userQuery);

            if (userResult.recordset.length > 0) {
                const user = userResult.recordset[0];

                return res.status(200).json({

                    step: 2,
                    requirePassword: true,
                    success: true,
                    message: 'User Details Found',
                });



            } else {

                const ledgerQuery = `
                  SELECT *
            FROM tbl_Ledger_LoL lol
            WHERE lol.A1 = @username  `;

                const ledgerRequest = new sql.Request();
                ledgerRequest.input('username', username);
                const ledgerResult = await ledgerRequest.query(ledgerQuery);

                if (ledgerResult.recordset.length > 0) {
                    const customer = ledgerResult.recordset;

                    return res.status(200).json({
                        customer,
                        step: 4,
                        requirePassword: false,
                        success: true,
                        message: 'Ledger Details Found',
                    });

                }




            }

        } catch (error) {
            console.error("Error in getUserTypeAuth:", error);
            return servError(error, res);
        }
    };

    return {
        getAccountsInUserPortal,
        globalLogin,
        login,
        switchCompany,
        logout,
        verifyToken,
        getUserByAuth,
        mobileApplogin,
        getUserTypeAuth
    }
}

export default LoginController()
