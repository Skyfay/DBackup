import { describe, it, expect } from "vitest";
import type { DatabaseAdapter } from "@/lib/core/interfaces";

describe("every database adapter can back up into a seekable archive", () => {
    // Imports the whole adapter registry, which is slow under a loaded test run. Same reason
    // as the transport lint guard.
    it("implements dumpOne and restoreOne", async () => {
        const { registry } = await import("@/lib/core/registry");
        const { registerAdapters } = await import("@/lib/adapters");
        registerAdapters();

        const databases: DatabaseAdapter[] = registry.getDatabaseAdapters();
        expect(databases.length).toBeGreaterThan(0);

        const missing = databases
            .filter((a) => typeof a.dumpOne !== "function" || typeof a.restoreOne !== "function")
            .map((a) => a.id);

        // An adapter without both halves would produce backups nobody can restore, or no
        // backups at all, once every job writes the seekable archive.
        expect(missing).toEqual([]);

        // Every adapter needs a dump format, which decides the extension a restore hands to
        // the engine's own tools.
        const { DB_FORMAT_BY_ADAPTER } = await import("@/lib/runner/steps/dump-databases");
        expect(databases.map((a) => a.id).filter((id) => !DB_FORMAT_BY_ADAPTER[id])).toEqual([]);
    }, 30_000);
});
