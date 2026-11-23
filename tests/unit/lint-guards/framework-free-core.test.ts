// @vitest-environment node
/**
 * `src/lib` and `src/services` stay free of Next.js, so the backup engine and the business rules
 * keep working under another server. Responses are the standard `Response`, revalidation belongs
 * to the Server Action, and the headers of a request come from `requestHeaders()`, the one module
 * that asks the framework for them.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");
const ALLOWED = new Set(["lib/server/request-headers.ts"]);

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

describe("the core of the app", () => {
    it("never imports Next.js outside the request headers module", () => {
        const files = [...sourceFiles(path.join(SRC, "lib")), ...sourceFiles(path.join(SRC, "services"))];
        const importers = files.filter((file) => {
            if (ALLOWED.has(path.relative(SRC, file))) return false;
            const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            return /(from\s+|import\(\s*)["']next(\/[^"']*)?["']/.test(code);
        });
        expect(importers.map((file) => path.relative(SRC, file)), "Keep Next.js in src/app, or read the request through requestHeaders()").toEqual([]);
    });
});
