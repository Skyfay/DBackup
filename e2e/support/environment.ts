/**
 * Where DBackup answers during an end-to-end run and who signs in. Read by the Playwright config,
 * the global setup and the tests alike, so it holds no state.
 *
 * DBackup runs in the Compose project of the lab, on the Docker host of the lab config: this
 * machine without a config, as in CI, or a remote host like the one of `pnpm lab`.
 */

import path from "path";
import { loadConfig } from "../../lab/src/config";

export const E2E_DIR = path.resolve(__dirname, "..");

export const PORT = Number(process.env.E2E_PORT ?? 3300);

export const lab = loadConfig();

export const BASE_URL = `http://${lab.docker.address}:${PORT}`;

/** The account the first start creates. The password follows the Standard rules and holds no word of the name or email. */
export const ADMIN = { name: "E2E Admin", email: "admin@e2e.dbackup.test", password: "Quartz-Lantern-7419" };

/** The session of the admin, written by the first start and used by every other project. */
export const ADMIN_STATE = path.join(E2E_DIR, ".auth", "admin.json");
