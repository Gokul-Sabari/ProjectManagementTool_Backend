import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

export let portalPool = null;

export const connectDB = async () => {
    let config = {
        server: process.env.DB_HOST || process.env.SERVER,
        port: Number(process.env.DB_PORT) || 1433,
        database: process.env.USERPORTALDB || process.env.DATABASE,
        user: process.env.DB_USER || process.env.USER,
        password: process.env.DB_PASSWORD || process.env.PASSWORD,
        driver: "SQL Server",
        connectionTimeout: 15000,
        requestTimeout: 15000,
        options: {
            trustServerCertificate: true,
            enableArithAbort: true,
        },
    };
    if (process.env.INSTANCE) {
        config.options.instanceName = process.env.INSTANCE;
    }

    try {
        portalPool = await sql.connect(config);
        console.log("Connected Successfully ✔");
        
        return portalPool;
    } catch (err) {
        console.log("DB Connection Error:", err);
        throw err;
    }
};


export const getPool = async () => {
    if (!portalPool) {
        await connectDB();
    }
    return portalPool;
};