// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "path";
import { REPO_ROOT, parseConfig, resolveSecret } from "../../../lab/src/config";

const admin = { name: "Lab Admin", email: "admin@dbackup.lab", password: "Harbor-Lamp-2026" };

describe("the dev lab config", () => {
    it("runs every part on this machine when it names no hosts", () => {
        const config = parseConfig({ admin }, "test.json");

        expect(config.profile).toBe("core");
        expect(config.storageRoot).toBe(path.join(REPO_ROOT, ".lab-storage"));
        expect(Object.values(config.place).map((host) => [host.name, host.docker, host.address])).toEqual([
            ["local", "default", "127.0.0.1"],
            ["local", "default", "127.0.0.1"],
            ["local", "default", "127.0.0.1"],
        ]);
    });

    it("places a part on the host it names", () => {
        const config = parseConfig({
            admin,
            hosts: { debian: { docker: "lab-debian", address: "100.100.30.1" } },
            place: { databases: "debian" },
        }, "test.json");

        expect(config.place.databases).toEqual({ name: "debian", docker: "lab-debian", address: "100.100.30.1" });
        expect(config.place.storage.name).toBe("local");
    });

    it("reads the SSH logins of a host, with port 22 and a stand-in password for a NetBird host", () => {
        const config = parseConfig({
            admin,
            hosts: {
                debian: { docker: "lab-debian", address: "100.100.30.1", ssh: { user: "root" } },
                ubuntu: { address: "100.100.30.2", ssh: { user: "root" }, native: { ssh: { user: "dbackup", port: 2222, password: "Real-Password-42" } } },
            },
        }, "test.json");

        expect(config.hosts.debian.ssh).toMatchObject({ user: "root", port: 22 });
        expect(config.hosts.debian.ssh?.password).toBeTruthy();
        expect(config.hosts.ubuntu.native?.ssh).toEqual({ user: "dbackup", port: 2222, password: "Real-Password-42" });
    });

    it("refuses to run a part on a host without a docker context", () => {
        expect(() => parseConfig({
            admin,
            hosts: { ubuntu: { address: "100.100.30.2", native: { ssh: { user: "dbackup", password: "Real-Password-42" } } } },
            place: { databases: "ubuntu" },
        }, "test.json")).toThrow(/places databases on "ubuntu", which has no docker context/);
    });

    it("refuses a part placed on a host it does not know", () => {
        expect(() => parseConfig({ admin, place: { storage: "nas" } }, "test.json")).toThrow(/places storage on "nas"/);
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
