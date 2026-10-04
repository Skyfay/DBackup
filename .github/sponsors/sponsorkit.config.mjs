// The GitHub Sponsors of Skyfay as two images, which .github/workflows/sponsors.yml publishes to
// the sponsors branch and the READMEs of DBackup and SkySend embed. Only the tiers that list a
// sponsor on their own are drawn here. $150 and $500 a month come with a logo and a link and are
// kept by hand in the READMEs, $5 a month and $10 and $25 once are not listed.
import { defineConfig } from "sponsorkit";

/**
 * The price of the tier. A one-time payment counts as -1 once its month is over, while the name
 * GitHub gives the tier, like "$100 one time", keeps it.
 */
function price(sponsorship) {
    const named = /\$([\d,]+)/.exec(sponsorship.tierName ?? "")?.[1];
    return named ? Number(named.replace(/,/g, "")) : sponsorship.monthlyDollars;
}

/**
 * Sponsors the READMEs show with their logo by hand, so the images leave them out. Kay sponsored
 * $500 once while that tier still came with a logo.
 */
const LOGO_BY_HAND = new Set(["kayvanaarssen"]);

/** Avatar and name, wide enough that a full name fits. */
const named = { avatar: { size: 50 }, boxWidth: 110, boxHeight: 90, container: { sidePadding: 20 }, name: { maxLength: 15 } };
const namedLarge = { avatar: { size: 80 }, boxWidth: 130, boxHeight: 125, container: { sidePadding: 20 }, name: { maxLength: 18 } };
const namedXL = { avatar: { size: 110 }, boxWidth: 160, boxHeight: 155, container: { sidePadding: 20 }, name: { maxLength: 20 } };

export default defineConfig({
    // A one-time sponsor stays listed after its month, so the sponsorships that ended are fetched too.
    includePastSponsors: true,
    formats: ["svg"],
    width: 800,
    renders: [
        {
            // $15 a month lists the name, $50 a month a larger avatar, for as long as they sponsor.
            name: "sponsors",
            includePastSponsors: false,
            filter: (sponsorship) => !sponsorship.isOneTime && sponsorship.monthlyDollars >= 15 && sponsorship.monthlyDollars < 150,
            tiers: [
                { title: "Backers · from $15 a month", preset: named },
                { title: "Sponsors · from $50 a month", monthlyDollars: 50, preset: namedLarge },
            ],
        },
        {
            // $100 once lists the name, $500 once a larger avatar, and both stay there. The $500
            // tier has no title, since it sits right under the Patrons heading of the README.
            name: "sponsors-onetime",
            onBeforeRenderer: (sponsorships) => sponsorships.map((sponsorship) => ({ ...sponsorship, monthlyDollars: price(sponsorship) })),
            filter: (sponsorship) => sponsorship.isOneTime && sponsorship.monthlyDollars >= 100 && !LOGO_BY_HAND.has(sponsorship.sponsor.login),
            tiers: [
                { title: "Backers · from $100 once", preset: namedLarge },
                { monthlyDollars: 500, preset: namedXL },
            ],
        },
    ],
});
