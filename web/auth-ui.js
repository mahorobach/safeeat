/**
 * EatEase — 認証UI
 * Supabase client itself is initialized in auth.js.
 */

function escapeAuthHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withTimeout(promise, timeoutMs, message) {
  let tid;
  const timeout = new Promise((_, reject) => {
    tid = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(tid));
}

async function refreshScanBadge() {
  const badge = document.getElementById("scan-badge");
  if (!badge) return;
  const token = getAuthToken();
  if (!token) return;
  try {
    const { data } = await fetchApiJson("/api/user/scan-count", {}, token);
    if (data.ok) {
      badge.textContent = `残り ${data.remaining} 回`;
      badge.classList.toggle("exhausted", data.remaining === 0);
    }
  } catch {}
}

function openAuthModal(mode = "login") {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;
  modal.removeAttribute("hidden");
  setAuthModalMode(mode);
  setTimeout(() => document.getElementById("auth-email")?.focus(), 50);
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.setAttribute("hidden", "");
  const err = document.getElementById("auth-error");
  if (err) { err.textContent = ""; err.className = "auth-error"; }
}

function setAuthModalMode(mode) {
  const form = document.getElementById("auth-form");
  if (form) form.dataset.mode = mode;
  const title = document.getElementById("auth-form-title");
  if (title) title.textContent = mode === "login" ? "ログイン" : "新規登録";
  const label = document.getElementById("auth-submit-label");
  if (label) label.textContent = mode === "login" ? "ログイン" : "登録する";
  const toggle = document.getElementById("auth-toggle-btn");
  if (toggle) toggle.textContent = mode === "login" ? "新規登録はこちら" : "ログインはこちら";
  const forgot = document.getElementById("auth-forgot-btn");
  if (forgot) forgot.style.display = mode === "login" ? "" : "none";
}

async function updateAuthUI(session) {
  const area = document.getElementById("auth-area");
  if (!area) return;

  if (session?.user) {
    const token = session.access_token;
    let remaining = "?";
    let plan = "free";
    try {
      const { data: d } = await fetchApiJson("/api/user/me", {}, token);
      if (d.ok) { remaining = d.data.remaining; plan = d.data.plan; }
    } catch {}

    const email = escapeAuthHtml(session.user.email);
    const badgeHtml = plan === "free"
      ? `<span class="scan-badge${remaining === 0 ? " exhausted" : ""}" id="scan-badge">残り ${remaining} 回</span>`
      : `<span class="scan-badge-unlimited">✨ 無制限</span>`;

    area.innerHTML = `
      ${badgeHtml}
      <div class="user-icon-wrap" id="user-icon-wrap" title="${email}">
        <span class="user-icon-inner">👤</span>
        <span class="user-tooltip">${email}</span>
      </div>`;
  } else {
    area.innerHTML = `
      <button class="btn-auth" id="btn-open-login" type="button">ログイン</button>
      <button class="btn-auth-outline" id="btn-open-signup" type="button">新規登録</button>`;
    document.getElementById("btn-open-login")?.addEventListener("click", () => openAuthModal("login"));
    document.getElementById("btn-open-signup")?.addEventListener("click", () => openAuthModal("signup"));
  }
}

document.getElementById("auth-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!window.SafeEatAuth) return;

  const mode      = e.currentTarget.dataset.mode || "login";
  const email     = document.getElementById("auth-email").value.trim();
  const password  = document.getElementById("auth-password").value;
  const errEl     = document.getElementById("auth-error");
  const spinner   = document.getElementById("auth-spinner");
  const submitBtn = document.getElementById("auth-submit-btn");

  errEl.textContent = "";
  errEl.className = "auth-error";
  submitBtn.disabled = true;
  if (spinner) spinner.style.display = "";

  try {
    if (mode === "login") {
      const { error } = await withTimeout(
        window.SafeEatAuth.signIn(email, password),
        20_000,
        "ログイン処理がタイムアウトしました。通信環境、SupabaseのURL設定、またはRedirect URLを確認してください。",
      );
      if (error) { errEl.textContent = error.message; return; }
      closeAuthModal();
    } else {
      const { error } = await withTimeout(
        window.SafeEatAuth.signUp(email, password),
        20_000,
        "登録処理がタイムアウトしました。通信環境、SupabaseのURL設定、またはRedirect URLを確認してください。",
      );
      if (error) { errEl.textContent = error.message; return; }
      errEl.className = "auth-error success";
      errEl.textContent = "確認メールを送信しました。メール内のリンクをクリックしてログインしてください。";
    }
  } catch (err) {
    errEl.textContent = err.message || "認証処理に失敗しました。";
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
  }
});

document.getElementById("auth-modal-close")?.addEventListener("click", closeAuthModal);
document.getElementById("auth-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAuthModal();
});
document.getElementById("auth-toggle-btn")?.addEventListener("click", () => {
  const mode = document.getElementById("auth-form")?.dataset.mode;
  setAuthModalMode(mode === "login" ? "signup" : "login");
  document.getElementById("auth-error").textContent = "";
});
document.getElementById("auth-forgot-btn")?.addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const errEl = document.getElementById("auth-error");
  if (!email) { errEl.textContent = "メールアドレスを入力してください。"; return; }
  await window.SafeEatAuth?.resetPassword(email);
  errEl.className = "auth-error success";
  errEl.textContent = "リセットメールを送信しました。";
});

if (window.SafeEatAuth) {
  updateAuthUI(null);
  window.SafeEatAuth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      localStorage.setItem("safeat_auth_token", session.access_token);
    } else {
      localStorage.removeItem("safeat_auth_token");
    }
    updateAuthUI(session);
  });
  withTimeout(window.SafeEatAuth.getSession(), 8_000, "セッション取得がタイムアウトしました。")
    .then((session) => updateAuthUI(session))
    .catch(() => updateAuthUI(null));
} else {
  updateAuthUI(null);
}
