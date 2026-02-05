import { execFile } from "child_process";
import util from "util";

export const execFileAsync = util.promisify(execFile);

export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    try {
        const args = ['--eval', 'db.runCommand({ ping: 1 })', '--quiet'];

        // Construct args helper
        // Since we don't have the dialect available cleanly here without circle dependency if dialect imports connection utils?
        // Actually dialect is safe to import. But dialect uses this file? No.
        // But for now, let's keep the args construction here or duplicate logic slightly to avoid heavy coupling.

        if (config.uri) {
            args.push(config.uri);
        } else {
            args.push('--host', config.host);
            args.push('--port', String(config.port));
            if (config.user && config.password) {
                    args.push('--username', config.user);
                    args.push('--password', config.password);
                    if (config.authenticationDatabase) {
                    args.push('--authenticationDatabase', config.authenticationDatabase);
                    } else {
                    args.push('--authenticationDatabase', 'admin');
                    }
            }
        }

        await execFileAsync('mongosh', args);

        // Fetch Version
        const versionArgs = [...args];
        versionArgs[1] = 'db.version()'; // Replace ping command

        const { stdout } = await execFileAsync('mongosh', versionArgs);
        const version = stdout.trim();

        return { success: true, message: "Connection successful", version };
    } catch (error: unknown) {
            const err = error as { stderr?: string; message?: string };
            return { success: false, message: "Connection failed: " + (err.stderr || err.message) };
    }
}

export async function getDatabases(config: any): Promise<string[]> {
    const args = ['--eval', "db.adminCommand('listDatabases').databases.map(d => d.name).join(',')", '--quiet'];

    if (config.uri) {
        args.push(config.uri);
    } else {
        args.push('--host', config.host);
        args.push('--port', config.port.toString());
        if (config.user && config.password) {
            args.push('--username', config.user);
            args.push('--password', config.password);
            if (config.authenticationDatabase) {
                args.push('--authenticationDatabase', config.authenticationDatabase);
            } else {
                args.push('--authenticationDatabase', 'admin');
            }
        }
    }

    const { stdout } = await execFileAsync('mongosh', args);
    const sysDbs = ['admin', 'config', 'local'];
    return stdout.trim().split(',').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
}
