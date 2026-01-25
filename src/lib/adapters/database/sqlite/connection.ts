import { DatabaseAdapter } from "@/lib/core/interfaces";
import fs from "fs/promises";
import { constants } from "fs";
import { exec } from "child_process";
import { util } from "util";
import { SshClient } from "./ssh-client";

const execAsync = util.promisify(exec);

export const test: DatabaseAdapter["test"] = async (config) => {
    try {
        const mode = config.mode || "local";
        const dbPath = config.path;
        const binaryPath = config.sqliteBinaryPath || "sqlite3";

        if (mode === "local") {
            // 1. Check if sqlite3 binary exists locally
            try {
                await execAsync(`${binaryPath} --version`);
            } catch (e) {
                return { success: false, message: `SQLite3 binary not found at '${binaryPath}'. Please install sqlite3 or check path.` };
            }

            // 2. Check if database file exists and is readable
            try {
                await fs.access(dbPath, constants.R_OK);
            } catch (e) {
                return { success: false, message: `Database file at '${dbPath}' not found or not readable.` };
            }

            return { success: true, message: "Local SQLite connection successful." };

        } else if (mode === "ssh") {
            const client = new SshClient();
            try {
                await client.connect(config);

                 // 1. Check if sqlite3 binary exists on remote
                 const binaryResult = await client.exec(`${binaryPath} --version`);
                 if (binaryResult.code !== 0) {
                     client.end();
                     return { success: false, message: `Remote SQLite3 binary check failed: ${binaryResult.stderr || "Command failed"}` };
                 }

                 // 2. Check if database file exists on remote (using stat)
                 // We use a simple test: sqlite3 [path] "SELECT 1;"
                 // Or just `test -f [path]`
                 
                 const fileCheck = await client.exec(`test -f "${dbPath}" && echo "exists"`);
                 if (!fileCheck.stdout.includes("exists")) {
                    client.end();
                    return { success: false, message: `Remote database file at '${dbPath}' not found.` };
                 }

                 client.end();
                 return { success: true, message: "Remote SSH SQLite connection successful." };

            } catch (err: any) {
                client.end();
                return { success: false, message: `SSH Connection failed: ${err.message}` };
            }
        }

        return { success: false, message: "Invalid mode selected" };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
};

export const getDatabases: DatabaseAdapter["getDatabases"] = async (config) => {
     // For SQLite, the path itself is the database. We can return the filename.
     const path = config.path as string;
     const name = path.split(/[\\/]/).pop() || "database.sqlite";
     return [name];
};
