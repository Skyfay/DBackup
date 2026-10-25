/**
 * Whether a database of a server can be given to a customer alone is a capability of its engine,
 * which every database adapter declares in its definition. Redis and Valkey back up every logical
 * database as one snapshot, so a customer given one of them would get them all.
 */
import { describe, expect, it } from "vitest";
import { registerAdapters } from "@/lib/adapters";
import { ADAPTER_DEFINITIONS, sharesSingleDatabases } from "@/lib/adapters/definitions";
import { registry } from "@/lib/core/registry";

registerAdapters();

describe("the engines that give one database to a customer alone", () => {
    it("is declared by every registered database adapter, so a new engine cannot be shared by oversight", () => {
        const undeclared = registry.getDatabaseAdapters()
            .map((adapter) => adapter.id)
            .filter((id) => typeof ADAPTER_DEFINITIONS.find((definition) => definition.id === id)?.sharesSingleDatabases !== "boolean");
        expect(undeclared).toEqual([]);
    });

    it("leaves out Redis and Valkey, whose backup holds every database of the server in one snapshot", () => {
        expect(sharesSingleDatabases("redis")).toBe(false);
        expect(sharesSingleDatabases("valkey")).toBe(false);
    });

    it("covers the engines that dump each database on its own", () => {
        for (const id of ["mysql", "mariadb", "postgres", "mongodb", "mssql", "azure-sql", "sqlite", "firebird"]) {
            expect(sharesSingleDatabases(id), id).toBe(true);
        }
    });

    it("shares nothing of an engine nobody knows or of a destination", () => {
        expect(sharesSingleDatabases("unknown-engine")).toBe(false);
        expect(sharesSingleDatabases("local-filesystem")).toBe(false);
    });
});
