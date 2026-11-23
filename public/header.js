/* Thanh điều hướng: nút ☰ cho màn hình nhỏ, đánh dấu trang hiện tại,
   đưa ô tìm kiếm ra cạnh nút giỏ hàng, đổi icon giỏ hàng. Đi kèm header.css. */
(function () {
  var header = document.querySelector('header.site-header');
  if (!header) return;
  var row = header.querySelector('.nav-row');
  var nav = header.querySelector('nav.main-nav');
  var cart = header.querySelector('.cart-link');
  var search = header.querySelector('.nav-search');
  if (!row || !nav) return;

  // Ô tìm kiếm: đưa ra khỏi menu, đặt ngay trước nút giỏ hàng
  if (search && cart) row.insertBefore(search, cart);

  // Nút giỏ hàng: thay emoji bằng icon SVG (giữ nguyên #cart-count để bộ đếm vẫn chạy)
  if (cart) {
    Array.prototype.slice.call(cart.childNodes).forEach(function (n) {
      if (n.nodeType === 3) cart.removeChild(n);
    });
    var label = document.createElement('span');
    label.className = 'cart-label';
    label.textContent = 'Cart';
    cart.insertBefore(label, cart.firstChild);
    cart.insertAdjacentHTML('afterbegin',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2"/><circle cx="9.5" cy="20.5" r="1.2"/><circle cx="17.5" cy="20.5" r="1.2"/></svg>');
    cart.setAttribute('aria-label', 'Cart');
  }

  // Nút ☰
  if (!nav.id) nav.id = 'site-nav';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-burger';
  btn.setAttribute('aria-controls', nav.id);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');
  btn.innerHTML =
    '<svg class="i-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
    '<svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  row.insertBefore(btn, row.firstChild);

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!header.classList.contains('nav-open'));
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('click', function (e) {
    if (!header.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) { setOpen(false); btn.focus(); }
  });
  if (window.matchMedia) {
    var wide = window.matchMedia('(min-width: 961px)');
    var onWide = function (m) { if (m.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
  }
  header.classList.add('js-nav');

  // Đánh dấu trang đang xem
  function clean(p) { return (p.replace(/\.html$/, '').replace(/\/index$/, '').replace(/\/+$/, '')) || '/'; }
  var path = clean(location.pathname);
  function hrefPath(a) {
    try { return clean(new URL(a.getAttribute('href'), document.baseURI).pathname); } catch (e) { return ''; }
  }
  Array.prototype.forEach.call(nav.querySelectorAll(':scope > a'), function (a) {
    var h = hrefPath(a);
    var on = h === path ||
      (h === '/collections/all' && path.indexOf('/products/') === 0) ||
      (h !== '/' && h !== '/collections/all' && path.indexOf(h + '/') === 0);
    if (on) a.setAttribute('aria-current', 'page');
  });
  var toggle = nav.querySelector('.dd-toggle');
  Array.prototype.forEach.call(nav.querySelectorAll('.dd-menu a'), function (a) {
    if (a.classList.contains('dd-all')) return;
    if (hrefPath(a) === path) {
      a.setAttribute('aria-current', 'page');
      if (toggle) toggle.classList.add('is-current');
    }
  });
  if (toggle && path === '/collections') toggle.classList.add('is-current');
})();
