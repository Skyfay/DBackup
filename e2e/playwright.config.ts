import { defineConfig, devices } from "@playwright/test";
import { ADMIN_STATE, BASE_URL } from "./support/environment";
import { selectedFamilies, uiSelected } from "./support/targets";

// The end-to-end tests, `pnpm test:e2e`. The global setup builds the image of this checkout and
// starts it in the Compose project of the dev lab, see e2e/CLAUDE.md.
//
// `setup` creates the first account through the first start page and keeps its session, every
// other project runs signed in with it. `ui` drives the browser. Each family runs the specs
// directly under tests/ whose names carry its tag, like `[postgres]`, and is a job of the CI
// matrix. E2E_FAMILIES picks families and `ui`.

const signedIn = { storageState: ADMIN_STATE };

export default defineConfig({
    testDir: "./tests",
    outputDir: "./test-results",
    globalSetup: "./support/global-setup.ts",
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    // Every backup goes through the one queue of the instance, so more workers would only wait.
    workers: 1,
    timeout: 5 * 60_000,
    expect: { timeout: 15_000 },
    reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
    use: {
        baseURL: BASE_URL,
        locale: "en-US",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    projects: [
        { name: "setup", testMatch: /first-start\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
        ...(uiSelected() ? [{ name: "ui", testMatch: /ui\/.*\.spec\.ts/, dependencies: ["setup"], use: { ...devices["Desktop Chrome"], ...signedIn } }] : []),
        ...selectedFamilies().map((family) => ({
            name: family.name,
            testMatch: /[\\/]tests[\\/][^\\/]+\.spec\.ts$/,
            grep: new RegExp(`\\[${family.name}\\]`),
            dependencies: ["setup"],
            use: signedIn,
        })),
    ],
});
