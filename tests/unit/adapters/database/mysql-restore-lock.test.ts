import { describe, expect, it } from "vitest";
import { createFakeHost } from "@/lib/testing/fake-host";
import { lockedDownClientArgs } from "@/lib/adapters/database/mysql/restore";

/** The start of the help of a client, as `mysql --help` prints its options. */
const help = (...options: string[]) => `Usage: mysql [OPTIONS] [database]\n${options.map((option) => `  ${option}    Some words`).join("\n")}\n`;

describe("the client that reads a dump during a restore", () => {
    it("runs no shell command of the dump on a MariaDB client, which knows the sandbox", async () => {
        const host = createFakeHost({ onExec: () => ({ stdout: help("--local-infile", "--sandbox"), code: 0 }) });
        await expect(lockedDownClientArgs(host, "mariadb")).resolves.toEqual(["--local-infile=0", "--sandbox"]);
        expect(host.calls.exec).toEqual([["mariadb", "--help"]]);
    });

    it("runs no shell command of the dump on a MySQL client, which turns its system command off", async () => {
        const host = createFakeHost({ onExec: () => ({ stdout: help("--local-infile", "--system-command"), code: 0 }) });
        await expect(lockedDownClientArgs(host, "mysql")).resolves.toEqual(["--local-infile=0", "--skip-system-command"]);
    });

    it("never sends a file of the machine it runs on, whatever the client knows", async () => {
        const old = createFakeHost({ onExec: () => ({ stdout: help("--local-infile"), code: 0 }) });
        await expect(lockedDownClientArgs(old, "mysql")).resolves.toEqual(["--local-infile=0"]);
        const silent = createFakeHost({ onExec: () => ({ stdout: "", code: 2 }) });
        await expect(lockedDownClientArgs(silent, "mysql")).resolves.toEqual(["--local-infile=0"]);
    });

    it("does not take a word in the description of another option for the option itself", async () => {
        const host = createFakeHost({ onExec: () => ({ stdout: "  --connect-expired-password\n                      expired password sandbox mode even if --batch was\n", code: 0 }) });
        await expect(lockedDownClientArgs(host, "mariadb")).resolves.toEqual(["--local-infile=0"]);
    });
});
