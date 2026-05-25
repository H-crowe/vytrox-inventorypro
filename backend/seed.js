import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_sales',
  multipleStatements: true
});

const roles = ['admin', 'inventory_manager', 'cashier'];
for (const role of roles) {
  await db.execute('INSERT IGNORE INTO roles (name) VALUES (?)', [role]);
}

const [roleRows] = await db.query('SELECT id, name FROM roles');
const roleId = Object.fromEntries(roleRows.map((role) => [role.name, role.id]));

const users = [
  ['admin', 'Admin User', 'Admin@123', roleId.admin],
  ['inventory', 'Inventory Manager', 'Inventory@123', roleId.inventory_manager],
  ['cashier', 'Cashier User', 'Cashier@123', roleId.cashier]
];

for (const [username, fullName, password, role] of users) {
  const hash = await bcrypt.hash(password, 12);
  await db.execute(
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role_id = VALUES(role_id)`,
    [username, fullName, hash, role]
  );
}

await db.query(`
  INSERT IGNORE INTO categories (name) VALUES ('Electronics'), ('Accessories'), ('Office Supplies');
  INSERT IGNORE INTO customers (name, phone, email) VALUES
    ('Walk-in Customer', NULL, NULL),
    ('Sarah Johnson', '+10000000001', 'sarah@example.com');
  INSERT IGNORE INTO suppliers (name, phone, email) VALUES
    ('Main Supplier', '+10000000002', 'supplier@example.com');
  INSERT IGNORE INTO products (category_id, name, sku, cost_price, sale_price, stock_qty, low_stock_qty) VALUES
    ((SELECT id FROM categories WHERE name='Electronics'), 'Wireless Mouse', 'WM-100', 8.50, 14.99, 30, 5),
    ((SELECT id FROM categories WHERE name='Accessories'), 'USB-C Cable', 'UC-200', 2.00, 6.99, 50, 10),
    ((SELECT id FROM categories WHERE name='Office Supplies'), 'Notebook Pack', 'NB-300', 3.25, 8.99, 12, 6);
`);

await db.end();
console.log('Seed completed.');
