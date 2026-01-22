import { execFile } from "child_process";
import util from "util";

export const execFileAsync = util.promisify(execFile);

export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    const dbsToTry = ['postgres', 'template1'];
    if (typeof config.database === 'string' && config.database) dbsToTry.push(config.database);

    const env = { ...process.env, PGPASSWORD: config.password };
    let lastError: any;

    for (const db of dbsToTry) {
        try {
            const args = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', db, '-t', '-c', 'SELECT version()'];
            const { stdout } = await execFileAsync('psql', args, { env });

            // Extract version number only (e.g. "PostgreSQL 16.1 on ..." → "16.1")
            const rawVersion = stdout.trim();
            const versionMatch = rawVersion.match(/PostgreSQL\s+([\d.]+)/);
            const version = versionMatch ? versionMatch[1] : rawVersion;

            return { success: true, message: "Connection successful", version };
        } catch (error: any) {
            lastError = error;
        }
    }
    return { success: false, message: "Connection failed: " + (lastError?.stderr || lastError?.message) };
}

export async function getDatabases(config: any): Promise<string[]> {
    const dbsToTry = ['postgres', 'template1'];
    if (typeof config.database === 'string' && config.database) dbsToTry.push(config.database);

    const env = { ...process.env, PGPASSWORD: config.password };
    let lastError: any;

    for (const db of dbsToTry) {
        try {
            // -t = tuples only (no header/footer), -A = unaligned
            const args = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', db, '-t', '-A', '-c', 'SELECT datname FROM pg_database WHERE datistemplate = false;'];
            const { stdout } = await execFileAsync('psql', args, { env });
            return stdout.split('\n').map(s => s.trim()).filter(s => s);
        } catch (error: any) {
            lastError = error;
        }
    }
    throw lastError;
}
