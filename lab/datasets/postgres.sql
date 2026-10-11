-- Dataset of the dev lab for PostgreSQL 12 and later. Loaded once by `pnpm lab:up` through psql
-- in the container, when the database inventory, made last, is missing. It starts over from
-- nothing, so a load that broke off can simply run again.

DROP DATABASE IF EXISTS shop;
DROP DATABASE IF EXISTS inventory;
CREATE DATABASE shop;
\connect shop

CREATE SCHEMA sales;
CREATE SEQUENCE invoice_number START 1000;

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    note TEXT,
    profile JSONB,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sales.orders (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers (id),
    invoice INT NOT NULL DEFAULT nextval('invoice_number'),
    amount NUMERIC(12, 2) NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    receipt BYTEA,
    ordered_on DATE NOT NULL
);
CREATE INDEX idx_orders_customer ON sales.orders (customer_id);

INSERT INTO customers (name, email, note, profile, created_at) VALUES
    ('Zoë Müller', 'zoe@example.ch', 'Grüezi 🦊', '{"tags": ["vip"], "visits": 3}', '2024-02-29 23:59:59+01'),
    ('李雷', 'lilei@example.cn', NULL, NULL, '1999-12-31 00:00:00+08'),
    ('O''Brien & Söhne', 'obrien@example.ie', 'Quote '' and backslash \ inside', '{}', '2026-01-01 12:00:00Z');

INSERT INTO sales.orders (customer_id, amount, paid, receipt, ordered_on) VALUES
    (1, 1234567890.12, TRUE, '\xDEADBEEF00FF', '2024-02-29'),
    (1, 0.01, FALSE, NULL, '1970-01-01'),
    (2, 99.95, TRUE, '\x00', '2038-01-19');

CREATE VIEW sales.order_totals AS
    SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN sales.orders o ON o.customer_id = c.id GROUP BY c.name;

CREATE FUNCTION sales.mark_paid(order_id INT) RETURNS VOID LANGUAGE SQL AS
    $$ UPDATE sales.orders SET paid = TRUE WHERE id = order_id $$;

CREATE DATABASE inventory;
\connect inventory
CREATE TABLE items (sku TEXT PRIMARY KEY, title TEXT NOT NULL, stock INT NOT NULL);
INSERT INTO items VALUES ('A-1', 'Kaffeemühle', 12), ('B-2', 'Teekanne «Lotus»', 0);
