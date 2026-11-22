/**
 * Signing in through the provider of a tenant that blocks the local network. The plugin of
 * better-auth fetches the token, the user info and the keys from the provider, and those fetches
 * keep to the reach of the provider's tenant, so a provider in the local network signs nobody in
 * until the platform allows its range for that tenant.
 *
 * Dex of the lab stands in for the provider of a customer, under a domain of its own
 * (`DEX_TENANT_DOMAIN`), since the provider of the platform in auth-sso.spec.ts adds nobody of a
 * domain a tenant claims. Like there, each attempt of a retry takes its own provider ID and person.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEX, DEX_TENANT_DOMAIN, dexTenantPerson, dexTenantProviderId } from "../../../lab/src/catalog";
import { unique } from "../../support/app";
import { hasSession, paced, quietLimits } from "../../support/auth";
import { ADMIN_STATE, BASE_URL, PORT } from "../../support/environment";
import { allowRange, contextOptions, createTenant, keepSharedSessionHome, labRangeOf } from "../../support/tenants";

test.describe.configure({ mode: "serial" });

// The specs after this one sign in too, see `paced`.
test.afterAll(quietLimits);

const DEX_ORIGIN = new URL(DEX.issuer).origin;

/** The person a browser is signed in as, asked of better-auth with its cookies. */
async function sessionUser(page: Page): Promise<{ name: string; email: string } | null> {
    const response = await page.request.get("/api/auth/get-session");
    const body = (await response.text()).trim();
    return body && body !== "null" ? JSON.parse(body).user : null;
}

/** Types the email and the password into the login page of Dex, which sends the browser back to DBackup. */
async function signInAtDex(page: Page, email: string): Promise<void> {
    await expect(page.getByRole("heading", { name: "Log in to Your Account", exact: true })).toBeVisible();
    await page.getByLabel("Email Address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(DEX.password);
    await page.getByRole("button", { name: "Login", exact: true }).click();
}

test.describe("signing in through the provider of a tenant that blocks the local network", () => {
    // The client of Dex redirects to the port of the tests by default only.
    test.skip(PORT !== 3300, "The client of Dex in lab/compose/e2e.yml redirects to port 3300 only");

    let shared: Browser;
    let admin: BrowserContext;
    let adminPage: Page;
    let tenant = "";
    let name = "";
    let providerId = "";
    let person = dexTenantPerson(0);
    const browsers: BrowserContext[] = [];

    test.beforeAll(async ({ browser }, info) => {
        shared = browser;
        tenant = `Northwind ${unique()}`;
        name = `Dex of ${tenant}`;
        providerId = dexTenantProviderId(info.retry);
        person = dexTenantPerson(info.retry);
        admin = await browser.newContext({ ...contextOptions, storageState: ADMIN_STATE });
        adminPage = await admin.newPage();
    });

    test.afterAll(async () => {
        await Promise.all([admin, ...browsers].map((context) => context?.close()));
    });

    /** Types the email of the person on the login page of a browser of its own, which leads to the provider of its domain. */
    async function startSignIn(): Promise<Page> {
        const context = await shared.newContext(contextOptions);
        browsers.push(context);
        const page = await context.newPage();
        await page.goto("/");
        await page.getByLabel("Email", { exact: true }).fill(person.email);
        const go = page.getByRole("button", { name: `Continue with ${name}`, exact: true });
        await expect(go).toBeVisible();
        await paced("/sign-in/sso");
        await go.click();
        return page;
    }

    test("the platform admin adds Dex as the provider of a new tenant, which blocks the local network", async ({ browser }) => {
        await createTenant(adminPage, tenant);
        // The browser of the admin shares the session of the setup, which this keeps in the home tenant.
        await keepSharedSessionHome(browser);

        await adminPage.goto("/dashboard/users?tab=sso");
        await expect(adminPage.getByRole("button", { name: "New provider" }).first()).toBeVisible();
        await adminPage.waitForLoadState("networkidle");
        await adminPage.getByRole("button", { name: "New provider" }).first().click();
        const dialog = adminPage.getByRole("dialog", { name: "New sign-in provider" });
        await dialog.getByRole("button", { name: /^Any OpenID Connect provider/ }).click();

        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
        await dialog.getByRole("textbox", { name: "Provider ID", exact: true }).fill(providerId);
        await dialog.getByRole("textbox", { name: "Issuer URL", exact: true }).fill(DEX.issuer);
        await dialog.getByRole("textbox", { name: "Authorization Endpoint", exact: true }).fill(`${DEX.issuer}/auth`);
        await dialog.getByRole("textbox", { name: "Token Endpoint", exact: true }).fill(`${DEX.issuer}/token`);
        await dialog.getByRole("textbox", { name: "User Info Endpoint", exact: true }).fill(`${DEX.issuer}/userinfo`);
        await dialog.getByRole("textbox", { name: "JWKS Endpoint", exact: true }).fill(`${DEX.issuer}/keys`);
        await dialog.getByRole("textbox", { name: "Client ID", exact: true }).fill(DEX.clientId);
        await dialog.getByLabel("Client secret", { exact: true }).fill(DEX.clientSecret);

        await dialog.getByRole("combobox", { name: "Belongs to", exact: true }).click();
        await adminPage.getByRole("option", { name: new RegExp(`^${tenant}\\b`) }).click();
        await dialog.getByRole("textbox", { name: "Email domain", exact: true }).fill(DEX_TENANT_DOMAIN);
        await dialog.getByRole("combobox", { name: `They land in ${tenant} with the group`, exact: true }).click();
        await adminPage.getByRole("option", { name: /^Admin\b/ }).click();
        await dialog.getByRole("button", { name: "Create provider", exact: true }).click();
        await expect(adminPage.getByText(`${name} added`, { exact: true })).toBeVisible();
        await expect(dialog).toBeHidden();
    });

    test("its sign-in fails while the tenant reaches no address of the lab, and nobody is signed in", async () => {
        const page = await startSignIn();
        // The address of Dex lies in the local network, so its endpoints are not trusted for the
        // tenant, and the sign-in ends on the login page before it leaves for Dex.
        const alert = page.getByRole("alert").filter({ hasText: `${name} did not answer` });
        await expect(alert).toBeVisible();
        await expect(alert).toContainText("non-publicly-routable address");
        expect(new URL(page.url()).origin).toBe(BASE_URL);
        expect(await hasSession(page)).toBe(false);
    });

    test("once the platform allows the range of Dex for the tenant, the person signs in and joins it", async () => {
        await allowRange(adminPage, tenant, await labRangeOf(DEX.service));

        const page = await startSignIn();
        await page.waitForURL((url) => url.origin === DEX_ORIGIN);
        await signInAtDex(page, person.email);
        await page.waitForURL(/localhost:\d+\/dashboard/);
        expect(await sessionUser(page)).toMatchObject({ email: person.email });

        await adminPage.goto("/dashboard/platform/users");
        const row = adminPage.getByRole("row").filter({ hasText: person.email });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(tenant);
    });
});
