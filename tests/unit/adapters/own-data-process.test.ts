// @vitest-environment node
/**
 * `/proc/self/environ` holds `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`, so a job of a member on a
 * Local Filesystem of the platform admin with the folder `/` once packed them into a backup through
 * the directory source `proc/self`. `/proc` and the files the keys were read from count as DBackup's
 * own data now, which no run reads, while a folder beside them stays a folder like any other.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/core/registry", () => ({ registry: { get: (id: string) => ({ id }), register: vi.fn() } }));

const { ownDataRefusal, OWN_SECRETS_REFUSED } = await import("@/lib/adapters/own-data");

let root: string;
let secrets: string;
const env = {
    url: process.env.DATABASE_URL, certs: process.env.CERTS_DIR, tmp: process.env.TMPDIR,
    key: process.env.ENCRYPTION_KEY_FILE, auth: process.env.BETTER_AUTH_SECRET_FILE,
};

function restore(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "own-process-")));
    secrets = path.join(root, "run", "secrets");
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(root, "run", "other"), { recursive: true });
    fs.mkdirSync(secrets, { recursive: true });
    fs.writeFileSync(path.join(secrets, "encryption_key"), "");
    fs.writeFileSync(path.join(secrets, "auth_secret"), "");
    process.env.DATABASE_URL = `file:${path.join(root, "data", "dbackup.db")}`;
    process.env.CERTS_DIR = path.join(root, "data", "certs");
    process.env.TMPDIR = path.join(root, "tmp");
    process.env.ENCRYPTION_KEY_FILE = path.join(secrets, "encryption_key");
    process.env.BETTER_AUTH_SECRET_FILE = path.join(secrets, "auth_secret");
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    restore("DATABASE_URL", env.url);
    restore("CERTS_DIR", env.certs);
    restore("TMPDIR", env.tmp);
    restore("ENCRYPTION_KEY_FILE", env.key);
    restore("BETTER_AUTH_SECRET_FILE", env.auth);
});

beforeEach(() => {
    vi.clearAllMocks();
    // No configuration backup to a Local Filesystem.
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
});

const local = (basePath: string) => ({ basePath });

describe("a folder that reaches the process of DBackup", () => {
    it.each(["proc/self", "proc", "/proc/self/environ", "proc/1"])("is refused below the folder /: %s", async (subPath) => {
        expect(await ownDataRefusal("local-filesystem", local("/"), { subPath })).toBe(OWN_SECRETS_REFUSED);
    });

    it("is refused as the folder of the connection itself", async () => {
        expect(await ownDataRefusal("local-filesystem", local("/proc/self"))).toBe(OWN_SECRETS_REFUSED);
    });

    it("leaves a folder beside it alone", async () => {
        expect(await ownDataRefusal("local-filesystem", local("/"), { subPath: "srv" })).toBeNull();
        expect(await ownDataRefusal("local-filesystem", local("/"), { subPath: "procedures" })).toBeNull();
    });
});

describe("a folder that reaches the files the keys of DBackup were read from", () => {
    it("is refused for the files and for the folder that holds them", async () => {
        expect(await ownDataRefusal("local-filesystem", local(secrets))).toBe(OWN_SECRETS_REFUSED);
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "run")), { subPath: "secrets/auth_secret" })).toBe(OWN_SECRETS_REFUSED);
        expect(await ownDataRefusal("sqlite", { mode: "local", path: path.join(secrets, "encryption_key") })).toBe(OWN_SECRETS_REFUSED);
    });

    it("leaves a folder beside them alone", async () => {
        expect(await ownDataRefusal("local-filesystem", local(path.join(root, "run")), { subPath: "other" })).toBeNull();
    });
});
