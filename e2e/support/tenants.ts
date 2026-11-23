/**
 * The steps of the tenant tests: a browser of its own per person, signing in, switching tenants in
 * the head of the sidebar, a tenant created through Platform, Tenants, a person made in a tenant
 * with New user and a range of the network allowed. Every tenant spec makes its own tenants with
 * names from `unique()`, so they run in any order beside each other.
 */

import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STATE, BASE_URL, lab } from "./environment";
import { execIn } from "../../lab/src/docker";

export const HOME = "Default";

/** A browser without a session. A context of the browser fixture takes the session of the project otherwise. */
export const contextOptions = { baseURL: BASE_URL, locale: "en-US", storageState: { cookies: [], origins: [] } };

/** A password that follows the Standard rules and holds no word of the names of the tests. */
export const PASSWORD = "Harbor-Violet-3816";

export async function signIn(page: Page, email: string, password: string): Promise<void> {
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // A new instance moves on from the Overview to Quick Setup.
    await page.waitForURL(/\/dashboard/);
    await page.waitForLoadState("networkidle");
}

/** A browser of its own, signed in as that person. */
export async function personBrowser(browser: Browser, email: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await signIn(page, email, password);
    return { context, page };
}

/** Picks a tenant, or All tenants, in the menu of the head of the sidebar. */
export async function switchTo(page: Page, tenant: string): Promise<void> {
    if (!page.url().includes("/dashboard")) await page.goto("/dashboard");
    const switcher = page.getByRole("button", { name: /Switch the tenant$/ });
    // Picking the tenant the session works in already says nothing.
    if (new RegExp(`^${tenant}[ ,]`).test((await switcher.getAttribute("aria-label")) ?? (await switcher.innerText()))) return;
    await switcher.click();
    const menu = page.getByRole("listbox", { name: "Suggestions" });
    await menu.getByRole("option", { name: new RegExp(`^${tenant}\\b`) }).click();
    const said = tenant === "All tenants" ? "You see every tenant now" : `You work in ${tenant} now`;
    await expect(page.getByText(said)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^${tenant}[ ,]`) })).toBeVisible();
}

/**
 * Keeps the session of the setup, which every other project shares, in the home tenant. With more
 * than one tenant a platform admin starts in All tenants, which changes nothing, so a spec that
 * creates a tenant picks the home tenant for it once.
 */
export async function keepSharedSessionHome(browser: Browser): Promise<void> {
    const shared = await browser.newContext({ ...contextOptions, storageState: ADMIN_STATE });
    try {
        await switchTo(await shared.newPage(), HOME);
    } finally {
        await shared.close();
    }
}

/** Creates a tenant through Platform, Tenants and closes Edit, which opens next on its members. */
export async function createTenant(page: Page, name: string): Promise<void> {
    await page.goto("/dashboard/platform/tenants");
    await page.getByRole("button", { name: "New tenant" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New tenant" });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create tenant" }).click();
    await expect(page.getByText(`${name} is created`)).toBeVisible();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await edit.getByRole("heading", { name: "Members", exact: true }).waitFor({ timeout: 5_000 }).then(
        async () => {
            await edit.getByRole("button", { name: "Close", exact: true }).last().click();
            await expect(edit).toBeHidden();
        },
        () => undefined,
    );
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

/** Makes a person who works in a tenant with its Admin group, through New user of the platform. */
export async function newPerson(page: Page, person: { name: string; email: string; password: string }, tenant: string, group = "Admin"): Promise<void> {
    await page.goto("/dashboard/platform/users");
    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog", { name: "New user" });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(person.name);
    await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(person.email);
    await dialog.getByLabel("Password", { exact: true }).fill(person.password);
    await dialog.getByRole("combobox", { name: "Tenant", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(`^${tenant}\\b`) }).click();
    await dialog.getByRole("combobox", { name: "Group in the tenant", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(`^${group}\\b`) }).click();
    await dialog.getByRole("button", { name: "Create user" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: person.name, exact: true })).toBeVisible();
}

/** Opens Edit of a tenant on Platform, Tenants. */
export async function editTenant(page: Page, tenant: string) {
    await page.goto("/dashboard/platform/tenants");
    await page.getByRole("button", { name: `Open menu for ${tenant}` }).click();
    await page.getByRole("menuitem", { name: /^Edit/ }).click();
    return page.getByRole("dialog", { name: `Edit ${tenant}` });
}

/** Lets a tenant reach one range of the local network, in its Network part, while it blocks the rest. */
export async function allowRange(page: Page, tenant: string, range: string): Promise<void> {
    const dialog = await editTenant(page, tenant);
    await dialog.getByRole("tab", { name: "Network", exact: true }).click();
    await expect(dialog.getByRole("switch", { name: "Block the local network" })).toBeChecked();
    await dialog.getByRole("textbox", { name: "Range to allow", exact: true }).fill(range);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("list", { name: "Allowed ranges" }).getByText(range, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
}

/** A request whose refusal the test reads itself, where `App` would fail on it. */
export async function raw(request: APIRequestContext, method: "get" | "post" | "put" | "patch" | "delete", url: string, data?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await request[method](url, data === undefined ? {} : { data });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { text: text.slice(0, 500) };
    }
    return { status: response.status(), body };
}

/**
 * The IPv4 addresses a name resolves to inside DBackup, the way its connections see it, each with
 * the range of the network of DBackup it lies in, null when none.
 */
export async function addressesInApp(host: string): Promise<{ address: string; cidr: string | null }[]> {
    const script = [
        `const dns = require("dns"), os = require("os")`,
        `const value = (ip) => ip.split(".").reduce((all, part) => all * 256 + Number(part), 0)`,
        `const inNet = (address, net) => { const size = 2 ** (32 - Number(net.cidr.split("/")[1])); return Math.floor(value(address) / size) === Math.floor(value(net.address) / size) }`,
        `const nets = Object.values(os.networkInterfaces()).flat().filter((net) => net.family === "IPv4" && !net.internal)`,
        `dns.lookup(${JSON.stringify(host)}, { all: true, family: 4 }, (error, list) => { if (error) throw error; console.log(JSON.stringify(list.map(({ address }) => ({ address, cidr: nets.find((net) => inNet(address, net))?.cidr ?? null })))) })`,
    ].join("\n");
    const result = await execIn(lab, "app", "node -", script, 30_000);
    expect(result.code, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout.trim());
}

/** The network part of a CIDR range like 172.20.0.7/16, as 172.20.0.0/16. */
export function networkOf(cidr: string): string {
    const [address, bits] = cidr.split("/");
    const value = address.split(".").reduce((all, part) => all * 256 + Number(part), 0);
    const size = 2 ** (32 - Number(bits));
    const base = Math.floor(value / size) * size;
    return `${[24, 16, 8, 0].map((shift) => Math.floor(base / 2 ** shift) % 256).join(".")}/${bits}`;
}

/** The range of the network of the lab that DBackup and a service share, or the one address of it. */
export async function labRangeOf(service: string): Promise<string> {
    const addresses = await addressesInApp(service);
    expect(addresses.length, `${service} resolves inside DBackup`).toBeGreaterThan(0);
    return addresses[0].cidr ? networkOf(addresses[0].cidr) : `${addresses[0].address}/32`;
}
