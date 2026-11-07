import { describe, expect, it } from "vitest";
import { createFakeHost } from "@/lib/testing/fake-host";
import type { HostKind } from "@/lib/transport/types";
import { lockedDownClientArgs } from "@/lib/adapters/database/mysql/client-lock";

/** The start of the help of a client, as `mysql --help` prints its options. */
const help = (...options: string[]) => `Usage: mysql [OPTIONS] [database]\n${options.map((option) => `  ${option}    Some words`).join("\n")}\n`;

/** A host whose client answers `--help` with these options and `--version` with this line. */
function client(kind: HostKind, options: string[] | null, version = "mysql  Ver 8.0.36 for Linux on x86_64") {
    return createFakeHost({
        kind,
        onExec: (argv) => argv[1] === "--version"
            ? { stdout: `${version}\n`, code: 0 }
            : options ? { stdout: help(...options), code: 0 } : { stdout: "", code: 2 },
    });
}

describe("the client that reads a dump during a restore", () => {
    describe.each<HostKind>(["direct", "ssh"])("over a %s host", (kind) => {
        it("runs no shell command and reads or writes no file of the dump on a MariaDB client, which knows the sandbox", async () => {
            const host = client(kind, ["--binary-mode", "--local-infile", "--sandbox"]);
            await expect(lockedDownClientArgs(host, "mariadb")).resolves.toEqual(["--local-infile=0", "--binary-mode", "--sandbox"]);
            expect(host.calls.exec).toEqual([["mariadb", "--help"]]);
        });

        it("runs no shell command and reads or writes no file of the dump on a MySQL client, which turns its system command off", async () => {
            const host = client(kind, ["--binary-mode", "--local-infile", "--system-command"]);
            await expect(lockedDownClientArgs(host, "mysql")).resolves.toEqual(["--local-infile=0", "--binary-mode", "--skip-system-command"]);
        });
    });

    it("refuses a client beside DBackup that cannot turn the shell commands off, and names its version", async () => {
        const host = client("direct", ["--binary-mode", "--local-infile"]);
        await expect(lockedDownClientArgs(host, "mysql")).rejects.toThrow(/mysql {2}Ver 8\.0\.36.*cannot turn off the shell and file commands.*MySQL client 8\.0\.40/);
    });

    it("refuses a client beside DBackup that cannot turn the file commands off", async () => {
        const host = client("direct", ["--local-infile", "--sandbox"], "mariadb  Ver 15.1 Distrib 10.11.8-MariaDB");
        await expect(lockedDownClientArgs(host, "mariadb")).rejects.toThrow(/10\.11\.8-MariaDB/);
    });

    it("refuses a client beside DBackup that cannot describe itself", async () => {
        const silent = createFakeHost({ onExec: () => ({ stdout: "", code: 2 }) });
        await expect(lockedDownClientArgs(silent, "mysql")).rejects.toThrow(/mysql, version unknown/);
    });

    it("restores with whatever of the lock an older client on the SSH server knows, and never sends a file of it", async () => {
        await expect(lockedDownClientArgs(client("ssh", ["--binary-mode", "--local-infile"]), "mysql")).resolves.toEqual(["--local-infile=0", "--binary-mode"]);
        await expect(lockedDownClientArgs(client("ssh", ["--local-infile"]), "mysql")).resolves.toEqual(["--local-infile=0"]);
        await expect(lockedDownClientArgs(client("ssh", null), "mysql")).resolves.toEqual(["--local-infile=0"]);
    });

    it("does not take a word in the description of another option for the option itself", async () => {
        const host = createFakeHost({
            kind: "ssh",
            onExec: () => ({ stdout: "  --connect-expired-password\n                      expired password sandbox mode even if --batch was\n                      see --binary-mode\n", code: 0 }),
        });
        await expect(lockedDownClientArgs(host, "mariadb")).resolves.toEqual(["--local-infile=0"]);
    });
});
