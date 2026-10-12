-- Dataset of the dev lab for SQLite, the file shop.db on the SSH host of the lab and in the
-- storage folder of the lab for the local mode.

CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers (id),
    amount NUMERIC NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    receipt BLOB,
    ordered_on TEXT NOT NULL
);
CREATE INDEX idx_orders_customer ON orders (customer_id);

INSERT INTO customers (name, email, note, created_at) VALUES
    ('Zoë Müller', 'zoe@example.ch', 'Grüezi 🦊', '2024-02-29T23:59:59Z'),
    ('李雷', 'lilei@example.cn', NULL, '1999-12-31T00:00:00Z'),
    ('O''Brien & Söhne', 'obrien@example.ie', 'Quote '' and backslash \ inside', '2026-01-01T12:00:00Z');

INSERT INTO orders (customer_id, amount, paid, receipt, ordered_on) VALUES
    (1, 1234567890.12, 1, X'DEADBEEF00FF', '2024-02-29'),
    (1, 0.01, 0, NULL, '1970-01-01'),
    (2, 99.95, 1, X'00', '2038-01-19');

CREATE VIEW order_totals AS
    SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
