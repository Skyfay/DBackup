// @ts-check
/**
 * Known vulnerabilities in the dependencies of the app, the docs site and the marketing site.
 *
 *   pnpm audit:check
 *
 * Each project has a lockfile of its own, see `PROJECTS`, so each is audited on its own.
 */

import path from "node:path";
import { PROJECTS, ROOT, bold, out, runVisible } from "./cli.mjs";

/** `pnpm audit:check`: runs `pnpm audit` in every project and sums up which have findings. */
export function checkCommand() {
    /** @type {string[]} */
    const vulnerable = [];
    for (const project of PROJECTS) {
        out(bold(`── ${project.name} ──`));
        // `pnpm audit` exits 1 when it finds something. That is a result here, not a failure.
        if (runVisible("pnpm", ["audit"], path.join(ROOT, project.dir))) out("✓ no known vulnerabilities");
        else vulnerable.push(project.name);
        out("");
    }
    out(bold("═══ Summary ═══"));
    if (vulnerable.length === 0) out(`  ✓ No known vulnerabilities in the ${PROJECTS.length} projects.`);
    else out(`  ${vulnerable.length} of ${PROJECTS.length} projects have findings, or could not be audited: ${vulnerable.join(", ")}`);
}
