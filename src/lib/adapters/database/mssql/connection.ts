import sql from "mssql";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { MSSQLConfig } from "@/lib/adapters/definitions";

const log = logger.child({ adapter: "mssql" });

/**
 * Build connection configuration for mssql package
 */
export function buildConnectionConfig(config: MSSQLConfig): sql.config {
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
export async function test(config: MSSQLConfig): Promise<{ success: boolean; message: string; version?: string; edition?: string }> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();

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
export async function getDatabases(config: MSSQLConfig): Promise<string[]> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();

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

import { DatabaseInfo } from "@/lib/core/interfaces";

/**
 * Get user databases with size and table count information
 */
export async function getDatabasesWithStats(config: MSSQLConfig): Promise<DatabaseInfo[]> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();

        // Get database names and sizes from master catalog views.
        // Include all user databases regardless of state so offline/restoring DBs
        // are still visible. state_desc is included for display purposes.
        const sizeResult = await pool.request().query(`
            SELECT
                d.name,
                d.state_desc,
                SUM(CAST(mf.size AS BIGINT)) * 8 * 1024 AS size_bytes
            FROM sys.databases d
            LEFT JOIN sys.master_files mf ON d.database_id = mf.database_id
            WHERE d.database_id > 4
            GROUP BY d.name, d.state_desc
            ORDER BY d.name
        `);

        // Get table counts per database via cross-database sys.tables queries.
        // INFORMATION_SCHEMA.TABLES only returns tables for the current DB context,
        // so we query each database individually.
        const databases: DatabaseInfo[] = [];

        for (const row of sizeResult.recordset) {
            let tableCount = 0;
            try {
                const safeName = row.name.replace(/\]/g, "]]");
                const tableResult = await pool.request().query(
                    `SELECT COUNT(*) AS cnt FROM [${safeName}].sys.tables`
                );
                tableCount = tableResult.recordset[0]?.cnt ?? 0;
            } catch {
                // Database may be inaccessible (permission, offline) - default to 0
            }

            databases.push({
                name: row.name,
                sizeInBytes: row.size_bytes ?? 0,
                tableCount,
            });
        }

        return databases;
    } catch (error: unknown) {
        log.error("Failed to get databases with stats", {}, wrapError(error));
        throw wrapError(error);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * SQL Server message captured during query execution
 */
export interface SqlServerMessage {
    message: string;
    number: number;
    state: number;
    class: number;
    serverName?: string;
    procName?: string;
}

/**
 * Result from executeQueryWithMessages including captured SQL Server messages
 */
export interface QueryResultWithMessages {
    result: sql.IResult<any>;
    messages: SqlServerMessage[];
}

/**
 * Execute a SQL query and return raw results
 * Used internally by dump/restore operations
 */
export async function executeQuery(config: MSSQLConfig, query: string, database?: string): Promise<sql.IResult<any>> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        if (database) {
            connConfig.database = database;
        }

        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();
        return await pool.request().query(query);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

/**
 * Execute a SQL query while capturing all SQL Server info/error messages.
 * Essential for BACKUP/RESTORE operations where the actual error details
 * are sent as informational messages before the final error is thrown.
 *
 * @param requestTimeout Override request timeout (0 = no timeout). Defaults to config value.
 * @param onMessage Optional callback invoked for each SQL Server info message in real-time.
 */
export async function executeQueryWithMessages(
    config: MSSQLConfig,
    query: string,
    database?: string,
    requestTimeout?: number,
    onMessage?: (msg: SqlServerMessage) => void
): Promise<QueryResultWithMessages> {
    let pool: sql.ConnectionPool | null = null;
    const messages: SqlServerMessage[] = [];

    try {
        const connConfig = buildConnectionConfig(config);
        if (database) {
            connConfig.database = database;
        }
        // Allow callers to override requestTimeout (e.g. 0 for long-running BACKUP/RESTORE)
        if (requestTimeout !== undefined && connConfig.options) {
            connConfig.options.requestTimeout = requestTimeout;
        }

        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();
        const request = pool.request();

        // Capture all SQL Server info messages (progress reports, warnings, errors)
        request.on("info", (info: SqlServerMessage) => {
            messages.push(info);
            if (onMessage) onMessage(info);
        });

        const result = await request.query(query);
        return { result, messages };
    } catch (error: unknown) {
        // Enhance the error with captured SQL Server messages
        const serverMessages = messages
            .filter((m) => m.class > 0)
            .map((m) => m.message)
            .filter(Boolean);

        // Extract preceding errors from mssql RequestError.
        // SQL Server sends the actual cause (e.g. "Cannot open backup device..."
        // or "Operating system error 5") as a preceding error BEFORE the generic
        // "BACKUP DATABASE is terminating abnormally" message.
        if (error && typeof error === "object" && "precedingErrors" in error) {
            const precedingErrors = (error as { precedingErrors?: unknown[] }).precedingErrors;
            if (Array.isArray(precedingErrors)) {
                for (const pe of precedingErrors) {
                    const msg = pe && typeof pe === "object" && "message" in pe
                        ? (pe as { message: string }).message
                        : undefined;
                    if (msg) {
                        serverMessages.unshift(msg);
                    }
                }
            }
        }

        if (serverMessages.length > 0 && error instanceof Error) {
            // Prepend detail messages so the actual cause is visible
            const details = serverMessages.join(" | ");
            error.message = `${error.message} - Details: ${details}`;
        }

        throw error;
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
    config: MSSQLConfig,
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

        pool = new sql.ConnectionPool(connConfig);
        await pool.connect();
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
export async function supportsCompression(config: MSSQLConfig): Promise<boolean> {
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
