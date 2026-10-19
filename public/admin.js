// admin.js - Executive Manager Portal Front-End Controller

let currentUser = null;
let allMenuItems = [];
let allAuditLogs = [];
let currentAuditFilter = 'ALL';
let currentEodCategoryFilter = 'All';
let currentMenuCategoryFilter = 'All';

// Global state preservation for security re-authentication guardrail
let pendingActionCallback = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAdminSession();
    setCurrentDate();
    initEodFormDate();

    // 🔄 AUTOMATIC BACKGROUND POLLING (Every 10 seconds)
    setInterval(() => {
        // Only refresh if the user is logged in and active
        if (currentUser) {
            loadDashboardData();
            
            // If viewing active vouchers tab, refresh it
            const activeVouchersPane = document.getElementById('promo-subtab-active');
            if (activeVouchersPane && activeVouchersPane.style.display !== 'none') {
                loadActiveVouchers();
            }

            // If viewing inventory, refresh it
            const inventoryPane = document.getElementById('tab-inventory');
            if (inventoryPane && inventoryPane.style.display !== 'none') {
                loadInventoryItems();
            }
        }
    }, 10000); // 10000 ms = 10 seconds
});

function filterMenuCatalogCategory(cat, btn) {
    currentMenuCategoryFilter = cat;
    const pills = document.querySelectorAll('#menu-catalog-category-pills .btn-filter-pill');
    pills.forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    filterAndSortMenuCatalog();
}

function filterAndSortMenuCatalog() {
    const searchInput = document.getElementById('menu-catalog-search');
    const sortSelect = document.getElementById('menu-catalog-sort');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const sortBy = sortSelect ? sortSelect.value : 'views';

    let filtered = [...allMenuItems];

   if (currentMenuCategoryFilter !== 'All') {
        const filterCat = currentMenuCategoryFilter.toLowerCase().trim();
        filtered = filtered.filter(item => {
            const itemCat = (item.category || '').toLowerCase().trim();
            if (filterCat === 'iced coffee' || filterCat === 'cold coffee') {
                return itemCat.includes('iced') || itemCat.includes('cold');
            }
            if (filterCat === 'hot coffee') {
                return itemCat.includes('hot');
            }
            if (filterCat === 'non-coffee' || filterCat === 'non coffee') {
                return itemCat.includes('non');
            }
            if (filterCat === 'pastries' || filterCat === 'pastry') {
                return itemCat.includes('pastr');
            }
            if (filterCat === 'fruit sodas' || filterCat === 'soda') {
                return itemCat.includes('soda') || itemCat.includes('fruit');
            }
            return itemCat === filterCat || itemCat.includes(filterCat);
        });
    }

    if (query) {
        filtered = filtered.filter(item => item.name.toLowerCase().includes(query) || (item.description && item.description.toLowerCase().includes(query)));
    }

    if (sortBy === 'views') {
        filtered.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    } else if (sortBy === 'alpha') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'price-asc') {
        filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
    }

    renderMenuTable(filtered);
}

function initEodFormDate() {
    const eodDateInput = document.getElementById('shift-close-date');
    if (eodDateInput) {
        const today = new Date().toISOString().split('T')[0];
        eodDateInput.value = today;
    }
}

function onEodDateChanged() {
    updateEodLiveTally();
}

function checkAdminSession() {
    fetch('/api/admin/me')
        .then(res => {
            if (!res.ok) throw new Error('Not authenticated');
            return res.json();
        })
        .then(data => {
            currentUser = data;

            // Role-aware UI hiding for Staff vs Admin/Owner/Developer
            const userRole = data.role || 'Staff';
            const isAdminOrAbove = ['Admin', 'Owner', 'Developer'].includes(userRole);
            document.querySelectorAll('.admin-only, .danger-action-btn').forEach(el => {
                el.style.display = isAdminOrAbove ? (el.tagName === 'LI' ? 'flex' : 'inline-block') : 'none';
            });

            const badge = document.getElementById('active-user-badge');
            if (badge) {
                badge.textContent = `Logged in as: ${data.username} (${data.role})`;
            }
            const myUsernameInput = document.getElementById('my-username');
            if (myUsernameInput) {
                myUsernameInput.value = data.username;
            }

            const isOwnerOrDev = data.role === 'Owner' || data.role === 'Developer';
            const ownerDevElements = document.querySelectorAll('.owner-dev-only');
            ownerDevElements.forEach(el => {
                if (isOwnerOrDev) {
                    el.style.display = el.tagName === 'LI' ? 'flex' : 'block';
                } else {
                    el.style.display = 'none';
                }
            });

            // Role-aware rendering for executive metrics on the main dashboard
            const execFinancialRow = document.getElementById('executive-financial-matrix-row');
            if (execFinancialRow) {
                execFinancialRow.style.display = isOwnerOrDev ? 'grid' : 'none';
            }

            loadDashboardData();
            loadMenuItems();
            loadInventoryItems();
            loadHeroSlides();
            loadSettings();
            loadAuditLogs();
            loadSystemUsers();
            loadActiveVouchers();
            loadSupplierInvoices();
            loadWastageLogs();
            loadCloseoutHistory();
        })
        .catch(() => {
            window.location.href = '/login.html';
        });
}

function logoutAdmin() {
    fetch('/api/admin/logout', { method: 'POST' })
        .then(() => {
            window.location.href = '/login.html';
        });
}

function setCurrentDate() {
    const el = document.getElementById('current-date');
    if (el) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        el.textContent = new Date().toLocaleDateString(undefined, options);
    }
    const printTime = document.getElementById('print-timestamp');
    if (printTime) {
        printTime.textContent = new Date().toLocaleString();
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `<span>${message}</span><i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="this.parentElement.remove()"></i>`;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 4000);
}

function autoCapitalize(input) {
    if (!input || !input.value) return;
    input.value = input.value.replace(/\b\w/g, char => char.toUpperCase());
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open');
}

function switchTab(tabName, element) {
    const tabs = document.querySelectorAll('.tab-section');
    tabs.forEach(t => t.style.display = 'none');

    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.style.display = 'block';

    const menuItems = document.querySelectorAll('.sidebar-menu li');
    menuItems.forEach(item => item.classList.remove('active'));

    if (element) {
        element.classList.add('active');
    }

    const titles = {
        'dashboard': 'Operational Dashboard',
        'cashier': 'Cashier Promo Code Verification',
        'inventory': 'Inventory & Supply Command Center',
        'invoices': 'Operational Ledgers & Shipment History',
        'menu': 'Menu Catalog Management',
        'banners': 'Hero Banners & Visuals',
        'settings': 'Store Hours & Schedule',
        'audit': 'System Cryptographic Audit Logs',
        'account': 'Security, Credentials & Roles'
    };

    const titleEl = document.getElementById('tab-title');
    if (titleEl) titleEl.textContent = titles[tabName] || 'Executive Admin Portal';

    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
    if (overlay && overlay.classList.contains('open')) overlay.classList.remove('open');
}

function switchInventorySubTab(subName, btn) {
    // Target only inventory sub-panes to avoid breaking other tabs
    const panes = document.querySelectorAll('#tab-inventory .sub-tab-pane');
    panes.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });

    const btns = document.querySelectorAll('#tab-inventory .sub-tab-bar .sub-tab-btn');
    btns.forEach(b => b.classList.remove('active'));

    const pane = document.getElementById(`inv-subtab-${subName}`);
    if (pane) {
        pane.classList.add('active');
        pane.style.display = 'block'; // Force render
    }
    if (btn) btn.classList.add('active');
}

function switchLedgerSubTab(subName, btn) {
    const panes = document.querySelectorAll('.ledger-sub-pane');
    panes.forEach(p => p.style.display = 'none');

    const btns = document.querySelectorAll('#tab-invoices .sub-tab-btn');
    btns.forEach(b => b.classList.remove('active'));

    const pane = document.getElementById(`ledger-subtab-${subName}`);
    if (pane) pane.style.display = 'block';
    if (btn) btn.classList.add('active');

    if (subName === 'shipments') loadSupplierInvoices();
    else if (subName === 'spillage') loadWastageLogs();
    else if (subName === 'closeouts') loadCloseoutHistory();
}

function switchOpsForm(formType) {
    const forms = document.querySelectorAll('.ops-form-wrapper');
    forms.forEach(f => f.style.display = 'none');

    const pills = document.querySelectorAll('.ops-pill-group .btn-filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const target = document.getElementById(`ops-form-${formType}`);
    if (target) target.style.display = 'block';

    const activePill = document.getElementById(`btn-ops-${formType}`);
    if (activePill) activePill.classList.add('active');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ===========================================================================
   SECURITY RE-AUTHENTICATION MODAL GUARDRAIL ENGINE
   =========================================================================== */
function openSecurityModal(callback) {
    pendingActionCallback = callback;
    const modal = document.getElementById('security-confirm-modal');
    const passInput = document.getElementById('security-confirm-pass');
    const msgBox = document.getElementById('security-modal-msg');
    if (passInput) passInput.value = '';
    if (msgBox) {
        msgBox.style.display = 'none';
        msgBox.textContent = '';
    }
    if (modal) modal.classList.add('active');
    if (passInput) setTimeout(() => passInput.focus(), 100);
}

function closeSecurityModal() {
    pendingActionCallback = null;
    const modal = document.getElementById('security-confirm-modal');
    const passInput = document.getElementById('security-confirm-pass');
    const msgBox = document.getElementById('security-modal-msg');
    if (passInput) passInput.value = '';
    if (msgBox) msgBox.style.display = 'none';
    if (modal) modal.classList.remove('active');
}

function verifyAndExecutePendingAction() {
    const passInput = document.getElementById('security-confirm-pass');
    const msgBox = document.getElementById('security-modal-msg');
    if (!passInput) return;

    const password = passInput.value;
    if (!password) {
        if (msgBox) {
            msgBox.className = 'status-msg error';
            msgBox.textContent = 'Please enter your password.';
            msgBox.style.display = 'block';
        }
        return;
    }

    fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const callbackToExec = pendingActionCallback;
            closeSecurityModal();
            if (typeof callbackToExec === 'function') {
                callbackToExec();
            }
        } else {
            if (msgBox) {
                msgBox.className = 'status-msg error';
                msgBox.textContent = data.error || 'Invalid password. Action aborted.';
                msgBox.style.display = 'block';
            }
            showToast('Invalid password. Action aborted.', 'error');
        }
    })
    .catch(() => {
        if (msgBox) {
            msgBox.className = 'status-msg error';
            msgBox.textContent = 'Server connection error during password verification.';
            msgBox.style.display = 'block';
        }
    });
}

/* ===========================================================================
   1. DASHBOARD & CONCURRENT DATA FETCHING ENGINE
   =========================================================================== */
function loadDashboardData() {
    Promise.all([
        fetch('/api/admin/dashboard-kpis').then(res => res.json()),
        fetch('/api/menu').then(res => res.json()),
        fetch('/api/hero-slides').then(res => res.json()),
        fetch('/api/settings').then(res => res.json()),
        fetch('/api/admin/inventory').then(res => res.json()),
        fetch('/api/admin/audit-logs').then(res => res.json())
    ])
    .then(([data, items, slides, settings, inventoryItems, logs]) => {
        const sensorBadge = document.getElementById('commander-store-sensor-badge');
        if (sensorBadge) {
            const isManualOverride = settings.store_status && settings.store_status !== 'AUTO';
            if (isManualOverride) {
                sensorBadge.className = 'pulsing-health-badge override';
                sensorBadge.innerHTML = `<span class="pulse-dot"></span> MANUAL OVERRIDE: ${escapeHtml(settings.store_status)}`;
            } else {
                sensorBadge.className = 'pulsing-health-badge live';
                sensorBadge.innerHTML = `<span class="pulse-dot"></span> LIVE &amp; ACCEPTING ORDERS`;
            }
        }

        const exceptionLine = document.getElementById('commander-inventory-exception-line');
        const dashboardReorderList = document.getElementById('dashboard-reorder-checklist');
        if (inventoryItems) {
            const lowStock = inventoryItems.filter(i => i.stock_quantity <= i.safety_threshold);
            if (exceptionLine) {
                if (lowStock.length > 0) {
                    const itemNames = lowStock.map(i => `${escapeHtml(i.item_name)} (${i.stock_quantity} left)`).join(', ');
                    exceptionLine.className = 'inventory-exception-line alert';
                    exceptionLine.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Inventory Safety Alert:</strong> Low Stock Triggered on: ${itemNames}`;
                } else {
                    exceptionLine.className = 'inventory-exception-line stable';
                    exceptionLine.innerHTML = `<i class="fa-solid fa-circle-check"></i> All supply lines fully stable`;
                }
            }

            if (dashboardReorderList) {
                if (lowStock.length === 0) {
                    dashboardReorderList.innerHTML = '<div style="text-align:center; padding:20px; color: var(--primary); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> All bulk inventory containers are adequately stocked.</div>';
                } else {
                    dashboardReorderList.innerHTML = lowStock.map(i => `
                        <div class="reorder-item" style="display:flex; justify-content:space-between; align-items:center; padding: 10px;">
                            <div>
                                <strong>${escapeHtml(i.item_name)}</strong>
                                <div style="font-size:0.8rem; color:#666;">In Stock: <span style="color:var(--danger); font-weight:700;">${i.stock_quantity} ${escapeHtml(i.container_unit)}</span></div>
                            </div>
                            <button class="btn-action" style="padding: 5px 10px; font-size:0.8rem;" onclick="switchTab('inventory'); switchInventorySubTab('ops', document.getElementById('btn-subtab-ops')); switchOpsForm('stockin');">
                                <i class="fa-solid fa-plus"></i> Restock
                            </button>
                        </div>
                    `).join('');
                }
            }
        }

        const revPulse = document.getElementById('matrix-revenue-pulse');
        if (revPulse) revPulse.textContent = `₱${(data.revenueToday || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const promoCost = document.getElementById('matrix-promo-cost');
        if (promoCost) promoCost.textContent = `₱${(data.promoCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const moneyBleed = document.getElementById('matrix-money-bleed');
        if (moneyBleed) moneyBleed.textContent = `₱${(data.totalBleed || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        document.getElementById('kpi-total').textContent = data.total || 0;
        document.getElementById('kpi-active').textContent = data.active || 0;
        document.getElementById('kpi-out').textContent = data.outOfStock || 0;
        document.getElementById('kpi-vouchers-redeemed').textContent = data.activePromos || 0;
        document.getElementById('kpi-inventory-alerts').textContent = data.lowStockInventory || 0;

        allMenuItems = items || [];
        renderEodMenuGrid(allMenuItems);
        const popularContainer = document.getElementById('commander-popular-items');
        if (popularContainer) {
            const sorted = [...allMenuItems].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 3);
            const maxViews = sorted.length > 0 ? Math.max(...sorted.map(i => i.view_count || 1), 1) : 1;

            if (sorted.length === 0) {
                popularContainer.innerHTML = '<div style="color:#888; font-size:0.88rem; text-align:center; padding:15px;">No active menu analytics available.</div>';
            } else {
                popularContainer.innerHTML = sorted.map((item, idx) => {
                    const pct = Math.min(100, Math.round(((item.view_count || 0) / maxViews) * 100));
                    return `
                        <div class="popular-item-row">
                            <div class="popular-item-meta">
                                <span>#${idx + 1} ${escapeHtml(item.name)} (${escapeHtml(item.category)})</span>
                                <span>${item.view_count || 0} Views</span>
                            </div>
                            <div class="popular-progress-track">
                                <div class="popular-progress-bar" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        const previewContainer = document.getElementById('commander-hero-banner-preview');
        if (previewContainer) {
            if (slides && slides.length > 0) {
                const hero = slides[0];
                previewContainer.innerHTML = `
                    <div class="banner-preview-card">
                        <div class="banner-thumbnail-frame">
                            <img src="${hero.image ? escapeHtml(hero.image) : '/images/HeroBg.jpg'}" class="banner-thumbnail-img" alt="Hero Banner" onerror="this.src='/images/HeroBg.jpg'">
                        </div>
                        <div class="banner-content-body">
                            <span class="banner-tag-badge">${escapeHtml(hero.tag || 'PINNED HERO BANNER')}</span>
                            <div class="banner-hero-title">${escapeHtml(hero.title || 'Welcome to Cafe de Melle')}</div>
                            <div class="banner-hero-subtitle">${escapeHtml(hero.subtitle || 'Active Public Front Banner Message')}</div>
                        </div>
                    </div>
                `;
            } else {
                previewContainer.innerHTML = `
                    <div class="banner-preview-card">
                        <div class="banner-content-body" style="text-align:center; padding: 20px;">
                            <i class="fa-solid fa-image-slash" style="font-size:2rem; color:var(--secondary); margin-bottom:10px;"></i>
                            <div class="banner-hero-title" style="font-size:0.95rem;">No Active Banner Slides</div>
                            <div class="banner-hero-subtitle">Upload banners via Hero Banners tab.</div>
                        </div>
                    </div>
                `;
            }
        }

        allAuditLogs = logs || [];
        const feed = document.getElementById('dashboard-activity-feed');
        if (feed) {
            if (allAuditLogs.length === 0) {
                feed.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">No recent activity logs.</div>';
            } else {
                const recent = allAuditLogs.slice(0, 10);
                feed.innerHTML = recent.map(l => `
                    <div class="activity-item">
                        <div class="activity-meta">
                            <strong><i class="fa-solid fa-user-shield"></i> ${escapeHtml(l.performed_by || 'System')}</strong>
                            <span>${new Date(l.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="activity-details">
                            <strong>${escapeHtml(l.action)}</strong>: ${escapeHtml(l.details)}
                        </div>
                    </div>
                `).join('');
            }
        }

        const microTracker = document.getElementById('commander-micro-security-tracker');
        if (microTracker) {
            if (allAuditLogs.length === 0) {
                microTracker.innerHTML = '<div style="color:#888; font-size:0.88rem; text-align:center; padding:10px;">No audit entries recorded.</div>';
            } else {
                const top3 = allAuditLogs.slice(0, 3);
                microTracker.innerHTML = top3.map(l => {
                    let translatedAction = l.action;
                    if (l.action === 'MENU_ITEM_TOGGLE' || l.action === 'MENU_ITEM_CREATED') translatedAction = 'Manager Catalog Modification';
                    else if (l.action === 'STORE_SETTINGS_UPDATED') translatedAction = 'Manual Storefront Override Switch';
                    else if (l.action === 'PROMO_CODE_REDEEMED') translatedAction = 'Customer Promo Claim Event';
                    else if (l.action === 'USER_LOGIN' || l.action === 'USER_LOGOUT') translatedAction = 'Account Authentication Event';
                    else if (l.action === 'STOCK_IN' || l.action === 'STOCK_WASTAGE') translatedAction = 'Inventory Supply Shift';
                    else if (l.action === 'EOD_SHIFT_CLOSEOUT') translatedAction = 'Daily EOD Shift Closeout Logged';

                    return `
                        <div class="micro-tracker-row">
                            <div class="micro-tracker-main">
                                <div class="micro-tracker-action"><i class="fa-solid fa-shield"></i> ${escapeHtml(translatedAction)}</div>
                                <div class="micro-tracker-desc">${escapeHtml(l.details)}</div>
                            </div>
                            <div class="micro-tracker-meta">
                                <strong>${escapeHtml(l.performed_by || 'System')}</strong><br>
                                <small>${new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    })
    .catch(err => console.error('Dashboard concurrent data fetch error:', err));
}

/* ===========================================================================
   2. CASHIER PROMO CODE VERIFICATION
   =========================================================================== */
function loadActiveVouchers() {
    fetch('/api/admin/promo-codes/active')
        .then(res => res.json())
        .then(data => {
            const tableBody = document.getElementById('active-vouchers-table-body');
            if (!tableBody) return;
            if (!data || data.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888; padding:15px;">No active promo voucher codes currently claimed.</td></tr>';
                return;
            }
            tableBody.innerHTML = data.map(v => `
                <tr>
                    <td data-label="Voucher Code"><span class="code-badge">${escapeHtml(v.code)}</span></td>
                    <td data-label="Customer Name"><strong>${escapeHtml(v.customer_name)}</strong></td>
                    <td data-label="Social Handle">${escapeHtml(v.social_handle || 'N/A')}</td>
                    <td data-label="Contact Number">${escapeHtml(v.contact_info || 'N/A')}</td>
                    <td data-label="Claimed Date">${formatLocalDate(v.created_at)}</td>
                </tr>
            `).join('');
        })
        .catch(err => console.error('Error loading promo codes:', err));
}

function verifyAndRedeemCode() {
    const input = document.getElementById('promo-code-input');
    const msg = document.getElementById('cashier-promo-msg');
    if (!input || !msg) return;

    const code = input.value.trim();
    if (!code) {
        msg.className = 'status-msg error';
        msg.textContent = 'Please enter a voucher code.';
        return;
    }

    fetch('/api/admin/promo-codes/verify-redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            msg.className = 'status-msg success';
            msg.textContent = res.message;
            input.value = '';
            showToast('Promo Code Voucher Redeemed!');
            loadActiveVouchers();
            loadDashboardData();
        } else {
            msg.className = 'status-msg error';
            msg.textContent = res.error || 'Failed to verify voucher code.';
        }
    })
    .catch(() => {
        msg.className = 'status-msg error';
        msg.textContent = 'Server connection error.';
    });
}

/* ===========================================================================
   3. INVENTORY & SUPPLY ENGINE MANAGEMENT & EOD CALCULATOR
   =========================================================================== */
function loadInventoryItems() {
    fetch('/api/admin/inventory')
        .then(res => res.json())
        .then(items => {
            renderInventoryTable(items);
            populateDynamicContainerDropdowns(items);
        })
        .catch(err => console.error('Error loading inventory:', err));
}

function renderInventoryTable(items) {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#888; padding:20px;">No inventory container items registered yet.</td></tr>';
        return;
    }

    const userRole = currentUser ? currentUser.role : 'Staff';
    const isAdminOrAbove = ['Admin', 'Owner', 'Developer'].includes(userRole);

    tbody.innerHTML = items.map(item => {
        const isLow = item.stock_quantity <= item.safety_threshold;
        const statusBadge = isLow 
            ? '<span class="badge-audit-red"><i class="fa-solid fa-triangle-exclamation"></i> LOW STOCK (' + item.stock_quantity + ')</span>' 
            : '<span class="badge-audit-green"><i class="fa-solid fa-check"></i> STABLE (' + item.stock_quantity + ')</span>';

        const linkedMenuDisplay = item.linked_menu_name 
            ? '<span class="code-badge" style="background:var(--secondary); font-size:0.75rem;">' + escapeHtml(item.linked_menu_name) + '</span>' 
            : '<span style="color:#888; font-style:italic;">Unlinked</span>';

        let actionsHtml = '';
        if (isAdminOrAbove) {
            actionsHtml = '<button class="btn-action" style="padding: 6px 12px; font-size:0.8rem; background-color:var(--slate-neutral);" onclick="openEditContainerModal(' + item.id + ', \'' + escapeHtml(item.item_name) + '\', ' + (item.item_cost || 0) + ', ' + item.safety_threshold + ')">' +
                          '<i class="fa-solid fa-pen-to-square"></i> Edit</button>' +
                          '<button class="btn-action btn-danger" style="padding: 6px 12px; font-size:0.8rem;" onclick="deleteInventoryItem(' + item.id + ')">' +
                          '<i class="fa-solid fa-trash"></i> Delete</button>';
        } else {
            actionsHtml = '<span style="color:#888; font-size:0.8rem;">View Only</span>';
        }

        return '<tr>' +
            '<td data-label="Container Name"><strong>' + escapeHtml(item.item_name) + '</strong></td>' +
            '<td data-label="Unit Type">' + escapeHtml(item.container_unit) + '</td>' +
            '<td data-label="In Stock">' + item.stock_quantity + '</td>' +
            '<td data-label="Safety Threshold">' + item.safety_threshold + '</td>' +
            '<td data-label="Linked Menu Item">' + linkedMenuDisplay + '</td>' +
            '<td data-label="Unit Cost">₱' + (item.item_cost || 0).toFixed(2) + '</td>' +
            '<td data-label="Status">' + statusBadge + '</td>' +
            '<td data-label="Actions">' + actionsHtml + '</td>' +
        '</tr>';
    }).join('');
}

function openEditContainerModal(id, name, cost, threshold) {
    const modal = document.getElementById('edit-container-modal');
    const idInput = document.getElementById('edit-inv-id');
    const nameInput = document.getElementById('edit-inv-name');
    const costInput = document.getElementById('edit-inv-cost');
    const thresholdInput = document.getElementById('edit-inv-threshold');

    if (!modal) return;
    if (idInput) idInput.value = id;
    if (nameInput) nameInput.value = name;
    if (costInput) costInput.value = cost;
    if (thresholdInput) thresholdInput.value = threshold;

    modal.classList.add('active');
}

function closeEditContainerModal() {
    const modal = document.getElementById('edit-container-modal');
    if (modal) modal.classList.remove('active');
}

function submitEditContainer(e) {
    e.preventDefault();
    const id = document.getElementById('edit-inv-id').value;
    const cost = parseFloat(document.getElementById('edit-inv-cost').value) || 0;
    const threshold = parseInt(document.getElementById('edit-inv-threshold').value, 10) || 5;

    fetch(`/api/admin/inventory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_cost: cost, safety_threshold: threshold })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Container unit cost and safety threshold updated!');
            closeEditContainerModal();
            loadInventoryItems();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to update container.', 'error');
        }
    });
}

function populateInventoryDropdowns(items) {
    const stockInSelect = document.getElementById('stockin-inventory-id');
    const auditSelect = document.getElementById('audit-inventory-id');
    const wasteSelect = document.getElementById('waste-inventory-id');

    const optionsHtml = items.map(i => `<option value="${i.id}">${escapeHtml(i.item_name)} (Current: ${i.stock_quantity} ${escapeHtml(i.container_unit)})</option>`).join('');
    
    if (stockInSelect) stockInSelect.innerHTML = `<option value="">-- Select Bulk Container Item --</option>` + optionsHtml;
    if (auditSelect) auditSelect.innerHTML = `<option value="">-- Select Bulk Container Item --</option>` + optionsHtml;
    if (wasteSelect) wasteSelect.innerHTML = `<option value="">-- Select Bulk Container Item --</option>` + optionsHtml;
}

function renderEodMenuGrid(items) {
    const grid = document.getElementById('eod-menu-items-grid');
    if (!grid) return;

    if (!items || items.length === 0) {
        grid.innerHTML = '<div style="color:#888; grid-column: 1/-1; padding: 15px; text-align: center;">No menu items available to log.</div>';
        return;
    }

    grid.innerHTML = items.map(item => `
        <div class="eod-item-card" data-name="${item.name.toLowerCase()}" data-category="${item.category}" data-price="${item.price}">
            <div class="eod-item-header">
                <span>${escapeHtml(item.name)}</span>
                <span class="eod-item-price">₱${parseFloat(item.price).toFixed(2)}</span>
            </div>
            <div class="eod-item-input-wrapper">
                <label>Units Sold:</label>
                <input type="number" min="0" value="0" class="eod-item-qty" data-menu-id="${item.id}" data-category="${item.category}" data-price="${item.price}" placeholder="e.g., 10" oninput="updateEodLiveTally()">
            </div>
        </div>
    `).join('');
    updateEodLiveTally();
}

function filterEodByCategory(category, btn) {
    currentEodCategoryFilter = category;
    const pills = document.querySelectorAll('#eod-category-pills .btn-filter-pill');
    pills.forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    filterEodMenuGrid();
}

function filterEodMenuGrid() {
    const searchInput = document.getElementById('eod-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const cards = document.querySelectorAll('.eod-item-card');

    cards.forEach(card => {
        const name = card.dataset.name;
        const category = (card.dataset.category || '').toLowerCase().trim();
        const matchesSearch = name.includes(query);
        
        let matchesCategory = true;
        if (currentEodCategoryFilter !== 'All') {
            const filterCat = currentEodCategoryFilter.toLowerCase().trim();
            if (filterCat === 'iced coffee' || filterCat === 'cold coffee' || filterCat === 'iced-coffee') {
                matchesCategory = category.includes('iced') || category.includes('cold');
            } else if (filterCat === 'hot coffee') {
                matchesCategory = category.includes('hot');
            } else if (filterCat === 'non-coffee' || filterCat === 'non coffee') {
                matchesCategory = category.includes('non');
            } else if (filterCat === 'pastries' || filterCat === 'pastry') {
                matchesCategory = category.includes('pastr');
            } else if (filterCat === 'fruit sodas' || filterCat === 'soda') {
                matchesCategory = category.includes('soda') || category.includes('fruit');
            } else {
                matchesCategory = category === filterCat || category.includes(filterCat);
            }
        }

        if (matchesSearch && matchesCategory) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function updateEodLiveTally() {
    const qtyInputs = document.querySelectorAll('.eod-item-qty');
    let totalUnits = 0;
    let grossRev = 0;
    let drinksQty = 0;
    let pastriesQty = 0;

    qtyInputs.forEach(input => {
        const qty = parseInt(input.value, 10) || 0;
        const price = parseFloat(input.dataset.price) || 0;
        const cat = input.dataset.category;

        if (qty > 0) {
            totalUnits += qty;
            grossRev += qty * price;
            if (cat === 'Hot Coffee' || cat === 'Iced Coffee' || cat === 'Non-Coffee' || cat === 'Fruit Sodas') {
                drinksQty += qty;
            } else if (cat === 'Pastries') {
                pastriesQty += qty;
            }
        }
    });

    const discountInput = document.getElementById('shift-discount-amount');
    const discountVal = discountInput ? parseFloat(discountInput.value) || 0 : 0;
    const netSales = Math.max(0, grossRev - discountVal);

    const elUnits = document.getElementById('tally-total-units');
    const elGross = document.getElementById('tally-gross-rev');
    const elNet = document.getElementById('tally-net-sales');
    const elDrinks = document.getElementById('tally-drinks-qty');
    const elPastries = document.getElementById('tally-pastries-qty');

    if (elUnits) elUnits.textContent = totalUnits;
    if (elGross) elGross.textContent = `₱${grossRev.toFixed(2)}`;
    if (elNet) elNet.textContent = `₱${netSales.toFixed(2)}`;
    if (elDrinks) elDrinks.textContent = drinksQty;
    if (elPastries) elPastries.textContent = pastriesQty;
}

function interceptEodCloseout(e) {
    e.preventDefault();
    openSecurityModal(() => {
        submitDailyShiftCloseAction();
    });
}

function submitDailyShiftCloseAction() {
    const shiftDate = document.getElementById('shift-close-date').value;
    const posTotal = parseFloat(document.getElementById('shift-pos-total').value) || 0;
    const discountAmount = parseFloat(document.getElementById('shift-discount-amount').value) || 0;

    const qtyInputs = document.querySelectorAll('.eod-item-qty');
    const itemsSold = [];

    qtyInputs.forEach(input => {
        const qty = parseInt(input.value, 10) || 0;
        if (qty > 0) {
            itemsSold.push({
                menu_item_id: parseInt(input.dataset.menuId, 10),
                quantity_sold: qty
            });
        }
    });

    if (!shiftDate) {
        showToast('Please select a shift date.', 'error');
        return;
    }

    fetch('/api/admin/inventory/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            shift_date: shiftDate,
            total_sales_amount: posTotal,
            discount_amount: discountAmount,
            items_sold: itemsSold
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Daily EOD Shift Closeout successfully executed!');
            document.getElementById('form-eod-closeout').reset();
            initEodFormDate();
            loadInventoryItems();
            loadDashboardData();
            loadCloseoutHistory();
        } else {
            showToast(res.error || 'Failed to execute EOD Shift Closeout.', 'error');
        }
    })
    .catch(() => {
        showToast('Server connection error during shift closeout.', 'error');
    });
}

function openMasterTicketModal() {
    const shiftDate = document.getElementById('shift-close-date')?.value || new Date().toISOString().split('T')[0];
    const dateDisplay = document.getElementById('ticket-date-display');
    const contentContainer = document.getElementById('master-ticket-content');
    if (!contentContainer) return;

    if (dateDisplay) dateDisplay.textContent = `Shift Date: ${shiftDate}`;
    contentContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Compiling Master Audit Ticket...</div>';
    
    const modal = document.getElementById('master-ticket-modal');
    if (modal) modal.classList.add('active');

    Promise.all([
        fetch(`/api/admin/closeouts?start_date=${shiftDate}&end_date=${shiftDate}`).then(res => res.json()),
        fetch(`/api/admin/invoices?date=${shiftDate}`).then(res => res.json()),
        fetch(`/api/admin/wastage?start_date=${shiftDate}&end_date=${shiftDate}`).then(res => res.json())
    ])
    .then(async ([closeouts, shipments, wastage]) => {
        const closeout = (closeouts && closeouts.length > 0) ? closeouts[0] : null;
        
        let posItems = [];
        if (closeout) {
            try {
                const itemsRes = await fetch(`/api/admin/closeouts/${closeout.id}/items`);
                posItems = await itemsRes.json();
            } catch (err) {
                console.error("Error fetching closeout items:", err);
            }
        }

        // 1. Section 1: POS Sales Breakdown
        let posRowsHtml = '';
        let grossFromItems = 0;

        if (posItems && posItems.length > 0) {
            posRowsHtml = posItems.map(item => {
                const unitPrice = parseFloat(item.price || 0);
                const qty = parseInt(item.quantity_sold || 0, 10);
                const subtotal = unitPrice * qty;
                grossFromItems += subtotal;
                return `
                    <tr>
                        <td><strong>${escapeHtml(item.menu_item_name)}</strong></td>
                        <td style="text-align:center;">₱${unitPrice.toFixed(2)}</td>
                        <td style="text-align:center;">${qty}</td>
                        <td style="text-align:right;">₱${subtotal.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        } else {
            posRowsHtml = '<tr><td colspan="4" style="text-align:center; color:#888;">No itemized POS sales logged for this shift.</td></tr>';
        }

        const gross = closeout ? closeout.total_sales_amount : grossFromItems;
        const disc = closeout ? (closeout.discount_amount || 0) : (parseFloat(document.getElementById('shift-discount-amount')?.value) || 0);
        const net = Math.max(0, gross - disc);

        // 2. Section 2: Stock Shipments Log
        let shipHtml = '';
        let totalProcurementCost = 0;
        if (!shipments || shipments.length === 0) {
            shipHtml = '<tr><td colspan="6" style="text-align:center; color:#888;">No stock shipments logged on this date.</td></tr>';
        } else {
            shipHtml = shipments.map(s => {
                const qty = s.physically_counted_quantity || s.actual_received_qty || 0;
                const unitCost = s.unit_cost_per_item || s.cost_per_unit || 0;
                const totalCost = qty * unitCost;
                totalProcurementCost += totalCost;
                return `
                    <tr>
                        <td>${escapeHtml(s.invoice_number || 'N/A')}</td>
                        <td>${escapeHtml(s.supplier_name)}</td>
                        <td>${escapeHtml(s.item_name)}</td>
                        <td style="text-align:center;">₱${unitCost.toFixed(2)}</td>
                        <td style="text-align:center;">${qty}</td>
                        <td style="text-align:right;">₱${totalCost.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }

        // 3. Section 3: Spillage & Loss Log
        let wasteHtml = '';
        let totalLossAmount = 0;
        if (!wastage || wastage.length === 0) {
            wasteHtml = '<tr><td colspan="5" style="text-align:center; color:#888;">No stock-out or spillage incidents logged on this date.</td></tr>';
        } else {
            wasteHtml = wastage.map(w => {
                const qty = w.quantity_val || w.quantity_lost || 0;
                const unitCost = w.unit_cost || 0;
                const totalLoss = w.financial_loss || (qty * unitCost);
                totalLossAmount += totalLoss;
                return `
                    <tr>
                        <td><span class="${w.movement_type === 'AUDIT' ? 'badge-audit-green' : 'badge-audit-red'}">${escapeHtml(w.movement_type)}</span></td>
                        <td>${escapeHtml(w.item_name)}</td>
                        <td style="text-align:center;">₱${unitCost.toFixed(2)}</td>
                        <td style="text-align:center;">${qty} units</td>
                        <td style="text-align:right; color:var(--danger); font-weight:700;">₱${totalLoss.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
        }

        contentContainer.innerHTML = `
            <!-- Section 1: POS Sales Summary -->
            <div class="ticket-section-card">
                <h4 class="ticket-section-title"><i class="fa-solid fa-receipt"></i> 1. POS Shift Itemized Sales</h4>
                <div style="overflow-x:auto; width:100%;">
                    <table class="custom-table ticket-table" style="width:100%;">
                        <thead>
                            <tr>
                                <th>Menu Item</th>
                                <th style="text-align:center;">Unit Price</th>
                                <th style="text-align:center;">Qty Sold</th>
                                <th style="text-align:right;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${posRowsHtml}</tbody>
                    </table>
                </div>
                <div class="ticket-receipt-summary" style="text-align: right;">
                    <div style="font-size: 0.88rem; color: #555; margin-bottom: 3px;">Gross Sales: ₱${gross.toFixed(2)} ${disc > 0 ? `| Discounts: -₱${disc.toFixed(2)}` : ''}</div>
                    <div style="font-weight: 800; color: var(--primary); font-size: 1.1rem;">
                        Net POS Revenue: ₱${net.toFixed(2)}
                    </div>
                </div>
            </div>

            <!-- Section 2: Stock In Log -->
            <div class="ticket-section-card">
                <h4 class="ticket-section-title"><i class="fa-solid fa-truck-ramp-box"></i> 2. Stock Shipments (Stock In) Log</h4>
                <div style="overflow-x:auto; width:100%;">
                    <table class="custom-table ticket-table" style="width:100%;">
                        <thead>
                            <tr>
                                <th>Invoice #</th>
                                <th>Supplier</th>
                                <th>Item</th>
                                <th style="text-align:center;">Unit Cost</th>
                                <th style="text-align:center;">Qty</th>
                                <th style="text-align:right;">Total Cost</th>
                            </tr>
                        </thead>
                        <tbody>${shipHtml}</tbody>
                    </table>
                </div>
                ${shipments && shipments.length > 0 ? `
                    <div class="ticket-receipt-summary" style="text-align: right;">
                        <div style="font-weight: 800; color: var(--primary); font-size: 1.1rem;">
                            Total Procurement Cost: ₱${totalProcurementCost.toFixed(2)}
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- Section 3: Stock-Out & Spillage Log -->
            <div class="ticket-section-card">
                <h4 class="ticket-section-title"><i class="fa-solid fa-dumpster-fire"></i> 3. Stock-Out &amp; Spillage Incidents</h4>
                <div style="overflow-x:auto; width:100%;">
                    <table class="custom-table ticket-table" style="width:100%;">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Item</th>
                                <th style="text-align:center;">Unit Cost</th>
                                <th style="text-align:center;">Qty Lost</th>
                                <th style="text-align:right;">Financial Loss</th>
                            </tr>
                        </thead>
                        <tbody>${wasteHtml}</tbody>
                    </table>
                </div>
                ${wastage && wastage.length > 0 ? `
                    <div class="ticket-receipt-summary" style="text-align: right;">
                        <div style="font-weight: 800; color: var(--danger); font-size: 1.1rem;">
                            Total Financial Loss: ₱${totalLossAmount.toFixed(2)}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    })
    .catch(err => {
        console.error('Error generating master audit ticket:', err);
        contentContainer.innerHTML = '<div style="color:var(--danger); text-align:center; padding:15px;">Failed to compile Master Audit Ticket data.</div>';
    });
}

function closeMasterTicketModal() {
    const modal = document.getElementById('master-ticket-modal');
    if (modal) modal.classList.remove('active');
}

function printMasterTicketModal() {
    window.print();
}

function registerNewInventoryContainer(e) {
    e.preventDefault();
    const name = document.getElementById('new-inv-name').value.trim();
    const unit = document.getElementById('new-inv-unit').value;
    const qty = parseInt(document.getElementById('new-inv-qty').value, 10) || 0;
    const threshold = parseInt(document.getElementById('new-inv-threshold').value, 10) || 5;
    const cost = parseFloat(document.getElementById('new-inv-cost').value) || 0.0;
    const linkedMenuId = document.getElementById('new-inv-menu-id')?.value;

    if (!name || !unit) {
        showToast('Name and Unit type are required.', 'error');
        return;
    }

    fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            item_name: name, 
            container_unit: unit, 
            stock_quantity: qty, 
            safety_threshold: threshold, 
            item_cost: cost,
            linked_menu_item_id: linkedMenuId ? parseInt(linkedMenuId, 10) : null 
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('New bulk container registered with menu linkage!');
            document.getElementById('form-register-container').reset();
            // Reset dropdown text
            const triggerText = document.querySelector('#new-inv-menu-dropdown .dropdown-selected-text');
            if (triggerText) triggerText.textContent = '-- None (Unlinked) --';
            loadInventoryItems();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to register item.', 'error');
        }
    });
}

function submitStockIn(e) {
    e.preventDefault();
    const itemId = document.getElementById('stockin-inventory-id').value;
    const supplier = document.getElementById('stockin-supplier').value.trim();
    const invoiceNum = document.getElementById('stockin-invoice-num').value.trim();
    const invoiceQty = parseInt(document.getElementById('stockin-invoice-qty').value, 10) || 0;
    const receivedQty = parseInt(document.getElementById('stockin-received-qty').value, 10) || 0;
    const unitCost = parseFloat(document.getElementById('stockin-unit-cost').value) || 0.0;

    fetch('/api/admin/inventory/shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            inventory_item_id: itemId,
            supplier_name: supplier,
            invoice_number: invoiceNum,
            supplier_invoice_quantity: invoiceQty,
            physically_counted_quantity: receivedQty,
            unit_cost_per_item: unitCost
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Stock shipment received and logged!');
            document.getElementById('form-ops-stockin').reset();
            loadInventoryItems();
            loadDashboardData();
            loadSupplierInvoices();
        } else {
            showToast(res.error || 'Failed to log shipment.', 'error');
        }
    });
}

function submitEveningAudit(e) {
    e.preventDefault();
    const itemId = document.getElementById('audit-inventory-id').value;
    const shift = document.getElementById('audit-shift').value;
    const actualStock = parseInt(document.getElementById('audit-actual-stock').value, 10) || 0;
    const notes = document.getElementById('audit-notes').value.trim();

    fetch('/api/admin/inventory/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            inventory_item_id: itemId,
            shift_period: shift,
            actual_stock: actualStock,
            notes: notes
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast(`Shift audit saved! Variance: ${res.variance}`);
            document.getElementById('form-ops-audit').reset();
            loadInventoryItems();
            loadDashboardData();
            loadWastageLogs();
        } else {
            showToast(res.error || 'Failed to submit audit.', 'error');
        }
    });
}

function submitWastageLog(e) {
    e.preventDefault();
    const itemId = document.getElementById('waste-inventory-id').value;
    const qtyLost = parseInt(document.getElementById('waste-qty').value, 10) || 0;
    const reason = document.getElementById('waste-reason').value;
    const reporter = document.getElementById('waste-reporter').value.trim();
    const notes = document.getElementById('waste-notes').value.trim();

    fetch('/api/inventory/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            inventory_item_id: itemId,
            quantity_lost: qtyLost,
            reason_code: reason,
            reporter: reporter,
            notes: notes
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast(`Wastage incident logged! Cost loss: ₱${res.financial_loss.toFixed(2)}`, 'warning');
            document.getElementById('form-ops-waste').reset();
            loadInventoryItems();
            loadDashboardData();
            loadWastageLogs();
        } else {
            showToast(res.error || 'Failed to log wastage.', 'error');
        }
    });
}

function deleteInventoryItem(id) {
    openSecurityModal(() => {
        fetch(`/api/admin/inventory/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    showToast('Container item deleted.');
                    loadInventoryItems();
                    loadDashboardData();
                } else {
                    showToast(res.error || 'Failed to delete container.', 'error');
                }
            });
    });
}

/* ===========================================================================
   4. OPERATIONAL LEDGERS TAB (EXPORTS, FILTERS & EOD MODAL POPUPS)
   =========================================================================== */
function loadSupplierInvoices() {
    const dateFilter = document.getElementById('invoice-date-filter')?.value;
    const supplierFilter = document.getElementById('invoice-supplier-filter')?.value || '';

    let url = '/api/admin/invoices?';
    if (dateFilter) url += `date=${encodeURIComponent(dateFilter)}&`;
    if (supplierFilter) url += `supplier=${encodeURIComponent(supplierFilter)}`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('invoices-table-body');
            if (!tbody) return;

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:15px;">No shipment invoices found.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(inv => {
                const isShortage = (inv.supplier_invoice_quantity || inv.invoice_qty || 0) > (inv.physically_counted_quantity || inv.actual_received_qty || 0);
                const statusBadge = isShortage 
                    ? `<span class="badge-audit-red"><i class="fa-solid fa-triangle-exclamation"></i> SHORTAGE</span>`
                    : `<span class="badge-audit-green"><i class="fa-solid fa-check"></i> VERIFIED MATCH</span>`;

                return `
                    <tr>
                        <td><strong>${escapeHtml(inv.invoice_number || 'N/A')}</strong></td>
                        <td>${escapeHtml(inv.supplier_name)}</td>
                        <td>${escapeHtml(inv.item_name)}</td>
                        <td>Invoiced: ${inv.supplier_invoice_quantity || inv.invoice_qty} | Recv: ${inv.physically_counted_quantity || inv.actual_received_qty}</td>
                        <td>₱${(inv.unit_cost_per_item || inv.cost_per_unit || 0).toFixed(2)}</td>
                        <td>${statusBadge}</td>
                        <td>${new Date(inv.timestamp).toLocaleString()}</td>
                    </tr>
                `;
            }).join('');
        })
        .catch(err => console.error('Error loading invoices:', err));
}

function clearSpillageFilters() {
    const startDate = document.getElementById('spillage-start-date');
    const endDate = document.getElementById('spillage-end-date');
    const typeFilter = document.getElementById('spillage-type-filter');
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    if (typeFilter) typeFilter.value = 'ALL';
    loadWastageLogs();
}

function loadWastageLogs() {
    const startDate = document.getElementById('spillage-start-date')?.value;
    const endDate = document.getElementById('spillage-end-date')?.value;
    const typeFilter = document.getElementById('spillage-type-filter')?.value || 'ALL';

    let url = '/api/admin/wastage?';
    if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end_date=${encodeURIComponent(endDate)}&`;
    url += `movement_type=${encodeURIComponent(typeFilter)}`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch wastage logs');
            return res.json();
        })
        .then(data => {
            const tbody = document.getElementById('spillage-table-body');
            if (!tbody) return;

            if (!Array.isArray(data)) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--danger); padding:15px;">Invalid response data received from server.</td></tr>';
                return;
            }

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#888; padding:15px;">No stock-out or spillage logs recorded.</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(w => {
                let badgeHtml = '';
                if (w.movement_type === 'AUDIT') {
                    badgeHtml = `<span class="badge-audit-green"><i class="fa-solid fa-clipboard-check"></i> SHIFT AUDIT</span>`;
                } else {
                    badgeHtml = `<span class="badge-audit-red"><i class="fa-solid fa-dumpster-fire"></i> SPILLAGE</span>`;
                }

                return `
                    <tr>
                        <td>${w.id}</td>
                        <td><strong>${badgeHtml} ${escapeHtml(w.item_name)}</strong></td>
                        <td>${escapeHtml(w.quantity_display)}</td>
                        <td>${escapeHtml(w.reason_code)}</td>
                        <td>₱${(w.unit_cost || 0).toFixed(2)}</td>
                        <td>₱${(w.financial_loss || 0).toFixed(2)}</td>
                        <td>${escapeHtml(w.logged_by)}</td>
                        <td>${new Date(w.timestamp).toLocaleString()}</td>
                    </tr>
                `;
            }).join('');
        })
        .catch(err => {
            console.error('Error loading wastage logs:', err);
            const tbody = document.getElementById('spillage-table-body');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--danger); padding:15px;">Error loading stock-out history logs.</td></tr>';
            }
        });
}

function loadCloseoutHistory() {
    const startDate = document.getElementById('closeout-start-date')?.value;
    const endDate = document.getElementById('closeout-end-date')?.value;

    let url = '/api/admin/closeouts?';
    if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end_date=${encodeURIComponent(endDate)}`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            const tbody = document.getElementById('closeouts-table-body');
            if (!tbody) return;
            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:15px;">No EOD shift closeout records found.</td></tr>';
                return;
            }
            tbody.innerHTML = data.map(c => `
                <tr>
                    <td>#${c.id}</td>
                    <td><strong>${escapeHtml(c.shift_date)}</strong></td>
                    <td>₱${(c.total_sales_amount || 0).toFixed(2)}</td>
                    <td>₱${(c.discount_amount || 0).toFixed(2)}</td>
                    <td style="color:var(--primary); font-weight:700;">₱${((c.total_sales_amount || 0) - (c.discount_amount || 0)).toFixed(2)}</td>
                    <td>${escapeHtml(c.logged_by)}</td>
                    <td>
                        <button class="btn-action" style="padding: 4px 10px; font-size:0.8rem;" onclick="openCloseoutDetailsModal(${c.id}, '${escapeHtml(c.shift_date)}')">
                            <i class="fa-solid fa-eye"></i> Details
                        </button>
                    </td>
                </tr>
            `).join('');
        })
        .catch(err => console.error('Error loading closeouts:', err));
}

function openCloseoutDetailsModal(closeoutId, shiftDate) {
    const modal = document.getElementById('eod-details-modal');
    const title = document.getElementById('modal-closeout-title');
    const tbody = document.getElementById('modal-closeout-items-body');
    if (!modal || !title || !tbody) return;

    title.textContent = `EOD Itemized Breakdown — Shift Date: ${shiftDate} (ID #${closeoutId})`;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color:#666;">Loading itemized breakdown...</td></tr>';
    modal.classList.add('active');

    fetch(`/api/admin/closeouts/${closeoutId}/items`)
        .then(res => res.json())
        .then(items => {
            if (!items || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 15px; color:#888;">No itemized sales recorded for this shift.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(item => `
                <tr>
                    <td><strong>${escapeHtml(item.menu_item_name)}</strong></td>
                    <td>₱${parseFloat(item.price || 0).toFixed(2)}</td>
                    <td><span class="badge-audit-green">${item.quantity_sold} units</span></td>
                </tr>
            `).join('');
        })
        .catch(err => {
            console.error('Failed to fetch closeout items:', err);
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger); padding:15px;">Failed to load itemized breakdown.</td></tr>';
        });
}

function closeCloseoutDetailsModal() {
    const modal = document.getElementById('eod-details-modal');
    if (modal) modal.classList.remove('active');
}

// Export Ledger Sub-Section CSV
function exportLedgerCSV(type) {
    if (type === 'shipments') {
        fetch('/api/admin/invoices')
            .then(res => res.json())
            .then(data => {
                let csv = 'Invoice Number,Supplier,Item Name,Invoice Qty,Received Qty,Unit Cost,Timestamp\n';
                (data || []).forEach(i => {
                    csv += `"${i.invoice_number || 'N/A'}","${i.supplier_name}","${i.item_name}",${i.supplier_invoice_quantity || i.invoice_qty},${i.physically_counted_quantity || i.actual_received_qty},${i.unit_cost_per_item || i.cost_per_unit || 0},"${i.timestamp}"\n`;
                });
                downloadCSV(csv, 'supplier_shipments.csv');
            });
    } else if (type === 'spillage') {
        const startDate = document.getElementById('spillage-start-date')?.value;
        const endDate = document.getElementById('spillage-end-date')?.value;
        const typeFilter = document.getElementById('spillage-type-filter')?.value || 'ALL';

        let url = '/api/admin/wastage?';
        if (startDate) url += `start_date=${encodeURIComponent(startDate)}&`;
        if (endDate) url += `end_date=${encodeURIComponent(endDate)}&`;
        url += `movement_type=${encodeURIComponent(typeFilter)}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                let csv = 'ID,Movement Type,Container Item/Details,Quantity/Notes,Reason Code,Unit Cost,Financial Loss,Logged By,Timestamp\n';
                (data || []).forEach(w => {
                    csv += `${w.id},"${w.movement_type}","${escapeHtml(w.item_name)}","${escapeHtml(w.quantity_display)}","${w.reason_code}",${w.unit_cost},${w.financial_loss},"${w.logged_by}","${w.timestamp}"\n`;
                });
                downloadCSV(csv, 'stockout_spillage_audit_history.csv');
            });
    } else if (type === 'closeouts') {
        fetch('/api/admin/closeouts')
            .then(res => res.json())
            .then(data => {
                let csv = 'Closeout ID,Shift Date,Gross Sales,Discounts,Net Sales,Logged By,Timestamp\n';
                (data || []).forEach(c => {
                    csv += `${c.id},"${c.shift_date}",${c.total_sales_amount},${c.discount_amount || 0},${c.total_sales_amount - (c.discount_amount || 0)},"${c.logged_by}","${c.timestamp}"\n`;
                });
                downloadCSV(csv, 'eod_closeout_history.csv');
            });
    }
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Successfully exported ${filename}`);
}

function printLedgerSection() {
    // Determine which ledger sub-tab is currently active
    const shipmentsPane = document.getElementById('ledger-subtab-shipments');
    const spillagePane = document.getElementById('ledger-subtab-spillage');
    const closeoutsPane = document.getElementById('ledger-subtab-closeouts');

    // Remove old body print classes
    document.body.classList.remove('printing-ledger-shipments', 'printing-ledger-spillage', 'printing-ledger-closeouts');

    if (shipmentsPane && shipmentsPane.style.display !== 'none') {
        document.body.classList.add('printing-ledger-shipments');
    } else if (spillagePane && spillagePane.style.display !== 'none') {
        document.body.classList.add('printing-ledger-spillage');
    } else if (closeoutsPane && closeoutsPane.style.display !== 'none') {
        document.body.classList.add('printing-ledger-closeouts');
    }

    window.print();

    // Clean up classes after print dialog closes
    setTimeout(() => {
        document.body.classList.remove('printing-ledger-shipments', 'printing-ledger-spillage', 'printing-ledger-closeouts');
    }, 500);
}

// Also update printMasterTicketModal to apply its own mode class cleanly
function printMasterTicketModal() {
    document.body.classList.add('printing-master-ticket');
    window.print();
    setTimeout(() => {
        document.body.classList.remove('printing-master-ticket');
    }, 500);
}

/* ===========================================================================
   5. MENU CATALOG MANAGEMENT TAB
   =========================================================================== */
function loadMenuItems() {
    fetch('/api/menu')
        .then(res => res.json())
        .then(items => {
            allMenuItems = items || [];
            filterAndSortMenuCatalog();
            renderEodMenuGrid(allMenuItems);
            populateRegisterMenuDropdown(allMenuItems);
        })
        .catch(err => console.error('Error loading menu:', err));
}

function populateRegisterMenuDropdown(menuItems) {
    const menuEl = document.getElementById('new-inv-menu-options');
    if (!menuEl) return;

    menuEl.innerHTML = `<div class="dropdown-option" onclick="selectCustomOption(this, '', 'new-inv-menu-id')">-- None (Unlinked) --</div>`;
    
    if (menuItems && menuItems.length > 0) {
        menuItems.forEach(item => {
            const opt = document.createElement('div');
            opt.className = 'dropdown-option';
            opt.textContent = `${item.name} (${item.category})`;
            opt.onclick = function() {
                selectCustomOption(this, item.id, 'new-inv-menu-id');
            };
            menuEl.appendChild(opt);
        });
    }
}

function renderMenuTable(items) {
    const tbody = document.getElementById('menu-table-body');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888; padding:20px;">No menu items found.</td></tr>';
        return;
    }

    const userRole = currentUser ? currentUser.role : 'Staff';
    const isAdminOrAbove = ['Admin', 'Owner', 'Developer'].includes(userRole);

    tbody.innerHTML = items.map(item => `
        <tr>
            <td><img src="${item.image ? escapeHtml(item.image) : '/images/placeholder.jpg'}" style="width:40px; height:40px; object-fit:cover; border-radius:6px;" onerror="this.src='/images/placeholder.jpg'"></td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td>${escapeHtml(item.category)}</td>
            <td>₱${parseFloat(item.price).toFixed(2)}</td>
            <td>
                <span class="${item.is_available ? 'badge-audit-green' : 'badge-audit-red'}">
                    ${item.is_available ? 'AVAILABLE' : 'OUT OF STOCK'}
                </span>
            </td>
            <td>${item.view_count || 0}</td>
            <td>
                <button class="btn-action" style="padding:4px 8px; font-size:0.8rem; background-color:var(--slate-neutral);" onclick="toggleMenuItemAvailability(${item.id}, ${item.is_available})">
                    <i class="fa-solid fa-power-off"></i> Toggle
                </button>
                ${isAdminOrAbove ? `
                    <button class="btn-action btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="deleteMenuItem(${item.id})">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function handleAddMenuItem(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    fetch('/api/admin/menu', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('New menu item added!');
            e.target.reset();
            loadMenuItems();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to add item.', 'error');
        }
    });
}

function toggleMenuItemAvailability(id, currentStatus) {
    fetch(`/api/admin/menu/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_available: !currentStatus })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Item status updated!');
            loadMenuItems();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to update item.', 'error');
        }
    });
}

function deleteMenuItem(id) {
    openSecurityModal(() => {
        fetch(`/api/admin/menu/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    showToast('Menu item deleted.');
                    loadMenuItems();
                    loadDashboardData();
                } else {
                    showToast(res.error || 'Failed to delete item.', 'error');
                }
            });
    });
}

/* ===========================================================================
   6. HERO BANNERS MANAGEMENT TAB
   =========================================================================== */
function loadHeroSlides() {
    fetch('/api/hero-slides')
        .then(res => res.json())
        .then(slides => {
            const list = document.getElementById('hero-slides-list');
            if (!list) return;

            if (!slides || slides.length === 0) {
                list.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">No hero visual slides uploaded yet.</div>';
                return;
            }

            const userRole = currentUser ? currentUser.role : 'Staff';
            const isAdminOrAbove = ['Admin', 'Owner', 'Developer'].includes(userRole);

            list.innerHTML = slides.map(s => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--alt-bg); border-radius:8px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${escapeHtml(s.image)}" style="width:70px; height:45px; object-fit:cover; border-radius:6px;">
                        <div>
                            <strong>${escapeHtml(s.title)}</strong>
                            <div style="font-size:0.8rem; color:#666;">${escapeHtml(s.subtitle || '')}</div>
                        </div>
                    </div>
                    ${isAdminOrAbove ? `
                        <button class="btn-action btn-danger" style="padding:6px 12px; font-size:0.8rem;" onclick="deleteHeroSlide(${s.id})">
                            <i class="fa-solid fa-trash"></i> Delete
                        </button>
                    ` : ''}
                </div>
            `).join('');
        })
        .catch(err => console.error('Error loading hero slides:', err));
}

function handleUploadHeroSlide(e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    fetch('/api/admin/hero-slides', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Hero slide uploaded!');
            e.target.reset();
            loadHeroSlides();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to upload hero slide.', 'error');
        }
    });
}

function deleteHeroSlide(id) {
    if (!confirm('Are you sure you want to delete this hero slide?')) return;
    fetch(`/api/admin/hero-slides/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(res => {
            if (res.success) {
                showToast('Hero slide deleted.');
                loadHeroSlides();
                loadDashboardData();
            } else {
                showToast(res.error || 'Failed to delete banner.', 'error');
            }
        });
}

/* ===========================================================================
   7. STORE HOURS TAB
   =========================================================================== */
function loadSettings() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(s => {
            if (s) {
                if (document.getElementById('setting-open-time')) document.getElementById('setting-open-time').value = s.open_time || '08:00';
                if (document.getElementById('setting-close-time')) document.getElementById('setting-close-time').value = s.close_time || '20:00';
                if (document.getElementById('setting-store-status')) document.getElementById('setting-store-status').value = s.store_status || 'AUTO';
                if (document.getElementById('setting-closure-start')) document.getElementById('setting-closure-start').value = s.closure_start || '';
                if (document.getElementById('setting-closure-end')) document.getElementById('setting-closure-end').value = s.closure_end || '';
                if (document.getElementById('setting-notice-message')) document.getElementById('setting-notice-message').value = s.notice_message || '';
                updateStoreStatusPreview();
            }
        });
}

function updateStoreStatusPreview() {
    const statusSelect = document.getElementById('setting-store-status');
    const closureStart = document.getElementById('setting-closure-start')?.value;
    const closureEnd = document.getElementById('setting-closure-end')?.value;
    const chip = document.getElementById('storefront-live-status-chip');

    if (!chip || !statusSelect) return;

    const statusVal = statusSelect.value;
    const now = new Date().getTime();
    let isTimedActive = false;

    if (closureStart && closureEnd) {
        const startMs = new Date(closureStart).getTime();
        const endMs = new Date(closureEnd).getTime();
        if (now >= startMs && now <= endMs) {
            isTimedActive = true;
        }
    }

    if (statusVal !== 'AUTO' || isTimedActive) {
        chip.className = 'pulsing-health-badge override';
        let label = '● Manual Storefront Interruption Active';
        if (isTimedActive) {
            label = '● Timed Block / Private Event Closure Active';
        } else if (statusVal === 'FORCE_OPEN') {
            label = '● Manual Override: Force Open Active';
        } else if (statusVal === 'FORCE_CLOSED') {
            label = '● Manual Override: Force Closed Active';
        }
        chip.innerHTML = `<span class="pulse-dot"></span> ${label}`;
    } else {
        chip.className = 'pulsing-health-badge live';
        chip.innerHTML = `<span class="pulse-dot"></span> Storefront Live &amp; Online`;
    }
}

function saveStoreSettings(e) {
    e.preventDefault();
    const open_time = document.getElementById('setting-open-time').value;
    const close_time = document.getElementById('setting-close-time').value;
    const store_status = document.getElementById('setting-store-status').value;
    const closure_start = document.getElementById('setting-closure-start').value;
    const closure_end = document.getElementById('setting-closure-end').value;
    const notice_message = document.getElementById('setting-notice-message').value;

    fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_time, close_time, store_status, closure_start, closure_end, notice_message })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Store operating settings saved!');
            updateStoreStatusPreview();
            loadDashboardData();
        } else {
            showToast(res.error || 'Failed to save settings.', 'error');
        }
    });
}

/* ===========================================================================
   8. AUDIT LOGS TAB
   =========================================================================== */
function loadAuditLogs() {
    fetch('/api/admin/audit-logs')
        .then(res => res.json())
        .then(logs => {
            allAuditLogs = logs || [];
            const tbody = document.getElementById('audit-table-body');
            if (!tbody) return;

            if (allAuditLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888; padding:20px;">No audit logs recorded yet.</td></tr>';
                return;
            }

            tbody.innerHTML = allAuditLogs.map(l => `
                <tr>
                    <td>${new Date(l.timestamp).toLocaleString()}</td>
                    <td><span class="badge-audit-green"><i class="fa-solid fa-shield"></i> ${escapeHtml(l.action)}</span></td>
                    <td>${escapeHtml(l.details)}</td>
                    <td><strong>${escapeHtml(l.performed_by || 'System')}</strong></td>
                </tr>
            `).join('');
        })
        .catch(err => console.error('Error loading audit logs:', err));
}

/* ===========================================================================
   9. SECURITY & ROLES TAB
   =========================================================================== */
function loadSystemUsers() {
    fetch('/api/admin/users')
        .then(res => res.json())
        .then(users => {
            const tbody = document.getElementById('users-table-body');
            if (!tbody) return;

            if (!users || users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888; padding:15px;">No system accounts registered.</td></tr>';
                return;
            }

            const currentRole = currentUser ? currentUser.role : 'Staff';
            const currentUserId = currentUser ? currentUser.id : null;

            tbody.innerHTML = users.map(u => {
                let roleClass = 'badge-active';
                if (u.role === 'Owner') roleClass = 'badge-owner';
                else if (u.role === 'Developer') roleClass = 'badge-dev';

                // Strict RBAC UI Evaluation for Account Deletion
                let canDelete = false;
                if (currentRole === 'Developer' && u.id !== currentUserId) {
                    canDelete = true;
                } else if (currentRole === 'Admin' && u.role === 'Staff') {
                    canDelete = true;
                }

                return `
                    <tr>
                        <td>#${u.account_id || u.id}</td>
                        <td><strong>${escapeHtml(u.username)}</strong></td>
                        <td><span class="${roleClass}">${escapeHtml(u.role)}</span></td>
                        <td>
                            ${canDelete ? `
                                <button class="btn-action btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="deleteUserAccount(${u.id})">
                                    <i class="fa-solid fa-user-xmark"></i> Delete
                                </button>
                            ` : '<span style="color:#888; font-size:0.8rem;">Protected Account</span>'}
                        </td>
                    </tr>
                `;
            }).join('');
        })
        .catch(err => console.error('Error loading users:', err));
}

function handleChangePersonalPassword(e) {
    e.preventDefault();
    const username = document.getElementById('my-username').value.trim();
    const currentPassword = document.getElementById('my-curr-pass').value;
    const newPassword = document.getElementById('my-new-pass').value;

    fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername: username, currentPassword, newPassword })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast('Credentials updated successfully!');
            document.getElementById('my-curr-pass').value = '';
            document.getElementById('my-new-pass').value = '';
        } else {
            showToast(res.error || 'Failed to update credentials.', 'error');
        }
    });
}

function interceptCreateUserAccount(e) {
    e.preventDefault();
    openSecurityModal(() => {
        handleCreateUserAccountAction();
    });
}

function handleCreateUserAccountAction() {
    const username = document.getElementById('new-user-name').value.trim();
    const password = document.getElementById('new-user-pass').value;
    const role = document.getElementById('new-user-role').value;

    fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            showToast(`User account for ${username} created!`);
            document.getElementById('create-user-form').reset();
            loadSystemUsers();
        } else {
            showToast(res.error || 'Failed to create user account.', 'error');
        }
    });
}

function deleteUserAccount(id) {
    openSecurityModal(() => {
        fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    showToast('User account deleted.');
                    loadSystemUsers();
                } else {
                    showToast(res.error || 'Failed to delete account.', 'error');
                }
            });
    });
}

function selectBadge(value, btnElement) {
    // Remove active class from siblings
    const parent = btnElement.parentElement;
    parent.querySelectorAll('.pill-btn').forEach(btn => btn.classList.remove('active'));
    
    // Add active to clicked
    btnElement.classList.add('active');
    
    // Update hidden input value
    document.getElementById('selected-badge-input').value = value;
}

// Toggle custom dropdown open/close state
function toggleCustomDropdown(triggerEl) {
    const parent = triggerEl.closest('.custom-dropdown');
    
    // Close any other open dropdowns first
    document.querySelectorAll('.custom-dropdown.open').forEach(dd => {
        if (dd !== parent) dd.classList.remove('open');
    });
    
    parent.classList.toggle('open');
}

// Option selection handler
function selectCustomOption(optionEl, value) {
    const parent = optionEl.closest('.custom-dropdown');
    
    // Update displayed label
    parent.querySelector('.dropdown-selected-text').textContent = optionEl.textContent;
    
    // Update hidden input for form submission
    const hiddenInput = parent.querySelector('input[type="hidden"]');
    if (hiddenInput) hiddenInput.value = value;
    
    // Update active highlight style
    parent.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('active'));
    optionEl.classList.add('active');
    
    // Close dropdown
    parent.classList.remove('open');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(dd => dd.classList.remove('open'));
    }
});

// Generic Custom Dropdown Option Handler
function selectCustomOption(optionEl, value, hiddenInputId) {
    const parent = optionEl.closest('.custom-dropdown');
    
    // Update displayed title
    parent.querySelector('.dropdown-selected-text').textContent = optionEl.textContent;
    
    // Set hidden input value
    if (hiddenInputId) {
        const input = document.getElementById(hiddenInputId);
        if (input) input.value = value;
    } else {
        const hiddenInput = parent.querySelector('input[type="hidden"]');
        if (hiddenInput) hiddenInput.value = value;
    }
    
    // Active class styling
    parent.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('active'));
    optionEl.classList.add('active');
    
    // Close dropdown
    parent.classList.remove('open');
}

// Toggle Dropdown Menu
function toggleCustomDropdown(triggerEl) {
    const parent = triggerEl.closest('.custom-dropdown');
    document.querySelectorAll('.custom-dropdown.open').forEach(dd => {
        if (dd !== parent) dd.classList.remove('open');
    });
    parent.classList.toggle('open');
}

// Close Dropdowns on Outside Click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(dd => dd.classList.remove('open'));
    }
});

// Pill Selector Helper
function updatePillSelection(btnElement, hiddenInputId, value) {
    const parent = btnElement.parentElement;
    parent.querySelectorAll('.pill-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    
    const input = document.getElementById(hiddenInputId);
    if (input) {
        input.value = value;
        // Trigger change event if listeners exist
        input.dispatchEvent(new Event('change'));
    }
}

// Specific Pill Functions
function selectStoreStatusPill(val, btn) {
    updatePillSelection(btn, 'setting-store-status', val);
    if (typeof updateStoreStatusPreview === 'function') updateStoreStatusPreview();
}

function selectShiftPeriodPill(val, btn) {
    updatePillSelection(btn, 'audit-shift', val);
}

function selectWasteReasonPill(val, btn) {
    updatePillSelection(btn, 'waste-reason', val);
}

function filterSpillageTypePill(val, btn) {
    updatePillSelection(btn, 'spillage-type-filter', val);
    if (typeof loadWastageLogs === 'function') loadWastageLogs();
}

function selectUserRolePill(val, btn) {
    updatePillSelection(btn, 'new-user-role', val);
}

// Populate Dynamic Container Item Dropdowns (e.g., Stock In, Wastage, Audit)
// Populate Dynamic Container Item Dropdowns across Supply Operations
function populateDynamicContainerDropdowns(containers) {
    const dropdownTargets = [
        { menuId: 'stockin-inventory-menu-options', hiddenId: 'stockin-inventory-id' },
        { menuId: 'audit-inventory-menu-options', hiddenId: 'audit-inventory-id' },
        { menuId: 'waste-inventory-menu-options', hiddenId: 'waste-inventory-id' }
    ];

    dropdownTargets.forEach(target => {
        const menuEl = document.getElementById(target.menuId);
        if (!menuEl) return;

        menuEl.innerHTML = ''; // Clear old content
        
        if (!containers || containers.length === 0) {
            menuEl.innerHTML = '<div class="dropdown-option">No containers available</div>';
            return;
        }

        containers.forEach(item => {
            const opt = document.createElement('div');
            opt.className = 'dropdown-option';
            opt.textContent = `${item.item_name || item.name} (Current: ${item.stock_quantity ?? item.quantity} ${item.container_unit || item.unit})`;
            opt.onclick = function() {
                selectCustomOption(this, item.id, target.hiddenId);
            };
            menuEl.appendChild(opt);
        });
    });
}

// Toggle between Active Claims and Redeemed History
function switchPromoSubTab(subName, btn) {
    const activePane = document.getElementById('promo-subtab-active');
    const historyPane = document.getElementById('promo-subtab-history');
    
    document.querySelectorAll('#tab-cashier .sub-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    if (subName === 'active') {
        if (activePane) activePane.style.display = 'block';
        if (historyPane) historyPane.style.display = 'none';
        loadActiveVouchers();
    } else {
        if (activePane) activePane.style.display = 'none';
        if (historyPane) historyPane.style.display = 'block';
        loadRedeemedVoucherHistory();
    }
}

function loadRedeemedVoucherHistory() {
    fetch('/api/admin/promo-codes/history')
        .then(res => res.json())
        .then(data => {
            const tableBody = document.getElementById('history-vouchers-table-body');
            if (!tableBody) return;
            
            if (!Array.isArray(data) || data.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888; padding:15px;">No redeemed promo vouchers recorded in history.</td></tr>';
                return;
            }
            
            tableBody.innerHTML = data.map(v => `
                <tr>
                    <td data-label="Voucher Code"><span class="code-badge" style="background:var(--secondary);">${escapeHtml(v.code)}</span></td>
                    <td data-label="Customer Name"><strong>${escapeHtml(v.customer_name)}</strong></td>
                    <td data-label="Social Handle">${escapeHtml(v.social_handle || 'N/A')}</td>
                    <td data-label="Claimed Date">${v.created_at ? formatLocalDate(v.created_at) : 'N/A'}</td>
                    <td data-label="Redeemed Date">
                        <span class="badge-audit-green">
                            ${v.redeemed_at ? new Date(v.redeemed_at).toLocaleString() : 'N/A'}
                        </span>
                    </td>
                    <td data-label="Redeemed By"><strong><i class="fa-solid fa-user-check"></i> ${escapeHtml(v.redeemed_by || 'Staff / Cashier')}</strong></td>
                </tr>
            `).join('');
        })
        .catch(err => console.error('Error loading promo history:', err));
}

function formatLocalDate(dateStr) {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    let isoStr = dateStr;
    // If SQLite naive datetime string lacks 'Z' or offset, append 'Z' for accurate UTC parsing
    if (!isoStr.endsWith('Z') && !isoStr.includes('+') && !isoStr.includes('-', 10)) {
        isoStr = isoStr.replace(' ', 'T') + 'Z';
    }
    return new Date(isoStr).toLocaleString();
}