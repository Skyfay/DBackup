import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { PERMISSIONS, Permission, AVAILABLE_PERMISSIONS } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AuthenticationError, PermissionError, wrapError } from "@/lib/errors";
import { apiKeyService } from "@/services/api-key-service";

const log = logger.child({ module: "AccessControl" });

// ============================================================================
// Auth Context Types
// ============================================================================

export interface AuthContext {
  userId: string;
  permissions: string[];
  isSuperAdmin: boolean;
  authMethod: "session" | "apikey";
  apiKeyId?: string;
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

/**
 * Get authentication context from either a session cookie or an API key.
 * Tries session first, then falls back to API key from Authorization header.
 *
 * @param headersObj - The request headers object
 * @returns AuthContext if authenticated, null if no auth present
 * @throws ApiKeyError if API key is found but invalid/disabled/expired
 */
export async function getAuthContext(headersObj: Headers): Promise<AuthContext | null> {
  // 1. Try session-based auth first
  try {
    const session = await auth.api.getSession({ headers: headersObj });
    if (session?.user) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { group: true },
      });

      if (user?.group) {
        const isSuperAdmin = user.group.name === "SuperAdmin";
        const permissions = isSuperAdmin
          ? AVAILABLE_PERMISSIONS.map((p) => p.id)
          : (() => {
              try {
                return JSON.parse(user.group.permissions) as string[];
              } catch {
                return [];
              }
            })();

        return {
          userId: user.id,
          permissions,
          isSuperAdmin,
          authMethod: "session",
        };
      }
    }
  } catch (_error) {
    log.debug("Session auth check failed, trying API key");
  }

  // 2. Try API key auth
  const bearerToken = extractBearerToken(headersObj);
  if (!bearerToken) {
    return null;
  }

  // validate() throws ApiKeyError for disabled/expired keys (re-thrown to caller)
  const validated = await apiKeyService.validate(bearerToken);
  if (!validated) {
    return null;
  }

  return {
    userId: validated.userId,
    permissions: validated.permissions,
    isSuperAdmin: false, // API keys never get SuperAdmin bypass
    authMethod: "apikey",
    apiKeyId: validated.id,
  };
}

/**
 * Check a specific permission against an AuthContext.
 * Throws PermissionError if the context does not have the required permission.
 */
export function checkPermissionWithContext(ctx: AuthContext, permission: Permission): void {
  if (ctx.isSuperAdmin) {
    return; // SuperAdmin bypass (session only, API keys never have isSuperAdmin)
  }

  if (!ctx.permissions.includes(permission)) {
    throw new PermissionError(permission);
  }
}

export async function getCurrentUserWithGroup() {
    // Wrap to prevent crash if headers/session fails significantly
    let session;
    try {
        session = await auth.api.getSession({
            headers: await headers()
        });
    } catch (error) {
        log.error("Session check failed", {}, wrapError(error));
        return null;
    }

    if (!session?.user) {
        return null;
    }

    let user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { group: true }
    });

    // Auto-promote first user logic (Self-Healing)
    if (user && !user.groupId) {
        const userCount = await prisma.user.count();
        if (userCount === 1) {
            log.info("Auto-promoting first user to SuperAdmin");
            const allPermissions = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

            const group = await prisma.group.upsert({
                where: { name: "SuperAdmin" },
                update: { permissions: JSON.stringify(allPermissions) },
                create: {
                    name: "SuperAdmin",
                    permissions: JSON.stringify(allPermissions)
                }
            });

            user = await prisma.user.update({
                where: { id: user.id },
                data: { groupId: group.id },
                include: { group: true }
            });
        }
    }

    return user;
}

export async function checkPermission(permission: Permission) {
    const user = await getCurrentUserWithGroup();

    if (!user) {
        throw new AuthenticationError();
    }

    if (!user.group) {
        throw new PermissionError(permission, { context: { reason: "No group assigned" } });
    }

    // SuperAdmin always has all permissions
    if (user.group.name === "SuperAdmin") {
        return user;
    }

    let permissions: string[] = [];
    try {
        permissions = JSON.parse(user.group.permissions);
    } catch (error) {
        log.error("Failed to parse group permissions", { groupId: user.group.id }, wrapError(error));
    }

    if (!permissions.includes(permission)) {
        throw new PermissionError(permission);
    }

    return user;
}

export async function getUserPermissions(): Promise<string[]> {
    const user = await getCurrentUserWithGroup();
    if (!user || !user.group) return [];

    // SuperAdmin always has all permissions
    if (user.group.name === "SuperAdmin") {
        return AVAILABLE_PERMISSIONS.map(p => p.id);
    }

    try {
        return JSON.parse(user.group.permissions);
    } catch {
        return [];
    }
}

export async function hasPermission(permission: Permission): Promise<boolean> {
    try {
        await checkPermission(permission);
        return true;
    } catch {
        return false;
    }
}
