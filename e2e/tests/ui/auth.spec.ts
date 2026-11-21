/**
 * Signing in with the password and with the authenticator app as the second factor, each person
 * made fresh by the platform admin and signed in in a browser of their own. The code of the app is
 * worked out from the key the setup shows, like an app does it. The passkeys are in
 * `auth-passkeys.spec.ts`.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { contextOptions } from "../../support/tenants";
import { hasSession, makePerson, openSecurity, paced, quietLimits, signInPaced, signOut, submitPassword, totp, wrongCode, type Person } from "../../support/auth";

test.describe.configure({ mode: "serial" });

// The specs after this one sign in too, see `paced`.
test.afterAll(quietLimits);

test.describe("the password", () => {
    let person: Person;
    let context: BrowserContext;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        person = await makePerson(browser, "Paula Pass");
        context = await browser.newContext(contextOptions);
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test("a wrong password is refused and the person stays on the sign-in page", async () => {
        await submitPassword(page, person.email, `${person.password}x`);
        await expect(page.getByText("The email or the password is wrong.", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
        expect(new URL(page.url()).pathname).not.toMatch(/^\/dashboard/);
        expect(await hasSession(page)).toBe(false);
    });

    test("the right password reaches the dashboard and logging out ends the session", async () => {
        await signInPaced(page, person.email, person.password);
        expect(await hasSession(page)).toBe(true);

        await signOut(page, person);
        expect(await hasSession(page)).toBe(false);
        // The page of the dashboard sends a browser without a session back to the sign-in.
        await page.goto("/dashboard");
        await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
        expect(new URL(page.url()).pathname).not.toMatch(/^\/dashboard/);
    });
});

test.describe("the authenticator app", () => {
    let person: Person;
    let context: BrowserContext;
    let page: Page;
    /** The key of the app, as the setup shows it under the QR code. */
    let key = "";
    let backupCodes: string[] = [];

    test.beforeAll(async ({ browser }) => {
        person = await makePerson(browser, "Tom Factor");
        context = await browser.newContext(contextOptions);
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    /** Signs in with the password up to the step of the second factor. */
    async function toCodeStep(): Promise<void> {
        await submitPassword(page, person.email, person.password);
        await expect(page.getByRole("heading", { name: "Confirm it is you", exact: true })).toBeVisible();
        await expect(page.getByText(`Enter the 6-digit code of your authenticator app for ${person.email}.`, { exact: true })).toBeVisible();
        expect(await hasSession(page)).toBe(false);
    }

    test("the person turns on the authenticator app in the profile and gets backup codes", async () => {
        await signInPaced(page, person.email, person.password);
        await openSecurity(page);
        await expect(page.getByText("Off. Only your password protects the account.", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Turn on", exact: true }).click();

        const dialog = page.getByRole("dialog", { name: "Turn on the authenticator app" });
        await dialog.getByLabel("Your password", { exact: true }).fill(person.password);
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(dialog.getByText("Step 2 of 3", { exact: true })).toBeVisible();

        // The key in groups of four, the way an app shows it.
        key = (await dialog.locator("code").innerText()).replace(/\s/g, "");
        expect(key).toMatch(/^[A-Z2-7]{16,}$/);
        await paced("/two-factor/verify-totp");
        await dialog.getByLabel("The code the app shows", { exact: true }).fill(totp(key));
        await dialog.getByRole("button", { name: "Turn on", exact: true }).click();
        await expect(page.getByText("The authenticator app is on", { exact: true })).toBeVisible();

        await expect(dialog.getByText("Step 3 of 3", { exact: true })).toBeVisible();
        backupCodes = (await dialog.innerText()).match(/\b[A-Za-z0-9]{5}-[A-Za-z0-9]{5}\b/g) ?? [];
        expect(backupCodes).toHaveLength(10);
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText("On. After the password DBackup asks for a code from the app.", { exact: true })).toBeVisible();

        await signOut(page, person);
    });

    test("the sign-in asks for the code, refuses a wrong one and takes the right one", async () => {
        await toCodeStep();
        const code = page.getByRole("textbox", { name: "Code", exact: true });

        await code.fill(wrongCode(key));
        await paced("/two-factor/verify-totp");
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await expect(page.getByText("The code is wrong. Take the newest one of your app.", { exact: true })).toBeVisible();
        expect(await hasSession(page)).toBe(false);

        await paced("/two-factor/verify-totp");
        await code.fill(totp(key));
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await page.waitForURL(/\/dashboard/);
        expect(await hasSession(page)).toBe(true);

        await signOut(page, person);
    });

    test("a backup code signs in once and is refused the second time", async () => {
        const [backup] = backupCodes;

        await toCodeStep();
        await page.getByRole("button", { name: "Use a backup code", exact: true }).click();
        await page.getByRole("textbox", { name: "Backup code", exact: true }).fill(backup);
        await paced("/two-factor/verify-backup-code");
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await page.waitForURL(/\/dashboard/);
        expect(await hasSession(page)).toBe(true);
        await signOut(page, person);

        await toCodeStep();
        await page.getByRole("button", { name: "Use a backup code", exact: true }).click();
        await page.getByRole("textbox", { name: "Backup code", exact: true }).fill(backup);
        await paced("/two-factor/verify-backup-code");
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await expect(page.getByText("This backup code is wrong or used up.", { exact: true })).toBeVisible();
        expect(await hasSession(page)).toBe(false);
    });
});
