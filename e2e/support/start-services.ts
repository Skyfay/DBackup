/**
 * Starts the services of the families of E2E_FAMILIES and loads their test data, without DBackup.
 * CI runs it in the background while the image builds. It is only a head start: the global setup
 * runs the same steps again, finds them done, and reports a service that did not come up.
 *
 *     E2E_FAMILIES=mysql pnpm exec tsx e2e/support/start-services.ts
 */

import { loadDatasets, selectedServices, startServices } from "./services";

const write = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<number> {
    const services = selectedServices();
    write(`Starting ${services.join(", ")}`);
    const started = await startServices(services);
    if (started.code !== 0) {
        write((started.stderr || started.stdout).trim());
        return started.code;
    }
    for (const service of await loadDatasets(services)) write(`Loaded the test data into ${service}`);
    write("Every service is up");
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        write(error instanceof Error ? error.message : String(error));
        process.exit(1);
    },
);
