const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Connection error:', err.message);
        return;
    }
    console.log('✅ Connected to database. Clearing mock records...');
});

db.serialize(() => {
    // Clear operational and mock transactional tables
    db.run(`DELETE FROM wastage_logs`);
    db.run(`DELETE FROM stock_shipments`);
    db.run(`DELETE FROM pos_sales`);
    db.run(`DELETE FROM shift_closeouts`);
    db.run(`DELETE FROM shift_closeout_items`);
    db.run(`DELETE FROM audit_logs`);
    db.run(`DELETE FROM promo_codes`);
    db.run(`DELETE FROM inventory_items`); // Clears mock inventory items safely

    // Optional: If you also want to wipe your menu catalog items, uncomment the line below:
    // db.run(`DELETE FROM menu_items`);

    // Reset auto-increment ID counters back to 1
    db.run(`DELETE FROM sqlite_sequence WHERE name IN ('wastage_logs', 'stock_shipments', 'pos_sales', 'shift_closeouts', 'shift_closeout_items', 'audit_logs', 'promo_codes', 'inventory_items')`, () => {
        console.log('🚀 All mock operational data and inventory containers successfully wiped! Tables and schemas remain fully intact.');
        db.close();
    });
});