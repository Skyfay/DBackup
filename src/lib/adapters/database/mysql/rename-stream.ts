import { Transform } from "stream";

/**
 * Returns a Transform stream that rewrites database-name references in a mysqldump
 * SQL stream when restoring to a different name.
 *
 * mysqldump always emits `USE \`originalDb\`;` and
 * `CREATE DATABASE ... \`originalDb\`` lines that would override the target
 * database specified on the mysql CLI.  This transform replaces those lines so
 * the entire dump lands in `targetDb`.
 *
 * It works on the bytes, not on text. A dump holds binary data and text in any character set,
 * which a decode as UTF-8 replaced with U+FFFD, and a chunk can end inside a character. latin1
 * maps every byte to one character and back, so every line but the rewritten ones passes
 * through unchanged, and a line longer than a chunk stays one line.
 */
export function createDatabaseRenameStream(originalDb: string, targetDb: string): Transform {
    // The names as the dump spells them, in UTF-8, seen through latin1 like the lines.
    const quoted = (name: string) => `\`${Buffer.from(name, "utf8").toString("latin1")}\``;
    const original = quoted(originalDb);
    const target = quoted(targetDb);

    const rewrite = (line: string) => {
        if (line === `USE ${original};`) return `USE ${target};`;
        if (/^(CREATE|ALTER) DATABASE\b/.test(line) && line.includes(original)) return line.split(original).join(target);
        return line;
    };

    let rest = "";
    return new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
            const lines = (rest + Buffer.from(chunk).toString("latin1")).split("\n");
            rest = lines.pop() ?? "";
            if (lines.length === 0) {
                callback();
                return;
            }
            callback(null, Buffer.from(lines.map(rewrite).join("\n") + "\n", "latin1"));
        },
        flush(callback) {
            if (rest) {
                callback(null, Buffer.from(rewrite(rest), "latin1"));
                return;
            }
            callback();
        },
    });
}
