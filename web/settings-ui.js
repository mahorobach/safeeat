/**
 * EatEase — ユーザー設定ページ
 */

(function () {
  const userSettingsPage = document.getElementById('user-settings-page');
  const scannerPage      = document.getElementById('scanner-page');

  document.getElementById('btn-user-page')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await openUserSettings();
  });

  document.getElementById('btn-settings-back')?.addEventListener('click', () => {
    if (userSettingsPage) userSettingsPage.style.display = 'none';
    if (scannerPage)      scannerPage.style.display = 'block';
  });

  document.getElementById('btn-settings-logout')?.addEventListener('click', () => {
    window.SafeEatAuth?.signOut();
  });

  document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="settings-mode"]:checked');
    if (!selected) return;

    const mode    = selected.value;
    const spinner = document.getElementById('settings-spinner');
    const label   = document.getElementById('settings-save-label');
    const msg     = document.getElementById('settings-save-msg');
    const btn     = document.getElementById('btn-settings-save');

    btn.disabled = true;
    if (spinner) spinner.style.display = '';
    label.textContent = '保存中...';
    msg.textContent = '';
    msg.className = 'settings-save-msg';

    try {
      const token = getAuthToken();
      const res = await fetchApi("/api/user/settings", {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, mode_selected: true }),
      }, token);
      const data = await res.json();
      if (data.ok) {
        msg.textContent = '✅ 保存しました';
        msg.className = 'settings-save-msg success';
        applyModeDisplay(mode);
        setTimeout(() => {
          if (userSettingsPage) userSettingsPage.style.display = 'none';
          if (scannerPage)      scannerPage.style.display = 'block';
        }, 1500);
      } else {
        throw new Error(data.error || '保存に失敗しました');
      }
    } catch (err) {
      msg.textContent = `❌ ${err.message}`;
      msg.className = 'settings-save-msg error';
    } finally {
      btn.disabled = false;
      if (spinner) spinner.style.display = 'none';
      label.textContent = 'この設定を保存する';
    }
  });

  async function openUserSettings() {
    if (scannerPage)      scannerPage.style.display = 'none';
    if (userSettingsPage) userSettingsPage.style.display = 'block';

    try {
      const token = getAuthToken();

      const { data: meData } = await fetchApiJson("/api/user/me", {}, token);
      if (meData.ok) {
        const d = meData.data;
        const emailEl     = document.getElementById('settings-email');
        const planEl      = document.getElementById('settings-plan');
        const remainingEl = document.getElementById('settings-remaining');
        if (emailEl)     emailEl.textContent    = d.email || '—';
        if (planEl)      planEl.textContent      = d.plan === 'free' ? '無料プラン' : d.plan;
        if (remainingEl) remainingEl.textContent = `${d.remaining} 回`;
      }

      const { data: settingsData } = await fetchApiJson("/api/user/settings", {}, token);
      const currentMode  = settingsData?.data?.mode || 'oriental';
      const radio = document.querySelector(`input[name="settings-mode"][value="${currentMode}"]`);
      if (radio) radio.checked = true;

      const { data: adminData } = await fetchApiJson("/api/admin/check", {}, token);
      const adminLinkEl = document.getElementById('settings-admin-link');
      if (adminLinkEl) {
        adminLinkEl.style.display = (adminData.ok && adminData.isAdmin) ? 'block' : 'none';
      }
    } catch (err) {
      console.error('設定ページの情報取得に失敗:', err);
    }
  }
})();
