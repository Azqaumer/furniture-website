// server.js — no framework, no npm install required.
// Run with: node server/server.js
// Then open http://localhost:3000

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;

// Resolve project root (the directory above server/)
const ROOT_DIR = path.resolve(__dirname, '..');

const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  throw new Error('ADMIN_KEY environment variable is required.');
}

function isAdmin(req) {
  return req.headers['x-admin-key'] === ADMIN_KEY;
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (data.length > 1e6) {
        tooLarge = true;
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (!tooLarge) reject(err);
    });
  });
}

function getRatingMap() {
  const rows = db
    .prepare(
      `SELECT product_id, COUNT(*) AS count, AVG(rating) AS avg
       FROM reviews GROUP BY product_id`
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.product_id, {
      avg: Math.round(row.avg * 10) / 10,
      count: row.count,
    });
  }
  return map;
}

function serializeProduct(p, ratingMap) {
  const rating = ratingMap ? ratingMap.get(p.id) : null;
  return {
    id: p.id,
    name: p.name,
    priceCents: p.price_cents,
    price: p.price_cents / 100,
    category: p.category,
    collection: p.collection,
    img: p.img,
    description: p.description,
    stock: p.stock,
    ratingAvg: rating ? rating.avg : null,
    ratingCount: rating ? rating.count : 0,
  };
}

function serializeReview(r) {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

function serializeCollection(c, productCountMap) {
  return {
    slug: c.slug,
    name: c.name,
    heroImg: c.hero_img,
    productCount: productCountMap ? productCountMap.get(c.slug) || 0 : undefined,
  };
}

const VALID_CATEGORIES = new Set(['sofa', 'chair', 'table', 'bed', 'decor']);

function collectionExists(slug) {
  return !!db.prepare('SELECT 1 FROM collections WHERE slug = ?').get(slug);
}

function validateProductInput(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required.' };
    if (name.length > 200) return { error: 'Name is too long.' };
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return { error: 'Price must be a positive number.' };
    data.price_cents = Math.round(price * 100);
  }

  if (!partial || body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) return { error: 'Stock must be a whole number 0 or greater.' };
    data.stock = stock;
  }

  if (!partial || body.category !== undefined) {
    const category = String(body.category || '').trim();
    if (!VALID_CATEGORIES.has(category)) {
      return { error: `Category must be one of: ${[...VALID_CATEGORIES].join(', ')}.` };
    }
    data.category = category;
  }

  if (!partial || body.collection !== undefined) {
    const collection = String(body.collection || '').trim();
    if (!collectionExists(collection)) {
      return { error: `Unknown collection "${collection}". Create it first.` };
    }
    data.collection = collection;
  }

  if (!partial || body.img !== undefined) {
    const img = String(body.img || '').trim();
    if (!img) return { error: 'Image URL is required.' };
    data.img = img;
  }

  if (!partial || body.description !== undefined) {
    data.description = String(body.description || '').trim();
  }

  return { data };
}

function luhnCheck(digits) {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function validatePayment(payment) {
  if (!payment || !payment.method) {
    return { error: 'Payment method is required.' };
  }

  const method = payment.method;
  if (method !== 'card' && method !== 'cod') {
    return { error: 'Invalid payment method.' };
  }

  if (method === 'cod') {
    return { method, cardLast4: null };
  }

  const nameOnCard = String(payment.nameOnCard || '').trim();
  const cardNumber = String(payment.cardNumber || '').replace(/\s+/g, '');
  const expiry = String(payment.expiry || '').trim();
  const cvv = String(payment.cvv || '').trim();

  if (!nameOnCard) {
    return { error: 'Name on card is required.' };
  }
  if (!/^\d{13,19}$/.test(cardNumber) || !luhnCheck(cardNumber)) {
    return { error: 'Card number is invalid.' };
  }

  const expMatch = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!expMatch) {
    return { error: 'Expiry must be in MM/YY format.' };
  }
  const expMonth = Number(expMatch[1]);
  const expYear = 2000 + Number(expMatch[2]);
  if (expMonth < 1 || expMonth > 12) {
    return { error: 'Expiry month is invalid.' };
  }
  const expiresAt = new Date(expYear, expMonth, 1);
  if (expiresAt <= new Date()) {
    return { error: 'Card has expired.' };
  }

  if (!/^\d{3,4}$/.test(cvv)) {
    return { error: 'CVV is invalid.' };
  }

  return { method, cardLast4: cardNumber.slice(-4) };
}

function checkout({ items, customer, shipping, payment }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: 'Cart is empty.' };
  }
  if (!customer || !customer.name || !customer.email) {
    return { ok: false, status: 400, error: 'Name and email are required.' };
  }
  if (
    !shipping ||
    !shipping.address ||
    !shipping.city ||
    !shipping.postalCode ||
    !shipping.country
  ) {
    return { ok: false, status: 400, error: 'A complete shipping address is required.' };
  }

  const paymentResult = validatePayment(payment);
  if (paymentResult.error) {
    return { ok: false, status: 400, error: paymentResult.error };
  }
  const { method: paymentMethod, cardLast4 } = paymentResult;

  db.exec('BEGIN IMMEDIATE');
  try {
    let totalCents = 0;
    const lineItems = [];

    for (const { productId, qty } of items) {
      const quantity = Number(qty);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw { status: 400, error: `Invalid quantity for product ${productId}.` };
      }

      const product = db
        .prepare('SELECT id, name, price_cents, stock FROM products WHERE id = ?')
        .get(productId);

      if (!product) {
        throw { status: 400, error: `Product ${productId} no longer exists.` };
      }
      if (product.stock < quantity) {
        throw {
          status: 409,
          error: `Only ${product.stock} left of "${product.name}" — please update your cart.`,
        };
      }

      const result = db
        .prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
        .run(quantity, productId, quantity);

      if (result.changes !== 1) {
        throw {
          status: 409,
          error: `"${product.name}" sold out while you were checking out.`,
        };
      }

      totalCents += product.price_cents * quantity;
      lineItems.push({ productId, name: product.name, priceCents: product.price_cents, qty: quantity });
    }

    const orderResult = db
      .prepare(
        `INSERT INTO orders (
           customer_name, customer_email, total_cents, status,
           payment_method, card_last4,
           shipping_address, shipping_city, shipping_postal_code, shipping_country
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customer.name,
        customer.email,
        totalCents,
        'confirmed',
        paymentMethod,
        cardLast4,
        shipping.address,
        shipping.city,
        shipping.postalCode,
        shipping.country
      );

    const orderId = Number(orderResult.lastInsertRowid);

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of lineItems) {
      insertItem.run(orderId, item.productId, item.name, item.priceCents, item.qty);
    }

    db.exec('COMMIT');
    return { ok: true, status: 200, order: { id: orderId, totalCents, items: lineItems } };
  } catch (err) {
    db.exec('ROLLBACK');
    if (err && err.status) return { ok: false, status: err.status, error: err.error };
    console.error(err);
    return { ok: false, status: 500, error: 'Checkout failed unexpectedly.' };
  }
}

function buildProductQuery(searchParams) {
  const clauses = [];
  const params = [];

  const search = (searchParams.get('search') || '').trim();
  if (search) {
    clauses.push('(name LIKE ? OR description LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }

  const category = (searchParams.get('category') || '').trim();
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  const collection = (searchParams.get('collection') || '').trim();
  if (collection) {
    clauses.push('collection = ?');
    params.push(collection);
  }

  const inStock = searchParams.get('inStock');
  if (inStock === '1' || inStock === 'true') {
    clauses.push('stock > 0');
  }

  let sql = 'SELECT * FROM products';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');

  const sortMap = {
    price_asc: 'price_cents ASC',
    price_desc: 'price_cents DESC',
    name_asc: 'name ASC',
    name_desc: 'name DESC',
    newest: 'id DESC',
  };
  const sort = sortMap[searchParams.get('sort')] || 'id ASC';
  sql += ` ORDER BY ${sort}`;

  return { sql, params };
}

const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS  
  }
});

function calculateEstimatedDelivery() {
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 7);
  return deliveryDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

async function sendOrderConfirmationEmail(order, customerEmail, customerName) {
  const estimatedDate = calculateEstimatedDelivery();
  
  const itemsList = order.items.map(item => 
    `- ${item.name} (Qty: ${item.qty}) - $${(item.priceCents / 100).toFixed(2)}`
  ).join('\n');

  const mailOptions = {
    from: `"FURNI Store" <${process.env.EMAIL_USER}>`,
    to: customerEmail,
    subject: `Order Confirmation #${order.id} - FURNI`,
    text: `Hi ${customerName},\n\nThank you for your order with FURNI!\n\nOrder Summary (#${order.id}):\n${itemsList}\n\nTotal Amount: $${(order.totalCents / 100).toFixed(2)}\n\nEstimated Delivery Date: ${estimatedDate}\n\nWe are preparing your items and will notify you once your order ships.\n\nBest regards,\nThe FURNI Team`
  };

  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('Email skipped: EMAIL_USER or EMAIL_PASS not set in environment.');
      return;
    }
    await transporter.sendMail(mailOptions);
    console.log(`Confirmation email sent to ${customerEmail}`);
  } catch (err) {
    console.error('Failed to send confirmation email:', err);
  }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'products') {
    const { sql, params } = buildProductQuery(url.searchParams);
    const rows = db.prepare(sql).all(...params);
    const ratingMap = getRatingMap();
    return sendJSON(res, 200, rows.map((p) => serializeProduct(p, ratingMap)));
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'products') {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(parts[2]));
    if (!row) return sendJSON(res, 404, { error: 'Product not found.' });
    return sendJSON(res, 200, serializeProduct(row, getRatingMap()));
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'products') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }

    const { error, data } = validateProductInput(body);
    if (error) return sendJSON(res, 400, { error });

    const result = db
      .prepare(
        `INSERT INTO products (name, price_cents, category, collection, img, description, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(data.name, data.price_cents, data.category, data.collection, data.img, data.description, data.stock);

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(result.lastInsertRowid));
    return sendJSON(res, 200, serializeProduct(row, getRatingMap()));
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[1] === 'products') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });

    const productId = Number(parts[2]);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!existing) return sendJSON(res, 404, { error: 'Product not found.' });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }

    const { error, data } = validateProductInput(body, { partial: true });
    if (error) return sendJSON(res, 400, { error });

    const merged = { ...existing, ...data };

    db.prepare(
      `UPDATE products
       SET name = ?, price_cents = ?, category = ?, collection = ?, img = ?, description = ?, stock = ?
       WHERE id = ?`
    ).run(
      merged.name,
      merged.price_cents,
      merged.category,
      merged.collection,
      merged.img,
      merged.description,
      merged.stock,
      productId
    );

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    return sendJSON(res, 200, serializeProduct(row, getRatingMap()));
  }

  if (
    req.method === 'GET' &&
    parts.length === 4 &&
    parts[1] === 'products' &&
    parts[3] === 'reviews'
  ) {
    const productId = Number(parts[2]);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    const reviews = db
      .prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY id DESC')
      .all(productId);
    return sendJSON(res, 200, reviews.map(serializeReview));
  }

  if (
    req.method === 'POST' &&
    parts.length === 4 &&
    parts[1] === 'products' &&
    parts[3] === 'reviews'
  ) {
    const productId = Number(parts[2]);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }

    const name = String(body.name || '').trim();
    const comment = String(body.comment || '').trim();
    const rating = Number(body.rating);

    if (!name || !comment) {
      return sendJSON(res, 400, { error: 'Name and comment are required.' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendJSON(res, 400, { error: 'Rating must be a whole number from 1 to 5.' });
    }
    if (name.length > 80 || comment.length > 1000) {
      return sendJSON(res, 400, { error: 'Name or comment is too long.' });
    }

    const result = db
      .prepare('INSERT INTO reviews (product_id, name, rating, comment) VALUES (?, ?, ?, ?)')
      .run(productId, name, rating, comment);

    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(result.lastInsertRowid));
    return sendJSON(res, 200, serializeReview(review));
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'collections') {
    const collections = db.prepare('SELECT * FROM collections ORDER BY id').all();
    const counts = db
      .prepare('SELECT collection, COUNT(*) AS count FROM products GROUP BY collection')
      .all();
    const countMap = new Map(counts.map((c) => [c.collection, c.count]));
    return sendJSON(res, 200, collections.map((c) => serializeCollection(c, countMap)));
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'collections') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }

    const name = String(body.name || '').trim();
    if (!name) return sendJSON(res, 400, { error: 'Collection name is required.' });

    let slug = String(body.slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) return sendJSON(res, 400, { error: 'Could not derive a valid slug from that name.' });
    if (collectionExists(slug)) {
      return sendJSON(res, 409, { error: `A collection with slug "${slug}" already exists.` });
    }

    const heroImg = body.heroImg ? String(body.heroImg).trim() : null;

    db.prepare('INSERT INTO collections (slug, name, hero_img) VALUES (?, ?, ?)').run(slug, name, heroImg);
    const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
    return sendJSON(res, 200, serializeCollection(row));
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[1] === 'collections') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });

    const slug = parts[2];
    const existing = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
    if (!existing) return sendJSON(res, 404, { error: 'Collection not found.' });

    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }

    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return sendJSON(res, 400, { error: 'Collection name cannot be empty.' });
    const heroImg = body.heroImg !== undefined ? String(body.heroImg).trim() || null : existing.hero_img;

    db.prepare('UPDATE collections SET name = ?, hero_img = ? WHERE slug = ?').run(name, heroImg, slug);
    const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
    return sendJSON(res, 200, serializeCollection(row));
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'collections') {
    const rows = db.prepare('SELECT * FROM products WHERE collection = ? ORDER BY id').all(parts[2]);
    const ratingMap = getRatingMap();
    return sendJSON(res, 200, rows.map((p) => serializeProduct(p, ratingMap)));
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'checkout') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }
    const result = checkout(body);
    if (!result.ok) return sendJSON(res, result.status, { error: result.error });
    
    sendOrderConfirmationEmail(result.order, body.customer.email, body.customer.name);
    
    return sendJSON(res, 200, result.order);
  }

  if (req.method === 'GET' && parts.length === 3 && parts[1] === 'orders') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(parts[2]));
    if (!order) return sendJSON(res, 404, { error: 'Order not found.' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return sendJSON(res, 200, { ...order, items });
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'orders') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
    return sendJSON(res, 200, orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'contact') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'Malformed JSON body.' });
    }
    const { name, email, message } = body;
    if (!name || !email || !message) {
      return sendJSON(res, 400, { error: 'Name, email, and message are required.' });
    }
    db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').run(name, email, message);
    return sendJSON(res, 200, { ok: true });
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'messages') {
    if (!isAdmin(req)) return sendJSON(res, 401, { error: 'Admin key required.' });
    const messages = db.prepare('SELECT * FROM messages ORDER BY id DESC').all();
    return sendJSON(res, 200, messages);
  }

  return sendJSON(res, 404, { error: 'Not found.' });
}

function serveStatic(req, res, url) {
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/' || filePath === '') filePath = '/k.html';

  // Force clean filename path without lead slashes
  const cleanPath = filePath.replace(/^\/+/, '');
  
  // Try directly relative to ROOT_DIR
  let fullPath = path.join(ROOT_DIR, cleanPath);

  // Fallback: check if it sits inside server's parent directory
  if (!fs.existsSync(fullPath)) {
    fullPath = path.resolve(__dirname, '..', cleanPath);
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      console.log(`[404] Could not serve static file: ${cleanPath}`);
      console.log(`Attempted path: ${fullPath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error(err);
      sendJSON(res, 500, { error: 'Internal server error.' });
    });
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`FURNI running at http://localhost:${PORT}`);
});