import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
import { asyncLocalStorage } from '../config/dbContext.mjs';
import { portalPool, getPool } from '../config/dbconfig.mjs';
import { failed, invalidInput, servError } from '../res.mjs';

dotenv.config();

const USERPORTALDB = process.env.USERPORTALDB || process.env.DATABASE;

// In-memory token session cache (mirrors Task Management session cache)
export const tokenSessions = new Map();
export const userCompanyTokens = new Map();

// Cache to store established connection pools
export const connectionPools = new Map();
const pendingCompanyPools = new Map();

// Company configurations maps (loaded from companies.json)
export const companyConfigs = new Map();
export const companyConfigsByDBName = new Map();
export const dbNameMapping = new Map();

// Parse SQL Server host string (handles server\instance,port, server\instance, server,port)
export function parseHostString(raw) {
    if (!raw) return { server: 'localhost' };
    let s = String(raw).trim().replace(/^["']|["']$/g, '');
    s = s.replace(/\\\\/g, '\\');

    const parts = s.split('\\');
    if (parts.length > 2) {
        s = `${parts[0]}\\${parts[parts.length - 1]}`;
    }

    const instPort = s.match(/^([^\\,]+)\\([^\\,]+),(\d+)$/);
    if (instPort) {
        return { server: instPort[1].trim(), instance: instPort[2].trim(), port: parseInt(instPort[3], 10) };
    }

    const inst = s.match(/^([^\\,]+)\\([^\\,]+)$/);
    if (inst) {
        return { server: inst[1].trim(), instance: inst[2].trim() };
    }

    const port = s.match(/^([^\\,]+),(\d+)$/);
    if (port) {
        return { server: port[1].trim(), port: parseInt(port[2], 10) };
    }

    return { server: s };
}

function getCompaniesFilePath() {
    const candidates = [
        process.env.COMPANIES_FILE,
        path.resolve(process.cwd(), 'companies.json'),
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

export function loadCompanyConfigurations() {
    companyConfigs.clear();
    companyConfigsByDBName.clear();
    dbNameMapping.clear();

    const jsonPath = getCompaniesFilePath();
    let loadedFromJSON = false;

    if (jsonPath) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf8');
            const data = JSON.parse(content);
            const list = Array.isArray(data)
                ? data
                : Array.isArray(data.companies)
                ? data.companies
                : Object.values(data);

            for (const item of list) {
                if (!item || typeof item !== 'object') continue;
                const rawId = item.id ?? item.companyId ?? item.COMPANY_ID;
                const companyId = parseInt(String(rawId), 10);
                const dbName = item.database ?? item.dbName ?? item.DATABASE;
                const dbHost = item.host ?? item.dbHost ?? item.DB_HOST;
                const dbUser = item.user ?? item.dbUser ?? item.DB_USER;
                const dbPassword = item.password ?? item.dbPassword ?? item.DB_PASSWORD;
                const name = item.name ?? item.companyName ?? item.COMPANY_NAME ?? `Company ${companyId}`;

                if (!companyId || !dbName || !dbHost || !dbUser || !dbPassword) {
                    continue;
                }

                const h = parseHostString(dbHost);
                const config = {
                    id: companyId,
                    name,
                    host: h.server,
                    user: dbUser,
                    password: dbPassword,
                    database: dbName,
                    port: h.port,
                    instance: h.instance,
                    rawHost: dbHost,
                };
                companyConfigs.set(companyId, config);
                companyConfigsByDBName.set(dbName, config);
                dbNameMapping.set(dbName, companyId);
            }

            const rawMapping = data.dbNameMapping || data.DB_NAME_MAPPING || data.db_name_mapping;
            if (rawMapping) {
                if (typeof rawMapping === 'string') {
                    for (const pair of rawMapping.split(',')) {
                        const [db, id] = pair.split('=');
                        if (db && id) dbNameMapping.set(db.trim(), parseInt(id.trim(), 10));
                    }
                } else if (typeof rawMapping === 'object' && !Array.isArray(rawMapping)) {
                    for (const [db, id] of Object.entries(rawMapping)) {
                        dbNameMapping.set(db.trim(), parseInt(String(id), 10));
                    }
                }
            }

            if (companyConfigs.size > 0) {
                loadedFromJSON = true;
                console.log(`✅ [COMPANIES LOADED] Loaded ${companyConfigs.size} companies from ${jsonPath}`);
            }
        } catch (err) {
            console.error(`❌ Failed to load company configurations from ${jsonPath}:`, err.message);
        }
    }

    // Fallback: check process.env for COMPANY<N>_ variables
    const companyIndices = new Set();
    for (const key of Object.keys(process.env)) {
        const match = key.match(/^COMPANY(\d+)_/);
        if (match) {
            companyIndices.add(parseInt(match[1], 10));
        }
    }
    if (companyIndices.size > 0) {
        const sortedIndices = Array.from(companyIndices).sort((a, b) => a - b);
        for (const i of sortedIndices) {
            const dbName = process.env[`COMPANY${i}_DATABASE`];
            const dbHost = process.env[`COMPANY${i}_DB_HOST`];
            const dbUser = process.env[`COMPANY${i}_DB_USER`];
            const dbPassword = process.env[`COMPANY${i}_DB_PASSWORD`];
            const rawCompanyId = process.env[`COMPANY${i}_ID`];
            const companyId = parseInt(rawCompanyId ?? `${i}`, 10);
            if (!companyId || !dbName || !dbHost || !dbUser || !dbPassword) continue;
            if (companyConfigs.has(companyId)) continue;

            const h = parseHostString(dbHost);
            const config = {
                id: companyId,
                name: process.env[`COMPANY${i}_NAME`] ?? `Company ${companyId}`,
                host: h.server,
                user: dbUser,
                password: dbPassword,
                database: dbName,
                port: h.port,
                instance: h.instance,
                rawHost: dbHost,
            };
            companyConfigs.set(companyId, config);
            companyConfigsByDBName.set(dbName, config);
            dbNameMapping.set(dbName, companyId);
        }
    }

    // Fallback: parse process.env.DB_NAME_MAPPING if present
    if (process.env.DB_NAME_MAPPING) {
        const pairs = process.env.DB_NAME_MAPPING.split(',');
        for (const pair of pairs) {
            const [db, id] = pair.split('=');
            if (db && id && !dbNameMapping.has(db.trim())) {
                dbNameMapping.set(db.trim(), parseInt(id.trim(), 10));
            }
        }
    }
}

// Initial load of company configurations
loadCompanyConfigurations();

export function getCompanyConfig(companyId) {
    if (!companyId) return null;
    const num = Number(companyId);
    if (!isNaN(num) && companyConfigs.has(num)) {
        return companyConfigs.get(num);
    }
    if (typeof companyId === 'string' && companyConfigsByDBName.has(companyId)) {
        return companyConfigsByDBName.get(companyId);
    }
    if (typeof companyId === 'string' && dbNameMapping.has(companyId)) {
        const id = dbNameMapping.get(companyId);
        if (companyConfigs.has(id)) return companyConfigs.get(id);
    }
    return null;
}

export function getCompanyConfigByDBName(dbName) {
    if (!dbName) return null;
    return companyConfigsByDBName.get(dbName) || null;
}

export function getAllCompanyIds() {
    return Array.from(companyConfigs.keys());
}

export function isCompanyConfigured(companyId) {
    if (!companyId) return false;
    const num = Number(companyId);
    return !isNaN(num) && companyConfigs.has(num);
}

export function getAllCompanyConfigs() {
    return Array.from(companyConfigs.values());
}

export function getDbNameMapping() {
    const obj = {};
    for (const [db, id] of dbNameMapping.entries()) {
        obj[db] = id;
    }
    return obj;
}

// Token Session Storage
export const storeTokenSession = (
  token,
  userId,
  localUserId,
  companyId,
  dbName,
  companyName,
  user = null
) => {
  const cId = Number(companyId);
  const uName = user?.UserName || (typeof user === 'string' ? user : null);
  const userTypeId = user?.UserTypeId !== undefined && user?.UserTypeId !== null ? Number(user.UserTypeId) : null;
  const sessionItem = {
    token,
    userId,
    localUserId: localUserId ? Number(localUserId) : null,
    userName: uName,
    companyId: cId,
    dbName,
    companyName: companyName || `Company ${cId}`,
    createdAt: new Date(),
    user: typeof user === 'object' ? user : null,
    userTypeId,
  };

  tokenSessions.set(token, sessionItem);
  if (!userCompanyTokens.has(userId)) {
    userCompanyTokens.set(userId, new Map());
  }
  userCompanyTokens.get(userId).set(cId, token);
  console.log(`🔑 [SESSION STORED] User: ${userId} (${uName || '-'}), LocalUser: ${localUserId}, Company: ${cId} (${companyName}), DB: ${dbName}`);

  // Background sync to tbl_User_Sessions if table exists in User_Portal
  getPool().then(portalPool => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const req = new sql.Request(portalPool);
    req.input('token', sql.NVarChar(500), token);
    req.input('userId', sql.BigInt, userId);
    req.input('localUserId', sql.BigInt, localUserId || null);
    req.input('companyId', sql.Int, cId);
    req.input('dbName', sql.NVarChar(100), dbName);
    req.input('companyName', sql.NVarChar(200), companyName || '');
    req.input('createdAt', sql.DateTime, sessionItem.createdAt);
    req.input('expiresAt', sql.DateTime, expiresAt);
    req.input('userData', sql.NVarChar(sql.MAX), user ? JSON.stringify(user) : null);
    return req.query(`
      IF OBJECT_ID('tbl_User_Sessions') IS NOT NULL
      BEGIN
        IF EXISTS (SELECT 1 FROM tbl_User_Sessions WHERE Token = @token)
          UPDATE tbl_User_Sessions SET UserId = @userId, LocalUserId = @localUserId, CompanyId = @companyId, DbName = @dbName, CompanyName = @companyName, CreatedAt = @createdAt, ExpiresAt = @expiresAt, UserData = @userData WHERE Token = @token
        ELSE
          INSERT INTO tbl_User_Sessions (Token, UserId, LocalUserId, CompanyId, DbName, CompanyName, CreatedAt, ExpiresAt, UserData)
          VALUES (@token, @userId, @localUserId, @companyId, @dbName, @companyName, @createdAt, @expiresAt, @userData)
      END
    `);
  }).catch(() => {});
};

export const verifyTokenSession = (token) => {
  if (!token) return null;
  const s = tokenSessions.get(token);
  if (!s) return null;
  const hoursSinceCreation = (Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreation > 24) {
    removeTokenSession(token);
    console.log('⏰ [SESSION EXPIRED] Token session expired');
    return null;
  }
  return s;
};

export const getTokenForCompany = (userId, companyId) => {
  return userCompanyTokens.get(userId)?.get(Number(companyId)) || null;
};

export const removeTokenSession = (token) => {
  const s = tokenSessions.get(token);
  if (!s) return;
  const map = userCompanyTokens.get(s.userId);
  if (map) {
    map.delete(s.companyId);
    if (map.size === 0) userCompanyTokens.delete(s.userId);
  }
  tokenSessions.delete(token);
  console.log('🗑️ [SESSION REMOVED] Token session removed');

  getPool().then(portalPool => {
    const req = new sql.Request(portalPool);
    req.input('token', sql.NVarChar(500), token);
    return req.query(`IF OBJECT_ID('tbl_User_Sessions') IS NOT NULL DELETE FROM tbl_User_Sessions WHERE Token = @token`);
  }).catch(() => {});
};

// SQL Pool Manager for Companies
export const getCompanyPool = async (identifier) => {
  let config = null;
  if (typeof identifier === 'number' || !isNaN(Number(identifier))) {
    config = getCompanyConfig(Number(identifier));
  }
  if (!config && typeof identifier === 'string') {
    config = getCompanyConfigByDBName(identifier);
  }
  if (!config && typeof identifier === 'number') {
    for (const [db, id] of dbNameMapping.entries()) {
      if (id === identifier) {
        config = getCompanyConfigByDBName(db);
        if (config) break;
      }
    }
  }

  // Fallback: Check User_Portal tbl_Company if metadata exists there
  if (!config) {
    try {
      const activePortal = await getPool();
      const fetchDbdata = new sql.Request(activePortal);
      fetchDbdata.input('Id', sql.VarChar, String(identifier));
      const result = await fetchDbdata.query(`
        SELECT
          DB_Server_Name AS IP_Address,
          DB_Name AS SQL_DB_Name,
          DB_User_Name AS SQL_User_Name,
          DB_Pass AS SQL_Pass,
          Company_Name
        FROM [${USERPORTALDB}].[dbo].[tbl_Company]
        WHERE Local_Comp_Id = @Id
      `);
      if (result.recordset.length > 0) {
        const dbDetails = result.recordset[0];
        const h = parseHostString(dbDetails.IP_Address);
        config = {
          id: Number(identifier),
          name: dbDetails.Company_Name,
          host: h.server,
          user: dbDetails.SQL_User_Name,
          password: dbDetails.SQL_Pass,
          database: dbDetails.SQL_DB_Name,
          port: h.port,
          instance: h.instance,
        };
      }
    } catch (dbErr) {
      console.warn(`Failed to retrieve company metadata for ${identifier}:`, dbErr.message);
    }
  }

  if (!config) {
    throw new Error(`No configuration found for company: ${identifier}`);
  }

  const cacheKey = `company_${config.id}`;
  let activePool = connectionPools.get(cacheKey);
  if (activePool && activePool.connected) {
    return activePool;
  }

  // Requests arriving together must share connection and table initialization.
  const pending = pendingCompanyPools.get(cacheKey);
  if (pending) return pending;
  const connecting = (async () => {
    const usePort = config.port ?? (config.instance ? undefined : 1433);
    const sqlConfig = {
      server: config.host,
      ...(usePort && { port: usePort }),
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        requestTimeout: 60000,
        connectTimeout: 60000,
        enableArithAbort: true,
        ...(config.instance && !config.port && { instanceName: config.instance }),
      },
      pool: {
        max: 30,
        min: 5,
        idleTimeoutMillis: 60000,
      },
    };

    let pool = new sql.ConnectionPool(sqlConfig);
    try {
      activePool = await pool.connect();
    } catch (poolErr) {
      const currentServer = sqlConfig.server;
      const fallbackServer = process.env.DB_HOST || process.env.SERVER;
      if (fallbackServer && currentServer !== fallbackServer) {
        console.warn(`[companyDb] Connection to primary server ${currentServer} (${config.database}) failed: ${poolErr.message}. Fallback to ${fallbackServer}...`);
        const fallbackConfig = {
          ...sqlConfig,
          server: fallbackServer,
          user: process.env.DB_USER || process.env.USER,
          password: process.env.DB_PASSWORD || process.env.PASSWORD,
        };
        delete fallbackConfig.port;
        if (fallbackConfig.options) {
          delete fallbackConfig.options.instanceName;
        }
        pool = new sql.ConnectionPool(fallbackConfig);
        activePool = await pool.connect();
      } else {
        throw poolErr;
      }
    }



    activePool.close = () => Promise.resolve();
    activePool.on('error', (err) => {
      console.error(`Database pool error for Company ID ${config.id}:`, err);
      connectionPools.delete(cacheKey);
    });

    connectionPools.set(cacheKey, activePool);
    connectionPools.set(String(config.id), activePool);
    connectionPools.set(config.database, activePool);

    return activePool;
  })();
  pendingCompanyPools.set(cacheKey, connecting);
  try {
    return await connecting;
  } finally {
    if (pendingCompanyPools.get(cacheKey) === connecting) pendingCompanyPools.delete(cacheKey);
  }
};

export const getCompanySqlConnection = getCompanyPool;

// Middleware to establish company database context on each incoming request
const setCompanyDatabase = async (req, res, next) => {
  if (req.path && req.path.includes('/userPortal/accounts')) {
    return next();
  }

  // 1. Fast Path: Check Authorization header token
  const authHeader = req.get('Authorization') || req.headers?.authorization;
  const token = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()) : null;

  if (token) {
    const session = verifyTokenSession(token);
    if (session) {
      req.authenticateId = token;
      req.userId = session.userId;
      req.localUserId = session.localUserId;
      req.currentDBName = session.dbName;
      req.currentCompanyId = session.companyId;
      req.authenticatedCompanyId = session.companyId;
      req.userTypeId = session.userTypeId ?? (session.user?.UserTypeId !== undefined && session.user?.UserTypeId !== null ? Number(session.user.UserTypeId) : null);
      req.user = session.user;

      try {
        const activePool = await getCompanyPool(session.companyId);
        req.companyDB = activePool;
        req.db = activePool;
        req.dbID = session.companyId;
        req.config = activePool.config;
        return asyncLocalStorage.run(activePool, () => next());
      } catch (dbErr) {
        console.warn(`[companyDb] Session pool connect error for company ${session.companyId}:`, dbErr.message);
      }
    }

    // Slow path: lookup token in tbl_Users in User_Portal
    try {
      const activePortal = await getPool();
      const userLookup = await new sql.Request(activePortal)
        .input('token', sql.NVarChar(255), token)
        .query(`
          SELECT TOP 1 Global_User_ID, Local_User_ID, UserName, Company_Id, UserTypeId, Autheticate_Id
          FROM [${USERPORTALDB}].[dbo].[tbl_Users]
          WHERE Autheticate_Id = @token AND ISNULL(UDel_Flag, 0) = 0
        `);

      if (userLookup.recordset.length > 0) {
        const u = userLookup.recordset[0];
        const companyId = Number(u.Company_Id);
        const localUserId = u.Local_User_ID ? Number(u.Local_User_ID) : null;
        const userId = u.Global_User_ID;

        const envCfg = getCompanyConfig(companyId);
        let compName = envCfg?.name || `Company ${companyId}`;
        let compDbName = envCfg?.database || null;

        if (!compDbName) {
          const compRes = await new sql.Request(activePortal)
            .input('cId', sql.VarChar, String(companyId))
            .query(`SELECT TOP 1 Company_Name, DB_Name FROM [${USERPORTALDB}].[dbo].[tbl_Company] WHERE Local_Comp_Id = @cId`);
          if (compRes.recordset.length > 0) {
            compName = compRes.recordset[0].Company_Name;
            compDbName = compRes.recordset[0].DB_Name;
          }
        }

        if (compDbName) {
          storeTokenSession(token, userId, localUserId, companyId, compDbName, compName, u);
          req.authenticateId = token;
          req.userId = userId;
          req.localUserId = localUserId;
          req.currentDBName = compDbName;
          req.currentCompanyId = companyId;
          req.authenticatedCompanyId = companyId;
          req.userTypeId = u.UserTypeId !== undefined && u.UserTypeId !== null ? Number(u.UserTypeId) : null;
          req.user = u;

          const activePool = await getCompanyPool(companyId);
          req.companyDB = activePool;
          req.db = activePool;
          req.dbID = companyId;
          req.config = activePool.config;
          return asyncLocalStorage.run(activePool, () => next());
        }
      }
    } catch (lookupErr) {
      console.warn('[companyDb] Slow path token lookup failed:', lookupErr.message);
    }
  }

  // 2. Fallback to Db header / body / query / SELECTED_COMPANY_ID
  let Db = req.get('Db') || req.body?.companyId || req.body?.company_id || req.body?.createdcompany || req.body?.From_CompanyId || req.query?.companyId || req.query?.company_id;

  if (!Db && process.env.SELECTED_COMPANY_ID) {
    Db = process.env.SELECTED_COMPANY_ID;
  }

  if (!Db) {
    return next();
  }

  try {
    const activePool = await getCompanyPool(Db);
    req.db = activePool;
    req.companyDB = activePool;
    req.dbID = Db;
    req.currentCompanyId = Number(Db) || Db;
    req.config = activePool.config;

    return asyncLocalStorage.run(activePool, () => next());
  } catch (e) {
    if (req.path && (req.path.includes('/userAuth') || req.path.includes('/login'))) {
      req.db = null;
      req.companyDB = null;
      req.dbError = e.message;
      return next();
    }
    return servError(e, res, 'Db connection Failed');
  }
};

export const getDbConnection = (req) => {
  return req.companyDB || req.db || portalPool;
};

export const hasCompanyContext = (req) => {
  return !!(req.currentCompanyId && (req.companyDB || req.db));
};

export const getCurrentCompanyInfo = (req) => {
  return {
    companyId: req.currentCompanyId || req.dbID || 0,
    dbName: req.currentDBName || 'default',
    isCompanySelected: hasCompanyContext(req),
  };
};

export const getCurrentLocalUserId = (req) => req.localUserId || null;
export const getCurrentUserId = (req) => req.userId || null;

export const getUserContext = (req) => ({
  globalUserId: req.userId || null,
  localUserId: req.localUserId || null,
  companyId: req.currentCompanyId || req.dbID || 0,
  dbName: req.currentDBName || 'default',
  isAuthenticated: !!(req.userId && req.authenticateId),
  hasCompanyContext: hasCompanyContext(req),
});

export { setCompanyDatabase as dbconnect };
export default setCompanyDatabase;
