// @vitest-environment node
/**
 * The app reads the address of a request only from the header the custom server sets. A client can
 * write anything into X-Forwarded-For and X-Real-IP, and reading them directly let it get around the
 * rate limits and put any address into the audit log.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

describe("the address of a request", () => {
    it("is never read from X-Forwarded-For or X-Real-IP in the app", () => {
        const readers = sourceFiles(SRC).filter((file) => {
            // Comments may name the headers, code may not read them.
            const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            return /["'`]x-(forwarded-for|real-ip)["'`]/i.test(code);
        });
        expect(readers.map((file) => path.relative(SRC, file)), "Read clientAddress() from @/lib/core/client-address instead").toEqual([]);
    });
});
