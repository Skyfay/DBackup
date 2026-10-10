// @ts-check
/**
 * Outdated dependencies of the app, the docs site and the marketing site.
 *
 *   pnpm update:check
 *
 * Each project is checked on its own, see `PROJECTS`. `pnpm outdated --recursive` would treat them
 * as workspace members, which drops their local `pnpm.overrides` and warns about it on every run.
 */

import path from "node:path";
import { PROJECTS, ROOT, bold, out, runVisible } from "./cli.mjs";

/** `pnpm update:check`: runs `pnpm outdated` in every project and sums up which have updates. */
export function checkCommand() {
    /** @type {string[]} */
    const outdated = [];
    for (const project of PROJECTS) {
        out(bold(`── ${project.name} ──`));
        // `pnpm outdated` exits 1 whenever it finds something, the way `diff` does. That is the
        // normal result here, so it is counted rather than ending the run.
        if (runVisible("pnpm", ["outdated"], path.join(ROOT, project.dir))) out("✓ up to date");
        else outdated.push(project.name);
        out("");
    }
    out(bold("═══ Summary ═══"));
    if (outdated.length === 0) out(`  ✓ All ${PROJECTS.length} projects are up to date.`);
    else out(`  ${outdated.length} of ${PROJECTS.length} projects have updates: ${outdated.join(", ")}`);
}
