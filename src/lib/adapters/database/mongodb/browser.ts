import { MongoClient } from "mongodb";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import { TableInfo, ColumnInfo, TableDataOptions, TableDataResult } from "@/lib/core/interfaces";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMongoArgs,
    remoteBinaryCheck,
} from "@/lib/ssh";

function buildConnectionUri(config: MongoDBConfig): string {
    if (config.uri) return config.uri;
    const auth = config.user && config.password
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
        : "";
    const authDb = config.authenticationDatabase || "admin";
    const authParam = config.user ? `?authSource=${authDb}` : "";
    return `mongodb://${auth}${config.host}:${config.port}/${authParam}`;
}

/** Flatten BSON document values to display-safe primitives. */
function flattenDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
        if (v === null || v === undefined || typeof v !== "object") {
            out[k] = v;
        } else {
            // Represent nested objects/arrays as compact JSON string
            try {
                out[k] = JSON.stringify(v);
            } catch {
                out[k] = String(v);
            }
        }
    }
    return out;
}

/** Derive ColumnInfo from a set of documents (union of all keys). */
function deriveColumns(docs: Record<string, unknown>[]): ColumnInfo[] {
    const seen = new Map<string, string>();
    for (const doc of docs) {
        for (const [k, v] of Object.entries(doc)) {
            if (!seen.has(k)) {
                let dataType: string = typeof v;
                if (v === null) dataType = "null";
                else if (Array.isArray(v)) dataType = "array";
                seen.set(k, dataType);
            }
        }
    }
    return Array.from(seen.entries()).map(([name, dataType]) => ({
        name,
        dataType,
        primaryKey: name === "_id",
        nullable: true,
    }));
}

function parseJsonLine<T>(stdout: string): T | null {
    const lines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
    const line = lines.find(l => l.startsWith("[") || l.startsWith("{"));
    if (!line) return null;
    try {
        return JSON.parse(line) as T;
    } catch {
        return null;
    }
}

export async function getTables(config: MongoDBConfig, database: string): Promise<TableInfo[]> {
    const dbNameJs = JSON.stringify(database);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const mongoshBin = await remoteBinaryCheck(ssh, "mongosh", "mongo");
            const args = buildMongoArgs(config);
            const script = `var db2=db.getSiblingDB(${dbNameJs});var colls=db2.listCollections().toArray();var out=colls.map(function(c){var cnt=0;try{cnt=db2.getCollection(c.name).estimatedDocumentCount();}catch(e){}return{name:c.name,type:c.type,count:cnt}});print(JSON.stringify(out))`;
            const cmd = `${mongoshBin} ${args.join(" ")} --quiet --eval '${script}'`;
            const result = await ssh.exec(cmd);
            if (result.code !== 0) throw new Error(`Failed to list collections: ${result.stderr}`);
            const parsed = parseJsonLine<Array<{ name: string; type: string; count: number }>>(result.stdout);
            if (!parsed) return [];
            return parsed.map(c => ({
                name: c.name,
                type: "collection" as const,
                rowCount: c.count,
            }));
        } finally {
            ssh.end();
        }
    }

    let client: MongoClient | null = null;
    try {
        client = new MongoClient(buildConnectionUri(config), { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
        await client.connect();
        const db = client.db(database);
        const collections = await db.listCollections().toArray();
        const tables: TableInfo[] = [];
        for (const coll of collections) {
            let rowCount: number | undefined;
            try {
                rowCount = await db.collection(coll.name).estimatedDocumentCount();
            } catch {
                // Best-effort
            }
            tables.push({ name: coll.name, type: "collection", rowCount });
        }
        return tables;
    } finally {
        if (client) await client.close().catch(() => {});
    }
}

export async function getTableData(
    config: MongoDBConfig,
    options: TableDataOptions
): Promise<TableDataResult> {
    const { database, table, page, pageSize } = options;
    const offset = (page - 1) * pageSize;
    const dbNameJs = JSON.stringify(database);
    const collNameJs = JSON.stringify(table);

    if (isSSHMode(config)) {
        const ssh = new SshClient();
        try {
            await ssh.connect(extractSshConfig(config)!);
            const mongoshBin = await remoteBinaryCheck(ssh, "mongosh", "mongo");
            const args = buildMongoArgs(config);
            const script = `var col=db.getSiblingDB(${dbNameJs}).getCollection(${collNameJs});var cnt=col.countDocuments({});var docs=col.find({}).skip(${offset}).limit(${pageSize}).toArray();var out={total:cnt,docs:docs};try{print(EJSON.stringify(out))}catch(e){print(JSON.stringify(out))}`;
            const cmd = `${mongoshBin} ${args.join(" ")} --quiet --eval '${script}'`;
            const result = await ssh.exec(cmd);
            if (result.code !== 0) throw new Error(`Failed to fetch documents: ${result.stderr}`);
            const parsed = parseJsonLine<{ total: number; docs: Record<string, unknown>[] }>(result.stdout);
            if (!parsed) return { rows: [], totalCount: 0, columns: [] };
            const flatDocs = parsed.docs.map(flattenDoc);
            const columns = deriveColumns(flatDocs);
            return { rows: flatDocs, totalCount: parsed.total, columns };
        } finally {
            ssh.end();
        }
    }

    let client: MongoClient | null = null;
    try {
        client = new MongoClient(buildConnectionUri(config), { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
        await client.connect();
        const collection = client.db(database).collection(table);
        const [totalCount, rawDocs] = await Promise.all([
            collection.countDocuments({}),
            collection.find({}).skip(offset).limit(pageSize).toArray(),
        ]);
        const docs = rawDocs.map(d => flattenDoc(d as unknown as Record<string, unknown>));
        const columns = deriveColumns(docs);
        return { rows: docs, totalCount, columns };
    } finally {
        if (client) await client.close().catch(() => {});
    }
}
