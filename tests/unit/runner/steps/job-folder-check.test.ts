// @vitest-environment node
/**
 * A run of a customer on a destination another tenant shares writes into `tenants/<its id>/<job>`
 * there, not into `<job>`. The check of DBackup's own data looked at the folder of the job as if it
 * lay at the root of the destination, so a link at `tenants/<id>/<job>` into the data folder of
 * DBackup was never seen. Checked on real folders with links.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/lib/crypto", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/crypto")>()),
    decryptConfig: (config: unknown) => config,
}));

const { jobFolderRefusal } = await import("@/lib/runner/steps/job-folder-check");
const { OWN_DATA_REFUSED } = await import("@/lib/adapters/own-data");

let root: string;
let shared: string;
const env = { url: process.env.DATABASE_URL, certs: process.env.CERTS_DIR, tmp: process.env.TMPDIR };

beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "job-folder-check-")));
    const dataDir = path.join(root, "data");
    shared = path.join(root, "shared");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(root, "certs"), { recursive: true });
    fs.mkdirSync(path.join(shared, "tenants", "acme"), { recursive: true });
    fs.mkdirSync(path.join(shared, "Nightly"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "dbackup.db"), "");
    // The folder of the customer's job is a link into the data folder of DBackup.
    fs.symlinkSync(dataDir, path.join(shared, "tenants", "acme", "Nightly"));
    process.env.DATABASE_URL = `file:${path.join(dataDir, "dbackup.db")}`;
    process.env.CERTS_DIR = path.join(root, "certs");
    // The temporary folder of DBackup, a folder of its own here, since the others lie in the one of the system.
    fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
    process.env.TMPDIR = path.join(root, "tmp");
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (env.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = env.url;
    if (env.certs === undefined) delete process.env.CERTS_DIR;
    else process.env.CERTS_DIR = env.certs;
    if (env.tmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = env.tmp;
});

beforeEach(() => {
    // No configuration backup on a Local Filesystem.
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);
});

describe("the folder a run of a customer writes into on a shared destination", () => {
    const config = () => ({ basePath: shared });

    it("is checked where the files really land, below the folder of the customer", async () => {
        await expect(jobFolderRefusal("local-filesystem", config(), "nas", "Nightly", "acme")).resolves.toBe(OWN_DATA_REFUSED);
        await expect(jobFolderRefusal("local-filesystem", config(), "nas", "Nightly/chain-2026-10-01", "acme")).resolves.toBe(OWN_DATA_REFUSED);
    });

    it("stays the folder of the job at the root for the tenant of the destination", async () => {
        await expect(jobFolderRefusal("local-filesystem", config(), "nas", "Nightly")).resolves.toBeNull();
    });

    it("passes the job of another customer, whose folder holds no link", async () => {
        await expect(jobFolderRefusal("local-filesystem", config(), "nas", "Nightly", "globex")).resolves.toBeNull();
    });
});
