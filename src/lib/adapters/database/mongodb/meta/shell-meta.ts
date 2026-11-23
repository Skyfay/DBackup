import type { ExecutionHost } from "@/lib/transport";
import type { MongoDBConfig } from "@/lib/adapters/definitions";
import { MONGOSH, SYSTEM_DATABASES, withShellConnection } from "../args";
import type {
    MongoCollectionInfo,
    MongoDatabaseStats,
    MongoFindQuery,
    MongoMeta,
    MongoPage,
} from "./types";

/**
 * Metadata over `mongosh` on the execution host, used when the server is only
 * reachable from there.
 *
 * Every script is passed as one argument to `--eval` rather than pasted into a
 * shell command line, so a database or collection name cannot terminate the
 * quoting. Values that reach a script go through JSON.stringify, which produces
 * a JavaScript literal. The connection string with the password reaches mongosh through a file of
 * mode 0600, never argv, see `withShellConnection`.
 */
export class ShellMongoMeta implements MongoMeta {
    private binary: Promise<string> | null = null;

    constructor(
        private readonly config: MongoDBConfig,
        private readonly host: ExecutionHost,
    ) {}

    private mongosh(): Promise<string> {
        if (!this.binary) {
            this.binary = this.host.which(...MONGOSH);
        }
        return this.binary;
    }

    /** Run a script and parse the single JSON value it prints. */
    private async evaluate<T>(script: string, what: string): Promise<T> {
        const mongosh = await this.mongosh();
        const result = await withShellConnection(this.host, this.config, (args, prelude) =>
            this.host.exec([mongosh, ...args, "--eval", `${prelude}${script}`]));

        if (result.code !== 0) {
            throw new Error(`Failed to ${what}: ${result.stderr.trim() || result.stdout.trim()}`);
        }

        // mongosh may print connection banners before the payload, so the first
        // line that looks like JSON is the answer.
        const line = result.stdout
            .split("\n")
            .map(l => l.trim())
            .find(l => l.startsWith("[") || l.startsWith("{"));

        if (!line) {
            throw new Error(`Failed to ${what}: no JSON output from mongosh`);
        }
        return JSON.parse(line) as T;
    }

    async serverVersion(): Promise<string> {
        const mongosh = await this.mongosh();
        const result = await withShellConnection(this.host, this.config, (args, prelude) =>
            this.host.exec([mongosh, ...args, "--eval", `${prelude}print(db.adminCommand({buildInfo:1}).version)`]));

        if (result.code !== 0) {
            throw new Error(result.stderr.trim() || result.stdout.trim() || "mongosh failed");
        }
        return result.stdout.trim() || "Unknown";
    }

    async listDatabaseNames(): Promise<string[]> {
        const names = await this.evaluate<string[]>(
            "print(JSON.stringify(db.adminCommand({listDatabases:1}).databases.map(function(d){return d.name})))",
            "list databases",
        );
        return names.filter(name => !SYSTEM_DATABASES.includes(name));
    }

    async databaseStats(): Promise<MongoDatabaseStats[]> {
        const script =
            "var r=db.adminCommand({listDatabases:1});var out=[];" +
            "r.databases.forEach(function(d){var c=0;try{c=db.getSiblingDB(d.name).getCollectionNames().length}catch(e){}" +
            "out.push({name:d.name,sizeOnDisk:Number(d.sizeOnDisk)||0,collectionCount:c})});" +
            "print(JSON.stringify(out))";

        const stats = await this.evaluate<MongoDatabaseStats[]>(script, "list databases with stats");
        return stats.filter(d => !SYSTEM_DATABASES.includes(d.name));
    }

    async listCollections(database: string): Promise<MongoCollectionInfo[]> {
        const script =
            `var db2=db.getSiblingDB(${JSON.stringify(database)});` +
            "var colls=db2.listCollections().toArray();" +
            "print(JSON.stringify(colls.map(function(c){var n=0;try{n=db2.getCollection(c.name).estimatedDocumentCount()}catch(e){}" +
            "return{name:c.name,type:c.type,estimatedCount:n}})))";

        return this.evaluate<MongoCollectionInfo[]>(script, "list collections");
    }

    async findPage(database: string, collection: string, query: MongoFindQuery): Promise<MongoPage> {
        const script =
            `var col=db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)});` +
            `var filter=${JSON.stringify(query.filter)};` +
            `var out={total:col.countDocuments(filter),docs:col.find(filter).sort(${JSON.stringify(query.sort ?? {})})` +
            `.skip(${query.skip}).limit(${query.limit}).toArray()};` +
            "try{print(EJSON.stringify(out))}catch(e){print(JSON.stringify(out))}";

        return this.evaluate<MongoPage>(script, "fetch documents");
    }

    /**
     * No probe over this transport: mongorestore reports permission problems
     * itself, which is what this mode has always relied on.
     */
    checkWritable(): null {
        return null;
    }

    async close(): Promise<void> {
        // Nothing is held open: each call is its own mongosh invocation.
    }
}
