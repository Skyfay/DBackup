/**
 * Lint Guard: what root runs in the Docker image, root alone can change.
 *
 * The image has no USER, so the entrypoint and the HEALTHCHECK run as root, and the entrypoint
 * drops to PUID:PGID with gosu only for the app. The global pnpm folder /pnpm came first on PATH
 * and belonged to the runtime user, so the app could put a `curl` there and have the healthcheck
 * run it as root. The entrypoint also ran a check script as root that the runtime user owned.
 *
 * The same image installed the Prisma CLI with a global `pnpm add`, which resolved the packages
 * of the CLI fresh from the registry instead of from pnpm-lock.yaml, and they run at every start.
 *
 * Run with: pnpm test tests/unit/lint-guards/docker-image-root.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf-8");
const entrypoint = fs.readFileSync(path.join(ROOT, "docker-entrypoint.sh"), "utf-8");
const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
/** The global pnpm folder, not the store path under /root/.local/share/pnpm of the deps stage. */
const PNPM_FOLDER = /(^|[\s"'=:])\/pnpm(\/|\s|"|$)/m;

/** The Dockerfile with its continued lines joined, one instruction per line. */
const instructions = dockerfile.replace(/\\\n/g, " ").split("\n");

describe("lint guard: root in the Docker image", () => {
    it("puts no folder on PATH before the system ones", () => {
        expect(instructions.filter((line) => /^ENV\s+PATH[=\s]/.test(line))).toEqual([]);
        expect(dockerfile).not.toContain("PNPM_HOME");
        expect(dockerfile).not.toMatch(PNPM_FOLDER);
    });

    it("calls curl in the HEALTHCHECK by its full path", () => {
        const healthcheck = instructions.find((line) => line.startsWith("HEALTHCHECK"));
        expect(healthcheck).toBeDefined();
        const calls = [...healthcheck!.matchAll(/(\S*)curl\s/g)].map((m) => m[1]);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.filter((prefix) => prefix !== "/usr/bin/")).toEqual([]);
    });

    it("fixes PATH in the entrypoint before its first command", () => {
        const at = entrypoint.indexOf(`PATH=${SYSTEM_PATH}\nexport PATH\n`);
        expect(at).toBeGreaterThan(0);
        expect(at).toBeLessThan(entrypoint.indexOf("_resolve_secret()"));
        expect(entrypoint).not.toMatch(PNPM_FOLDER);
    });

    it("runs no script as root that the runtime user owns", () => {
        // Every script the entrypoint runs before gosu, by sh, has to be copied in without --chown
        // and outside /app, where the runtime user owns the folders.
        const beforeGosu = entrypoint.slice(0, entrypoint.indexOf('gosu "$PUID'));
        const scripts = [...beforeGosu.matchAll(/^\s*sh\s+(\S+)/gm)].map((m) => m[1]);
        expect(scripts.length).toBeGreaterThan(0);
        for (const script of scripts) {
            expect(script.startsWith("/app/"), script).toBe(false);
            const copies = instructions.filter((line) => line.startsWith("COPY") && line.trim().endsWith(` ${script}`));
            expect(copies, script).toHaveLength(1);
            expect(copies[0], script).not.toContain("--chown");
        }
    });

    it("installs no package outside the lockfile", () => {
        expect(dockerfile).not.toMatch(/\b(pnpm|npm|yarn)\s+(add|install|i)\s+(-g|--global)\b/);
        expect(dockerfile).not.toMatch(/\bpnpm\s+add\b/);
        expect(dockerfile).toContain("pnpm install --frozen-lockfile");
        expect(dockerfile).toContain("COPY --from=prisma-cli --link /opt/prisma-cli /opt/prisma-cli");
    });

    it("runs the migrations with the CLI copied out of the lockfile install", () => {
        expect(dockerfile).toContain("exec /usr/local/bin/node /opt/prisma-cli/node_modules/prisma/build/index.js");
        expect(entrypoint).toMatch(/gosu "\$PUID:\$PGID" prisma migrate deploy/);
    });

    it("pins the version of sqlpackage", () => {
        expect(dockerfile).toMatch(/ARG SQLPACKAGE_VERSION=\d+\.\d+\.\d+\n/);
        expect(dockerfile).toContain('microsoft.sqlpackage --version "${SQLPACKAGE_VERSION}"');
    });

    it("keeps env files out of the build context, apart from the example", () => {
        const lines = fs.readFileSync(path.join(ROOT, ".dockerignore"), "utf-8").split("\n").map((l) => l.trim());
        expect(lines).toContain(".env*");
        expect(lines.indexOf("!.env.example")).toBeGreaterThan(lines.indexOf(".env*"));
        expect(lines.filter((l) => l.startsWith("!.env") && l !== "!.env.example")).toEqual([]);
    });
});
