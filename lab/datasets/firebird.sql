-- Dataset of the dev lab for Firebird 3 and later, run by isql against
-- /var/lib/firebird/data/shop.fdb, which the container creates empty. Loaded once by
-- `pnpm lab:up` when the view ORDER_TOTALS, made last, is missing. A load that broke off
-- leaves tables behind: `pnpm lab:down --volumes` starts the container over.

SET NAMES UTF8;

CREATE TABLE customers (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(100) CHARACTER SET UTF8 NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    note BLOB SUB_TYPE TEXT CHARACTER SET UTF8,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
    id INTEGER NOT NULL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers (id),
    amount DECIMAL(12, 2) NOT NULL,
    paid BOOLEAN DEFAULT FALSE NOT NULL,
    receipt BLOB SUB_TYPE BINARY,
    ordered_on DATE NOT NULL
);

CREATE GENERATOR invoice_number;

INSERT INTO customers VALUES (1, 'Zoë Müller', 'zoe@example.ch', 'Grüezi', '2024-02-29 23:59:59');
INSERT INTO customers VALUES (2, '李雷', 'lilei@example.cn', NULL, '1999-12-31 00:00:00');
INSERT INTO customers VALUES (3, 'O''Brien & Söhne', 'obrien@example.ie', 'Quote '' inside', '2026-01-01 12:00:00');

INSERT INTO orders VALUES (1, 1, 1234567890.12, TRUE, x'DEADBEEF00FF', '2024-02-29');
INSERT INTO orders VALUES (2, 1, 0.01, FALSE, NULL, '1970-01-01');
INSERT INTO orders VALUES (3, 2, 99.95, TRUE, x'00', '2038-01-19');

CREATE VIEW order_totals (name, total) AS
    SELECT c.name, SUM(o.amount) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;

COMMIT;
