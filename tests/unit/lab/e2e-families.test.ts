// @vitest-environment node
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../lab/src/config";
import { DATABASES, STORAGE } from "../../../lab/src/catalog";
import { ENGINES } from "../../../lab/src/engines";
import { FAMILIES, servicesOf } from "../../../e2e/support/targets";

const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "validate.yml"), "utf8");

/** The services the Compose files of the lab define, read line by line. */
function composeServices(): Set<string> {
    const names = new Set<string>();
    for (const file of ["databases", "storage", "notify", "e2e"]) {
        const text = readFileSync(path.join(REPO_ROOT, "lab", "compose", `${file}.yml`), "utf8");
        for (const match of text.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)) names.add(match[1]);
    }
    return names;
}

describe("the families of the end-to-end tests", () => {
    it("are each a job of the CI matrix, with the browser tests", () => {
        const matrix = workflow.match(/family: \[(.*)\]/)?.[1].split(",").map((name) => name.trim());
        expect(matrix).toEqual(["ui", ...FAMILIES.map((family) => family.name)]);
    });

    it("back up every engine of the lab, so a new one does not go untested", () => {
        const tested = new Set(FAMILIES.flatMap((family) => family.targets.map((target) => target.adapterId)));
        expect(ENGINES.map((spec) => spec.id).filter((id) => !tested.has(id))).toEqual([]);
        expect(tested.has("sqlite")).toBe(true);
    });

    it("start only services the Compose files of the lab define", () => {
        const defined = composeServices();
        for (const family of FAMILIES) {
            expect(servicesOf(family).filter((service) => !defined.has(service)), family.name).toEqual([]);
        }
        expect(defined.has(STORAGE.ssh.service)).toBe(true);
        expect(DATABASES.every((database) => defined.has(database.service))).toBe(true);
    });
});
