/**
 * EatEase — ヘッダー・ドロワーナビゲーション
 */

(function () {
  function showAppOrLogin() {
    if (!window.SafeEatAuth) return;
    window.SafeEatAuth.getSession().then((session) => {
      if (session?.user) {
        showById('scanner-page');
      } else {
        openAuthModal('login');
      }
    });
  }

  document.getElementById('nav-top')?.addEventListener('click', (e) => {
    e.preventDefault();
    showById('landing-page');
    window.scrollTo(0, 0);
  });

  document.getElementById('nav-app')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAppOrLogin();
  });

  const hamburger     = document.getElementById('btn-hamburger');
  const drawerMenu    = document.getElementById('drawer-menu');
  const drawerClose   = document.getElementById('drawer-close');
  const drawerOverlay = document.getElementById('drawer-overlay');

  function openDrawer() {
    hamburger?.classList.add('is-open');
    drawerMenu?.classList.add('is-open');
    drawerMenu?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    hamburger?.classList.remove('is-open');
    drawerMenu?.classList.remove('is-open');
    drawerMenu?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window.closeDrawer = closeDrawer;

  hamburger?.addEventListener('click', openDrawer);
  drawerClose?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);

  document.getElementById('drawer-nav-top')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeDrawer();
    showById('landing-page');
    window.scrollTo(0, 0);
  });

  document.getElementById('drawer-nav-app')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeDrawer();
    showAppOrLogin();
  });

  document.getElementById('btn-logo-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!window.SafeEatAuth) return;
    window.SafeEatAuth.getSession().then((session) => {
      ['landing-page', 'mode-select-page', 'scanner-page', 'user-settings-page'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const target = session?.user ? 'scanner-page' : 'landing-page';
      const page = document.getElementById(target);
      if (page) page.style.display = 'block';
    });
  });

  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('user-icon-wrap');
    if (!wrap) return;
    if (wrap.contains(e.target)) {
      wrap.classList.toggle('tooltip-visible');
    } else {
      wrap.classList.remove('tooltip-visible');
    }
  });
})();
