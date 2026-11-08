/**
 * The services of the lab the selected families need, started with their test data. The global
 * setup runs these steps before DBackup starts. CI also runs them earlier through
 * `start-services.ts`, while the image builds, and the global setup then finds them done.
 */

import { DATABASES } from "../../lab/src/catalog";
import { loadDataset } from "../../lab/src/datasets";
import { compose, type RunResult } from "../../lab/src/docker";
import { prepareMssqlFolder } from "../../lab/src/environment";
import { lab } from "./environment";
import { UI_SERVICES, selectedFamilies, servicesOf, uiSelected } from "./targets";

/** The services of the lab the families of E2E_FAMILIES need, those of the browser tests included. */
export function selectedServices(): string[] {
    return [...new Set([...(uiSelected() ? UI_SERVICES : []), ...selectedFamilies().flatMap(servicesOf)])];
}

/** Starts the services and waits until they are healthy. A service that does not come up shows in the result, it does not throw. */
export async function startServices(services: string[]): Promise<RunResult> {
    // DBackup mounts the folder of SQL Server too, and Docker would make a missing one as root.
    await prepareMssqlFolder(lab);
    // --build rebuilds the images of the lab whose files changed, like the customer server, from the cache otherwise.
    return compose(lab, ["--progress", "quiet", "up", "-d", "--build", "--wait", ...services]);
}

/** Loads the test data into every database among the services that lacks it, except the ones to skip. Returns the services it loaded. */
export async function loadDatasets(services: string[], skip: Record<string, string> = {}): Promise<string[]> {
    const loaded: string[] = [];
    for (const database of DATABASES.filter((entry) => services.includes(entry.service) && !skip[entry.service])) {
        if (await loadDataset(lab, database)) loaded.push(database.service);
    }
    return loaded;
}
