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
if (!process.env.ENCRYPTION_KEY) {
    // SECURITY PLAN P6: the repo fallback must NEVER be used in production. It only
    // keeps local dev boots from crashing while encrypted legacy rows still exist.
    console.warn('🚨 SECURITY: ENCRYPTION_KEY environment variable is not set — falling back to the legacy repo key. Set ENCRYPTION_KEY in Render/deployment env immediately.');
}
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
                "https://cdn.jsdelivr.net",
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
    // SECURITY PLAN P6: rolling session + HTTPS-only cookie in production
    rolling: true,
    name: '_cdm_sid',
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 4 * 60 * 60 * 1000
    }
}));

// SECURITY PLAN P6: global API rate limiter guarding every /api route
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: { success: false, error: 'Too many requests. Please slow down and try again later.' }
});
app.use('/api', apiLimiter);

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
        initDatabaseSchema();
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
            display_order INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS hero_slides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tag TEXT,
            title TEXT,
            subtitle TEXT,
            image TEXT,
            display_order INTEGER DEFAULT 0
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

        // PART 2 refactor: single linked_menu_item_id dropped — Many-to-Many linking now lives
        // entirely in recipe_links (a container can serve many menu items and vice versa)
        db.run(`CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_name TEXT UNIQUE NOT NULL,
            container_unit TEXT NOT NULL,
            stock_quantity INTEGER DEFAULT 0,
            safety_threshold INTEGER DEFAULT 5,
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

        db.run(`CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            source TEXT,
            session_id TEXT
        )`);

        // SMART INVENTORY TRACKER: recipe links (menu item -> bulk container usage per serving)
        db.run(`CREATE TABLE IF NOT EXISTS recipe_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            menu_item_id INTEGER NOT NULL,
            inventory_item_id INTEGER NOT NULL,
            usage_amount REAL NOT NULL,
            usage_unit TEXT DEFAULT 'g',
            container_quantity REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(menu_item_id, inventory_item_id)
        )`);

        // PHASE 3 SOFT AUDIT RECONCILIATION: real-world variance log (managerial transparency,
        // never a punishment row). Explicit wastage stays in wastage_logs; these are shelf counts
        // that drifted slightly from the smart calculation during normal operations.
        db.run(`CREATE TABLE IF NOT EXISTS audit_variances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_item_id INTEGER NOT NULL,
            item_name TEXT,
            shift_period TEXT,
            system_expected INTEGER NOT NULL,
            physical_count INTEGER NOT NULL,
            variance INTEGER NOT NULL,
            reason_code TEXT NOT NULL,
            notes TEXT,
            logged_by TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // SMART INVENTORY TRACKER: computed end-of-day usage deductions
        db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_item_id INTEGER NOT NULL,
            menu_items_summary TEXT,
            items_sold INTEGER NOT NULL,
            total_used REAL NOT NULL,
            whole_containers INTEGER NOT NULL DEFAULT 0,
            remainder REAL NOT NULL DEFAULT 0,
            opened_before REAL DEFAULT 0,
            usage_unit TEXT DEFAULT 'g',
            calculation_date TEXT,
            logged_by TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Automatic DB Migrations for Existing Databases

        // PART 2 REFACTOR: drop the restrictive single linked_menu_item_id column from inventory_items.
        // Recipe links (menu_item_id <-> inventory_item_id Many-to-Many in recipe_links) fully replace it.
        db.all(`PRAGMA table_info(inventory_items)`, [], (err, columns) => {
            if (!err && columns && columns.some(c => c.name === 'linked_menu_item_id')) {
                db.serialize(() => {
                    db.run(`CREATE TABLE inventory_items_rebuilt (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_name TEXT UNIQUE NOT NULL,
                        container_unit TEXT NOT NULL,
                        stock_quantity INTEGER DEFAULT 0,
                        safety_threshold INTEGER DEFAULT 5,
                        item_cost REAL DEFAULT 0.0,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`, [], (err1) => {
                        if (err1) { console.log('🛠️ Migration error preparing rebuilt inventory_items:', err1.message); return; }
                        db.run(`INSERT INTO inventory_items_rebuilt (id, item_name, container_unit, stock_quantity, safety_threshold, item_cost, updated_at)
                                SELECT id, item_name, container_unit, stock_quantity, safety_threshold, item_cost, updated_at FROM inventory_items`, [], (err2) => {
                            if (err2) { console.log('🛠️ Migration error copying inventory rows:', err2.message); db.run(`DROP TABLE inventory_items_rebuilt`); return; }
                            db.run(`DROP TABLE inventory_items`, [], () => {
                                db.run(`ALTER TABLE inventory_items_rebuilt RENAME TO inventory_items`, [], () => {
                                    console.log("🛠️ Migrated DB: removed 'linked_menu_item_id' from inventory_items — recipe_links now owns all container ↔ menu links.");
                                });
                            });
                        });
                    });
                });
            }
        });

        db.all(`PRAGMA table_info(menu_items)`, [], (err, columns) => {
    if (!err && columns && columns.length > 0) {
        const colNames = columns.map(c => c.name);
        if (!colNames.includes('priority_rank')) {
            db.run(`ALTER TABLE menu_items ADD COLUMN priority_rank INTEGER DEFAULT 0`, () => {
                console.log("🛠️ Migrated DB: Added 'priority_rank' column to menu_items table.");
            });
        }
    }
});

       db.all(`PRAGMA table_info(hero_slides)`, [], (err, columns) => {
    if (!err && columns && columns.length > 0) {
        const colNames = columns.map(c => c.name);
        if (!colNames.includes('display_order')) {
            db.run(`ALTER TABLE hero_slides ADD COLUMN display_order INTEGER DEFAULT 0`);
        }
    }
});

        db.all(`PRAGMA table_info(promo_codes)`, [], (err, columns) => {
            if (!err && columns && columns.length > 0) {
                const colNames = columns.map(c => c.name);
                if (!colNames.includes('redeemed_by')) {
                    db.run(`ALTER TABLE promo_codes ADD COLUMN redeemed_by TEXT DEFAULT 'Staff / Cashier'`, () => {
                        console.log("🛠️ Migrated DB: Added 'redeemed_by' column to promo_codes table.");
                    });
                }
            }
        });

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
                        migrateUsersSchemaV2();
                    });
                } else {
                    migrateUsersSchemaV2();
                }
            } else {
                migrateUsersSchemaV2();
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
                const stmt = db.prepare(`INSERT INTO inventory_items (item_name, container_unit, stock_quantity, safety_threshold, item_cost) VALUES (?, ?, ?, ?, ?)`);
                defaultItems.forEach(item => stmt.run(item));
                stmt.finalize();
                console.log("📦 Seeded default bulk inventory containers with unit costs.");
            }
        });
    });
}

/* ===========================================================================
   PART 3 — SECURITY PLAN: EMPLOYEE PROFILE SCHEMA V2 (non-destructive migration)
   Adds employee identity + lockout/audit columns to `users` via ALTER TABLE.
   Column additions use the same safe pattern as existing migrations.
   =========================================================================== */
const USERS_SCHEMA_V2_COLUMNS = [
    ['full_name', 'TEXT'],
    ['position', 'TEXT'],
    ['account_code', 'TEXT'],
    ['must_change_password', 'INTEGER DEFAULT 0'],
    ['failed_attempts', 'INTEGER DEFAULT 0'],
    ['locked_until', 'DATETIME'],
    ['last_login', 'DATETIME'],
    ['is_active', 'INTEGER DEFAULT 1'],
    ['created_by', 'TEXT'],
    ['updated_at', 'DATETIME']
];

function migrateUsersSchemaV2() {
    db.all(`PRAGMA table_info(users)`, [], (err, columns) => {
        if (err || !columns || columns.length === 0) return seedDefaultAccounts();
        const colNames = columns.map(c => c.name);
        const missing = USERS_SCHEMA_V2_COLUMNS.filter(([name]) => !colNames.includes(name));

        let remaining = missing.length;
        if (remaining === 0) {
            return backfillEmployeeAccounts();
        }
        missing.forEach(([name, decl]) => {
            db.run(`ALTER TABLE users ADD COLUMN ${name} ${decl}`, () => {
                console.log(`🛠️ Migrated DB (SECURITY PLAN P1): Added '${name}' column to users table.`);
                remaining--;
                if (remaining === 0) backfillEmployeeAccounts();
            });
        });
    });
}

// ONE-TIME BACKFILL: accounts that predate the security plan receive their permanent
// 9-digit account code plus a freshly generated temporary password (bcrypt cost 12).
// Owners find the codes + temp passwords in account-access-codes.md at repo root and
// must log in once (password change enforced on first login). Runs only when rows are
// still missing account codes, so it never resets passwords again after day one.
function backfillEmployeeAccounts() {
    db.all(`SELECT id, username, role, full_name FROM users WHERE account_code IS NULL OR account_code = ''`, [], (err, rows) => {
        if (err) {
            console.error('⚠️ users backfill failed:', err.message);
            return seedDefaultAccounts();
        }
        if (!rows || rows.length === 0) {
            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_code ON users(account_code)`, [], () => seedDefaultAccounts());
            return;
        }

        const recovered = [];
        db.serialize(() => {
            db.run(`BEGIN TRANSACTION`);
            const stmt = db.prepare(`
                UPDATE users
                SET account_code = ?,
                    password_hash = ?,
                    must_change_password = 1,
                    is_active = COALESCE(is_active, 1),
                    failed_attempts = 0,
                    locked_until = NULL,
                    full_name = COALESCE(full_name, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            rows.forEach(row => {
                const tempPassword = generateTemporaryPassword(['Admin', 'Owner', 'Developer'].includes(row.role) ? 14 : 10);
                stmt.run(
                    format9DigitAccountId(row.id, row.role),
                    bcrypt.hashSync(tempPassword, 12),
                    row.username,
                    row.id
                );
                recovered.push({
                    username: row.username,
                    role: row.role,
                    account_code: format9DigitAccountId(row.id, row.role),
                    display_name: row.full_name || row.username,
                    temp_password: tempPassword
                });
            });
            stmt.finalize(() => {
                db.run(`COMMIT`, () => {
                    logAudit('ACCOUNT_SCHEMA_V2', `Security plan P1 backfill: issued permanent account codes + temporary passwords for ${recovered.length} existing account(s); owners must change them at first login. Credentials stored in account-access-codes.md (never logged to console).`, 'System Guard');
                    writeAccountAccessCodesFile(recovered);
                    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_code ON users(account_code)`, [], () => seedDefaultAccounts());
                });
            });
        });
    });
}

function writeAccountAccessCodesFile(entries) {
    if (!entries || entries.length === 0) return;
    const lines = [
        '# Cafe de Melle — Account Access Codes (Owner Only)',
        '',
        `> Generated automatically on first boot of the Security Plan (P1/P3) — ${new Date().toISOString()}`,
        '> TEMPORARY passwords: each account is forced to set a new password at first login.',
        '> Keep this file LOCAL — it is git-ignored and must never be committed or shared.',
        '',
        '| Account Code | Username | Employee / Display Name? | Role | Temporary Password |',
        '|---|---|---|---|---|'
    ];
    entries.forEach(e => {
        // escape pipes and avoid breaking the markdown table
        const safe = s => String(s || '').replace(/\|/g, '/');
        lines.push(`| ${e.account_code} | ${safe(e.username)} | ${safe(e.display_name)} | ${safe(e.role)} | \`${e.temp_password}\` |`);
    });
    lines.push('', 'Login flow: open the login page → enter the Account Code (or username) → Continue → enter the temporary password → set your new password → you land in the admin panel.');
    const filePath = path.join(__dirname, 'account-access-codes.md');
    try {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        console.log(`🔐 Employee access codes + temporary passwords written to: ${path.basename(filePath)} (owner reference only)`);
    } catch (e) {
        console.error('⚠️ Could not write account access file:', e.message);
    }
}

// Cryptographically random temporary password that satisfies the house policy:
// letters + digit + symbol, never reused, printed nowhere.
function generateTemporaryPassword(minLength = 10) {
    const length = Math.max(minLength, 10);
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const all = lower + upper + digits + symbols;
    const bytes = crypto.randomBytes(Math.max(length, 4));
    let pw = Array.from(bytes).map(b => all[b % all.length]).join('');
    const guarantee = [
        lower[crypto.randomInt(lower.length)],
        upper[crypto.randomInt(upper.length)],
        digits[crypto.randomInt(digits.length)],
        symbols[crypto.randomInt(symbols.length)]
    ].join('');
    return guarantee + pw.slice(4);
}

// Password policy (P6): min 8 chars staff, min 12 Admin/Owner/Developer; letters AND
// digits AND a symbol. Enforced on create/change — never on login.
function validatePasswordPolicy(password, role) {
    const isPrivileged = ['Admin', 'Owner', 'Developer'].includes(role);
    const minLength = isPrivileged ? 12 : 8;
    if (typeof password !== 'string' || password.length < minLength) {
        return `Password must be at least ${minLength} characters for ${role} accounts.`;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
        return 'Password must contain letters, a number, and a symbol.';
    }
    return null;
}

function seedDefaultAccounts() {
    const defaultAdminUser = process.env.ADMIN_USERNAME || 'admin';

    const createAccount = (username, role, plaintextOrTemp, fromEnv) => {
        const hash = bcrypt.hashSync(plaintextOrTemp, 12);
        db.serialize(() => {
            db.run(`INSERT INTO users (username, password_hash, role, full_name, position, must_change_password, is_active, created_by) VALUES (?, ?, ?, ?, ?, 1, 1, 'Account Seed')`,
                [username, hash, role, username === 'developer' ? 'System Developer' : (username === 'owner' ? 'Business Owner' : 'Cafe Manager'), role === 'Owner' ? 'Owner' : (role === 'Developer' ? 'System' : 'Manager')],
                function(err) {
                    if (!err && this.lastID) {
                        const code = format9DigitAccountId(this.lastID, role);
                        db.run(`UPDATE users SET account_code = ? WHERE id = ?`, [code, this.lastID]);
                        logAudit('ACCOUNT_SEEDED', `Seeded '${username}' [Role: ${role}, ID: ${code}] on first boot. Temporary password issued${fromEnv ? ' from environment settings' : ' by system generator'}; change required at first login.`, 'System Guard');
                        if (!fromEnv) {
                            // Never print the password; hand it to the owner via the local file.
                            writeAccountAccessCodesFile([{ username, role, account_code: code, display_name: role === 'Owner' ? 'Business Owner' : (role === 'Developer' ? 'System Developer' : 'Cafe Manager'), temp_password: plaintextOrTemp }]);
                        }
                    }
                });
        });
    };

    // ADMIN: username/password environment-only (P6). No repo fallback passwords.
    db.get(`SELECT * FROM users WHERE username = ?`, [defaultAdminUser], (err, row) => {
        if (err) return;
        if (!row) {
            if (process.env.ADMIN_PASSWORD) {
                createAccount(defaultAdminUser, 'Admin', process.env.ADMIN_PASSWORD, true);
            } else {
                createAccount(defaultAdminUser, 'Admin', generateTemporaryPassword(14), false);
            }
            console.log(`🔒 Default Admin account initialized: ${defaultAdminUser}`);
        }
    });

    // DEVELOPER + OWNER: no hardcoded repo passwords — generated secrets only.
    db.get(`SELECT * FROM users WHERE username = 'developer'`, (err, row) => {
        if (err) return;
        if (!row) {
            createAccount('developer', 'Developer', generateTemporaryPassword(14), false);
            console.log(`🔒 Developer account initialized: developer`);
        }
    });

    db.get(`SELECT * FROM users WHERE username = 'owner'`, (err, row) => {
        if (err) return;
        if (!row) {
            createAccount('owner', 'Owner', generateTemporaryPassword(14), false);
            console.log(`🔒 Owner account initialized: owner`);
        }
    });
}

/* ===========================================================================
   6. HELPER FUNCTIONS & MIDDLEWARE GUARDS
   =========================================================================== */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.isAdmin) {
        return res.status(401).json({ success: false, error: 'Unauthorized access. Please log in.' });
    }
    // SECURITY PLAN P6: live account-state check — deactivation and role changes take
    // effect immediately on the very next request (no session grants for dead accounts).
    db.get(`SELECT is_active, role, username FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: 'Unauthorized access. Please log in.' });
        }
        if (!user.is_active) {
            const performer = `${user.username} (deactivated)`;
            req.session.destroy(() => {});
            logAudit('SESSION_KILLED_BY_DEACTIVATION', `Session terminated for '${user.username}' — account is deactivated.`, performer);
            return res.status(401).json({ success: false, error: 'Account deactivated by management. Please ask your manager for help.' });
        }
        if (user.role !== req.session.role) {
            // don't let a stale cached role grant higher permissions after a role change
            req.session.role = user.role;
            req.session.username = user.username;
        }
        return next();
    });
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
    return res.status(403).json({ success: false, error: 'Access denied. Staff role cannot perform this management action.' });
}

// SECURITY PLAN P4/P5: permission ladder for managing OTHER accounts.
// Admin → Staff only · Owner → Staff + Admin · Developer → everything.
function requesterCanManage(requesterRole, targetRole) {
    if (requesterRole === 'Developer') return true;
    if (requesterRole === 'Owner') return targetRole === 'Staff' || targetRole === 'Admin';
    if (requesterRole === 'Admin') return targetRole === 'Staff';
    return false;
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
    const now = new Date().toLocaleString();
    db.run(`INSERT INTO settings (key, value) VALUES ('menu_last_updated', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [now, now]);
}

/* ===========================================================================
   7. PUBLIC API ENDPOINTS
   =========================================================================== */

app.get('/api/menu', (req, res) => {
    db.all(`SELECT * FROM menu_items ORDER BY display_order ASC, id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        res.json(rows);
    });
});

app.get('/api/hero-slides', (req, res) => {
    db.all(`SELECT * FROM hero_slides ORDER BY display_order ASC, id DESC`, [], (err, rows) => {
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

// Record incoming page visit with deduplication guardrail (1-hour IP hash check)
app.post('/api/visits', (req, res) => {
    let source = req.body.source || 'direct';
    const referrer = req.headers.referer || '';
    if (!req.body.source) {
        if (referrer.includes('facebook.com')) source = 'facebook';
        else if (referrer.includes('google.com') && referrer.includes('maps')) source = 'google_maps';
        else if (referrer.includes('google.com')) source = 'google_search';
        else if (referrer.includes('instagram.com')) source = 'instagram';
        else if (referrer.includes('tiktok.com')) source = 'tiktok';
    }
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const ipHash = crypto.createHash('md5').update(clientIp).digest('hex');

    db.get(
        `SELECT id FROM visits WHERE session_id = ? AND source = ? AND timestamp >= datetime('now', '-1 hour')`,
        [ipHash, source],
        (err, row) => {
            if (row) {
                return res.json({ success: true, counted: false });
            }
            db.run(
                `INSERT INTO visits (source, session_id) VALUES (?, ?)`,
                [source, ipHash],
                function(err) {
                    if (err) return res.status(500).json({ success: false });
                    res.json({ success: true, counted: true });
                }
            );
        }
    );
});

/* ===========================================================================
   8. ADMIN & AUTHENTICATED REST API ENDPOINTS
   =========================================================================== */

/* ===========================================================================
   8. ADMIN & AUTHENTICATED REST API ENDPOINTS
   AUTH FLOW (SECURITY PLAN P2/P3): two-step bank-style login.
   Step 1: identify by 9-digit account code OR username.
   Step 2: password with per-account lockout (5 fails → 15 min) + session fixation fix.
   Step 3: forced password change for accounts flagged must_change_password — those
   users get a NON-ADMIN pending session until they actually set a new password.
   =========================================================================== */

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

// Shared lookup: 9-digit account code or username (case-insensitive)
function findLoginUser(handle, cb) {
    const digitsOnly = String(handle || '').replace(/\D/g, '');
    db.get(
        `SELECT * FROM users WHERE username = ? COLLATE NOCASE OR (account_code IS NOT NULL AND account_code = ?)`,
        [String(handle || '').trim(), digitsOnly && digitsOnly.length >= 9 ? digitsOnly : '___none___'],
        (err, user) => cb(err, user || null)
    );
}

function lockRemainingMs(user) {
    if (!user || !user.locked_until) return 0;
    const until = new Date(user.locked_until + (user.locked_until.includes('Z') ? '' : 'Z')).getTime();
    let ms = until - Date.now();
    if (Number.isNaN(ms)) {
        // DATETIME stored as "YYYY-MM-DD HH:MM:SS" (UTC by SQLite convention)
        const parts = user.locked_until.split(/[- :]/);
        if (parts.length >= 6) {
            const asUTC = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
            ms = asUTC.getTime() - Date.now();
        }
    }
    return Math.max(0, ms);
}

app.post('/api/admin/login/identify', loginLimiter, (req, res) => {
    const handle = String(req.body.handle || req.body.username || '').trim();
    if (!handle) {
        return res.status(400).json({ success: false, error: 'Please enter your account code or username.' });
    }

    findLoginUser(handle, (err, user) => {
        // Never confirm existence to strangers — one generic answer for unknown handles
        if (err || !user) {
            logAudit('LOGIN_IDENTIFIED', `Failed identify attempt: no active account matched the provided handle.`, 'System Guard');
            return res.status(404).json({ success: false, state: 'unknown', error: 'No matching account found. Check your account code with your manager.' });
        }

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                state: 'inactive',
                error: 'This account has been deactivated by management. Please ask your manager.'
            });
        }

        const lockedMs = lockRemainingMs(user);
        if (lockedMs > 0) {
            const mins = Math.ceil(lockedMs / 60000);
            return res.status(403).json({
                success: false,
                state: 'locked',
                error: `Account locked after too many attempts. Try again in ~${mins} minute(s) or ask a manager to unlock it.`
            });
        }

        // Employee card for the verify step (privacy: only needed basics)
        const fullName = user.full_name || user.username;
        const nameParts = String(fullName).trim().split(/\s+/);
        const displayParts = nameParts.map((p, i) => (i === 0 ? p : (p.charAt(0) + '.')));
        const initials = nameParts.slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
        const digits = format9DigitAccountId(user.id, user.role);
        const formattedCode = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;

        logAudit('LOGIN_IDENTIFIED', `Employee identified at step 1: '${user.username}' [Role: ${user.role}]`, 'System Guard');

        res.json({
            success: true,
            state: 'identify-ok',
            employee: {
                handle: handle,
                display_name: displayParts.join(' '),
                full_name: fullName,
                initials: initials,
                position: user.position || 'Team Member',
                role: user.role,
                account_code_masked: `${digits.slice(0, 3)}-•••-${digits.slice(6, 9)}`,
                formatted_account_code: formattedCode,
                min_password_length: ['Admin', 'Owner', 'Developer'].includes(user.role) ? 12 : 8
            }
        });
    });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
    const handle = String(req.body.handle || req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!handle || !password) {
        return res.status(400).json({ success: false, error: 'Account code/username and password are required.' });
    }

    findLoginUser(handle, (err, user) => {
        if (err || !user) {
            logAudit('USER_LOGIN_FAILED', `Failed login attempt for handle: ${handle.slice(0, 24)}`, 'System Guard');
            return res.status(401).json({ success: false, state: 'invalid', error: 'Invalid credentials.' });
        }

        if (!user.is_active) {
            logAudit('USER_LOGIN_BLOCKED', `Login blocked — inactive account '${user.username}'`, 'System Guard');
            return res.status(403).json({ success: false, state: 'inactive', error: 'This account has been deactivated by management.' });
        }

        const lockedMs = lockRemainingMs(user);
        if (lockedMs > 0) {
            const mins = Math.ceil(lockedMs / 60000);
            return res.status(403).json({
                success: false,
                state: 'locked',
                error: `Account is locked after too many failed attempts. Try again in ~${mins} minute(s) or ask a manager to unlock it.`,
                locked_until: user.locked_until
            });
        }

        const passwordValid = bcrypt.compareSync(password, user.password_hash);
        if (!passwordValid) {
            const attemptsUsed = (user.failed_attempts || 0) + 1;
            if (attemptsUsed >= LOGIN_MAX_ATTEMPTS) {
                db.run(`UPDATE users SET failed_attempts = 0, locked_until = DATETIME('now', ?) WHERE id = ?`, [`+${LOGIN_LOCK_MINUTES} minutes`, user.id], (err) => {
                    if (err) console.error('Lockout write error:', err.message);
                });
                logAudit('LOCKOUT_TRIGGERED', `Account '${user.username}' locked for ${LOGIN_LOCK_MINUTES} minutes after ${attemptsUsed} failed login attempts.`, 'System Guard');
                return res.status(401).json({
                    success: false,
                    state: 'locked',
                    error: `Too many failed attempts. Account locked for ${LOGIN_LOCK_MINUTES} minutes — ask a manager to unlock it.`
                });
            }

            db.run(`UPDATE users SET failed_attempts = ? WHERE id = ?`, [attemptsUsed, user.id], () => {});
            logAudit('USER_LOGIN_FAILED', `Failed login attempt for '${user.username}' (attempt ${attemptsUsed}/${LOGIN_MAX_ATTEMPTS})`, 'System Guard');
            const remaining = LOGIN_MAX_ATTEMPTS - attemptsUsed;
            return res.status(401).json({
                success: false,
                state: 'invalid',
                error: remaining > 0
                    ? `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before a 15-minute lock.`
                    : 'Too many failed attempts. Account locked for 15 minutes — ask a manager to unlock it.',
                attempts_remaining: remaining
            });
        }

        // Success: transparently upgrade legacy cost-10 hashes to cost 12 (P6)
        const costMatch = /\$2[aby]\$(\d{2})\$/.exec(user.password_hash);
        if (costMatch && parseInt(costMatch[1], 10) < 12) {
            db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [bcrypt.hashSync(password, 12), user.id], () => {});
        }

        db.run(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id], () => {});

        const fullName = user.full_name || user.username;
        const digits = format9DigitAccountId(user.id, user.role);

        // SECURITY PLAN P3: session regenerated on login (kills fixation risk)
        req.session.regenerate(() => {
            logAudit('USER_LOGIN', `User '${user.username}' [Role: ${user.role}, ID: ${digits}] logged in successfully.`, `${user.username} (${user.role})`);

            db.get(`SELECT must_change_password FROM users WHERE id = ?`, [user.id], (err2, fresh) => {
                const mustChange = !!(fresh && fresh.must_change_password);

                if (mustChange) {
                    // Pending session: NOT admin-authenticated until the password change completes
                    req.session.pendingUserId = user.id;
                    req.session.pendingUsername = user.username;
                    req.session.pendingRole = user.role || 'Staff';
                    return res.json({
                        success: true,
                        must_change_password: true,
                        user: {
                            id: user.id,
                            account_id: digits,
                            username: user.username,
                            role: user.role,
                            full_name: fullName
                        }
                    });
                }

                req.session.isAdmin = true;
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.role = user.role || 'Staff';
                req.session.accountId = digits;
                req.session.fullName = fullName;
                req.session.position = user.position || null;
                return res.json({
                    success: true,
                    user: {
                        id: user.id,
                        account_id: digits,
                        username: user.username,
                        role: user.role,
                        full_name: fullName,
                        position: user.position || null
                    }
                });
            });
        });
    });
});

// Forced password change — pending-session step 3 (no bypass: no admin session exists yet)
app.get('/api/admin/pending-session', (req, res) => {
    if (!req.session || !req.session.pendingUserId) {
        return res.json({ success: true, pending: false });
    }
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.pendingUserId], (err, user) => {
        if (err || !user || !user.must_change_password || !user.is_active) {
            // Change already done elsewhere / account dirty state — clear pending session
            req.session.destroy(() => {});
            return res.json({ success: true, pending: false });
        }
        const digits = format9DigitAccountId(user.id, user.role);
        const fullName = user.full_name || user.username;
        res.json({
            success: true,
            pending: true,
            employee: {
                id: user.id,
                account_id: digits,
                username: user.username,
                role: user.role,
                full_name: fullName,
                position: user.position || 'Team Member',
                initials: fullName.trim().split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join(''),
                min_password_length: ['Admin', 'Owner', 'Developer'].includes(user.role) ? 12 : 8
            }
        });
    });
});

app.post('/api/admin/login/complete-change', loginLimiter, (req, res) => {
    if (!req.session || !req.session.pendingUserId) {
        return res.status(401).json({ success: false, error: 'No pending password change. Please start a fresh login.' });
    }
    const userId = req.session.pendingUserId;
    const newPassword = String(req.body.new_password || '');
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user || !user.is_active) {
            req.session.destroy(() => {});
            return res.status(404).json({ success: false, error: 'Pending account not found. Please log in again.' });
        }
        const policyError = validatePasswordPolicy(newPassword, user.role || 'Staff');
        if (policyError) {
            return res.status(400).json({ success: false, error: policyError });
        }

        db.run(`UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [bcrypt.hashSync(newPassword, 12), userId], (err2) => {
            if (err2) return res.status(500).json({ success: false, error: err2.message });

            const digits = format9DigitAccountId(userId, user.role);
            logAudit('PASSWORD_FORCED_CHANGE_DONE', `'${user.username}' completed the mandatory first-login password change.`, `${user.username} (${user.role})`);

            // Upgrade pending session → full admin session (new session id)
            req.session.regenerate(() => {
                req.session.isAdmin = true;
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.role = user.role || 'Staff';
                req.session.accountId = digits;
                req.session.fullName = user.full_name || user.username;
                req.session.position = user.position || null;
                logAudit('USER_LOGIN', `User '${user.username}' [Role: ${user.role}, ID: ${digits}] logged in successfully (first-login change).`, `${user.username} (${user.role})`);
                res.json({
                    success: true,
                    user: { id: user.id, account_id: digits, username: user.username, role: user.role, full_name: user.full_name || user.username }
                });
            });
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
    db.get(`SELECT id, username, role, full_name, position, account_code, must_change_password, is_active, last_login FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user || !user.is_active) {
            req.session.destroy(() => {});
            return res.status(401).json({ success: false, error: 'Unauthorized access. Please log in.' });
        }
        const digits = user.account_code || format9DigitAccountId(user.id, user.role);
        res.json({
            id: user.id,
            account_id: digits,
            username: user.username,
            role: user.role,
            full_name: user.full_name || user.username,
            position: user.position || null,
            must_change_password: !!user.must_change_password,
            last_login: user.last_login || null
        });
    });
});

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
                         LEFT JOIN menu_items m ON m.id = (
                             SELECT MIN(rl.menu_item_id) FROM recipe_links rl WHERE rl.inventory_item_id = i.id
                         )
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

app.get('/api/admin/users', requireAuth, requireNonStaff, (req, res) => {
    db.all(`SELECT id, username, role, full_name, position, account_code, must_change_password, failed_attempts, locked_until, last_login, is_active, created_by FROM users ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formattedUsers = rows.map(u => {
            const lockedMs = lockRemainingMs(u);
            let status = 'active';
            if (!u.is_active) status = 'inactive';
            else if (lockedMs > 0) status = 'locked';
            else if (u.must_change_password) status = 'temp_password';
            return {
                id: u.id,
                account_id: u.account_code || format9DigitAccountId(u.id, u.role),
                username: u.username,
                role: u.role,
                full_name: u.full_name || u.username,
                position: u.position || null,
                status: status,
                must_change_password: !!u.must_change_password,
                locked_until: lockedMs > 0 ? u.locked_until : null,
                last_login: u.last_login || null,
                created_by: u.created_by || null,
                is_active: !!u.is_active
            };
        });
        res.json(formattedUsers);
    });
});

const EMPLOYEE_POSITIONS = ['Barista', 'Cashier', 'Barista-Cashier', 'Kitchen', 'Supervisor'];

app.post('/api/admin/users', requireAuth, requireNonStaff, (req, res) => {
    const { username, full_name, position, role } = req.body;
    const performer = getActiveUser(req);
    const requesterRole = req.session.role;

    if (!username || !/^[A-Za-z0-9_.]{3,24}$/.test(String(username).trim())) {
        return res.status(400).json({ success: false, error: 'Username must be 3-24 characters (letters, numbers, dot, underscore).' });
    }
    if (!full_name || String(full_name).trim().length < 2 || String(full_name).trim().length > 60) {
        return res.status(400).json({ success: false, error: 'Employee full name is required (2-60 characters).' });
    }
    if (!position || !EMPLOYEE_POSITIONS.includes(position)) {
        return res.status(400).json({ success: false, error: 'Position is required (Barista, Cashier, Barista-Cashier, Kitchen, Supervisor).' });
    }

    const assignedRole = ['Staff', 'Admin', 'Owner', 'Developer'].includes(role) ? role : 'Staff';

    if (!requesterCanManage(requesterRole, assignedRole)) {
        return res.status(403).json({ success: false, error: `Your role (${requesterRole}) cannot create ${assignedRole} accounts.` });
    }
    if (requesterRole === 'Owner' && assignedRole === 'Developer') {
        return res.status(403).json({ success: false, error: 'Owners cannot create Developer accounts.' });
    }

    // SECURITY PLAN P3/P4: accounts are created with an auto-generated temporary password
    // (never a chosen weak one) and must change it at first login — no 1-char passwords.
    const tempPassword = generateTemporaryPassword(['Staff'].includes(assignedRole) ? 10 : 14);
    const hash = bcrypt.hashSync(tempPassword, 12);
    const cleanName = String(full_name).trim();
    const cleanUsername = String(username).trim();

    db.run(
        `INSERT INTO users (username, password_hash, role, full_name, position, must_change_password, is_active, created_by) VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
        [cleanUsername, hash, assignedRole, cleanName, position, performer],
        function(err) {
            if (err) {
                if (String(err.message).toLowerCase().includes('unique')) {
                    return res.status(400).json({ success: false, error: 'Username already exists.' });
                }
                return res.status(500).json({ success: false, error: err.message });
            }

            const newUserId = this.lastID;
            const accountCode = format9DigitAccountId(newUserId, assignedRole);
            db.run(`UPDATE users SET account_code = ? WHERE id = ?`, [accountCode, newUserId], () => {});

            logAudit('USER_CREATE', `Created employee account '${cleanUsername}' (Name: ${cleanName}, Position: ${position}) with Role: ${assignedRole} [ID: ${accountCode}]; temporary password issued, change required at login.`, performer);
            logAudit('PASSWORD_RESET_INITIATED', `Temporary password generated for new account '${cleanUsername}' [ID: ${accountCode}]`, performer);

            res.json({
                success: true,
                id: newUserId,
                account_id: accountCode,
                username: cleanUsername,
                full_name: cleanName,
                position: position,
                role: assignedRole,
                must_change_password: true,
                temp_password: tempPassword
            });
        }
    );
});

// SECURITY PLAN P4: single management endpoint — profile update, password reset,
// deactivate/reactivate, force-unlock. Everyday "removal" is deactivate (reversible);
// Developer-only DELETE below remains the hard-revoke path.
app.patch('/api/admin/users/:id', requireAuth, requireNonStaff, (req, res) => {
    const targetUserId = parseInt(req.params.id, 10);
    const { action, full_name, position, username } = req.body;
    const performer = getActiveUser(req);
    const requesterRole = req.session.role;

    db.get(`SELECT * FROM users WHERE id = ?`, [targetUserId], (err, target) => {
        if (err || !target) return res.status(404).json({ success: false, error: 'Account not found.' });
        if (!requesterCanManage(requesterRole, target.role)) {
            return res.status(403).json({ success: false, error: `Your role (${requesterRole}) cannot manage ${target.role} accounts.` });
        }

        const code = target.account_code || format9DigitAccountId(target.id, target.role);
        const finish = (payload) => res.json({ success: true, account_id: code, username: target.username, ...payload });

        if (action === 'update-profile') {
            const cleanName = String(full_name || '').trim();
            const cleanPosition = position || target.position;
            if (cleanName.length < 2 || cleanName.length > 60) {
                return res.status(400).json({ success: false, error: 'Full name must be 2-60 characters.' });
            }
            if (cleanPosition && !EMPLOYEE_POSITIONS.includes(cleanPosition)) {
                return res.status(400).json({ success: false, error: 'Invalid position.' });
            }
            db.run(`UPDATE users SET full_name = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [cleanName, cleanPosition, targetUserId], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                logAudit('PROFILE_UPDATED', `Updated profile of '${target.username}' [${code}] — Name: ${cleanName}, Position: ${cleanPosition || target.position || 'None'}`, performer);
                return finish({ full_name: cleanName, position: cleanPosition });
            });

        } else if (action === 'reset-password') {
            const tempPassword = generateTemporaryPassword(['Staff'].includes(target.role) ? 10 : 14);
            db.run(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [bcrypt.hashSync(tempPassword, 12), targetUserId], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                logAudit('PASSWORD_RESET_INITIATED', `Temporary password generated for '${target.username}' [${code}]; user must change it at next login.`, performer);
                return finish({ temp_password: tempPassword, must_change_password: true });
            });

        } else if (action === 'deactivate') {
            if (targetUserId === req.session.userId) {
                return res.status(400).json({ success: false, error: 'You cannot deactivate your own account while logged in.' });
            }
            if (!target.is_active) {
                return res.status(400).json({ success: false, error: 'Account is already deactivated.' });
            }
            // Guard: never leave the business without an active Admin+ account
            if (['Admin', 'Owner'].includes(target.role)) {
                db.get(`SELECT COUNT(*) AS activePrivileged FROM users WHERE is_active = 1 AND role IN ('Admin','Owner','Developer') AND id != ?`, [targetUserId], (cerr, row) => {
                    if (cerr || (row && row.activePrivileged === 0)) {
                        return res.status(400).json({ success: false, error: 'Cannot deactivate — at least one active Admin/Owner account must remain.' });
                    }
                    doDeactivate();
                });
            } else {
                doDeactivate();
            }

            function doDeactivate() {
                db.run(`UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetUserId], (err2) => {
                    if (err2) return res.status(500).json({ success: false, error: err2.message });
                    logAudit('SUSPEND_ACCOUNT', `Deactivated employee account '${target.username}' [${code}] (reversible).`, performer);
                    return finish({ is_active: false });
                });
            }

        } else if (action === 'reactivate') {
            if (target.is_active) {
                return res.status(400).json({ success: false, error: 'Account is already active.' });
            }
            db.run(`UPDATE users SET is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetUserId], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                logAudit('ACCOUNT_REACTIVATED', `Reactivated employee account '${target.username}' [${code}].`, performer);
                return finish({ is_active: true });
            });

        } else if (action === 'force-unlock') {
            if (!target.failed_attempts && !target.locked_until) {
                return res.status(400).json({ success: false, error: 'Account is not locked.' });
            }
            db.run(`UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetUserId], (err2) => {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                logAudit('ACCOUNT_UNLOCKED', `Manually cleared lockout/failed attempts for '${target.username}' [${code}].`, performer);
                return finish({ unlocked: true });
            });

        } else {
            return res.status(400).json({ success: false, error: 'Unknown account action. Use update-profile, reset-password, deactivate, reactivate, or force-unlock.' });
        }
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

    // SECURITY PLAN P3: current password is REQUIRED — a change can never silently
    // keep the old hash. Password policy enforced only on the NEW password.
    if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Current password is required.' });
    }

    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (!user) return res.status(404).json({ success: false, error: 'Account user not found.' });

        const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
        if (!isValid) {
            logAudit('CREDENTIALS_UPDATE_FAILED', `Failed credential change — wrong current password for '${user.username}'.`, performer);
            return res.status(401).json({ success: false, error: 'Current password incorrect.' });
        }

        let newHash = user.password_hash;
        let passwordChanged = false;
        if (newPassword) {
            const policyError = validatePasswordPolicy(newPassword, user.role || 'Staff');
            if (policyError) {
                return res.status(400).json({ success: false, error: policyError });
            }
            newHash = bcrypt.hashSync(newPassword, 12);
            passwordChanged = true;
        }

        let updatedUsername = user.username;
        if (newUsername && newUsername !== user.username) {
            const clean = String(newUsername).trim();
            if (!/^[A-Za-z0-9_.]{3,24}$/.test(clean)) {
                return res.status(400).json({ success: false, error: 'Username must be 3-24 characters (letters, numbers, dot, underscore).' });
            }
            updatedUsername = clean;
        }

        db.run(
            `UPDATE users SET username = ?, password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [updatedUsername, newHash, userId],
            function(err) {
                if (err) return res.status(400).json({ success: false, error: 'Username already in use.' });

                req.session.username = updatedUsername;
                logAudit(
                    'CREDENTIALS_UPDATE',
                    `User '${user.username}' updated credentials/username to '${updatedUsername}'${passwordChanged ? ' (new password set, temp-password flag cleared, bcrypt cost 12)' : ' (username only)'}.`,
                    performer
                );

                res.json({ success: true, username: updatedUsername, password_changed: passwordChanged });
            }
        );
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

app.get('/api/admin/visit-stats', requireAuth, (req, res) => {
    db.get(`SELECT COUNT(*) as today FROM visits WHERE DATE(timestamp) = DATE('now')`, [], (err, todayRow) => {
        db.get(`SELECT COUNT(*) as week FROM visits WHERE timestamp >= datetime('now', '-7 days')`, [], (err, weekRow) => {
            db.get(`SELECT COUNT(*) as month FROM visits WHERE timestamp >= datetime('now', '-30 days')`, [], (err, monthRow) => {
                db.all(`SELECT source, COUNT(*) as count FROM visits GROUP BY source`, [], (err, sourceRows) => {
                    db.all(`SELECT DATE(timestamp) as date, COUNT(*) as count FROM visits WHERE timestamp >= datetime('now', '-7 days') GROUP BY DATE(timestamp) ORDER BY date ASC`, [], (err, dailyRows) => {
                        db.all(`SELECT strftime('%Y-%W', timestamp) as week, COUNT(*) as count FROM visits WHERE timestamp >= datetime('now', '-56 days') GROUP BY week ORDER BY week ASC`, [], (err, weeklyRows) => {
                            db.all(`SELECT strftime('%Y-%m', timestamp) as month, COUNT(*) as count FROM visits WHERE timestamp >= datetime('now', '-365 days') GROUP BY month ORDER BY month ASC`, [], (err, monthlyRows) => {
                                res.json({
                                    totals: {
                                        today: todayRow ? todayRow.today : 0,
                                        week: weekRow ? weekRow.week : 0,
                                        month: monthRow ? monthRow.month : 0
                                    },
                                    sources: sourceRows || [],
                                    chart: {
                                        daily: dailyRows || [],
                                        weekly: weeklyRows || [],
                                        monthly: monthlyRows || []
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

/* ===========================================================================
   9. INVENTORY & SUPPLY ENGINE REST APIS
   =========================================================================== */

app.get('/api/admin/inventory', requireAuth, (req, res) => {
    // PART 2 Many-to-Many: every container reports ALL linked menu items from recipe_links
    const query = `
        SELECT i.*,
               (
                   SELECT GROUP_CONCAT(m.name, '||')
                   FROM recipe_links r
                   LEFT JOIN menu_items m ON m.id = r.menu_item_id
                   WHERE r.inventory_item_id = i.id
               ) as linked_menu_names,
               (SELECT COUNT(*) FROM recipe_links r WHERE r.inventory_item_id = i.id) as linked_menu_count
        FROM inventory_items i
        ORDER BY i.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formatted = rows.map(r => ({
            ...r,
            linked_menu_name: r.linked_menu_names || null,
            linked_menu_list: r.linked_menu_names ? r.linked_menu_names.split('||') : []
        }));
        res.json(formatted);
    });
});

app.post('/api/admin/inventory', requireAuth, requireNonStaff, (req, res) => {
    // PART 2: container registration is strictly name/unit/stock/threshold/cost —
    // menu linking happens afterwards via recipe_links (Quick Link / Smart Recipe Links)
    const { item_name, container_unit, stock_quantity, safety_threshold, item_cost } = req.body;
    const performer = getActiveUser(req);

    if (!item_name || !container_unit) {
        return res.status(400).json({ success: false, error: 'Container item name and unit type are required.' });
    }

    const qty = parseInt(stock_quantity, 10) || 0;
    const threshold = parseInt(safety_threshold, 10) || 5;
    const cost = parseFloat(item_cost) || 0.0;

    db.run(
        `INSERT INTO inventory_items (item_name, container_unit, stock_quantity, safety_threshold, item_cost) VALUES (?, ?, ?, ?, ?)`,
        [item_name, container_unit, qty, threshold, cost],
        function(err) {
            if (err) return res.status(400).json({ success: false, error: 'Inventory container item name already registered.' });

            logAudit('INVENTORY_ITEM_CREATED', `Registered bulk container '${item_name}' (${qty} ${container_unit}) [Unit Cost: ₱${cost.toFixed(2)}]`, performer);

            res.json({ success: true, id: this.lastID });
        }
    );
});

app.patch('/api/admin/inventory/:id', requireAuth, requireNonStaff, (req, res) => {
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

                    db.get(`SELECT item_name, stock_quantity FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
                        if (inv && inv.stock_quantity > 0) {
                            // Many-to-Many kill-switch release: re-activate every menu item linked to this container
                            db.run(`UPDATE menu_items SET is_available = 1 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [inventory_item_id]);
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

// PHASE 3 — SOFT AUDIT RECONCILIATION: non-scary, non-punitive reason codes for shelf
// counts that drifted slightly from the smart calculation. Separate from the strict
// Wastage Tab (which is for physically destroyed/never-sold stock only).
const AUDIT_VARIANCE_REASONS = {
    CUSTOMER_CUSTOMIZATION: 'Customer Customization / Extra Serving',
    HEAVY_POUR: 'Barista Heavy Pour / Shift Variance',
    STAFF_TASTING: 'Staff Tasting / Quality Check',
    SHRINKAGE: 'Unrecorded Loss / Shrinkage'
};

// PHASE 3 — TWO-TIER COUNTING PREVIEW: compare the staff's physical count of WHOLE
// UNOPENED containers against the system expectation. The currently open container
// is tracked digitally via usage_logs remainder and is NEVER physically counted or
// weighed — staff never touch grams/milliliters during audits.
// Call without actual_stock to get the expectation hint only (no discrepancy check).
app.post('/api/admin/inventory/audit/preview', requireAuth, requireNonStaff, (req, res) => {
    const { inventory_item_id, actual_stock } = req.body;

    if (!inventory_item_id) {
        return res.status(400).json({ success: false, error: 'Target container is required.' });
    }

    db.get(`SELECT id, item_name, stock_quantity, container_unit, item_cost FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
        if (!inv) return res.status(404).json({ success: false, error: 'Inventory container item not found.' });

        // Last persisted remainder = grams/ml sitting in the currently opened container
        db.get(`
            SELECT u.remainder, u.usage_unit
            FROM usage_logs u
            INNER JOIN (
                SELECT inventory_item_id, MAX(id) AS last_id FROM usage_logs GROUP BY inventory_item_id
            ) last ON last.last_id = u.id
            WHERE u.inventory_item_id = ?
        `, [inventory_item_id], (err2, opened) => {
            if (err2) return res.status(500).json({ success: false, error: err2.message });

            const systemExpected = Math.floor(inv.stock_quantity);
            const openedRemainder = opened ? Math.round(opened.remainder * 100) / 100 : 0;
            const openedUnit = opened ? (opened.usage_unit || inv.container_unit) : inv.container_unit;

            let variance = null, hasVariance = false, countedStock = null;
            if (actual_stock !== undefined && actual_stock !== null && actual_stock !== '') {
                countedStock = parseInt(actual_stock, 10) || 0;
                variance = countedStock - systemExpected;
                hasVariance = variance !== 0;
            }

            res.json({
                success: true,
                inventory_item_id: inv.id,
                item_name: inv.item_name,
                counting_policy: 'TWO_TIER',
                system_expected: systemExpected,
                opened_remainder: openedRemainder,
                opened_remainder_unit: openedUnit,
                counting_policy_text: `Count ONLY whole, unopened containers. The opened container still holds ${openedRemainder}${openedUnit} — tracked digitally, never weighed.`,
                counted_stock: countedStock,
                system_expected_unit: 'whole unopened container(s)',
                variance,
                has_variance: hasVariance
            });
        });
    });
});

app.post('/api/admin/inventory/audit', requireAuth, requireNonStaff, (req, res) => {
    const { inventory_item_id, shift_period, actual_stock, notes, reason_code } = req.body;
    const performer = getActiveUser(req);

    if (!inventory_item_id || actual_stock === undefined) {
        return res.status(400).json({ success: false, error: 'Target container and actual physical stock count are required.' });
    }

    // PHASE 3: a reason code = Soft Reconcile & Reset path. Reject unknown codes so bad
    // clients can never silently fall back into legacy false-wastage logging.
    if (reason_code !== undefined && reason_code !== null && reason_code !== '' && !AUDIT_VARIANCE_REASONS[reason_code]) {
        return res.status(400).json({
            success: false,
            error: `Invalid variance reason code '${reason_code}'. Valid: ${Object.keys(AUDIT_VARIANCE_REASONS).join(', ')}.`
        });
    }

    const newStockQty = Math.max(0, parseInt(actual_stock, 10) || 0);

    db.get(`SELECT item_name, stock_quantity, item_cost FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
        if (!inv) return res.status(404).json({ success: false, error: 'Inventory container item not found.' });

        const variance = newStockQty - inv.stock_quantity;

        // PHASE 3 SOFT RECONCILIATION: chose a variance reason code → this is operational
        // variance, NOT wastage. Stock is silently updated to match shelf reality and the
        // variance is logged for managerial transparency. NO wastage_logs entry, NO
        // financial punishment — operations keep flowing smoothly without barista stress.
        if (reason_code) {
            const reasonLabel = AUDIT_VARIANCE_REASONS[reason_code];
            db.run(
                `UPDATE inventory_items SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newStockQty, inventory_item_id],
                function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });

                    if (newStockQty <= 0) {
                        // Many-to-Many kill-switch: reality check that it is truly gone
                        db.run(`UPDATE menu_items SET is_available = 0 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [inventory_item_id]);
                        touchMenuUpdateTimestamp();
                        logAudit('MENU_KILL_SWITCH', `Automated kill-switch toggled ALL linked menu items OFF due to ZERO inventory of '${inv.item_name}'`, 'System Guard');
                    }

                    if (variance !== 0) {
                        db.run(
                            `INSERT INTO audit_variances (inventory_item_id, item_name, shift_period, system_expected, physical_count, variance, reason_code, notes, logged_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [inventory_item_id, inv.item_name, shift_period || 'Closing', inv.stock_quantity, newStockQty, variance, reason_code, notes || null, performer]
                        );
                        logAudit('EVENING_AUDIT_VARIANCE', `Soft Reconcile (${shift_period || 'Closing'}): '${inv.item_name}' system ${inv.stock_quantity} vs physical ${newStockQty} (Variance: ${variance >= 0 ? '+' : ''}${variance}) → Reason: ${reasonLabel}. Base inventory silently reset to match reality. No wastage logged. Notes: ${notes || 'None'}`, performer);
                    } else {
                        logAudit('EVENING_AUDIT', `Shift Audit (${shift_period || 'Closing'}): '${inv.item_name}' physical count matches system (${newStockQty}). Clean closure. Notes: ${notes || 'None'}`, performer);
                    }

                    res.json({ success: true, variance, reconciled: true, reason_code, reason_label: reasonLabel, financial_loss: 0 });
                }
            );
            return;
        }

        // LEGACY PATH (kept for backwards compatibility when no reason code is supplied):
        // plain audit save — negative variance still books EVENING_AUDIT_STOCKOUT wastage.
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

                if (newStockQty <= 0) {
                    // Many-to-Many kill-switch: disable every menu item linked to this container
                    db.run(`UPDATE menu_items SET is_available = 0 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [inventory_item_id]);
                    touchMenuUpdateTimestamp();
                    logAudit('MENU_KILL_SWITCH', `Automated kill-switch toggled ALL linked menu items OFF due to ZERO inventory of '${inv.item_name}'`, 'System Guard');
                }

                logAudit('EVENING_AUDIT', `Shift Audit (${shift_period || 'Closing'}): Reset '${inv.item_name}' stock from ${inv.stock_quantity} to ${newStockQty} (Variance: ${variance >= 0 ? '+' : ''}${variance}). Financial Loss: ₱${financialLoss.toFixed(2)}. Notes: ${notes || 'None'}`, performer);

                res.json({ success: true, variance, financial_loss: financialLoss });
            }
        );
    });
});

app.post('/api/inventory/waste', requireAuth, requireNonStaff, (req, res) => {
    const { inventory_item_id, quantity_lost, reason_code, reporter, notes } = req.body;
    const performer = getActiveUser(req);

    if (!inventory_item_id || !quantity_lost || !reason_code) {
        return res.status(400).json({ success: false, error: 'Container item, quantity lost, and reason code are required.' });
    }

    const qtyLost = parseInt(quantity_lost, 10) || 0;

    db.get(`SELECT item_name, stock_quantity, item_cost FROM inventory_items WHERE id = ?`, [inventory_item_id], (err, inv) => {
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

                        if (updatedQty <= 0) {
                            // Many-to-Many kill-switch: disable every menu item linked to this container
                            db.run(`UPDATE menu_items SET is_available = 0 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [inventory_item_id]);
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

app.post('/api/admin/inventory/pos-sync', requireAuth, requireNonStaff, (req, res) => {
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

app.post('/api/admin/inventory/close-shift', requireAuth, requireNonStaff, (req, res) => {
    const { shift_date, total_sales_amount, discount_amount, items_sold } = req.body;
    const performer = getActiveUser(req);

    if (!shift_date || total_sales_amount === undefined) {
        return res.status(400).json({ success: false, error: 'Shift date and total sales amount are required.' });
    }

    const salesAmount = parseFloat(total_sales_amount) || 0.0;
    const discAmount = parseFloat(discount_amount) || 0.0;
    const items = Array.isArray(items_sold) ? items_sold : [];

    // PART 2: legacy single-link stock deduction removed. Financial shift records are saved here;
    // inventory usage deductions are handled transactionally by the unified smart closeout engine.
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
    const { start_date, end_date, date, supplier } = req.query;
    let query = `
        SELECT s.*, i.item_name
        FROM stock_shipments s
        LEFT JOIN inventory_items i ON s.inventory_item_id = i.id
        WHERE 1=1
    `;
    const params = [];

    // `date` is an exact-day filter (used by the Daily Master Audit Ticket) so the
    // ticket only sums shipments RECEIVED on the audited shift — never all history.
    if (date) {
        query += ` AND DATE(s.timestamp) = DATE(?)`;
        params.push(date);
    }
    if (start_date) {
        query += ` AND DATE(s.timestamp) >= DATE(?)`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND DATE(s.timestamp) <= DATE(?)`;
        params.push(end_date);
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

// PHASE 3: Variance ledger for managerial transparency — soft reconciliation history
// (never merged into wastage; operational variance is deliberately NOT financial loss).
app.get('/api/admin/inventory/audit-variances', requireAuth, (req, res) => {
    const { start_date, end_date } = req.query;

    let query = `
        SELECT v.id, v.inventory_item_id, i.item_name, v.shift_period,
               v.system_expected, v.physical_count, v.variance, v.reason_code, v.notes, v.logged_by, v.timestamp
        FROM audit_variances v
        LEFT JOIN inventory_items i ON i.id = v.inventory_item_id
        WHERE 1=1
    `;
    const params = [];

    if (start_date) {
        query += ` AND DATE(v.timestamp) >= DATE(?)`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND DATE(v.timestamp) <= DATE(?)`;
        params.push(end_date);
    }
    query += ` ORDER BY v.timestamp DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const formatted = rows.map(v => ({
            id: `V-${v.id}`,
            movement_type: 'VARIANCE',
            item_name: v.item_name || 'Unknown Container',
            shift_period: v.shift_period,
            quantity_display: `${v.variance >= 0 ? '+' : ''}${v.variance} units (system ${v.system_expected} vs physical ${v.physical_count})`,
            quantity_val: v.variance,
            reason_code: v.reason_code,
            reason_label: AUDIT_VARIANCE_REASONS[v.reason_code] || v.reason_code,
            unit_cost: 0,
            financial_loss: 0,
            notes: v.notes || '',
            logged_by: v.logged_by,
            timestamp: v.timestamp
        }));

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

app.post('/api/admin/menu', requireAuth, requireNonStaff, upload.single('image'), (req, res) => {
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

app.patch('/api/admin/menu/:id/toggle', requireAuth, requireNonStaff, (req, res) => {
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

app.patch('/api/admin/menu/:id/priority', requireAuth, requireNonStaff, (req, res) => {
    const itemId = req.params.id;
    const { priority_rank } = req.body;
    const performer = getActiveUser(req);
    const rankVal = parseInt(priority_rank, 10) || 0;

    db.run(`UPDATE menu_items SET priority_rank = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [rankVal, itemId], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        touchMenuUpdateTimestamp();
        logAudit('MENU_PRIORITY_UPDATE', `Updated priority rank for menu item [ID: ${itemId}] to ${rankVal}`, performer);
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

app.post('/api/admin/hero-slides', requireAuth, requireNonStaff, upload.single('image'), (req, res) => {
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

app.delete('/api/admin/hero-slides/:id', requireAuth, requireNonStaff, (req, res) => {
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

app.post('/api/admin/settings', requireAuth, requireNonStaff, (req, res) => {
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
   11.5 SMART INVENTORY TRACKER (Ultra Smart Inventory — additive only)
   Keeps everything additive: existing tables & endpoints are untouched.
   =========================================================================== */

// Bulk container cards: each container + every menu item consuming it + remainders
app.get('/api/admin/inventory/container-cards', requireAuth, (req, res) => {
    db.all(`
        SELECT i.id, i.item_name, i.container_unit, i.stock_quantity, i.safety_threshold, i.item_cost,
               r.id as recipe_id, r.menu_item_id, r.usage_amount, r.usage_unit, r.container_quantity,
               m.name as menu_item_name
        FROM inventory_items i
        LEFT JOIN recipe_links r ON r.inventory_item_id = i.id
        LEFT JOIN menu_items m ON m.id = r.menu_item_id
        ORDER BY i.item_name ASC, m.name ASC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

        // last persisted remainder (grams/ml sitting in the currently opened container)
        db.all(`
            SELECT u.inventory_item_id, u.remainder, u.usage_unit
            FROM usage_logs u
            INNER JOIN (
                SELECT inventory_item_id, MAX(id) AS last_id
                FROM usage_logs
                GROUP BY inventory_item_id
            ) last ON last.last_id = u.id
        `, [], (err2, remainders) => {
            if (err2) return res.status(500).json({ success: false, error: err2.message });
            const lastRemainder = {};
            remainders.forEach(r => { lastRemainder[r.inventory_item_id] = r; });

            const cards = [];
            const byId = {};
            rows.forEach(row => {
                if (!byId[row.id]) {
                    const shownRemainder = lastRemainder[row.id] || null;
                    byId[row.id] = {
                        inventory_item_id: row.id,
                        item_name: row.item_name,
                        container_unit: row.container_unit,
                        stock_quantity: row.stock_quantity,
                        safety_threshold: row.safety_threshold,
                        item_cost: row.item_cost,
                        open_container_remaining: shownRemainder ? shownRemainder.remainder : null,
                        open_container_unit: shownRemainder ? shownRemainder.usage_unit : row.container_unit,
                        menu_items: []
                    };
                    cards.push(byId[row.id]);
                }
                if (row.recipe_id) {
                    byId[row.id].menu_items.push({
                        recipe_id: row.recipe_id,
                        menu_item_id: row.menu_item_id,
                        menu_item_name: row.menu_item_name,
                        usage_per_serving: row.usage_amount,
                        usage_unit: row.usage_unit,
                        container_quantity: row.container_quantity
                    });
                }
            });
            res.json(cards);
        });
    });
});

// Recipe links for one menu item (what bulk containers it consumes)
app.get('/api/admin/recipes/:menuItemId', requireAuth, requireNonStaff, (req, res) => {
    const menuId = parseInt(req.params.menuItemId, 10);
    db.all(`
        SELECT r.*, i.item_name, i.container_unit
        FROM recipe_links r
        LEFT JOIN inventory_items i ON r.inventory_item_id = i.id
        WHERE r.menu_item_id = ?
        ORDER BY r.id ASC
    `, [menuId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});

// All menu items (for the EOD sold-entry dropdowns)
app.get('/api/admin/menu', requireAuth, (req, res) => {
    db.all(`SELECT id, name, category, price, is_available, display_order FROM menu_items ORDER BY display_order ASC, id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});

// Create or update a recipe link (menu item -> container, usage per serving)
app.post('/api/admin/recipes', requireAuth, requireNonStaff, (req, res) => {
    const { menu_item_id, inventory_item_id, usage_amount, usage_unit, container_quantity } = req.body;
    const performer = getActiveUser(req);

    const menuId = parseInt(menu_item_id, 10);
    const invId = parseInt(inventory_item_id, 10);
    const perServing = parseFloat(usage_amount);
    const containerQty = parseFloat(container_quantity);

    if (!menuId || !invId || !(perServing > 0) || !(containerQty > 0)) {
        return res.status(400).json({ success: false, error: 'menu_item_id, inventory_item_id, usage_amount and container_quantity (all > 0) are required.' });
    }
    // Usage units: grams / milliliters (weighed goods) and pieces (supplier-made goods
    // like whole bread — staff count whole sealed packs; opened ones run digitally).
    const unitRaw = String(usage_unit || 'g').toLowerCase();
    const unit = ['g', 'ml', 'pcs'].includes(unitRaw) ? unitRaw : 'g';

    db.run(`
        INSERT INTO recipe_links (menu_item_id, inventory_item_id, usage_amount, usage_unit, container_quantity)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(menu_item_id, inventory_item_id) DO UPDATE SET
            usage_amount = excluded.usage_amount,
            usage_unit = excluded.usage_unit,
            container_quantity = excluded.container_quantity
    `, [menuId, invId, perServing, unit, containerQty], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        logAudit('SMART_RECIPE_LINK', `Linked menu item [ID: ${menuId}] to bulk container [ID: ${invId}] — ${perServing}${unit} per serving, ${containerQty}${unit} per container.`, performer);
        res.json({ success: true });
    });
});

// Remove a recipe link
app.delete('/api/admin/recipes/:id', requireAuth, requireNonStaff, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const performer = getActiveUser(req);
    db.run(`DELETE FROM recipe_links WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (this.changes === 0) return res.status(404).json({ success: false, error: 'Recipe link not found.' });
        logAudit('SMART_RECIPE_UNLINK', `Removed recipe link [ID: ${id}].`, performer);
        res.json({ success: true });
    });
});

/* ===========================================================================
   11.75 SMART EOD COMPUTATION ENGINE (Part 2 unified closeout)
   =========================================================================== */

// SHARED COMPUTE HELPER: sold menu items -> per-container usage + whole-container
// deductions + remainder carry-over. Pure computation, performs no writes.
// Callback receives: { containers: [...], warnings: [...] }
function computeSmartLedger(soldItems, cb) {
    const soldMap = {};
    soldItems.forEach(i => {
        const id = parseInt(i.menu_item_id, 10);
        const qty = parseInt(i.quantity_sold, 10) || 0;
        if (id) soldMap[id] = (soldMap[id] || 0) + qty;
    });
    const menuIds = Object.keys(soldMap).map(Number);
    if (!menuIds.length) {
        return cb(new Error('No valid menu_item_id provided.'));
    }

    const placeholders = menuIds.map(() => '?').join(',');
    db.all(`
        SELECT r.menu_item_id, r.inventory_item_id, r.usage_amount, r.usage_unit, r.container_quantity,
               i.item_name, i.stock_quantity, m.name as menu_item_name
        FROM recipe_links r
        JOIN inventory_items i ON i.id = r.inventory_item_id
        LEFT JOIN menu_items m ON m.id = r.menu_item_id
        WHERE r.menu_item_id IN (${placeholders})
        ORDER BY r.inventory_item_id ASC
    `, menuIds, (err, links) => {
        if (err) return cb(err);

        // Warn for sold items with no recipe links (they are NOT deducted on confirm)
        const warnings = [];
        menuIds.forEach(mid => {
            if (!links.some(l => l.menu_item_id === mid)) {
                warnings.push({
                    menu_item_id: mid,
                    items_sold: soldMap[mid],
                    warning: 'NO_RECIPE_LINK',
                    message: 'This menu item has no Smart Inventory recipe link yet — it will NOT be deducted.'
                });
            }
        });

        // Last persisted remainder per container = grams/ml sitting in the currently opened container
        db.all(`
            SELECT u.inventory_item_id, u.remainder, u.usage_unit
            FROM usage_logs u
            INNER JOIN (
                SELECT inventory_item_id, MAX(id) AS last_id FROM usage_logs GROUP BY inventory_item_id
            ) last ON last.last_id = u.id
        `, [], (err2, remainderRows) => {
            if (err2) return cb(err2);
            const lastRemainder = {};
            remainderRows.forEach(r => { lastRemainder[r.inventory_item_id] = r; });

            const ledger = {};
            links.forEach(link => {
                const sold = soldMap[link.menu_item_id];
                if (!sold || sold <= 0) return;

                if (!ledger[link.inventory_item_id]) {
                    const prev = lastRemainder[link.inventory_item_id];
                    ledger[link.inventory_item_id] = {
                        inventory_item_id: link.inventory_item_id,
                        item_name: link.item_name,
                        container_unit: link.usage_unit,
                        stock_before: link.stock_quantity,
                        whole_containers: 0,
                        opened_before: 0,
                        remainder: prev ? prev.remainder : 0,
                        total_used: 0,
                        items_sold_total: 0,
                        serves_menu_items: [],
                        usage_unit: link.usage_unit
                    };
                }
                const c = ledger[link.inventory_item_id];

                const perServing = parseFloat(link.usage_amount);
                const containerQty = parseFloat(link.container_quantity);
                const usedThisLink = sold * perServing;
                const openedBefore = c.remainder;

                let netNeeded = usedThisLink - openedBefore;
                let wholeUsed = 0;
                let newRemainder = 0;

                if (netNeeded <= 0) {
                    // Opening remainder is enough to cover the sales usage
                    wholeUsed = 0;
                    newRemainder = openedBefore - usedThisLink;
                } else {
                    // Sales exceed the opening remainder; open whole containers from stock
                    wholeUsed = containerQty > 0 ? Math.ceil(netNeeded / containerQty) : 0;
                    let totalAvailable = openedBefore + (wholeUsed * containerQty);
                    newRemainder = totalAvailable - usedThisLink;
                }

                if (wholeUsed > Math.floor(c.stock_before)) {
                    c.warning = c.warning || 'STOCK_OVERFLOW';
                    c.message = c.message || `Usage exceeds stock: needs ${wholeUsed} whole container(s) of ${link.item_name}, only ${Math.floor(c.stock_before)} in stock. Stock will not go below zero.`;
                    wholeUsed = Math.max(0, Math.floor(c.stock_before));
                }

                c.whole_containers += wholeUsed;
                c.stock_after = c.stock_before - c.whole_containers;
                c.remainder = newRemainder;
                c.opened_before = openedBefore;
                c.total_used += usedThisLink;
                c.items_sold_total += sold;
                c.usage_unit = link.usage_unit;
                c.container_quantity = containerQty;
                c.serves_menu_items.push(`${link.menu_item_name || ('Menu #' + link.menu_item_id)} x${sold}`);
            });

            const containerResults = Object.values(ledger).map(c => ({
                inventory_item_id: c.inventory_item_id,
                item_name: c.item_name,
                menu_items_summary: c.serves_menu_items.join(', '),
                usage_unit: c.usage_unit,
                items_sold: c.items_sold_total,
                total_used: Math.round(c.total_used * 100) / 100,
                container_quantity: c.container_quantity,
                whole_containers: c.whole_containers,
                opened_before: Math.round(c.opened_before * 100) / 100,
                remainder: Math.round(c.remainder * 100) / 100,
                remaining_text: c.container_quantity > 0
                    ? `${c.whole_containers} whole container(s) used — ${Math.round(c.remainder * 100) / 100}${c.usage_unit} of the opened container left`
                    : `${Math.round(c.remainder * 100) / 100}${c.usage_unit} left`,
                stock_before: c.stock_before,
                stock_after: c.stock_after,
                warning: c.warning || null,
                message: c.message || null
            }));

            cb(null, { containers: containerResults, warnings });
        });
    });
}

// Legacy granular endpoint kept for backwards compatibility (preview + raw apply)
app.post('/api/admin/inventory/calc-shift-usage', requireAuth, requireNonStaff, (req, res) => {
    const { shift_date } = req.body;
    const isPreview = req.body.preview === true || req.body.preview === 'true';
    const performer = getActiveUser(req);
    const soldItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (!soldItems.length) {
        return res.status(400).json({ success: false, error: 'items_sold list is required.' });
    }

    computeSmartLedger(soldItems, (err, { containers: containerResults, warnings }) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

            if (isPreview) {
                return res.json({ success: true, preview: true, shift_date: shift_date || null, containers: containerResults, warnings });
            }

            // COMMIT — transaction so math can never be half-applied
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                let commitError = null;
                let doneCount = 0;
                const totalSteps = containerResults.reduce((n, c) => n + (c.whole_containers > 0 ? 2 : 1), 0);
                if (totalSteps === 0) {
                    db.run('ROLLBACK');
                    return res.json({ success: true, applied: true, containers: containerResults, warnings, note: 'Nothing to deduct.' });
                }

                containerResults.forEach(c => {
                    if (c.whole_containers > 0) {
                        db.run(
                            `UPDATE inventory_items SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                            [c.whole_containers, c.inventory_item_id],
                            (err) => {
                                if (err && !commitError) commitError = err.message;
                                if (!err && c.stock_after <= 0) {
                                    db.run(`UPDATE menu_items SET is_available = 0 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [c.inventory_item_id], () => {
                                        touchMenuUpdateTimestamp();
                                        logAudit('MENU_KILL_SWITCH', `Smart Inventory: bulk container [ID: ${c.inventory_item_id}] reached zero — linked menu items auto-disabled.`, 'Smart Tracker');
                                    });
                                }
                            }
                        );
                    }
                    db.run(`
                        INSERT INTO usage_logs
                            (inventory_item_id, menu_items_summary, items_sold, total_used, whole_containers, remainder, opened_before, usage_unit, calculation_date, logged_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        c.inventory_item_id,
                        c.menu_items_summary,
                        c.items_sold,
                        c.total_used,
                        c.whole_containers,
                        c.remainder,
                        c.opened_before,
                        c.usage_unit,
                        shift_date || new Date().toISOString().slice(0, 10),
                        performer
                    ], (err) => {
                        if (err && !commitError) commitError = err.message;
                        doneCount += 1;
                    });
                });

                // wait for all writes before committing the transaction
                const waiter = setInterval(() => {
                    if (doneCount >= containerResults.length) {
                        clearInterval(waiter);
                        if (commitError) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ success: false, error: commitError });
                        }
                        db.run('COMMIT', (err) => {
                            if (err) return res.status(500).json({ success: false, error: err.message });
                            logAudit('SMART_SHIFT_USAGE', `Smart Inventory EOD calculation applied for ${shift_date || 'today'}: ${containerResults.length} containers, ${soldItems.length} menu lines.`, performer);
                            res.json({ success: true, applied: true, containers: containerResults, warnings });
                        });
                    }
                }, 25);
            });
    });
});

// UNIFIED END-OF-DAY CLOSEOUT (Part 2): ONE transaction saves everything —
// shift financial record, itemized sales, container stock deductions, usage_logs
// remainder rollovers, and Many-to-Many kill-switches. preview=true returns the
// exact same breakdown without touching a single row.
// Body: { shift_date, total_sales_amount, discount_amount, items: [{menu_item_id, quantity_sold}], preview }
app.post('/api/admin/inventory/unified-closeout', requireAuth, requireNonStaff, (req, res) => {
    const { shift_date } = req.body;
    const isPreview = req.body.preview === true || req.body.preview === 'true';
    const performer = getActiveUser(req);
    const soldItems = Array.isArray(req.body.items) ? req.body.items : [];
    const hasFinancials = req.body.total_sales_amount !== undefined;
    const salesAmount = parseFloat(req.body.total_sales_amount) || 0.0;
    const discAmount = parseFloat(req.body.discount_amount) || 0.0;

    if (!shift_date) {
        return res.status(400).json({ success: false, error: 'Shift date is required.' });
    }
    if (hasFinancials && salesAmount < 0) {
        return res.status(400).json({ success: false, error: 'Total POS sales cannot be negative.' });
    }
    if (!soldItems.length) {
        return res.status(400).json({ success: false, error: 'Enter at least one item sold for this shift.' });
    }
    const grossFromItems = soldItems.reduce((sum, i) => sum + ((parseInt(i.quantity_sold, 10) || 0) * (parseFloat(i.unit_price) || 0)), 0);
    const netSales = Math.max(0, (hasFinancials ? salesAmount : grossFromItems) - discAmount);

    computeSmartLedger(soldItems, (err, { containers: containerResults, warnings }) => {
        if (err) return res.status(500).json({ success: false, error: err.message });

        if (isPreview) {
            return res.json({
                success: true,
                preview: true,
                shift_date,
                containers: containerResults,
                warnings,
                financials: {
                    has_input: hasFinancials,
                    pos_sales: hasFinancials ? salesAmount : null,
                    gross_from_items: Math.round(grossFromItems * 100) / 100,
                    discounts: discAmount,
                    net_sales: Math.round(netSales * 100) / 100
                }
            });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            let txError = null;

            // Ordered queue of write steps — every step must succeed or the ENTIRE
            // closeout (financial log + itemized sales + deductions + remainders) rolls back.
            const steps = [];

            // Step 1: shift closeout financial record + itemized sales ledger
            steps.push((done) => {
                db.run(
                    `INSERT INTO shift_closeouts (shift_date, total_sales_amount, discount_amount, logged_by) VALUES (?, ?, ?, ?)`,
                    [shift_date, salesAmount, discAmount, performer],
                    function (err) {
                        if (err) { txError = txError || err.message; return done(); }
                        const closeoutId = this.lastID;
                        const stmt = db.prepare(`INSERT INTO shift_closeout_items (closeout_id, menu_item_id, quantity_sold) VALUES (?, ?, ?)`);
                        soldItems.forEach(item => {
                            const menuId = parseInt(item.menu_item_id, 10);
                            const qty = parseInt(item.quantity_sold, 10) || 0;
                            if (menuId && qty > 0) stmt.run(closeoutId, menuId, qty);
                        });
                        stmt.finalize();
                        done();
                    }
                );
            });

            // Step 2+: per-container stock deduction + usage log (remainder rollover) + Many-to-Many kill-switch
            containerResults.forEach(c => {
                steps.push((done) => {
                    const writeUsageLog = () => {
                        db.run(`
                            INSERT INTO usage_logs
                                (inventory_item_id, menu_items_summary, items_sold, total_used, whole_containers, remainder, opened_before, usage_unit, calculation_date, logged_by)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            c.inventory_item_id,
                            c.menu_items_summary,
                            c.items_sold,
                            c.total_used,
                            c.whole_containers,
                            c.remainder,
                            c.opened_before,
                            c.usage_unit,
                            shift_date,
                            performer
                        ], (err) => {
                            if (err) txError = txError || err.message;
                            done();
                        });
                    };

                    if (c.whole_containers > 0) {
                        db.run(
                            `UPDATE inventory_items SET stock_quantity = MAX(0, stock_quantity - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                            [c.whole_containers, c.inventory_item_id],
                            (err) => {
                                if (err) { txError = txError || err.message; return done(); }
                                db.get(`SELECT stock_quantity FROM inventory_items WHERE id = ?`, [c.inventory_item_id], (err2, row) => {
                                    if (err2) { txError = txError || err2.message; return done(); }
                                    if (row && row.stock_quantity <= 0) {
                                        db.run(`UPDATE menu_items SET is_available = 0 WHERE id IN (SELECT DISTINCT menu_item_id FROM recipe_links WHERE inventory_item_id = ?)`, [c.inventory_item_id], () => {
                                            touchMenuUpdateTimestamp();
                                            logAudit('MENU_KILL_SWITCH', `Unified EOD closeout: bulk container '${c.item_name}' [ID: ${c.inventory_item_id}] reached zero — all linked menu items auto-disabled.`, performer);
                                            writeUsageLog();
                                        });
                                    } else {
                                        writeUsageLog();
                                    }
                                });
                            }
                        );
                    } else {
                        writeUsageLog();
                    }
                });
            });

            let idx = 0;
            const nextStep = () => {
                if (txError) {
                    db.run('ROLLBACK', () => res.status(500).json({ success: false, error: txError }));
                    return;
                }
                if (idx >= steps.length) {
                    db.run('COMMIT', (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ success: false, error: err.message });
                        }
                        logAudit('UNIFIED_EOD_CLOSEOUT', `Unified EOD Closeout for ${shift_date}: Sales ₱${salesAmount.toFixed(2)} (Disc ₱${discAmount.toFixed(2)}, Net ₱${netSales.toFixed(2)}), ${soldItems.length} menu lines, ${containerResults.length} containers deducted.`, performer);
                        res.json({
                            success: true,
                            applied: true,
                            closeout_saved: true,
                            shift_date,
                            containers: containerResults,
                            warnings,
                            financials: {
                                pos_sales: salesAmount,
                                discounts: discAmount,
                                net_sales: Math.round(netSales * 100) / 100
                            }
                        });
                    });
                    return;
                }
                steps[idx++](nextStep);
            };
            nextStep();
        });
    });
});

/* ===========================================================================
   12. AUDIT LOGS REST API
   =========================================================================== */
app.get('/api/admin/audit-logs', requireAuth, requireAdminOrAbove, (req, res) => {
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
setInterval(autoAnonymizeExpiredPII, 24 * 60 * 60 * 1000);

app.post('/api/admin/menu/:id/reorder', requireAuth, requireNonStaff, (req, res) => {
    const itemId = req.params.id;
    const { direction } = req.body;
    const performer = getActiveUser(req);

    db.get(`SELECT id, display_order FROM menu_items WHERE id = ?`, [itemId], (err, current) => {
        if (!current) return res.status(404).json({ success: false, error: 'Menu item not found.' });

        const currentOrder = current.display_order || 0;
        const targetQuery = direction === 'up'
            ? `SELECT id, display_order FROM menu_items WHERE display_order < ? ORDER BY display_order DESC LIMIT 1`
            : `SELECT id, display_order FROM menu_items WHERE display_order > ? ORDER BY display_order ASC LIMIT 1`;

        db.get(targetQuery, [currentOrder], (err, neighbor) => {
            if (neighbor) {
                db.serialize(() => {
                    db.run(`UPDATE menu_items SET display_order = ? WHERE id = ?`, [neighbor.display_order, current.id]);
                    db.run(`UPDATE menu_items SET display_order = ? WHERE id = ?`, [current.display_order, neighbor.id]);
                    touchMenuUpdateTimestamp();
                    logAudit('MENU_REORDER', `Reordered menu item ID ${itemId} ${direction}`, performer);
                    res.json({ success: true });
                });
            } else {
                res.json({ success: true, message: 'Already at boundary limit.' });
            }
        });
    });
});

app.post('/api/admin/hero-slides/:id/reorder', requireAuth, requireNonStaff, (req, res) => {
    const slideId = req.params.id;
    const { direction } = req.body;
    const performer = getActiveUser(req);

    db.get(`SELECT id, display_order FROM hero_slides WHERE id = ?`, [slideId], (err, current) => {
        if (!current) return res.status(404).json({ success: false, error: 'Slide not found.' });

        const currentOrder = current.display_order || 0;
        const targetQuery = direction === 'up'
            ? `SELECT id, display_order FROM hero_slides WHERE display_order < ? ORDER BY display_order DESC LIMIT 1`
            : `SELECT id, display_order FROM hero_slides WHERE display_order > ? ORDER BY display_order ASC LIMIT 1`;

        db.get(targetQuery, [currentOrder], (err, neighbor) => {
            if (neighbor) {
                db.serialize(() => {
                    db.run(`UPDATE hero_slides SET display_order = ? WHERE id = ?`, [neighbor.display_order, current.id]);
                    db.run(`UPDATE hero_slides SET display_order = ? WHERE id = ?`, [current.display_order, neighbor.id]);
                    logAudit('HERO_REORDER', `Reordered hero slide ID ${slideId} ${direction}`, performer);
                    res.json({ success: true });
                });
            } else {
                res.json({ success: true });
            }
        });
    });
});

/* ===========================================================================
   13. SERVER INIT & LISTENER
   =========================================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Cafe de Melle Application Engine running on port ${PORT}`);
    console.log(`🌐 Local Access: http://localhost:${PORT}`);
    console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin`);
});