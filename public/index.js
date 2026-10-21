/* ===========================================================================
   CAFE DE MELLE - PUBLIC FRONTEND CORE ENGINE (index.js)
   =========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initStoreStatusAndHours();
  initHeroBannerSlider();
  initMenuSystem();
  initItemDetailModal();
  initAboutCarousel();
  initAboutStatsCounter();
  initPromoForm();
  initPrivacyModal();
  trackPageVisit();
});

setInterval(async () => {
    try {
      const menuRes = await fetch('/api/menu');
      if (menuRes.ok) {
        allMenuItems = await menuRes.json();
        filterAndRenderMenu(
          document.getElementById('menu-search') ? document.getElementById('menu-search').value.toLowerCase().trim() : '',
          getCurrentActiveCategory()
        );
      }
      initStoreStatusAndHours();
    } catch (err) {
      // Silent catch for background polling
    }
  }, 10000);
;
/* ===========================================================================
   1. NAVBAR & NAVIGATION (STICKY ACTIVE LINK HIGHLIGHTING & SMOOTH SCROLL)
   =========================================================================== */
function initNavbar() {
  const hamburger = document.getElementById('hamburger-btn');
  const navLinks = document.getElementById('nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      navLinks.classList.toggle('active');
    });

    const links = navLinks.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
      });
    });

    document.addEventListener('click', (e) => {
      if (!navLinks.contains(e.target) && !hamburger.contains(e.target)) {
        navLinks.classList.remove('active');
      }
    });
  }

  const sections = document.querySelectorAll('section, header');
  const navItems = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPos = window.scrollY + 120;

    sections.forEach(section => {
      if (section.id) {
        const top = section.offsetTop;
        const height = section.offsetHeight;
        if (scrollPos >= top && scrollPos < top + height) {
          current = section.id;
        }
      }
    });

    navItems.forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('href') === `#${current}`) {
        item.classList.add('active');
      }
    });
  });
}

/* ===========================================================================
   2. STORE STATUS & OPERATING HOURS
   =========================================================================== */
async function initStoreStatusAndHours() {
  const badge = document.getElementById('store-status-badge') || document.getElementById('store-status');
  const banner = document.getElementById('notice-banner');

  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed to fetch settings');
    const config = await res.json();

    const openTime = config.open_time || '09:00';
    const closeTime = config.close_time || '02:00';
    const mode = (config.store_status || 'AUTO').toUpperCase();
    const notice = config.notice_message || '';
    const closureStart = config.closure_start;
    const closureEnd = config.closure_end;

    const hoursDisplay = document.getElementById('store-hours-display');
    if (hoursDisplay) {
      hoursDisplay.textContent = `${formatTime(openTime)} - ${formatTime(closeTime)}`;
    }

    if (banner && notice) {
      banner.style.display = 'block';
      banner.textContent = notice;
    } else if (banner) {
      banner.style.display = 'none';
    }

    let isOpen = false;
    const now = Date.now();

    // 1. Check Temporary Closure / Private Event / Emergency block first
    let isTemporarilyClosed = false;
    if (closureStart && closureEnd) {
      const startMs = new Date(closureStart).getTime();
      const endMs = new Date(closureEnd).getTime();
      if (!isNaN(startMs) && !isNaN(endMs) && now >= startMs && now <= endMs) {
        isTemporarilyClosed = true;
      }
    }

    if (isTemporarilyClosed) {
      isOpen = false;
    } else if (mode === 'FORCE_OPEN' || mode === 'OPEN') {
      isOpen = true;
    } else if (mode === 'FORCE_CLOSED' || mode === 'CLOSED') {
      isOpen = false;
    } else {
      // 2. Automated Schedule Check
      const currentDate = new Date();
      const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();

      const [oH, oM] = openTime.split(':').map(Number);
      const [cH, cM] = closeTime.split(':').map(Number);

      const openMinutes = oH * 60 + oM;
      let closeMinutes = cH * 60 + cM;

      if (closeMinutes <= openMinutes) {
        closeMinutes += 24 * 60;
      }

      let checkMinutes = currentMinutes;
      if (checkMinutes < openMinutes && closeMinutes > 24 * 60) {
        checkMinutes += 24 * 60;
      }

      isOpen = checkMinutes >= openMinutes && checkMinutes < closeMinutes;
    }

    if (badge) {
      if (isOpen) {
        badge.className = 'status-badge open';
        badge.textContent = 'OPEN NOW';
      } else {
        badge.className = 'status-badge closed';
        badge.textContent = isTemporarilyClosed ? 'CLOSED (PRIVATE EVENT)' : 'CLOSED';
      }
    }
  } catch (err) {
    console.error('Error initializing store status:', err);
    if (badge) {
      badge.className = 'status-badge open';
      badge.textContent = 'OPEN NOW';
    }
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

/* ===========================================================================
   3. HERO BANNER SLIDER
   =========================================================================== */
let currentSlideIndex = 0;
let slideInterval = null;
let touchStartX = 0;
let touchEndX = 0;

async function initHeroBannerSlider() {
  const track = document.getElementById('hero-slider-track');
  const dotsContainer = document.getElementById('slider-dots') || document.getElementById('hero-dots');

  if (!track) return;

  try {
    const res = await fetch('/api/hero-slides');
    if (!res.ok) throw new Error('Failed to load slides');
    const slides = await res.json();

    if (!slides || slides.length === 0) {
      renderDefaultHeroSlide(track);
      return;
    }

    track.innerHTML = '';
    if (dotsContainer) dotsContainer.innerHTML = '';

    slides.forEach((slide, idx) => {
      const slideDiv = document.createElement('div');
      slideDiv.className = `hero-slide ${idx === 0 ? 'active' : ''}`;
      slideDiv.style.backgroundImage = `url('${slide.image || slide.image_url || 'images/Logo.jpg'}')`;

      slideDiv.innerHTML = `
        <div class="hero-overlay"></div>
        <div class="hero-content">
          ${slide.tag ? `<span class="hero-tag">${escapeHTML(slide.tag)}</span>` : ''}
          <h1>${escapeHTML(slide.title)}</h1>
          ${slide.subtitle ? `<p>${escapeHTML(slide.subtitle)}</p>` : ''}
        </div>
      `;

      track.appendChild(slideDiv);

      if (dotsContainer && slides.length > 1) {
        const dot = document.createElement('span');
        dot.className = `dot ${idx === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToSlide(idx, slides.length));
        dotsContainer.appendChild(dot);
      }
    });

    if (slides.length > 1) {
      startAutoSlide(slides.length);
      setupTouchSwipe(slides.length);
    }
  } catch (err) {
    console.error('Error loading hero slides:', err);
    const slidesCount = track.children.length;
    if (slidesCount > 1) {
      startAutoSlide(slidesCount);
      setupTouchSwipe(slidesCount);
    }
  }
}

function renderDefaultHeroSlide(track) {
  track.innerHTML = `
    <div class="hero-slide active" style="background-image: url('images/kgb.jpeg');">
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <span class="hero-tag">Welcome</span>
        <h1>Experience Premium Artisanal Coffee & Korean Buns</h1>
        <p>Crafted with passion in Caloocan. Taste the perfect brew everyday.</p>
      </div>
    </div>
  `;
}

function goToSlide(index, total) {
  const track = document.getElementById('hero-slider-track');
  const dots = document.querySelectorAll('.slider-dots .dot, #hero-dots .dot');

  if (index < 0) {
    currentSlideIndex = total - 1;
  } else if (index >= total) {
    currentSlideIndex = 0;
  } else {
    currentSlideIndex = index;
  }

  if (track) {
    track.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
  }

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentSlideIndex);
  });
}

function setSlide(index) {
  const track = document.getElementById('hero-slider-track');
  const total = track ? track.children.length : 0;
  if (total > 0) {
    goToSlide(index, total);
    startAutoSlide(total);
  }
}

function startAutoSlide(total) {
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(() => {
    goToSlide((currentSlideIndex + 1) % total, total);
  }, 5000);
}

function setupTouchSwipe(total) {
  const slider = document.getElementById('hero-slider') || document.getElementById('hero-slider-track');
  if (!slider) return;

  slider.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  slider.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture(total);
  }, { passive: true });
}

function handleSwipeGesture(total) {
  const swipeThreshold = 40;
  if (touchEndX < touchStartX - swipeThreshold) {
    goToSlide(currentSlideIndex + 1, total);
    startAutoSlide(total);
  } else if (touchEndX > touchStartX + swipeThreshold) {
    goToSlide(currentSlideIndex - 1, total);
    startAutoSlide(total);
  }
}

/* ===========================================================================
   4. MENU SYSTEM & IMAGE RENDERING
   =========================================================================== */
let allMenuItems = [];

async function initMenuSystem() {
  const grid = document.getElementById('menu-grid');
  const searchInput = document.getElementById('menu-search');
  const filterBtns = document.querySelectorAll('.filter-btn');

  if (!grid) return;

  try {
    const res = await fetch('/api/menu');
    if (!res.ok) throw new Error('Failed to fetch menu');
    allMenuItems = await res.json();

    renderMenuItems(allMenuItems);
  } catch (err) {
    console.error('Error fetching menu items:', err);
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      filterAndRenderMenu(query, getCurrentActiveCategory());
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.getAttribute('data-category');
      const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
      filterAndRenderMenu(query, category);
    });
  });
}

function getCurrentActiveCategory() {
  const activeBtn = document.querySelector('.filter-btn.active');
  return activeBtn ? activeBtn.getAttribute('data-category') : 'all';
}

function filterAndRenderMenu(searchQuery, category) {
  if (allMenuItems && allMenuItems.length > 0) {
    const filtered = allMenuItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery) ||
                            (item.description && item.description.toLowerCase().includes(searchQuery));
      // WITH THIS ROBUST MATCHING LOGIC:
      const itemCat = (item.category || '').toLowerCase().trim();
      const filterCat = category.toLowerCase().trim();
      const cleanFilterCat = filterCat.replace(/-/g, ' ');
      
      let matchesCategory = (filterCat === 'all');
      if (!matchesCategory) {
        if (cleanFilterCat === 'iced coffee' || cleanFilterCat === 'cold coffee') {
          matchesCategory = itemCat.includes('iced') || itemCat.includes('cold');
        } else if (cleanFilterCat === 'hot coffee') {
          matchesCategory = itemCat.includes('hot');
        } else if (cleanFilterCat === 'non coffee') {
          matchesCategory = itemCat.includes('non');
        } else if (cleanFilterCat === 'pastry' || cleanFilterCat === 'pastries') {
          matchesCategory = itemCat.includes('pastr');
        } else if (cleanFilterCat === 'soda' || cleanFilterCat === 'fruit sodas') {
          matchesCategory = itemCat.includes('soda') || itemCat.includes('fruit');
        } else {
          matchesCategory = itemCat === cleanFilterCat || itemCat.includes(cleanFilterCat);
        }
      }

      return matchesSearch && matchesCategory;

    });

    renderMenuItems(filtered);
  } else {
    const cards = document.querySelectorAll('#menu-grid .card');
    cards.forEach(card => {
      const cardCategory = card.getAttribute('data-category') || '';
      const text = card.textContent.toLowerCase();

      const matchesSearch = text.includes(searchQuery);
      const matchesCategory = category === 'all' || cardCategory.toLowerCase() === category.toLowerCase();

      if (matchesSearch && matchesCategory) {
        card.classList.remove('hide');
      } else {
        card.classList.add('hide');
      }
    });
  }
}

function renderMenuItems(items) {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = '<p class="text-center" style="grid-column: 1/-1; padding: 40px; color: #777;">No matching menu items found.</p>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const isAvailable = item.is_available === 1 || item.is_available === true;
    const badgeHTML = getBadgeHTML(item.badge);
    const imagePath = item.image_url || item.image || 'images/Logo.jpg';

    return `
      <div class="card ${!isAvailable ? 'out-of-stock' : ''}" data-id="${item.id}" data-category="${escapeHTML(item.category || '')}" onclick="openItemDetailModal(${item.id})">
        ${badgeHTML}
        ${!isAvailable ? '<div class="stock-overlay">Out of Stock</div>' : ''}
        <div class="card-img-container">
          <img src="${escapeHTML(imagePath)}" alt="${escapeHTML(item.name)}" onerror="this.src='images/Logo.jpg';">
        </div>
        <div class="card-info">
          <h4>${escapeHTML(item.name)}</h4>
          <p>${escapeHTML(item.description || 'Specialty Cafe Item')}</p>
          <div class="card-footer-row">
            <span class="price">₱${item.price}</span>
            <button class="view-item-btn">View Details</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getBadgeHTML(badge) {
  if (!badge) return '';
  const rawBadge = badge.toString().toLowerCase().trim();
  
  if (rawBadge === 'signature') {
    return `
      <span class="card-badge" title="Cafe Signature">
        <i class="fa-solid fa-heart badge-signature-icon"></i>
      </span>
    `;
  }
  if (rawBadge === 'favorite') {
    return `
      <span class="card-badge" title="Customer Favorite">
        <i class="fa-solid fa-star badge-favorite-icon"></i>
      </span>
    `;
  }
  return '';
}

/* ===========================================================================
   5. MENU ITEM DETAIL MODAL (CATEGORY-AWARE & AUTO-DISMISS GRAB)
   =========================================================================== */
function initItemDetailModal() {
  const modal = document.getElementById('item-detail-modal');
  const closeBtn = document.getElementById('close-item-modal-btn');
  const closeActionBtn = document.getElementById('modal-close-action-btn');
  const grabBtn = document.getElementById('modal-order-grab-btn');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeItemDetailModal);
  }

  if (closeActionBtn) {
    closeActionBtn.addEventListener('click', closeItemDetailModal);
  }

  if (grabBtn) {
    grabBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeItemDetailModal();
      const grabSection = document.getElementById('grab');
      if (grabSection) {
        grabSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeItemDetailModal();
    });
  }
}

function openItemDetailModal(itemId) {
  const modal = document.getElementById('item-detail-modal');
  if (!modal) return;

  const item = allMenuItems.find(m => m.id === itemId);
  if (!item) return;

  const img = document.getElementById('modal-item-img');
  const badge = document.getElementById('modal-item-badge');
  const category = document.getElementById('modal-item-category');
  const name = document.getElementById('modal-item-name');
  const desc = document.getElementById('modal-item-desc');
  const optionsContainer = document.getElementById('modal-options-container');

  fetch(`/api/menu/${itemId}/view`, { method: 'POST' }).catch(() => {});

  if (img) img.src = item.image_url || item.image || 'images/Logo.jpg';
  if (category) category.textContent = item.category || 'Specialty';
  if (name) name.textContent = item.name;
  if (desc) desc.textContent = item.description || 'No description available.';

  if (badge) {
    const rawBadge = (item.badge || '').toString().toLowerCase().trim();
    if (rawBadge === 'signature') {
      badge.className = 'item-detail-badge';
      badge.innerHTML = '<i class="fa-solid fa-heart badge-signature-icon"></i> Cafe Signature';
      badge.classList.remove('hide');
    } else if (rawBadge === 'favorite') {
      badge.className = 'item-detail-badge';
      badge.innerHTML = '<i class="fa-solid fa-star badge-favorite-icon"></i> Customer Favorite';
      badge.classList.remove('hide');
    } else {
      badge.className = 'item-detail-badge hide';
      badge.innerHTML = '';
    }
  }

  // Category-Aware Content Inspection & Dynamic Swapping
  if (optionsContainer) {
    const catLower = (item.category || '').toLowerCase();
    if (catLower === 'pastry' || catLower === 'pastries') {
      optionsContainer.innerHTML = `
        <h5 class="options-heading"><i class="fa-solid fa-bread-slice"></i> Serving & Freshness Note</h5>
        <p style="font-size:0.85rem; color:#555; margin:0; line-height:1.4;">Baked fresh daily in our kitchen. Best enjoyed warm on the same day of purchase.</p>
      `;
    } else {
      optionsContainer.innerHTML = `
        <h5 class="options-heading"><i class="fa-solid fa-mug-hot"></i> Sizes & Pricing</h5>
        <div class="size-options-list" id="modal-size-list">
            <div class="size-option-pill active">
                <span>Regular / Medium (16oz)</span>
                <strong id="modal-item-price">₱${item.price}</strong>
            </div>
            <div class="size-option-pill">
                <span>Large / Up-Size (22oz)</span>
                <strong>+₱20</strong>
            </div>
        </div>
      `;
    }
  }

  modal.classList.remove('hide');
}

function closeItemDetailModal() {
  const modal = document.getElementById('item-detail-modal');
  if (modal) modal.classList.add('hide');
}

/* ===========================================================================
   6. ABOUT US CAROUSEL & STATS COUNTER
   =========================================================================== */
let currentAboutSlide = 0;

function initAboutCarousel() {
  const prevBtn = document.getElementById('about-prev');
  const nextBtn = document.getElementById('about-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => changeAboutSlide(-1));
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => changeAboutSlide(1));
  }
}

function changeAboutSlide(direction) {
  const slides = document.querySelectorAll('.about-slide');
  const dots = document.querySelectorAll('.about-dot');
  if (slides.length === 0) return;

  currentAboutSlide = (currentAboutSlide + direction + slides.length) % slides.length;

  slides.forEach((slide, idx) => {
    slide.classList.toggle('active', idx === currentAboutSlide);
  });

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentAboutSlide);
  });
}

function setAboutSlide(index) {
  const slides = document.querySelectorAll('.about-slide');
  const dots = document.querySelectorAll('.about-dot');
  if (slides.length === 0) return;

  currentAboutSlide = index;

  slides.forEach((slide, idx) => {
    slide.classList.toggle('active', idx === currentAboutSlide);
  });

  dots.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentAboutSlide);
  });
}

function initAboutStatsCounter() {
  const stats = document.querySelectorAll('.stat-number');
  let animated = false;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !animated) {
        animated = true;
        stats.forEach(stat => {
          const target = parseInt(stat.getAttribute('data-target') || '0', 10);
          let current = 0;
          const increment = Math.ceil(target / 40);
          const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
              stat.textContent = target;
              clearInterval(timer);
            } else {
              stat.textContent = current;
            }
          }, 30);
        });
      }
    });
  }, { threshold: 0.5 });

  const statsSection = document.querySelector('.stats-grid');
  if (statsSection) observer.observe(statsSection);
}

/* ===========================================================================
   7. PROMO VOUCHER & GATED REWARD SYSTEM (FIXED ENDPOINT URL & PAYLOAD)
   =========================================================================== */
let voucherTimerInterval = null;

function initPromoForm() {
  const followLinks = document.querySelectorAll('.social-follow-link');
  const claimBtn = document.getElementById('claim-promo-btn');
  const claimBtnText = document.getElementById('claim-btn-text');
  const claimBtnIcon = document.getElementById('claim-btn-icon');
  const promoForm = document.getElementById('promo-form');

  followLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (claimBtn) {
        claimBtn.removeAttribute('disabled');
        claimBtn.title = 'Click to open the voucher claim form!';
        if (claimBtnText) claimBtnText.textContent = 'Claim Your Free Drink Up-Size Voucher!';
        if (claimBtnIcon) claimBtnIcon.className = 'fa-solid fa-gift';
      }
    });
  });

  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      if (promoForm) {
        promoForm.classList.remove('hide');
        claimBtn.style.display = 'none';
        promoForm.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  if (promoForm) {
    promoForm.addEventListener('submit', handlePromoSubmit);
  }
}

async function handlePromoSubmit(e) {
  e.preventDefault();

  const promoForm = e.target || document.getElementById('promo-form');
  const nameInput = document.getElementById('promo-name');
  const socialInput = document.getElementById('promo-social');
  const contactInput = document.getElementById('promo-contact');
  const privacyConsent = document.getElementById('promo-privacy-consent');
  const submitBtn = document.getElementById('submit-promo-btn');

  if (!privacyConsent || !privacyConsent.checked) {
    showPromoError('Please agree to the Terms & Privacy Policy to proceed.');
    return;
  }

  const customer_name = nameInput ? nameInput.value.trim() : '';
  const social_handle = socialInput ? socialInput.value.trim() : '';
  const contact_info = contactInput ? contactInput.value.trim() : '';

  if (!customer_name || !social_handle || !contact_info) {
    showPromoError('Please fill out all required fields.');
    return;
  }

  if (!/^09\d{9}$/.test(contact_info)) {
    showPromoError('Please enter a valid 11-digit PH phone number starting with 09.');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating Voucher...';
  }

  hidePromoMsg();

  try {
    const res = await fetch('/api/promo-codes/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name, social_handle, contact_info })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Failed to generate voucher.');
    }

    displayDigitalTicket(data.code || data.voucher_code, data.expires_at);

    if (promoForm) promoForm.classList.add('hide');
  } catch (err) {
    console.error('Error generating voucher:', err);
    showPromoError(err.message || 'Error generating voucher. Please try again.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit & Get Promo Code';
    }
  }
}

function showPromoError(message) {
  const promoMsg = document.getElementById('promo-msg');
  if (promoMsg) {
    promoMsg.className = 'promo-status-msg error';
    promoMsg.textContent = message;
    promoMsg.classList.remove('hide');
  }
}

function hidePromoMsg() {
  const promoMsg = document.getElementById('promo-msg');
  if (promoMsg) promoMsg.classList.add('hide');
}

let voucherStatusInterval = null;

function displayDigitalTicket(code, expiresAt) {
  const ticket = document.getElementById('digital-ticket');
  const codeDisplay = document.getElementById('ticket-code-display');
  const timerDisplay = document.getElementById('ticket-timer');

  if (codeDisplay) codeDisplay.textContent = code;
  if (ticket) ticket.classList.remove('hide');

  let expiryTime;
  if (expiresAt && !isNaN(new Date(expiresAt).getTime())) {
    expiryTime = new Date(expiresAt).getTime();
  } else {
    expiryTime = Date.now() + 30 * 60 * 1000;
  }

  if (voucherTimerInterval) clearInterval(voucherTimerInterval);

  voucherTimerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = expiryTime - now;

    if (remaining <= 0) {
      clearInterval(voucherTimerInterval);
      if (timerDisplay) timerDisplay.textContent = 'EXPIRED';
      if (voucherStatusInterval) clearInterval(voucherStatusInterval);
      return;
    }

    const minutes = Math.floor(remaining / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

    if (timerDisplay) {
      timerDisplay.textContent = `Countdown: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }, 1000);

  // 🔄 BACKGROUND POLLING: Check the server every 5 seconds to see if the cashier redeemed this ticket
  if (voucherStatusInterval) clearInterval(voucherStatusInterval);
  voucherStatusInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/promo-codes/status/${code}`);
      const data = await res.json();
      if (data.success && data.status === 'Redeemed') {
        if (timerDisplay) {
          timerDisplay.textContent = 'STATUS: REDEEMED SUCCESSFULLY! 🎉';
          timerDisplay.style.color = '#2e7d32';
        }
        if (voucherTimerInterval) clearInterval(voucherTimerInterval);
        clearInterval(voucherStatusInterval);
      }
    } catch (err) {
      // Silent catch for background checks
    }
  }, 5000);
}
/* ===========================================================================
   8. PRIVACY & TERMS MODAL
   =========================================================================== */
function initPrivacyModal() {
  const privacyModal = document.getElementById('privacy-modal');
  const closeBtn = document.getElementById('close-modal-btn');
  const agreeBtn = document.getElementById('modal-agree-btn');
  const openTermsLink = document.getElementById('open-terms-link');
  const openPrivacyLink = document.getElementById('open-privacy-link');

  const openModal = () => {
    if (privacyModal) privacyModal.classList.remove('hide');
  };

  const closeModal = () => {
    if (privacyModal) privacyModal.classList.add('hide');
  };

  if (openTermsLink) openTermsLink.addEventListener('click', openModal);
  if (openPrivacyLink) openPrivacyLink.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (agreeBtn) agreeBtn.addEventListener('click', closeModal);

  if (privacyModal) {
    privacyModal.addEventListener('click', (e) => {
      if (e.target === privacyModal) closeModal();
    });
  }
}

/* ===========================================================================
   9. UTILITY FUNCTIONS
   =========================================================================== */
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function trackPageVisit() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let source = urlParams.get('utm_source');
    if (!source) {
      const ref = document.referrer.toLowerCase();
      if (ref.includes('facebook.com')) source = 'facebook';
      else if (ref.includes('google.com') && ref.includes('maps')) source = 'google_maps';
      else if (ref.includes('google.com')) source = 'google_search';
      else if (ref.includes('instagram.com')) source = 'instagram';
      else if (ref.includes('tiktok.com')) source = 'tiktok';
      else source = 'direct';
    }
    fetch('/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source })
    }).catch(() => {}); // Fail silently if offline so it never breaks landing performance
  } catch (e) {}
}