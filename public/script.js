'use strict';
/* ============================================================
   VAMP SHMOT — фронтенд
   Работает поверх REST API из server.js. Все состояния (корзина,
   избранное, токен) хранятся в localStorage.
   ============================================================ */

/* ================= СОСТОЯНИЕ ================= */
let TOKEN = localStorage.getItem('token') || null;
let CURRENT_USER = null;
let CATEGORIES = [];
let BRANDS = [];
let BADGES = [];
let CART = safeParse(localStorage.getItem('cart'), []);
let FAVORITES = safeParse(localStorage.getItem('favorites'), []);
let CURRENT_PRODUCT = null;
let CURRENT_IMAGE_IDX = 0;
let SELECTED_SIZE = null;
let CURRENT_QTY = 1;
let RESERVE_ENABLED = false;
let CURRENT_FILTERS = { category: '', sort: 'recommended' };
let CURRENT_PRODUCT_PHOTOS = [];
let CURRENT_BRAND_LOGO = '';
let CURRENT_SLIDE_IMG = '';
let SLIDES = [];
let SLIDE_IDX = 0;
let slideTimer = null;
let chatES = null;
let authMode = 'login';

function safeParse(str, fallback) {
    try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) { return Math.round(n || 0).toLocaleString('ru-RU') + ' ₽'; }
function saveCart() { localStorage.setItem('cart', JSON.stringify(CART)); updateCartCount(); }
function saveFavorites() { localStorage.setItem('favorites', JSON.stringify(FAVORITES)); updateFavCount(); }

/* ================= API ================= */
async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса (' + res.status + ')');
    return data;
}

/* ================= TOASTS ================= */
function toast(text, type) {
    type = type || 'info';
    const box = document.getElementById('toast-container');
    if (!box) { console.log(text); return; }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${esc(text)}</span><button class="toast-close" aria-label="Закрыть">✕</button>`;
    el.querySelector('.toast-close').onclick = () => removeToast(el);
    box.appendChild(el);
    setTimeout(() => removeToast(el), 4000);
}
function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 300);
}

/* ================= ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ ================= */
const PAGE_IDS = ['fav-view', 'product-view', 'brands-view', 'brand-view', 'cart-view', 'my-orders-view', 'contacts-view', 'admin-view'];
function hideAllPages() {
    const hero = document.querySelector('.hero');
    const catalogSection = document.getElementById('catalog-section');
    if (hero) hero.style.display = 'none';
    if (catalogSection) catalogSection.style.display = 'none';
    PAGE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'none';
        el.classList.remove('active');
    });
}
function showPage(id) {
    hideAllPages();
    const el = document.getElementById(id);
    if (el) { el.style.display = 'block'; el.classList.add('active'); }
    window.scrollTo(0, 0);
}
function showCatalog() {
    hideAllPages();
    const hero = document.querySelector('.hero');
    const catalogSection = document.getElementById('catalog-section');
    if (hero) hero.style.display = '';
    if (catalogSection) catalogSection.style.display = '';
    loadProducts();
    window.scrollTo(0, 0);
}
function showFavorites() { showPage('fav-view'); renderFavorites(); }
function showCart() { showPage('cart-view'); renderCart(); }
function showBrands() { showPage('brands-view'); loadBrands(true); }
function showContacts() { showPage('contacts-view'); loadContacts(); }
function showMyOrders() {
    if (!TOKEN) { toast('Войдите, чтобы посмотреть заказы', 'info'); openAuthModal('login'); return; }
    showPage('my-orders-view');
    loadMyOrders();
}
async function showAdmin() {
    if (!CURRENT_USER || CURRENT_USER.role !== 'admin') { toast('Доступ только для администратора', 'error'); return; }
    showPage('admin-view');
    await loadAdminEverything();
}

/* ================= КАТЕГОРИИ / БРЕНДЫ / БЕЙДЖИ (общие справочники) ================= */
async function loadCategories() {
    try {
        CATEGORIES = await api('/api/categories');
    } catch (e) { CATEGORIES = []; }
    fillSelect('category-select', CATEGORIES, 'Все категории');
    fillSelect('filterCategory', CATEGORIES, 'Все категории');
    fillSelect('f-category', CATEGORIES, '— без категории —');
}
function fillSelect(id, items, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${esc(placeholder)}</option>` + items.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if ([...sel.options].some(o => o.value === current)) sel.value = current;
}
async function loadBrandsRef() {
    try { BRANDS = await api('/api/brands'); } catch (e) { BRANDS = []; }
    const sel = document.getElementById('f-brand');
    if (sel) {
        const current = sel.value;
        sel.innerHTML = '<option value="">— без бренда —</option>' + BRANDS.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
        if ([...sel.options].some(o => o.value === current)) sel.value = current;
    }
}
async function loadBadgesRef() {
    try { BADGES = await api('/api/badges'); } catch (e) { BADGES = []; }
}

/* ================= КАТАЛОГ ================= */
function onCategoryChange(v) { CURRENT_FILTERS.category = v; syncFilterUI(); loadProducts(); }
function onSortChange(v) { CURRENT_FILTERS.sort = v; syncFilterUI(); loadProducts(); }
function resetFilters() {
    CURRENT_FILTERS = { category: '', sort: 'recommended' };
    syncFilterUI();
    loadProducts();
}
function syncFilterUI() {
    const cs = document.getElementById('category-select'); if (cs) cs.value = CURRENT_FILTERS.category;
    const ss = document.getElementById('sort-select'); if (ss) ss.value = CURRENT_FILTERS.sort;
    const fc = document.getElementById('filterCategory'); if (fc) fc.value = CURRENT_FILTERS.category;
    const fs = document.getElementById('filterSort'); if (fs) fs.value = mapSortToBurger(CURRENT_FILTERS.sort);
}
function mapSortToBurger(v) {
    if (v === 'cheap') return 'price_asc';
    if (v === 'expensive') return 'price_desc';
    if (v === 'new') return 'new';
    return 'recommended';
}
function mapBurgerToSort(v) {
    if (v === 'price_asc') return 'cheap';
    if (v === 'price_desc') return 'expensive';
    if (v === 'new') return 'new';
    return 'recommended';
}

async function loadProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="padding:40px;text-align:center;color:#888;">Загрузка...</p>';
    const params = new URLSearchParams();
    if (CURRENT_FILTERS.category) params.set('category', CURRENT_FILTERS.category);
    if (CURRENT_FILTERS.sort) params.set('sort', CURRENT_FILTERS.sort);
    let products = [];
    try { products = await api('/api/products?' + params.toString()); } catch (e) { grid.innerHTML = '<p>Не удалось загрузить товары.</p>'; return; }
    const info = document.getElementById('filter-info');
    if (info) info.textContent = products.length ? `Найдено товаров: ${products.length}` : '';
    if (!products.length) { grid.innerHTML = '<p style="padding:40px;text-align:center;color:#888;">Товары не найдены.</p>'; return; }
    grid.innerHTML = products.map(productCardHtml).join('');
}
function productCardHtml(p) {
    const img = (p.images && p.images[0]) || '';
    const outOfStock = p.stock_status === 'out_of_stock' || (p.stock === 0 && p.stock_status !== 'coming_soon');
    let badge = '';
    if (p.discount > 0) badge = `<div class="badge badge-discount">-${p.discount}%</div>`;
    else if (p.is_new) badge = `<div class="badge badge-new">Новинка</div>`;
    const priceHtml = p.discount > 0
        ? `<span style="text-decoration:line-through;color:#999;font-size:14px;">${money(p.price)}</span> ${money(p.final_price)}`
        : money(p.price);
    return `
    <div class="product-card${outOfStock ? ' out-of-stock' : ''}" onclick="openProduct(${p.id})">
        ${badge}
        <img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy">
        <h3>${esc(p.name)}</h3>
        <div class="price">${priceHtml}</div>
        <button class="btn" onclick="event.stopPropagation();quickAddToCart(${p.id})">${outOfStock ? 'Нет в наличии' : 'В корзину'}</button>
    </div>`;
}
async function quickAddToCart(id) {
    try {
        const p = await api('/api/products/' + id);
        addToCartInternal(p, (p.sizes && p.sizes[0]) || null, 1);
        toast('Добавлено в корзину', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ================= СТРАНИЦА ТОВАРА ================= */
async function openProduct(id) {
    showPage('product-view');
    try {
        CURRENT_PRODUCT = await api('/api/products/' + id);
    } catch (e) { toast('Товар не найден', 'error'); showCatalog(); return; }
    CURRENT_IMAGE_IDX = 0;
    CURRENT_QTY = 1;
    SELECTED_SIZE = (CURRENT_PRODUCT.sizes && CURRENT_PRODUCT.sizes[0]) || null;
    renderProductPage();
    loadReviews(id);
    loadRelated(id);
}
function renderProductPage() {
    const p = CURRENT_PRODUCT;
    if (!p) return;
    document.getElementById('pv-brand').textContent = (p.brand && p.brand.name) || '';
    document.getElementById('pv-name').textContent = p.name;
    document.getElementById('pv-price').innerHTML = p.discount > 0
        ? `<span style="text-decoration:line-through;color:#999;font-size:16px;">${money(p.price)}</span> ${money(p.final_price)}`
        : money(p.price);
    document.getElementById('pv-description').textContent = p.description || 'Без описания.';
    const specsEl = document.getElementById('pv-specs');
    specsEl.innerHTML = (p.specs && p.specs.length)
        ? p.specs.map(s => `<div><strong>${esc(s.label || s.key || '')}:</strong> ${esc(s.value || '')}</div>`).join('')
        : '—';

    const imgs = (p.images && p.images.length) ? p.images : [''];
    document.getElementById('pv-image').src = imgs[CURRENT_IMAGE_IDX] || '';
    document.getElementById('pv-thumbs').innerHTML = imgs.map((im, i) =>
        `<img class="thumb${i === CURRENT_IMAGE_IDX ? ' active' : ''}" src="${esc(im)}" onclick="CURRENT_IMAGE_IDX=${i};renderProductPage()">`).join('');

    const sizesEl = document.getElementById('pv-sizes');
    if (p.sizes && p.sizes.length) {
        sizesEl.innerHTML = p.sizes.map(s => `<button class="size-btn${s === SELECTED_SIZE ? ' selected' : ''}" onclick="selectSize('${esc(s)}')">${esc(s)}</button>`).join('');
    } else {
        sizesEl.innerHTML = '';
    }
    document.getElementById('pv-qty').textContent = CURRENT_QTY;

    const favBtnIcon = document.getElementById('fav-btn-icon');
    const favBtnLabel = document.getElementById('fav-btn-label');
    const isFav = FAVORITES.includes(p.id);
    if (favBtnIcon) favBtnIcon.setAttribute('fill', isFav ? '#8b0000' : 'none');
    if (favBtnLabel) favBtnLabel.textContent = isFav ? 'В избранном' : 'В избранное';

    const reserveBtn = document.querySelector('.reserve-btn');
    if (reserveBtn) reserveBtn.style.display = (RESERVE_ENABLED && (p.stock_status === 'out_of_stock' || p.stock === 0)) ? '' : 'none';

    const outOfStock = p.stock_status === 'out_of_stock' || (p.stock === 0 && p.stock_status !== 'coming_soon');
    const addBtn = document.querySelector('.add-to-cart-btn');
    const goBtn = document.querySelector('.go-to-checkout-btn');
    if (addBtn) { addBtn.disabled = outOfStock; addBtn.textContent = outOfStock ? 'Нет в наличии' : 'Добавить в корзину'; }
    if (goBtn) goBtn.style.display = outOfStock ? 'none' : '';
}
function selectSize(s) { SELECTED_SIZE = s; renderProductPage(); }
function changeQty(delta) {
    CURRENT_QTY = Math.max(1, CURRENT_QTY + delta);
    document.getElementById('pv-qty').textContent = CURRENT_QTY;
}
function prevProductImage() {
    if (!CURRENT_PRODUCT || !CURRENT_PRODUCT.images || !CURRENT_PRODUCT.images.length) return;
    CURRENT_IMAGE_IDX = (CURRENT_IMAGE_IDX - 1 + CURRENT_PRODUCT.images.length) % CURRENT_PRODUCT.images.length;
    renderProductPage();
}
function nextProductImage() {
    if (!CURRENT_PRODUCT || !CURRENT_PRODUCT.images || !CURRENT_PRODUCT.images.length) return;
    CURRENT_IMAGE_IDX = (CURRENT_IMAGE_IDX + 1) % CURRENT_PRODUCT.images.length;
    renderProductPage();
}
function toggleAccordion(btn) {
    const item = btn.closest('.accordion-item');
    item.classList.toggle('open-acc');
    const body = item.querySelector('.accordion-body');
    if (!body) return;
    body.style.maxHeight = body.style.maxHeight ? '' : (body.scrollHeight + 20) + 'px';
}
function addToCartInternal(p, size, qty) {
    const price = p.final_price != null ? p.final_price : p.price;
    const img = (p.images && p.images[0]) || '';
    const existing = CART.find(it => it.id === p.id && it.size === size);
    if (existing) existing.qty += qty;
    else CART.push({ id: p.id, name: p.name, price, size: size || null, qty, img });
    saveCart();
}
function addCurrentToCart() {
    if (!CURRENT_PRODUCT) return;
    addToCartInternal(CURRENT_PRODUCT, SELECTED_SIZE, CURRENT_QTY);
    toast('Добавлено в корзину', 'success');
}
function goToCheckout() {
    addCurrentToCart();
    showCart();
}
function reserveCurrentProduct() {
    if (!CURRENT_PRODUCT) return;
    addToCartInternal(CURRENT_PRODUCT, SELECTED_SIZE, CURRENT_QTY);
    showCart();
    setTimeout(() => {
        const cb = document.getElementById('checkout-reserve');
        if (cb) { cb.checked = true; toast('Отметьте оформление как бронирование ниже', 'info'); }
    }, 50);
}
function toggleFavorite() {
    if (!CURRENT_PRODUCT) return;
    const id = CURRENT_PRODUCT.id;
    const idx = FAVORITES.indexOf(id);
    if (idx >= 0) FAVORITES.splice(idx, 1); else FAVORITES.push(id);
    saveFavorites();
    renderProductPage();
}
function updateFavCount() { const el = document.getElementById('fav-count'); if (el) el.textContent = FAVORITES.length; }
function updateCartCount() { const el = document.getElementById('cart-count'); if (el) el.textContent = CART.reduce((s, i) => s + i.qty, 0); }

async function renderFavorites() {
    const grid = document.getElementById('fav-grid');
    const empty = document.getElementById('fav-empty');
    if (!FAVORITES.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    grid.innerHTML = '<p style="padding:20px;color:#888;">Загрузка...</p>';
    const items = [];
    for (const id of FAVORITES) {
        try { items.push(await api('/api/products/' + id)); } catch (e) {}
    }
    grid.innerHTML = items.map(productCardHtml).join('') || '<p style="padding:20px;color:#888;">Товары не найдены.</p>';
}

/* ================= ОТЗЫВЫ ================= */
let selectedReviewStars = 5;
async function loadReviews(productId) {
    let reviews = [];
    try { reviews = await api('/api/products/' + productId + '/reviews'); } catch (e) {}
    document.getElementById('rv-count').textContent = '(' + reviews.length + ')';
    const avg = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 5), 0) / reviews.length) : 0;
    document.getElementById('rv-avg').textContent = reviews.length ? '★ ' + avg.toFixed(1) : '';
    document.getElementById('reviews-list').innerHTML = reviews.map(r => `
        <div class="review-item">
            <div><strong>${esc(r.user_name)}</strong> <span style="color:#8b0000;">${'★'.repeat(r.rating || 5)}</span></div>
            <div>${esc(r.text)}</div>
            <div style="font-size:12px;color:#999;">${esc((r.created_at || '').replace('T', ' ').slice(0, 16))}</div>
        </div>`).join('') || '<p style="color:#999;">Пока нет отзывов.</p>';

    const note = document.getElementById('review-note');
    const form = document.getElementById('review-form');
    if (TOKEN) { note.style.display = 'none'; form.querySelector('button[type="submit"]').disabled = false; }
    else { note.style.display = 'block'; form.querySelector('button[type="submit"]').disabled = true; }

    document.querySelectorAll('#review-stars span').forEach(s => {
        s.onclick = () => { selectedReviewStars = parseInt(s.dataset.r, 10); paintStars(); };
    });
    paintStars();
}
function paintStars() {
    document.querySelectorAll('#review-stars span').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.r, 10) <= selectedReviewStars);
    });
}
async function submitReview(ev) {
    ev.preventDefault();
    if (!TOKEN) { toast('Войдите, чтобы оставить отзыв', 'info'); return; }
    const text = document.getElementById('review-text').value.trim();
    if (!text) { toast('Напишите текст отзыва', 'error'); return; }
    try {
        await api('/api/products/' + CURRENT_PRODUCT.id + '/reviews', { method: 'POST', body: JSON.stringify({ rating: selectedReviewStars, text }) });
        document.getElementById('review-text').value = '';
        toast('Спасибо за отзыв!', 'success');
        loadReviews(CURRENT_PRODUCT.id);
    } catch (e) { toast(e.message, 'error'); }
}

/* ================= ПОХОЖИЕ ТОВАРЫ ================= */
async function loadRelated(productId) {
    let items = [];
    try { items = await api('/api/products/' + productId + '/related'); } catch (e) {}
    document.getElementById('related-track').innerHTML = items.map(productCardHtml).join('');
}
function scrollRelated(dir) {
    const track = document.getElementById('related-track');
    if (track) track.scrollBy({ left: dir * 260, behavior: 'smooth' });
}

/* ================= БРЕНДЫ ================= */
async function loadBrands(renderPage) {
    try { BRANDS = await api('/api/brands'); } catch (e) { BRANDS = []; }
    if (!renderPage) return;
    const grid = document.getElementById('brands-grid');
    grid.innerHTML = BRANDS.map(b => `
        <div class="brand-card" onclick="openBrand(${b.id})" style="cursor:pointer;text-align:center;padding:20px;border:1px solid #eee;">
            <img src="${esc(b.logo || '')}" alt="${esc(b.name)}" style="max-width:120px;max-height:80px;object-fit:contain;">
            <h3 style="margin-top:10px;font-weight:normal;">${esc(b.name)}</h3>
        </div>`).join('') || '<p>Бренды пока не добавлены.</p>';
}
async function openBrand(id) {
    showPage('brand-view');
    let b;
    try { b = await api('/api/brands/' + id); } catch (e) { toast('Бренд не найден', 'error'); showBrands(); return; }
    document.getElementById('bv-logo').src = b.logo || '';
    document.getElementById('bv-name').textContent = b.name;
    document.getElementById('bv-desc').textContent = b.description || '';
    let products = [];
    try { products = await api('/api/products?brand=' + id); } catch (e) {}
    document.getElementById('brand-products').innerHTML = products.map(productCardHtml).join('') || '<p>У бренда пока нет товаров.</p>';
}

/* ================= КОНТАКТЫ ================= */
async function loadContacts() {
    let c = {};
    try { c = await api('/api/contacts'); } catch (e) {}
    const box = document.getElementById('contacts-box');
    box.innerHTML = `
        ${c.phone ? `<p>📞 <a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a></p>` : ''}
        ${c.email ? `<p>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ''}
        ${c.address ? `<p>📍 ${esc(c.address)}</p>` : ''}
        ${c.work_hours ? `<p>🕒 ${esc(c.work_hours)}</p>` : ''}
        ${c.instagram ? `<p>Instagram: ${esc(c.instagram)}</p>` : ''}
        ${c.telegram ? `<p>Telegram: ${esc(c.telegram)}</p>` : ''}
        ${c.whatsapp ? `<p>WhatsApp: ${esc(c.whatsapp)}</p>` : ''}
    ` || '<p>Контакты пока не заполнены.</p>';
}

/* ================= КОРЗИНА / ОФОРМЛЕНИЕ ================= */
function renderCart() {
    const box = document.getElementById('cart-content');
    if (!CART.length) { box.innerHTML = '<p style="padding:30px 0;color:#888;">Корзина пуста. <a onclick="showCatalog()" style="cursor:pointer;text-decoration:underline;">В каталог →</a></p>'; return; }
    const total = CART.reduce((s, it) => s + it.price * it.qty, 0);
    const itemsHtml = CART.map((it, i) => `
        <div class="cart-item">
            <img src="${esc(it.img || '')}" alt="">
            <div>
                <div class="cart-name">${esc(it.name)}${it.size ? ' (' + esc(it.size) + ')' : ''}</div>
                <div class="cart-meta">
                    <button onclick="changeCartQty(${i},-1)">−</button>
                    <span style="margin:0 8px;">${it.qty}</span>
                    <button onclick="changeCartQty(${i},1)">+</button>
                </div>
            </div>
            <div class="cart-price">${money(it.price * it.qty)}</div>
            <button class="cart-remove" onclick="removeCartItem(${i})">Удалить</button>
        </div>`).join('');

    box.innerHTML = itemsHtml + `
        <div style="text-align:right;font-size:22px;margin:20px 0;">Итого: <strong>${money(total)}</strong></div>
        <div class="admin-form" style="max-width:500px;margin-left:auto;">
            <h3>Оформление заказа</h3>
            <div class="form-group"><label>Телефон</label><input type="text" id="checkout-phone" placeholder="+7 900 123-45-67" value="${esc((CURRENT_USER && CURRENT_USER.phone) || '')}"></div>
            <div class="form-group"><label>Адрес доставки</label><input type="text" id="checkout-address" placeholder="Город, улица, дом, квартира"></div>
            <div class="form-group"><label>Комментарий</label><textarea id="checkout-comment" rows="2"></textarea></div>
            <div class="form-group">
                <label><input type="radio" name="pay-method" value="cash" checked> Оплата при получении</label><br>
                <label><input type="radio" name="pay-method" value="online"> Оплата картой онлайн</label>
            </div>
            ${RESERVE_ENABLED ? `<div class="form-group"><label><input type="checkbox" id="checkout-reserve"> Забронировать (сообщим, когда появится в наличии)</label></div>` : ''}
            <div class="error-msg" id="checkout-error"></div>
            <button class="btn" onclick="submitOrder()">Оформить заказ</button>
        </div>`;
}
function changeCartQty(idx, delta) {
    CART[idx].qty += delta;
    if (CART[idx].qty <= 0) CART.splice(idx, 1);
    saveCart();
    renderCart();
}
function removeCartItem(idx) { CART.splice(idx, 1); saveCart(); renderCart(); }

async function submitOrder() {
    if (!TOKEN) { toast('Войдите, чтобы оформить заказ', 'info'); openAuthModal('login'); return; }
    if (!CART.length) { toast('Корзина пуста', 'error'); return; }
    const phone = document.getElementById('checkout-phone').value.trim();
    const address = document.getElementById('checkout-address').value.trim();
    const comment = document.getElementById('checkout-comment').value.trim();
    const paymentMethod = document.querySelector('input[name="pay-method"]:checked').value;
    const isReserved = document.getElementById('checkout-reserve') ? document.getElementById('checkout-reserve').checked : false;
    const errorEl = document.getElementById('checkout-error');
    errorEl.textContent = '';
    if (!phone || !address) { errorEl.textContent = 'Укажите телефон и адрес'; return; }

    const total = CART.reduce((s, it) => s + it.price * it.qty, 0);
    const items = CART.map(it => ({ id: it.id, qty: it.qty, size: it.size, name: it.name }));

    try {
        let result;
        if (isReserved) {
            result = await api('/api/orders', {
                method: 'POST',
                body: JSON.stringify({ customer_name: CURRENT_USER.name, phone, address, comment, items, total, payment_method: paymentMethod, is_reserved: true })
            });
        } else {
            result = await api('/api/payment/create', {
                method: 'POST',
                body: JSON.stringify({ items, total, payment_method: paymentMethod, phone, address, comment })
            });
        }
        CART = [];
        saveCart();
        if (result.confirmation_url) {
            window.location.href = result.confirmation_url;
            return;
        }
        showSuccess('Номер заказа: №' + (result.order_id || result.id) + '. Мы свяжемся с вами для подтверждения.');
    } catch (e) {
        errorEl.textContent = e.message;
    }
}
function showSuccess(text) {
    document.getElementById('success-text').textContent = text;
    document.body.classList.add('success-active');
    document.getElementById('success-view').classList.add('active');
    window.__hideSuccess = function () {
        document.body.classList.remove('success-active');
        document.getElementById('success-view').classList.remove('active');
        showCatalog();
    };
}

/* ================= МОИ ЗАКАЗЫ ================= */
async function loadMyOrders() {
    const box = document.getElementById('my-orders-content');
    box.innerHTML = 'Загрузка...';
    let orders = [];
    try { orders = await api('/api/orders/my'); } catch (e) { box.innerHTML = 'Не удалось загрузить заказы.'; return; }
    if (!orders.length) { box.innerHTML = '<p style="color:#888;">У вас пока нет заказов.</p>'; return; }
    const statusLabels = { new: 'Новый', processing: 'В обработке', reserved: 'Резерв', done: 'Выполнен', cancelled: 'Отменён' };
    box.innerHTML = orders.map(o => `
        <div class="order-card" style="border:1px solid #e0e0e0;padding:15px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;">
                <strong>Заказ №${o.id}</strong>
                <span>${esc((o.created_at || '').replace('T', ' ').slice(0, 16))}</span>
            </div>
            <div>Статус: <strong>${esc(statusLabels[o.status] || o.status)}</strong> · Оплата: ${o.payment_method === 'online' ? 'картой' : 'при получении'} (${o.payment_status || 'unpaid'})</div>
            <div style="margin-top:8px;">
                ${(o.items || []).map(it => `<div>${esc(it.name)}${it.size ? ' (' + esc(it.size) + ')' : ''} × ${it.qty}</div>`).join('')}
            </div>
            <div style="text-align:right;font-weight:bold;margin-top:8px;">${money(o.total)}</div>
        </div>`).join('');
}

/* ================= АВТОРИЗАЦИЯ ================= */
function openAuthModal(mode) {
    authMode = mode || 'login';
    switchAuthForm(authMode);
    document.getElementById('auth-modal').classList.add('active');
}
function closeAuthModal() { document.getElementById('auth-modal').classList.remove('active'); }
function switchAuthForm(mode) {
    authMode = mode;
    document.getElementById('auth-title').textContent = mode === 'login' ? 'Вход' : 'Регистрация';
    document.getElementById('login-form').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('register-form').style.display = mode === 'register' ? 'block' : 'none';
}
async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
        const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        TOKEN = data.token;
        CURRENT_USER = data.user;
        localStorage.setItem('token', TOKEN);
        closeAuthModal();
        renderUserArea();
        toast('Добро пожаловать, ' + data.user.name + '!', 'success');
    } catch (e) { errEl.textContent = e.message; }
}
async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    errEl.textContent = '';
    try {
        const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
        TOKEN = data.token;
        CURRENT_USER = data.user;
        localStorage.setItem('token', TOKEN);
        closeAuthModal();
        renderUserArea();
        toast('Регистрация успешна!', 'success');
    } catch (e) { errEl.textContent = e.message; }
}
function logout() {
    TOKEN = null; CURRENT_USER = null;
    localStorage.removeItem('token');
    renderUserArea();
    showCatalog();
}
function renderUserArea() {
    const box = document.getElementById('user-area');
    if (!box) return;
    if (CURRENT_USER) {
        box.innerHTML = `<div>
            <span class="user-info">Привет, <strong>${esc(CURRENT_USER.name)}</strong></span>
            <button class="user-btn" onclick="showMyOrders()">Заказы</button>
            ${CURRENT_USER.role === 'admin' ? '<button class="user-btn" onclick="showAdmin()">Админка</button>' : ''}
            <button class="user-btn" onclick="logout()">Выйти</button>
        </div>`;
    } else {
        box.innerHTML = `<div><button class="user-btn" onclick="openAuthModal('login')">Войти</button></div>`;
    }
}
async function restoreSession() {
    if (!TOKEN) { renderUserArea(); return; }
    try {
        CURRENT_USER = await api('/api/me');
    } catch (e) {
        TOKEN = null; localStorage.removeItem('token'); CURRENT_USER = null;
    }
    renderUserArea();
}

/* ================= ГЛАВНЫЙ СЛАЙДЕР ================= */
async function loadSlides() {
    try { SLIDES = await api('/api/slides'); } catch (e) { SLIDES = []; }
    const slider = document.getElementById('hero-slider');
    const dotsBox = document.getElementById('slider-dots');
    if (!slider) return;
    Array.from(slider.querySelectorAll('.slide')).forEach(s => s.remove());
    if (!SLIDES.length) { dotsBox.innerHTML = ''; return; }
    SLIDES.forEach((s, i) => {
        const div = document.createElement('div');
        div.className = 'slide' + (i === 0 ? ' active' : '');
        div.style.cssText = 'position:absolute;inset:0;background-image:url(' + JSON.stringify(s.img) + ');background-size:cover;background-position:center;opacity:0;transition:opacity .6s;';
        if (i === 0) div.style.opacity = '1';
        slider.insertBefore(div, slider.firstChild);
    });
    dotsBox.innerHTML = SLIDES.map((s, i) => `<span class="dot${i === 0 ? ' active' : ''}" onclick="goToSlide(${i})"></span>`).join('');
    SLIDE_IDX = 0;
    clearInterval(slideTimer);
    if (SLIDES.length > 1) slideTimer = setInterval(() => nextSlide(), 6000);
}
function applySlide() {
    const slides = document.querySelectorAll('#hero-slider .slide');
    const dots = document.querySelectorAll('#slider-dots .dot');
    slides.forEach((s, i) => { s.style.opacity = i === SLIDE_IDX ? '1' : '0'; s.classList.toggle('active', i === SLIDE_IDX); });
    dots.forEach((d, i) => d.classList.toggle('active', i === SLIDE_IDX));
}
function nextSlide() { if (!SLIDES.length) return; SLIDE_IDX = (SLIDE_IDX + 1) % SLIDES.length; applySlide(); }
function prevSlide() { if (!SLIDES.length) return; SLIDE_IDX = (SLIDE_IDX - 1 + SLIDES.length) % SLIDES.length; applySlide(); }
function goToSlide(i) { SLIDE_IDX = i; applySlide(); }

/* ================= НАСТРОЙКА БРОНИРОВАНИЯ ================= */
async function loadReserveSetting() {
    try { const r = await api('/api/settings/reserve'); RESERVE_ENABLED = !!r.enabled; } catch (e) { RESERVE_ENABLED = false; }
}

/* ================= ЮРИДИЧЕСКИЕ МОДАЛКИ ================= */
const LEGAL_TEXTS = {
    privacy: ['Политика конфиденциальности', 'Мы собираем только данные, необходимые для оформления и доставки заказа: имя, телефон, адрес и email. Данные не передаются третьим лицам, кроме платёжного провайдера (ЮKassa) и службы доставки.'],
    terms: ['Пользовательское соглашение', 'Используя сайт, вы соглашаетесь с условиями продажи, актуальными ценами и сроками, указанными в карточках товаров. Администрация вправе изменять ассортимент и цены.'],
    delivery: ['Доставка и оплата', 'Доставка по России — 3–7 дней. Оплата картой, СБП или наличными при получении.'],
    return: ['Возврат и обмен', 'Обмен и возврат товара надлежащего качества возможен в течение 14 дней с момента получения, если сохранён товарный вид.']
};
function openLegal(key) {
    const data = LEGAL_TEXTS[key];
    if (!data) return;
    document.getElementById('legal-title').textContent = data[0];
    document.getElementById('legal-body').innerHTML = '<p>' + esc(data[1]) + '</p>';
    document.getElementById('legal-modal').classList.add('open');
}
function closeLegal() { document.getElementById('legal-modal').classList.remove('open'); }

/* ================= ЧАТ С ПРОДАВЦОМ ================= */
function setChatVisualState(isOpen) {
    const widget = document.getElementById('chat-widget');
    const windowEl = document.getElementById('chat-window');
    const openIcon = widget && widget.querySelector('.chat-ico--open');
    const closeIcon = widget && widget.querySelector('.chat-ico--close');
    if (!widget || !windowEl) return;
    widget.classList.toggle('is-open', isOpen);
    windowEl.classList.toggle('open', isOpen);
    if (openIcon) openIcon.style.display = isOpen ? 'none' : 'block';
    if (closeIcon) closeIcon.style.display = isOpen ? 'block' : 'none';
}

function toggleChat(forceOpen) {
    const widget = document.getElementById('chat-widget');
    const windowEl = document.getElementById('chat-window');
    if (!widget || !windowEl) return;
    const shouldOpen = forceOpen !== undefined ? !!forceOpen : !windowEl.classList.contains('open');
    setChatVisualState(shouldOpen);
    if (shouldOpen) openChat();
    else {
        if (chatES) { chatES.close(); chatES = null; }
        window.__currentChatId = null;
    }
}

async function openChat() {
    const authNote = document.getElementById('chat-auth-note');
    const form = document.getElementById('chat-form');
    const body = document.getElementById('chat-body');
    if (!authNote || !form || !body) return;
    setChatVisualState(true);
    if (!TOKEN) {
        authNote.style.display = 'block';
        form.style.display = 'none';
        body.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:13px;">Войдите в аккаунт, чтобы начать диалог с продавцом.</div>';
        return;
    }
    authNote.style.display = 'none';
    form.style.display = 'flex';
    body.innerHTML = '<div style="padding:24px;text-align:center;color:#999;font-size:13px;">Загрузка чата…</div>';
    try {
        const data = await api('/api/chats/me');
        window.__currentChatId = data.chat.id;
        const messages = await api('/api/chats/' + data.chat.id + '/messages');
        renderChatMessages(messages);
        if (chatES) chatES.close();
        const streamUrl = '/api/chats/' + data.chat.id + '/stream?token=' + encodeURIComponent(TOKEN);
        chatES = new EventSource(streamUrl);
        chatES.onmessage = (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                if (payload.type === 'message' && payload.message) appendChatMessage(payload.message);
            } catch (e) { console.warn('Chat SSE parse error:', e); }
        };
        chatES.onerror = () => {};
        // Polling fallback: каждые 3 сек подтягиваем новые
        window.__chatSeenIds = new Set((messages || []).map(m => m.id));
        if (window.__chatPollTimer) clearInterval(window.__chatPollTimer);
        window.__chatPollTimer = setInterval(async () => {
            if (!window.__currentChatId) return;
            try {
                const fresh = await api('/api/chats/' + window.__currentChatId + '/messages');
                const box = document.getElementById('chat-body');
                if (!box) return;
                let changed = false;
                for (const m of fresh) {
                    if (!window.__chatSeenIds.has(m.id)) {
                        window.__chatSeenIds.add(m.id);
                        box.insertAdjacentHTML('beforeend', chatMessageHtml(m));
                        changed = true;
                    }
                }
                if (changed) box.scrollTop = box.scrollHeight;
            } catch (e) {}
        }, 3000);
    } catch (e) {
        console.error('Chat open error:', e);
        body.innerHTML = '<div style="padding:24px;text-align:center;color:#8b0000;font-size:13px;">Не удалось загрузить чат. Попробуйте закрыть и открыть его снова.</div>';
        toast(e.message || 'Ошибка чата', 'error');
    }
}
function renderChatMessages(list) {
    const body = document.getElementById('chat-body');
    body.innerHTML = list.map(chatMessageHtml).join('');
    body.scrollTop = body.scrollHeight;
}
function chatMessageHtml(m) {
    const mine = m.sender_role === (CURRENT_USER && CURRENT_USER.role === 'admin' ? 'admin' : 'user');
    const author = m.sender_role === 'admin' ? 'Вы' : 'Клиент';
    const time = m.created_at ? new Date(m.created_at.replace(' ', 'T') + (m.created_at.includes('Z') ? '' : 'Z')).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';
    return `<div class="chat-msg ${mine ? 'chat-msg--me' : 'chat-msg--them'}" data-message-id="${m.id || ''}"><div class="chat-msg__author">${author}</div>${esc(m.text)}${time ? `<span class="chat-msg__time">${time}</span>` : ''}</div>`;
}
function appendChatMessage(m) {
    const body = document.getElementById('chat-body');
    body.insertAdjacentHTML('beforeend', chatMessageHtml(m));
    body.scrollTop = body.scrollHeight;
}
async function sendChatMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !window.__currentChatId) return;
    input.value = '';
    try { await api('/api/chats/' + window.__currentChatId + '/messages', { method: 'POST', body: JSON.stringify({ text }) }); }
    catch (e) { toast(e.message, 'error'); }
}

/* ================= ПОИСК ================= */
let searchCache = [];
function openSearch() {
    document.getElementById('search-overlay').classList.add('active');
    document.getElementById('search-input').focus();
    renderSearchHistory();
}
function closeSearch() { document.getElementById('search-overlay').classList.remove('active'); }
function renderSearchHistory() {
    const hist = safeParse(localStorage.getItem('searchHistory'), []);
    document.getElementById('search-history').innerHTML = hist.map(h => `<span class="search-history-item" onclick="doSearch('${esc(h)}')" style="cursor:pointer;display:inline-block;margin:4px;padding:6px 12px;background:#f2f2f2;">${esc(h)}</span>`).join('');
}
async function doSearch(q) {
    document.getElementById('search-input').value = q;
    if (!q.trim()) return;
    if (!searchCache.length) { try { searchCache = await api('/api/products'); } catch (e) { searchCache = []; } }
    const found = searchCache.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()));
    const histSection = document.getElementById('search-history-section');
    const suggestSection = document.getElementById('search-suggests-section');
    const emptyBox = document.getElementById('search-empty');
    histSection.style.display = 'none';
    if (!found.length) { suggestSection.style.display = 'none'; emptyBox.style.display = 'block'; return; }
    emptyBox.style.display = 'none';
    suggestSection.style.display = 'block';
    document.getElementById('search-suggests').innerHTML = found.slice(0, 20).map(p => `
        <div class="search-suggest-item" style="cursor:pointer;padding:10px;display:flex;gap:10px;align-items:center;" onclick="closeSearch();openProduct(${p.id})">
            <img src="${esc((p.images && p.images[0]) || '')}" style="width:44px;height:44px;object-fit:cover;">
            <div><div>${esc(p.name)}</div><div style="color:#666;">${money(p.final_price)}</div></div>
        </div>`).join('');

    const hist = safeParse(localStorage.getItem('searchHistory'), []);
    const q2 = q.trim();
    const updated = [q2, ...hist.filter(h => h !== q2)].slice(0, 8);
    localStorage.setItem('searchHistory', JSON.stringify(updated));
}
function clearSearchHistory() { localStorage.removeItem('searchHistory'); renderSearchHistory(); }

/* ================= МОБИЛЬНЫЕ ФИЛЬТРЫ (бургер) ================= */
function openFiltersPanel() {
    document.getElementById('burgerBtn').classList.add('is-open');
    document.getElementById('filtersBackdrop').classList.add('is-open');
    document.getElementById('filtersPanel').classList.add('is-open');
}
function closeFiltersPanel() {
    document.getElementById('burgerBtn').classList.remove('is-open');
    document.getElementById('filtersBackdrop').classList.remove('is-open');
    document.getElementById('filtersPanel').classList.remove('is-open');
}

/* ============================================================
   АДМИН-ПАНЕЛЬ
   ============================================================ */
function switchAdminTab(name, btn) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById('admin-' + name);
    if (section) section.classList.add('active');
    document.body.classList.toggle('admin-chats-active', name === 'chats');
    if (name === 'chats') loadAdminChats();
}
async function loadAdminEverything() {
    await Promise.all([loadCategories(), loadBrandsRef(), loadBadgesRef()]);
    await Promise.all([
        loadAdminProducts(), loadAdminBrands(), loadAdminBadges(),
        loadAdminSlides(), loadAdminOrders(), loadAdminContacts(),
        loadAdminSettings(), loadAdminUsers()
    ]);
    renderProductBadgeCheckboxes();
}

/* ---- Товары (список) ---- */
let adminProductsCache = [];
let adminProductsSearch = '';
async function loadAdminProducts() {
    try {
        const q = adminProductsSearch.trim();
        adminProductsCache = await api('/api/products' + (q ? '?q=' + encodeURIComponent(q) : ''));
    } catch (e) { adminProductsCache = []; }
    const body = document.getElementById('admin-products-body');
    const count = document.getElementById('admin-products-count');
    if (count) count.textContent = adminProductsSearch ? `Найдено: ${adminProductsCache.length}` : `Всего: ${adminProductsCache.length}`;
    body.innerHTML = adminProductsCache.map(p => `
        <tr>
            <td><img src="${esc((p.images && p.images[0]) || '')}" style="width:50px;height:50px;object-fit:cover;"></td>
            <td><strong>${esc(p.name)}</strong>${p.sku ? `<div class="admin-product-sku">${esc(p.sku)}</div>` : ''}</td>
            <td>${esc((p.category && p.category.name) || '—')}</td>
            <td>${esc((p.brand && p.brand.name) || '—')}</td>
            <td>${money(p.price)}</td>
            <td>${p.discount || 0}%</td>
            <td>
                <button class="btn btn-small" onclick="editProduct(${p.id})">Изменить</button>
                <button class="btn btn-small btn-danger" onclick="deleteProduct(${p.id})">Удалить</button>
            </td>
        </tr>`).join('') || '<tr><td colspan="7">Товаров по вашему запросу не найдено.</td></tr>';
}

/* ---- Форма добавления/редактирования товара ---- */
function renderProductBadgeCheckboxes(selectedIds) {
    selectedIds = selectedIds || [];
    document.getElementById('f-badges').innerHTML = BADGES.map(b => `
        <label style="margin-right:12px;"><input type="checkbox" value="${b.id}" ${selectedIds.includes(b.id) ? 'checked' : ''}> ${esc(b.icon || '')} ${esc(b.label)}</label>
    `).join('');
}
function renderStockBySizeInputs(sizesStr, existing) {
    existing = existing || {};
    const sizes = sizesStr.split(',').map(s => s.trim()).filter(Boolean);
    const box = document.getElementById('f-stock-by-size');
    if (!sizes.length) { box.innerHTML = '<span style="color:#888;font-size:12px;">Сначала укажите размеры выше</span>'; return; }
    box.innerHTML = sizes.map(s => `
        <div style="display:inline-block;margin:4px 8px 4px 0;">
            <label style="font-size:12px;display:block;">${esc(s)}</label>
            <input type="number" min="0" data-size="${esc(s)}" class="stock-size-input" value="${existing[s] != null ? existing[s] : 0}" style="width:70px;">
        </div>`).join('');
}
function collectStockBySize() {
    const out = {};
    document.querySelectorAll('.stock-size-input').forEach(inp => { out[inp.dataset.size] = parseInt(inp.value, 10) || 0; });
    return out;
}
function addSpecRow(label, value) {
    const list = document.getElementById('f-specs-list');
    const row = document.createElement('div');
    row.className = 'spec-row';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;';
    row.innerHTML = `<input type="text" placeholder="Параметр" class="spec-label" value="${esc(label || '')}" style="flex:1;">
                      <input type="text" placeholder="Значение" class="spec-value" value="${esc(value || '')}" style="flex:1;">
                      <button type="button" class="btn btn-small btn-danger" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(row);
}
function collectSpecs() {
    return Array.from(document.querySelectorAll('#f-specs-list .spec-row')).map(row => ({
        label: row.querySelector('.spec-label').value.trim(),
        value: row.querySelector('.spec-value').value.trim()
    })).filter(s => s.label);
}
function renderProductPhotos() {
    document.getElementById('product-photos-list').innerHTML = CURRENT_PRODUCT_PHOTOS.map((url, i) => `
        <div style="display:inline-block;position:relative;margin:4px;">
            <img src="${esc(url)}" style="width:70px;height:70px;object-fit:cover;">
            <button type="button" onclick="removeProductPhoto(${i})" style="position:absolute;top:-6px;right:-6px;background:#8b0000;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;">✕</button>
        </div>`).join('');
}
function removeProductPhoto(i) { CURRENT_PRODUCT_PHOTOS.splice(i, 1); renderProductPhotos(); }
function addUrlPhoto() {
    const input = document.getElementById('f-img-url');
    const url = input.value.trim();
    if (!url) return;
    CURRENT_PRODUCT_PHOTOS.push(url);
    input.value = '';
    renderProductPhotos();
}
async function uploadFiles(files) {
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('photos', f));
    const data = await api('/api/upload', { method: 'POST', body: fd });
    return data.urls || [];
}
function resetProductForm() {
    document.getElementById('edit-id').value = '';
    document.getElementById('form-title').textContent = 'Новый товар';
    document.getElementById('f-name').value = '';
    document.getElementById('f-price').value = '';
    document.getElementById('f-discount').value = 0;
    document.getElementById('f-sku').value = '';
    document.getElementById('f-brand').value = '';
    document.getElementById('f-category').value = '';
    document.getElementById('f-stock').value = 0;
    document.getElementById('f-stock-status').value = 'in_stock';
    document.getElementById('f-sizes').value = '';
    document.getElementById('f-desc').value = '';
    document.getElementById('f-specs-list').innerHTML = '';
    CURRENT_PRODUCT_PHOTOS = [];
    renderProductPhotos();
    renderStockBySizeInputs('', {});
    renderProductBadgeCheckboxes([]);
}
function editProduct(id) {
    const p = adminProductsCache.find(x => x.id === id);
    if (!p) return;
    switchAdminTab('add', document.querySelector('.admin-tab[onclick*="\'add\'"]'));
    document.getElementById('edit-id').value = p.id;
    document.getElementById('form-title').textContent = 'Редактировать товар';
    document.getElementById('f-name').value = p.name;
    document.getElementById('f-price').value = p.price;
    document.getElementById('f-discount').value = p.discount || 0;
    document.getElementById('f-sku').value = p.sku || '';
    document.getElementById('f-brand').value = p.brand_id || '';
    document.getElementById('f-category').value = p.category_id || '';
    document.getElementById('f-stock').value = p.stock || 0;
    document.getElementById('f-stock-status').value = p.stock_status || 'in_stock';
    document.getElementById('f-sizes').value = (p.sizes || []).join(', ');
    document.getElementById('f-desc').value = p.description || '';
    document.getElementById('f-specs-list').innerHTML = '';
    (p.specs || []).forEach(s => addSpecRow(s.label || s.key, s.value));
    CURRENT_PRODUCT_PHOTOS = (p.images || []).slice();
    renderProductPhotos();
    renderStockBySizeInputs((p.sizes || []).join(', '), p.stock_by_size || {});
    renderProductBadgeCheckboxes((p.badges || []).map(b => b.id));
    window.scrollTo(0, 0);
}
async function saveProduct() {
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('f-name').value.trim();
    const price = parseFloat(document.getElementById('f-price').value);
    if (!name || !price) { toast('Укажите название и цену', 'error'); return; }
    if (!CURRENT_PRODUCT_PHOTOS.length) { toast('Добавьте хотя бы одно фото', 'error'); return; }
    const sizesStr = document.getElementById('f-sizes').value.trim();
    const sizes = sizesStr ? sizesStr.split(',').map(s => s.trim()).filter(Boolean) : ['ONE SIZE'];
    const badge_ids = Array.from(document.querySelectorAll('#f-badges input:checked')).map(cb => parseInt(cb.value, 10));
    const payload = {
        name, price,
        description: document.getElementById('f-desc').value.trim(),
        sizes, images: CURRENT_PRODUCT_PHOTOS,
        brand_id: document.getElementById('f-brand').value || null,
        category_id: document.getElementById('f-category').value || null,
        discount: parseInt(document.getElementById('f-discount').value, 10) || 0,
        stock: parseInt(document.getElementById('f-stock').value, 10) || 0,
        stock_status: document.getElementById('f-stock-status').value,
        sku: document.getElementById('f-sku').value.trim(),
        specs: collectSpecs(),
        stock_by_size: collectStockBySize(),
        badge_ids
    };
    try {
        if (id) await api('/api/products/' + id, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
        toast('Товар сохранён', 'success');
        resetProductForm();
        await loadAdminProducts();
        switchAdminTab('products', document.querySelector('.admin-tab[onclick*="\'products\'"]'));
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return;
    try { await api('/api/products/' + id, { method: 'DELETE' }); toast('Удалено', 'success'); loadAdminProducts(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Бренды ---- */
async function loadAdminBrands() {
    let brands = [];
    try { brands = await api('/api/brands'); } catch (e) {}
    document.getElementById('admin-brands-body').innerHTML = brands.map(b => `
        <tr>
            <td><img src="${esc(b.logo || '')}" style="width:40px;height:40px;object-fit:contain;"></td>
            <td>${esc(b.name)}</td>
            <td>${esc(b.description || '')}</td>
            <td><button class="btn btn-small btn-danger" onclick="deleteBrand(${b.id})">Удалить</button></td>
        </tr>`).join('') || '<tr><td colspan="4">Брендов пока нет.</td></tr>';
}
async function saveBrand() {
    const name = document.getElementById('b-name').value.trim();
    if (!name) { toast('Укажите название бренда', 'error'); return; }
    const payload = {
        name,
        description: document.getElementById('b-desc').value.trim(),
        logo: CURRENT_BRAND_LOGO || document.getElementById('b-logo-url').value.trim()
    };
    try {
        await api('/api/brands', { method: 'POST', body: JSON.stringify(payload) });
        toast('Бренд добавлен', 'success');
        document.getElementById('b-name').value = ''; document.getElementById('b-desc').value = ''; document.getElementById('b-logo-url').value = '';
        CURRENT_BRAND_LOGO = '';
        document.getElementById('brand-upload-preview').style.display = 'none';
        loadAdminBrands(); loadBrandsRef();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteBrand(id) {
    if (!confirm('Удалить бренд?')) return;
    try { await api('/api/brands/' + id, { method: 'DELETE' }); loadAdminBrands(); loadBrandsRef(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Бейджи ---- */
const BADGE_ICON_CHOICES = ['✨', '🔥', '🏷️', '⭐', '⏳', '❌', '💎', '🎁'];
function renderBadgeIconGrid(selected) {
    document.getElementById('badge-icon-grid').innerHTML = BADGE_ICON_CHOICES.map(ic => `
        <button type="button" class="badge-icon-btn${ic === selected ? ' selected' : ''}" onclick="pickBadgeIcon('${ic}', this)">${ic}</button>`).join('');
}
function pickBadgeIcon(icon, btn) {
    document.getElementById('bd-icon').value = icon;
    document.querySelectorAll('.badge-icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}
async function loadAdminBadges() {
    let badges = [];
    try { badges = await api('/api/badges'); } catch (e) {}
    renderBadgeIconGrid('');
    document.getElementById('admin-badges-body').innerHTML = badges.map(b => `
        <tr>
            <td>${esc(b.icon || '')}</td>
            <td>${esc(b.label)}</td>
            <td>${esc(b.code)}</td>
            <td><span style="display:inline-block;width:16px;height:16px;background:${esc(b.color)};"></span></td>
            <td>${b.auto ? 'Да' : 'Нет'}</td>
            <td>${b.sort_order}</td>
            <td><button class="btn btn-small btn-danger" onclick="deleteBadge(${b.id})">Удалить</button></td>
        </tr>`).join('') || '<tr><td colspan="7">Бейджей пока нет.</td></tr>';
}
async function saveBadge() {
    const code = document.getElementById('bd-code').value.trim();
    const label = document.getElementById('bd-label').value.trim();
    if (!code || !label) { toast('Укажите код и название', 'error'); return; }
    const payload = {
        code, label,
        icon: document.getElementById('bd-icon').value,
        color: document.getElementById('bd-color').value,
        text_color: document.getElementById('bd-text-color').value,
        auto: document.getElementById('bd-auto').checked,
        sort_order: parseInt(document.getElementById('bd-sort').value, 10) || 0
    };
    try {
        await api('/api/badges', { method: 'POST', body: JSON.stringify(payload) });
        toast('Бейдж добавлен', 'success');
        document.getElementById('bd-code').value = ''; document.getElementById('bd-label').value = '';
        loadAdminBadges(); loadBadgesRef();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteBadge(id) {
    if (!confirm('Удалить бейдж?')) return;
    try { await api('/api/badges/' + id, { method: 'DELETE' }); loadAdminBadges(); loadBadgesRef(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Слайдер ---- */
async function loadAdminSlides() {
    let slides = [];
    try { slides = await api('/api/slides'); } catch (e) {}
    document.getElementById('slides-list').innerHTML = slides.map(s => `
        <div style="display:inline-block;position:relative;margin:6px;">
            <img src="${esc(s.img)}" style="width:120px;height:70px;object-fit:cover;">
            <button onclick="deleteSlide(${s.id})" style="position:absolute;top:-6px;right:-6px;background:#8b0000;color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;">✕</button>
        </div>`).join('') || '<p>Слайдов пока нет.</p>';
}
async function addSlide() {
    const url = CURRENT_SLIDE_IMG || document.getElementById('slide-url').value.trim();
    if (!url) { toast('Добавьте фото или укажите URL', 'error'); return; }
    try {
        await api('/api/slides', { method: 'POST', body: JSON.stringify({ img: url }) });
        toast('Слайд добавлен', 'success');
        document.getElementById('slide-url').value = '';
        CURRENT_SLIDE_IMG = '';
        document.getElementById('slide-upload-preview').style.display = 'none';
        loadAdminSlides(); loadSlides();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteSlide(id) {
    if (!confirm('Удалить слайд?')) return;
    try { await api('/api/slides/' + id, { method: 'DELETE' }); loadAdminSlides(); loadSlides(); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Заказы ---- */
async function loadAdminOrders() {
    let orders = [];
    try { orders = await api('/api/orders'); } catch (e) {}
    const statuses = ['new', 'processing', 'reserved', 'done', 'cancelled'];
    document.getElementById('admin-orders-body').innerHTML = orders.map(o => `
        <tr>
            <td>${o.id}</td>
            <td>${esc(o.customer_name || '—')}</td>
            <td>${esc(o.phone || '')}</td>
            <td>${esc(o.address || '')}</td>
            <td>${(o.items || []).map(it => esc(it.name) + (it.size ? ' (' + esc(it.size) + ')' : '') + ' ×' + it.qty).join('<br>')}</td>
            <td>${money(o.total)}</td>
            <td>
                <select onchange="setOrderPayment(${o.id}, this.value)">
                    ${['unpaid', 'paid', 'refund'].map(s => `<option value="${s}" ${o.payment_status === s ? 'selected' : ''}>${({unpaid:'Не оплачено', paid:'Оплачено', refund:'Возврат'})[s]}</option>`).join('')}
                </select>
            </td>
            <td>
                <select onchange="setOrderStatus(${o.id}, this.value)">
                    ${statuses.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${({new:'Новый', processing:'В обработке', reserved:'Резерв', done:'Выполнен', cancelled:'Отменён'})[s]}</option>`).join('')}
                </select>
            </td>
        </tr>`).join('') || '<tr><td colspan="8">Заказов пока нет.</td></tr>';
}
async function setOrderStatus(id, status) {
    try { await api('/api/orders/' + id, { method: 'PUT', body: JSON.stringify({ status }) }); toast('Статус обновлён', 'success'); }
    catch (e) { toast(e.message, 'error'); }
}
async function setOrderPayment(id, payment_status) {
    try { await api('/api/orders/' + id + '/payment', { method: 'PUT', body: JSON.stringify({ payment_status }) }); toast('Статус оплаты обновлён', 'success'); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Контакты (админ) ---- */
async function loadAdminContacts() {
    let c = {};
    try { c = await api('/api/contacts'); } catch (e) {}
    document.getElementById('c-phone').value = c.phone || '';
    document.getElementById('c-email').value = c.email || '';
    document.getElementById('c-address').value = c.address || '';
    document.getElementById('c-instagram').value = c.instagram || '';
    document.getElementById('c-telegram').value = c.telegram || '';
    document.getElementById('c-whatsapp').value = c.whatsapp || '';
    document.getElementById('c-hours').value = c.work_hours || '';
}
async function saveContacts() {
    const payload = {
        phone: document.getElementById('c-phone').value.trim(),
        email: document.getElementById('c-email').value.trim(),
        address: document.getElementById('c-address').value.trim(),
        instagram: document.getElementById('c-instagram').value.trim(),
        telegram: document.getElementById('c-telegram').value.trim(),
        whatsapp: document.getElementById('c-whatsapp').value.trim(),
        work_hours: document.getElementById('c-hours').value.trim()
    };
    try { await api('/api/contacts', { method: 'PUT', body: JSON.stringify(payload) }); toast('Контакты сохранены', 'success'); }
    catch (e) { toast(e.message, 'error'); }
}

/* ---- Настройки (бронирование) ---- */
async function loadAdminSettings() {
    try {
        const r = await api('/api/settings/reserve');
        document.getElementById('reserve-toggle').checked = !!r.enabled;
        document.getElementById('reserve-status').textContent = r.enabled ? 'Бронирование включено' : 'Бронирование выключено';
        RESERVE_ENABLED = !!r.enabled;
    } catch (e) { document.getElementById('reserve-status').textContent = 'Не удалось загрузить настройки'; }
}
async function toggleReserve(enabled) {
    try {
        await api('/api/settings/reserve', { method: 'PUT', body: JSON.stringify({ enabled }) });
        RESERVE_ENABLED = enabled;
        document.getElementById('reserve-status').textContent = enabled ? 'Бронирование включено' : 'Бронирование выключено';
        toast('Настройки сохранены', 'success');
    } catch (e) { toast(e.message, 'error'); }
}

/* ---- Пользователи ---- */
async function loadAdminUsers() {
    let users = [];
    try { users = await api('/api/users'); } catch (e) {}
    document.getElementById('admin-users-body').innerHTML = users.map(u => `
        <tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc((u.created_at || '').slice(0, 10))}</td></tr>
    `).join('') || '<tr><td colspan="5">Пользователей пока нет.</td></tr>';
}

/* ---- Чаты (админ) ---- */
let adminActiveChatId = null;
let adminChatES = null;
let adminChatMessageIds = new Set();
async function loadAdminChats() {
    let chats = [];
    try { chats = await api('/api/chats'); } catch (e) {}
    const totalUnread = chats.reduce((s, c) => s + (c.unread || 0), 0);
    const badge = document.getElementById('admin-chat-badge');
    if (totalUnread > 0) { badge.style.display = 'inline-block'; badge.textContent = totalUnread; } else { badge.style.display = 'none'; }
    document.getElementById('admin-chats-list-body').innerHTML = chats.map(c => `
        <div class="admin-chat-item${c.id === adminActiveChatId ? ' active' : ''}" onclick="openAdminChat(${c.id}, '${esc(c.user_name || '')}')" style="padding:10px;border-bottom:1px solid #eee;cursor:pointer;">
            <div class="admin-chat-item__name">${esc(c.user_name || 'Пользователь')}</div>
            <div class="admin-chat-item__preview" style="font-size:12px;color:#888;">${esc((c.last_text || '').slice(0, 40))}</div>
        </div>`).join('') || '<p style="padding:10px;color:#888;">Диалогов пока нет.</p>';
}
async function openAdminChat(chatId, userName) {
    adminActiveChatId = chatId;
    adminChatMessageIds = new Set();
    if (adminChatES) { adminChatES.close(); adminChatES = null; }
    document.getElementById('admin-chats-empty').style.display = 'none';
    document.getElementById('admin-chats-active').style.display = 'flex';
    document.getElementById('admin-chat-name').textContent = userName || 'Пользователь';
    try {
        const msgs = await api('/api/chats/' + chatId + '/messages');
        adminChatMessageIds = new Set(msgs.map(m => m.id));
        document.getElementById('admin-chat-body').innerHTML = msgs.map(chatMessageHtml).join('');
        document.getElementById('admin-chat-body').scrollTop = 999999;
        adminChatES = new EventSource('/api/chats/' + chatId + '/stream?token=' + encodeURIComponent(TOKEN));
        adminChatES.onmessage = (ev) => {
            try {
                const payload = JSON.parse(ev.data);
                if (payload.type === 'message' && payload.message && !adminChatMessageIds.has(payload.message.id) && payload.message.chat_id === adminActiveChatId) {
                    adminChatMessageIds.add(payload.message.id);
                    document.getElementById('admin-chat-body').insertAdjacentHTML('beforeend', chatMessageHtml(payload.message));
                    document.getElementById('admin-chat-body').scrollTop = 999999;
                    loadAdminChats();
                }
            } catch (e) {}
        };
        // Polling fallback для админки
        if (window.__adminChatPollTimer) clearInterval(window.__adminChatPollTimer);
        window.__adminChatPollTimer = setInterval(async () => {
            if (!adminActiveChatId) return;
            try {
                const fresh = await api('/api/chats/' + adminActiveChatId + '/messages');
                const box = document.getElementById('admin-chat-body');
                if (!box) return;
                let changed = false;
                for (const m of fresh) {
                    if (!adminChatMessageIds.has(m.id)) {
                        adminChatMessageIds.add(m.id);
                        box.insertAdjacentHTML('beforeend', chatMessageHtml(m));
                        changed = true;
                    }
                }
                if (changed) { box.scrollTop = 999999; loadAdminChats(); }
            } catch (e) {}
        }, 3000);
    } catch (e) {}
    loadAdminChats();
}
async function sendAdminChatMessage(ev) {
    ev.preventDefault();
    const input = document.getElementById('admin-chat-input');
    const text = input.value.trim();
    if (!text || !adminActiveChatId) return;
    input.value = '';
    try {
        // Сообщение уже придёт в этот же интерфейс через SSE, поэтому
        // не добавляем его второй раз вручную.
        await api('/api/chats/' + adminActiveChatId + '/messages', { method: 'POST', body: JSON.stringify({ text }) });
    } catch (e) {
        input.value = text;
        toast(e.message, 'error');
    }
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
    const preloader = document.getElementById('preloader');

    await restoreSession();
    await loadCategories();
    await loadBrandsRef();
    await loadBadgesRef();
    await loadReserveSetting();
    await loadSlides();
    showCatalog();

    if (preloader) setTimeout(() => { preloader.style.display = 'none'; }, 300);
    updateCartCount();
    updateFavCount();

    /* Загрузка фото товара */
    const uploadZone = document.getElementById('upload-zone');
    const fFile = document.getElementById('f-file');
    if (uploadZone && fFile) {
        uploadZone.addEventListener('click', () => fFile.click());
        fFile.addEventListener('change', async () => {
            if (!fFile.files.length) return;
            try { CURRENT_PRODUCT_PHOTOS.push(...(await uploadFiles(fFile.files))); renderProductPhotos(); }
            catch (e) { toast(e.message, 'error'); }
            fFile.value = '';
        });
    }
    /* Размеры → генерация полей остатков по размеру */
    const fSizes = document.getElementById('f-sizes');
    if (fSizes) fSizes.addEventListener('input', () => renderStockBySizeInputs(fSizes.value, collectStockBySize()));

    /* Логотип бренда */
    const brandZone = document.getElementById('brand-upload-zone');
    const brandFile = document.getElementById('brand-file');
    if (brandZone && brandFile) {
        brandFile.addEventListener('change', async () => {
            if (!brandFile.files.length) return;
            try {
                const urls = await uploadFiles(brandFile.files);
                CURRENT_BRAND_LOGO = urls[0];
                const prev = document.getElementById('brand-upload-preview');
                prev.src = CURRENT_BRAND_LOGO; prev.style.display = 'block';
            } catch (e) { toast(e.message, 'error'); }
        });
    }
    /* Слайд */
    const slideZone = document.getElementById('slide-upload-zone');
    const slideFile = document.getElementById('slide-file');
    if (slideZone && slideFile) {
        slideZone.addEventListener('click', () => slideFile.click());
        slideFile.addEventListener('change', async () => {
            if (!slideFile.files.length) return;
            try {
                const urls = await uploadFiles(slideFile.files);
                CURRENT_SLIDE_IMG = urls[0];
                const prev = document.getElementById('slide-upload-preview');
                prev.src = CURRENT_SLIDE_IMG; prev.style.display = 'block';
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    /* Бургер-фильтры (мобильные) */
    const burgerBtn = document.getElementById('burgerBtn');
    if (burgerBtn) burgerBtn.addEventListener('click', () => {
        if (burgerBtn.classList.contains('is-open')) closeFiltersPanel(); else openFiltersPanel();
    });
    const filtersClose = document.getElementById('filtersClose');
    if (filtersClose) filtersClose.addEventListener('click', closeFiltersPanel);
    const filtersBackdrop = document.getElementById('filtersBackdrop');
    if (filtersBackdrop) filtersBackdrop.addEventListener('click', closeFiltersPanel);
    const filterCategory = document.getElementById('filterCategory');
    if (filterCategory) filterCategory.addEventListener('change', () => onCategoryChange(filterCategory.value));
    const filterSort = document.getElementById('filterSort');
    if (filterSort) filterSort.addEventListener('change', () => onSortChange(mapBurgerToSort(filterSort.value)));
    const filtersReset = document.getElementById('filtersReset');
    if (filtersReset) filtersReset.addEventListener('click', () => { resetFilters(); closeFiltersPanel(); });

    /* Поиск */
    const searchToggle = document.getElementById('search-toggle');
    if (searchToggle) searchToggle.addEventListener('click', openSearch);
    const searchClose = document.getElementById('search-close');
    if (searchClose) searchClose.addEventListener('click', closeSearch);
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let searchTimer;
        searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(searchInput.value), 250); });
    }
    const searchClearHistory = document.getElementById('search-clear-history');
    if (searchClearHistory) searchClearHistory.addEventListener('click', clearSearchHistory);

    /* Поиск товаров в админке */
    const adminProductsSearchInput = document.getElementById('admin-products-search');
    const adminProductsSearchClear = document.getElementById('admin-products-search-clear');
    if (adminProductsSearchInput) {
        let adminSearchTimer;
        adminProductsSearchInput.addEventListener('input', () => {
            clearTimeout(adminSearchTimer);
            adminProductsSearch = adminProductsSearchInput.value;
            adminSearchTimer = setTimeout(loadAdminProducts, 180);
        });
    }
    if (adminProductsSearchClear) adminProductsSearchClear.addEventListener('click', () => {
        adminProductsSearch = '';
        if (adminProductsSearchInput) adminProductsSearchInput.value = '';
        loadAdminProducts();
        if (adminProductsSearchInput) adminProductsSearchInput.focus();
    });

    /* Чат */
    const chatForm = document.getElementById('chat-form');
    if (chatForm) chatForm.addEventListener('submit', sendChatMessage);
    const adminChatForm = document.getElementById('admin-chat-form');
    if (adminChatForm) adminChatForm.addEventListener('submit', sendAdminChatMessage);
});
