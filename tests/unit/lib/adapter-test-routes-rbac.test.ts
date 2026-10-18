import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  checkPermissionWithContext: vi.fn(),
  headers: vi.fn(),
  registryGet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: () => mocks.headers(),
}));

vi.mock("@/lib/auth/access-control", () => ({
  getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
  checkPermissionWithContext: (...args: unknown[]) => mocks.checkPermissionWithContext(...args),
  hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
  tenantOf: (ctx: { tenantId: string }) => ctx.tenantId,
}));

vi.mock("@/lib/core/registry", () => ({
  registry: {
    get: (...args: unknown[]) => mocks.registryGet(...args),
  },
}));

vi.mock("@/lib/adapters", () => ({
  registerAdapters: vi.fn(),
}));

vi.mock("@/lib/adapters/config-resolver", () => ({
  overlayCredentialsOnConfig: vi.fn(),
  withoutBinaryPaths: (config: Record<string, unknown>) => config,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    adapterConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/logging/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/errors")>()),
  wrapError: vi.fn(),
}));

const { POST: testConnection } = await import("@/app/api/adapters/test-connection/route");
const { POST: accessCheck } = await import("@/app/api/adapters/access-check/route");

const routes = [
  ["test-connection", testConnection],
  ["access-check", accessCheck],
] as const;

// A config of a form runs as it came, so trying one needs the right to change connections of the kind.
const adapterPermissions = [
  ["mariadb", PERMISSIONS.SOURCES.WRITE],
  ["redis", PERMISSIONS.SOURCES.WRITE],
  ["generic-webhook", PERMISSIONS.NOTIFICATIONS.WRITE],
  ["teams", PERMISSIONS.NOTIFICATIONS.WRITE],
  ["gotify", PERMISSIONS.NOTIFICATIONS.WRITE],
  ["ntfy", PERMISSIONS.NOTIFICATIONS.WRITE],
  ["telegram", PERMISSIONS.NOTIFICATIONS.WRITE],
  ["twilio-sms", PERMISSIONS.NOTIFICATIONS.WRITE],
] as const;

describe.each(routes)("POST /api/adapters/%s RBAC", (_name, post) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockReturnValue(new Headers());
    mocks.getAuthContext.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      isPlatformAdmin: false,
      tenantId: "default",
    });
    mocks.registryGet.mockReturnValue(undefined);
  });

  it.each(adapterPermissions)("requires the right to change connections of the kind for %s", async (adapterId, permission) => {
    await post({
      json: async () => ({ adapterId, config: {} }),
    } as any);

    expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      permission,
    );
  });
});
