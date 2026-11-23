// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "path";
import { REPO_ROOT, parseConfig, resolveSecret } from "../../../lab/src/config";

const admin = { name: "Lab Admin", email: "admin@dbackup.lab", password: "Harbor-Lamp-2026" };

describe("the dev lab config", () => {
    it("runs the lab on this machine when it names no Docker host", () => {
        const config = parseConfig({ admin }, "test.json");

        expect(config.profile).toBe("core");
        expect(config.storageRoot).toBe(path.join(REPO_ROOT, ".lab-storage"));
        expect(config.docker).toEqual({ name: "this machine", docker: "default", address: "127.0.0.1", ssh: undefined });
        expect(config.natives).toEqual([]);
    });

    it("runs the whole lab on the Docker host it names, with its SSH login on port 22 by default", () => {
        const config = parseConfig({ admin, docker: { context: "lab-debian", address: "100.100.30.1", ssh: { user: "root" } } }, "test.json");

        expect(config.docker).toMatchObject({ name: "lab-debian", docker: "lab-debian", address: "100.100.30.1", ssh: { user: "root", port: 22 } });
        // A NetBird SSH server takes any password, so none is needed in the config.
        expect(config.docker.ssh?.password).toBeTruthy();
    });

    it("reads the native servers with their root login and the login of their sources", () => {
        const config = parseConfig({
            admin,
            native: { ubuntu: { address: "100.100.30.2", ssh: { user: "root" }, login: { user: "dbackup", port: 2222, password: "Real-Password-42" } } },
        }, "test.json");

        expect(config.natives).toHaveLength(1);
        expect(config.natives[0]).toMatchObject({ name: "ubuntu", address: "100.100.30.2", ssh: { user: "root", port: 22 } });
        expect(config.natives[0].login).toEqual({ user: "dbackup", port: 2222, password: "Real-Password-42" });
    });

    it("reads the Cloudflare account of the D1 source, with the token from the environment", () => {
        process.env.LAB_TEST_D1_TOKEN = "token-from-env";
        try {
            const config = parseConfig({ admin, cloudflareD1: { accountId: "0123456789ABCDEF0123456789ABCDEF", token: "env:LAB_TEST_D1_TOKEN" } }, "test.json");
            expect(config.cloudflareD1).toEqual({ accountId: "0123456789abcdef0123456789abcdef", token: "token-from-env" });
        } finally {
            delete process.env.LAB_TEST_D1_TOKEN;
        }
        expect(parseConfig({ admin }, "test.json").cloudflareD1).toBeUndefined();
    });

    it("refuses an account ID that is not the one of the Cloudflare dashboard", () => {
        expect(() => parseConfig({ admin, cloudflareD1: { accountId: "my-account", token: "t" } }, "test.json")).toThrow(/cloudflareD1\.accountId/);
    });

    it("says how to move a config that still places the parts on several hosts", () => {
        expect(() => parseConfig({ admin, hosts: { debian: { docker: "lab-debian", address: "100.100.30.1" } }, place: { databases: "debian" } }, "test.json"))
            .toThrow(/one Docker host now/);
    });

    it("refuses a field it does not know, instead of ignoring a typo", () => {
        expect(() => parseConfig({ admin, docker: { context: "lab", address: "10.0.0.1", adress: "typo" } }, "test.json")).toThrow(/docker/);
    });

    it("says which field is wrong", () => {
        expect(() => parseConfig({ admin: { ...admin, email: "not-an-email" } }, "test.json")).toThrow(/admin\.email/);
    });

    it("reads a password from the environment when it starts with env:", () => {
        process.env.LAB_TEST_PASSWORD = "From-The-Environment-42";
        expect(resolveSecret("env:LAB_TEST_PASSWORD")).toBe("From-The-Environment-42");
        expect(resolveSecret("Plain-Value-42")).toBe("Plain-Value-42");
        delete process.env.LAB_TEST_PASSWORD;
        expect(() => resolveSecret("env:LAB_TEST_PASSWORD")).toThrow(/LAB_TEST_PASSWORD/);
    });
});
