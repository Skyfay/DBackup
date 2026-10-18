/**
 * Fills the dev database of this checkout with the lab: the first user, the connections, a Vault
 * key and the jobs in the home tenant, then the customers Acme and Globex with a platform group of
 * both. Safe to run again, it only adds what is missing and moves the destinations to the folders
 * of this workspace.
 *
 * Imported by the CLI only after it loaded `.env`, since Prisma and the encryption of the app read
 * `DATABASE_URL` and `ENCRYPTION_KEY` when their modules load.
 */

import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { LabConfig } from "../config";
import { ensureAdmin } from "./admin";
import { seedConnections } from "./connections";
import { seedHistory } from "./history";
import { seedJobs } from "./jobs";
import { seedTenants } from "./tenants";

/** Everything of the lab goes into the tenant every installation starts with, the customers beside it. */
export function seed(config: LabConfig, workspace: string, options: { history?: boolean } = {}): Promise<string[]> {
    return runAsTenant(HOME_TENANT_ID, () => seedHome(config, workspace, options));
}

async function seedHome(config: LabConfig, workspace: string, options: { history?: boolean }): Promise<string[]> {
    const log: string[] = [];
    const admin = await ensureAdmin(config.admin);
    log.push(admin === "created" ? `created user ${config.admin.email}` : "kept the existing users");

    // The name in the sidebar and the browser tab tells the workspaces apart.
    await prisma.systemSetting.upsert({
        where: { key: "general.instanceName" },
        update: { value: `Lab ${workspace}` },
        create: { key: "general.instanceName", value: `Lab ${workspace}`, description: "Name of this instance" },
    });

    const connections = await seedConnections(config, workspace);
    log.push(...connections.log);
    log.push(...await seedJobs(connections, config.natives.map((host) => host.name)));
    if (options.history) log.push(await seedHistory());
    log.push(...await seedTenants(config, connections));
    return log;
}
