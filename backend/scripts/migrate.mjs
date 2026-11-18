import { readdir, readFile } from 'node:fs/promises';
import sql from 'mssql';
import { getCompanyPool, isCompanyConfigured } from '../../middleware/otherDB.mjs';

// Select one intended company explicitly. The portal database is never the target.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--company' || !/^[1-9]\d*$/.test(args[1]) || !isCompanyConfigured(Number(args[1]))) {
    console.error('Usage: node backend/scripts/migrate.mjs --company <configured-company-id>');
    process.exitCode = 1;
} else {
    let pool;
    try {
        pool = await getCompanyPool(Number(args[1]));
        await pool.request().query(`IF OBJECT_ID(N'dbo.SchemaMigrations',N'U') IS NULL
            CREATE TABLE dbo.SchemaMigrations(Name nvarchar(255) NOT NULL PRIMARY KEY,
            AppliedAt datetime2 NOT NULL DEFAULT(SYSUTCDATETIME()))`);
        const directory = new URL('../db/migrations/', import.meta.url);
        const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
        // Legacy stage IDs must become unique before 0001 creates attachment FKs.
        const repair = files.indexOf('0002_repair_stage_ids.sql');
        if (repair >= 0) files.unshift(...files.splice(repair, 1));
        for (const name of files) {
            const source = await readFile(new URL(name, directory), 'utf8');
            const transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
            try {
                const existing = await new sql.Request(transaction).input('name', sql.NVarChar(255), name)
                    .query('SELECT Name FROM dbo.SchemaMigrations WITH(UPDLOCK,HOLDLOCK) WHERE Name=@name');
                if (existing.recordset.length) {
                    await transaction.commit();
                    console.log(`Already applied: ${name}`);
                    continue;
                }
                await new sql.Request(transaction).batch(source);
                await new sql.Request(transaction).input('name', sql.NVarChar(255), name)
                    .query('INSERT dbo.SchemaMigrations(Name) VALUES(@name)');
                await transaction.commit();
                console.log(`Applied: ${name}`);
            } catch (error) {
                try { await transaction.rollback(); } catch { /* Preserve migration failure. */ }
                throw error;
            }
        }
    } catch (error) {
        console.error('Migration failed', { code: error.code, number: error.number });
        process.exitCode = 1;
    } finally {
        if (pool) await pool.close();
    }
}
