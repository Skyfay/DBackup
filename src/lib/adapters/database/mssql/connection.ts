import sql from "mssql";

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
            requestTimeout: 30000,
        },
    };
}

/**
 * Test connection and retrieve version
 */
export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    let pool: sql.ConnectionPool | null = null;

    try {
        const connConfig = buildConnectionConfig(config);
        pool = await sql.connect(connConfig);

        // Get version information
        const result = await pool.request().query("SELECT @@VERSION AS Version, SERVERPROPERTY('ProductVersion') AS ProductVersion");

        const fullVersion = result.recordset[0]?.Version || "";
        const productVersion = result.recordset[0]?.ProductVersion || "";

        // Parse version: "16.0.1000.6" -> major.minor.build
        const versionMatch = productVersion.match(/^(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : productVersion;

        // Determine friendly name from full version string
        let friendlyName = "SQL Server";
        if (fullVersion.includes("2022")) friendlyName = "SQL Server 2022";
        else if (fullVersion.includes("2019")) friendlyName = "SQL Server 2019";
        else if (fullVersion.includes("2017")) friendlyName = "SQL Server 2017";
        else if (fullVersion.includes("Azure SQL Edge")) friendlyName = "Azure SQL Edge";

        return {
            success: true,
            message: `Connected to ${friendlyName}`,
            version,
        };
    } catch (error: any) {
        const message = error.message || "Connection failed";

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
    } catch (error: any) {
        console.error("Failed to get databases:", error.message);
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
