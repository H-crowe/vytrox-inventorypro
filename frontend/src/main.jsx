import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Archive, BarChart3, Boxes, FileText, LayoutDashboard, LogOut, PackagePlus,
  Plus, Printer, ReceiptText, RotateCcwKey, Search, ShoppingCart, Store, Truck,
  UserPlus, Users as UsersIcon, X
} from 'lucide-react';
import './styles.css';

const API = 'http://localhost:4000/api';
const navGroups = [
  { title: 'Operations', items: ['Overview', 'Products', 'Sales', 'Purchases'] },
  { title: 'Management', items: ['People', 'Audit Log'] },
  { title: 'Insights', items: ['Reports'] },
  { title: 'Admin', items: ['Users'] }
];
const navIcons = { Overview: LayoutDashboard, Products: Boxes, Sales: ShoppingCart, Purchases: Truck, People: UsersIcon, Reports: BarChart3, Users: UserPlus, 'Audit Log': Activity };

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  const [page, setPage] = useState('Overview');
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [search, setSearch] = useState('');
  const [peopleTab, setPeopleTab] = useState('Customers');
  const [data, setData] = useState({ dashboard: null, reports: null, products: [], categories: [], customers: [], suppliers: [], sales: [], purchases: [], movements: [], users: [] });

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);
  const canInventory = user?.role === 'admin' || user?.role === 'inventory_manager';
  const canSell = user?.role === 'admin' || user?.role === 'cashier';
  const isAdmin = user?.role === 'admin';

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Request failed.');
    return body;
  }

  async function loadAll() {
    if (!token) return;
    try {
      const [dashboard, reports, products, categories, customers, suppliers, sales, purchases, movements] = await Promise.all([
        request('/dashboard'), request('/reports'), request('/products'), request('/categories'), request('/customers'),
        request('/suppliers'), request('/sales'), request('/purchases'), request('/movements')
      ]);
      const users = isAdmin ? await request('/users') : [];
      setData({ dashboard, reports, products, categories, customers, suppliers, sales, purchases, movements, users });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  useEffect(() => { loadAll(); }, [token]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
  }

  async function login(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await fetch(`${API}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message);
        return body;
      });
      localStorage.setItem('token', result.token);
      localStorage.setItem('user', JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function logout() {
    localStorage.clear();
    setToken('');
    setUser(null);
  }

  async function submit(event, action, message = 'Saved successfully.') {
    event.preventDefault();
    try {
      await action(Object.fromEntries(new FormData(event.currentTarget)));
      setModal(null);
      await loadAll();
      showToast(message);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const actions = {
    product: (form) => request(modal?.product ? `/products/${modal.product.id}` : '/products', { method: modal?.product ? 'PUT' : 'POST', body: JSON.stringify(form) }),
    disableProduct: async (id) => { await request(`/products/${id}`, { method: 'DELETE' }); await loadAll(); showToast('Product disabled.'); },
    activateProduct: async (product) => { await request(`/products/${product.id}`, { method: 'PUT', body: JSON.stringify({ ...product, is_active: true }) }); await loadAll(); showToast('Product activated.'); },
    category: (form) => request('/categories', { method: 'POST', body: JSON.stringify(form) }),
    customer: (form) => request('/customers', { method: 'POST', body: JSON.stringify(form) }),
    supplier: (form) => request('/suppliers', { method: 'POST', body: JSON.stringify(form) }),
    sale: (form) => request('/sales', { method: 'POST', body: JSON.stringify({ customer_id: form.customer_id || null, discount: form.discount || 0, items: [{ product_id: Number(form.product_id), quantity: Number(form.quantity) }] }) }),
    purchase: (form) => request('/purchases', { method: 'POST', body: JSON.stringify({ supplier_id: form.supplier_id || null, items: [{ product_id: Number(form.product_id), quantity: Number(form.quantity), unit_cost: Number(form.unit_cost) }] }) }),
    user: (form) => request('/users', { method: 'POST', body: JSON.stringify(form) }),
    resetPassword: (id, password) => request(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    invoice: async (id) => setInvoice(await request(`/sales/${id}`))
  };

  if (!token) return <Login toast={toast} onLogin={login} />;

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} isAdmin={isAdmin} user={user} />
      <main className="workspace">
        <Topbar page={page} user={user} onLogout={logout} />
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
        {invoice && <InvoiceModal invoice={invoice} onClose={() => setInvoice(null)} />}
        {modal && <AppModal modal={modal} setModal={setModal} data={data} submit={submit} actions={actions} />}
        {page === 'Overview' && <Overview dashboard={data.dashboard} setPage={setPage} />}
        {page === 'Products' && <Products data={data} search={search} setSearch={setSearch} canInventory={canInventory} setModal={setModal} actions={actions} />}
        {page === 'Sales' && <Sales data={data} canSell={canSell} setModal={setModal} actions={actions} />}
        {page === 'Purchases' && <Purchases data={data} canInventory={canInventory} setModal={setModal} />}
        {page === 'People' && <People data={data} canInventory={canInventory} peopleTab={peopleTab} setPeopleTab={setPeopleTab} setModal={setModal} />}
        {page === 'Reports' && <Reports reports={data.reports} dashboard={data.dashboard} />}
        {page === 'Users' && <Users users={data.users} setModal={setModal} />}
        {page === 'Audit Log' && <Section title="Inventory Movements" description="Every stock change created by purchases and sales." icon={Activity}><Table rows={data.movements} columns={['product_name', 'movement_type', 'quantity_change', 'username', 'note', 'created_at']} /></Section>}
      </main>
    </div>
  );
}

function Sidebar({ page, setPage, isAdmin, user }) {
  return (
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Store size={22} /></div><div><strong>Vytrox</strong><span>InventoryPro</span></div></div>
      <nav className="side-nav">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => item !== 'Users' || isAdmin);
          if (!items.length) return null;
          return <div className="nav-group" key={group.title}><p>{group.title}</p>{items.map((item) => {
            const Icon = navIcons[item];
            return <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}><Icon size={18} />{item}</button>;
          })}</div>;
        })}
      </nav>
      <div className="user-card"><strong>{user.fullName}</strong><span>{label(user.role)}</span></div>
    </aside>
  );
}

function Topbar({ page, user, onLogout }) {
  return (
    <header className="topbar">
      <div><p className="eyebrow">Vytrox InventoryPro</p><h1>{pageTitle(page)}</h1><span>{pageSubtitle(page)}</span></div>
      <div className="top-actions"><div className="role-pill">{user.username}</div><button className="secondary icon-button" onClick={onLogout}><LogOut size={17} /> Logout</button></div>
    </header>
  );
}

function Login({ toast, onLogin }) {
  return (
    <main className="auth">
      {toast && <Toast toast={toast} />}
      <form className="login-card" onSubmit={onLogin}>
        <div className="brand login-brand"><div className="brand-mark"><Store size={22} /></div><div><strong>Vytrox</strong><span>InventoryPro</span></div></div>
        <h1>Welcome back</h1>
        <p>Sign in to manage inventory, invoices, staff, and reports.</p>
        <input name="username" placeholder="Username" defaultValue="admin" required />
        <input name="password" type="password" placeholder="Password" defaultValue="Admin@123" required />
        <button>Sign in</button>
      </form>
    </main>
  );
}

function Overview({ dashboard, setPage }) {
  const stats = [
    ['Active Products', dashboard?.stats?.products ?? 0, Boxes],
    ['Customers', dashboard?.stats?.customers ?? 0, UsersIcon],
    ['Today Sales', money(dashboard?.stats?.todaySales ?? 0), ReceiptText],
    ['Estimated Profit', money(dashboard?.stats?.estimatedProfit ?? 0), BarChart3]
  ];
  return (
    <>
      <section className="stats-grid">{stats.map(([name, value, Icon]) => <article className="stat-card" key={name}><div><span>{name}</span><strong>{value}</strong></div><Icon size={22} /></article>)}</section>
      <section className="grid two">
        <Section title="Recent Sales" description="Latest invoices created by your team." icon={ReceiptText} action={<button className="secondary mini" onClick={() => setPage('Sales')}>View all</button>}><Table rows={dashboard?.recentSales || []} columns={['id', 'customer_name', 'total', 'created_at']} /></Section>
        <Section title="Low Stock Alerts" description="Products that need restocking soon." icon={Archive} action={<button className="secondary mini" onClick={() => setPage('Products')}>Manage</button>}><Table rows={dashboard?.lowStock || []} columns={['sku', 'name', 'stock_qty', 'low_stock_qty']} /></Section>
      </section>
    </>
  );
}

function Products({ data, search, setSearch, canInventory, setModal, actions }) {
  const products = data.products.filter((p) => `${p.name} ${p.sku} ${p.category_name || ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Section title="Product Catalog" description="Search, edit, activate, or disable inventory items." icon={Boxes} action={<button disabled={!canInventory} onClick={() => setModal({ type: 'product' })}><Plus size={17} />Add Product</button>}>
      <Toolbar search={search} setSearch={setSearch} placeholder="Search products by name, SKU, or category" />
      <Table rows={products} columns={['sku', 'name', 'category_name', 'sale_price', 'stock_qty', 'is_active']} actions={(row) => <>
        <button className="mini secondary" onClick={() => setModal({ type: 'product', product: row })}><FileText size={14} />Edit</button>
        {row.is_active ? <button className="mini danger" onClick={() => actions.disableProduct(row.id)}>Disable</button> : <button className="mini" onClick={() => actions.activateProduct(row)}>Activate</button>}
      </>} />
    </Section>
  );
}

function Sales({ data, canSell, setModal, actions }) {
  return (
    <Section title="Sales" description="Create sales invoices and print customer receipts." icon={ShoppingCart} action={<button disabled={!canSell} onClick={() => setModal({ type: 'sale' })}><ReceiptText size={17} />New Sale</button>}>
      <Table rows={data.sales} columns={['id', 'customer_name', 'username', 'total', 'created_at']} actions={(row) => <button className="mini secondary" onClick={() => actions.invoice(row.id)}><Printer size={14} />Invoice</button>} />
    </Section>
  );
}

function Purchases({ data, canInventory, setModal }) {
  return (
    <Section title="Purchases" description="Record supplier purchases and increase stock automatically." icon={Truck} action={<button disabled={!canInventory} onClick={() => setModal({ type: 'purchase' })}><PackagePlus size={17} />New Purchase</button>}>
      <Table rows={data.purchases} columns={['id', 'supplier_name', 'username', 'total', 'created_at']} />
    </Section>
  );
}

function People({ data, canInventory, peopleTab, setPeopleTab, setModal }) {
  const config = {
    Customers: { rows: data.customers, columns: ['name', 'phone', 'email'], modal: 'customer' },
    Suppliers: { rows: data.suppliers, columns: ['name', 'phone', 'email'], modal: 'supplier' },
    Categories: { rows: data.categories, columns: ['name'], modal: 'category' }
  };
  const current = config[peopleTab];
  return (
    <Section title="People & Categories" description="Keep customers, suppliers, and product groups organized." icon={UsersIcon} action={<button disabled={!canInventory} onClick={() => setModal({ type: current.modal })}><Plus size={17} />Add {peopleTab.slice(0, -1)}</button>}>
      <div className="segmented">{Object.keys(config).map((tab) => <button key={tab} className={peopleTab === tab ? 'active' : ''} onClick={() => setPeopleTab(tab)}>{tab}</button>)}</div>
      <Table rows={current.rows} columns={current.columns} />
    </Section>
  );
}

function Reports({ reports, dashboard }) {
  const cards = [
    ['Total Revenue', money(reports?.summary?.revenue ?? 0), BarChart3],
    ['Average Order', money(reports?.summary?.averageOrder ?? 0), ReceiptText],
    ['Inventory Cost Value', money(reports?.stockValue?.costValue ?? 0), Archive],
    ['Low Stock Items', dashboard?.stats?.lowStockCount ?? 0, Activity]
  ];
  return (
    <>
      <section className="stats-grid">{cards.map(([name, value, Icon]) => <article className="stat-card" key={name}><div><span>{name}</span><strong>{value}</strong></div><Icon size={22} /></article>)}</section>
      <section className="grid two">
        <Section title="Sales By Day" description="Revenue movement across recent days." icon={BarChart3}><Table rows={reports?.salesByDay || []} columns={['sale_date', 'orders', 'revenue']} /></Section>
        <Section title="Top Customers" description="Customers ranked by revenue contribution." icon={UsersIcon}><Table rows={reports?.topCustomers || []} columns={['customer_name', 'orders', 'revenue']} /></Section>
      </section>
    </>
  );
}

function Users({ users, setModal }) {
  return (
    <Section title="Staff Accounts" description="Create staff users and reset temporary passwords." icon={UserPlus} action={<button onClick={() => setModal({ type: 'user' })}><UserPlus size={17} />Create User</button>}>
      <Table rows={users} columns={['username', 'full_name', 'role', 'is_active', 'created_at']} actions={(row) => <button className="mini secondary" onClick={() => setModal({ type: 'reset', user: row })}><RotateCcwKey size={14} />Reset</button>} />
    </Section>
  );
}

function AppModal({ modal, setModal, data, submit, actions }) {
  const title = modalTitle(modal);
  return (
    <div className="modal-backdrop">
      <article className="modal-card">
        <div className="modal-head"><div><p className="eyebrow">Action</p><h2>{title}</h2></div><button className="secondary square" onClick={() => setModal(null)}><X size={18} /></button></div>
        {modal.type === 'product' && <ProductForm product={modal.product} categories={data.categories} onSubmit={(e) => submit(e, actions.product, modal.product ? 'Product updated.' : 'Product created.')} />}
        {modal.type === 'sale' && <SaleForm data={data} onSubmit={(e) => submit(e, actions.sale, 'Sale created and stock updated.')} />}
        {modal.type === 'purchase' && <PurchaseForm data={data} onSubmit={(e) => submit(e, actions.purchase, 'Purchase created and stock increased.')} />}
        {['customer', 'supplier', 'category'].includes(modal.type) && <SimpleForm type={modal.type} onSubmit={(e) => submit(e, actions[modal.type])} />}
        {modal.type === 'user' && <UserForm onSubmit={(e) => submit(e, actions.user, 'User created.')} />}
        {modal.type === 'reset' && <ResetForm user={modal.user} onSubmit={async (e) => { e.preventDefault(); try { await actions.resetPassword(modal.user.id, new FormData(e.currentTarget).get('password')); setModal(null); } catch (err) { alert(err.message); } }} />}
      </article>
    </div>
  );
}

function ProductForm({ product, categories, onSubmit }) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <input name="name" placeholder="Product name" defaultValue={product?.name || ''} required />
    <input name="sku" placeholder="SKU" defaultValue={product?.sku || ''} required />
    <select name="category_id" defaultValue={product?.category_id || ''}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <input name="cost_price" type="number" step="0.01" placeholder="Cost" defaultValue={product?.cost_price || ''} required />
    <input name="sale_price" type="number" step="0.01" placeholder="Sale price" defaultValue={product?.sale_price || ''} required />
    <input name="stock_qty" type="number" placeholder="Stock" defaultValue={product?.stock_qty ?? 0} />
    <input name="low_stock_qty" type="number" placeholder="Low stock alert" defaultValue={product?.low_stock_qty ?? 5} />
    <select name="is_active" defaultValue={product?.is_active === 0 ? 'false' : 'true'}><option value="true">Active</option><option value="false">Inactive</option></select>
    <button>{product ? 'Update Product' : 'Create Product'}</button>
  </form>;
}

function SaleForm({ data, onSubmit }) {
  return <form className="stack" onSubmit={onSubmit}>
    <select name="customer_id"><option value="">Walk-in customer</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select name="product_id" required><option value="">Select product</option>{data.products.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name} - stock {p.stock_qty}</option>)}</select>
    <input name="quantity" type="number" min="1" placeholder="Quantity" required />
    <input name="discount" type="number" min="0" step="0.01" placeholder="Discount" />
    <button>Create Sale</button>
  </form>;
}

function PurchaseForm({ data, onSubmit }) {
  return <form className="stack" onSubmit={onSubmit}>
    <select name="supplier_id"><option value="">Select supplier</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    <select name="product_id" required><option value="">Select product</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <input name="quantity" type="number" min="1" placeholder="Quantity" required />
    <input name="unit_cost" type="number" min="0" step="0.01" placeholder="Unit cost" required />
    <button>Create Purchase</button>
  </form>;
}

function SimpleForm({ type, onSubmit }) {
  return <form className="stack" onSubmit={onSubmit}>
    <input name="name" placeholder={`${label(type)} name`} required />
    {type !== 'category' && <input name="phone" placeholder="Phone" />}
    {type !== 'category' && <input name="email" placeholder="Email" />}
    <button>Create {label(type)}</button>
  </form>;
}

function UserForm({ onSubmit }) {
  return <form className="stack" onSubmit={onSubmit}>
    <input name="username" placeholder="Username" required />
    <input name="full_name" placeholder="Full name" required />
    <select name="role" required><option value="cashier">Cashier</option><option value="inventory_manager">Inventory Manager</option><option value="admin">Admin</option></select>
    <input name="password" type="password" placeholder="Temporary password" required />
    <button>Create User</button>
  </form>;
}

function ResetForm({ user, onSubmit }) {
  return <form className="stack" onSubmit={onSubmit}>
    <p className="muted">Set a new temporary password for <strong>{user.username}</strong>.</p>
    <input name="password" type="password" placeholder="New temporary password" required />
    <button><RotateCcwKey size={17} />Reset Password</button>
  </form>;
}

function InvoiceModal({ invoice, onClose }) {
  return <div className="modal-backdrop"><article className="invoice">
    <div className="invoice-head"><div><p className="eyebrow">Invoice</p><h2>Sale #{invoice.sale.id}</h2><span>{invoice.sale.created_at}</span></div><div className="invoice-actions"><button className="secondary icon-button" onClick={() => window.print()}><Printer size={17} />Print</button><button onClick={onClose}>Close</button></div></div>
    <p><strong>Customer:</strong> {invoice.sale.customer_name}</p>
    <Table rows={invoice.items} columns={['sku', 'name', 'quantity', 'unit_price']} />
    <div className="totals"><span>Subtotal {money(invoice.sale.subtotal)}</span><span>Discount {money(invoice.sale.discount)}</span><strong>Total {money(invoice.sale.total)}</strong></div>
  </article></div>;
}

function Section({ title, description, icon: Icon, action, children }) {
  return <section className="section-card"><div className="section-head"><div className="section-title"><div className="section-icon">{Icon && <Icon size={20} />}</div><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{action}</div>{children}</section>;
}

function Toolbar({ search, setSearch, placeholder }) {
  return <div className="toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} /></div></div>;
}

function Toast({ toast, onClose }) {
  return <div className={`toast ${toast.type || 'success'}`}><span>{toast.message}</span>{onClose && <button onClick={onClose}><X size={15} /></button>}</div>;
}

function Table({ rows, columns, actions }) {
  if (!rows.length) return <div className="empty-state"><Archive size={24} /><strong>No records yet</strong><span>New records will appear here automatically.</span></div>;
  return <div className="table-wrap"><table><thead><tr>{columns.map((col) => <th key={col}>{label(col)}</th>)}{actions && <th>Actions</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((col) => <td key={col}>{cell(row[col], col)}</td>)}{actions && <td className="actions">{actions(row)}</td>}</tr>)}</tbody></table></div>;
}

function modalTitle(modal) {
  if (modal.type === 'product') return modal.product ? 'Edit Product' : 'Add Product';
  if (modal.type === 'sale') return 'Create Sale';
  if (modal.type === 'purchase') return 'Create Purchase';
  if (modal.type === 'reset') return 'Reset Password';
  if (modal.type === 'user') return 'Create Staff User';
  return `Create ${label(modal.type)}`;
}

function pageTitle(value) { return value === 'Overview' ? 'Business Overview' : value; }
function pageSubtitle(value) {
  return {
    Overview: 'A quick operational snapshot for today.',
    Products: 'Catalog, stock, prices, and product status.',
    Sales: 'Invoices, receipts, and stock deductions.',
    Purchases: 'Supplier stock intake and purchase history.',
    People: 'Customers, suppliers, and categories.',
    Reports: 'Revenue and inventory performance.',
    Users: 'Staff accounts and password resets.',
    'Audit Log': 'Traceable inventory movement history.'
  }[value];
}
function label(value) { return String(value).replaceAll('_', ' '); }
function cell(value, key) {
  if (value === null || value === undefined || value === '') return '-';
  if (['total', 'subtotal', 'discount', 'revenue', 'averageOrder', 'costValue', 'retailValue', 'unit_price', 'sale_price', 'cost_price'].includes(key)) return money(value);
  if (key === 'is_active') return <span className={`badge ${value ? 'active' : 'inactive'}`}>{value ? 'Active' : 'Inactive'}</span>;
  return String(value);
}
function money(value) { return `$${Number(value).toFixed(2)}`; }

createRoot(document.getElementById('root')).render(<App />);
