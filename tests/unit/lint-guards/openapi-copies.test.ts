/**
 * Lint Guard: the two copies of the API reference say the same.
 *
 * `api-docs/openapi.yaml` builds the API reference of the docs site and `public/openapi.yaml`
 * is what /docs/api shows inside DBackup. `scripts/sync-version.sh` keeps their versions in step,
 * but an endpoint added to one only reached the other by hand, and the copy in the app lacked
 * four of them. Edit `api-docs/openapi.yaml` and copy it over.
 *
 * Run with: pnpm test tests/unit/lint-guards/openapi-copies.test.ts
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

describe("Lint Guard: the API reference", () => {
    it("is the same in the app and on the docs site", () => {
        const docs = fs.readFileSync(path.join(ROOT, "api-docs/openapi.yaml"), "utf-8");
        const app = fs.readFileSync(path.join(ROOT, "public/openapi.yaml"), "utf-8");
        expect(app === docs, "public/openapi.yaml differs from api-docs/openapi.yaml, copy api-docs/openapi.yaml over it").toBe(true);
    });
});
