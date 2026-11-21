/**
 * The services of the lab the selected families need, started with their test data. The global
 * setup runs these steps before DBackup starts. CI also runs them earlier through
 * `start-services.ts`, while the image builds, and the global setup then finds them done.
 */

import { DATABASES } from "../../lab/src/catalog";
import { serviceStates } from "../../lab/src/containers";
import { loadDataset } from "../../lab/src/datasets";
import { compose, type RunResult } from "../../lab/src/docker";
import { prepareMssqlFolder } from "../../lab/src/environment";
import { lab } from "./environment";
import { UI_SERVICES, selectedFamilies, servicesOf, uiSelected } from "./targets";

/** The services of the lab the families of E2E_FAMILIES need, those of the browser tests included. */
export function selectedServices(): string[] {
    return [...new Set([...(uiSelected() ? UI_SERVICES : []), ...selectedFamilies().flatMap(servicesOf)])];
}

/**
 * Removes the containers of the services that Docker made but never ran, and says whether there
 * were any. A start that fails on the network, like a host port another process holds, leaves one
 * behind, and Docker never names it in the network of the lab again, even once it runs. Only a new
 * container is found by name.
 */
async function removeNeverStarted(services: string[]): Promise<boolean> {
    const states = await serviceStates(lab);
    const stale = services.filter((service) => states.get(service)?.state === "created");
    if (stale.length) await compose(lab, ["--progress", "quiet", "rm", "--force", ...stale]);
    return stale.length > 0;
}

/** Starts the services and waits until they are healthy. A service that does not come up shows in the result, it does not throw. */
export async function startServices(services: string[]): Promise<RunResult> {
    // DBackup mounts the folder of SQL Server too, and Docker would make a missing one as root.
    await prepareMssqlFolder(lab);
    // --build rebuilds the images of the lab whose files changed, like the customer server, from the cache otherwise.
    const up = () => compose(lab, ["--progress", "quiet", "up", "-d", "--build", "--wait", ...services]);
    await removeNeverStarted(services);
    const started = await up();
    // A start that failed on the network gets new containers and one more try, the host port it
    // wanted is often free again a moment later.
    if (started.code === 0 || !(await removeNeverStarted(services))) return started;
    return up();
}

/** Loads the test data into every database among the services that lacks it, except the ones to skip. Returns the services it loaded. */
export async function loadDatasets(services: string[], skip: Record<string, string> = {}): Promise<string[]> {
    const loaded: string[] = [];
    for (const database of DATABASES.filter((entry) => services.includes(entry.service) && !skip[entry.service])) {
        if (await loadDataset(lab, database)) loaded.push(database.service);
    }
    return loaded;
}
