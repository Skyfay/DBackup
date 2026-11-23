import { describe, it, expect, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

// Whether the code that runs now is a platform admin with a session, see `mayReachHost`.
const mocks = vi.hoisted(() => ({ mayReachHost: vi.fn(async () => true) }));
vi.mock("@/lib/adapters/config-resolver", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/config-resolver")>()),
    mayReachHost: () => mocks.mayReachHost(),
}));

const { updateAdapterFlags } = await import("@/services/adapters/adapter-service");

const adapter = (id: string, type: string, metadata: Record<string, unknown> | null = null, storageRole: string | null = null) => ({
    id,
    name: `conn-${id}`,
    type,
    storageRole,
    metadata: metadata ? JSON.stringify(metadata) : null,
});

/**
 * The rows the switch reads and writes. Every write is a compare-and-set on the metadata as it was
 * read, so the metadata here is what the connection holds afterwards.
 */
function stored(rows: Array<{ id: string; metadata: string | null }>) {
    const byId = new Map(rows.map((row) => [row.id, { ...row }]));
    prismaMock.adapterConfig.findMany.mockResolvedValue(rows as never);
    prismaMock.adapterConfig.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => {
        const row = byId.get(where.id);
        return row ? { name: `conn-${row.id}`, metadata: row.metadata } : null;
    }) as never);
    prismaMock.adapterConfig.updateMany.mockImplementation((async ({ where, data }: { where: { id: string; metadata: string | null }; data: { metadata: string } }) => {
        const row = byId.get(where.id);
        if (!row || row.metadata !== where.metadata) return { count: 0 };
        row.metadata = data.metadata;
        return { count: 1 };
    }) as never);
    const metadataOf = (id: string) => JSON.parse(byId.get(id)?.metadata ?? "null");
    /** Changes a row after the switch read it, like a run that pins a host key meanwhile. */
    metadataOf.changeTo = (id: string, metadata: Record<string, unknown>) => { byId.get(id)!.metadata = JSON.stringify(metadata); };
    return metadataOf;
}

describe("updateAdapterFlags", () => {
    it("switches the setting and keeps the rest of the metadata", async () => {
        const metadataOf = stored([adapter("pg", "database", { engineVersion: "16.4" })]);

        const result = await updateAdapterFlags(["pg"], { healthNotificationsDisabled: true });

        expect(result.succeeded).toEqual(["pg"]);
        expect(metadataOf("pg")).toEqual({ engineVersion: "16.4", healthNotificationsDisabled: true });
    });

    it("keeps a host key pinned after the connections were read", async () => {
        const metadataOf = stored([adapter("nas", "storage", { airGapped: false }, "DESTINATION")]);
        const pin = { host: "nas", port: 22, type: "ssh-ed25519", key: "a2V5" };
        metadataOf.changeTo("nas", { airGapped: false, sshHostKeys: [pin] });

        await updateAdapterFlags(["nas"], { skipVerification: true });

        expect(metadataOf("nas")).toEqual({ airGapped: false, sshHostKeys: [pin], skipVerification: true });
    });

    it("refuses to leave a destination out of restores, which only databases are", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([adapter("pg", "database"), adapter("s3", "storage")] as never);

        const result = await updateAdapterFlags(["pg", "s3"], { isRestoreExcluded: true });

        expect(result.succeeded).toEqual(["pg"]);
        expect(result.failed).toEqual([{ id: "s3", name: "conn-s3", error: "Only database connections are restore targets." }]);
    });

    it("marks destinations air-gapped and switches their integrity checks, but never those of a directory source", async () => {
        const metadataOf = stored([
            adapter("nas", "storage", { healthNotificationsDisabled: true }, "DESTINATION"),
            adapter("photos", "storage", null, "SOURCE"),
            adapter("pg", "database"),
        ]);

        const result = await updateAdapterFlags(["nas", "photos", "pg"], { airGapped: true });

        expect(result.succeeded).toEqual(["nas"]);
        expect(result.failed).toEqual([
            { id: "photos", name: "conn-photos", error: "Only a backup destination can be air-gapped." },
            { id: "pg", name: "conn-pg", error: "Only a backup destination can be air-gapped." },
        ]);
        expect(metadataOf("nas")).toEqual({ healthNotificationsDisabled: true, airGapped: true });
        expect(metadataOf("photos")).toBeNull();

        const checks = await updateAdapterFlags(["photos"], { skipVerification: true });
        expect(checks.failed).toEqual([{ id: "photos", name: "conn-photos", error: "Only backup destinations hold backups to check." }]);
    });

    it("refuses health check notifications for a notification channel and reports a missing connection", async () => {
        stored([adapter("discord", "notification")]);

        const result = await updateAdapterFlags(["discord", "gone"], { healthNotificationsDisabled: false });

        expect(result.succeeded).toEqual([]);
        expect(result.failed.map((entry) => entry.id)).toEqual(["discord", "gone"]);
        expect(prismaMock.adapterConfig.updateMany).not.toHaveBeenCalled();
    });

    it("switches nothing on a connection that reaches the server DBackup runs on for anyone but a platform admin", async () => {
        const files = { ...adapter("files", "storage", null, "DESTINATION"), adapterId: "local-filesystem", config: JSON.stringify({ basePath: "/srv/backups" }), primaryCredentialId: null, sshCredentialId: null };
        const nas = { ...adapter("nas", "storage", null, "DESTINATION"), adapterId: "sftp", config: JSON.stringify({ host: "nas" }), primaryCredentialId: null, sshCredentialId: null };
        const metadataOf = stored([files, nas]);
        mocks.mayReachHost.mockResolvedValue(false);

        const result = await updateAdapterFlags(["files", "nas"], { skipVerification: true });

        expect(result.succeeded).toEqual(["nas"]);
        expect(result.failed).toEqual([{ id: "files", name: "conn-files", error: "Local Filesystem reaches the server DBackup runs on, which only a platform admin adds." }]);
        expect(metadataOf("nas")).toEqual({ skipVerification: true });
        expect(metadataOf("files")).toBeNull();
    });
});
