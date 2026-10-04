// Writes a fake sponsorkit cache, so the config renders without a token.
import sharp from "sharp";
import fs from "node:fs";
const colors = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#9333ea"];
let i = 0;
async function avatar() {
    const color = colors[i++ % colors.length];
    const png = await sharp({ create: { width: 120, height: 120, channels: 3, background: color } }).png().toBuffer();
    return png.toString("base64");
}
const ship = async (login, name, tierName, monthlyDollars, isOneTime, privacyLevel = "PUBLIC", days = 10) => ({
    sponsor: { type: "User", login, name, avatarUrl: `https://github.com/${login}.png`, avatarBuffer: await avatar(), linkUrl: `https://github.com/${login}` },
    isOneTime, monthlyDollars, privacyLevel, tierName, createdAt: new Date(Date.now() - days * 86400000).toISOString(), provider: "github",
});
const all = [
    await ship("five", "Five Dollar", "$5 a month", 5, false),
    await ship("anna", "Anna Backer", "$15 a month", 15, false, "PUBLIC", 30),
    await ship("kaylong", "Kay van Aarssen Longname", "$15 a month", 15, false, "PUBLIC", 20),
    await ship("sam", "Sam Sponsor", "$50 a month", 50, false),
    await ship("company", "Company Inc", "$150 a month", 150, false),
    await ship("premium", "Premium GmbH", "$500 a month", 500, false),
    await ship("pastmonthly", "Past Monthly", "$15 a month", -1, false),
    await ship("tenonce", "Ten Once", "$10 one time", 10, true),
    await ship("hundred", "Hundred Active", "$100 one time", 100, true, "PUBLIC", 5),
    await ship("hundredpast", "Hundred Past", "$100 one time", -1, true, "PUBLIC", 90),
    await ship("patron", "Patron 500", "$500 one time", -1, true),
    await ship("hidden", "Hidden Backer", "$15 a month", 15, false, "PRIVATE"),
];
fs.mkdirSync("sponsorkit", { recursive: true });
fs.writeFileSync("sponsorkit/.cache.json", JSON.stringify(all, null, 2));
console.log(`wrote ${all.length} fake sponsorships`);
