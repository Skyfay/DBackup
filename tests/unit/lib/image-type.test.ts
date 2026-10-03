import { describe, expect, it } from "vitest";
import { imageTypeOf } from "@/lib/core/image-type";

const text = (value: string) => new TextEncoder().encode(value);

describe("the type of a picture by its first bytes", () => {
    it("knows a PNG, a JPEG, a GIF and a WebP", () => {
        expect(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).toBe("image/png");
        expect(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
        expect(imageTypeOf(text("GIF89a\u0001"))).toBe("image/gif");
        expect(imageTypeOf(text("GIF87a\u0001"))).toBe("image/gif");
        expect(imageTypeOf(new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")]))).toBe("image/webp");
    });

    it("knows nothing else, an SVG with a script and a file cut short included", () => {
        expect(imageTypeOf(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
        expect(imageTypeOf(text("GIF8"))).toBeNull();
        expect(imageTypeOf(text("RIFF0000WAVE"))).toBeNull();
        expect(imageTypeOf(new Uint8Array())).toBeNull();
    });
});
