/**
 * Runs once before the end-to-end tests: builds the image of this checkout, starts the services of
 * the lab the selected families need, loads their test data and starts DBackup from scratch beside
 * them. Removes the DBackup container again afterwards, the lab keeps running.
 *
 * E2E_NO_BUILD=1 uses an image built already, like CI does. E2E_KEEP=1 leaves DBackup running.
 */

import { DATABASES } from "../../lab/src/catalog";
import { describeDown, isUp, serviceStates } from "../../lab/src/containers";
import { loadDataset } from "../../lab/src/datasets";
import { compose, type RunResult } from "../../lab/src/docker";
import { prepareMssqlFolder } from "../../lab/src/environment";
import { BASE_URL, PORT, lab } from "./environment";
import { UI_SERVICES, selectedFamilies, servicesOf, uiSelected } from "./targets";

const write = (line: string) => process.stdout.write(`${line}\n`);
const tail = (result: RunResult) => (result.stderr || result.stdout).trim().split("\n").slice(-15).join("\n");
const appEnv = { E2E_PORT: String(PORT), E2E_BASE_URL: BASE_URL };

async function waitForHealth(deadline: number): Promise<void> {
    for (;;) {
        const status = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.status).catch(() => 0);
        if (status === 200) return;
        if (Date.now() > deadline) throw new Error(`DBackup did not answer healthy at ${BASE_URL} in time (last status ${status || "none"})`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
}

/**
 * The services that did not come up, with the reason. A CPU without the AVX of MongoDB 5 and
 * later is the machine, not DBackup: a local run goes on without such a service and its tests
 * skip, CI fails. Anything else fails the run.
 */
async function servicesDown(services: string[]): Promise<Record<string, string>> {
    const states = await serviceStates(lab);
    const unavailable: Record<string, string> = {};
    const broken: string[] = [];
    for (const service of services.filter((name) => !isUp(states.get(name)))) {
        const database = DATABASES.find((entry) => entry.service === service);
        const reason = await describeDown(lab, { service, port: database?.port ?? 0, engine: database?.engine }, states.get(service));
        if (!process.env.CI && /no AVX/.test(reason)) unavailable[service] = reason;
        else broken.push(`  ${service}: ${reason}`);
    }
    if (broken.length) throw new Error(`Not every service came up:\n${broken.join("\n")}`);
    return unavailable;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
    const families = selectedFamilies();
    const services = [...new Set([...(uiSelected() ? UI_SERVICES : []), ...families.flatMap(servicesOf)])];
    const names = [...(uiSelected() ? ["ui"] : []), ...families.map((family) => family.name)];
    write(`End-to-end tests of ${names.join(", ")} on ${lab.docker.name} (${lab.docker.address})`);

    if (!process.env.E2E_NO_BUILD) {
        write("Building the image of this checkout, the first build takes a few minutes");
        const built = await compose(lab, ["--progress", "quiet", "build", "app"]);
        if (built.code !== 0) throw new Error(`Building the image failed:\n${tail(built)}`);
    }

    write(`Starting ${services.join(", ")}`);
    // DBackup mounts the folder of SQL Server too, and Docker would make a missing one as root.
    await prepareMssqlFolder(lab);
    // --build rebuilds the images of the lab whose files changed, like the customer server, from the cache otherwise.
    const started = await compose(lab, ["--progress", "quiet", "up", "-d", "--build", "--wait", ...services]);
    const unavailable = await servicesDown(services);
    if (started.code !== 0 && Object.keys(unavailable).length === 0) throw new Error(`Starting the services failed:\n${tail(started)}`);
    for (const [service, reason] of Object.entries(unavailable)) write(`Skipping the tests of ${service}: ${reason}`);
    // The workers start after the global setup and take its environment along.
    process.env.E2E_UNAVAILABLE = JSON.stringify(unavailable);
    for (const database of DATABASES.filter((entry) => services.includes(entry.service) && !unavailable[entry.service])) {
        if (await loadDataset(lab, database)) write(`Loaded the test data into ${database.service}`);
    }

    write(`Starting DBackup from scratch at ${BASE_URL}`);
    const app = await compose(lab, ["--progress", "quiet", "up", "-d", "--force-recreate", "--no-build", "--wait", "app"], { env: appEnv });
    if (app.code !== 0) throw new Error(`DBackup did not come up:\n${tail(app)}`);
    await waitForHealth(Date.now() + 120_000);

    return async () => {
        if (process.env.E2E_KEEP) return;
        await compose(lab, ["--progress", "quiet", "rm", "--stop", "--force", "app"], { env: appEnv });
    };
}
