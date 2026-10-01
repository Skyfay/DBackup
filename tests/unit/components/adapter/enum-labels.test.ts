import { describe, expect, it } from "vitest";
import { enumLabel } from "@/components/adapter/enum-labels";

describe("the names of coded choices in an adapter form", () => {
    it("names the codes of regions, storage classes and jurisdictions", () => {
        expect(enumLabel("region", "fsn1")).toBe("Falkenstein (fsn1)");
        expect(enumLabel("storageClass", "STANDARD_IA")).toBe("Standard, infrequent access");
        expect(enumLabel("jurisdiction", "fedramp")).toBe("FedRAMP");
        expect(enumLabel("secure", "starttls")).toBe("STARTTLS");
    });

    it("keeps a value that means something else in another field, and capitalizes one without a name", () => {
        expect(enumLabel("mode", "default")).toBe("Default");
        expect(enumLabel("sentinelMode", "standalone")).toBe("Standalone");
        expect(enumLabel("method", "POST")).toBe("POST");
    });
});
