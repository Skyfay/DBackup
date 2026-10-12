-- Dataset of the dev lab for MySQL 5.7 and later and MariaDB 10.4 and later. Loaded once by
-- `pnpm lab:up` through the mysql client of the container, when the database inventory, made
-- last, is missing. It starts over from nothing, so a load that broke off can simply run again.

DROP DATABASE IF EXISTS shop;
DROP DATABASE IF EXISTS inventory;
CREATE DATABASE shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shop;

CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    note TEXT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    receipt BLOB NULL,
    ordered_on DATE NOT NULL,
    INDEX idx_orders_customer (customer_id),
    FOREIGN KEY (customer_id) REFERENCES customers (id)
);

INSERT INTO customers (name, email, note, created_at) VALUES
    ('Zoë Müller', 'zoe@example.ch', 'Grüezi 🦊', '2024-02-29 23:59:59'),
    ('李雷', 'lilei@example.cn', NULL, '1999-12-31 00:00:00'),
    ('O''Brien & Söhne', 'obrien@example.ie', 'Quote '' and backslash \\ inside', '2026-01-01 12:00:00');

INSERT INTO orders (customer_id, amount, paid, receipt, ordered_on) VALUES
    (1, 1234567890.12, TRUE, X'DEADBEEF00FF', '2024-02-29'),
    (1, 0.01, FALSE, NULL, '1970-01-01'),
    (2, 99.95, TRUE, X'00', '2038-01-19');

CREATE VIEW order_totals AS
    SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name;

DELIMITER //
CREATE PROCEDURE mark_paid(IN order_id INT)
BEGIN
    UPDATE orders SET paid = TRUE WHERE id = order_id;
END //
CREATE TRIGGER orders_amount_check BEFORE INSERT ON orders FOR EACH ROW
BEGIN
    IF NEW.amount < 0 THEN SET NEW.amount = 0; END IF;
END //
DELIMITER ;

CREATE EVENT nightly_cleanup ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM orders WHERE paid = FALSE AND ordered_on < '1971-01-01';

CREATE DATABASE inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inventory;
CREATE TABLE items (sku VARCHAR(20) PRIMARY KEY, title VARCHAR(200) NOT NULL, stock INT NOT NULL);
INSERT INTO items VALUES ('A-1', 'Kaffeemühle', 12), ('B-2', 'Teekanne «Lotus»', 0);
