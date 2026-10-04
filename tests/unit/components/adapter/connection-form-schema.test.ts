import { describe, expect, it } from "vitest";
import { getAdapterDefinition, type AdapterDefinition } from "@/lib/adapters/definitions";
import { buildConnectionFormSchema, credentialManagedKeys, loginRequired } from "@/components/adapter/connection-form-schema";

function adapter(id: string): AdapterDefinition {
    const definition = getAdapterDefinition(id);
    if (!definition) throw new Error(`No adapter ${id}`);
    return definition;
}

describe("connection form schema", () => {
    it("does not let a database through before its connection mode is picked", () => {
        const result = buildConnectionFormSchema(adapter("mysql")).safeParse({ name: "Shop", adapterId: "mysql", config: {} });
        expect(result.success).toBe(false);
        const issue = result.error?.issues.find((entry) => entry.path.join(".") === "config.connectionMode");
        expect(issue?.message).toBe("Choose how DBackup connects.");
    });

    it("accepts a direct connection whose user comes from a login profile", () => {
        const result = buildConnectionFormSchema(adapter("mysql")).safeParse({
            name: "Shop",
            adapterId: "mysql",
            config: { connectionMode: "direct", host: "db.internal", port: 3306 },
        });
        expect(result.success).toBe(true);
    });

    it("asks SQLite where the file is before anything else", () => {
        const result = buildConnectionFormSchema(adapter("sqlite")).safeParse({ name: "Local", adapterId: "sqlite", config: { path: "/data/app.db" } });
        expect(result.error?.issues.find((entry) => entry.path.join(".") === "config.mode")?.message).toBe("Choose where the database file is.");
    });

    it("leaves the fields of an SSH profile to the profile", () => {
        const keys = credentialManagedKeys(adapter("postgres"));
        expect(keys).toContain("user");
        expect(keys).toContain("sshUsername");
        expect(keys).not.toContain("sshHost");
    });

    it("knows which databases cannot log in without a profile", () => {
        expect(loginRequired(adapter("postgres"))).toBe(true);
        expect(loginRequired(adapter("redis"))).toBe(false);
        expect(loginRequired(adapter("sqlite"))).toBe(false);
    });

    it("reads the recipients of an email channel as a list, also where one address was stored", () => {
        const schema = buildConnectionFormSchema(adapter("email"));
        const base = { name: "Ops", adapterId: "email", config: { host: "smtp.example.com", from: "backup@example.com" } };
        const stored = schema.safeParse({ ...base, config: { ...base.config, to: "ops@example.com" } });
        expect(stored.success && stored.data.config.to).toEqual(["ops@example.com"]);
        const empty = schema.safeParse({ ...base, config: { ...base.config, to: [] } });
        expect(empty.error?.issues.find((entry) => entry.path.join(".") === "config.to")?.message).toBe("Add at least one recipient.");
    });
});
