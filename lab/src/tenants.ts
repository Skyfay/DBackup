/**
 * The customers the seed adds beside the home tenant, so a fresh dev database looks like the
 * instance of an MSP: Acme with a person, a database of a lab server given to it, a destination
 * and a channel of the home tenant shared with it and a job on a server of its own, Globex with a
 * person and the local network blocked, and a platform group of the two with a person in it.
 *
 * Plain data, read by the seed and by `lab:status`, which must not load the app to know the names.
 * Every person signs in with the password of the admin in the lab config.
 */

export const LAB_TENANTS = {
    acme: { name: "Acme", person: { name: "Ada Acme", email: "acme@dbackup.lab" } },
    globex: { name: "Globex", person: { name: "Gus Globex", email: "globex@dbackup.lab" } },
} as const;

/** The platform group of selected tenants, Acme and Globex, and the person of the MSP in it. */
export const LAB_SUPPORT = { group: "Lab Support", person: { name: "Sam Support", email: "support@dbackup.lab" } } as const;

/** The database of a lab server of the home tenant that goes to Acme, by the service of the server. */
export const ACME_DATABASE = { service: "postgres-18", database: "shop" } as const;

/** What the home tenant shares with Acme, by the names the seed gives them. */
export const SHARED_WITH_ACME = { destination: "Lab Local", channel: "Lab Mail" } as const;

/** The server of Acme's own, a lab service it reaches through an allowed range, and its job. */
export const ACME_SERVER = { service: "mysql-9", connection: "Acme MySQL 9", login: "Acme MySQL login", key: "Acme key", alerts: "Acme alerts", job: "Acme MySQL 9 to Lab Local" } as const;
