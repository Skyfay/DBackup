// @vitest-environment node
/**
 * The copy of the Prisma CLI out of the frozen install of the deps stage, which the runner image
 * runs `prisma migrate deploy` with. It replaced a global `pnpm add`, which resolved the packages
 * of the CLI fresh from the registry instead of from pnpm-lock.yaml.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "copy-prisma-cli.js");
const { closure, copy } = createRequire(import.meta.url)(SCRIPT) as {
    closure: (nodeModules: string, name?: string) => string[];
    copy: (nodeModules: string, target: string) => string[];
};

let dir = "";
const modules = () => path.join(dir, "project", "node_modules");

type Manifest = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> };

/** A package in the pnpm layout, .pnpm/<entry>/node_modules/<name>, with links to the entries it depends on. */
function pkg(entry: string, name: string, manifest: Manifest = {}, links: Record<string, string> = {}) {
    const at = path.join(modules(), ".pnpm", entry, "node_modules", name);
    mkdirSync(at, { recursive: true });
    writeFileSync(path.join(at, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    writeFileSync(path.join(at, "index.js"), "module.exports = 1\n");
    for (const [dependency, target] of Object.entries(links)) {
        const link = path.join(modules(), ".pnpm", entry, "node_modules", dependency);
        symlinkSync(path.relative(path.dirname(link), path.join(modules(), ".pnpm", target, "node_modules", dependency)), link);
    }
}

/** The CLI with one dependency, which has one of its own, and an optional peer the project happens to have. */
function project() {
    pkg("prisma@1.0.0_typescript@5.0.0", "prisma", { dependencies: { c12: "1.0.0" }, peerDependencies: { typescript: ">=5" }, peerDependenciesMeta: { typescript: { optional: true } } }, { c12: "c12@1.0.0", typescript: "typescript@5.0.0" });
    pkg("c12@1.0.0", "c12", { dependencies: { defu: "^6.0.0" }, optionalDependencies: { fsevents: "^2.0.0" } }, { defu: "defu@6.1.7" });
    pkg("defu@6.1.7", "defu");
    pkg("typescript@5.0.0", "typescript");
    symlinkSync(path.join(".pnpm", "prisma@1.0.0_typescript@5.0.0", "node_modules", "prisma"), path.join(modules(), "prisma"));
}

beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "prisma-cli-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("the Prisma CLI of the image, copied out of the lockfile install", () => {
    it("takes the CLI and everything it depends on, and leaves out an optional peer and a dependency for another platform", () => {
        project();
        expect(closure(modules())).toEqual(["prisma@1.0.0_typescript@5.0.0", "c12@1.0.0", "defu@6.1.7"]);
    });

    it("refuses an install that lacks a dependency the CLI needs", () => {
        project();
        rmSync(path.join(modules(), ".pnpm", "c12@1.0.0", "node_modules", "defu"));
        expect(() => closure(modules())).toThrow("c12 needs defu, which is not installed beside it");
    });

    it("copies the packages with their relative links and drops the links to packages it left out", () => {
        project();
        const target = path.join(dir, "opt");
        copy(modules(), target);
        const store = path.join(target, "node_modules", ".pnpm");
        expect(readlinkSync(path.join(target, "node_modules", "prisma"))).toBe(path.join(".pnpm", "prisma@1.0.0_typescript@5.0.0", "node_modules", "prisma"));
        expect(readlinkSync(path.join(store, "c12@1.0.0", "node_modules", "defu"))).toBe(path.join("..", "..", "defu@6.1.7", "node_modules", "defu"));
        expect(existsSync(path.join(store, "typescript@5.0.0"))).toBe(false);
        expect(existsSync(path.join(store, "prisma@1.0.0_typescript@5.0.0", "node_modules", "typescript"))).toBe(false);
        // The copy works without the project, which is the point of it.
        rmSync(path.join(dir, "project"), { recursive: true });
        const loads = `require(${JSON.stringify(path.join(store, "c12@1.0.0", "node_modules", "c12", "index.js"))}); require(${JSON.stringify(path.join(store, "c12@1.0.0", "node_modules", "defu"))})`;
        expect(() => execFileSync(process.execPath, ["-e", loads])).not.toThrow();
    });

    it("finds the real packages of the CLI that it loads on every command, at the versions of the lockfile", () => {
        const entries = closure(path.join(ROOT, "node_modules"));
        const lockfile = readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
        expect(entries[0]).toMatch(/^prisma@/);
        for (const name of ["@prisma+engines@", "@prisma+config@", "c12@", "effect@", "jiti@", "dotenv@"]) {
            expect(entries.some((entry) => entry.startsWith(name)), name).toBe(true);
        }
        expect(entries.some((entry) => entry.startsWith("typescript@"))).toBe(false);
        for (const entry of entries) {
            const [, name, version] = /^(@?[^@]+)@([^_]+)/.exec(entry.replace("+", "/")) ?? [];
            expect(lockfile, entry).toContain(`${name}@${version}`);
        }
    });
});
