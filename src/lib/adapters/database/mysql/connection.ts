import { execFile } from "child_process";
import util from "util";
import { getMysqlCommand, getMysqladminCommand } from "./tools";

export const execFileAsync = util.promisify(execFile);

export async function ensureDatabase(config: any, dbName: string, user: string, pass: string | undefined, privileged: boolean, logs: string[]) {
    const args = ['-h', config.host, '-P', String(config.port), '-u', user, '--protocol=tcp'];
    if (config.disableSsl) {
        args.push('--skip-ssl');
    }
    const env = { ...process.env };
    if (pass) env.MYSQL_PWD = pass;

    try {
       await execFileAsync(getMysqlCommand(), [...args, '-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\``], { env });
       logs.push(`Database '${dbName}' ensured.`);
       if (privileged) {
            const grantQuery = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;`;
            await execFileAsync(getMysqlCommand(), [...args, '-e', grantQuery], { env });
            logs.push(`Permissions granted for '${dbName}'.`);
       }
    } catch(e: any) {
        logs.push(`Warning ensures DB '${dbName}': ${e.message}`);
    }
}

export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    try {
        // 1. Basic Ping Test
        // Increased timeout to 10s to handle heavy load during integration tests
        const pingArgs = ['ping', '-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp', '--connect-timeout=10'];

        // Use MYSQL_PWD env var for password to avoid leaking it in process list
        const env = { ...process.env };
        if (config.password) {
            env.MYSQL_PWD = config.password;
        }

        if (config.disableSsl) {
            pingArgs.push('--skip-ssl');
        }

        await execFileAsync(getMysqladminCommand(), pingArgs, { env });

        // 2. Version Check (if ping successful)
        const versionArgs = ['-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp', '-N', '-s', '-e', 'SELECT VERSION()'];

        if (config.disableSsl) {
            versionArgs.push('--skip-ssl');
        }

        const { stdout } = await execFileAsync(getMysqlCommand(), versionArgs, { env });
        const rawVersion = stdout.trim();

        // Extract version number only (e.g. "11.4.9-MariaDB-ubu2404" → "11.4.9" or "8.0.44" → "8.0.44")
        const versionMatch = rawVersion.match(/^([\d.]+)/);
        const version = versionMatch ? versionMatch[1] : rawVersion;

        return { success: true, message: "Connection successful", version };
    } catch (error: any) {
        return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
    }
}

export async function getDatabases(config: any): Promise<string[]> {
    const args = ['-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp'];
    if (config.disableSsl) {
        args.push('--skip-ssl');
    }

    // Use MYSQL_PWD env var for password
    const env = { ...process.env };
    if (config.password) {
        env.MYSQL_PWD = config.password;
    }

    args.push('-e', 'SHOW DATABASES', '--skip-column-names');

    const { stdout } = await execFileAsync(getMysqlCommand(), args, { env });
    const sysDbs = ['information_schema', 'mysql', 'performance_schema', 'sys'];
    return stdout.split('\n').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
}
