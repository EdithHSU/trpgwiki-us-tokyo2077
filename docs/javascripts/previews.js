/* hover 預覽：滑鼠移到帶 data-pv-title 的連結或名詞上時，顯示簡介卡片。
   資料由 hooks/previews.py 在建站時寫進 HTML；觸控裝置點一下名詞也會顯示（連結則照常跳頁）。 */
(function () {
  const SHOW_DELAY = 250, HIDE_DELAY = 150;
  let card, showTimer, hideTimer, current;

  function ensureCard() {
    if (card) return card;
    card = document.createElement('div');
    card.className = 'wiki-preview';
    card.setAttribute('role', 'tooltip');
    card.hidden = true;
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(card);
    return card;
  }

  function fill(el) {
    const d = el.dataset;
    const c = ensureCard();
    c.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'wiki-preview__head';
    if (d.pvEmoji) {
      const e = document.createElement('span');
      e.className = 'wiki-preview__emoji';
      e.textContent = d.pvEmoji;
      head.appendChild(e);
    }
    const t = document.createElement('span');
    t.className = 'wiki-preview__title';
    t.textContent = d.pvTitle;
    head.appendChild(t);
    if (d.pvKind) {
      const k = document.createElement('span');
      k.className = 'wiki-preview__kind';
      k.textContent = d.pvKind;
      head.appendChild(k);
    }
    const p = document.createElement('div');
    p.className = 'wiki-preview__text';
    p.textContent = d.pvText || '';
    c.append(head, p);
  }

  function place(el) {
    const c = ensureCard();
    c.hidden = false;
    const r = el.getBoundingClientRect();
    const w = c.offsetWidth, h = c.offsetHeight, gap = 8, vw = document.documentElement.clientWidth;
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - 8 && r.top - gap - h > 8) top = r.top - gap - h;
    c.style.left = (left + window.scrollX) + 'px';
    c.style.top = (top + window.scrollY) + 'px';
  }

  function show(el) {
    current = el;
    fill(el);
    place(el);
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (card) card.hidden = true; current = null; }, HIDE_DELAY);
  }

  function target(e) {
    return e.target.closest && e.target.closest('.md-content [data-pv-title]');
  }

  document.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (!el) return;
    clearTimeout(hideTimer);
    if (el === current && card && !card.hidden) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el), SHOW_DELAY);
  });
  document.addEventListener('mouseout', (e) => {
    const el = target(e);
    if (el && !el.contains(e.relatedTarget)) scheduleHide();
  });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  document.addEventListener('focusout', (e) => { if (target(e)) scheduleHide(); });
  /* 名詞沒有連結，觸控裝置點一下顯示、再點別處關閉 */
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.md-content .wiki-term');
    if (el) { show(el); return; }
    if (card && !card.contains(e.target)) { card.hidden = true; current = null; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) card.hidden = true; });
  window.addEventListener('scroll', () => { if (card && !card.hidden && current) place(current); }, { passive: true });
})();
