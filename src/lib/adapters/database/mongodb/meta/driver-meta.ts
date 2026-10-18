import { MongoClient } from "mongodb";

import type { MongoDBConfig } from "@/lib/adapters/definitions";
import { SYSTEM_DATABASES, buildConnectionUri, connectsDirectly } from "../args";
import type {
    MongoCollectionInfo,
    MongoDatabaseStats,
    MongoFindQuery,
    MongoMeta,
    MongoPage,
} from "./types";

const CONNECT_TIMEOUT_MS = 10_000;

/** Metadata over the native driver, used whenever the server is directly reachable. */
export class DriverMongoMeta implements MongoMeta {
    private client: MongoClient | null = null;

    constructor(private readonly config: MongoDBConfig) {}

    private async connected(): Promise<MongoClient> {
        if (!this.client) {
            this.client = new MongoClient(buildConnectionUri(this.config), {
                connectTimeoutMS: CONNECT_TIMEOUT_MS,
                serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
                // One host without an SRV record: talk to that host alone, never to the members
                // it announces, which the local network check never read. The tools do the same
                // for a single --host. A seed list or an SRV name still discovers its replica set.
                ...(connectsDirectly(this.config) ? { directConnection: true } : {}),
            });
            await this.client.connect();
        }
        return this.client;
    }

    async serverVersion(): Promise<string> {
        const client = await this.connected();
        const admin = client.db("admin");
        await admin.command({ ping: 1 });
        const info = await admin.command({ buildInfo: 1 });
        return info.version || "Unknown";
    }

    async listDatabaseNames(): Promise<string[]> {
        const client = await this.connected();
        const result = await client.db("admin").command({ listDatabases: 1 });
        return result.databases
            .map((db: { name: string }) => db.name)
            .filter((name: string) => !SYSTEM_DATABASES.includes(name));
    }

    async databaseStats(): Promise<MongoDatabaseStats[]> {
        const client = await this.connected();
        const result = await client.db("admin").command({ listDatabases: 1 });

        const stats: MongoDatabaseStats[] = [];
        for (const db of result.databases) {
            if (SYSTEM_DATABASES.includes(db.name)) continue;

            let collectionCount = 0;
            try {
                collectionCount = (await client.db(db.name).listCollections().toArray()).length;
            } catch {
                // Best effort: a database the user cannot enumerate still gets listed.
            }
            stats.push({ name: db.name, sizeOnDisk: db.sizeOnDisk ?? 0, collectionCount });
        }
        return stats;
    }

    async listCollections(database: string): Promise<MongoCollectionInfo[]> {
        const client = await this.connected();
        const db = client.db(database);
        const collections = await db.listCollections().toArray();

        const out: MongoCollectionInfo[] = [];
        for (const collection of collections) {
            let estimatedCount: number | undefined;
            try {
                estimatedCount = await db.collection(collection.name).estimatedDocumentCount();
            } catch {
                // Best effort.
            }
            out.push({ name: collection.name, type: collection.type ?? "collection", estimatedCount });
        }
        return out;
    }

    async findPage(database: string, collection: string, query: MongoFindQuery): Promise<MongoPage> {
        const client = await this.connected();
        const coll = client.db(database).collection(collection);

        const cursor = query.sort
            ? coll.find(query.filter).sort(query.sort)
            : coll.find(query.filter);

        const [total, docs] = await Promise.all([
            coll.countDocuments(query.filter),
            cursor.skip(query.skip).limit(query.limit).toArray(),
        ]);

        return { total, docs: docs as unknown as Record<string, unknown>[] };
    }

    checkWritable(database: string): Promise<void> {
        return (async () => {
            const client = await this.connected();
            const target = client.db(database);
            try {
                // Creating and dropping a throwaway collection is the cheapest
                // way to find out before the restore starts rather than halfway through.
                await target.createCollection("__perm_check_tmp");
                await target.collection("__perm_check_tmp").drop();
            } catch (e: unknown) {
                const err = e as { message?: string; codeName?: string };
                const msg = err.message || err.codeName || "";
                if (
                    msg.includes("not authorized") ||
                    msg.includes("Authorization") ||
                    msg.includes("requires authentication") ||
                    msg.includes("command create requires")
                ) {
                    throw new Error(`Access denied to database '${database}'. Permissions?`);
                }
                throw e;
            }
        })();
    }

    async close(): Promise<void> {
        if (this.client) {
            await this.client.close().catch(() => {});
            this.client = null;
        }
    }
}
