/**
 * A backup set up the way a person does it: a destination and a database through the pages of
 * Connections, a job through its dialog, Run now, and the run page until it is done.
 */

import { expect, test } from "@playwright/test";
import { engineOf } from "../../../lab/src/engines";
import { unique } from "../../support/app";

const postgres = engineOf("postgres");

test("backs up a database set up through the pages", async ({ page }) => {
    const name = unique();
    const folder = `${name} folder`;
    const database = `${name} shop`;
    const job = `${name} nightly`;

    await test.step("a Local Filesystem destination", async () => {
        await page.goto("/dashboard/connections?tab=destinations");
        await page.getByRole("button", { name: "New destination" }).first().click();
        await page.getByRole("button", { name: /^Local Filesystem/ }).click();
        const dialog = page.getByRole("dialog", { name: "New destination" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(folder);
        await dialog.getByRole("textbox", { name: "Folder", exact: true }).fill(`/data/e2e/${name}`);
        await dialog.getByRole("button", { name: "Create destination" }).click();
        await expect(page.getByText("Connection created")).toBeVisible();
    });

    await test.step("a PostgreSQL database with a new login", async () => {
        await page.goto("/dashboard/connections?tab=databases");
        await page.getByRole("button", { name: "New database" }).first().click();
        await page.getByRole("button", { name: /^PostgreSQL/ }).click();
        const dialog = page.getByRole("dialog", { name: "New database" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(database);
        await dialog.getByRole("radio", { name: /^Direct/ }).click();
        await dialog.getByRole("textbox", { name: "Host", exact: true }).fill("postgres-18");
        await dialog.getByRole("textbox", { name: "Port", exact: true }).fill(String(postgres.innerPort));

        await dialog.getByRole("button", { name: "New", exact: true }).click();
        const login = page.getByRole("dialog", { name: "New login" });
        await login.getByRole("textbox", { name: "Name", exact: true }).fill(`${name} login`);
        await login.getByRole("textbox", { name: "Username", exact: true }).fill(postgres.login.username);
        await login.getByLabel("Password", { exact: true }).fill(postgres.login.password);
        await login.getByRole("button", { name: "Create login" }).click();

        await dialog.getByRole("button", { name: "Test connection" }).click();
        await expect(dialog.getByText(/^Connected/)).toBeVisible();
        await dialog.getByRole("button", { name: "Create database" }).click();
        await expect(page.getByText("Connection created")).toBeVisible();
    });

    await test.step("a job of that database to that destination", async () => {
        await page.goto("/dashboard/jobs");
        await page.getByRole("button", { name: "New job" }).first().click();
        const dialog = page.getByRole("dialog", { name: "New backup job" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(job);

        await dialog.getByRole("tab", { name: /^Source/ }).click();
        await dialog.getByRole("combobox", { name: "Database" }).click();
        await page.getByRole("option", { name: database }).click();

        await dialog.getByRole("tab", { name: /^Destinations/ }).click();
        await dialog.getByRole("combobox", { name: "Destination 1", exact: true }).click();
        await page.getByRole("option", { name: folder }).click();

        await dialog.getByRole("button", { name: "Create job" }).click();
        await expect(page.getByText(job).first()).toBeVisible();
    });

    await test.step("Run now, and the run until it is done", async () => {
        // The button of a row shows on hover only.
        const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: job, exact: true }) });
        await row.hover();
        await row.getByRole("button", { name: `Run ${job} now` }).click();
        await page.waitForURL(/\/dashboard\/history\/run\?id=/);
        await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({ timeout: 3 * 60_000 });
    });
});
