/**
 * Lint Guard: every backup-facing sweep over storage adapters filters by role.
 *
 * A storage adapter is either a backup destination or a directory source. Code that
 * enumerates "all storage adapters" to work with *backups* - storage statistics, listing
 * cache warmup, integrity checks - has to exclude sources, otherwise a source tree gets
 * counted as consumed backup space, walked every hour, and scanned for backups it will
 * never hold. That was the original bug this guard exists to prevent from returning: the
 * role column existed for a while and almost nothing consulted it.
 *
 * The health check is the deliberate exception - a source that is unreachable matters just
 * as much as a destination that is.
 *
 * Run with: pnpm test tests/unit/lint-guards/storage-role-filter.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_DIR = path.resolve(__dirname, "../../../src");

/**
 * Files allowed to enumerate storage adapters without a role filter, with the reason.
 * Adding an entry here is a decision, not a formality - say why the sweep is role-blind.
 */
const ROLE_BLIND_ALLOWED: Record<string, string> = {
    "services/system/healthcheck-service.ts":
        "Health checks cover both roles on purpose - an unreachable source breaks the next backup.",
    "app/api/adapters/route.ts":
        "The listing endpoint serves both roles; callers narrow it with the optional role parameter.",
};

function collectFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectFiles(full, acc);
        else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
}

interface Violation {
    file: string;
    line: number;
    content: string;
}

describe("Lint Guard: storage adapter sweeps carry a role filter", () => {
    it("never queries every storage adapter without narrowing the role", () => {
        const violations: Violation[] = [];

        for (const file of collectFiles(SRC_DIR)) {
            const relative = path.relative(SRC_DIR, file).replace(/\\/g, "/");
            if (ROLE_BLIND_ALLOWED[relative]) continue;

            const lines = fs.readFileSync(file, "utf-8").split("\n");
            lines.forEach((line, index) => {
                // A `where` clause selecting the storage type. Adapter implementations
                // declare `type: "storage"` as a property of the adapter object itself -
                // those sit inside no `where`, so requiring one filters them out.
                if (!/where:\s*\{[^}]*type:\s*["']storage["']/.test(line)) return;
                if (/storageRole/.test(line)) return;
                violations.push({ file: relative, line: index + 1, content: line.trim() });
            });
        }

        expect(violations, violations.map(v => `${v.file}:${v.line} → ${v.content}`).join("\n")).toEqual([]);
    });

    it("keeps the allow-list honest - every entry still exists", () => {
        for (const relative of Object.keys(ROLE_BLIND_ALLOWED)) {
            expect(fs.existsSync(path.join(SRC_DIR, relative)), `${relative} is allow-listed but gone`).toBe(true);
        }
    });
});
