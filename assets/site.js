/* Page chrome: theme, the scroll edge under the nav, and a short reveal. */
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');

  function paintIcon() {
    if (!icon) return;
    const dark = root.classList.contains('dark');
    icon.firstElementChild.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    if (toggle) toggle.setAttribute('aria-pressed', String(dark));
  }
  paintIcon();
  if (toggle) {
    toggle.addEventListener('click', () => {
      root.classList.toggle('dark');
      localStorage.setItem('theme', root.classList.contains('dark') ? 'dark' : 'light');
      paintIcon();
    });
  }

  /* The soft edge under the bar appears only once content runs beneath it,
     instead of a permanent hairline. */
  const nav = document.querySelector('.nav');
  const sentinel = document.getElementById('nav-top');
  if (nav && sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => nav.classList.toggle('scrolled', !e.isIntersecting))
      .observe(sentinel);
  }

  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
