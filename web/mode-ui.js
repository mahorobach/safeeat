/**
 * EatEase — モード表示ロジック
 * モード定義とスキャン画面のモード表示更新を担当する。
 */

const MODE_DEFINITIONS = {
  oriental: {
    label: '🌿 オリエンタルベジタリアン',
    modebarLabel: 'オリエンタルベジ',
    rules: [
      { type: 'ng', text: 'ニンニク・ネギ・ニラ・らっきょう・玉ねぎ（五葷）' },
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ok', text: '卵・乳製品・蜂蜜・ローヤルゼリー OK' },
    ],
  },
  vegan: {
    label: '🌱 ヴィーガン',
    modebarLabel: 'ヴィーガン',
    rules: [
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ng', text: '卵・乳製品・蜂蜜・ゼラチン等すべての動物由来成分' },
      { type: 'ok', text: '植物性成分すべて OK' },
    ],
  },
  lacto_ovo: {
    label: '🥚 ラクト・オボベジタリアン',
    modebarLabel: 'ラクト・オボ',
    rules: [
      { type: 'ng', text: '肉類・魚介類すべて' },
      { type: 'ok', text: '卵・乳製品・蜂蜜 OK' },
      { type: 'ok', text: '植物性成分すべて OK' },
    ],
  },
};

let currentSessionMode = 'oriental';

function applyModeDisplay(mode) {
  const safeMode = MODE_DEFINITIONS[mode] ? mode : 'oriental';
  const def = MODE_DEFINITIONS[safeMode];
  currentSessionMode = safeMode;

  const title = document.getElementById('mode-info-title');
  if (title) title.textContent = def.label;

  const rulesEl = document.getElementById('mode-info-rules');
  if (rulesEl) {
    rulesEl.innerHTML = def.rules
      .map(r => `<div class="mode-rule-row ${r.type}">${r.type === 'ng' ? '❌' : '✅'} ${r.text}</div>`)
      .join('');
  }

  const modebarLabel = document.getElementById('modebar-label');
  if (modebarLabel) modebarLabel.textContent = def.modebarLabel;
}
