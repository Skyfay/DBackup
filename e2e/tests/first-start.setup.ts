/**
 * The first start of a new instance, through its pages: the first account, then what every other
 * project needs from the admin, saved as its session. A retry finds the account made already and
 * signs in instead.
 */

import { expect, test as setup } from "@playwright/test";
import { ADMIN, ADMIN_STATE } from "../support/environment";
import { E2E_KEY } from "../support/app";

setup("creates the first account and prepares the instance", async ({ page }) => {
    await page.goto("/");
    const welcome = page.getByRole("heading", { name: "Welcome to DBackup" });
    const signIn = page.getByRole("heading", { name: "Sign in" });
    await expect(welcome.or(signIn)).toBeVisible();

    if (await welcome.isVisible()) {
        await page.getByRole("button", { name: /^Start fresh/ }).click();
        await expect(page.getByRole("heading", { name: "Create the first account" })).toBeVisible();
        await page.getByLabel("Name").fill(ADMIN.name);
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
        await page.getByRole("button", { name: "Create account" }).click();
    } else {
        await page.getByLabel("Email").fill(ADMIN.email);
        await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    // A new instance opens Quick Setup, one with connections the overview.
    await page.waitForURL(/\/dashboard/);

    // The tests send more requests in a minute than a person does.
    await page.goto("/dashboard/settings?part=rate-limits");
    for (const [label, value] of [["Sign-ins, requests", "1000"], ["Reads through the API, requests", "10000"], ["Changes through the API, requests", "1000"]]) {
        await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // The Vault key the backups of the tests are encrypted with. Keys are made on this page only.
    await page.goto("/dashboard/vault?tab=encryption");
    await expect(page.getByRole("button", { name: "New key" }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (!(await page.getByTitle(E2E_KEY, { exact: true }).isVisible())) {
        await page.getByRole("button", { name: "New key" }).first().click();
        await page.getByLabel("Name").fill(E2E_KEY);
        await page.getByRole("button", { name: "Create key" }).click();
        await page.getByRole("button", { name: "Later" }).click();
        await expect(page.getByTitle(E2E_KEY, { exact: true })).toBeVisible();
    }

    await page.context().storageState({ path: ADMIN_STATE });
});
