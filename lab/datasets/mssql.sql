-- Dataset of the dev lab for SQL Server 2017 and later. Loaded once by `pnpm lab:up` through
-- sqlcmd in the container, when the database inventory, made last, is missing. It starts over
-- from nothing, so a load that broke off can simply run again.

IF DB_ID('shop') IS NOT NULL DROP DATABASE shop;
IF DB_ID('inventory') IS NOT NULL DROP DATABASE inventory;
GO
CREATE DATABASE shop;
GO
USE shop;
GO

CREATE TABLE customers (
    id INT IDENTITY PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    email NVARCHAR(200) NOT NULL UNIQUE,
    note NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL
);

CREATE TABLE orders (
    id INT IDENTITY PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers (id),
    amount DECIMAL(12, 2) NOT NULL,
    paid BIT NOT NULL DEFAULT 0,
    receipt VARBINARY(MAX) NULL,
    ordered_on DATE NOT NULL
);
GO

INSERT INTO customers (name, email, note, created_at) VALUES
    (N'Zoë Müller', N'zoe@example.ch', N'Grüezi 🦊', '2024-02-29T23:59:59'),
    (N'李雷', N'lilei@example.cn', NULL, '1999-12-31T00:00:00'),
    (N'O''Brien & Söhne', N'obrien@example.ie', N'Quote '' and backslash \ inside', '2026-01-01T12:00:00');

INSERT INTO orders (customer_id, amount, paid, receipt, ordered_on) VALUES
    (1, 1234567890.12, 1, 0xDEADBEEF00FF, '2024-02-29'),
    (1, 0.01, 0, NULL, '1970-01-01'),
    (2, 99.95, 1, 0x00, '2038-01-19');
GO

CREATE VIEW order_totals AS
    SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;
GO

CREATE PROCEDURE mark_paid @order_id INT AS UPDATE orders SET paid = 1 WHERE id = @order_id;
GO

CREATE DATABASE inventory;
GO
USE inventory;
CREATE TABLE items (sku NVARCHAR(20) PRIMARY KEY, title NVARCHAR(200) NOT NULL, stock INT NOT NULL);
INSERT INTO items VALUES (N'A-1', N'Kaffeemühle', 12), (N'B-2', N'Teekanne «Lotus»', 0);
GO
