// @vitest-environment node
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "check-encryption-key.sh");

/** Runs the check with POSIX `sh`, as the entrypoint of the image does, with the key given or none. */
function check(key?: string) {
    const env = { ...process.env };
    delete env.ENCRYPTION_KEY;
    if (key !== undefined) env.ENCRYPTION_KEY = key;
    const result = spawnSync("sh", [SCRIPT], { env, encoding: "utf8" });
    return { status: result.status, out: result.stdout };
}

const GOOD = "0123456789abcdefABCDEF0123456789abcdef0123456789abcdef0123456789";

describe("the check of ENCRYPTION_KEY before the migrations", () => {
    it("passes a key of 64 hex characters in either case", () => {
        expect(GOOD).toHaveLength(64);
        expect(check(GOOD)).toEqual({ status: 0, out: "" });
    });

    it("refuses a missing key", () => {
        const { status, out } = check();
        expect(status).toBe(1);
        expect(out).toContain("ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32");
    });

    it("refuses an empty key as missing", () => {
        const { status, out } = check("");
        expect(status).toBe(1);
        expect(out).toContain("ENCRYPTION_KEY is required.");
    });

    it.each([
        ["too short", GOOD.slice(0, 63)],
        ["too long", `${GOOD}0`],
        ["the base64 a generator for another secret gives", "c2VjcmV0LXRoYXQtaXMtbm90LWhleC1idXQtYmFzZTY0LWVuY29kZWQ="],
    ])("refuses a key that is %s", (_name, key) => {
        const { status, out } = check(key);
        expect(status).toBe(1);
        expect(out).toContain("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
    });

    it("refuses 64 characters that are not all hex", () => {
        const { status, out } = check(`${GOOD.slice(0, 63)}g`);
        expect(status).toBe(1);
        expect(out).toContain("ENCRYPTION_KEY must hold hex characters only (0-9, a-f)");
    });

    it("refuses a key with a space in it", () => {
        const { status } = check(`${GOOD.slice(0, 31)} ${GOOD.slice(32)}`);
        expect(status).toBe(1);
    });

    it("prints the same sentences as the check of Node at startup", () => {
        const validation = readFileSync(path.join(ROOT, "src/lib/server/env-validation.ts"), "utf8");
        const script = readFileSync(SCRIPT, "utf8");
        const sentences = [...script.matchAll(/fail "([^"]+)"/g)].map((m) => m[1]);
        expect(sentences).toHaveLength(3);
        for (const sentence of sentences) expect(validation).toContain(sentence);
    });

    it("runs in the entrypoint before the copy of the database and the migrations, and ships in the image", () => {
        const entrypoint = readFileSync(path.join(ROOT, "docker-entrypoint.sh"), "utf8");
        const at = entrypoint.indexOf("sh /app/scripts/check-encryption-key.sh");
        expect(at).toBeGreaterThan(entrypoint.indexOf("_resolve_secret ENCRYPTION_KEY\n"));
        expect(at).toBeLessThan(entrypoint.indexOf("backup-before-migrate.js"));
        expect(at).toBeLessThan(entrypoint.indexOf("prisma migrate deploy"));
        expect(readFileSync(path.join(ROOT, "Dockerfile"), "utf8")).toContain("/app/scripts/check-encryption-key.sh ./scripts/check-encryption-key.sh");
    });
});
