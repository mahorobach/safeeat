/**
 * EatEase — セッション・初期ページ遷移UI
 * ログイン状態に応じたページ出し分け、初回モード選択、モードバーを担当する。
 */

// ===== ページ切り替え（ランディング / モード選択 / スキャン） =====
(function () {
  const landing    = document.getElementById('landing-page');
  const modeSelect = document.getElementById('mode-select-page');
  const scanner    = document.getElementById('scanner-page');

  // 現在のセッションとナビゲーション済みフラグ
  let _session = null;
  let _hasNavigated = false;

  function showPage(page) {
    const allPages = [
      document.getElementById('landing-page'),
      document.getElementById('mode-select-page'),
      document.getElementById('scanner-page'),
      document.getElementById('user-settings-page'),
      document.getElementById('mylist-page'),
      document.getElementById('save-barcode-page'),
    ];
    allPages.forEach(p => { if (p) p.style.display = 'none'; });
    if (page) page.style.display = 'block';
  }

  async function handleSession(session) {
    _session = session;
    if (!session) {
      _hasNavigated = false;
      showPage(landing);
      const registerLink = document.getElementById('drawer-nav-register');
      if (registerLink) registerLink.style.display = 'none';
      return;
    }
    // 一度スキャナーに到達済み かつ スキャナーページが表示中なら再ナビゲート不要
    // （iOSカメラ復帰・タブ切替などで onAuthStateChange が再発火しても無視）
    if (_hasNavigated && scanner && scanner.style.display !== 'none') return;
    try {
      const { data } = await fetchApiJson("/api/user/settings", {}, session.access_token);
      const settings = data?.data || {};
      const registerLink = document.getElementById('drawer-nav-register');
      if (registerLink) registerLink.style.display = '';
      if (!settings.mode_selected) {
        showPage(modeSelect);
      } else {
        applyModeDisplay(settings.mode || 'oriental');
        _hasNavigated = true;
        showPage(scanner);
      }
    } catch {
      // ネットワークエラーなど fetch 失敗時：初回未ナビゲートのみモード選択へ
      if (!_hasNavigated) showPage(modeSelect);
    }
  }

  if (window.SafeEatAuth) {
    window.SafeEatAuth.getSession().then((session) => handleSession(session));
    window.SafeEatAuth.onAuthStateChange((_event, session) => handleSession(session));
  }

  // モード選択カードのクリック
  document.querySelectorAll('.mode-select-card:not([disabled])').forEach(card => {
    card.addEventListener('click', async () => {
      const mode = card.dataset.mode;
      try {
        const token = _session?.access_token || getAuthToken();
        await fetchApi("/api/user/settings", {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, mode_selected: true }),
        }, token);
      } catch {}
      _hasNavigated = true;
      applyModeDisplay(mode);
      showPage(scanner);
    });
  });

  // モードバー ドロップダウン（一時切替）
  const modeBtn      = document.getElementById('btn-mode-switch');
  const modeDropdown = document.getElementById('modebar-dropdown');
  modeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdown.style.display = modeDropdown.style.display !== 'none' ? 'none' : 'block';
  });
  document.querySelectorAll('.modebar-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyModeDisplay(btn.dataset.mode);
      modeDropdown.style.display = 'none';
    });
  });
  document.addEventListener('click', (e) => {
    if (!modeBtn?.contains(e.target) && modeDropdown) modeDropdown.style.display = 'none';
  });

  // 「無料で始める」ボタン
  document.getElementById('btn-hero-signup')
    ?.addEventListener('click', () => openAuthModal('signup'));
  document.getElementById('btn-pricing-signup')
    ?.addEventListener('click', () => openAuthModal('signup'));

  // URLハッシュ #signup で新規登録モーダルを自動表示
  // ランディングページの「成分をチェックする」ボタンから飛んできた場合に対応
  if (window.location.hash === '#signup') {
    setTimeout(() => openAuthModal('signup'), 300);
    history.replaceState(null, '', window.location.pathname);
  }
})();
