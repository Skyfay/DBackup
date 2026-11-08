// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Readable } from "stream";
import { createDatabaseRenameStream } from "@/lib/adapters/database/mysql/rename-stream";

/** Sends `input` through the stream in chunks of `size` bytes and collects what comes out. */
async function rename(input: Buffer, size: number, from = "shop", to = "shop_copy"): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < input.length; offset += size) chunks.push(input.subarray(offset, offset + size));
    const out: Buffer[] = [];
    for await (const chunk of Readable.from(chunks).pipe(createDatabaseRenameStream(from, to))) out.push(chunk as Buffer);
    return Buffer.concat(out);
}

const dump = (body: Buffer | string) => Buffer.concat([
    Buffer.from("CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;\nUSE `shop`;\n"),
    Buffer.from(body),
    Buffer.from("\nALTER DATABASE `shop` CHARACTER SET utf8mb4;\n"),
]);

describe("the database rename of a MySQL restore", () => {
    it("moves the CREATE DATABASE, USE and ALTER DATABASE lines to the new name", async () => {
        const out = (await rename(dump("INSERT INTO `t` VALUES (1);"), 7)).toString("utf8");

        expect(out).toBe(
            "CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop_copy` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;\nUSE `shop_copy`;\n" +
            "INSERT INTO `t` VALUES (1);\nALTER DATABASE `shop_copy` CHARACTER SET utf8mb4;\n",
        );
    });

    it("keeps binary data that is no UTF-8 byte for byte", async () => {
        // The bytes of x'DEADBEEF00FF' as mysqldump writes them, which came back as EF BF BD.
        const row = Buffer.concat([Buffer.from("INSERT INTO `orders` VALUES (1,_binary '"), Buffer.from([0xde, 0xad, 0xbe, 0xef]), Buffer.from("\\0"), Buffer.from([0xff]), Buffer.from("');")]);
        const out = await rename(dump(row), 64 * 1024);

        expect(out.includes(row)).toBe(true);
    });

    it("keeps a character a chunk ends in the middle of", async () => {
        const row = Buffer.from("INSERT INTO `customers` VALUES (1,'Zoë 李雷 🦊');");
        for (let size = 1; size <= 8; size++) {
            expect((await rename(dump(row), size)).includes(row), `chunks of ${size}`).toBe(true);
        }
    });

    it("keeps a line longer than a chunk on one line", async () => {
        const row = Buffer.from(`INSERT INTO \`t\` VALUES ('${"x".repeat(1000)}');`);
        const out = await rename(dump(row), 100);

        expect(out.toString("latin1").split("\n")).toContain(row.toString("latin1"));
    });

    it("renames a database whose name holds characters beyond ASCII", async () => {
        const out = (await rename(Buffer.from("USE `bäckerei`;\nSELECT 1;\n"), 3, "bäckerei", "bäckerei_kopie")).toString("utf8");

        expect(out).toBe("USE `bäckerei_kopie`;\nSELECT 1;\n");
    });

    it("leaves a line that only mentions the name alone", async () => {
        const body = "INSERT INTO `notes` VALUES ('USE `shop`; is a statement');";
        expect((await rename(dump(body), 16)).toString("utf8")).toContain(body);
    });
});
