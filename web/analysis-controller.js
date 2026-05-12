/**
 * EatEase — 解析制御
 * テキスト/画像解析の開始、API呼び出し、結果描画への受け渡しを担当する。
 */

// エンジンは Gemini 詳細に固定
function getSelectedEngine() { return "gemini-detailed"; }

// --- Analyze ---
let _isAnalyzing = false;
analyzeBtn.addEventListener("click", handleAnalyze);

function switchToTextInputTab() {
  document.querySelectorAll(".input-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === "text"),
  );
  document.getElementById("tab-text").style.display = "";
  document.getElementById("tab-image").style.display = "none";
}

document.getElementById("btn-extract-then-classify")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-extract-then-classify");
  clearError();
  btn.disabled = true;
  setLoading(true);
  try {
    switchToTextInputTab();
    await handleTextAnalyze();
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
});

async function handleAnalyze() {
  if (_isAnalyzing) return;
  _isAnalyzing = true;
  clearError();
  hideResult();
  setLoading(true);

  try {
    if (getActiveTab() === "image") {
      await handleImageAnalyze();
    } else {
      await handleTextAnalyze();
    }
  } finally {
    _isAnalyzing = false;
    setLoading(false);
  }
}

/**
 * テキスト欄の内容で API 判定（画像読み取り後の自動実行・手動ボタン共通）
 * @param {boolean} [recoverManualStepOnFail] 画像フローで失敗したとき「この内容で成分判定する」を再表示する
 */
async function classifyExtractedText(ingredientsText, recoverManualStepOnFail = false) {
  const extractActions = document.getElementById("extract-only-actions");
  if (extractActions) extractActions.setAttribute("hidden", "");
  try {
    const result = await analyzeWithClaude(ingredientsText);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false, ingredientsText);
  } catch (err) {
    showError(`解析エラー：${err.message}`);
    if (recoverManualStepOnFail) restoreExtractOnlyManualStep(ingredientsText);
  }
}

async function handleTextAnalyze() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  const ingredientsText = textarea.value.trim();
  if (!ingredientsText) {
    showError("成分表を入力してください。");
    return;
  }

  try {
    const result = await analyzeTextWithGemini(ingredientsText, currentSessionMode);
    const promoted = promoteFromUserDB(result);
    renderResult(promoted, false, ingredientsText);
    refreshScanBadge();
  } catch (err) {
    if (err.message === "scan_limit_exceeded") {
      showError("今月の無料枠（10回）を使い切りました。来月リセットされます。");
      return;
    }
    showError(`解析エラー：${err.message}`);
  }
}

async function handleImageAnalyze() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  if (!_imageBase64) {
    showError("画像を選択してください。");
    return;
  }

  const engine = getSelectedEngine();
  if (engine === "gemini-detailed") {
    await handleImageAnalyzeGeminiDetailed();
    return;
  }
  if (engine === "gemini") {
    await handleImageAnalyzeGemini();
    return;
  }

  // --- Claude 2ステップ（既存フロー）---
  try {
    const { extractedText } = await extractTextFromImage(_imageBase64, _imageMediaType);
    const text = String(extractedText || "").trim();
    if (!text) {
      showError("読み取ったテキストが空です。写真の切り取りを試すか、別の画像を選んでください。");
      return;
    }
    clearError();
    switchToTextInputTab();
    textarea.value = text;
    renderExtractOnlyResult(text, { autoClassifyNext: true });
    await classifyExtractedText(text, true);
  } catch (err) {
    showError(`読み取りエラー：${err.message}`);
  }
}

async function handleImageAnalyzeGemini() {
  try {
    _comparePhotoDataUrl = `data:${_imageMediaType};base64,${_imageBase64}`;
    const { data, extractedText } = await analyzeImageWithGemini(_imageBase64, _imageMediaType, currentSessionMode);
    const text = String(extractedText || "").trim();
    clearError();
    switchToTextInputTab();
    if (text) textarea.value = text;
    const promoted = promoteFromUserDB(data);
    renderResult(promoted, false, text);
  } catch (err) {
    showError(`Gemini 解析エラー：${err.message}`);
  }
}

// =============================================
// Gemini 詳細モード（確信度 + BBox + ベジ判定）
// =============================================

async function handleImageAnalyzeGeminiDetailed() {
  const saveArea = document.getElementById('save-to-mylist-area');
  if (saveArea) saveArea.style.display = 'none';
  const feedbackArea = document.getElementById('feedback-area');
  if (feedbackArea) feedbackArea.style.display = 'none';
  window._lastAnalysisResult = undefined;

  try {
    _comparePhotoDataUrl = `data:${_imageMediaType};base64,${_imageBase64}`;
    const { data, extractedText, product_name } = await analyzeImageWithGeminiDetailed(_imageBase64, _imageMediaType, currentSessionMode);
    _lastExtractedProductName = product_name ?? null;
    const text = String(extractedText || "").trim();
    clearError();
    switchToTextInputTab();
    if (text) textarea.value = text;
    // 写真＋読み取りテキストをClaude フローと同様に表示
    renderExtractedAccordion(text, false);
    updateResultComparePhoto();
    renderDetailedResult(data, _comparePhotoDataUrl, text);
    refreshScanBadge();
  } catch (err) {
    if (err.message === "scan_limit_exceeded") {
      showError("今月の無料枠（10回）を使い切りました。来月リセットされます。");
    } else {
      showError(`Gemini 詳細解析エラー：${err.message}`);
    }
  }
}
