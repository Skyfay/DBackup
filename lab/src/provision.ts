/**
 * Sets up a native host of the lab: copies lab/datasets and lab/provision to /opt/dbackup-lab on
 * it and runs the provisioning script there as root, over the ssh client of this machine. The
 * password of the lab login goes through the standard input, never onto a command line.
 */

import { spawn } from "child_process";
import path from "path";
import { REPO_ROOT, type Host } from "./config";

const REMOTE_DIR = "/opt/dbackup-lab";

/** The arguments of the ssh client of this machine for a command on a host, with the `ssh` login of its config. */
export function sshArgs(host: Host, command: string): string[] {
    const ssh = host.ssh!;
    return ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-p", String(ssh.port), `${ssh.user}@${host.address}`, command];
}

/** Runs ssh with the output of `source` as its standard input, or with `input`. */
function ssh(host: Host, command: string, stdin: { pipeFrom?: ReturnType<typeof spawn>; input?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn("ssh", sshArgs(host, command), { stdio: ["pipe", "inherit", "inherit"] });
        if (stdin.pipeFrom) stdin.pipeFrom.stdout!.pipe(child.stdin!);
        else child.stdin!.end(stdin.input ?? "");
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ssh to ${host.name} failed with ${code}`))));
    });
}

export async function provision(host: Host, write: (line: string) => void): Promise<void> {
    if (!host.native) throw new Error(`The host ${host.name} has no "native" part in the lab config.`);
    if (!host.ssh) throw new Error(`The host ${host.name} needs "ssh" with a login that may run the setup as root.`);

    write(`Copying the datasets and the setup to ${host.name}:${REMOTE_DIR}`);
    const tar = spawn("tar", ["-czf", "-", "-C", path.join(REPO_ROOT, "lab"), "datasets", "provision"], { stdio: ["ignore", "pipe", "inherit"] });
    await ssh(host, `rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && tar -xzf - -C ${REMOTE_DIR}`, { pipeFrom: tar });

    write(`Running the setup on ${host.name}`);
    const login = host.native.ssh;
    const script = [
        `export LAB_USER='${login.user}'`,
        `export LAB_PASSWORD='${login.password.replace(/'/g, "'\\''")}'`,
        `export LAB_SSH_PORT='${login.port}'`,
        `bash ${REMOTE_DIR}/provision/ubuntu-native.sh`,
    ].join("\n");
    await ssh(host, "bash -s", { input: `${script}\n` });
}
