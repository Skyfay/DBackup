// @vitest-environment node
/**
 * Every connection `pnpm lab:seed` adds still saves now that a stored config is checked against the
 * schema of its adapter: each one goes through the form schema like the seed does and then through
 * the check of `createAdapter`, for a lab on another Docker host with a native server, and for a lab
 * on the Docker of this machine.
 */
import { describe, expect, it, vi } from "vitest";
import type { ConnectionSpec } from "../../../lab/src/seed/records";
import type { LabConfig } from "../../../lab/src/config";

vi.mock("../../../lab/src/seed/records", () => ({ ensureCredential: vi.fn(async (name: string) => `cred:${name}`) }));
vi.mock("../../../lab/src/seed/setup", () => ({
    ensureFolder: (folder: string) => folder,
    ensureFilesFolder: (folder: string) => folder,
    ensureLocalSqlite: async (file: string) => file,
}));
vi.mock("../../../lab/src/servers", () => ({
    ensureS3Bucket: async () => undefined,
    ensureStorageFolders: async () => undefined,
    ensureGotifyToken: async () => "gotify-token",
}));

const { seedSources } = await import("../../../lab/src/seed/sources");
const { seedChannels, seedDestinations } = await import("../../../lab/src/seed/destinations");
const { ADAPTER_DEFINITIONS } = await import("@/lib/adapters/definitions");
const { buildConnectionFormSchema } = await import("@/components/adapter/connection-form-schema");
const { assertConfigFitsSchema } = await import("@/lib/adapters/config-check");

const login = { user: "dbackup", port: 2222, password: "lab-password" };
const REMOTE: LabConfig = {
    source: "test",
    admin: { name: "Admin", email: "admin@dbackup.lab", password: "lab-password" },
    storageRoot: "/mnt/storage/dbackup",
    profile: "full",
    docker: { name: "lab-debian", docker: "lab-debian", address: "100.100.30.1", ssh: { user: "root", port: 22, password: "x" } },
    natives: [{ name: "ubuntu", address: "100.100.30.2", login }],
};
const LOCAL: LabConfig = { ...REMOTE, docker: { name: "this machine", docker: "default", address: "127.0.0.1" }, natives: [] };

/** What the seed adds for a lab config, every source, destination and channel. */
async function seededSpecs(config: LabConfig): Promise<ConnectionSpec[]> {
    const specs: ConnectionSpec[] = [];
    const note = async (spec: ConnectionSpec) => { specs.push(spec); };
    await seedSources(config, note, []);
    await seedDestinations(config, "main", note, []);
    await seedChannels(config, "main", note, []);
    return specs;
}

describe.each([["on another Docker host", REMOTE], ["on the Docker of this machine", LOCAL]])("the connections of the lab %s", (_where, config) => {
    it("each fit the schema of their adapter the way createAdapter checks them", async () => {
        const specs = await seededSpecs(config);
        expect(specs.length).toBeGreaterThan(15);
        for (const spec of specs) {
            const definition = ADAPTER_DEFINITIONS.find((entry) => entry.id === spec.adapterId)!;
            const { config: formConfig } = buildConnectionFormSchema(definition).parse({ name: spec.name, adapterId: spec.adapterId, config: spec.config });
            expect(() => assertConfigFitsSchema(spec.adapterId, formConfig), spec.name).not.toThrow();
        }
    });
});
