db = db.getSiblingDB('testdb');
db.createCollection('users');
db.users.insertOne({
    name: "Test User",
    email: "test@example.com",
    role: "admin",
    createdAt: new Date()
});

print("Initialized testdb with dummy data");