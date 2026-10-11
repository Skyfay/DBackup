/**
 * The commands of the dev lab, run through `pnpm lab:<command>`. See lab/README.md.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { EXAMPLE_CONFIG, REPO_ROOT, USER_CONFIG, findConfigFile, loadConfig, type LabConfig } from "./config";
import { clean, down, status, up } from "./environment";
import { provision } from "./provision";
import { runOrThrow } from "./docker";
import { generatePassword } from "./password";
import { currentWorkspace, folderName } from "./workspace";

const write = (line: string) => process.stdout.write(`${line}\n`);
const flag = (args: string[], name: string) => args.includes(`--${name}`);
const option = (args: string[], name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

/** Writes ~/.config/dbackup/lab.json from the example, with the admin given and a new password. */
function init(args: string[]): void {
    if (existsSync(USER_CONFIG)) {
        write(`${USER_CONFIG} exists already, nothing changed.`);
        return;
    }
    const example = JSON.parse(readFileSync(EXAMPLE_CONFIG, "utf8"));
    const name = option(args, "name") ?? example.admin.name;
    const email = option(args, "email") ?? example.admin.email;
    example.admin = { name, email, password: generatePassword(name, email) };
    const storageRoot = option(args, "storage");
    if (storageRoot) example.storageRoot = path.resolve(storageRoot);
    mkdirSync(path.dirname(USER_CONFIG), { recursive: true });
    writeFileSync(USER_CONFIG, `${JSON.stringify(example, null, 4)}\n`, { mode: 0o600 });
    write(`Wrote ${USER_CONFIG}`);
    write(`Sign in as ${email} with ${example.admin.password}`);
}

/** The SQLite file of DATABASE_URL, relative paths being relative to the Prisma schema. */
function devDatabaseFile(): string {
    const url = process.env.DATABASE_URL ?? "file:./dev.db";
    const file = url.replace(/^file:/, "").split("?")[0];
    return path.isAbsolute(file) ? file : path.join(REPO_ROOT, "prisma", file);
}

function loadEnv(): void {
    // The app logs every record it creates. Here only problems are worth a line, LAB_LOG_LEVEL shows more.
    process.env.LOG_LEVEL = process.env.LAB_LOG_LEVEL ?? "warn";
    const envFile = path.join(REPO_ROOT, ".env");
    if (existsSync(envFile)) process.loadEnvFile(envFile);
}

async function check(args: string[]): Promise<void> {
    loadEnv();
    const { checkConnections, runJobs } = await import("./check");
    const report = (results: { ok: boolean; name: string; message: string }[], what: string) => {
        for (const result of results) write(`${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(40)} ${result.message}`);
        const failed = results.filter((result) => !result.ok).length;
        write(failed ? `${failed} of ${results.length} ${what} failed` : `All ${results.length} ${what} passed`);
        if (failed) process.exitCode = 1;
    };
    report(await checkConnections(), "connections");
    if (flag(args, "run")) report(await runJobs((name) => write(`running ${name}`)), "jobs");
}

async function runSeed(config: LabConfig, args: string[]): Promise<void> {
    loadEnv();
    // Imported only now: Prisma and the encryption read DATABASE_URL and ENCRYPTION_KEY on load.
    const { seed } = await import("./seed");
    const workspace = currentWorkspace();
    write(`Seeding ${devDatabaseFile()} for workspace ${workspace} from ${config.source}`);
    for (const line of await seed(config, workspace, { history: flag(args, "history") })) write(`  ${line}`);
    write(`Sign in as ${config.admin.email}`);
}

async function reset(config: LabConfig, args: string[]): Promise<void> {
    loadEnv();
    const file = devDatabaseFile();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${file}${suffix}`, { force: true });
    write(`Removed ${file}, stop pnpm dev first if it ran on it`);
    await runOrThrow("pnpm", ["exec", "prisma", "migrate", "deploy"], { inherit: true });
    if (!flag(args, "empty")) await runSeed(config, args);
}

async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    switch (command) {
        case "init":
            return init(args);
        case "up":
            if (!await up(loadConfig(), write, flag(args, "full"))) process.exitCode = 1;
            return;
        case "down":
            return down(loadConfig(), write, flag(args, "volumes"));
        case "status":
            write(`Config: ${findConfigFile()}`);
            return status(loadConfig(), write);
        case "seed":
            return runSeed(loadConfig(), args);
        case "check":
            return check(args);
        case "reset":
            return reset(loadConfig(), args);
        case "clean":
            if (!args[0]) throw new Error("Name the workspace whose backups to remove, like pnpm lab:clean ui-performance");
            return clean(loadConfig(), write, folderName(args[0]));
        case "provision": {
            const config = loadConfig();
            const host = config.hosts[args[0] ?? ""];
            if (!host) throw new Error(`Name a host of the lab config to set up, one of: ${Object.keys(config.hosts).join(", ")}`);
            return provision(host, write);
        }
        default:
            write("Commands: init, up [--full], down [--volumes], status, seed [--history], check [--run], reset [--empty] [--history], provision <host>, clean <workspace>");
            process.exitCode = command ? 1 : 0;
    }
}

main()
    // The seed creates jobs, which starts the scheduler of the app in this process.
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
