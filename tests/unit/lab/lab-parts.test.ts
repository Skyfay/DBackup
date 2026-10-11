// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { REPO_ROOT } from "../../../lab/src/config";
import { DATABASES, NOTIFY, STORAGE } from "../../../lab/src/catalog";
import { generatePassword } from "../../../lab/src/password";
import { folderName, workspaceNameFrom } from "../../../lab/src/workspace";

/** The services of a Compose file with their published ports and profiles, read line by line. */
function composeServices(group: string): Map<string, { ports: number[]; profiles: string[] }> {
    const text = readFileSync(path.join(REPO_ROOT, "lab", "compose", `${group}.yml`), "utf8");
    const services = new Map<string, { ports: number[]; profiles: string[] }>();
    let inServices = false;
    let current: string | null = null;
    for (const line of text.split("\n")) {
        if (/^\S/.test(line)) inServices = line.startsWith("services:");
        if (!inServices) continue;
        const service = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
        if (service) {
            current = service[1];
            services.set(current, { ports: [], profiles: [] });
            continue;
        }
        if (!current) continue;
        const ports = /^ {4}ports: \[(.*)\]/.exec(line);
        if (ports) services.get(current)!.ports = [...ports[1].matchAll(/"(\d+)(?:-\d+)?:/g)].map((match) => Number(match[1]));
        const profiles = /^ {4}profiles: \[(.*)\]/.exec(line);
        if (profiles) services.get(current)!.profiles = [...profiles[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    }
    return services;
}

describe("the services of the dev lab", () => {
    it("are the same in the catalog and the Compose file of the databases, with the same port and profile", () => {
        const compose = composeServices("databases");

        expect([...compose.keys()].sort()).toEqual(DATABASES.map((database) => database.service).sort());
        for (const database of DATABASES) {
            expect(compose.get(database.service), database.service).toEqual({ ports: [database.port], profiles: [database.profile] });
        }
    });

    it("publish the storage and notification ports the seed connects to", () => {
        const storage = composeServices("storage");
        for (const entry of Object.values(STORAGE)) expect(storage.get(entry.service)?.ports, entry.service).toContain(entry.port);

        const notify = composeServices("notify");
        expect(notify.get("mailpit")?.ports).toEqual([NOTIFY.mailpit.smtpPort, NOTIFY.mailpit.uiPort]);
        for (const entry of [NOTIFY.ntfy, NOTIFY.gotify, NOTIFY.webhook]) expect(notify.get(entry.service)?.ports, entry.service).toEqual([entry.port]);
    });

    it("give every published port to one service only", () => {
        const ports = ["databases", "storage", "notify"].flatMap((group) => [...composeServices(group).values()].flatMap((service) => service.ports));
        expect(ports.length).toBe(new Set(ports).size);
    });
});

describe("the modules that run before the database is chosen", () => {
    // Prisma opens DATABASE_URL when its module loads. A static import of the app from one of
    // these runs before the CLI read .env or the lab tests pointed it at their own database,
    // so the seed of a test run once landed in the dev database.
    const files = [
        ...readdirSync(path.join(REPO_ROOT, "lab", "src")).filter((file) => file.endsWith(".ts") && file !== "check.ts").map((file) => path.join("lab", "src", file)),
        ...["environment.ts", "setup.ts", "global-setup.ts"].map((file) => path.join("tests", "lab", "support", file)),
    ];

    it.each(files)("%s imports neither the app nor the seed before it runs", (file) => {
        const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
        const imports = [...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
        expect(imports.filter((module) => module.startsWith("@/") || /(^|\/)(seed|check)(\/|$)/.test(module))).toEqual([]);
    });
});

describe("the workspace of a checkout", () => {
    const list = "worktree /home/dev/repos/DBackup\nHEAD abc\nbranch refs/heads/dev\n\nworktree /home/dev/orca/workspaces/DBackup/ui-performance\nHEAD def\n";

    it("is main in the primary checkout", () => {
        expect(workspaceNameFrom("/home/dev/repos/DBackup", list)).toBe("main");
    });

    it("is the folder name of a worktree", () => {
        expect(workspaceNameFrom("/home/dev/orca/workspaces/DBackup/ui-performance", list)).toBe("ui-performance");
    });

    it("keeps only characters a folder name can safely hold", () => {
        expect(folderName("feature/Ümlaut name")).toBe("feature-mlaut-name");
        expect(folderName("../..")).toBe("workspace");
        expect(folderName(".hidden")).toBe("hidden");
        expect(folderName("///")).toBe("workspace");
    });
});

describe("the generated admin password", () => {
    it("meets the Standard rules and holds no word of the name or the email", () => {
        for (let round = 0; round < 50; round++) {
            const password = generatePassword("Manu Sky", "skyfay@skymail.one");
            expect(password).toHaveLength(20);
            expect(password).toMatch(/[A-Z]/);
            expect(password).toMatch(/[a-z]/);
            expect(password).toMatch(/[0-9]/);
            expect(password.toLowerCase()).not.toMatch(/manu|sky|skyfay/);
        }
    });
});
