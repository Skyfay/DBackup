import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);

// Cache detection results to avoid spawning processes repeatedly
let cachedGbakCmd: string | null = null;
let cachedIsqlCmd: string | null = null;

// Initialization promise to detect commands once asynchronously
let initPromise: Promise<void> | null = null;

// Well-known install locations to fall back to when PATH isn't configured
// (e.g. a dev machine that ran the setup script but hasn't restarted its
// shell/dev server since, so the new directory never made it onto PATH).
const FALLBACK_DIRS = [
    "/opt/firebird/bin", // Linux (Docker image, manual client extraction)
    "/opt/homebrew/firebird-client/bin", // macOS, Apple Silicon (setup-dev-macos.sh)
    "/usr/local/firebird-client/bin", // macOS, Intel (setup-dev-macos.sh)
    "/Library/Frameworks/Firebird.framework/Resources/bin", // macOS, official installer
];

/**
 * Verify a resolved path is actually Firebird's binary, not a same-named tool
 * from an unrelated package - most notably unixODBC, which also ships an
 * "isql" with a completely different CLI and no Firebird connectivity at all.
 * "-z" (version) always prints a "... Firebird X.Y" banner, even when the
 * process exits non-zero for lacking other required arguments (gbak's case).
 *
 * Firebird's own isql prints that banner and then drops into its interactive
 * prompt waiting on stdin - which never gets an EOF from execFile's pipe, so
 * this would hang forever without a timeout. The `timeout` option kills it
 * after the version line is already buffered, which is all we need.
 */
async function isFirebirdBinary(path: string): Promise<boolean> {
    try {
        const { stdout, stderr } = await execFileAsync(path, ["-z"], { timeout: 3000 });
        return /firebird/i.test(stdout + stderr);
    } catch (err: unknown) {
        const { stdout = "", stderr = "" } = err as { stdout?: string; stderr?: string };
        return /firebird/i.test(stdout + stderr);
    }
}

async function resolveCommand(names: string[]): Promise<string> {
    // 1. Check each candidate name on PATH, but only accept it once verified.
    for (const name of names) {
        try {
            const { stdout } = await execFileAsync("which", [name]);
            const resolvedPath = stdout.trim();
            if (resolvedPath && (await isFirebirdBinary(resolvedPath))) {
                return name;
            }
        } catch {
            continue;
        }
    }

    // 2. Not found (or the wrong tool) on PATH - try well-known absolute locations.
    for (const dir of FALLBACK_DIRS) {
        for (const name of names) {
            const fullPath = `${dir}/${name}`;
            if (await isFirebirdBinary(fullPath)) {
                return fullPath;
            }
        }
    }

    // 3. Nothing verified - fall back to the first candidate name and let it
    // fail later with a clear "command not found" error.
    return names[0];
}

async function initCommands(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            const [gbak, isql] = await Promise.all([
                resolveCommand(["gbak"]),
                // Some distros ship Firebird's isql as isql-fb to avoid a clash with unixODBC's isql
                resolveCommand(["isql", "isql-fb"]),
            ]);
            cachedGbakCmd = gbak;
            cachedIsqlCmd = isql;
        })();
    }
    return initPromise;
}

export function getGbakCommand(): string {
    // Return cached value or fallback - initCommands() should be called before first use
    return cachedGbakCmd ?? "gbak";
}

export function getIsqlCommand(): string {
    return cachedIsqlCmd ?? "isql";
}

/** Call once during startup or before first adapter use to detect available commands */
export { initCommands as initFirebirdTools };
