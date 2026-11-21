/**
 * Where DBackup answers during an end-to-end run and who signs in. Read by the Playwright config,
 * the global setup and the tests alike, so it holds no state.
 *
 * DBackup runs in the Compose project of the lab, on the Docker host of the lab config: this
 * machine without a config, as in CI, or a remote host like the one of `pnpm lab`. The tests reach
 * it at localhost either way, since a passkey needs a secure context and a domain as its RP ID,
 * which an IP is not. With a remote Docker host the global setup forwards the port of localhost to
 * it, see `forwardToLab`.
 */

import path from "path";
import { DEX } from "../../lab/src/catalog";
import { loadConfig } from "../../lab/src/config";

export const E2E_DIR = path.resolve(__dirname, "..");

export const PORT = Number(process.env.E2E_PORT ?? 3300);

export const lab = loadConfig();

/** Where the browser, the requests of the tests and better-auth (`BETTER_AUTH_URL`) see DBackup. */
export const BASE_URL = `http://localhost:${PORT}`;

/** Whether the Docker host of the lab is this machine, where DBackup answers on localhost by itself. */
export const labIsLocal = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(lab.docker.address);

/**
 * The Chromium argument that sends the browser to Dex, the identity provider of the SSO tests, by
 * the name DBackup reaches it under in the network of the lab. Both then see one issuer, as the
 * id_token names it. Dex publishes its port on the Docker host of the lab.
 */
export const DEX_HOST_RULE = `--host-resolver-rules=MAP ${DEX.service} ${labIsLocal ? "127.0.0.1" : lab.docker.address}`;

/** The account the first start creates. The password follows the Standard rules and holds no word of the name or email. */
export const ADMIN = { name: "E2E Admin", email: "admin@e2e.dbackup.test", password: "Quartz-Lantern-7419" };

/** The session of the admin, written by the first start and used by every other project. */
export const ADMIN_STATE = path.join(E2E_DIR, ".auth", "admin.json");
