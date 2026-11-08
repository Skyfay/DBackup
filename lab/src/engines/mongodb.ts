/** MongoDB, from 4.4 to 8.0. Version 5 and later need a CPU with AVX. */

import { shopCopy, viaFile, type Clients, type EngineSpec, type Run } from "./types";

const login = { username: "root", password: "rootpassword" };

/** mongosh from MongoDB 5 on, the old mongo shell before. */
const shell = (user: string, password: string) => `$(command -v mongosh || command -v mongo) --quiet -u ${user} -p '${password}' --authenticationDatabase admin`;
const clients: Clients = { cli: shell(login.username, login.password) };

/** The collections with their documents (dbHash), their indexes and the views. */
const fingerprintScript = (name: string) => `
const d = db.getSiblingDB(${JSON.stringify(name)});
const infos = d.getCollectionInfos().map(function (i) { return { name: i.name, type: i.type, options: i.options }; });
infos.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
const hashes = d.runCommand({ dbHash: 1 }).collections;
const collections = infos.filter(function (i) { return i.type === "collection"; }).map(function (i) {
    const c = d.getCollection(i.name);
    const indexes = c.getIndexes().map(function (x) { return { key: x.key, name: x.name, unique: !!x.unique }; });
    return { name: i.name, documents: c.countDocuments({}), md5: hashes[i.name], indexes: indexes };
});
print(JSON.stringify({ views: infos.filter(function (i) { return i.type === "view"; }), collections: collections }, null, 1));
`;

export const MONGODB: EngineSpec = {
    id: "mongodb",
    name: "MongoDB",
    versions: [
        { version: "4.4", service: "mongo-44", port: 27704, profile: "core" },
        { version: "6.0", service: "mongo-60", port: 27706, profile: "full" },
        { version: "7.0", service: "mongo-70", port: 27707, profile: "full" },
        { version: "8.0", service: "mongo-80", port: 27708, profile: "core" },
    ],
    innerPort: 27017,
    login,
    clients,
    dataset: {
        file: "mongodb.js",
        // An expression would print its value, null included, so the check prints only on a find.
        check: `${clients.cli} --eval "if (db.getMongo().getDBNames().indexOf('inventory') >= 0) print('yes')"`,
        load: clients.cli,
    },
    source: (target) => ({ host: target.host, port: target.port, connectionMode: "direct", authenticationDatabase: "admin" }),
    restores: true,
    native: { host: "127.0.0.1", clients: (native) => ({ cli: shell(native.user, native.password) }) },
    database: { name: "shop", location: "shop", restoreAs: shopCopy },
    fingerprint: (run: Run, database: string, tools: Clients) => viaFile(run, (file) => `${tools.cli} ${file}`, fingerprintScript(database), ".js"),
    drop: async (run: Run, database: string, tools: Clients) => {
        await viaFile(run, (file) => `${tools.cli} ${file}`, `db.getSiblingDB(${JSON.stringify(database)}).dropDatabase();\n`, ".js");
    },
};
