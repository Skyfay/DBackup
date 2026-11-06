// @vitest-environment node
/**
 * A request without a context is answered by `unauthorized()` from `src/lib/server/unauthorized.ts`,
 * which names why its API key was turned away, a disabled or expired key or one whose tenant
 * switched API keys off. A route that writes its own 401 tells the caller only "Unauthorized", or
 * nothing at all, and the owner of the key cannot see what to fix.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

/** The 401 answers that are about something else than the login of the request. */
const OWN_401 = new Set([
    // A download link that is spent or ran out, its token is the login.
    "app/api/storage/public-download/route.ts",
    // OneDrive refused to refresh the token of the connection.
    "app/api/system/filesystem/onedrive/route.ts",
    // The answer itself.
    "lib/server/unauthorized.ts",
]);

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

describe("the answer to a request without a login", () => {
    it("comes from unauthorized() in every route, with the reason of a turned away key", () => {
        const own = [...sourceFiles(path.join(SRC, "app")), ...sourceFiles(path.join(SRC, "lib/server"))]
            .map((file) => path.relative(SRC, file))
            .filter((file) => !OWN_401.has(file))
            .filter((file) => /status:\s*401\b/.test(fs.readFileSync(path.join(SRC, file), "utf8")));
        expect(own, "Answer with unauthorized() from @/lib/server/unauthorized").toEqual([]);
    });
});
