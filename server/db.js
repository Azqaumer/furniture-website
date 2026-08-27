// db.js — schema + seed data.
//
// Uses Node's built-in `node:sqlite` so the whole project runs with
// zero npm installs. Everything here is plain SQL with no SQLite-only
// syntax except AUTOINCREMENT, so moving to Postgres later is a matter of:
//   - swap `INTEGER PRIMARY KEY AUTOINCREMENT` -> `SERIAL PRIMARY KEY`
//   - swap the DatabaseSync driver calls for `pg` (node-postgres) calls
//   - the queries themselves (including the checkout transaction in
//     server.js) are written in portable SQL and don't need to change.

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'furni.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    price_cents   INTEGER NOT NULL,      -- money stored as integer cents, never floats
    category      TEXT NOT NULL,         -- product type: sofa / chair / table / bed / decor
    collection    TEXT NOT NULL,         -- merchandising collection: scandinavian / vintage / industrial
    img           TEXT NOT NULL,
    description   TEXT NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name  TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    total_cents    INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'confirmed',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES orders(id),
    product_id    INTEGER NOT NULL REFERENCES products(id),
    name          TEXT NOT NULL,         -- snapshot at purchase time
    price_cents   INTEGER NOT NULL,      -- snapshot at purchase time (never trust client price)
    qty           INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    message       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Product reviews. Anyone can leave one (no login system in this
  -- project), so ratings are clamped 1-5 and text is stored as-is;
  -- the client is responsible for escaping on render (see product.html).
  CREATE TABLE IF NOT EXISTS reviews (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    name          TEXT NOT NULL,
    rating        INTEGER NOT NULL,
    comment       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);

  -- Merchandising collections (Scandinavian, Vintage, etc). Kept as its
  -- own table — rather than just a free-text column on products — so
  -- the admin can rename a collection or add a new one without editing
  -- every product row, and the storefront (collection.html) can list
  -- whatever collections currently exist instead of a hardcoded set.
  CREATE TABLE IF NOT EXISTS collections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL UNIQUE,   -- used in URLs and products.collection
    name          TEXT NOT NULL,          -- display name, editable any time
    hero_img      TEXT,                   -- optional card image on collection.html
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Lightweight migration: add the payment columns to `orders` if this
// database was created before they existed. CREATE TABLE IF NOT EXISTS
// above only handles brand-new databases, not ones already on disk.
const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);

if (!orderColumns.includes('payment_method')) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card'");
}
if (!orderColumns.includes('card_last4')) {
  db.exec('ALTER TABLE orders ADD COLUMN card_last4 TEXT');
}
if (!orderColumns.includes('shipping_address')) {
  db.exec("ALTER TABLE orders ADD COLUMN shipping_address TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.includes('shipping_city')) {
  db.exec("ALTER TABLE orders ADD COLUMN shipping_city TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.includes('shipping_postal_code')) {
  db.exec("ALTER TABLE orders ADD COLUMN shipping_postal_code TEXT NOT NULL DEFAULT ''");
}
if (!orderColumns.includes('shipping_country')) {
  db.exec("ALTER TABLE orders ADD COLUMN shipping_country TEXT NOT NULL DEFAULT ''");
}

// Seed collections only if empty — mirrors the 3 slugs already used
// by the seeded products below, so existing product.collection values
// keep matching a real row.
const { count: collectionCount } = db.prepare('SELECT COUNT(*) AS count FROM collections').get();

if (collectionCount === 0) {
  const insertCollection = db.prepare(
    'INSERT INTO collections (slug, name, hero_img) VALUES (?, ?, ?)'
  );
  const collectionSeed = [
    ['scandinavian', 'Scandinavian Minimal', 'https://images.unsplash.com/photo-1618220179428-22790b461013'],
    ['vintage', 'Vintage Japandi', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c'],
    ['industrial', 'Industrial Minimal', 'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a'],
  ];
  for (const row of collectionSeed) insertCollection.run(...row);
  console.log(`Seeded ${collectionSeed.length} collections.`);
}

// Seed only if empty, so restarts don't duplicate data.
const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();

if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, price_cents, category, collection, img, description, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = [
    ['Modern Fabric Sofa', 54900, 'sofa', 'scandinavian', 'images/pic1.png', 'Comfortable modern sofa with premium fabric.', 8],
    ['Minimal Accent Chair', 29900, 'chair', 'scandinavian', 'images/pic2.jpg', 'Minimal chair perfect for living rooms.', 15],
    ['Oak Coffee Table', 19900, 'table', 'scandinavian', 'images/pic3.jpg', 'Solid oak coffee table.', 10],
    ['Vintage Rattan Chair', 27500, 'chair', 'vintage', 'images/pic2.jpg', 'Clean Japandi lines with a vintage weave.', 6],
    ['Reclaimed Wood Table', 34900, 'table', 'vintage', 'images/pic3.jpg', 'Reclaimed oak with warm vintage tone.', 5],
    ['Vintage Task Lamp', 12000, 'decor', 'vintage', 'images/lamp.jpg', 'Soft lighting with a vintage-inspired shade.', 20],
    ['Industrial Bed Frame', 79900, 'bed', 'industrial', 'images/bed.png', 'Premium comfort with an industrial steel frame.', 4],
    ['Industrial Lounge Chair', 32000, 'chair', 'industrial', 'images/pic2.jpg', 'Raw metal and leather, built to last.', 7],
    ['Industrial Pipe Shelf Lamp', 14000, 'decor', 'industrial', 'images/lamp.jpg', 'Exposed-bulb lamp on a pipe fitting base.', 12],

    // Extra pieces per collection so each aesthetic has more to browse.
    ['Scandinavian Bed Frame', 68900, 'bed', 'scandinavian', 'images/bed.png', 'Light oak frame with clean Nordic lines.', 5],
    ['Scandinavian Pendant Lamp', 11000, 'decor', 'scandinavian', 'images/lamp.jpg', 'Soft paper-shade pendant, warm minimal glow.', 18],
    ['Vintage Lounge Sofa', 62900, 'sofa', 'vintage', 'images/pic1.png', 'Curved silhouette upholstered in a faded vintage tone.', 4],
    ['Vintage Nesting Tables', 24900, 'table', 'vintage', 'images/pic3.jpg', 'Set of two nesting tables with a worn brass trim.', 9],
    ['Industrial Dining Table', 44900, 'table', 'industrial', 'images/pic3.jpg', 'Blackened steel legs with a raw wood top.', 6],
    ['Industrial Accent Sofa', 71900, 'sofa', 'industrial', 'images/pic1.png', 'Waxed canvas upholstery over a riveted steel frame.', 3],

    // New product.
    ['Boucle Lounge Chair', 38500, 'chair', 'scandinavian', 'images/pic2.jpg', 'Soft boucle upholstery over a light oak frame — cozy Nordic texture for a reading corner.', 10],
  ];

  for (const row of seed) insert.run(...row);
  console.log(`Seeded ${seed.length} products.`);

  // A handful of starter reviews so the review UI isn't empty on first run.
  const insertReview = db.prepare(`
    INSERT INTO reviews (product_id, name, rating, comment)
    VALUES (?, ?, ?, ?)
  `);

  const reviewSeed = [
    [1, 'Amara K.', 5, 'Amazing quality, feels premium in person.'],
    [1, 'Devon R.', 4, 'Worth the price, looks beautiful in our living room.'],
    [2, 'Priya S.', 5, 'Perfect size for our reading corner.'],
    [7, 'Jonas M.', 5, 'Sturdy frame and the steel finish looks fantastic.'],
    [7, 'Lena T.', 4, 'Great bed, assembly took a bit longer than expected.'],
    [16, 'Sam W.', 5, 'So soft and cozy, my favorite chair in the house now.'],
  ];

  for (const row of reviewSeed) insertReview.run(...row);
  console.log(`Seeded ${reviewSeed.length} reviews.`);
}

module.exports = db;