/**
 * Every command of the lab, in the order of the menu of `pnpm lab`. Each is a script of its own in
 * package.json as well, `pnpm lab:<name>`, right below `lab`, which `tests/unit/lab/commands.test.ts`
 * checks. Picked from the menu, a command asks for what it would otherwise take as an argument.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { ask, bold, confirm } from "../../scripts/toolbox/cli.mjs";
import { devDatabaseFile, loadAppEnv } from "./app-env";
import { EXAMPLE_CONFIG, USER_CONFIG, loadConfig, type LabConfig } from "./config";
import { runOrThrow } from "./docker";
import { clean, down, up } from "./environment";
import { generatePassword } from "./password";
import { provision } from "./provision";
import { status } from "./status";
import { currentWorkspace, folderName } from "./workspace";

export interface LabCommand {
    name: string;
    group: string;
    title: string;
    /** `fromMenu` is true when the command was picked from the menu, so it may ask. */
    run: (args: string[], fromMenu: boolean) => Promise<void>;
}

const write = (line: string) => process.stdout.write(`${line}\n`);
const flag = (args: string[], name: string) => args.includes(`--${name}`);
const option = (args: string[], name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};
/** A flag given on the command line, or a yes to the question when the menu ran the command. */
const choose = async (args: string[], name: string, fromMenu: boolean, question: string) =>
    flag(args, name) || (fromMenu && await confirm(question, false));

/** Writes ~/.config/dbackup/lab.json from the example, with the admin given and a new password. */
async function init(args: string[]): Promise<void> {
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

async function seed(config: LabConfig, history: boolean): Promise<void> {
    loadAppEnv();
    // Imported only now: Prisma and the encryption read DATABASE_URL and ENCRYPTION_KEY on load.
    const { seed: run } = await import("./seed");
    const workspace = currentWorkspace();
    write(`Seeding ${devDatabaseFile()} for workspace ${workspace} from ${config.source}`);
    for (const line of await run(config, workspace, { history })) write(`  ${line}`);
    write(`Sign in as ${config.admin.email}`);
}

async function check(withJobs: boolean): Promise<void> {
    loadAppEnv();
    const { checkConnections, runJobs } = await import("./check");
    const report = (results: { ok: boolean; name: string; message: string }[], what: string) => {
        for (const result of results) write(`${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(40)} ${result.message}`);
        const failed = results.filter((result) => !result.ok).length;
        write(failed ? `${failed} of ${results.length} ${what} failed` : `All ${results.length} ${what} passed`);
        if (failed) process.exitCode = 1;
    };
    report(await checkConnections(), "connections");
    if (withJobs) report(await runJobs((name) => write(`running ${name}`)), "jobs");
}

async function reset(config: LabConfig, empty: boolean, history: boolean): Promise<void> {
    loadAppEnv();
    const file = devDatabaseFile();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${file}${suffix}`, { force: true });
    write(`Removed ${file}, stop pnpm dev first if it ran on it`);
    await runOrThrow("pnpm", ["exec", "prisma", "migrate", "deploy"], { inherit: true });
    if (!empty) await seed(config, history);
}

/** The workspaces with a folder of backups on this machine, for the menu to offer. */
function workspacesWithBackups(config: LabConfig): string[] {
    const folder = path.join(config.storageRoot, "workspaces");
    const names = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
    return existsSync(path.join(config.storageRoot, "main")) ? ["main", ...names] : names;
}

export const COMMANDS: LabCommand[] = [
    {
        name: "status", group: "Lab", title: "What runs, what is missing and what to do next",
        // A report, so it ends with 0 also when it lists problems, and pnpm adds no error line after it.
        run: async () => {
            await status(loadConfig(), currentWorkspace(), write);
        },
    },
    {
        name: "up", group: "Lab", title: "Start the lab and load the test data",
        run: async (args, fromMenu) => {
            const full = await choose(args, "full", fromMenu, "Also the versions between oldest and newest (profile full)?");
            if (!await up(loadConfig(), write, full)) process.exitCode = 1;
        },
    },
    {
        name: "down", group: "Lab", title: "Stop the lab",
        run: async (args, fromMenu) => down(loadConfig(), write, await choose(args, "volumes", fromMenu, "Also delete the data of the containers?")),
    },
    {
        name: "seed", group: "Dev database", title: "Fill the dev database of this workspace",
        run: async (args, fromMenu) => seed(loadConfig(), await choose(args, "history", fromMenu, "Add 30 days of sample runs too?")),
    },
    {
        name: "check", group: "Dev database", title: "Test every lab connection, optionally run every job",
        run: async (args, fromMenu) => check(await choose(args, "run", fromMenu, "Also run every lab job once? That takes a few minutes")),
    },
    {
        name: "reset", group: "Dev database", title: "Start the dev database over from the migrations",
        run: async (args, fromMenu) => {
            if (fromMenu && !await confirm(`This deletes ${path.basename(devDatabaseFile())} of this workspace. Go on?`, false)) return;
            const empty = await choose(args, "empty", fromMenu, "Leave it without a user, for the first start or a configuration restore?");
            await reset(loadConfig(), empty, flag(args, "history"));
        },
    },
    {
        name: "clean", group: "Housekeeping", title: "Remove the backups of a workspace",
        run: async (args, fromMenu) => {
            const config = loadConfig();
            let workspace = args[0];
            if (!workspace && fromMenu) {
                const known = workspacesWithBackups(config);
                if (known.length) write(`Workspaces with backups here: ${known.join(", ")}`);
                workspace = await ask("Workspace whose backups to remove: ");
                if (workspace && !await confirm(`Remove every backup of ${workspace}, here and on every storage server?`, false)) return;
            }
            if (!workspace) throw new Error("Name the workspace whose backups to remove, like pnpm lab:clean ui-performance");
            await clean(config, write, folderName(workspace));
        },
    },
    {
        name: "provision", group: "Housekeeping", title: "Set up a native server with its databases",
        run: async (args, fromMenu) => {
            const config = loadConfig();
            const natives = config.natives.map((host) => host.name);
            let name = args[0];
            if (!name && fromMenu) name = natives.length === 1 ? natives[0] : await ask(`Server to set up (${natives.join(", ")}): `);
            const host = config.natives.find((candidate) => candidate.name === name);
            if (!host) throw new Error(`Name a native server of the lab config to set up, one of: ${natives.join(", ") || "the config has none"}`);
            if (fromMenu && !await confirm(`Set up ${host.name} (${host.address}) as root now?`, false)) return;
            await provision(host, write);
        },
    },
    {
        name: "init", group: "Setup", title: "Write your lab config with a new admin password",
        run: async (args) => init(args),
    },
];

/** The menu, one numbered line per command below the heading of its group. */
export function menuLines(commands: LabCommand[]): string[] {
    const width = Math.max(...commands.map((command) => command.title.length));
    const lines: string[] = [];
    let group = "";
    commands.forEach((command, index) => {
        if (command.group !== group) {
            group = command.group;
            lines.push("", ` ${bold(group)}`);
        }
        const number = String(index + 1).padStart(String(commands.length).length);
        lines.push(`   ${number}) ${command.title.padEnd(width)}   pnpm lab:${command.name}`);
    });
    return lines;
}
