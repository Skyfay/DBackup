/**
 * Regression tests for GHSA adapter secret disclosure.
 *
 * Verifies that GET /api/adapters never returns decrypted values for fields
 * in SENSITIVE_KEYS to callers who only have read/view permission.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Encryption key for AES-256-GCM (64 hex chars = 32 bytes) ─────────────────
const VALID_KEY = "a".repeat(64);

// Set the key before any module is imported so crypto functions work throughout
vi.stubEnv("ENCRYPTION_KEY", VALID_KEY);

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn().mockResolvedValue({ userId: "user-readonly" }),
    checkPermissionWithContext: vi.fn(),
}));

vi.mock("next/headers", () => ({
    headers: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/adapters", () => ({
    registerAdapters: vi.fn(),
}));

vi.mock("@/services/audit-service", () => ({
    auditService: { log: vi.fn() },
}));

vi.mock("@/lib/core/audit-types", () => ({
    AUDIT_ACTIONS: {},
    AUDIT_RESOURCES: {},
}));

vi.mock("@/lib/auth/permissions", () => ({
    PERMISSIONS: {
        DESTINATIONS: { READ: "destinations:read", WRITE: "destinations:write" },
        SOURCES: { VIEW: "sources:view", WRITE: "sources:write" },
        NOTIFICATIONS: { READ: "notifications:read", WRITE: "notifications:write" },
    },
}));

vi.mock("@/lib/adapters/credential-validation", () => ({
    validateCredentialAssignments: vi.fn(),
}));

const mockFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findMany: (...args: any[]) => mockFindMany(...args),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
        },
    },
}));

// Import real crypto (not mocked) and route after all vi.mock calls
import { encryptConfig } from "@/lib/crypto";
const { GET } = await import("@/app/api/adapters/route");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/adapters – secret disclosure regression", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("does not return decrypted secretAccessKey / accessKeyId for storage adapters", async () => {
        const encryptedConfig = JSON.stringify(encryptConfig({
            endpoint: "https://s3.example.com",
            bucket: "my-bucket",
            accessKeyId: "AKIAIOSFODNN7EXAMPLE",
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        }));

        mockFindMany.mockResolvedValue([
            { id: "1", type: "storage", name: "S3 Prod", adapterId: "s3-generic", config: encryptedConfig, createdAt: new Date() },
        ]);

        const req = new NextRequest("http://localhost/api/adapters?type=storage");
        const res = await GET(req);
        expect(res.status).toBe(200);

        const body = await res.json();
        const config = JSON.parse(body[0].config);

        expect(config.bucket).toBe("my-bucket");
        expect(config.endpoint).toBe("https://s3.example.com");
        expect(config.accessKeyId).toBeUndefined();
        expect(config.secretAccessKey).toBeUndefined();
    });

    it("does not return decrypted clientSecret / refreshToken for OAuth storage adapters", async () => {
        const encryptedConfig = JSON.stringify(encryptConfig({
            clientId: "my-client-id",
            clientSecret: "POC_CLIENT_SECRET_SHOULD_NOT_LEAK",
            refreshToken: "POC_REFRESH_TOKEN_SHOULD_NOT_LEAK",
            folderId: "root",
        }));

        mockFindMany.mockResolvedValue([
            { id: "2", type: "storage", name: "Google Drive", adapterId: "google-drive", config: encryptedConfig, createdAt: new Date() },
        ]);

        const req = new NextRequest("http://localhost/api/adapters?type=storage");
        const res = await GET(req);
        const body = await res.json();
        const config = JSON.parse(body[0].config);

        expect(config.clientId).toBe("my-client-id");
        expect(config.folderId).toBe("root");
        expect(config.clientSecret).toBeUndefined();
        expect(config.refreshToken).toBeUndefined();
    });

    it("does not return decrypted password / privateKey for database adapters", async () => {
        const encryptedConfig = JSON.stringify(encryptConfig({
            host: "db.internal",
            user: "dbuser",
            password: "super-secret-db-pass",
            privateKey: "-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----",
        }));

        mockFindMany.mockResolvedValue([
            { id: "3", type: "database", name: "Prod Postgres", adapterId: "postgres", config: encryptedConfig, createdAt: new Date() },
        ]);

        const req = new NextRequest("http://localhost/api/adapters?type=database");
        const res = await GET(req);
        const body = await res.json();
        const config = JSON.parse(body[0].config);

        expect(config.host).toBe("db.internal");
        expect(config.user).toBe("dbuser");
        expect(config.password).toBeUndefined();
        expect(config.privateKey).toBeUndefined();
    });

    it("does not return decrypted webhookUrl / token for notification adapters", async () => {
        const encryptedConfig = JSON.stringify(encryptConfig({
            webhookUrl: "https://hooks.slack.com/services/SECRET_TOKEN",
            token: "xoxb-some-slack-bot-token",
            channel: "#alerts",
        }));

        mockFindMany.mockResolvedValue([
            { id: "4", type: "notification", name: "Slack Alerts", adapterId: "slack", config: encryptedConfig, createdAt: new Date() },
        ]);

        const req = new NextRequest("http://localhost/api/adapters?type=notification");
        const res = await GET(req);
        const body = await res.json();
        const config = JSON.parse(body[0].config);

        expect(config.channel).toBe("#alerts");
        expect(config.webhookUrl).toBeUndefined();
        expect(config.token).toBeUndefined();
    });

    it("returns 400 when type parameter is missing", async () => {
        const req = new NextRequest("http://localhost/api/adapters");
        const res = await GET(req);
        expect(res.status).toBe(400);
    });
});
