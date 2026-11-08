import { randomInt } from "crypto";

const SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "-_.!"];

/**
 * A password the Standard rules of DBackup accept: 20 characters with upper and lower case, a
 * digit and a sign, and no word of three or more letters from the name or the email.
 */
export function generatePassword(name: string, email: string): string {
    const words = `${name} ${email.split("@")[0]}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
    for (;;) {
        const characters = Array.from({ length: 20 }, (_, index) => {
            const set = SETS[index < SETS.length ? index : randomInt(SETS.length)];
            return set[randomInt(set.length)];
        });
        // The first four came from one set each, so shuffle them in.
        for (let index = characters.length - 1; index > 0; index--) {
            const other = randomInt(index + 1);
            [characters[index], characters[other]] = [characters[other], characters[index]];
        }
        const password = characters.join("");
        if (!words.some((word) => password.toLowerCase().includes(word))) return password;
    }
}
