/**
 * `pnpm lab:status`: what of the lab runs, what is missing and why, and what to run next. Checks
 * the containers of every part, the native hosts, the dev database of this workspace, the client
 * tools of this machine and what answers on port 3000.
 */

import net from "net";
import { loadAppEnv } from "./app-env";
import { GROUPS, type Group, type LabConfig, type NativeHost } from "./config";
import { DATABASES } from "./catalog";
import { describeDown, expectedServices, isUp, serviceStates, type ServiceState } from "./containers";
import { hasDataset } from "./datasets";
import { attempt, dockerArgs } from "./docker";
import { sshArgs } from "./provision";
import { checkApp, checkDevDatabase, checkTools, type Mark, type Row, type Section } from "./status-checks";

type Write = (line: string) => void;

const UP = "pnpm lab:up      starts what is missing and loads the test data";

const TITLES: Record<Group, string> = { databases: "Databases", storage: "Storage", notify: "Notification receivers" };

async function checkGroup(config: LabConfig, group: Group, states: Map<string, ServiceState>): Promise<Section> {
    const host = config.docker;
    const section: Section = { title: TITLES[group], rows: [], next: [] };
    const rows = await Promise.all(expectedServices(group, config.profile, states.keys()).map(async (entry): Promise<Row> => {
        const state = states.get(entry.service);
        const where = `${host.address}:${entry.port}`;
        if (!isUp(state)) {
            const detail = await describeDown(config, entry, state);
            if (!state || state.state !== "exited" || entry.engine !== "mongodb") section.next.push(UP);
            return { mark: "fail", name: entry.service, where, detail };
        }
        const health = state!.health || "running";
        const database = DATABASES.find((candidate) => candidate.service === entry.service);
        if (!database) return { mark: "ok", name: entry.service, where, detail: health };
        if (await hasDataset(config, database)) return { mark: "ok", name: entry.service, where, detail: `${health}, test data loaded` };
        section.next.push(UP);
        return { mark: "warn", name: entry.service, where, detail: `${health}, no test data` };
    }));
    section.rows.push(...rows);
    return section;
}

/** Every part of the lab on its Docker host, or one line on why Docker there does not answer. */
async function checkContainers(config: LabConfig): Promise<Section[]> {
    let states: Map<string, ServiceState>;
    try {
        states = await serviceStates(config);
    } catch (error) {
        return [{
            title: `Docker on ${config.docker.name}`,
            rows: [{ mark: "fail", name: "docker", detail: `does not answer: ${error instanceof Error ? error.message : String(error)}` }],
            next: [`docker ${dockerArgs(config.docker, ["info"]).join(" ")}   shows why Docker on ${config.docker.name} does not answer`],
        }];
    }
    return Promise.all(GROUPS.map((group) => checkGroup(config, group, states)));
}

/** The OpenSSH login and the database services of a native host, over its `ssh` login. */
async function checkNative(host: NativeHost): Promise<Section> {
    const login = host.login;
    const section: Section = { title: `Native server ${host.name} (${host.address})`, rows: [], next: [] };
    const sshOpen = await answers(host.address, login.port);
    section.rows.push(sshOpen
        ? { mark: "ok", name: "openssh", where: `${host.address}:${login.port}`, detail: `login ${login.user}` }
        : { mark: "fail", name: "openssh", where: `${host.address}:${login.port}`, detail: "does not answer" });
    if (!host.ssh) return section;

    const units = { postgresql: "PostgreSQL", mysql: "MySQL", "redis-server": "Redis", mongod: "MongoDB" };
    const script = `for unit in ${Object.keys(units).join(" ")}; do if systemctl cat "$unit" >/dev/null 2>&1; then echo "$unit $(systemctl is-active "$unit")"; else echo "$unit missing"; fi; done; grep -qw avx /proc/cpuinfo && echo "avx yes" || echo "avx no"`;
    const result = await attempt("ssh", sshArgs(host, script), { timeoutMs: 20_000 });
    if (result.code !== 0) {
        section.rows.push({ mark: "warn", name: "services", detail: `could not look as ${host.ssh.user}: ${(result.stderr || "no answer").trim().split("\n").pop()}` });
        return section;
    }
    const lines = new Map(result.stdout.trim().split("\n").map((line) => line.split(" ") as [string, string]));
    const avx = lines.get("avx") === "yes";
    for (const [unit, label] of Object.entries(units)) {
        const state = lines.get(unit);
        if (state === "active") section.rows.push({ mark: "ok", name: label.toLowerCase(), detail: "running" });
        else if (unit === "mongod" && state === "missing" && !avx) section.rows.push({ mark: "info", name: "mongodb", detail: "not installed, the CPU has no AVX" });
        else {
            section.rows.push({ mark: "fail", name: label.toLowerCase(), detail: state === "missing" ? "not installed" : state ?? "unknown" });
            section.next.push(`pnpm lab:provision ${host.name}   sets the server up again`);
        }
    }
    return section;
}

function answers(address: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ host: address, port, timeout: 5_000 });
        const done = (ok: boolean) => {
            socket.destroy();
            resolve(ok);
        };
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
    });
}

const MARKS: Record<Mark, [string, string]> = {
    ok: ["✓", "32"],
    warn: ["!", "33"],
    fail: ["✗", "31"],
    info: ["•", "36"],
};

function mark(value: Mark): string {
    const [symbol, color] = MARKS[value];
    return process.stdout.isTTY ? `\x1b[${color}m${symbol}\x1b[0m` : symbol;
}

const bold = (text: string) => (process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text);

/** The report, one block per section, the next steps at the end. */
export function renderStatus(header: string[], sections: Section[]): string[] {
    const rows = sections.flatMap((section) => section.rows);
    const nameWidth = Math.max(...rows.map((row) => row.name.length), 4);
    const whereWidth = Math.max(...rows.map((row) => row.where?.length ?? 0), 0);
    const lines = [...header];
    for (const section of sections) {
        lines.push("", bold(section.title));
        for (const row of section.rows) {
            const where = whereWidth ? `${(row.where ?? "").padEnd(whereWidth)}   ` : "";
            lines.push(`  ${mark(row.mark)} ${row.name.padEnd(nameWidth)}   ${where}${row.detail}`.trimEnd());
        }
    }
    const next = [...new Set(sections.flatMap((section) => section.next))];
    const failed = rows.filter((row) => row.mark === "fail").length;
    lines.push("");
    if (next.length > 0) {
        lines.push(bold("Next"));
        for (const step of next) lines.push(`  ${step}`);
    } else if (failed > 0) {
        lines.push(bold(`${failed} ${failed === 1 ? "problem" : "problems"} above that no lab command fixes, the line says why.`));
    } else {
        lines.push(bold("Everything is in place."));
    }
    return lines;
}

/** Prints the status. Returns whether nothing failed. */
export async function status(config: LabConfig, workspace: string, write: Write): Promise<boolean> {
    write("Checking the lab, the dev database and this machine...");
    loadAppEnv();
    const [groups, nativeSections, tools, app] = await Promise.all([
        checkContainers(config),
        Promise.all(config.natives.map(checkNative)),
        checkTools(),
        checkApp(),
    ]);
    const database = await checkDevDatabase(config, workspace);
    const sections = [...groups, ...nativeSections, database, tools, app];
    const header = [
        "",
        `${bold("Config")}       ${config.source}, profile ${config.profile}`,
        `${bold("Docker host")}  ${config.docker.name} (${config.docker.address})`,
        `${bold("Workspace")}    ${workspace}`,
    ];
    for (const line of renderStatus(header, sections)) write(line);
    return !sections.some((section) => section.rows.some((row) => row.mark === "fail"));
}
