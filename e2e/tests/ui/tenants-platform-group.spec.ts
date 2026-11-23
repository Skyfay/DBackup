/**
 * A platform group of selected tenants: the platform admin makes three customers and gives a
 * person of the MSP the rights of a service desk in two of them. That person opens, sees and
 * changes those two alone, through the pages and through the API, and the third one stays out of
 * sight, with its saved login and its person.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { App, unique } from "../../support/app";
import { ADMIN } from "../../support/environment";
import { HOME, PASSWORD, allowRange, contextOptions, createTenant, keepSharedSessionHome, newPerson, raw, signIn, switchTo } from "../../support/tenants";

test.describe.configure({ mode: "serial" });

const tag = unique();
const north = `North ${tag}`;
const east = `East ${tag}`;
const south = `South ${tag}`;
const deskGroup = `Desk ${tag}`;
const desk = { name: "Dana Desk", email: `${tag}@desk.e2e.dbackup.test` };
const northPerson = { name: "Nora North", email: `${tag}@north.e2e.dbackup.test` };
const southPerson = { name: "Sid South", email: `${tag}@south.e2e.dbackup.test` };

let admin: BrowserContext;
let adminPage: Page;
let deskContext: BrowserContext;
let deskPage: Page;
/** The saved login made in each customer, by the tenant. */
const logins = new Map<string, string>();

test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext(contextOptions);
    adminPage = await admin.newPage();
    await signIn(adminPage, ADMIN.email, ADMIN.password);
});

test.afterAll(async () => {
    await admin?.close();
    await deskContext?.close();
});

test("the platform admin makes three customers and a platform group of two of them", async ({ browser }) => {
    await test.step("three customers, each with a saved login, two of them with a person", async () => {
        for (const tenant of [north, east, south]) await createTenant(adminPage, tenant);
        await keepSharedSessionHome(browser);
        await newPerson(adminPage, { ...northPerson, password: PASSWORD }, north);
        await newPerson(adminPage, { ...southPerson, password: PASSWORD }, south);
        for (const tenant of [north, south]) {
            await switchTo(adminPage, tenant);
            logins.set(tenant, await new App(admin.request).credential(`${tag} ${tenant} login`, "USERNAME_PASSWORD", { username: "desk", password: "not-a-real-password" }));
        }
        await switchTo(adminPage, HOME);
    });

    await test.step("a platform group of North and East, never the home tenant", async () => {
        await adminPage.goto("/dashboard/platform/users");
        await adminPage.getByRole("tab", { name: "Platform groups" }).click();
        await adminPage.getByRole("button", { name: "New platform group" }).click();
        await adminPage.getByRole("button", { name: /^Custom/ }).click();
        const dialog = adminPage.getByRole("dialog", { name: "New platform group" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(deskGroup);
        const level = async (area: string, to: string) => {
            await dialog.getByRole("navigation", { name: "Areas" }).getByRole("button", { name: new RegExp(`^${area} `) }).click();
            await dialog.getByRole("radiogroup", { name: `Level of ${area}` }).getByRole("radio", { name: to, exact: true }).click();
        };
        await level("Tenants", "Change");
        await level("Accounts", "See");
        await dialog.getByRole("navigation", { name: "Areas" }).getByRole("button", { name: /^Where / }).click();
        await dialog.getByRole("radio", { name: /^Selected tenants/ }).click();
        for (const tenant of [north, east]) await dialog.getByRole("checkbox", { name: new RegExp(`^${tenant} `) }).check();
        await level("Vault", "Change");
        await level("Connections", "See");
        await dialog.getByRole("button", { name: "Create group" }).click();
        await expect(dialog).toBeHidden();
        await expect(adminPage.getByRole("button", { name: deskGroup, exact: true })).toBeVisible();
    });

    await test.step("a person of the MSP in it, in no tenant", async () => {
        await adminPage.goto("/dashboard/platform/users");
        await adminPage.getByRole("button", { name: "New user" }).click();
        const dialog = adminPage.getByRole("dialog", { name: "New user" });
        await dialog.getByRole("radio", { name: /^Runs the platform/ }).click();
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(desk.name);
        await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(desk.email);
        await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
        await dialog.getByRole("combobox", { name: "Platform group", exact: true }).click();
        await adminPage.getByRole("option", { name: new RegExp(`^${deskGroup}`) }).click();
        await dialog.getByRole("button", { name: "Create user" }).click();
        await expect(dialog).toBeHidden();
        await expect(adminPage.getByRole("button", { name: desk.name, exact: true })).toBeVisible();
    });
});

test("its person opens the two tenants of the group and no other", async ({ browser }) => {
    deskContext = await browser.newContext(contextOptions);
    deskPage = await deskContext.newPage();
    await signIn(deskPage, desk.email, PASSWORD);

    await test.step("the switcher lists North and East, not South, the home tenant or All tenants", async () => {
        await deskPage.getByRole("button", { name: /Switch the tenant$/ }).click();
        const menu = deskPage.getByRole("listbox", { name: "Suggestions" });
        await expect(menu.getByRole("option", { name: new RegExp(`^${north}\\b`) })).toBeVisible();
        await expect(menu.getByRole("option", { name: new RegExp(`^${east}\\b`) })).toBeVisible();
        await expect(menu.getByRole("option", { name: new RegExp(`^${south}\\b`) })).toHaveCount(0);
        await expect(menu.getByRole("option", { name: new RegExp(`^${HOME}\\b`) })).toHaveCount(0);
        await expect(menu.getByRole("option", { name: /^All tenants\b/ })).toHaveCount(0);
        await deskPage.keyboard.press("Escape");
    });

    await test.step("Platform, Tenants lists the two and offers no New tenant", async () => {
        await deskPage.goto("/dashboard/platform/tenants");
        await expect(deskPage.getByRole("button", { name: north, exact: true })).toBeVisible();
        await expect(deskPage.getByRole("button", { name: east, exact: true })).toBeVisible();
        await expect(deskPage.getByRole("button", { name: south, exact: true })).toHaveCount(0);
        await expect(deskPage.getByRole("button", { name: "New tenant" })).toHaveCount(0);
    });

    await test.step("the saved login of North shows in its Vault, the one of South nowhere", async () => {
        await switchTo(deskPage, north);
        await deskPage.goto("/dashboard/vault?tab=credentials");
        await expect(deskPage.getByText(`${tag} ${north} login`, { exact: true }).first()).toBeVisible();
        await expect(deskPage.getByText(`${tag} ${south} login`, { exact: true })).toHaveCount(0);
    });
});

test("through the API it reads and changes only the tenants of the group", async () => {
    const own = new App(deskContext.request);

    await test.step("the saved logins of North, without the one of South", async () => {
        const result = await raw(deskContext.request, "get", "/api/credentials");
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        const ids = JSON.stringify(result.body);
        expect(ids).toContain(logins.get(north)!);
        expect(ids).not.toContain(logins.get(south)!);
    });

    await test.step("a new saved login in North", async () => {
        const id = await own.credential(`${tag} desk login`, "USERNAME_PASSWORD", { username: "desk", password: "not-a-real-password" });
        expect(id).toBeTruthy();
    });

    await test.step("the saved login of South neither reads nor changes nor goes", async () => {
        const southId = logins.get(south)!;
        expect((await raw(deskContext.request, "get", `/api/credentials/${southId}`)).status).toBe(404);
        expect((await raw(deskContext.request, "put", `/api/credentials/${southId}`, { name: `${tag} taken over` })).status).toBe(404);
        // The group may not delete saved logins at all, so the route refuses before it looks.
        expect([403, 404]).toContain((await raw(deskContext.request, "delete", `/api/credentials/${southId}`)).status);
        await switchTo(adminPage, south);
        const still = await raw(admin.request, "get", `/api/credentials/${southId}`);
        expect(JSON.stringify(still.body)).toContain(`${tag} ${south} login`);
        await switchTo(adminPage, HOME);
    });

    await test.step("the tenants of the API: North and East, South neither reads nor changes", async () => {
        const named = (body: Record<string, unknown>) => (body.data as { id: string; name: string }[]).map((tenant) => [tenant.name, tenant.id] as const);
        const every = new Map(named((await raw(admin.request, "get", "/api/tenants")).body));
        const seen = await raw(deskContext.request, "get", "/api/tenants");
        expect(seen.status, JSON.stringify(seen.body)).toBe(200);
        expect(named(seen.body).map(([name]) => name).sort()).toEqual([east, north].sort());

        const southId = every.get(south)!;
        expect((await raw(deskContext.request, "get", `/api/tenants/${southId}`)).status).toBe(404);
        expect((await raw(deskContext.request, "patch", `/api/tenants/${southId}`, { name: `${south} taken` })).status).toBe(404);
        expect((await raw(deskContext.request, "post", "/api/tenants", { name: `${tag} of the desk` })).status).toBe(403);
        const changed = await raw(deskContext.request, "patch", `/api/tenants/${every.get(north)}`, { onDemandPerDay: 2 });
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
        expect(named((await raw(admin.request, "get", "/api/tenants")).body).map(([name]) => name)).toEqual(expect.arrayContaining([south]));
    });

    await test.step("the accounts of the platform: the person of North, never the one of South", async () => {
        const result = await raw(deskContext.request, "get", "/api/platform/users");
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        const emails = ((result.body.data as { users: { email: string }[] }).users).map((user) => user.email);
        expect(emails).toContain(northPerson.email);
        expect(emails).not.toContain(southPerson.email);
    });
});

test("through the pages it changes a tenant of the group", async () => {
    await allowRange(deskPage, east, "10.99.0.0/24");
    await deskPage.goto("/dashboard/platform/tenants");
    await expect(deskPage.getByRole("row").filter({ hasText: east }).getByText(/Blocked/)).toBeVisible();
});
