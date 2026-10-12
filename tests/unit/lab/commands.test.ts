// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, menuLines } from "../../../lab/src/commands";
import { explainExit } from "../../../lab/src/containers";
import { renderStatus } from "../../../lab/src/status";
import { versionOf, type Section } from "../../../lab/src/status-checks";

const scripts: Record<string, string> = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
const ENTRY = "tsx lab/src/cli.ts";

describe("the lab menu", () => {
    it("lists every command as a script right below lab, in the order of the menu", () => {
        const names = Object.keys(scripts);
        const start = names.indexOf("lab");
        expect(scripts.lab).toBe(ENTRY);
        expect(names.slice(start + 1, start + 1 + COMMANDS.length)).toEqual(COMMANDS.map((command) => `lab:${command.name}`));
        for (const command of COMMANDS) expect(scripts[`lab:${command.name}`]).toBe(`${ENTRY} ${command.name}`);
    });

    it("has no script that runs a command the lab does not know", () => {
        const known = new Set(COMMANDS.map((command) => `lab:${command.name}`));
        const pointing = Object.entries(scripts)
            .filter(([name, script]) => name !== "lab" && script.startsWith(ENTRY))
            .map(([name]) => name);
        expect(pointing.filter((name) => !known.has(name))).toEqual([]);
    });

    it("shows every command once, numbered, below the heading of its group", () => {
        const text = menuLines(COMMANDS).join("\n");
        for (const [index, command] of COMMANDS.entries()) {
            expect(text).toContain(`${index + 1}) ${command.title}`);
            expect(text).toContain(`pnpm lab:${command.name}`);
        }
        expect(new Set(COMMANDS.map((command) => command.name)).size).toBe(COMMANDS.length);
    });
});

describe("the status of the lab", () => {
    it("says why MongoDB stopped on a CPU without AVX", () => {
        expect(explainExit("mongodb", 132, "")).toMatch(/no AVX/);
        expect(explainExit("mysql", 1, "[ERROR] Data directory is unusable")).toBe("exit 1: [ERROR] Data directory is unusable");
        expect(explainExit(undefined, 137, "", true)).toMatch(/lack of memory/);
        expect(explainExit(undefined, 137, "")).toMatch(/did not stop in time/);
    });

    it("reads the version of every client tool from its first answer", () => {
        expect(versionOf("mariadb-dump from 11.8.6-MariaDB, client 10.19 for debian-linux-gnu (x86_64)")).toBe("11.8.6");
        expect(versionOf("mysqldump  Ver 10.19 Distrib 10.11.6-MariaDB, for debian-linux-gnu (x86_64)")).toBe("10.11.6");
        expect(versionOf("mysqldump  Ver 8.0.46-0ubuntu0.24.04.4 for Linux on x86_64 ((Ubuntu))")).toBe("8.0.46");
        expect(versionOf("pg_dump (PostgreSQL) 18.6 (Debian 18.6-1.pgdg13+1)")).toBe("18.6");
        expect(versionOf("gbak version LI-V5.0.3.1683 Firebird 5.0")).toBe("5.0.3");
    });

    const section = (rows: Section["rows"], next: string[] = []): Section => ({ title: "Databases", rows, next });

    it("ends with what to run when a lab command fixes what it found", () => {
        const lines = renderStatus([], [section([{ mark: "fail", name: "mysql-57", detail: "not started" }], ["pnpm lab:up"])]);
        expect(lines.slice(-2)).toEqual(["Next", "  pnpm lab:up"]);
    });

    it("never says everything is in place while something failed", () => {
        const lines = renderStatus([], [section([{ mark: "fail", name: "mongo-80", detail: "the CPU has no AVX" }])]);
        expect(lines.at(-1)).toMatch(/1 problem above/);
        expect(renderStatus([], [section([{ mark: "ok", name: "mysql-57", detail: "healthy" }])]).at(-1)).toBe("Everything is in place.");
    });
});
