/**
 * VegEatEase — 管理者ダッシュボード
 * 管理者チェック、統計取得、ユーザー検索、プラン変更を担当する。
 */

(async function () {
  const API_BASE = (window.SAFEAT_CONFIG && window.SAFEAT_CONFIG.API_BASE)
    || "https://safeeat-production-b7c5.up.railway.app";

  async function checkAdmin() {
    if (!window.SafeEatAuth) return false;
    const session = await window.SafeEatAuth.getSession();
    if (!session?.user) return false;
    const token = localStorage.getItem('safeat_auth_token');
    try {
      const res = await fetch(`${API_BASE}/api/admin/check`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      return d.ok && d.isAdmin;
    } catch {
      return false;
    }
  }

  const isAdmin = await checkAdmin();
  if (!isAdmin) {
    document.getElementById('access-denied').style.display = 'block';
    return;
  }
  document.getElementById('admin-content').style.display = 'block';

  async function loadStats() {
    const token = localStorage.getItem('safeat_auth_token');
    try {
      const res  = await fetch(`${API_BASE}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('admin-stats').innerHTML = `
          <table class="admin-table">
            <tr><th>総ユーザー数</th><td>${data.stats.total_users} 人</td></tr>
            <tr><th>今月のスキャン総数</th><td>${data.stats.total_scans_this_month} 回</td></tr>
            <tr><th>テスターユーザー数</th><td>${data.stats.tester_count} 人</td></tr>
          </table>
        `;
      }
    } catch {
      document.getElementById('admin-stats').innerHTML = '<p class="admin-error">統計情報の取得に失敗しました</p>';
    }
  }
  loadStats();

  async function searchUsers(email = '') {
    const token = localStorage.getItem('safeat_auth_token');
    const wrap  = document.getElementById('admin-table-wrap');
    wrap.innerHTML = '<p class="admin-msg">検索中...</p>';
    try {
      const url  = `${API_BASE}/api/admin/users${email ? `?email=${encodeURIComponent(email)}` : ''}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();

      if (!data.ok || !data.users?.length) {
        wrap.innerHTML = '<p class="admin-msg">ユーザーが見つかりませんでした</p>';
        return;
      }

      const rows = data.users.map(u => `
        <tr>
          <td>${u.email}</td>
          <td><span class="plan-badge ${u.plan}">${u.plan}</span></td>
          <td>${u.scan_count} 回</td>
          <td>
            <select class="btn-plan-change" data-userid="${u.id}">
              <option value="free"   ${u.plan === 'free'   ? 'selected' : ''}>free</option>
              <option value="tester" ${u.plan === 'tester' ? 'selected' : ''}>tester（無制限）</option>
              <option value="pro"    ${u.plan === 'pro'    ? 'selected' : ''}>pro</option>
            </select>
          </td>
        </tr>
      `).join('');

      wrap.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>メールアドレス</th><th>プラン</th><th>今月のスキャン</th><th>プラン変更</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch {
      wrap.innerHTML = '<p class="admin-error">検索中にエラーが発生しました</p>';
    }
  }

  async function changePlan(userId, newPlan) {
    const token = localStorage.getItem('safeat_auth_token');
    try {
      const res  = await fetch(`${API_BASE}/api/admin/users/${userId}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: newPlan }),
      });
      const data = await res.json();
      if (data.ok) {
        alert(`プランを「${newPlan}」に変更しました`);
        loadStats();
      } else {
        alert('変更に失敗しました: ' + (data.error || ''));
      }
    } catch {
      alert('通信エラーが発生しました');
    }
  }

  document.getElementById('admin-table-wrap')?.addEventListener('change', (e) => {
    if (!e.target.classList.contains('btn-plan-change')) return;
    changePlan(e.target.dataset.userid, e.target.value);
  });

  document.getElementById('admin-search-btn')?.addEventListener('click', () => {
    searchUsers(document.getElementById('admin-search-input').value.trim());
  });
  document.getElementById('admin-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers(e.target.value.trim());
  });

})();
