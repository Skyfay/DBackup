import { auth } from "@/lib/auth";
import { requestHeaders } from "@/lib/server/request-headers";
import type { Permission } from "@/lib/auth/permissions";
import { ALL_TENANTS_PERMISSIONS, EVERY_PERMISSION, PLATFORM_ADMIN_ROLE, allTenantsPermissionsOf, opensAllTenants, permissionsIn, reachesTenant, type OwnerMembership, type PlatformGroupGrant } from "@/lib/auth/owner-permissions";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { AuthenticationError, PermissionError, wrapError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { ALL_TENANTS, HOME_TENANT_ID } from "@/lib/tenant/home";
import { apiKeyService } from "@/services/auth/api-key-service";
import { ensureFullAccessGroup } from "@/services/user/group-service";

const log = logger.child({ module: "AccessControl" });

// ============================================================================
// Auth Context Types
// ============================================================================

export interface AuthContext {
  userId: string;
  /** What the caller may do in its tenant, see `permissionsIn`. Every permission for a platform admin. */
  permissions: string[];
  /** Sees every tenant and the platform. Never through an API key. */
  isPlatformAdmin: boolean;
  authMethod: "session" | "apikey";
  apiKeyId?: string;
  /** The tenant the request acts in, null for an account that belongs to no tenant yet and in All tenants. */
  tenantId: string | null;
  /**
   * A platform admin looks at every tenant at once. The request reads every tenant and changes none
   * of them, and its permissions are `ALL_TENANTS_PERMISSIONS`.
   */
  allTenants: boolean;
  /** The platform group of a session, none for a platform admin, an API key or someone without one. */
  platformGroup?: { id: string; name: string } | null;
  /** Whether the session may open All tenants: a platform admin, or a platform group that opens it. */
  opensAllTenants?: boolean;
}

// ============================================================================
// Unified Auth Context (Session OR API Key)
// ============================================================================

/**
 * Extract Bearer token from Authorization header.
 * Returns null if no valid Bearer token is present.
 */
function extractBearerToken(headersObj: Headers): string | null {
  const authHeader = headersObj.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim();
}

const MEMBERSHIPS = {
  select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } },
  orderBy: { createdAt: "asc" },
} as const;

/** The platform group of an account as its rights read it. */
const PLATFORM_GROUP = {
  select: { id: true, name: true, platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } },
} as const;

/** All tenants only means something once there is more than the home tenant. */
async function severalTenants(): Promise<boolean> {
  return (await prisma.tenant.count()) > 1;
}

/**
 * The tenant a session works in: the one it picked while that still holds, else the home tenant,
 * else the first the account belongs to, else the first its platform group reaches. A platform
 * admin may pick any tenant that exists, or All tenants, where they start while there is more than
 * one. A platform group opens the tenants of its scope, and All tenants when it reaches all of them.
 */
async function pickTenant(picked: string | null | undefined, memberships: readonly OwnerMembership[], isPlatformAdmin: boolean, platformGroup: PlatformGroupGrant | null): Promise<string | null> {
  const mayOpenAll = isPlatformAdmin || opensAllTenants(platformGroup);
  if (picked === ALL_TENANTS) {
    if (mayOpenAll && (await severalTenants())) return ALL_TENANTS;
  } else if (picked) {
    if (memberships.some((membership) => membership.tenantId === picked)) return picked;
    if ((isPlatformAdmin || reachesTenant(platformGroup, picked)) && (await prisma.tenant.findUnique({ where: { id: picked }, select: { id: true } }))) return picked;
  }
  if (mayOpenAll && (await severalTenants())) return ALL_TENANTS;
  if (isPlatformAdmin) return HOME_TENANT_ID;
  if (memberships.some((membership) => membership.tenantId === HOME_TENANT_ID)) return HOME_TENANT_ID;
  if (memberships[0]) return memberships[0].tenantId;
  if (platformGroup?.allTenants) return HOME_TENANT_ID;
  return platformGroup?.tenants[0]?.tenantId ?? null;
}

/**
 * The first account of an installation becomes its platform admin with the full access role in the
 * home tenant, also when the role or the membership got lost.
 */
async function promoteFirstUser(userId: string): Promise<boolean> {
  if ((await prisma.user.count()) !== 1) return false;
  log.info("Making the first user the platform admin");
  await prisma.$transaction(async (tx) => {
    const groupId = await ensureFullAccessGroup(tx);
    await tx.user.update({ where: { id: userId }, data: { platformRole: PLATFORM_ADMIN_ROLE } });
    await tx.tenantMembership.upsert({
      where: { userId_tenantId: { userId, tenantId: HOME_TENANT_ID } },
      create: { userId, tenantId: HOME_TENANT_ID, groupId },
      update: {},
    });
  });
  return true;
}

async function sessionContext(userId: string, pickedTenantId: string | null | undefined): Promise<AuthContext | null> {
  const load = () => prisma.user.findUnique({ where: { id: userId }, select: { id: true, platformRole: true, memberships: MEMBERSHIPS, platformGroup: PLATFORM_GROUP } });
  let user = await load();
  if (!user) return null;
  if (!user.platformRole && user.memberships.length === 0 && (await promoteFirstUser(user.id))) {
    user = await load();
    if (!user) return null;
  }

  const isPlatformAdmin = user.platformRole === PLATFORM_ADMIN_ROLE;
  const platformGroup = isPlatformAdmin ? null : user.platformGroup;
  const picked = await pickTenant(pickedTenantId, user.memberships, isPlatformAdmin, platformGroup);
  const allTenants = picked === ALL_TENANTS;
  const tenantId = allTenants ? null : picked;
  const allTenantsPermissions = () => (isPlatformAdmin ? [...ALL_TENANTS_PERMISSIONS] : allTenantsPermissionsOf(user.memberships, platformGroup));
  return {
    userId: user.id,
    permissions: allTenants
      ? allTenantsPermissions()
      : isPlatformAdmin ? [...EVERY_PERMISSION] : permissionsIn(user.memberships, tenantId, platformGroup),
    isPlatformAdmin,
    authMethod: "session",
    tenantId,
    allTenants,
    platformGroup: platformGroup ? { id: platformGroup.id, name: platformGroup.name } : null,
    opensAllTenants: isPlatformAdmin || opensAllTenants(platformGroup),
  };
}

async function resolveAuthContext(headersObj: Headers): Promise<AuthContext | null> {
  // 1. Try session-based auth first
  try {
    const session = await auth.api.getSession({ headers: headersObj });
    if (session?.user) {
      const activeTenantId = (session.session as { activeTenantId?: string | null }).activeTenantId;
      const ctx = await sessionContext(session.user.id, activeTenantId);
      if (ctx) return ctx;
    }
  } catch (_error) {
    log.debug("Session auth check failed, trying API key");
  }

  // 2. Try API key auth
  const bearerToken = extractBearerToken(headersObj);
  if (!bearerToken) {
    return null;
  }

  // A key is found by its hash before its tenant is known. validate() throws ApiKeyError for
  // disabled/expired keys (re-thrown to caller).
  const validated = await runAsSystem(() => apiKeyService.validate(bearerToken));
  if (!validated) {
    return null;
  }

  return {
    userId: validated.userId,
    permissions: validated.permissions,
    isPlatformAdmin: false, // API keys never act as a platform admin
    authMethod: "apikey",
    apiKeyId: validated.id,
    tenantId: validated.tenantId,
    allTenants: false,
  };
}

/**
 * The contexts of the requests being handled, by their headers. A request reads its context once,
 * however many queries ask for its tenant. One map for the whole process, like the tenant scope.
 */
const CONTEXTS_KEY = Symbol.for("dbackup.authContexts");
type ContextsGlobal = typeof globalThis & { [CONTEXTS_KEY]?: WeakMap<Headers, Promise<AuthContext | null>> };

function contexts(): WeakMap<Headers, Promise<AuthContext | null>> {
  const holder = globalThis as ContextsGlobal;
  holder[CONTEXTS_KEY] ??= new WeakMap();
  return holder[CONTEXTS_KEY];
}

/**
 * Get authentication context from either a session cookie or an API key.
 * Tries session first, then falls back to API key from Authorization header.
 *
 * @param headersObj - The request headers object
 * @returns AuthContext if authenticated, null if no auth present
 * @throws ApiKeyError if API key is found but invalid/disabled/expired
 */
export function getAuthContext(headersObj: Headers): Promise<AuthContext | null> {
  // Only an object can be a key of the map, anything else is read every time.
  if (typeof headersObj !== "object" || headersObj === null) return resolveAuthContext(headersObj);
  const known = contexts().get(headersObj);
  if (known) return known;
  const resolved = resolveAuthContext(headersObj);
  contexts().set(headersObj, resolved);
  return resolved;
}

/** Forgets the context of a request, for an action that switched its tenant and reads on. */
export function forgetAuthContext(headersObj: Headers): void {
  contexts().delete(headersObj);
}

/**
 * Check a specific permission against an AuthContext.
 * Throws PermissionError if the context does not have the required permission.
 */
export function checkPermissionWithContext(ctx: AuthContext, permission: Permission): void {
  if (!hasPermissionWithContext(ctx, permission)) {
    throw new PermissionError(permission);
  }
}

/**
 * Passes when the context holds at least one of the permissions.
 *
 * For read-only endpoints that serve two kinds of user: listing a backup's contents is part of
 * restoring it and of downloading from it, and neither permission should imply the other.
 */
export function checkAnyPermissionWithContext(ctx: AuthContext, permissions: readonly Permission[]): void {
  if (!permissions.some((permission) => hasPermissionWithContext(ctx, permission))) {
    throw new PermissionError(permissions.join(" or "));
  }
}

/**
 * Non-throwing form of `checkPermissionWithContext`, for a route that already
 * passed its own guard and needs to decide how much to do rather than whether
 * to answer at all.
 */
export function hasPermissionWithContext(ctx: Pick<AuthContext, "isPlatformAdmin" | "allTenants" | "permissions">, permission: Permission): boolean {
  // In All tenants a platform admin holds what that view allows, it changes no tenant.
  return (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
}

/** The tenant a caller works in, refusing an account that belongs to none and All tenants. */
export function tenantOf(ctx: { tenantId: string | null }): string {
  if (!ctx.tenantId) throw new PermissionError("a tenant");
  return ctx.tenantId;
}

// ============================================================================
// The viewer of a page or a Server Action
// ============================================================================

/** The signed-in person of a page or a Server Action, with what they may do in their tenant. */
export type Viewer = NonNullable<Awaited<ReturnType<typeof loadUser>>> & {
  isPlatformAdmin: boolean;
  tenantId: string | null;
  /** A platform admin in All tenants, see `AuthContext.allTenants`. */
  allTenants: boolean;
  permissions: string[];
  /** Their group in the tenant, none for a platform admin who is no member there. */
  role: { id: string; name: string } | null;
  /** Their platform group, none for a platform admin or someone without one. */
  platformGroup: { id: string; name: string } | null;
  /** May open All tenants: a platform admin, or a platform group that reaches every tenant and sees something there. */
  opensAllTenants: boolean;
};

function loadUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

async function roleOf(userId: string, tenantId: string | null) {
  if (!tenantId) return null;
  const membership = await prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { group: { select: { id: true, name: true } } },
  });
  return membership?.group ?? null;
}

/** The context of the session of the request being handled, never one of an API key. */
async function sessionOfRequest(): Promise<AuthContext | null> {
  let headersObj: Headers;
  try {
    headersObj = await requestHeaders();
  } catch (error) {
    log.error("Session check failed", {}, wrapError(error));
    return null;
  }
  const ctx = await getAuthContext(headersObj).catch((error: unknown) => {
    log.error("Session check failed", {}, wrapError(error));
    return null;
  });
  return ctx?.authMethod === "session" ? ctx : null;
}

export async function getViewer(): Promise<Viewer | null> {
  const ctx = await sessionOfRequest();
  if (!ctx) return null;
  const [user, role] = await Promise.all([loadUser(ctx.userId), roleOf(ctx.userId, ctx.tenantId)]);
  if (!user) return null;
  return {
    ...user,
    isPlatformAdmin: ctx.isPlatformAdmin,
    tenantId: ctx.tenantId,
    allTenants: ctx.allTenants,
    permissions: ctx.permissions,
    role,
    platformGroup: ctx.platformGroup ?? null,
    opensAllTenants: ctx.opensAllTenants ?? ctx.isPlatformAdmin,
  };
}

/** The id of the session the request comes with, which ending someone's sessions keeps. */
export async function currentSessionId(): Promise<string | null> {
    try {
        const session = await auth.api.getSession({ headers: await requestHeaders() });
        return session?.session.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Refuses anyone without the permission. A list passes with any one of them, for an action two
 * kinds of people take, like a change of an account by the admin of its tenant or by whoever
 * manages the accounts of the platform.
 */
export async function checkPermission(permission: Permission | readonly Permission[]): Promise<Viewer> {
    const viewer = await getViewer();

    if (!viewer) {
        throw new AuthenticationError();
    }

    const wanted: readonly Permission[] = typeof permission === "string" ? [permission] : permission;
    if (!wanted.some((entry) => hasPermissionWithContext(viewer, entry))) {
        throw new PermissionError(wanted.join(" or "));
    }

    return viewer;
}

/** Refuses anyone but a signed-in platform admin, for what decides over every tenant. */
export async function checkPlatformAdmin(): Promise<Viewer> {
    const viewer = await getViewer();
    if (!viewer) throw new AuthenticationError();
    if (!viewer.isPlatformAdmin) throw new PermissionError("platform admin");
    return viewer;
}

export async function getUserPermissions(): Promise<string[]> {
    const viewer = await getViewer();
    return viewer?.permissions ?? [];
}

export async function hasPermission(permission: Permission): Promise<boolean> {
    try {
        await checkPermission(permission);
        return true;
    } catch {
        return false;
    }
}
