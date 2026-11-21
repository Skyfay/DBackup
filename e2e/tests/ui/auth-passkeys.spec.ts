/**
 * Passkeys, with the virtual authenticator of Chromium as the device: a person adds one in the
 * profile and signs in with it from the sign-in page, then makes it the second factor after the
 * password. A browser without the passkey gets no further than the step that asks for it.
 *
 * WebAuthn needs a secure context and a domain as its RP ID, which is why the tests open DBackup
 * at localhost, see `BASE_URL`.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { contextOptions } from "../../support/tenants";
import { addVirtualAuthenticator, credentialsOf, hasSession, makePerson, openSecurity, quietLimits, signInPaced, signOut, submitPassword, type Person, type VirtualAuthenticator } from "../../support/auth";

test.describe.configure({ mode: "serial" });

const PASSKEY = "Virtual key";

let person: Person;
let context: BrowserContext;
let page: Page;
let device: VirtualAuthenticator;

test.beforeAll(async ({ browser }) => {
    person = await makePerson(browser, "Kim Passkey");
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    device = await addVirtualAuthenticator(context, page);
});

test.afterAll(async () => {
    await context?.close();
    // The specs after this one sign in too, see `paced`.
    await quietLimits();
});

test("the person adds a passkey in the profile", async () => {
    await signInPaced(page, person.email, person.password);
    await openSecurity(page);
    await expect(page.getByText("No passkey yet. One signs you in with a fingerprint, a face or a security key.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add a passkey", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a passkey" });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(PASSKEY);
    await dialog.getByRole("button", { name: "Add a passkey", exact: true }).click();
    await expect(page.getByText("Passkey added", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(PASSKEY, { exact: true })).toBeVisible();

    // A passkey the device keeps itself, for DBackup at localhost, so the sign-in needs no email.
    const credentials = await credentialsOf(device);
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);
    expect(credentials[0].rpId).toBe("localhost");

    await signOut(page, person);
});

test("the passkey signs in from the sign-in page without the email", async () => {
    expect(await hasSession(page)).toBe(false);
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    expect(await hasSession(page)).toBe(true);
    await expect(page.getByRole("button", { name: new RegExp(person.name) })).toBeVisible();
});

test("the passkey becomes the second factor after the password", async ({ browser }) => {
    await openSecurity(page);
    const factor = page.getByRole("switch", { name: "A passkey counts as the second factor" });
    await expect(factor).not.toBeChecked();
    await factor.click();
    await expect(factor).toBeChecked();
    await expect(page.getByText("Off. A passkey is the second factor instead.", { exact: true })).toBeVisible();
    await signOut(page, person);

    await test.step("the password alone does not sign in a browser without the passkey", async () => {
        const other = await browser.newContext(contextOptions);
        try {
            const otherPage = await other.newPage();
            await submitPassword(otherPage, person.email, person.password);
            await expect(otherPage.getByRole("heading", { name: "Confirm it is you", exact: true })).toBeVisible();
            await expect(otherPage.getByText(`Use your passkey to finish signing in as ${person.email}.`, { exact: true })).toBeVisible();
            expect(await hasSession(otherPage)).toBe(false);
        } finally {
            await other.close();
        }
    });

    await test.step("with the passkey the step after the password asks for it and signs in", async () => {
        await submitPassword(page, person.email, person.password);
        // The step asks the device for the passkey by itself, which the virtual one answers at once.
        await page.waitForURL(/\/dashboard/);
        expect(await hasSession(page)).toBe(true);
    });
});
