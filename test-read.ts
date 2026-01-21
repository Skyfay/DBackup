
import { LocalFileSystemAdapter } from "./src/lib/adapters/storage/local";
import path from "path";

const config = { basePath: "./backups" };
const remotePath = "backups/MySQL Job/MySQL_Job_2026-01-19T19-38-44-595Z.sql.gz.enc.meta.json";

async function test() {
    console.log("Testing Read...");
    if (!LocalFileSystemAdapter.read) {
        console.error("Adapter has no read method!");
        return;
    }
    const result = await LocalFileSystemAdapter.read(config, remotePath);
    console.log("Result length:", result ? result.length : "null");

    // Check path resolution logic manually
    const resolved = path.join(config.basePath, remotePath);
    console.log("Resolved Path:", resolved);
    const fs = require("fs");
    console.log("Exists:", fs.existsSync(resolved));
}

test();
