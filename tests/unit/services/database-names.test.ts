/**
 * A database name from a job, a restore target or a mapping is always taken as a name: it never
 * starts with `-`, which a dump or restore tool would read as an option. Checked where a job or a
 * restore takes it and again where an adapter passes it, while a normal name with dots or dashes
 * inside goes through as before.
 */
import { describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";
import { databaseNameProblem } from "@/lib/adapters/database/common/database-name";
import { assertDatabaseTarget, normalizeDatabaseMapping } from "@/services/restore/database-mapping";
import { buildConnectionArgs as redisArgs } from "@/lib/adapters/database/redis/args";
import { buildConnectionString } from "@/lib/adapters/database/firebird/connection";
import { MongoDBBaseDialect } from "@/lib/adapters/database/mongodb/dialects/mongodb-base";
import { JobService } from "@/services/jobs/job-service";

vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/trash/trash-snapshot", () => ({ keepInTrash: vi.fn() }));

const NORMAL = ["shop", "shop-v2", "shop.archive", "my_db-2026.10", "Shop Data", "x-"];
const OPTIONS = ["-x", "--result-file=/tmp/x", "--init-command=DROP DATABASE a", "-"];

describe("a database name", () => {
    it("never starts with -, and keeps dots and dashes inside", () => {
        for (const name of NORMAL) expect(databaseNameProblem(name), name).toBeNull();
        for (const name of OPTIONS) expect(databaseNameProblem(name), name).toContain("starts with -");
    });

    describe("of a restore", () => {
        it("refuses a target or a selected mapping entry that starts with -", () => {
            expect(() => assertDatabaseTarget("--init-command=x")).toThrow(ValidationError);
            expect(() => normalizeDatabaseMapping([{ originalName: "shop", targetName: "-x", selected: true }])).toThrow(/starts with -/);
            expect(() => normalizeDatabaseMapping({ shop: "--result-file=/tmp/x" })).toThrow(/starts with -/);
        });

        it("keeps a normal target and leaves entries that are not restored alone", () => {
            expect(() => assertDatabaseTarget("shop-v2.restored")).not.toThrow();
            expect(() => assertDatabaseTarget(undefined)).not.toThrow();
            expect(normalizeDatabaseMapping([
                { originalName: "shop", targetName: "shop-v2.copy", selected: true },
                { originalName: "-legacy", targetName: "-legacy", selected: false },
            ])).toEqual([
                { originalName: "shop", targetName: "shop-v2.copy", selected: true },
                { originalName: "-legacy", targetName: "-legacy", selected: false },
            ]);
        });
    });

    describe("of a job", () => {
        it("is refused on save when it starts with -, before anything is written", async () => {
            const service = new JobService();
            await expect(service.createJob({
                name: "Job", schedule: "0 0 * * *", sourceId: "source-1", databases: ["shop", "--result-file=/tmp/x"],
                destinations: [{ configId: "dest-1", priority: 0, retention: "{}" }],
            } as never)).rejects.toThrow(ValidationError);
            await expect(service.updateJob("job-1", { databases: ["-x"] } as never)).rejects.toThrow(/starts with -/);
            expect(prismaMock.job.create).not.toHaveBeenCalled();
            expect(prismaMock.job.update).not.toHaveBeenCalled();
        });
    });

    describe("passed to a tool", () => {
        it("goes to mongodump as the value of --db as before, and never starts with -", () => {
            const dialect = new MongoDBBaseDialect();
            const args = dialect.getDumpArgs({ host: "mongo.example.com", port: 27017 } as never, ["shop-v2.a"]);
            expect(args[args.indexOf("--db") + 1]).toBe("shop-v2.a");
            expect(() => dialect.getDumpArgs({ host: "mongo.example.com", port: 27017 } as never, ["--out=/tmp"])).toThrow(/starts with -/);
        });

        it("goes to redis-cli as a whole number only", () => {
            expect(redisArgs({ host: "cache", port: 6379, database: 3 } as never)).toEqual(expect.arrayContaining(["-n", "3"]));
            expect(redisArgs({ host: "cache", port: 6379, database: "3" } as never)).toEqual(expect.arrayContaining(["-n", "3"]));
            expect(redisArgs({ host: "cache", port: 6379, database: 0 } as never)).not.toContain("-n");
            expect(() => redisArgs({ host: "cache", port: 6379, database: "--rdb" } as never)).toThrow(/no index/);
        });

        it("reaches gbak behind the host of the Firebird connection string, which never starts with -", () => {
            expect(buildConnectionString({ host: "fb.example.com", port: 3051 } as never, "/data/-shop.fdb")).toBe("fb.example.com/3051:/data/-shop.fdb");
            expect(buildConnectionString({ host: "fb.example.com", port: 3050 } as never, "/data/shop.fdb")).toBe("fb.example.com:/data/shop.fdb");
            expect(() => buildConnectionString({ host: "-y", port: 3050 } as never, "/data/shop.fdb")).toThrow(/never starts with -/);
        });
    });
});
