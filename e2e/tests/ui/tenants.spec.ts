/**
 * The life of an MSP on one instance: the first account, a platform admin, creates two customers,
 * invites the admin of one, gives it one database of a server of the home tenant with its backups,
 * lets it reach the network of the lab, looks at every tenant at once and deletes the other one.
 *
 * The platform admin signs in on its own here. The session of the setup, which every other project
 * uses, picks the home tenant once the second tenant exists, or it would start in All tenants and
 * change nothing any more.
 */

import { readFileSync } from "fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { STORAGE } from "../../../lab/src/catalog";
import { execIn } from "../../../lab/src/docker";
import { dropIn } from "../../../lab/src/fingerprints";
import { App, E2E_KEY, problemOf, unique, type Job } from "../../support/app";
import { createSource, localDestination } from "../../support/backups";
import { ADMIN, lab } from "../../support/environment";
import { FAMILIES, type Target } from "../../support/targets";
import { HOME, addressesInApp, contextOptions, keepSharedSessionHome, networkOf, raw, signIn, switchTo } from "../../support/tenants";

test.describe.configure({ mode: "serial" });

const ALL_TENANTS_REFUSAL = "All tenants only reads. Open the tenant of the record to change it.";


const tag = unique();
const acme = `Acme ${tag}`;
const globex = `Globex ${tag}`;
/** Two databases of one server of the home tenant: one goes to Acme, the other stays. */
const given = `${tag}_acme`;
const kept = `${tag}_kept`;
const customer = { name: "Ada Acme", email: `${tag}@acme.e2e.dbackup.test`, password: "Harbor-Violet-3816" };

const postgres: Target = FAMILIES.find((family) => family.name === "postgres")!.targets.find((target) => target.key === "postgres-18")!;

let admin: BrowserContext;
let person: BrowserContext;
let adminPage: Page;
let personPage: Page;
let server = "";
let homeJob: Job;
let homeJobName = "";
let acmeJobName = "";
/** Whether Edit opened on the members of each new tenant, as it should. */
const editOpened = new Map<string, boolean>();

/** Runs SQL in the PostgreSQL 18 of the lab, outside of DBackup. */
async function psql(database: string, sql: string): Promise<string> {
    const result = await execIn(lab, postgres.service, `psql -U ${postgres.login!.username} -d ${database} -v ON_ERROR_STOP=1 -q -t -A`, sql, 60_000);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    return result.stdout.trim();
}

/** What the home tenant holds, read by its admin, never shows to the person of Acme, on the pages and through the API. */
async function expectNothingOfHome(): Promise<void> {
    const home = new App(admin.request);
    const theirs = new App(person.request);
    const homeAdapters = [...await home.get<{ id: string; name: string }[]>("/api/adapters?type=database"), ...await home.get<{ id: string; name: string }[]>("/api/adapters?type=storage")];
    const homeJobs = await home.get<{ id: string; name: string }[]>("/api/jobs");

    const ownAdapters = [...await theirs.get<{ id: string }[]>("/api/adapters?type=database"), ...await theirs.get<{ id: string }[]>("/api/adapters?type=storage")];
    expect(ownAdapters.map((adapter) => adapter.id).filter((id) => homeAdapters.some((adapter) => adapter.id === id))).toEqual([]);
    const ownJobs = await theirs.get<{ id: string }[]>("/api/jobs");
    expect(ownJobs.map((job) => job.id).filter((id) => homeJobs.some((job) => job.id === id))).toEqual([]);

    await personPage.goto("/dashboard/jobs");
    await expect(personPage.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
    await personPage.waitForLoadState("networkidle");
    for (const job of homeJobs) await expect(personPage.getByText(job.name, { exact: true })).toHaveCount(0);
    for (const tab of ["databases", "destinations"]) {
        await personPage.goto(`/dashboard/connections?tab=${tab}`);
        await expect(personPage.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
        await personPage.waitForLoadState("networkidle");
        // The server of the database given to Acme shows as provided, its other connections never.
        for (const adapter of homeAdapters.filter((entry) => entry.id !== server)) await expect(personPage.getByText(adapter.name, { exact: true })).toHaveCount(0);
    }
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
    admin = await browser.newContext(contextOptions);
    person = await browser.newContext(contextOptions);
    adminPage = await admin.newPage();
    personPage = await person.newPage();
    await signIn(adminPage, ADMIN.email, ADMIN.password);
});

test.afterAll(async () => {
    if (!process.env.E2E_KEEP) {
        for (const database of [given, kept]) await dropIn(lab, "postgres", postgres.service, database);
    }
    await admin?.close();
    await person?.close();
});

test("a platform admin creates two customers through the pages", async ({ browser }) => {
    await adminPage.goto("/dashboard/platform/tenants");
    for (const tenant of [acme, globex]) {
        await adminPage.getByRole("button", { name: "New tenant" }).first().click();
        const dialog = adminPage.getByRole("dialog", { name: "New tenant" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(tenant);
        await dialog.getByRole("button", { name: "Create tenant" }).click();
        await expect(adminPage.getByText(`${tenant} is created`)).toBeVisible();
        // Nobody works in a new tenant yet, so Edit opens next on its members, see the known bug below.
        const edit = adminPage.getByRole("dialog", { name: `Edit ${tenant}` });
        const opened = await edit.getByRole("heading", { name: "Members", exact: true }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
        editOpened.set(tenant, opened);
        if (opened) {
            await edit.getByRole("button", { name: "Close", exact: true }).last().click();
            await expect(edit).toBeHidden();
        }
        await expect(adminPage.getByRole("button", { name: tenant, exact: true })).toBeVisible();
    }

    await test.step("both sessions of the admin keep working in the home tenant", async () => {
        // With more than one tenant a platform admin starts in All tenants, which changes nothing.
        await switchTo(adminPage, HOME);
        await keepSharedSessionHome(browser);
    });
});

test("New tenant opens Edit on the members of every new tenant", () => {
    expect(editOpened.get(globex), "Edit after the second customer").toBe(true);
    expect(editOpened.get(acme), "Edit after the first customer").toBe(true);
});

test("an invitation brings the admin of Acme, who sees nothing of the other tenants", async () => {
    let link = "";
    await test.step("the platform admin invites into Acme with the group Admin", async () => {
        await switchTo(adminPage, acme);
        await adminPage.goto("/dashboard/users");
        await adminPage.getByRole("button", { name: "Invite", exact: true }).click();
        const dialog = adminPage.getByRole("dialog", { name: "Invite" });
        await dialog.getByRole("combobox", { name: "Group" }).click();
        await adminPage.getByRole("option", { name: /^Admin\b/ }).click();
        await dialog.getByRole("button", { name: "Create link" }).click();
        const ready = adminPage.getByRole("dialog", { name: "Invitation ready" });
        link = (await ready.getByRole("code").textContent())!.trim();
        expect(link).toContain("/invite?token=");
        await ready.getByRole("button", { name: "Done" }).click();
        await switchTo(adminPage, HOME);
    });

    await test.step("someone without an account opens it and creates one", async () => {
        await personPage.goto(link);
        await expect(personPage.getByRole("heading", { name: `Join ${acme}` })).toBeVisible();
        await personPage.getByRole("textbox", { name: "Name", exact: true }).fill(customer.name);
        await personPage.getByRole("textbox", { name: "Email", exact: true }).fill(customer.email);
        await personPage.getByLabel("Password", { exact: true }).fill(customer.password);
        await personPage.getByRole("button", { name: `Create account and join ${acme}` }).click();
        await expect(personPage.getByText("Your account is ready")).toBeVisible();
        await signIn(personPage, customer.email, customer.password);
    });

    await test.step("they work in Acme and know of no other tenant", async () => {
        // A customer with one tenant gets no menu in the head of the sidebar, only its name.
        await expect(personPage.getByRole("link", { name: `DBackup Logo ${acme} Your backups`, exact: true })).toBeVisible();
        await expect(personPage.getByRole("button", { name: /Switch the tenant$/ })).toHaveCount(0);
        const sidebar = personPage.locator("[data-sidebar=sidebar]");
        await expect(sidebar.getByText(globex)).toHaveCount(0);
        await expect(sidebar.getByText(HOME, { exact: true })).toHaveCount(0);
        await expect(sidebar.getByRole("link", { name: "Tenants", exact: true })).toHaveCount(0);
    });

    await test.step("the connections and jobs of the home tenant are not theirs", async () => {
        await expectNothingOfHome();
    });
});

test("the home tenant gives Acme one database of its server", async () => {
    const home = new App(admin.request);
    await test.step("two databases on a server of the lab", async () => {
        for (const database of [given, kept]) {
            await dropIn(lab, "postgres", postgres.service, database);
            await psql("postgres", `CREATE DATABASE ${database};`);
            await psql(database, `CREATE TABLE owner (name text); INSERT INTO owner VALUES ('${database}');`);
        }
    });

    await test.step("its connection in the home tenant", async () => {
        const source = await createSource(home, postgres, tag);
        server = source.id;
        const tested = await home.testConnection(source.connection);
        expect(tested.success, tested.message).toBe(true);
    });

    await test.step("one database goes to Acme", async () => {
        const customers = await home.customersOf(server);
        const acmeId = customers.find((tenant) => tenant.name === acme)?.id;
        expect(acmeId, `Acme among ${JSON.stringify(customers)}`).toBeTruthy();
        expect(await home.assignDatabases(server, [{ database: given, tenantId: acmeId! }])).toEqual({ changed: 1 });
    });

    await test.step("Acme sees that database under Connections, Databases, and not the other one", async () => {
        await personPage.goto("/dashboard/connections?tab=databases");
        const row = personPage.getByRole("row").filter({ hasText: given });
        await expect(row).toBeVisible();
        await expect(row.getByRole("cell", { name: `${given} given to you`, exact: true })).toBeVisible();
        await expect(personPage.getByText(kept)).toHaveCount(0);
    });
});

test("the platform admin backs up the server in the home tenant", async () => {
    const home = new App(admin.request);
    const destination = await localDestination(home, tag);
    homeJobName = `${tag} shared server`;
    homeJob = await home.job(homeJobName, server, [destination], await home.vaultKey(E2E_KEY), "database", [given, kept]);
    const backup = await home.backUp(homeJob.id);
    expect(backup.status, problemOf(backup)).toBe("Success");
});

test("Acme finds the backup right after the run", async () => {
    await personPage.goto("/dashboard/backups");
    await expect(personPage.getByRole("row").filter({ hasText: given }).first()).toBeVisible({ timeout: 10_000 });
});

test("Acme sees and downloads the backup of its database and nothing else", async () => {
    const row = personPage.getByRole("row").filter({ hasText: given }).first();
    await test.step("Acme finds the backup of its database in Backups, shared with it", async () => {
        await personPage.goto("/dashboard/backups");
        await expect(row).toBeVisible();
        await expect(row.getByText("Shared", { exact: true })).toBeVisible();
        await expect(personPage.getByText(kept)).toHaveCount(0);
    });

    await test.step("and downloads its dump alone", async () => {
        await personPage.getByRole("button", { name: `Open menu for ${given}`, exact: true }).click();
        const downloading = personPage.waitForEvent("download");
        await personPage.getByRole("menuitem", { name: /^Download the dump/ }).click();
        const dump = readFileSync(await (await downloading).path(), "utf8");
        expect(dump).toContain(given);
        expect(dump).not.toContain(kept);
    });

    await test.step("still nothing of the home tenant itself", async () => {
        await expectNothingOfHome();
    });
});

test("Acme restores the backup of its database into it, and the home tenant sees the run", async () => {
    const rows = (database: string) => psql(database, "SELECT string_agg(name, ',' ORDER BY name) FROM owner");

    await test.step("both databases change after the backup", async () => {
        await psql(given, "DELETE FROM owner; INSERT INTO owner VALUES ('damaged');");
        await psql(kept, "INSERT INTO owner VALUES ('after the backup');");
    });

    await test.step("Acme restores its database from Backups, into itself", async () => {
        await personPage.goto("/dashboard/backups");
        await personPage.getByRole("button", { name: `Open menu for ${given}`, exact: true }).click();
        await personPage.getByRole("menuitem", { name: new RegExp(`^Restore into ${given}`) }).click();
        const dialog = personPage.getByRole("alertdialog", { name: `Restore ${given}` });
        await expect(dialog.getByText("Fixed", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: `Restore ${given}` }).click();
    });

    await test.step("the backup is back in that database, the other one stays as it is", async () => {
        await expect.poll(() => rows(given), { timeout: 3 * 60_000 }).toBe(given);
        expect(await rows(kept)).toBe(`after the backup,${kept}`);
    });

    await test.step("the History of Acme and of the home tenant each show the restore", async () => {
        const runs = async (context: BrowserContext) => JSON.stringify((await raw(context.request, "get", "/api/history/runs?type=Restore")).body);
        await expect.poll(() => runs(person), { timeout: 60_000 }).toContain(given);
        const theirs = await runs(person);
        // The customer's run names its database alone, never the server, the other database or the job.
        expect(theirs).not.toContain(kept);
        expect(theirs).not.toContain(homeJobName);
        await expect.poll(() => runs(admin), { timeout: 60_000 }).toContain(acme);
    });
});

test("a new tenant blocks the local network until the platform allows its range", async () => {
    const theirs = new App(person.request);
    const login = await theirs.credential(`${tag} login`, "USERNAME_PASSWORD", postgres.login!);
    const connection = { adapterId: postgres.adapterId, config: postgres.config(lab), primaryCredentialId: login };
    const addresses = await addressesInApp(postgres.service);
    expect(addresses.length, `${postgres.service} resolves inside DBackup`).toBeGreaterThan(0);

    await test.step("Test connection to the lab is refused for Acme", async () => {
        const tested = await raw(person.request, "post", "/api/adapters/test-connection", connection);
        const said = String(tested.body.message ?? tested.body.error ?? "");
        expect(said, JSON.stringify(tested)).toContain(`${acme} reaches no address of the local network`);
        expect(said).toContain(addresses[0].address);
        expect(tested.body.success).not.toBe(true);
    });

    await test.step("the platform admin allows the range of the lab in its Network part", async () => {
        // The network of the lab that DBackup and the server share, or the one address.
        const range = addresses[0].cidr ? networkOf(addresses[0].cidr) : `${addresses[0].address}/32`;
        await adminPage.goto("/dashboard/platform/tenants");
        await adminPage.getByRole("button", { name: `Open menu for ${acme}` }).click();
        await adminPage.getByRole("menuitem", { name: /^Edit/ }).click();
        const dialog = adminPage.getByRole("dialog", { name: `Edit ${acme}` });
        await dialog.getByRole("tab", { name: "Network", exact: true }).click();
        await expect(dialog.getByRole("switch", { name: "Block the local network" })).toBeChecked();
        await dialog.getByRole("textbox", { name: "Range to allow", exact: true }).fill(range);
        await dialog.getByRole("button", { name: "Add", exact: true }).click();
        await expect(dialog.getByRole("list", { name: "Allowed ranges" }).getByText(range, { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Save changes" }).click();
        await expect(dialog).toBeHidden();
    });

    await test.step("the same test now connects", async () => {
        const tested = await theirs.testConnection(connection);
        expect(tested.success, tested.message).toBe(true);
    });

    await test.step("Acme adds a job of its own", async () => {
        const source = await theirs.connection({ ...connection, name: `${tag} own postgres`, type: "database" });
        // An SFTP server of the lab, which the job never writes to here.
        const ssh = await theirs.credential(`${tag} sftp`, "SSH_KEY", { username: STORAGE.ssh.username, authType: "password", password: STORAGE.ssh.password });
        const target = await theirs.connection({ name: `${tag} own sftp`, type: "storage", adapterId: "sftp", config: { host: STORAGE.ssh.service, port: 22, pathPrefix: `${STORAGE.ssh.home}/backups/${tag}` }, primaryCredentialId: ssh });
        acmeJobName = `${tag} acme own`;
        const created = await raw(person.request, "post", "/api/jobs", {
            name: acmeJobName,
            schedule: "0 3 * * *",
            enabled: false,
            sourceId: source,
            databases: [],
            destinations: [{ configId: target, priority: 0, retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } }) }],
            compression: "GZIP",
        });
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    });
});

test("All tenants reads every tenant and changes none", async () => {
    await switchTo(adminPage, "All tenants");

    await test.step("the jobs of the home tenant and of Acme in one list", async () => {
        await adminPage.goto("/dashboard/jobs");
        await expect(adminPage.getByText(homeJobName, { exact: true }).first()).toBeVisible();
        await expect(adminPage.getByText(acmeJobName, { exact: true }).first()).toBeVisible();
        const jobs = await new App(admin.request).get<{ name: string }[]>("/api/jobs");
        expect(jobs.map((job) => job.name)).toEqual(expect.arrayContaining([homeJobName, acmeJobName]));
    });

    await test.step("a change through the API is refused", async () => {
        const created = await raw(admin.request, "post", "/api/adapters", { name: `${tag} refused`, type: "storage", adapterId: "local-filesystem", config: { basePath: `/data/e2e/${tag}/refused` } });
        expect(created.status, JSON.stringify(created.body)).toBe(403);
        expect(JSON.stringify(created.body)).toContain(ALL_TENANTS_REFUSAL);

        const run = await raw(admin.request, "post", `/api/jobs/${homeJob.id}/run`, {});
        expect(run.status, JSON.stringify(run.body)).toBe(403);
        expect(JSON.stringify(run.body)).toContain(ALL_TENANTS_REFUSAL);
    });
});

test("an empty tenant is deleted through the pages", async () => {
    await adminPage.goto("/dashboard/platform/tenants");
    await adminPage.getByRole("button", { name: `Open menu for ${globex}` }).click();
    await adminPage.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const dialog = adminPage.getByRole("alertdialog", { name: `Delete ${globex}?` });
    await dialog.getByLabel("I have the recovery kits of its keys, or do not need its backups").check();
    await dialog.getByRole("button", { name: "Delete tenant" }).click();
    await expect(adminPage.getByRole("button", { name: globex, exact: true })).toHaveCount(0);

    await adminPage.goto("/dashboard");
    await adminPage.getByRole("button", { name: /Switch the tenant$/ }).click();
    const menu = adminPage.getByRole("listbox", { name: "Suggestions" });
    await expect(menu.getByRole("option", { name: new RegExp(`^${acme}\\b`) })).toBeVisible();
    await expect(menu.getByRole("option", { name: new RegExp(`^${globex}\\b`) })).toHaveCount(0);
    await adminPage.keyboard.press("Escape");
});
