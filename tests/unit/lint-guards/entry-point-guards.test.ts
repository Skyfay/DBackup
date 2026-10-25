// @vitest-environment node
/**
 * Every API route handler and every Server Action checks a permission before it reads anything, or
 * is one of the few entry points that are open on purpose. The tenant filter only narrows a query to
 * the tenant of the request, it never asks whether the caller may read that tenant's records at all.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");
const API = path.join(SRC, "app/api");
const ACTIONS = path.join(SRC, "app/actions");

/** The calls that decide whether a caller may go on. */
const GUARD = /\b(checkPermissionWithContext|checkAnyPermissionWithContext|checkPermission|checkPlatformAdmin|hasPermissionWithContext|getUserPermissions|hasPermission|tenantRouteAccess|requireConfigRestorer|assertMayReadFormConfig)\s*\(/;

/**
 * The route handlers that check no permission, each with why. A new one is added here only with a
 * reason the developer guide or src/CLAUDE.md names.
 */
const OPEN_ROUTES: Record<string, string> = {
    "adapters/dropbox/callback GET": "OAuth callback, bound to the person and tenant by its state",
    "adapters/google-drive/callback GET": "OAuth callback, bound to the person and tenant by its state",
    "adapters/onedrive/callback GET": "OAuth callback, bound to the person and tenant by its state",
    "auth/error/error GET": "redirect of a sign-in error, reads nothing",
    "auth/sso-link-callback GET": "compares the session with the token minted before the redirect",
    "avatar/[userId] GET": "findVisibleAvatar answers only who may see the person (maySeePicture)",
    "health GET": "Docker health check, public",
    "internal/rate-limit-config GET": "read by the middleware, holds no tenant data",
    "login-image GET": "the picture of the login page, public",
    "login/provider POST": "the login page, names a provider and never a tenant",
    "settings/database/download POST": "a platform admin with a session only, stricter than any permission",
    "settings/database/download GET": "a platform admin with a session only, stricter than any permission",
    "setup/restore POST": "answers only while no account exists",
    "setup/restore/apply POST": "answers only while no account exists",
    "storage/public-download GET": "a single-use link, its maker is asked again (makerMayDownload)",
    "system/timezone GET": "every signed-in caller, one setting of the instance",
    "tenants/[id]/logo GET": "mayViewTenantLogo answers only who may see the tenant",
    "user/avatar POST": "@no-permission-required, the own picture",
    "user/avatar DELETE": "@no-permission-required, the own picture",
    "user/preferences GET": "@no-permission-required, the own preferences",
};

/**
 * The reads a handler may make before its check: the type of a connection, which decides which
 * permission it checks. Nothing else of the record leaves before the check.
 */
const TYPE_LOOKUPS = new Set(["getAdapterType", "getAdapterTypes", "providedConnection"]);

function files(dir: string, match: (name: string) => boolean): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return files(full, match);
        return match(entry.name) ? [full] : [];
    });
}

/** The top level functions of a file by name, with their text up to the next one. */
function functionsOf(code: string): Map<string, string> {
    const starts = [...code.matchAll(/^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+)\s*=\s*(?:async\s*)?\(/gm)];
    return new Map(starts.map((start, index) => [
        start[1] ?? start[2],
        code.slice(start.index, index + 1 < starts.length ? starts[index + 1].index : code.length),
    ]));
}

/** Where a function, or a helper of the same file it calls, checks first, -1 for never. */
function guardAt(name: string, functions: Map<string, string>, seen = new Set<string>()): number {
    const body = functions.get(name);
    if (body === undefined || seen.has(name)) return -1;
    seen.add(name);
    const direct = body.search(GUARD);
    let best = direct;
    for (const helper of functions.keys()) {
        if (helper === name) continue;
        const call = body.search(new RegExp(`\\b${helper}\\s*\\(`));
        if (call >= 0 && guardAt(helper, functions, seen) >= 0 && (best < 0 || call < best)) best = call;
    }
    return best;
}

/** The names a file imports from the services or the Prisma client, which read data. */
function readers(code: string): string[] {
    const names: string[] = [];
    for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(@\/services\/[^"]+|@\/lib\/prisma)"/g)) {
        for (const part of match[1].split(",")) {
            const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
            if (name && !part.trim().startsWith("type ")) names.push(name);
        }
    }
    return names;
}

const routeHandlers = files(API, (name) => name === "route.ts").flatMap((file) => {
    const code = fs.readFileSync(file, "utf8");
    const route = path.relative(API, path.dirname(file));
    const functions = functionsOf(code);
    return [...code.matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((match) => ({
        key: `${route} ${match[1]}`,
        body: functions.get(match[1]) ?? "",
        guard: guardAt(match[1], functions),
        readers: readers(code),
    }));
});

describe("the API routes", () => {
    it("check a permission in every handler, or are open on purpose", () => {
        // The handlers are found at all, so an empty list below means something.
        expect(routeHandlers.length).toBeGreaterThan(100);
        const unguarded = routeHandlers.filter((handler) => handler.guard < 0 && !(handler.key in OPEN_ROUTES)).map((handler) => handler.key);
        expect(unguarded, "Check a permission first, or add the handler to OPEN_ROUTES with the reason it is open").toEqual([]);
    });

    it("keep the list of open routes to handlers that exist and still check nothing", () => {
        const known = new Map(routeHandlers.map((handler) => [handler.key, handler]));
        const stale = Object.keys(OPEN_ROUTES).filter((key) => !known.has(key) || known.get(key)!.guard >= 0);
        expect(stale).toEqual([]);
    });

    it("read nothing but the type of a connection before the check", () => {
        const early = routeHandlers.flatMap((handler) => {
            if (handler.guard < 0) return [];
            return handler.readers
                .filter((name) => !TYPE_LOOKUPS.has(name))
                .filter((name) => {
                    const at = handler.body.search(new RegExp(`\\b${name}\\s*[.(]`));
                    return at >= 0 && at < handler.guard;
                })
                .map((name) => `${handler.key} reads ${name}`);
        });
        expect(early, "Move the read below the permission check").toEqual([]);
    });
});

describe("the Server Actions", () => {
    it("check a permission in every exported action, or say why it needs none", () => {
        const unguarded = files(ACTIONS, (name) => name.endsWith(".ts")).flatMap((file) => {
            const code = fs.readFileSync(file, "utf8");
            const functions = functionsOf(code);
            return [...code.matchAll(/^export async function (\w+)/gm)].flatMap((match) => {
                const before = code.slice(0, match.index).trimEnd();
                const doc = before.endsWith("*/") ? before.slice(before.lastIndexOf("/**")) : "";
                if (doc.includes("@no-permission-required")) return [];
                return guardAt(match[1], functions) >= 0 ? [] : [`${path.relative(ACTIONS, file)} ${match[1]}`];
            });
        });
        expect(unguarded, "Call checkPermission first, or annotate the action with @no-permission-required and the reason").toEqual([]);
    });
});
