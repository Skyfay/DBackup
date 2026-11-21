import { describe, expect, it } from "vitest";
import { assertCommandFields, assertConfigFitsSchema, formConfigProblems } from "@/lib/adapters/config-check";
import { AzureSQLAdapter } from "@/lib/adapters/database/azure-sql";
import { resolveTransport } from "@/lib/transport/spec";

/**
 * DBackup sets some fields of a config for a single call only, like the known_hosts file of rsync
 * or the address it dials after the reach check. A config of a request or a stored row brings none
 * of them, so a member who may edit a connection cannot plant ssh options or another address.
 */

const rsync = { host: "backup.example.com", port: 22, username: "admin", authType: "password", password: "x", pathPrefix: "/backups" };

describe("names of per-call fields in a connection config", () => {
    it.each([
        ["knownHostsFile", "/dev/null -o ProxyCommand=touch /tmp/pwned"],
        ["strictHostKey", true],
        ["onHostKeyRefused", "x"],
        ["dialAddress", "198.51.100.9"],
        ["tlsServerName", "other.example.com"],
    ])("refuses %s on save, in a form and on a copy", (key, value) => {
        const planted = { ...rsync, [key]: value };

        expect(() => assertConfigFitsSchema("rsync", planted)).toThrow(/cannot be saved/);
        expect(() => assertCommandFields(planted)).toThrow(/cannot be saved/);
        expect(formConfigProblems("rsync", planted).join(" ")).toContain("cannot be saved");
    });

    it("keeps a config without them as it is", () => {
        expect(() => assertConfigFitsSchema("rsync", rsync)).not.toThrow();
        expect(formConfigProblems("rsync", rsync)).toEqual([]);
    });
});

describe("the transport of Azure SQL", () => {
    it("stays direct when a stored config brings an SSH mode its schema does not have", () => {
        const config = { server: "example.database.windows.net", connectionMode: "ssh", sshHost: "ssh.example.com", sshUsername: "admin" };

        expect(resolveTransport(AzureSQLAdapter, config).kind).toBe("direct");
    });
});
