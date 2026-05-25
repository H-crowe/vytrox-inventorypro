import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { assertPositiveInt, assertPositiveNumber, cleanString, httpError } from './validators.js';

export async function loginUser({ username, password }) {
  const cleanUsername = cleanString(username, 60);
  if (!cleanUsername || !password) throw httpError('Username and password are required.');
  const [rows] = await pool.execute(
    `SELECT users.id, username, password_hash, full_name, roles.name AS role
     FROM users JOIN roles ON roles.id = users.role_id
     WHERE username = :username AND is_active = TRUE`,
    { username: cleanUsername }
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) throw httpError('Invalid credentials.', 401);
  const payload = { id: user.id, username: user.username, fullName: user.full_name, role: user.role };
  return { token: jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' }), user: payload };
}

export async function createSale(body, userId) {
  const customerId = body.customer_id ? assertPositiveInt(body.customer_id, 'Customer') : null;
  const discount = assertPositiveNumber(body.discount || 0, 'Discount');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw httpError('At least one sale item is required.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let subtotal = 0;
    const saleRows = [];
    for (const item of items) {
      const productId = assertPositiveInt(item.product_id, 'Product');
      const quantity = assertPositiveInt(item.quantity, 'Quantity');
      const [rows] = await conn.execute('SELECT id, sale_price, stock_qty FROM products WHERE id = ? AND is_active = TRUE FOR UPDATE', [productId]);
      const product = rows[0];
      if (!product) throw httpError('Product not found.', 404);
      if (product.stock_qty < quantity) throw httpError(`Not enough stock for product #${productId}.`);
      subtotal += quantity * Number(product.sale_price);
      saleRows.push({ productId, quantity, unitPrice: Number(product.sale_price) });
    }
    const total = Math.max(0, subtotal - discount);
    const [sale] = await conn.execute('INSERT INTO sales (customer_id, user_id, subtotal, discount, total) VALUES (?, ?, ?, ?, ?)', [customerId, userId, subtotal, discount, total]);
    for (const item of saleRows) {
      await conn.execute('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [sale.insertId, item.productId, item.quantity, item.unitPrice]);
      await conn.execute('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?', [item.quantity, item.productId]);
      await conn.execute('INSERT INTO inventory_movements (product_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, "sale", ?, ?)', [item.productId, userId, -item.quantity, `Sale #${sale.insertId}`]);
    }
    await conn.commit();
    return { id: sale.insertId, subtotal, discount, total };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function createPurchase(body, userId) {
  const supplierId = body.supplier_id ? assertPositiveInt(body.supplier_id, 'Supplier') : null;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw httpError('At least one purchase item is required.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const [purchase] = await conn.execute('INSERT INTO purchases (supplier_id, user_id, total) VALUES (?, ?, 0)', [supplierId, userId]);
    for (const item of items) {
      const productId = assertPositiveInt(item.product_id, 'Product');
      const quantity = assertPositiveInt(item.quantity, 'Quantity');
      const unitCost = assertPositiveNumber(item.unit_cost, 'Unit cost');
      total += quantity * unitCost;
      await conn.execute('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', [purchase.insertId, productId, quantity, unitCost]);
      await conn.execute('UPDATE products SET stock_qty = stock_qty + ?, cost_price = ? WHERE id = ?', [quantity, unitCost, productId]);
      await conn.execute('INSERT INTO inventory_movements (product_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, "purchase", ?, ?)', [productId, userId, quantity, `Purchase #${purchase.insertId}`]);
    }
    await conn.execute('UPDATE purchases SET total = ? WHERE id = ?', [total, purchase.insertId]);
    await conn.commit();
    return { id: purchase.insertId, total };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function resetPassword(id, password) {
  if (String(password || '').length < 8) throw httpError('Password must be at least 8 characters.');
  const hash = await bcrypt.hash(String(password), 12);
  const [result] = await pool.execute('UPDATE users SET password_hash = :hash WHERE id = :id', { hash, id });
  if (!result.affectedRows) throw httpError('User not found.', 404);
  return { id, password_reset: true };
}
