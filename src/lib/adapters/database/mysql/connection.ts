import { execFile } from "child_process";
import util from "util";

export const execFileAsync = util.promisify(execFile);

export async function ensureDatabase(config: any, dbName: string, user: string, pass: string | undefined, privileged: boolean, logs: string[]) {
    const args = ['-h', config.host, '-P', String(config.port), '-u', user, '--protocol=tcp'];
    if (config.disableSsl) {
        args.push('--skip-ssl');
    }
    const env = { ...process.env };
    if (pass) env.MYSQL_PWD = pass;

    try {
       await execFileAsync('mysql', [...args, '-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\``], { env });
       logs.push(`Database '${dbName}' ensured.`);
       if (privileged) {
            const grantQuery = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;`;
            await execFileAsync('mysql', [...args, '-e', grantQuery], { env });
            logs.push(`Permissions granted for '${dbName}'.`);
       }
    } catch(e: any) {
        logs.push(`Warning ensures DB '${dbName}': ${e.message}`);
    }
}

export async function test(config: any): Promise<{ success: boolean; message: string }> {
    try {
        // Force protocol=tcp to ensure we connect via network port (vital for Docker on localhost)
        const args = ['ping', '-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp', '--connect-timeout=5'];

        if (config.password) {
            args.push(`-p${config.password}`);
        }

        if (config.disableSsl) {
            args.push('--skip-ssl');
        }

        await execFileAsync('mysqladmin', args);
        return { success: true, message: "Connection successful" };
    } catch (error: any) {
        return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
    }
}

export async function getDatabases(config: any): Promise<string[]> {
    const args = ['-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp'];
    if (config.disableSsl) {
        args.push('--skip-ssl');
    }
    if (config.password) {
        args.push(`-p${config.password}`);
    }
    args.push('-e', 'SHOW DATABASES', '--skip-column-names');

    const { stdout } = await execFileAsync('mysql', args);
    const sysDbs = ['information_schema', 'mysql', 'performance_schema', 'sys'];
    return stdout.split('\n').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
}
