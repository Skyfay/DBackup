#!/usr/bin/env node
/**
 * Copies the Prisma CLI and the packages it needs out of a pnpm install into a folder of its own.
 *
 * The runner image runs `prisma migrate deploy` at every start but carries only the standalone
 * build, not the node_modules of the project. Copying the CLI out of the frozen install of the
 * deps stage keeps every package of it on the version and integrity hash of pnpm-lock.yaml, where
 * a global `pnpm add` resolved the dependencies fresh from the registry at every build.
 *
 * pnpm keeps each package in node_modules/.pnpm/<entry>/node_modules/<name>, beside links to the
 * packages it depends on. The CLI needs every entry reached through dependencies, optional
 * dependencies and the peers that are not optional. Each one is copied whole with its relative
 * links, and the links to entries left out, like the optional typescript peer, are dropped.
 *
 * Usage: node copy-prisma-cli.js <node_modules> <target>, run by the Dockerfile.
 * Plain Node without dependencies, like apply-pending-restore.js.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const CLI = "prisma";

/** The .pnpm entry a package folder lives in, from its real path. */
function entryOf(store, dir) {
    const relative = path.relative(store, dir);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${dir} is not a package of the pnpm store ${store}`);
    }
    return relative.split(path.sep)[0];
}

/** The packages one needs at runtime: its dependencies, the optional ones and the peers it cannot do without. */
function needs(pkg) {
    const meta = pkg.peerDependenciesMeta || {};
    const peers = Object.keys(pkg.peerDependencies || {}).filter((name) => !(meta[name] && meta[name].optional));
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...peers];
}

/** The .pnpm entries the CLI needs, the entry of the CLI itself first. */
function closure(nodeModules, name = CLI) {
    const store = fs.realpathSync(path.join(nodeModules, ".pnpm"));
    const entries = [];
    const seen = new Set();
    const queue = [fs.realpathSync(path.join(nodeModules, name))];
    while (queue.length > 0) {
        const dir = queue.shift();
        if (seen.has(dir)) continue;
        seen.add(dir);
        const entry = entryOf(store, dir);
        if (!entries.includes(entry)) entries.push(entry);
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        for (const dependency of needs(pkg)) {
            const link = path.join(store, entry, "node_modules", dependency);
            if (fs.existsSync(link)) {
                queue.push(fs.realpathSync(link));
            } else if (!(pkg.optionalDependencies && dependency in pkg.optionalDependencies)) {
                // An optional dependency for another platform is not installed, anything else missing is a broken install.
                throw new Error(`${pkg.name} needs ${dependency}, which is not installed beside it`);
            }
        }
    }
    return entries;
}

/** Removes the links of an entry that point at an entry the copy left out. */
function dropDanglingLinks(modules) {
    for (const name of fs.readdirSync(modules)) {
        const at = path.join(modules, name);
        const stat = fs.lstatSync(at);
        if (stat.isSymbolicLink()) {
            if (!fs.existsSync(at)) fs.unlinkSync(at);
        } else if (name.startsWith("@") && stat.isDirectory()) {
            dropDanglingLinks(at);
        }
    }
}

/** Copies the closure of the CLI to <target>/node_modules, with <target>/node_modules/prisma linked to it. */
function copy(nodeModules, target) {
    const store = fs.realpathSync(path.join(nodeModules, ".pnpm"));
    const entries = closure(nodeModules);
    const into = path.join(target, "node_modules", ".pnpm");
    for (const entry of entries) {
        fs.cpSync(path.join(store, entry), path.join(into, entry), { recursive: true, verbatimSymlinks: true });
    }
    for (const entry of entries) dropDanglingLinks(path.join(into, entry, "node_modules"));
    fs.symlinkSync(path.join(".pnpm", entries[0], "node_modules", CLI), path.join(target, "node_modules", CLI));
    return entries;
}

if (require.main === module) {
    const [nodeModules, target] = process.argv.slice(2);
    if (!nodeModules || !target) throw new Error("Usage: node copy-prisma-cli.js <node_modules> <target>");
    copy(nodeModules, target);
}

module.exports = { closure, copy };
