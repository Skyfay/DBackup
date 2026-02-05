import { MongoClient, Admin } from "mongodb";

/**
 * Build MongoDB connection URI from config
 */
function buildConnectionUri(config: any): string {
    if (config.uri) {
        return config.uri;
    }

    const auth = config.user && config.password
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
        : "";
    const authSource = config.authenticationDatabase || config.authSource || "admin";
    const authQuery = config.user ? `?authSource=${authSource}` : "";

    return `mongodb://${auth}${config.host}:${config.port}/${authQuery}`;
}

export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(config);
        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });

        await client.connect();

        // Ping to verify connection
        const admin: Admin = client.db().admin();
        await admin.ping();

        // Get server version
        const serverInfo = await admin.serverInfo();
        const version = serverInfo.version;

        return { success: true, message: "Connection successful", version };
    } catch (error: unknown) {
        const err = error as Error;
        return { success: false, message: "Connection failed: " + err.message };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

export async function getDatabases(config: any): Promise<string[]> {
    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(config);
        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });

        await client.connect();

        const admin: Admin = client.db().admin();
        const { databases } = await admin.listDatabases();

        const sysDbs = ["admin", "config", "local"];
        return databases
            .map((db: { name: string }) => db.name)
            .filter((name: string) => !sysDbs.includes(name));
    } finally {
        if (client) {
            await client.close();
        }
    }
}
