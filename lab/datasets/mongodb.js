// Dataset of the dev lab for MongoDB 4.4 and later. Loaded once by `pnpm lab:up` through mongosh,
// or the legacy mongo shell of 4.4, when the database inventory, made last, is missing. It starts
// over from nothing, so a load that broke off can simply run again.

db.getSiblingDB("shop").dropDatabase();
db.getSiblingDB("inventory").dropDatabase();

const shop = db.getSiblingDB("shop");
shop.customers.insertMany([
    { _id: 1, name: "Zoë Müller", email: "zoe@example.ch", note: "Grüezi 🦊", tags: ["vip"], address: { city: "Zürich", zip: "8001" }, createdAt: new Date("2024-02-29T22:59:59Z") },
    { _id: 2, name: "李雷", email: "lilei@example.cn", note: null, tags: [], createdAt: new Date("1999-12-30T16:00:00Z") },
    { _id: 3, name: "O'Brien & Söhne", email: "obrien@example.ie", note: "Quote ' and backslash \\ inside", createdAt: new Date("2026-01-01T12:00:00Z") },
]);
shop.orders.insertMany([
    { customerId: 1, amount: NumberDecimal("1234567890.12"), paid: true, receipt: BinData(0, "3q2+7wD/"), orderedOn: new Date("2024-02-29T00:00:00Z") },
    { customerId: 1, amount: NumberDecimal("0.01"), paid: false, orderedOn: new Date("1970-01-01T00:00:00Z") },
    { customerId: 2, amount: NumberDecimal("99.95"), paid: true, items: [{ sku: "A-1", qty: 2 }], orderedOn: new Date("2038-01-19T00:00:00Z") },
]);
shop.orders.createIndex({ customerId: 1 });

const inventory = db.getSiblingDB("inventory");
inventory.items.insertMany([
    { _id: "A-1", title: "Kaffeemühle", stock: 12 },
    { _id: "B-2", title: "Teekanne «Lotus»", stock: 0 },
]);
