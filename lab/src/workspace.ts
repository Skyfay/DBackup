/**
 * Which checkout this is. Every workspace writes its backups into a folder of its own, since
 * workspaces that shared one would see each other's backups and prune them with their retention.
 */

import { execFileSync } from "child_process";
import path from "path";
import { REPO_ROOT } from "./config";

/** The name of a workspace as a folder name: letters, digits, dot, dash and underscore, never a leading dot. */
export function folderName(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "workspace";
}

/**
 * "main" for the primary checkout, the folder name of the worktree otherwise.
 *
 * @param worktreeList The output of `git worktree list --porcelain`, the primary checkout first.
 */
export function workspaceNameFrom(checkout: string, worktreeList: string): string {
    const primary = worktreeList.split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!primary || path.resolve(primary) === path.resolve(checkout)) return "main";
    return folderName(path.basename(checkout));
}

export function currentWorkspace(checkout = REPO_ROOT): string {
    try {
        const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: checkout, encoding: "utf8" });
        return workspaceNameFrom(checkout, list);
    } catch {
        // Not a git checkout, like an unpacked release. One folder for all of it.
        return "main";
    }
}
