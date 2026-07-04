import { execFile } from "child_process";
import util from "util";

const execFileAsync = util.promisify(execFile);

// Cache detection results to avoid spawning processes repeatedly
let cachedGbakCmd: string | null = null;
let cachedIsqlCmd: string | null = null;

// Initialization promise to detect commands once asynchronously
let initPromise: Promise<void> | null = null;

async function detectCommand(candidates: string[]): Promise<string> {
    for (const cmd of candidates) {
        try {
            await execFileAsync("which", [cmd]);
            return cmd;
        } catch {
            continue;
        }
    }
    // Fallback to the first candidate if nothing works (let it fail later with a clear error)
    return candidates[0];
}

async function initCommands(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            const [gbak, isql] = await Promise.all([
                detectCommand(["gbak"]),
                // Some distros ship Firebird's isql as isql-fb to avoid a clash with unixODBC's isql
                detectCommand(["isql", "isql-fb"]),
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
