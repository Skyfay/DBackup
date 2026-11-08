// @vitest-environment node
/**
 * Pages, layouts, Server Actions and API routes reach the database only through the services. A
 * query in a route skips the rules of its service, and the tenant filter of the services would
 * have to be repeated in every route that reads on its own.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");
const APP = path.join(SRC, "app");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

describe("the app layer", () => {
    it("never imports the Prisma client", () => {
        const readers = sourceFiles(APP).filter((file) => {
            const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            return /from\s+["'](@\/lib\/prisma|(\.\.\/)+lib\/prisma)["']|import\(\s*["']@\/lib\/prisma["']\s*\)/.test(code);
        });
        expect(readers.map((file) => path.relative(SRC, file)), "Move the query into a service under src/services").toEqual([]);
    });
});
