/**
 * Runs once before the lab tests: checks that the lab answers, migrates a database of their own
 * and fills it with every connection of the lab, through the seed of `pnpm lab:seed`. Removes
 * what the tests uploaded before and after the run.
 */

import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import net from "net";
import path from "path";
import type { TestProject } from "vitest/node";
import { REPO_ROOT, loadConfig, type LabConfig } from "../../../lab/src/config";
import { STORAGE, databasesOf } from "../../../lab/src/catalog";
import { clean } from "../../../lab/src/environment";
import { TEST_DATABASE, TEST_WORKSPACE, testEnvironment } from "./environment";
import type { LabState } from "./lab";

function answers(address: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ host: address, port, timeout: 5000 });
        const done = (ok: boolean) => {
            socket.destroy();
            resolve(ok);
        };
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}

/** Fails the run with what to do when a part of the lab does not answer, instead of a test failing on every connection. */
async function assertLabAnswers(config: LabConfig): Promise<void> {
    const probes: [string, string, number][] = [
        ["storage", config.place.storage.address, STORAGE.ssh.port],
        ["databases", config.place.databases.address, databasesOf(config.profile)[0].port],
    ];
    for (const [part, address, port] of probes) {
        if (!(await answers(address, port))) {
            throw new Error(`The ${part} of the dev lab do not answer at ${address}:${port}. Start the lab with pnpm lab:up, config ${config.source}.`);
        }
    }
}

function migrate(): void {
    rmSync(path.dirname(TEST_DATABASE), { recursive: true, force: true });
    mkdirSync(path.dirname(TEST_DATABASE), { recursive: true });
    execFileSync(path.join(REPO_ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${TEST_DATABASE}` },
        stdio: "pipe",
    });
}

export default async function setup(project: TestProject) {
    const config = loadConfig();
    await assertLabAnswers(config);
    migrate();

    // Prisma and the encryption of the app read these when their modules load, so the seed is
    // imported only now.
    Object.assign(process.env, testEnvironment());
    const quiet = () => undefined;
    await clean(config, quiet, TEST_WORKSPACE);
    const { seedConnections } = await import("../../../lab/src/seed/connections");
    const seeded = await seedConnections(config, TEST_WORKSPACE);

    const state: LabState = {
        workspace: TEST_WORKSPACE,
        sources: Object.fromEntries(seeded.sources),
        destinations: Object.fromEntries(seeded.destinations),
        channels: Object.fromEntries(seeded.channels),
    };
    project.provide("lab", state);

    return async () => {
        const { default: prisma } = await import("@/lib/prisma");
        await prisma.$disconnect();
        if (!process.env.LAB_KEEP) await clean(config, quiet, TEST_WORKSPACE);
    };
}
