import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { auth, asyncHandler, requirePermission } from './middleware.js';
import { createPurchase, createSale, loginUser, resetPassword } from './services.js';
import { assertPositiveInt, assertPositiveNumber, cleanString, httpError } from './validators.js';

export const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true }));
router.post('/login', asyncHandler(async (req, res) => res.json(await loginUser(req.body))));

router.get('/dashboard', auth, requirePermission('read'), asyncHandler(async (_req, res) => {
  const [[stats], [lowStock], [topProducts], [recentSales]] = await Promise.all([
    pool.query(`SELECT (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS products, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COALESCE(SUM(total), 0) FROM sales WHERE DATE(created_at) = CURDATE()) AS todaySales, (SELECT COALESCE(SUM(total), 0) FROM sales) AS totalRevenue, (SELECT COALESCE(SUM((sale_items.unit_price - products.cost_price) * sale_items.quantity), 0) FROM sale_items JOIN products ON products.id = sale_items.product_id) AS estimatedProfit, (SELECT COUNT(*) FROM products WHERE stock_qty <= low_stock_qty AND is_active = TRUE) AS lowStockCount`),
    pool.query('SELECT id, name, sku, stock_qty, low_stock_qty FROM products WHERE stock_qty <= low_stock_qty AND is_active = TRUE ORDER BY stock_qty ASC LIMIT 8'),
    pool.query('SELECT products.name, SUM(sale_items.quantity) AS quantity FROM sale_items JOIN products ON products.id = sale_items.product_id GROUP BY products.id, products.name ORDER BY quantity DESC LIMIT 5'),
    pool.query("SELECT sales.id, COALESCE(customers.name, 'Walk-in') AS customer_name, sales.total, sales.created_at FROM sales LEFT JOIN customers ON customers.id = sales.customer_id ORDER BY sales.id DESC LIMIT 6")
  ]);
  res.json({ stats: stats[0], lowStock, topProducts, recentSales });
}));

router.get('/reports', auth, requirePermission('read'), asyncHandler(async (_req, res) => {
  const [[summary], [salesByDay], [stockValue], [topCustomers]] = await Promise.all([
    pool.query('SELECT COUNT(*) AS salesCount, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(discount), 0) AS discounts, COALESCE(AVG(total), 0) AS averageOrder FROM sales'),
    pool.query('SELECT DATE(created_at) AS sale_date, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM sales GROUP BY DATE(created_at) ORDER BY sale_date DESC LIMIT 14'),
    pool.query('SELECT COALESCE(SUM(stock_qty * cost_price), 0) AS costValue, COALESCE(SUM(stock_qty * sale_price), 0) AS retailValue FROM products WHERE is_active = TRUE'),
    pool.query("SELECT COALESCE(customers.name, 'Walk-in') AS customer_name, COUNT(sales.id) AS orders, COALESCE(SUM(sales.total), 0) AS revenue FROM sales LEFT JOIN customers ON customers.id = sales.customer_id GROUP BY customer_name ORDER BY revenue DESC LIMIT 8")
  ]);
  res.json({ summary: summary[0], salesByDay, stockValue: stockValue[0], topCustomers });
}));

router.get('/:resource(products|categories|customers|suppliers)', auth, requirePermission('read'), asyncHandler(async (req, res) => {
  const search = `%${cleanString(req.query.search || '', 80)}%`;
  const queries = {
    products: 'SELECT products.*, categories.name AS category_name FROM products LEFT JOIN categories ON categories.id = products.category_id WHERE products.name LIKE :search OR sku LIKE :search ORDER BY products.id DESC',
    categories: 'SELECT * FROM categories WHERE name LIKE :search ORDER BY id DESC',
    customers: 'SELECT * FROM customers WHERE name LIKE :search OR phone LIKE :search ORDER BY id DESC',
    suppliers: 'SELECT * FROM suppliers WHERE name LIKE :search OR phone LIKE :search ORDER BY id DESC'
  };
  const [rows] = await pool.execute(queries[req.params.resource], { search });
  res.json(rows);
}));

router.post('/products', auth, requirePermission('write_inventory'), asyncHandler(async (req, res) => {
  const product = productPayload(req.body);
  const [result] = await pool.execute('INSERT INTO products (category_id, name, sku, cost_price, sale_price, stock_qty, low_stock_qty) VALUES (:category_id, :name, :sku, :cost_price, :sale_price, :stock_qty, :low_stock_qty)', product);
  res.status(201).json({ id: result.insertId, ...product });
}));

router.put('/products/:id', auth, requirePermission('write_inventory'), asyncHandler(async (req, res) => {
  const product = { id: assertPositiveInt(req.params.id, 'Product'), ...productPayload(req.body), is_active: req.body.is_active === false || req.body.is_active === 'false' ? 0 : 1 };
  await pool.execute('UPDATE products SET category_id=:category_id, name=:name, sku=:sku, cost_price=:cost_price, sale_price=:sale_price, stock_qty=:stock_qty, low_stock_qty=:low_stock_qty, is_active=:is_active WHERE id=:id', product);
  res.json(product);
}));

router.delete('/products/:id', auth, requirePermission('write_inventory'), asyncHandler(async (req, res) => {
  const id = assertPositiveInt(req.params.id, 'Product');
  await pool.execute('UPDATE products SET is_active = FALSE WHERE id = :id', { id });
  res.json({ id, deleted: true });
}));

router.post('/:resource(categories|customers|suppliers)', auth, requirePermission('write_inventory'), asyncHandler(async (req, res) => {
  const name = cleanString(req.body.name, 140);
  const phone = cleanString(req.body.phone || '', 40) || null;
  const email = cleanString(req.body.email || '', 120) || null;
  if (!name) throw httpError('Name is required.');
  if (req.params.resource === 'categories') {
    const [result] = await pool.execute('INSERT INTO categories (name) VALUES (:name)', { name });
    return res.status(201).json({ id: result.insertId, name });
  }
  const [result] = await pool.execute(`INSERT INTO ${req.params.resource} (name, phone, email) VALUES (:name, :phone, :email)`, { name, phone, email });
  res.status(201).json({ id: result.insertId, name, phone, email });
}));

router.get('/sales', auth, requirePermission('read'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.query("SELECT sales.id, COALESCE(customers.name, 'Walk-in') AS customer_name, users.username, sales.subtotal, sales.discount, sales.total, sales.created_at FROM sales LEFT JOIN customers ON customers.id = sales.customer_id JOIN users ON users.id = sales.user_id ORDER BY sales.id DESC LIMIT 100");
  res.json(rows);
}));

router.get('/sales/:id', auth, requirePermission('read'), asyncHandler(async (req, res) => {
  const id = assertPositiveInt(req.params.id, 'Sale');
  const [[saleRows], [items]] = await Promise.all([
    pool.execute("SELECT sales.*, COALESCE(customers.name, 'Walk-in') AS customer_name, customers.phone, users.username FROM sales LEFT JOIN customers ON customers.id = sales.customer_id JOIN users ON users.id = sales.user_id WHERE sales.id = :id", { id }),
    pool.execute('SELECT sale_items.*, products.name, products.sku FROM sale_items JOIN products ON products.id = sale_items.product_id WHERE sale_items.sale_id = :id', { id })
  ]);
  if (!saleRows[0]) throw httpError('Sale not found.', 404);
  res.json({ sale: saleRows[0], items });
}));

router.post('/sales', auth, requirePermission('sale'), asyncHandler(async (req, res) => res.status(201).json(await createSale(req.body, req.user.id))));

router.get('/purchases', auth, requirePermission('read'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.query("SELECT purchases.id, COALESCE(suppliers.name, 'No supplier') AS supplier_name, users.username, purchases.total, purchases.created_at FROM purchases LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id JOIN users ON users.id = purchases.user_id ORDER BY purchases.id DESC LIMIT 100");
  res.json(rows);
}));

router.post('/purchases', auth, requirePermission('purchase'), asyncHandler(async (req, res) => res.status(201).json(await createPurchase(req.body, req.user.id))));

router.get('/movements', auth, requirePermission('read'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT inventory_movements.*, products.name AS product_name, users.username FROM inventory_movements JOIN products ON products.id = inventory_movements.product_id JOIN users ON users.id = inventory_movements.user_id ORDER BY inventory_movements.id DESC LIMIT 100');
  res.json(rows);
}));

router.get('/users', auth, requirePermission('*'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT users.id, users.username, users.full_name, roles.name AS role, users.is_active, users.created_at FROM users JOIN roles ON roles.id = users.role_id ORDER BY users.id DESC');
  res.json(rows);
}));

router.post('/users', auth, requirePermission('*'), asyncHandler(async (req, res) => {
  const username = cleanString(req.body.username, 60);
  const fullName = cleanString(req.body.full_name, 120);
  const role = cleanString(req.body.role, 40);
  const password = String(req.body.password || '');
  if (!username || !fullName || !role || password.length < 8) throw httpError('Username, full name, role, and an 8+ character password are required.');
  const [roles] = await pool.execute('SELECT id FROM roles WHERE name = :role', { role });
  if (!roles[0]) throw httpError('Invalid role.');
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (:username, :fullName, :hash, :roleId)', { username, fullName, hash, roleId: roles[0].id });
  res.status(201).json({ id: result.insertId, username, full_name: fullName, role });
}));

router.put('/users/:id/password', auth, requirePermission('*'), asyncHandler(async (req, res) => res.json(await resetPassword(assertPositiveInt(req.params.id, 'User'), req.body.password))));

function productPayload(body) {
  const product = {
    name: cleanString(body.name),
    sku: cleanString(body.sku, 80),
    category_id: body.category_id || null,
    cost_price: assertPositiveNumber(body.cost_price, 'Cost price'),
    sale_price: assertPositiveNumber(body.sale_price, 'Sale price'),
    stock_qty: Number.isInteger(Number(body.stock_qty)) ? Number(body.stock_qty) : 0,
    low_stock_qty: Number.isInteger(Number(body.low_stock_qty)) ? Number(body.low_stock_qty) : 5
  };
  if (!product.name || !product.sku) throw httpError('Product name and SKU are required.');
  return product;
}
