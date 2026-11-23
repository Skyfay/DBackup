import { describe, it, expect } from "vitest";

import { assertCommandFields, assertConfigFitsSchema, commandFieldProblems, configSchemaProblems } from "@/lib/adapters/config-check";
import { ValidationError } from "@/lib/logging/errors";

/**
 * A config is checked against the schema of its adapter before it is stored, since the adapters take
 * a stored config as it is. What the form sends, a config a saved login completes and the fields of
 * an earlier version still fit.
 */

describe("a config checked against the schema of its adapter", () => {
    it("refuses a port that is no number and names the field, never the value", () => {
        const check = () => assertConfigFitsSchema("rsync", { host: "nas.example.com", port: "22 -oProxyCommand=touch /tmp/x", username: "backup", authType: "password", pathPrefix: "/backups" });
        expect(check).toThrow(ValidationError);
        expect(check).toThrow(/Port/);
        expect(check).not.toThrow(/ProxyCommand/);
    });

    it("refuses a field of the wrong type", () => {
        expect(configSchemaProblems("mysql", { host: 42, port: 3306 })).toEqual([expect.stringMatching(/^Host: /)]);
        expect(configSchemaProblems("postgres", { host: "db", port: "five" })).toEqual([expect.stringMatching(/^Port: /)]);
        expect(configSchemaProblems("sftp", { host: "nas", port: 22, username: "backup", authType: "telnet" })).toEqual([expect.stringMatching(/^Auth Type: /)]);
    });

    it("refuses a password the MySQL tools would read as more options", () => {
        expect(() => assertConfigFitsSchema("mysql", { host: "db", user: "backup", password: "pw\ninit-command=x" })).toThrow(/line break or a NUL/);
        expect(() => assertConfigFitsSchema("mariadb", { host: "db", user: "backup", password: "pw\0" })).toThrow(/line break or a NUL/);
    });

    it("lets a saved login supply the user, the password or the key, also when the form sends them blank", () => {
        expect(configSchemaProblems("mysql", { host: "db", port: 3306 })).toEqual([]);
        expect(configSchemaProblems("mysql", { host: "db", port: 3306, user: "", password: "" })).toEqual([]);
        expect(configSchemaProblems("s3-generic", { endpoint: "https://s3.example.com", bucket: "b", accessKeyId: "", secretAccessKey: "" })).toEqual([]);
        expect(configSchemaProblems("generic-webhook", { method: "POST", contentType: "application/json" })).toEqual([]);
    });

    it("takes ports as text and fields of an earlier version the schema does not name", () => {
        expect(configSchemaProblems("mysql", { host: "db", port: "3306", user: "backup", legacyField: { any: true } })).toEqual([]);
        expect(configSchemaProblems("mongodb", { host: "db", uri: "mongodb://db:27017" })).toEqual([]);
    });

    it("refuses a field a schema requires and nobody fills in", () => {
        expect(configSchemaProblems("email", {})).toEqual(expect.arrayContaining([expect.stringMatching(/^Host: /), expect.stringMatching(/^From: /)]));
    });
});

describe("the fields that reach a command line", () => {
    it("are ports from 1 to 65535 and hosts and users without control characters", () => {
        expect(commandFieldProblems({ port: 70000 })).toHaveLength(1);
        expect(commandFieldProblems({ sshPort: "22 -o x" })).toHaveLength(1);
        expect(commandFieldProblems({ host: "db\n-o x" })).toHaveLength(1);
        expect(commandFieldProblems({ sshUsername: "root\r" })).toHaveLength(1);
        expect(commandFieldProblems({ user: 7 })).toHaveLength(1);
    });

    it("pass an empty port or 0, which the adapters read as their default", () => {
        expect(commandFieldProblems({ port: "", sshPort: 0, host: "db.example.com", user: "backup" })).toEqual([]);
    });

    it("are all a copy or a restore from Recently deleted asks of a config of an earlier version", () => {
        // A field of today's schema that never reaches a program does not stop it.
        expect(() => assertCommandFields({ host: "db", port: 3306, authType: "telnet", database: 42 })).not.toThrow();
        expect(() => assertCommandFields({ host: "db", port: "3306;x" })).toThrow(ValidationError);
    });
});
