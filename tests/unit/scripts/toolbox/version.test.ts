import { describe, expect, it } from "vitest";
import { VERSION, dockerTags, isPreview, nextBeta, nextVersion, previewRefusal, releaseOf, withOpenapiVersion, withVersion } from "../../../../scripts/toolbox/version.mjs";

describe("the next version", () => {
    it("counts up a released version", () => {
        expect(nextVersion("4.0.1", "patch")).toBe("4.0.2");
        expect(nextVersion("4.0.1", "minor")).toBe("4.1.0");
        expect(nextVersion("4.0.1", "major")).toBe("5.0.0");
    });

    it("turns a preview into the release it previews, the way npm does", () => {
        expect(nextVersion("4.1.0-beta", "patch")).toBe("4.1.0");
        expect(nextVersion("4.1.0-beta", "minor")).toBe("4.1.0");
        expect(nextVersion("5.0.0-beta", "major")).toBe("5.0.0");
        expect(nextVersion("4.1.2-beta", "minor")).toBe("4.2.0");
    });

    it("refuses something that is no version", () => {
        expect(() => nextVersion("latest", "patch")).toThrow(/Not a version/);
    });

    it("accepts a custom version with a suffix and refuses one without three numbers", () => {
        expect(VERSION.test("4.1.0-beta")).toBe(true);
        expect(VERSION.test("4.1")).toBe(false);
        expect(VERSION.test("v4.1.0")).toBe(false);
    });
});

describe("a beta", () => {
    it("counts up the betas of a release", () => {
        expect(nextBeta("4.1.0-beta.1")).toBe("4.1.0-beta.2");
        expect(nextBeta("4.1.0-beta.9")).toBe("4.1.0-beta.10");
        expect(nextBeta("4.1.0-beta")).toBe("4.1.0-beta.2");
    });

    it("starts with the first beta of the next release after a release", () => {
        expect(nextBeta("4.0.2")).toBe("4.1.0-beta.1");
        expect(nextBeta("4.0.2", "major")).toBe("5.0.0-beta.1");
        expect(nextBeta("4.1.0-dev")).toBe("4.1.0-beta.1");
    });

    it("previews the release without its suffix", () => {
        expect(isPreview("4.1.0-beta.2")).toBe(true);
        expect(isPreview("4.1.0")).toBe(false);
        expect(releaseOf("4.1.0-beta.2")).toBe("4.1.0");
        expect(releaseOf("4.1.0")).toBe("4.1.0");
    });

    it("is refused for a release that is out already, and without fragments for its notes", () => {
        const changelog = "## v4.0.2 - Fixes\n*Released: Oct 12, 2026*\n";
        expect(previewRefusal("4.0.2-beta.1", changelog, 3)).toMatch(/released already/);
        expect(previewRefusal("4.1.0-beta.1", changelog, 0)).toMatch(/no changelog fragments/);
        expect(previewRefusal("4.1.0-beta.1", changelog, 3)).toBeNull();
    });
});

describe("the Docker tags of a version", () => {
    it("tags a release as latest and its major version", () => {
        expect(dockerTags("4.0.1")).toBe("`latest`, `v4`");
    });

    it("tags a beta and a dev build with their channel only", () => {
        expect(dockerTags("4.1.0-beta")).toBe("`beta`");
        expect(dockerTags("4.1.0-beta.2")).toBe("`beta`");
        expect(dockerTags("4.1.0-rc.1")).toBe("`beta`");
        expect(dockerTags("4.1.0-dev")).toBe("`dev`");
    });
});

describe("writing the version", () => {
    it("changes only the version of package.json and keeps its formatting", () => {
        const json = '{\n    "name": "dbackup",\n    "version": "4.0.0",\n    "dependencies": { "x": "1.0.0" }\n}\n';
        expect(withVersion(json, "4.0.1")).toBe(json.replace('"version": "4.0.0"', '"version": "4.0.1"'));
    });

    it("sets the info version of an OpenAPI description", () => {
        const yaml = "openapi: 3.1.0\ninfo:\n  title: DBackup API\n  version: 4.0.0\npaths: {}\n";
        expect(withOpenapiVersion(yaml, "4.0.1")).toBe(yaml.replace("version: 4.0.0", "version: 4.0.1"));
    });
});
