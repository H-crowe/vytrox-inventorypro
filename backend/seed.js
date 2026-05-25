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
  INSERT IGNORE INTO categories (name) VALUES
    ('Electronics'), ('Accessories'), ('Office Supplies'), ('Networking'), ('Storage');

  INSERT IGNORE INTO customers (name, phone, email) VALUES
    ('Walk-in Customer', NULL, NULL),
    ('Sarah Johnson', '+10000000001', 'sarah@example.com'),
    ('Omar Hassan', '+10000000002', 'omar@example.com'),
    ('Nadia Stores', '+10000000003', 'orders@nadiastores.example'),
    ('BlueTech Office', '+10000000004', 'it@bluetech.example');

  INSERT IGNORE INTO suppliers (name, phone, email) VALUES
    ('Main Supplier', '+10000000010', 'supplier@example.com'),
    ('North Distribution', '+10000000011', 'north@example.com'),
    ('Tech Wholesale Co.', '+10000000012', 'sales@techwholesale.example');

  INSERT IGNORE INTO products (category_id, name, sku, cost_price, sale_price, stock_qty, low_stock_qty) VALUES
    ((SELECT id FROM categories WHERE name='Electronics'), 'Wireless Mouse', 'WM-100', 8.50, 14.99, 30, 5),
    ((SELECT id FROM categories WHERE name='Accessories'), 'USB-C Cable', 'UC-200', 2.00, 6.99, 50, 10),
    ((SELECT id FROM categories WHERE name='Office Supplies'), 'Notebook Pack', 'NB-300', 3.25, 8.99, 12, 6),
    ((SELECT id FROM categories WHERE name='Electronics'), 'Mechanical Keyboard', 'MK-410', 32.00, 59.99, 18, 4),
    ((SELECT id FROM categories WHERE name='Networking'), 'Dual Band Router', 'RT-520', 41.00, 79.99, 9, 3),
    ((SELECT id FROM categories WHERE name='Storage'), 'Portable SSD 1TB', 'SSD-1T', 68.00, 119.99, 14, 4),
    ((SELECT id FROM categories WHERE name='Accessories'), 'Laptop Stand', 'LS-220', 13.00, 29.99, 22, 5),
    ((SELECT id FROM categories WHERE name='Office Supplies'), 'Thermal Receipt Roll', 'TR-080', 1.20, 3.50, 6, 12);
`);

async function getId(table, column, value) {
  const [rows] = await db.execute(`SELECT id FROM ${table} WHERE ${column} = ? LIMIT 1`, [value]);
  return rows[0]?.id;
}

const cashierId = await getId('users', 'username', 'cashier');
const inventoryId = await getId('users', 'username', 'inventory');
const supplierId = await getId('suppliers', 'name', 'Tech Wholesale Co.');
const customerIds = [
  await getId('customers', 'name', 'Sarah Johnson'),
  await getId('customers', 'name', 'Omar Hassan'),
  await getId('customers', 'name', 'Nadia Stores'),
  await getId('customers', 'name', 'BlueTech Office')
];

const samplePurchases = [
  { key: 'DEMO-PURCHASE-SSD', product: 'SSD-1T', quantity: 6, unitCost: 68.00 },
  { key: 'DEMO-PURCHASE-ROUTER', product: 'RT-520', quantity: 4, unitCost: 41.00 },
  { key: 'DEMO-PURCHASE-KEYBOARD', product: 'MK-410', quantity: 5, unitCost: 32.00 }
];

for (const item of samplePurchases) {
  const productId = await getId('products', 'sku', item.product);
  const [existing] = await db.execute('SELECT id FROM inventory_movements WHERE note = ? LIMIT 1', [item.key]);
  if (!existing.length && productId && inventoryId) {
    const total = item.quantity * item.unitCost;
    const [purchase] = await db.execute('INSERT INTO purchases (supplier_id, user_id, total) VALUES (?, ?, ?)', [supplierId, inventoryId, total]);
    await db.execute('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', [purchase.insertId, productId, item.quantity, item.unitCost]);
    await db.execute('UPDATE products SET stock_qty = stock_qty + ?, cost_price = ? WHERE id = ?', [item.quantity, item.unitCost, productId]);
    await db.execute('INSERT INTO inventory_movements (product_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, "purchase", ?, ?)', [productId, inventoryId, item.quantity, item.key]);
  }
}

const sampleSales = [
  { key: 'DEMO-SALE-001', customer: customerIds[0], lines: [['WM-100', 2], ['UC-200', 3]], discount: 2.00 },
  { key: 'DEMO-SALE-002', customer: customerIds[1], lines: [['MK-410', 1], ['LS-220', 1]], discount: 0 },
  { key: 'DEMO-SALE-003', customer: customerIds[2], lines: [['SSD-1T', 2], ['RT-520', 1]], discount: 15.00 },
  { key: 'DEMO-SALE-004', customer: customerIds[3], lines: [['NB-300', 4], ['TR-080', 5]], discount: 3.00 }
];

for (const saleData of sampleSales) {
  const [existing] = await db.execute('SELECT id FROM inventory_movements WHERE note = ? LIMIT 1', [saleData.key]);
  if (existing.length || !cashierId) continue;

  let subtotal = 0;
  const lines = [];
  for (const [sku, quantity] of saleData.lines) {
    const [products] = await db.execute('SELECT id, sale_price, stock_qty FROM products WHERE sku = ? LIMIT 1', [sku]);
    const product = products[0];
    if (!product || product.stock_qty < quantity) continue;
    subtotal += Number(product.sale_price) * quantity;
    lines.push({ productId: product.id, quantity, unitPrice: Number(product.sale_price) });
  }
  if (!lines.length) continue;

  const total = Math.max(0, subtotal - saleData.discount);
  const [sale] = await db.execute('INSERT INTO sales (customer_id, user_id, subtotal, discount, total) VALUES (?, ?, ?, ?, ?)', [saleData.customer, cashierId, subtotal, saleData.discount, total]);
  for (const line of lines) {
    await db.execute('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [sale.insertId, line.productId, line.quantity, line.unitPrice]);
    await db.execute('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [line.quantity, line.productId]);
    await db.execute('INSERT INTO inventory_movements (product_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, "sale", ?, ?)', [line.productId, cashierId, -line.quantity, saleData.key]);
  }
}

await db.end();
console.log('Seed completed.');
