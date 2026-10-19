// server.js - Cafe de Melle Senior Full-Stack Application Engine

/* ===========================================================================
   1. MODULE IMPORTS & ENVIRONMENT CONFIGURATION
   =========================================================================== */
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

dotenv.config();

// Secure session secret fallback to prevent startup crashes if .env is unpopulated
const SESSION_SECRET = process.env.SESSION_SECRET || 'cafedemelle_fallback_session_secret_key_2026';
if (!process.env.SESSION_SECRET) {
    console.warn('⚠️ WARNING: SESSION_SECRET is not defined in .env! Utilizing secure fallback key.');
}

// AES-256-GCM Cryptographic Key Configuration for PII Encryption (RA 10173 Compliance)
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY || 'a6f3e18b9c4d2e7f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f';
const SECRET_KEY = Buffer.from(ENCRYPTION_KEY_RAW, 'hex');

const app = express();

/* ===========================================================================
   2. PII ENCRYPTION & DECRYPTION HELPERS (AES-256-GCM) & TIMEZONE FIX
   =========================================================================== */
function encryptPII(text) {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
        let encrypted = cipher.update(String(text), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
        console.error('Encryption failed:', err.message);
        return text;
    }
}

function decryptPII(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.includes(':')) return ciphertext;
    try {
        const [ivHex, authTagHex, encryptedText] = ciphertext.split(':');
        if (!ivHex || !authTagHex || !encryptedText) return ciphertext;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption failed:', err.message);
        return '[ENCRYPTED_DATA_CORRUPTED]';
    }
}

function deleteUnusedImageFile(imagePath) {
    if (!imagePath || imagePath.includes('Logo.jpg') || imagePath.includes('HeroBg.jpg')) return;
    const fullPath = path.join(__dirname, 'public', imagePath);
    if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
            if (err) console.error(`Failed to delete unused image file: ${fullPath}`, err);
        });
    }
}

// Helper function to format internal DB IDs into 9-digit Role IDs
function format9DigitAccountId(id, role) {
    const rawId = parseInt(id, 10) || 0;
    const padded = String(rawId).padStart(6, '0');
    let prefix = '400'; // Default Staff
    if (role === 'Owner') prefix = '100';
    else if (role === 'Developer') prefix = '200';
    else if (role === 'Admin') prefix = '300';
    return `${prefix}${padded}`;
}

/* ===========================================================================
   3. EXPRESS, SECURITY HEADERS & RATE LIMITING MIDDLEWARE
   =========================================================================== */
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "*"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'", 
                "'unsafe-eval'", 
                "https://cdnjs.cloudflare.com", 
                "https://localtunnel.me", 
                "*.localtunnel.me",
                "*.ngrok-free.app",
                "*.ngrok-free.dev",
                "*.ngrok.io",
                "*.ngrok.app"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https://maps.google.com"],
            frameSrc: [
                "'self'", 
                "https://maps.google.com", 
                "https://www.google.com",
                "*.ngrok-free.app",
                "*.ngrok-free.dev",
                "*.ngrok.io",
                "*.ngrok.app"
            ],
            connectSrc: [
                "'self'", 
                "*", 
                "https://*.ngrok-free.app", 
                "https://*.ngrok-free.dev", 
                "https://*.ngrok.io"
            ],
            upgradeInsecureRequests: null
        },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false,
    noSniff: true,
    xssFilter: true
}));

// LocalTunnel & Ngrok Proxy Handling Fix
app.use((req, res, next) => {
    res.setHeader('Bypass-Tunnel-Reminder', 'true');
    res.setHeader('ngrok-skip-browser-warning', 'true');
    
    const host = req.headers.host || '';
    const isTunnel = host.includes('localtunnel') || host.includes('lt.mobi') || host.includes('ngrok');
    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname.startsWith('192.168.') || req.hostname.startsWith('10.');
    
    if (!isTunnel && !isLocalhost && process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https' && !req.secure) {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: { success: false, error: 'Too many failed login attempts. Please try again later.' }
});

const promoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: { success: false, error: 'Rate limit exceeded for promo code claims. Please try again later.' }
});

const normalizePromoInput = (req, res, next) => {
    if (!req.body.social_handle && req.body.username) {
        req.body.social_handle = req.body.username;
    }
    if (!req.body.contact_info && req.body.platform) {
        req.body.contact_info = req.body.platform;
    }
    next();
};

const validatePromoSubmission = [
    body('customer_name')
        .trim()
        .notEmpty().withMessage('Name is required.')
        .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters.')
        .matches(/^[a-zA-Z\s\.\'-]+$/).withMessage('Name contains invalid characters.')
        .escape(),
    body('social_handle')
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 2, max: 50 }).withMessage('Social handle must be between 2 and 50 characters.')
        .escape(),
    body('contact_info')
        .optional({ checkFalsy: true })
        .trim()
        .matches(/^(09|\+639)\d{9}$|^$/).withMessage('Invalid Philippine mobile number format (e.g., 09XXXXXXXXX).'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: errors.array()[0].msg
            });
        }
        next();
    }
];

/* ===========================================================================
   4. SECURE FILE STORAGE (MULTER) & SESSION CONFIGURATION
   =========================================================================== */
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const privateDir = path.join(__dirname, 'private');
if (!fs.existsSync(privateDir)) {
    fs.mkdirSync(privateDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(16).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomName}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isValidMime = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const isValidExt = ALLOWED_EXTENSIONS.includes(ext);

    if (isValidMime && isValidExt) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type! Only JPG, JPEG, PNG, and WEBP image formats are allowed.'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
});

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: '_cdm_sid',
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 4 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    if (req.session && req.session.isAdmin) {
        return res.sendFile(path.join(__dirname, 'private', 'admin.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* ===========================================================================
   5. DATABASE SETUP & SCHEMA MIGRATIONS
   =========================================================================== */
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ DATABASE CONNECTION ERROR:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        initDatabaseSchema() 
        db.all(`PRAGMA table_info(promo_codes)`, [], (err, columns) => {
    if (!err && columns && columns.length > 0) {
        const colNames = columns.map(c => c.name);
        if (!colNames.includes('redeemed_by')) {
            db.run(`ALTER TABLE promo_codes ADD COLUMN redeemed_by TEXT DEFAULT 'Staff / Cashier'`, () => {
                console.log("🛠️ Migrated DB: Added 'redeemed_by' column to promo_codes table.");
            });
        }
    }
});;
    }
});

function initDatabaseSchema() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS menu_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            badge TEXT DEFAULT 'none',
            price INTEGER NOT NULL,
            description TEXT,
            image TEXT,
            is_available INTEGER DEFAULT 1,
            view_count INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS hero_slides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag TEXT,
            title TEXT,
            subtitle TEXT,
            image TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'Staff'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            action TEXT NOT NULL,
            details TEXT,
            performed_by TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    social_handle TEXT,
    contact_info TEXT,
    platform TEXT DEFAULT 'Web App',
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    redeemed_at DATETIME,
    redeemed_by TEXT DEFAULT 'STAFF / CASHIER'
)`);

        db.run(`CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_name TEXT UNIQUE NOT NULL,
            container_unit TEXT NOT NULL,
            stock_quantity INTEGER DEFAULT 0,
            safety_threshold INTEGER DEFAULT 5,
            linked_menu_item_id INTEGER DEFAULT NULL,
            item_cost REAL DEFAULT 0.0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS stock_shipments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_name TEXT NOT NULL,
            inventory_item_id INTEGER NOT NULL,
            quantity_added INTEGER NOT NULL,
            invoice_number TEXT,
            invoice_qty INTEGER,
            actual_received_qty INTEGER,
            cost_per_unit REAL,
            supplier_invoice_quantity INTEGER,
            physically_counted_quantity INTEGER,
            unit_cost_per_item REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS wastage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_item_id INTEGER NOT NULL,
            quantity_lost INTEGER NOT NULL,
            reason_code TEXT NOT NULL,
            unit_cost REAL DEFAULT 0.0,
            financial_cost_loss REAL NOT NULL,
            logged_by TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS pos_sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_item_id INTEGER NOT NULL,
            quantity_sold INTEGER NOT NULL,
            pos_transaction_ref TEXT,
            logged_by TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS shift_closeouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_date TEXT NOT NULL,
            total_sales_amount REAL NOT NULL,
            discount_amount REAL DEFAULT 0.0,
            logged_by TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS shift_closeout_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            closeout_id INTEGER NOT NULL,
            menu_item_id INTEGER NOT NULL,
            quantity_sold INTEGER NOT NULL,
            FOREIGN KEY (closeout_id) REFERENCES shift_closeouts(id)
        )`);

        db.all(`PRAGMA table_info(shift_closeouts)`, [], (err, columns) => {
            if (!err && columns && columns.length > 0) {
                const colNames = columns.map(c => c.name);
                if (!colNames.includes('discount_amount')) {
                    db.run(`ALTER TABLE shift_closeouts ADD COLUMN discount_amount REAL DEFAULT 0.0`, () => {
                        console.log("🛠️ Migrated DB: Added 'discount_amount' column to shift_closeouts table.");
                    });
                }
            }
        });

        db.all(`PRAGMA table_info(users)`, [], (err, columns) => {
            if (!err && columns && columns.length > 0) {
                const colNames = columns.map(c => c.name);
                if (!colNames.includes('role')) {
                    db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'Staff'`, () => {
                        console.log("🛠️ Migrated DB: Added 'role' column to users table.");
                        seedDefaultAccounts();
                    });
                } else {
                    seedDefaultAccounts();
                }
            } else {
                seedDefaultAccounts();
            }
        });

        db.get(`SELECT COUNT(*) as count FROM inventory_items`, [], (err, row) => {
            if (!err && row && row.count === 0) {
                const defaultItems = [
                    ['Espresso Coffee Beans Bag', 'Bags', 15, 3, null, 450.00],
                    ['Whole Milk Bottle', 'Bottles', 24, 5, null, 85.00],
                    ['Vanilla Syrup Bottle', 'Bottles', 8, 2, null, 320.00],
                    ['Korean Garlic Bun Box', 'Boxes', 10, 2, null, 150.00],
                    ['Paper Coffee Cups Ream', 'Reams', 12, 3, null, 210.00]
                ];
                const stmt = db.prepare(`INSERT INTO inventory_items (item_name, container_unit, stock_quantity, safety_threshold, linked_menu_item_id, item_cost) VALUES (?, ?, ?, ?, ?, ?)`);
                defaultItems.forEach(item => stmt.run(item));
                stmt.finalize();
                console.log("📦 Seeded default bulk inventory containers with unit costs.");
            }
        });
    });
}

function seedDefaultAccounts() {
    const defaultAdminUser = process.env.ADMIN_USERNAME || 'admin';
    const defaultAdminPass = process.env.ADMIN_PASSWORD || 'admin123';

    db.get(`SELECT * FROM users WHERE username = ?`, [defaultAdminUser], (err, row) => {
        if (!row) {
            const hash = bcrypt.hashSync(defaultAdminPass, 10);
            db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'Admin')`, [defaultAdminUser, hash]);
            console.log(`🔒 Default Admin account initialized: ${defaultAdminUser}`);
        }
    });

    db.get(`SELECT * FROM users WHERE username = 'developer'`, (err, row) => {
        if (!row) {
            const devHash = bcrypt.hashSync('DevSecure2026!', 10);
            db.run(`INSERT INTO users (username, password_hash, role) VALUES ('developer', ?, 'Developer')`, [devHash]);
            console.log(`🔒 Developer account initialized: developer`);
        }
    });

    db.get(`SELECT * FROM users WHERE username = 'owner'`, (err, row) => {
        if (!row) {
            const ownerHash = bcrypt.hashSync('OwnerCafe2026!', 10);
            db.run(`INSERT INTO users (username, password_hash, role) VALUES ('owner', ?, 'Owner')`, [ownerHash]);
            console.log(`🔒 Owner account initialized: owner`);
        }
    });
}

/* ===========================================================================
   6. HELPER FUNCTIONS & MIDDLEWARE GUARDS
   =========================================================================== */
function requireAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.status(401).json({ success: false, error: 'Unauthorized access. Please log in.' });
}

function requireDeveloperOnly(req, res, next) {
    if (req.session && req.session.isAdmin && req.session.role === 'Developer') {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Access denied. Strictly Developer system role required to revoke user accounts.' });
}

function requireAdminOrAbove(req, res, next) {
    if (req.session && req.session.isAdmin && ['Admin', 'Owner', 'Developer'].includes(req.session.role)) {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Access denied. Admin or higher role required.' });
}

function requireNonStaff(req, res, next) {
    if (req.session && req.session.isAdmin && (req.session.role === 'Developer' || req.session.role === 'Owner' || req.session.role === 'Admin')) {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Access denied. Staff role cannot alter user account configurations.' });
}

function getActiveUser(req) {
    if (req.session && req.session.username) {
        return `${req.session.username} (${req.session.role || 'Admin'})`;
    }
    return 'System/Admin';
}

function logAudit(action, details, user = 'System') {
    const timestamp = new Date().toISOString();
    db.run(`INSERT INTO audit_logs (timestamp, action, details, performed_by) VALUES (?, ?, ?, ?)`, [timestamp, action, details, user]);
}

function touchMenuUpdateTimestamp() {
    const now = new Date().toLocaleString(); // or use SQLite's datetime('now', 'localtime') directly in the SQL query
    db.run(`INSERT INTO settings (key, value) VALUES ('menu_last_updated', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [now, now]);
}

/* ===========================================================================
   7. PUBLIC API ENDPOINTS
   =========================================================================== */

app.get('/api/menu', (req, res) => {
    db.all(`SELECT * FROM menu_items ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        res.json(rows);
    });
});

app.post('/api/menu/:id/view', (req, res) => {
    const itemId = req.params.id;
    db.run(`UPDATE menu_items SET view_count = view_count + 1 WHERE id = ?`, [itemId], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.get('/api/hero-slides', (req, res) => {
    db.all(`SELECT * FROM hero_slides ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        res.json(rows);
    });
});

app.get('/api/settings', (req, res) => {
    db.all(`SELECT * FROM settings`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        const config = {};
        rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    });
});

// 1. Promo Claim Endpoint with Duplicate Guardrail
app.post('/api/promo-codes/claim', promoLimiter, normalizePromoInput, validatePromoSubmission, (req, res) => {
    const { customer_name, social_handle, contact_info, platform } = req.body;

    const cleanName = customer_name.trim().toLowerCase();

    // Guardrail: Check if customer name or social handle has already claimed a voucher
    db.get(
        `SELECT * FROM promo_codes WHERE LOWER(customer_name) = ? OR (social_handle IS NOT NULL AND social_handle != '' AND social_handle = ?)`, 
        [cleanName, encryptPII(social_handle || '')], 
        (err, existing) => {
            if (existing) {
                if (existing.status === 'Redeemed') {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'This customer/handle has already claimed and redeemed a promo voucher!' 
                    });
                }
                return res.status(400).json({ 
                    success: false, 
                    error: 'An active promo voucher has already been issued for this name/handle!' 
                });
            }

            const code = 'MELLE-' + Math.floor(1000 + Math.random() * 9000);
            const encSocial = encryptPII(social_handle || '');
            const encContact = encryptPII(contact_info || '');
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

            db.all(`PRAGMA table_info(promo_codes)`, [], (err, cols) => {
                let fields = ['code', 'customer_name', 'social_handle', 'contact_info', 'platform', 'status', 'created_at'];
let placeholders = ['?', '?', '?', '?', '?', '?', '?'];
let values = [code, customer_name, encSocial, encContact, platform || 'Web App', 'Active', new Date().toISOString()];

                if (!err && cols) {
                    cols.forEach(col => {
                        const name = col.name;
                        if (col.notnull === 1 && col.dflt_value === null && !fields.includes(name) && name !== 'id') {
                            fields.push(name);
                            placeholders.push('?');
                            
                            if (name === 'ip_address') values.push(clientIp);
                            else if (name === 'username') values.push(social_handle || customer_name);
                            else values.push('');
                        }
                    });
                }

                const query = `INSERT INTO promo_codes (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;

                db.run(query, values, function(err) {
                    if (err) {
                        console.error('Promo claim error:', err.message);
                        return res.status(500).json({ success: false, error: 'Failed to generate promo code. Please try again.' });
                    }
                    
                    logAudit('PROMO_CODE_CLAIMED', `Generated promo voucher code ${code} for customer '${customer_name}' via ${platform || 'Web App'}`, 'Customer / Web');
                    
                    res.json({
                        success: true,
                        code: code,
                        message: 'Promo voucher successfully claimed!'
                    });
                });
            });
        }
    );
});

// 2. Public Voucher Status Check Endpoint (for Homepage auto-refresh)
app.get('/api/promo-codes/status/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    db.get(`SELECT code, customer_name, status, created_at, redeemed_at FROM promo_codes WHERE code = ?`, [code], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ success: false, error: 'Voucher not found' });
        }
        res.json({
            success: true,
            code: row.code,
            status: row.status,
            customer_name: row.customer_name,
            redeemed_at: row.redeemed_at
        });
    });
});

/* ===========================================================================
   8. ADMIN & AUTHENTICATED REST API ENDPOINTS
   =========================================================================== */

app.post('/api/admin/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            logAudit('USER_LOGIN_FAILED', `Failed login attempt for username: ${username}`, 'System Guard');
            return res.status(401).json({ success: false, error: 'Invalid credentials.' });
        }

        const isValid = bcrypt.compareSync(password, user.password_hash);
        if (!isValid) {
            logAudit('USER_LOGIN_FAILED', `Failed login attempt for username: ${username}`, 'System Guard');
            return res.status(401).json({ success: false, error: 'Invalid credentials.' });
        }

        req.session.isAdmin = true;
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role || 'Staff';

        const userAccountCode = format9DigitAccountId(user.id, user.role);

        logAudit('USER_LOGIN', `User '${user.username}' [Role: ${user.role}, ID: ${userAccountCode}] logged in successfully.`, `${user.username} (${user.role})`);

        res.json({
            success: true,
            user: {
                id: user.id,
                account_id: userAccountCode,
                username: user.username,
                role: user.role
            }
        });
    });
});

app.post('/api/admin/logout', (req, res) => {
    const user = getActiveUser(req);
    logAudit('USER_LOGOUT', `User logged out.`, user);
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
    const accountCode = format9DigitAccountId(req.session.userId, req.session.role);
    res.json({
        id: req.session.userId,
        account_id: accountCode,
        username: req.session.username,
        role: req.session.role
    });
});

// Dedicated Helper Route for Password Re-Authentication Guardrail
app.post('/api/admin/verify-password', requireAuth, (req, res) => {
    const { password } = req.body;
    const userId = req.session.userId;

    if (!password) {
        return res.status(400).json({ success: false, error: 'Password is required.' });
    }

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: 'User session not found.' });
        }

        const isValid = bcrypt.compareSync(password, user.password_hash);
        if (!isValid) {
            logAudit('SECURITY_REAUTH_FAILED', `Failed password re-authentication for user '${user.username}'`, getActiveUser(req));
            return res.status(401).json({ success: false, error: 'Invalid password.' });
        }

        logAudit('SECURITY_REAUTH_SUCCESS', `Successfully verified password re-authentication for user '${user.username}'`, getActiveUser(req));
        return res.json({ success: true });
    });
});

app.get('/api/admin/dashboard-kpis', requireAuth, (req, res) => {
    db.get(`SELECT COUNT(*) as total, SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END) as active, SUM(CASE WHEN is_available = 0 THEN 1 ELSE 0 END) as outOfStock FROM menu_items`, [], (err, menuStats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get(`SELECT COUNT(*) as activePromos FROM promo_codes WHERE status = 'Active'`, [], (err, promoStats) => {
            if (err) return res.status(500).json({ error: err.message });

            db.get(`SELECT COUNT(*) as lowStockInventory FROM inventory_items WHERE stock_quantity <= safety_threshold`, [], (err, invStats) => {
                if (err) return res.status(500).json({ error: err.message });

                db.get(`
                    SELECT 
                        (SELECT COALESCE(SUM(p.quantity_sold * COALESCE(m.price, 0)), 0)
                         FROM pos_sales p
                         LEFT JOIN inventory_items i ON p.inventory_item_id = i.id
                         LEFT JOIN menu_items m ON i.linked_menu_item_id = m.id
                         WHERE DATE(p.timestamp) = DATE('now'))
                        +
                        (SELECT COALESCE(SUM(total_sales_amount - COALESCE(discount_amount, 0)), 0)
                         FROM shift_closeouts
                         WHERE shift_date = DATE('now')) as revenueToday
                `, [], (err, revRow) => {
                    const revenueToday = (revRow && revRow.revenueToday) ? revRow.revenueToday : 0;
                    const promoCost = (promoStats ? promoStats.activePromos : 0) * 100;

                    db.get(`
                        SELECT COALESCE(SUM((invoice_qty - actual_received_qty) * cost_per_unit), 0) as invoiceShortageBleed
                        FROM stock_shipments
                        WHERE DATE(timestamp) = DATE('now') AND invoice_qty > actual_received_qty
                    `, [], (err, invShortageRow) => {
                        const invoiceBleed = (invShortageRow && invShortageRow.invoiceShortageBleed) ? invShortageRow.invoiceShortageBleed : 0;

                        db.get(`
                            SELECT COALESCE(SUM(financial_cost_loss), 0) as wastageBleed
                            FROM wastage_logs
                            WHERE DATE(timestamp) = DATE('now')
                        `, [], (err, wastageRow) => {
                            const wastageBleed = (wastageRow && wastageRow.wastageBleed) ? wastageRow.wastageBleed : 0;
                            const totalBleed = invoiceBleed + wastageBleed;

                            res.json({
                                total: menuStats.total || 0,
                                active: menuStats.active || 0,
                                outOfStock: menuStats.outOfStock || 0,
                                activePromos: promoStats.activePromos || 0,
                                lowStockInventory: invStats.lowStockInventory || 0,
                                revenueToday: revenueToday,
                                promoCost: promoCost,
                                totalBleed: totalBleed
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/admin/users', requireAuth, (req, res) => {
    db.all(`SELECT id, username, role FROM users ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formattedUsers = rows.map(u => ({
            id: u.id,
            account_id: format9DigitAccountId(u.id, u.role),
            username: u.username,
            role: u.role
        }));
        res.json(formattedUsers);
    });
});

app.post('/api/admin/users', requireAuth, requireNonStaff, (req, res) => {
    const { username, password, role } = req.body;
    const performer = getActiveUser(req);

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const assignedRole = role || 'Staff';
    const requesterRole = req.session.role;

    if (requesterRole === 'Staff') {
        return res.status(403).json({ success: false, error: 'Staff members have no permission to manage accounts.' });
    }
    if (requesterRole === 'Admin' && (assignedRole === 'Developer' || assignedRole === 'Owner' || assignedRole === 'Admin')) {
        return res.status(403).json({ success: false, error: 'Admins can only create Staff accounts.' });
    }
    if (requesterRole === 'Owner' && assignedRole === 'Developer') {
        return res.status(403).json({ success: false, error: 'Owners cannot create Developer accounts.' });
    }

    const hash = bcrypt.hashSync(password, 10);

    db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, [username, hash, assignedRole], function(err) {
        if (err) {
            return res.status(400).json({ success: false, error: 'Username already exists.' });
        }
        
        const newUserId = this.lastID;
        const accountCode = format9DigitAccountId(newUserId, assignedRole);

        logAudit('USER_CREATE', `Created user account '${username}' with Role: ${assignedRole} [ID: ${accountCode}]`, performer);
        
        res.json({
            success: true,
            id: newUserId,
            account_id: accountCode,
            username: username,
            role: assignedRole
        });
    });
});

app.delete('/api/admin/users/:id', requireAuth, requireDeveloperOnly, (req, res) => {
    const targetUserId = req.params.id;
    const performer = getActiveUser(req);

    if (parseInt(targetUserId, 10) === req.session.userId) {
        return res.status(400).json({ success: false, error: 'You cannot delete your own active developer session.' });
    }

    db.get(`SELECT username, role FROM users WHERE id = ?`, [targetUserId], (err, user) => {
        if (!user) return res.status(404).json({ success: false, error: 'User account not found.' });

        db.run(`DELETE FROM users WHERE id = ?`, [targetUserId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            
            const targetCode = format9DigitAccountId(targetUserId, user.role);
            logAudit('USER_DELETE', `Developer revoked user account '${user.username}' [Role: ${user.role}, ID: ${targetCode}]`, performer);
            
            res.json({ success: true });
        });
    });
});

app.post('/api/admin/change-password', requireAuth, (req, res) => {
    const { newUsername, currentPassword, newPassword } = req.body;
    const userId = req.session.userId;
    const performer = getActiveUser(req);

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (!user) return res.status(404).json({ success: false, error: 'Account user not found.' });

        const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ success: false, error: 'Current password incorrect.' });
        }

        const newHash = newPassword ? bcrypt.hashSync(newPassword, 10) : user.password_hash;
        const updatedUsername = newUsername || user.username;

        db.run(`UPDATE users SET username = ?, password_hash = ? WHERE id = ?`, [updatedUsername, newHash, userId], function(err) {
            if (err) return res.status(400).json({ success: false, error: 'Username already in use.' });

            req.session.username = updatedUsername;
            logAudit('CREDENTIALS_UPDATE', `User '${user.username}' updated credentials/username to '${updatedUsername}'.`, performer);

            res.json({ success: true, username: updatedUsername });
        });
    });
});

app.get('/api/admin/promo-codes/active', requireAuth, (req, res) => {
    db.all(`SELECT * FROM promo_codes WHERE status = 'Active' ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const decryptedRows = rows.map(r => ({
            ...r,
            social_handle: decryptPII(r.social_handle),
            contact_info: decryptPII(r.contact_info)
        }));
        res.json(decryptedRows);
    });
});

app.post('/api/admin/promo-codes/verify-redeem', requireAuth, (req, res) => {
    const { code } = req.body;
    const performer = getActiveUser(req);

    if (!code) return res.status(400).json({ success: false, error: 'Code is required.' });

    const cleanCode = code.trim().toUpperCase();

    db.get(`SELECT * FROM promo_codes WHERE code = ?`, [cleanCode], (err, promo) => {
        if (err || !promo) {
            return res.status(404).json({ success: false, error: 'Voucher code not found.' });
        }
        if (promo.status === 'Redeemed') {
            return res.status(400).json({ success: false, error: `Voucher ${cleanCode} has already been redeemed!` });
        }

        // Generate precise ISO string so JS parses it cleanly without shifting hours
        const exactTimestamp = new Date().toISOString();

        db.run(
            `UPDATE promo_codes SET status = 'Redeemed', redeemed_at = ?, redeemed_by = ? WHERE id = ?`, 
            [exactTimestamp, performer, promo.id], 
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });

                logAudit('PROMO_CODE_REDEEMED', `Redeemed promo voucher code ${cleanCode} for customer '${promo.customer_name}'`, performer);

                res.json({
                    success: true,
                    message: `Voucher ${cleanCode} successfully redeemed for ${promo.customer_name} by ${performer}!`
                });
            }
        );
    });
});

/* ===========================================================================
   9. INVENTORY & SUPPLY ENGINE REST APIS
   =========================================================================== */

app.get('/api/admin/inventory', requireAuth, (req, res) => {
    const query = `
        SELECT i.*, m.name as linked_menu_name 
        FROM inventory_items i 
        LEFT JOIN menu_items m ON i.linked_menu_item_id = m.id 
        ORDER BY i.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/inventory', requireAuth, (req, res) => {
    const { item_name, container_unit, stock_quantity, safety_threshold, linked_menu_item_id, item_cost } = req.body;
    const performer = getActiveUser(req);

    if (!item_name || !container_unit) {
        return res.status(400).json({ success: false, error: 'Container item name and unit type are required.' });
    }

    const qty = parseInt(stock_quantity, 10) || 0;
    const threshold = parseInt(safety_threshold, 10) || 5;
    const cost = parseFloat(item_cost) || 0.0;

    db.run(
        `INSERT INTO inventory_items (item_name, container_unit, stock_quantity, safety_threshold, linked_menu_item_id, item_cost) VALUES (?, ?, ?, ?, ?, ?)`,
        [item_name, container_unit, qty, threshold, linked_menu_item_id || null, cost],
        function(err) {
            if (err) return res.status(400).json({ success: false, error: 'Inventory container item name already registered.' });

            logAudit('INVENTORY_ITEM_CREATED', `Registered bulk container '${item_name}' (${qty} ${container_unit}) [Unit Cost: ₱${cost.toFixed(2)}]`, performer);

            res.json({ success: true, id: this.lastID });
        }
    );
});

// PATCH Route to Update Unit Cost and Safety Threshold for Container Overview
app.patch('/api/admin/inventory/:id', requireAuth, (req, res) => {
    const itemId = req.params.id;
    const { item_cost, safety_threshold } = req.body;
    const performer = getActiveUser(req);

    if (item_cost === undefined || safety_threshold === undefined) {
        return res.status(400).json({ success: false, error: 'Unit cost and safety threshold are required.' });
    }

    const cost = parseFloat(item_cost) || 0.0;
    const threshold = parseInt(safety_threshold, 10) || 5;

    db.get(`SELECT item_name FROM inventory_items WHERE id = ?`, [itemId], (err, item) => {
        if (!item) return res.status(404).json({ success: false, error: 'Container item not found.' });

        db.run(
            `UPDATE inventory_items SET item_cost = ?, safety_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [cost, threshold, itemId],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });

                logAudit('INVENTORY_ITEM_UPDATED', `Updated container '${item.item_name}' [Unit Cost: ₱${cost.toFixed(2)}, Safety Threshold: ${threshold}]`, performer);

                res.json({ success: true });
            }
        );
    });
});

app.delete('/api/admin/inventory/:id', requireAdminOrAbove, (req, res) => {
    const itemId = req.params.id;
    const performer = getActiveUser(req);

    db.get(`SELECT item_name FROM inventory_items WHERE id = ?`, [itemId], (err, item) => {
        if (!item) return res.status(404).json({ success: false, error: 'Container item not found.' });

        db.run(`DELETE FROM inventory_items WHERE id = ?`, [itemId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            logAudit('INVENTORY_ITEM_DELETED', `Deleted bulk inventory container '${item.item_name}'`, performer);

            res.json({ success: true });
        });
    });
});

app.post('/api/admin/inventory/shipment', requireAuth, (req, res) => {
    const { 
        supplier_name, invoice_number, inventory_item_id, 
        supplier_invoice_quantity, physically_counted_quantity, unit_cost_per_item 
    } = req.body;
    
    const performer = getActiveUser(req);

    if (!supplier_name || !inventory_item_id || physically_counted_quantity === undefined) {
        return res.status(400).json({ success: false, error: 'Supplier name, target item, and received count are required.' });
    }

    const receivedQty = parseInt(physically_counted_quantity, 10) || 0;
    const invoiceQty = parseInt(supplier_invoice_quantity, 10) || receivedQty;
    const unitCost = parseFloat(unit_cost_per_item) || 0.0;

    db.run(
        `INSERT INTO stock_shipments (supplier_name, inventory_item_id, quantity_added, invoice_number, invoice_qty, actual_received_qty, cost_per_unit, supplier_invoice_quantity, physically_counted_quantity, unit_cost_per_item) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [supplier_name, inventory_item_id, receivedQty, invoice_number || null, invoiceQty, receivedQty, unitCost, invoiceQty, receivedQty, unitCost],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            db.run(
                `UPDATE inventory_items SET stock_quantity = stock_quantity + ?, item_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [receivedQty, unitCost, inventory_item_id],
                function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });

                    db.get(`SELECT item_name, linked_menu_item_id, stock_quantity FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
                        if (inv && inv.linked_menu_item_id && inv.stock_quantity > 0) {
                            db.run(`UPDATE menu_items SET is_available = 1 WHERE id = ?`, [inv.linked_menu_item_id]);
                            touchMenuUpdateTimestamp();
                        }

                        logAudit('STOCK_IN', `Logged shipment from '${supplier_name}' [Invoice: ${invoice_number || 'N/A'}]: +${receivedQty} units of '${inv ? inv.item_name : inventory_item_id}'`, performer);

                        res.json({ success: true });
                    });
                }
            );
        }
    );
});

app.post('/api/admin/inventory/audit', requireAuth, (req, res) => {
    const { inventory_item_id, shift_period, actual_stock, notes } = req.body;
    const performer = getActiveUser(req);

    if (!inventory_item_id || actual_stock === undefined) {
        return res.status(400).json({ success: false, error: 'Target container and actual physical stock count are required.' });
    }

    const newStockQty = parseInt(actual_stock, 10) || 0;

    db.get(`SELECT item_name, stock_quantity, item_cost, linked_menu_item_id FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
        if (!inv) return res.status(404).json({ success: false, error: 'Inventory container item not found.' });

        const variance = newStockQty - inv.stock_quantity;

        db.run(
            `UPDATE inventory_items SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [newStockQty, inventory_item_id],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });

                let financialLoss = 0;
                if (variance < 0) {
                    const absVariance = Math.abs(variance);
                    financialLoss = absVariance * (inv.item_cost || 0);
                    db.run(
                        `INSERT INTO wastage_logs (inventory_item_id, quantity_lost, reason_code, unit_cost, financial_cost_loss, logged_by) VALUES (?, ?, ?, ?, ?, ?)`,
                        [inventory_item_id, absVariance, 'EVENING_AUDIT_STOCKOUT', inv.item_cost || 0, financialLoss, performer]
                    );
                }

                if (newStockQty <= 0 && inv.linked_menu_item_id) {
                    db.run(`UPDATE menu_items SET is_available = 0 WHERE id = ?`, [inv.linked_menu_item_id]);
                    touchMenuUpdateTimestamp();
                    logAudit('MENU_KILL_SWITCH', `Automated kill-switch toggled menu item [ID: ${inv.linked_menu_item_id}] OFF due to ZERO inventory of '${inv.item_name}'`, 'System Guard');
                }

                logAudit('EVENING_AUDIT', `Shift Audit (${shift_period || 'Closing'}): Reset '${inv.item_name}' stock from ${inv.stock_quantity} to ${newStockQty} (Variance: ${variance >= 0 ? '+' : ''}${variance}). Financial Loss: ₱${financialLoss.toFixed(2)}. Notes: ${notes || 'None'}`, performer);

                res.json({ success: true, variance, financial_loss: financialLoss });
            }
        );
    });
});

app.post('/api/inventory/waste', requireAuth, (req, res) => {
    const { inventory_item_id, quantity_lost, reason_code, reporter, notes } = req.body;
    const performer = getActiveUser(req);

    if (!inventory_item_id || !quantity_lost || !reason_code) {
        return res.status(400).json({ success: false, error: 'Container item, quantity lost, and reason code are required.' });
    }

    const qtyLost = parseInt(quantity_lost, 10) || 0;

    db.get(`SELECT item_name, stock_quantity, item_cost, linked_menu_item_id FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
        if (!inv) return res.status(404).json({ success: false, error: 'Inventory item not found.' });

        const unitCost = inv.item_cost || 0.0;
        const totalFinancialLoss = qtyLost * unitCost;

        db.run(
            `INSERT INTO wastage_logs (inventory_item_id, quantity_lost, reason_code, unit_cost, financial_cost_loss, logged_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [inventory_item_id, qtyLost, reason_code, unitCost, totalFinancialLoss, reporter || performer],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });

                const updatedQty = Math.max(0, inv.stock_quantity - qtyLost);

                db.run(
                    `UPDATE inventory_items SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [updatedQty, inventory_item_id],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, error: err.message });

                        if (updatedQty <= 0 && inv.linked_menu_item_id) {
                            db.run(`UPDATE menu_items SET is_available = 0 WHERE id = ?`, [inv.linked_menu_item_id]);
                            touchMenuUpdateTimestamp();
                        }

                        logAudit('STOCK_WASTAGE', `Logged Spillage/Loss [${reason_code}]: -${qtyLost} '${inv.item_name}' (Financial Loss: ₱${totalFinancialLoss.toFixed(2)}). Notes: ${notes || 'N/A'}`, performer);

                        res.json({ success: true, financial_loss: totalFinancialLoss });
                    }
                );
            }
        );
    });
});

app.post('/api/admin/inventory/pos-sync', requireAuth, (req, res) => {
    const { pos_data, transaction_ref } = req.body;
    const performer = getActiveUser(req);

    if (!pos_data || !Array.isArray(pos_data) || pos_data.length === 0) {
        return res.status(400).json({ success: false, error: 'Valid POS sales array is required.' });
    }

    db.serialize(() => {
        const stmt = db.prepare(`INSERT INTO pos_sales (inventory_item_id, quantity_sold, pos_transaction_ref, logged_by) VALUES (?, ?, ?, ?)`);
        
        pos_data.forEach(item => {
            const qtySold = parseInt(item.quantity_sold, 10) || 0;
            if (item.inventory_item_id && qtySold > 0) {
                stmt.run(item.inventory_item_id, qtySold, transaction_ref || 'POS-MANUAL-SYNC', performer);

                db.run(
                    `UPDATE inventory_items SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [qtySold, item.inventory_item_id]
                );
            }
        });

        stmt.finalize();
        logAudit('POS_SALES_SYNC', `Synced POS Sales Batch [Ref: ${transaction_ref || 'MANUAL'}]: Deducted sold container items from IMS.`, performer);
        res.json({ success: true });
    });
});

app.post('/api/admin/inventory/close-shift', requireAuth, (req, res) => {
    const { shift_date, total_sales_amount, discount_amount, items_sold } = req.body;
    const performer = getActiveUser(req);

    if (!shift_date || total_sales_amount === undefined) {
        return res.status(400).json({ success: false, error: 'Shift date and total sales amount are required.' });
    }

    const salesAmount = parseFloat(total_sales_amount) || 0.0;
    const discAmount = parseFloat(discount_amount) || 0.0;
    const items = Array.isArray(items_sold) ? items_sold : [];

    db.serialize(() => {
        db.run(
            `INSERT INTO shift_closeouts (shift_date, total_sales_amount, discount_amount, logged_by) VALUES (?, ?, ?, ?)`,
            [shift_date, salesAmount, discAmount, performer],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });

                const closeoutId = this.lastID;
                const closeoutStmt = db.prepare(`INSERT INTO shift_closeout_items (closeout_id, menu_item_id, quantity_sold) VALUES (?, ?, ?)`);

                items.forEach(item => {
                    const menuId = parseInt(item.menu_item_id, 10);
                    const qtySold = parseInt(item.quantity_sold, 10) || 0;

                    if (menuId && qtySold > 0) {
                        closeoutStmt.run(closeoutId, menuId, qtySold);

                        db.get(`SELECT id, item_name, stock_quantity FROM inventory_items WHERE linked_menu_item_id = ?`, [menuId], (err, invItem) => {
                            if (!err && invItem) {
                                const newStock = Math.max(0, invItem.stock_quantity - qtySold);
                                db.run(
                                    `UPDATE inventory_items SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                                    [newStock, invItem.id],
                                    (err) => {
                                        if (!err && newStock <= 0) {
                                            db.run(`UPDATE menu_items SET is_available = 0 WHERE id = ?`, [menuId]);
                                            touchMenuUpdateTimestamp();
                                            logAudit('MENU_KILL_SWITCH', `Automated kill-switch toggled menu item [ID: ${menuId}] OFF due to ZERO inventory level during EOD Shift Closeout.`, 'System Guard');
                                        }
                                    }
                                );
                            }
                        });
                    }
                });

                closeoutStmt.finalize();
                logAudit('EOD_SHIFT_CLOSEOUT', `Logged EOD Shift Closeout for date ${shift_date}: Gross Sales ₱${salesAmount.toFixed(2)}, Discounts ₱${discAmount.toFixed(2)}, Items Processed: ${items.length}`, performer);
                res.json({ success: true, closeout_id: closeoutId });
            }
        );
    });
});

app.get('/api/admin/invoices', requireAuth, (req, res) => {
    const { date, supplier } = req.query;
    let query = `
        SELECT s.*, i.item_name
        FROM stock_shipments s
        LEFT JOIN inventory_items i ON s.inventory_item_id = i.id
        WHERE 1=1
    `;
    const params = [];

    if (date) {
        query += ` AND DATE(s.timestamp) = DATE(?)`;
        params.push(date);
    }
    if (supplier) {
        query += ` AND s.supplier_name LIKE ?`;
        params.push(`%${supplier}%`);
    }
    query += ` ORDER BY s.id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/wastage', requireAuth, (req, res) => {
    const { start_date, end_date, movement_type } = req.query;
    const type = movement_type || 'ALL';

    let query = `
        SELECT w.id, 
               CASE WHEN w.reason_code = 'EVENING_AUDIT_STOCKOUT' THEN 'AUDIT' ELSE 'SPILLAGE' END as movement_type, 
               i.item_name, w.quantity_lost, w.reason_code, w.unit_cost, w.financial_cost_loss, w.logged_by, w.timestamp
        FROM wastage_logs w 
        LEFT JOIN inventory_items i ON w.inventory_item_id = i.id 
        WHERE 1=1
    `;
    const params = [];

    if (start_date) {
        query += ` AND DATE(w.timestamp) >= DATE(?)`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND DATE(w.timestamp) <= DATE(?)`;
        params.push(end_date);
    }
    if (type !== 'ALL') {
        if (type === 'SPILLAGE') {
            query += ` AND w.reason_code != 'EVENING_AUDIT_STOCKOUT'`;
        } else if (type === 'AUDIT') {
            query += ` AND w.reason_code = 'EVENING_AUDIT_STOCKOUT'`;
        }
    }
    query += ` ORDER BY w.timestamp DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const formatted = rows.map(w => {
            const isAudit = w.reason_code === 'EVENING_AUDIT_STOCKOUT';
            return {
                id: `${isAudit ? 'A' : 'W'}-${w.id}`,
                movement_type: isAudit ? 'AUDIT' : 'SPILLAGE',
                item_name: w.item_name || 'Unknown Container',
                quantity_display: `${isAudit ? '' : '-'}${w.quantity_lost} units`,
                quantity_val: w.quantity_lost,
                reason_code: w.reason_code,
                unit_cost: w.unit_cost || 0,
                financial_loss: w.financial_cost_loss || 0,
                logged_by: w.logged_by,
                timestamp: w.timestamp
            };
        });

        res.json(formatted);
    });
});

app.get('/api/admin/closeouts', requireAuth, (req, res) => {
    const { start_date, end_date } = req.query;
    let query = `SELECT * FROM shift_closeouts WHERE 1=1`;
    const params = [];
    if (start_date) {
        query += ` AND shift_date >= ?`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND shift_date <= ?`;
        params.push(end_date);
    }
    query += ` ORDER BY id DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/closeouts/:id/items', requireAuth, (req, res) => {
    const closeoutId = req.params.id;
    const query = `
        SELECT c.id, c.quantity_sold, m.name as menu_item_name, m.price
        FROM shift_closeout_items c
        LEFT JOIN menu_items m ON c.menu_item_id = m.id
        WHERE c.closeout_id = ?
    `;
    db.all(query, [closeoutId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/* ===========================================================================
   10. MENU MANAGEMENT REST API ENDPOINTS
   =========================================================================== */

app.post('/api/admin/menu', requireAuth, upload.single('image'), (req, res) => {
    const { name, category, badge, price, description } = req.body;
    const performer = getActiveUser(req);

    if (!name || !category || !price) {
        return res.status(400).json({ success: false, error: 'Name, category, and price are required.' });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    db.run(
        `INSERT INTO menu_items (name, category, badge, price, description, image) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, category, badge || 'none', price, description || '', imagePath],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            touchMenuUpdateTimestamp();
            logAudit('MENU_ITEM_CREATED', `Added new menu item '${name}' (₱${price}) in category [${category}]`, performer);

            res.json({ success: true, id: this.lastID });
        }
    );
});

app.patch('/api/admin/menu/:id/toggle', requireAuth, (req, res) => {
    const itemId = req.params.id;
    const { is_available } = req.body;
    const performer = getActiveUser(req);
    const statusVal = is_available ? 1 : 0;

    db.run(`UPDATE menu_items SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [statusVal, itemId], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });

        touchMenuUpdateTimestamp();
        logAudit('MENU_ITEM_TOGGLE', `Toggled menu item [ID: ${itemId}] availability to ${statusVal === 1 ? 'AVAILABLE' : 'OUT OF STOCK'}`, performer);

        res.json({ success: true });
    });
});

app.delete('/api/admin/menu/:id', requireAdminOrAbove, (req, res) => {
    const itemId = req.params.id;
    const performer = getActiveUser(req);

    db.get(`SELECT name, image FROM menu_items WHERE id = ?`, [itemId], (err, item) => {
        if (!item) return res.status(404).json({ success: false, error: 'Menu item not found.' });

        db.run(`DELETE FROM menu_items WHERE id = ?`, [itemId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            deleteUnusedImageFile(item.image);
            touchMenuUpdateTimestamp();
            logAudit('MENU_ITEM_DELETED', `Deleted menu item '${item.name}' [ID: ${itemId}]`, performer);

            res.json({ success: true });
        });
    });
});

/* ===========================================================================
   11. HERO BANNERS & OPERATING HOURS REST APIS
   =========================================================================== */

app.post('/api/admin/hero-slides', requireAuth, upload.single('image'), (req, res) => {
    const { tag, title, subtitle } = req.body;
    const performer = getActiveUser(req);
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    db.run(
        `INSERT INTO hero_slides (tag, title, subtitle, image) VALUES (?, ?, ?, ?)`,
        [tag || '', title || '', subtitle || '', imagePath],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            logAudit('HERO_SLIDE_CREATED', `Uploaded hero banner slide: '${title}'`, performer);
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.delete('/api/admin/hero-slides/:id', requireAuth, (req, res) => {
    const slideId = req.params.id;
    const performer = getActiveUser(req);

    db.get(`SELECT image, title FROM hero_slides WHERE id = ?`, [slideId], (err, slide) => {
        if (!slide) return res.status(404).json({ success: false, error: 'Slide not found.' });

        db.run(`DELETE FROM hero_slides WHERE id = ?`, [slideId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            deleteUnusedImageFile(slide.image);
            logAudit('HERO_SLIDE_DELETED', `Deleted hero banner slide: '${slide.title}'`, performer);

            res.json({ success: true });
        });
    });
});

app.post('/api/admin/settings', requireAuth, (req, res) => {
    const { open_time, close_time, store_status, closure_start, closure_end, notice_message } = req.body;
    const performer = getActiveUser(req);

    db.serialize(() => {
        if (open_time) db.run(`INSERT INTO settings (key, value) VALUES ('open_time', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [open_time, open_time]);
        if (close_time) db.run(`INSERT INTO settings (key, value) VALUES ('close_time', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [close_time, close_time]);
        if (store_status) db.run(`INSERT INTO settings (key, value) VALUES ('store_status', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [store_status, store_status]);
        if (closure_start !== undefined) db.run(`INSERT INTO settings (key, value) VALUES ('closure_start', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [closure_start, closure_start]);
        if (closure_end !== undefined) db.run(`INSERT INTO settings (key, value) VALUES ('closure_end', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [closure_end, closure_end]);
        if (notice_message !== undefined) db.run(`INSERT INTO settings (key, value) VALUES ('notice_message', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [notice_message, notice_message]);

        logAudit('STORE_SETTINGS_UPDATED', `Updated store hours: Open ${open_time}, Close ${close_time}, Override: ${store_status}`, performer);
        res.json({ success: true });
    });
});

/* ===========================================================================
   12. AUDIT LOGS REST API
   =========================================================================== */
app.get('/api/admin/audit-logs', requireAuth, (req, res) => {
    db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/promo-codes/history', requireAuth, (req, res) => {
    const query = `
        SELECT id, code, customer_name, social_handle, contact_info, platform, status, created_at, redeemed_at, redeemed_by
        FROM promo_codes
        WHERE status = 'Redeemed'
        ORDER BY redeemed_at DESC
        LIMIT 200
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const decryptedRows = rows.map(r => ({
            ...r,
            social_handle: r.social_handle ? decryptPII(r.social_handle) : 'N/A',
            contact_info: r.contact_info ? decryptPII(r.contact_info) : 'N/A',
            redeemed_by: r.redeemed_by || 'Cashier / Admin'
        }));
        res.json(decryptedRows);
    });
});

// RA 10173 Compliance: Daily Auto-Anonymization of PII after 30 days
function autoAnonymizeExpiredPII() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.run(
        `UPDATE promo_codes SET social_handle = '[ANONYMIZED]', contact_info = '[ANONYMIZED]' WHERE status = 'Redeemed' AND redeemed_at < ? AND social_handle != '[ANONYMIZED]'`,
        [thirtyDaysAgo],
        function(err) {
            if (!err && this.changes > 0) {
                logAudit('DATA_PRIVACY_PURGE', `Auto-anonymized PII for ${this.changes} redeemed vouchers older than 30 days (RA 10173 Compliance).`, 'System Routine');
            }
        }
    );
}
// Run once every 24 hours
setInterval(autoAnonymizeExpiredPII, 24 * 60 * 60 * 1000);

/* ===========================================================================
   13. SERVER INIT & LISTENER
   =========================================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Cafe de Melle Application Engine running on port ${PORT}`);
    console.log(`🌐 Local Access: http://localhost:${PORT}`);
    console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin`);
});

