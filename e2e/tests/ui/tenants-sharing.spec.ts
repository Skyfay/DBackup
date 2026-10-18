/**
 * A destination and a channel the home tenant shares with a customer: the customer backs up a
 * server of its own to the destination and hears about the run through the channel, at the
 * address it names itself. Its backup lands in its folder of the destination, which the provider
 * never sees, while the provider keeps its own backups there. Then the customer deletes its job
 * and finds it in its own Recently deleted, never in the one of the provider.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { NOTIFY } from "../../../lab/src/catalog";
import { App, problemOf, unique, type Execution } from "../../support/app";
import { inApp, sqliteInApp } from "../../support/backups";
import { ADMIN, lab } from "../../support/environment";
import { FAMILIES, type Target } from "../../support/targets";
import { HOME, PASSWORD, allowRange, contextOptions, createTenant, keepSharedSessionHome, labRangeOf, newPerson, personBrowser, raw, signIn, switchTo } from "../../support/tenants";

test.describe.configure({ mode: "serial" });

const tag = unique();
const customer = `Initech ${tag}`;
const person = { name: "Ida Initech", email: `${tag}@initech.e2e.dbackup.test`, password: PASSWORD };
/** Where the customer wants the mail of its runs, and where the provider gets its own. */
const customerInbox = `${tag}-ops@initech.e2e.dbackup.test`;
const providerInbox = `${tag}-noc@provider.e2e.dbackup.test`;
const folder = `/data/e2e/${tag}/shared`;
const destinationName = `${tag} shared storage`;
const channelName = `${tag} shared mail`;
const templateName = `${tag} customer alerts`;
const customerJob = `${tag} customer nightly`;

const postgres: Target = FAMILIES.find((family) => family.name === "postgres")!.targets.find((target) => target.key === "postgres-18")!;

let admin: BrowserContext;
let adminPage: Page;
let customerContext: BrowserContext;
let customerPage: Page;
let destinationId = "";
let providerBackup: Execution;
let customerBackup: Execution;
let customerJobId = "";

/** How many mails Mailpit holds for an address. */
async function mailsTo(address: string): Promise<number> {
    const response = await fetch(`http://${lab.docker.address}:${NOTIFY.mailpit.uiPort}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    return ((await response.json()) as { messages_count: number }).messages_count;
}

/** Shares a connection of the home tenant with the customer alone, through its menu under Connections. */
async function share(tab: "destinations" | "notifications", name: string): Promise<void> {
    await adminPage.goto(`/dashboard/connections?tab=${tab}`);
    await adminPage.getByRole("button", { name: `Open menu for ${name}` }).click();
    await adminPage.getByRole("menuitem", { name: "Share with tenants" }).click();
    const dialog = adminPage.getByRole("dialog", { name: `Share ${name}` });
    await dialog.getByRole("radio", { name: /^Picked tenants/ }).check();
    await dialog.getByRole("checkbox", { name: new RegExp(`^${customer} `) }).check();
    await dialog.getByRole("button", { name: "Share with 1 tenant" }).click();
    await expect(adminPage.getByText(`${name} is shared with 1 tenant`)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext(contextOptions);
    adminPage = await admin.newPage();
    await signIn(adminPage, ADMIN.email, ADMIN.password);
});

test.afterAll(async () => {
    await admin?.close();
    await customerContext?.close();
});

test("the platform admin sets up a customer that reaches one server of the lab", async ({ browser }) => {
    await createTenant(adminPage, customer);
    await keepSharedSessionHome(browser);
    await switchTo(adminPage, HOME);
    await newPerson(adminPage, person, customer);
    await allowRange(adminPage, customer, await labRangeOf(postgres.service));
});

test("the home tenant backs up to a destination and shares it and a mail channel with the customer", async () => {
    const home = new App(admin.request);
    await test.step("a destination with a backup of the home tenant on it", async () => {
        destinationId = await home.connection({ name: destinationName, type: "storage", adapterId: "local-filesystem", config: { basePath: folder } });
        const source = await home.connection({ name: `${tag} home sqlite`, type: "database", adapterId: "sqlite", config: { mode: "local", path: await sqliteInApp(tag) } });
        const job = await home.job(`${tag} home nightly`, source, [destinationId], await home.vaultKey());
        providerBackup = await home.backUp(job.id);
        expect(providerBackup.status, problemOf(providerBackup)).toBe("Success");
    });

    await test.step("a mail channel of the home tenant", async () => {
        const login = await home.credential(`${tag} smtp`, "SMTP", { user: "lab", password: "lab-password" });
        await home.connection({
            name: channelName,
            type: "notification",
            adapterId: "email",
            config: { host: NOTIFY.mailpit.service, port: 1025, secure: "none", from: "dbackup-e2e@dbackup.test", to: [providerInbox] },
            primaryCredentialId: login,
        });
    });

    await test.step("both shared with the customer alone", async () => {
        await share("destinations", destinationName);
        await share("notifications", channelName);
    });
});

test("the customer names its own recipient for the shared channel", async ({ browser }) => {
    ({ context: customerContext, page: customerPage } = await personBrowser(browser, person.email, person.password));
    await customerPage.goto("/dashboard/connections?tab=notifications");
    const row = customerPage.getByRole("row").filter({ hasText: channelName });
    await expect(row.getByRole("cell", { name: HOME, exact: true })).toBeVisible();
    await expect(row.getByText("No recipients yet")).toBeVisible();

    await row.getByRole("button", { name: channelName, exact: true }).click();
    const details = customerPage.getByRole("dialog", { name: channelName });
    await details.getByRole("button", { name: "Recipients" }).click();
    const recipients = customerPage.getByRole("dialog", { name: `Recipients of ${channelName}` });
    await recipients.getByRole("textbox", { name: "To", exact: true }).fill(customerInbox);
    await recipients.getByRole("textbox", { name: "To", exact: true }).press("Enter");
    await recipients.getByRole("button", { name: "Save changes" }).click();
    await expect(recipients).toBeHidden();
    await details.getByRole("button", { name: "Close", exact: true }).last().click();
    await customerPage.reload();
    await expect(customerPage.getByRole("row").filter({ hasText: channelName }).getByText(customerInbox)).toBeVisible();
});

test("the customer's job writes into its folder of the shared destination and mails it through the shared channel", async () => {
    const own = new App(customerContext.request);

    await test.step("a notification template that names the shared channel", async () => {
        await customerPage.goto("/dashboard/templates?tab=notifications");
        await customerPage.getByRole("tab", { name: "Notifications" }).click();
        await customerPage.getByRole("button", { name: /^New/ }).first().click();
        const dialog = customerPage.getByRole("dialog", { name: "New notification template" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(templateName);
        await dialog.getByRole("combobox", { name: "Channel 1" }).click();
        await customerPage.getByRole("option", { name: new RegExp(channelName) }).click();
        await dialog.getByRole("button", { name: "Create template" }).click();
        await expect(dialog).toBeHidden();
    });

    await test.step("a job of its own server to the shared destination", async () => {
        const login = await own.credential(`${tag} customer login`, "USERNAME_PASSWORD", postgres.login!);
        const source = await own.connection({ name: `${tag} customer postgres`, type: "database", adapterId: postgres.adapterId, config: postgres.config(lab), primaryCredentialId: login });
        const templates = JSON.stringify(await own.get("/api/templates"));
        const templateId = new RegExp(`"id":"([^"]+)","name":"${templateName}"`).exec(templates)?.[1];
        expect(templateId, `${templateName} among the templates of the customer`).toBeTruthy();
        const created = await raw(customerContext.request, "post", "/api/jobs", {
            name: customerJob,
            schedule: "0 3 * * *",
            enabled: false,
            sourceId: source,
            databases: ["shop"],
            destinations: [{ configId: destinationId, priority: 0, retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } }) }],
            compression: "GZIP",
            notificationTemplateIds: [templateId],
        });
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        customerJobId = String(created.body.id);
    });

    await test.step("Run now writes the backup into the folder of the customer", async () => {
        customerBackup = await own.backUp(customerJobId);
        expect(customerBackup.status, problemOf(customerBackup)).toBe("Success");
        const listed = (await own.files(destinationId)).map((file) => file.path);
        expect(listed).toContain(customerBackup.path);
        expect(listed).not.toContain(providerBackup.path);
        const onDisk = (await inApp(`cd '${folder}' && find . -type f -name '*.tar'`)).trim().split("\n");
        expect(onDisk.filter((file) => file.startsWith("./tenants/") && file.includes(customerJob)), onDisk.join("\n")).toHaveLength(1);
    });

    await test.step("the mail goes to the address of the customer, never to the provider's", async () => {
        await expect.poll(() => mailsTo(customerInbox), { timeout: 30_000 }).toBeGreaterThan(0);
        expect(await mailsTo(providerInbox)).toBe(0);
    });
});

test("the provider keeps its own backups on the destination and never sees the customer's", async () => {
    const home = new App(admin.request);
    const listed = (await home.files(destinationId)).map((file) => file.path);
    expect(listed).toContain(providerBackup.path);
    expect(listed.filter((path) => path.startsWith("tenants") || path.includes(customerJob))).toEqual([]);

    await adminPage.goto("/dashboard/backups");
    await adminPage.waitForLoadState("networkidle");
    await expect(adminPage.getByText(customerJob)).toHaveCount(0);
});

test("a job the customer deletes waits in its own Recently deleted and comes back from there", async () => {
    await test.step("the customer deletes its job", async () => {
        const deleted = await raw(customerContext.request, "delete", `/api/jobs/${customerJobId}`);
        expect(deleted.status, JSON.stringify(deleted.body)).toBeLessThan(300);
        const jobs = await new App(customerContext.request).get<{ name: string }[]>("/api/jobs");
        expect(jobs.map((job) => job.name)).not.toContain(customerJob);
    });

    await test.step("the Recently deleted of the provider does not show it", async () => {
        await adminPage.goto("/dashboard/settings?part=recently-deleted");
        await expect(adminPage.getByRole("heading", { name: "Recently deleted" })).toBeVisible();
        await adminPage.waitForLoadState("networkidle");
        await expect(adminPage.getByText(customerJob)).toHaveCount(0);
    });

    await test.step("the customer restores it from its Recently deleted", async () => {
        await customerPage.goto("/dashboard/settings?part=recently-deleted");
        const region = customerPage.getByRole("region", { name: "Recently deleted" });
        await expect(region.getByText(customerJob).first()).toBeVisible();
        await region.getByRole("button", { name: `Open menu for ${customerJob}` }).click();
        await customerPage.getByRole("menuitem", { name: "Restore", exact: true }).click();
        await expect(region.getByText(customerJob)).toHaveCount(0);
        const jobs = await new App(customerContext.request).get<{ id: string; name: string }[]>("/api/jobs");
        expect(jobs.find((job) => job.name === customerJob)?.id).toBe(customerJobId);
    });
});
