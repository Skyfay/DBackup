// @vitest-environment node
/**
 * A config of a form that reaches the server DBackup runs on, like SQLite in local mode pointed at
 * the database of DBackup, runs only for the platform: in the home tenant, in the system scope and
 * outside a request. All tenants and an account of no tenant act for no tenant and run none, which
 * the check let through before, since it read their missing tenant as the platform.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    ctx: null as null | { tenantId: string | null; allTenants: boolean },
}));

vi.mock("next/headers", () => ({ headers: () => mocks.headers() }));
vi.mock("@/lib/auth/access-control", () => ({ getAuthContext: async () => mocks.ctx }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: vi.fn() }));

const { assertConfigOffHost, mayReachHost, withoutBinaryPaths } = await import("@/lib/adapters/config-resolver");
const { runAsSystem, runAsTenant } = await import("@/lib/tenant/context");
const { HOME_TENANT_ID } = await import("@/lib/tenant/home");

const DBACKUP_DB = { mode: "local", path: "/app/data/dbackup.db" };
const inRequest = (ctx: { tenantId: string | null; allTenants: boolean } | null) => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.ctx = ctx;
};

describe("a config of a form that reaches the server DBackup runs on", () => {
    beforeEach(() => {
        mocks.headers.mockReset();
        mocks.ctx = null;
    });

    it("is refused in All tenants, which acts for no tenant", async () => {
        inRequest({ tenantId: null, allTenants: true });

        await expect(assertConfigOffHost("sqlite", DBACKUP_DB)).rejects.toBeInstanceOf(ValidationError);
        expect(await mayReachHost()).toBe(false);
    });

    it("is refused to an account of no tenant and in a customer's tenant", async () => {
        inRequest({ tenantId: null, allTenants: false });
        await expect(assertConfigOffHost("sqlite", DBACKUP_DB)).rejects.toThrow("SQLite in local mode");

        inRequest({ tenantId: "acme", allTenants: false });
        await expect(assertConfigOffHost("local-filesystem", { basePath: "/" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("runs in the home tenant, in the system scope and outside a request, so runs and checks keep working", async () => {
        inRequest({ tenantId: HOME_TENANT_ID, allTenants: false });
        await expect(assertConfigOffHost("sqlite", DBACKUP_DB)).resolves.toBeUndefined();

        await expect(runAsSystem(() => assertConfigOffHost("sqlite", DBACKUP_DB))).resolves.toBeUndefined();
        await expect(runAsTenant(HOME_TENANT_ID, () => assertConfigOffHost("sqlite", DBACKUP_DB))).resolves.toBeUndefined();
        await expect(runAsTenant("acme", () => assertConfigOffHost("sqlite", DBACKUP_DB))).rejects.toBeInstanceOf(ValidationError);

        // No request at all, like a script or the start of the server.
        mocks.headers.mockRejectedValue(new Error("headers was called outside a request scope"));
        await expect(assertConfigOffHost("sqlite", DBACKUP_DB)).resolves.toBeUndefined();
    });

    it("passes a config of a server of its own everywhere", async () => {
        inRequest({ tenantId: null, allTenants: true });

        await expect(assertConfigOffHost("mysql", { host: "db.acme", port: 3306 })).resolves.toBeUndefined();
    });
});

describe("a config of a form without its program", () => {
    it("drops every field that names a program to run, and keeps the rest", () => {
        expect(withoutBinaryPaths({ mode: "ssh", path: "/srv/app.db", sqliteBinaryPath: "/tmp/evil" })).toEqual({ mode: "ssh", path: "/srv/app.db" });
        expect(withoutBinaryPaths({ host: "fb.acme", firebirdBinaryPath: "/tmp/evil" })).toEqual({ host: "fb.acme" });
    });
});
