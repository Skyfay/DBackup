import sql from "mssql";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "mssql" });

/**
 * Build connection configuration for mssql package
 */
export function buildConnectionConfig(config: any): sql.config {
    return {
        server: config.host,
        port: config.port || 1433,
        user: config.user,
        password: config.password || "",
        database: "master", // Connect to master for admin operations
        options: {
            encrypt: config.encrypt ?? true,
            trustServerCertificate: config.trustServerCertificate ?? false,
            connectTimeout: 15000,
            // Use configurable timeout (default 5 min) for large backup/restore operations
            requestTimeout: config.requestTimeout ?? 300000,
        },
    };
}

/**
 * Test connection and retrieve version
 */
export async function test(config: any): Promise<{ success: boolean; message: string; version?: string; edition?: string }> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = await sql.connect(connConfig);

        // Get version and edition information
        const result = await pool.request().query(`
            SELECT
                @@VERSION AS Version,
                SERVERPROPERTY('ProductVersion') AS ProductVersion,
                SERVERPROPERTY('Edition') AS Edition,
                SERVERPROPERTY('EngineEdition') AS EngineEdition
        `);

        const fullVersion = result.recordset[0]?.Version || "";
        const productVersion = result.recordset[0]?.ProductVersion || "";
        const editionRaw = result.recordset[0]?.Edition || "";
        const engineEdition = result.recordset[0]?.EngineEdition || 0;

        // Parse version: "16.0.1000.6" -> major.minor.build
        const versionMatch = productVersion.match(/^(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : productVersion;

        // Determine edition string
        let edition = "Unknown";
        if (engineEdition === 9 || fullVersion.includes("Azure SQL Edge")) {
            edition = "Azure SQL Edge";
        } else if (editionRaw.toLowerCase().includes("express")) {
            edition = "Express";
        } else if (editionRaw.toLowerCase().includes("standard")) {
            edition = "Standard";
        } else if (editionRaw.toLowerCase().includes("enterprise")) {
            edition = "Enterprise";
        } else if (editionRaw.toLowerCase().includes("developer")) {
            edition = "Developer";
        } else if (editionRaw.toLowerCase().includes("web")) {
            edition = "Web";
        } else {
            edition = editionRaw.split(" ")[0] || "Unknown"; // Take first word
        }

        // Determine friendly name from full version string
        let friendlyName = "SQL Server";
        if (fullVersion.includes("2022")) friendlyName = "SQL Server 2022";
        else if (fullVersion.includes("2019")) friendlyName = "SQL Server 2019";
        else if (fullVersion.includes("2017")) friendlyName = "SQL Server 2017";
        else if (fullVersion.includes("Azure SQL Edge")) friendlyName = "Azure SQL Edge";

        return {
            success: true,
            message: `Connection successful (${friendlyName} ${edition})`,
            version,
            edition,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        // Provide helpful error messages
        if (message.includes("ECONNREFUSED")) {
            return { success: false, message: "Connection refused. Check host/port." };
        }
        if (message.includes("Login failed")) {
            return { success: false, message: "Login failed. Check username/password." };
        }
        if (message.includes("certificate")) {
            return { success: false, message: "Certificate error. Try enabling 'Trust Server Certificate'." };
        }

        return { success: false, message: `Connection failed: ${message}` };
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Get list of user databases (exclude system databases)
 */
export async function getDatabases(config: any): Promise<string[]> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = await sql.connect(connConfig);

        // Exclude system databases (database_id <= 4: master, tempdb, model, msdb)
        const result = await pool.request().query(`
            SELECT name
            FROM sys.databases
            WHERE database_id > 4
              AND state = 0
            ORDER BY name
        `);

        return result.recordset.map((row: any) => row.name);
    } catch (error: unknown) {
        log.error("Failed to get databases", {}, wrapError(error));
        return [];
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Execute a SQL query and return raw results
 * Used internally by dump/restore operations
 */
export async function executeQuery(config: any, query: string, database?: string): Promise<sql.IResult<any>> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        if (database) {
            connConfig.database = database;
        }

        pool = await sql.connect(connConfig);
        return await pool.request().query(query);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Execute a parameterized SQL query (safe from SQL injection)
 * Used for queries with user-provided values
 */
export async function executeParameterizedQuery(
    config: any,
    query: string,
    params: Record<string, string | number | boolean>,
    database?: string
): Promise<sql.IResult<any>> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        if (database) {
            connConfig.database = database;
        }

        pool = await sql.connect(connConfig);
        const request = pool.request();

        // Add parameters to the request
        for (const [key, value] of Object.entries(params)) {
            request.input(key, value);
        }

        return await request.query(query);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Check if the SQL Server edition supports backup compression
 * Supported in: Enterprise, Standard (SQL 2008 R2+), Business Intelligence, Developer
 * NOT supported in: Express, Web
 */
export async function supportsCompression(config: any): Promise<boolean> {
    try {
        const result = await executeQuery(
            config,
            "SELECT SERVERPROPERTY('Edition') AS Edition, SERVERPROPERTY('EngineEdition') AS EngineEdition"
        );

        const edition = result.recordset[0]?.Edition || "";
        const engineEdition = result.recordset[0]?.EngineEdition || 0;

        // EngineEdition values:
        // 1 = Express (no compression)
        // 2 = Standard (compression supported)
        // 3 = Enterprise (compression supported)
        // 4 = Express (no compression)
        // 5 = Azure SQL Database (depends on service tier)
        // 6 = Azure Synapse Analytics
        // 8 = Azure SQL Managed Instance (compression supported)
        // 9 = Azure SQL Edge (no compression by default)

        // Express editions don't support compression
        if (edition.toLowerCase().includes("express")) {
            return false;
        }

        // Web edition doesn't support compression
        if (edition.toLowerCase().includes("web")) {
            return false;
        }

        // Azure SQL Edge uses EngineEdition 9, limited compression support
        if (engineEdition === 9) {
            return false;
        }

        // All other editions (Enterprise, Standard, Developer) support compression
        return engineEdition >= 2 && engineEdition <= 3 || engineEdition === 8;
    } catch {
        // If we can't determine, don't use compression to be safe
        return false;
    }
}
