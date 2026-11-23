/**
 * Signing in through an OpenID Connect provider: Dex of the lab, added by the platform admin as
 * Any OpenID Connect provider on the SSO tab, then someone new it adds to its group, someone with
 * an account of the same email it links, and the provider switched off. Each person signs in in a
 * browser of their own, which reaches Dex by the name DBackup reaches it under, see `DEX_HOST_RULE`.
 *
 * Dex knows its people and its one client from lab/compose/e2e.yml, so their emails and the
 * provider ID are fixed. A retry in CI runs the tests again on the same instance, so every attempt
 * takes the provider ID and the people of its own number, see `dexPerson`.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEX, dexPerson, dexProviderId } from "../../../lab/src/catalog";
import { unique } from "../../support/app";
import { hasSession, makePerson, paced, quietLimits, type Person } from "../../support/auth";
import { ADMIN_STATE, BASE_URL, PORT } from "../../support/environment";
import { contextOptions } from "../../support/tenants";

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
    await page.waitForURL((url) => url.origin === DEX_ORIGIN);
    await expect(page.getByRole("heading", { name: "Log in to Your Account", exact: true })).toBeVisible();
    await page.getByLabel("Email Address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(DEX.password);
    await page.getByRole("button", { name: "Login", exact: true }).click();
}

/** Opens the sign-in providers, the SSO tab, or Platform with more than one tenant, where the tab leads then. */
async function openProviders(page: Page): Promise<void> {
    await page.goto("/dashboard/users?tab=sso");
    await expect(page.getByRole("button", { name: "New provider" }).first()).toBeVisible();
}

test.describe("signing in through an OpenID Connect provider", () => {
    // The client of Dex redirects to the port of the tests by default only.
    test.skip(PORT !== 3300, "The client of Dex in lab/compose/e2e.yml redirects to port 3300 only");

    let providerId = "";
    let name = "";
    let newcomer = dexPerson("newcomer", 0);
    let member: Person;
    let shared: Browser;
    /** The platform admin, with the session of the setup. */
    let admin: BrowserContext;
    let adminPage: Page;
    const browsers: BrowserContext[] = [];

    test.beforeAll(async ({ browser }, info) => {
        shared = browser;
        providerId = dexProviderId(info.retry);
        name = `Dex ${unique()}`;
        newcomer = dexPerson("newcomer", info.retry);
        admin = await browser.newContext({ ...contextOptions, storageState: ADMIN_STATE });
        adminPage = await admin.newPage();
        const known = dexPerson("member", info.retry);
        member = await makePerson(browser, "Sam Single", known.email);
    });

    test.afterAll(async () => {
        await Promise.all([admin, ...browsers].map((context) => context?.close()));
    });

    /** A browser of its own without a session, on the login page. */
    async function visitor(): Promise<Page> {
        const context = await shared.newContext(contextOptions);
        browsers.push(context);
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
        return page;
    }

    /** Presses the button of the provider on the login page, which leaves for Dex. */
    async function startSignIn(page: Page): Promise<void> {
        await paced("/sign-in/sso");
        await page.getByRole("button", { name: `Continue with ${name}`, exact: true }).click();
    }

    test("the platform admin adds Dex as Any OpenID Connect provider and the login page shows its button", async () => {
        await openProviders(adminPage);
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
        // The box beside the fields names the redirect URI the client of Dex allows.
        await expect(dialog.getByText(`http://localhost:${PORT}/api/auth/sso/callback/${providerId}`, { exact: true })).toBeVisible();

        await expect(dialog.getByRole("switch", { name: /^Add new people on their first sign-in/ })).toBeChecked();
        await dialog.getByRole("combobox", { name: /^(Group of new people|They land in .+ with the group)$/ }).click();
        await adminPage.getByRole("option", { name: /^Admin\b/ }).click();
        await dialog.getByRole("button", { name: "Create provider", exact: true }).click();
        await expect(adminPage.getByText(`${name} added`, { exact: true })).toBeVisible();
        await expect(dialog).toBeHidden();

        const page = await visitor();
        await expect(page.getByRole("button", { name: `Continue with ${name}`, exact: true })).toBeVisible();
    });

    test("someone new signs in through it, asked for openid, profile and email only, and lands in its group", async () => {
        const page = await visitor();
        const authorization = page.waitForRequest((request) => request.url().startsWith(`${DEX.issuer}/auth?`));
        await startSignIn(page);
        const asked = new URL((await authorization).url()).searchParams;
        expect(asked.get("client_id")).toBe(DEX.clientId);
        expect(asked.get("redirect_uri")).toBe(`http://localhost:${PORT}/api/auth/sso/callback/${providerId}`);
        // DBackup needs no refresh token, and Google refuses offline_access (#198).
        expect(asked.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);

        await signInAtDex(page, newcomer.email);
        await page.waitForURL(/localhost:\d+\/dashboard/);
        expect(await sessionUser(page)).toMatchObject({ email: newcomer.email, name: newcomer.name });

        // The new account works in the home tenant with the group the provider names.
        await adminPage.goto("/dashboard/platform/users");
        const row = adminPage.getByRole("row").filter({ hasText: newcomer.email });
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("Admin");
    });

    test("someone with an account of the same email signs in to that account", async () => {
        const page = await visitor();
        await startSignIn(page);
        await signInAtDex(page, member.email);
        await page.waitForURL(/localhost:\d+\/dashboard/);
        // The account the platform admin made, not a new one under the name Dex knows.
        expect(await sessionUser(page)).toMatchObject({ email: member.email, name: member.name });
        await expect(page.getByRole("button", { name: new RegExp(member.name) })).toBeVisible();

        await adminPage.goto("/dashboard/platform/users");
        await expect(adminPage.getByRole("row").filter({ hasText: member.email })).toHaveCount(1);
    });

    test("a provider that is off signs nobody in, also not someone on the way at the provider", async () => {
        // On the way: the button leads to Dex before the provider goes off.
        const onTheWay = await visitor();
        await startSignIn(onTheWay);
        await onTheWay.waitForURL((url) => url.origin === DEX_ORIGIN);

        // The newcomer signs in only through it, so Disable asks first and names them.
        await openProviders(adminPage);
        await adminPage.getByRole("button", { name: `Open menu for ${name}`, exact: true }).first().click();
        await adminPage.getByRole("menuitem", { name: "Disable", exact: true }).click();
        // A ConfirmDialog, so an alertdialog. It names the person in a sentence and in a row of its own.
        const confirm = adminPage.getByRole("alertdialog", { name: `Disable ${name}?` });
        await expect(confirm.getByText(newcomer.name, { exact: true })).toBeVisible();
        await confirm.getByRole("button", { name: "Disable provider", exact: true }).click();
        await expect(adminPage.getByText(`${name} disabled`, { exact: true })).toBeVisible();

        await signInAtDex(onTheWay, member.email);
        await onTheWay.waitForURL((url) => url.origin === BASE_URL && url.searchParams.get("error") === "sso_access_denied");
        await expect(onTheWay.getByText("Access denied", { exact: true })).toBeVisible();
        expect(await hasSession(onTheWay)).toBe(false);

        // The button is gone, and a start of its sign-in without it is refused.
        const page = await visitor();
        await expect(page.getByRole("button", { name: `Continue with ${name}`, exact: true })).toHaveCount(0);
        await paced("/sign-in/sso");
        const refused = await page.evaluate(async (id) => {
            const response = await fetch("/api/auth/sign-in/sso", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerId: id, callbackURL: "/dashboard" }),
            });
            return { status: response.status, body: await response.text() };
        }, providerId);
        expect(refused.status).toBe(403);
        expect(JSON.parse(refused.body)).toMatchObject({ code: "SSO_PROVIDER_DISABLED" });
        expect(await hasSession(page)).toBe(false);
    });
});
