/**
 * EatEase — 画像入力・カメラUI
 * 画像アップロード、トリミング、カメラ撮影を担当する。
 */

// --- Image state ---
let _imageBase64 = null;
let _imageMediaType = null;
/** 結果画面でテキストと照合するため、読み取り成功時点の画像（data URL） */
let _comparePhotoDataUrl = null;

const dropZone        = document.getElementById("drop-zone");
const imageInput      = document.getElementById("image-input");
const imagePreview    = document.getElementById("image-preview");
const dropPlaceholder = document.getElementById("drop-placeholder");
const clearImageBtn   = document.getElementById("clear-image-btn");
const imageToolbar    = document.getElementById("image-toolbar");
const cropPanel       = document.getElementById("crop-panel");
const cropCanvas      = document.getElementById("crop-canvas");
const btnStartCrop    = document.getElementById("btn-start-crop");
const btnApplyCrop    = document.getElementById("btn-apply-crop");
const btnCancelCrop   = document.getElementById("btn-cancel-crop");

const VALID_IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];

function isUnsupportedImageMime(file) {
  const t = (file.type || "").toLowerCase();
  return t === "image/heic" || t === "image/heif";
}

/** モバイルでは type が空・octet-stream になりがち。デコード可能なら受け入れる */
function mayBeProcessableImageFile(file) {
  if (!file?.type) return true;
  const t = file.type.toLowerCase();
  if (VALID_IMG_TYPES.includes(t)) return true;
  if (t.startsWith("image/")) return true;
  if (t === "application/octet-stream") return true;
  return false;
}

/** タイムアウトしやすいホスティング向け。長辺を抑えロード削減 */
const VISION_MAX_EDGE     = 900;
const VISION_JPEG_QUALITY = 0.78;
const IMG_MAX_BYTES       = 5 * 1024 * 1024;

let _currentImageBlob = null;

dropZone.addEventListener("click", (e) => {
  if (e.target === clearImageBtn || clearImageBtn.contains(e.target)) return;
  if (cropPanel.style.display !== "none") return;
  imageInput.click();
});
imageInput.addEventListener("change", () => { if (imageInput.files[0]) setImageFile(imageInput.files[0]); });

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) setImageFile(e.dataTransfer.files[0]);
});

clearImageBtn.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });

btnStartCrop.addEventListener("click", (e) => { e.stopPropagation(); openCropPanel(); });
btnCancelCrop.addEventListener("click", (e) => { e.stopPropagation(); closeCropPanel(); });
btnApplyCrop.addEventListener("click", (e) => { e.stopPropagation(); applyCropSelection(); });
document.getElementById("btn-toolbar-clear")?.addEventListener("click", (e) => { e.stopPropagation(); clearImage(); });

function clearCompareSnapshot() {
  _comparePhotoDataUrl = null;
  const wrap = document.getElementById("result-compare-photo-wrap");
  const img = document.getElementById("result-compare-photo");
  if (wrap) {
    wrap.style.display = "none";
    wrap.setAttribute("hidden", "");
  }
  if (img) img.removeAttribute("src");
}

function updateResultComparePhoto() {
  const wrap = document.getElementById("result-compare-photo-wrap");
  const img = document.getElementById("result-compare-photo");
  if (!wrap || !img) return;
  if (_comparePhotoDataUrl) {
    img.src = _comparePhotoDataUrl;
    img.alt = "読み取りに使った写真";
    wrap.removeAttribute("hidden");
    wrap.style.display = "";
  } else {
    wrap.style.display = "none";
    wrap.setAttribute("hidden", "");
    img.removeAttribute("src");
  }
}

function clearImage() {
  clearCompareSnapshot();
  _imageBase64 = _imageMediaType = null;
  _currentImageBlob = null;
  imagePreview.style.display = "none";
  imagePreview.src = "";
  dropPlaceholder.style.display = "";
  clearImageBtn.style.display = "none";
  imageToolbar.style.display = "none";
  cropPanel.style.display = "none";
  dropZone.classList.remove("has-image");
  imageInput.value = "";
  teardownCropInteraction();
}

function prepareImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        reject(new Error("bad image"));
        return;
      }
      const scale = Math.min(1, VISION_MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
        "image/jpeg",
        VISION_JPEG_QUALITY,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function setImageFile(file) {
  if (isUnsupportedImageMime(file)) {
    showError(
      "HEIC（iPhoneの写真）形式はこのブラウザでは読み取れません。写真アプリで「JPEGでコピー」するか、スクリーンショットをJPEGで保存してから選んでください。",
    );
    return;
  }
  if (!mayBeProcessableImageFile(file)) {
    showError("JPEG / PNG / WEBP 形式の画像を選択してください。");
    return;
  }
  if (file.size > IMG_MAX_BYTES) {
    showError("ファイルサイズは 5MB 以内にしてください。");
    return;
  }
  clearError();

  let blob;
  try {
    blob = await prepareImageForUpload(file);
  } catch {
    showError("画像の処理に失敗しました。別の画像を選択してください。");
    return;
  }

  try {
    _currentImageBlob = blob;
    _imageBase64 = await blobToBase64(blob);
    _imageMediaType = "image/jpeg";

    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src = objUrl;
    imagePreview.style.display = "block";
    dropPlaceholder.style.display = "none";
    clearImageBtn.style.display  = "inline-block";
    imageToolbar.style.display   = "block";
    cropPanel.style.display      = "none";
    dropZone.classList.add("has-image");
    requestAnimationFrame(() =>
      imageToolbar?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  } catch {
    showError("画像の読み込みに失敗しました。");
  }
}

let _cropCtx = null;
let _cropImg = null;
let _cropDrag = false;
let _cropX0 = 0, _cropY0 = 0, _cropX1 = 0, _cropY1 = 0;
const CROP_MIN_PX = 36;

function getCanvasPointer(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function redrawCropCanvas() {
  if (!_cropCtx || !_cropImg) return;
  const ctx = _cropCtx;
  const cw = cropCanvas.width;
  const ch = cropCanvas.height;
  ctx.drawImage(_cropImg, 0, 0, cw, ch);
  const x0 = Math.min(_cropX0, _cropX1);
  const y0 = Math.min(_cropY0, _cropY1);
  const x1 = Math.max(_cropX0, _cropX1);
  const y1 = Math.max(_cropY0, _cropY1);
  if (x1 - x0 > 2 && y1 - y0 > 2) {
    ctx.fillStyle = "rgba(21, 101, 192, 0.2)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = "#1565c0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

function openCropPanel() {
  if (!_currentImageBlob) return;
  const url = URL.createObjectURL(_currentImageBlob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    _cropImg = img;
    const maxDisplay = 720;
    let dw = img.naturalWidth;
    let dh = img.naturalHeight;
    if (dw > maxDisplay) {
      const s = maxDisplay / dw;
      dw = Math.round(dw * s);
      dh = Math.round(dh * s);
    }
    cropCanvas.width = dw;
    cropCanvas.height = dh;
    _cropCtx = cropCanvas.getContext("2d");
    _cropCtx.drawImage(img, 0, 0, dw, dh);
    _cropX0 = _cropY0 = _cropX1 = _cropY1 = 0;
    btnApplyCrop.disabled = true;
    imageToolbar.style.display = "none";
    cropPanel.style.display = "block";
    setupCropInteraction();
    requestAnimationFrame(() =>
      cropPanel.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showError("切り取り用に画像を開けませんでした。");
  };
  img.src = url;
}

function closeCropPanel() {
  cropPanel.style.display = "none";
  imageToolbar.style.display = "block";
  teardownCropInteraction();
  _cropImg = null;
  _cropCtx = null;
}

function setupCropInteraction() {
  const onDown = (e) => {
    e.preventDefault();
    _cropDrag = true;
    const p = getCanvasPointer(e, cropCanvas);
    _cropX0 = _cropX1 = p.x;
    _cropY0 = _cropY1 = p.y;
    btnApplyCrop.disabled = true;
  };
  const onMove = (e) => {
    if (!_cropDrag) return;
    e.preventDefault();
    const p = getCanvasPointer(e, cropCanvas);
    _cropX1 = p.x;
    _cropY1 = p.y;
    redrawCropCanvas();
  };
  const onUp = (e) => {
    if (!_cropDrag) return;
    e.preventDefault();
    _cropDrag = false;
    const w = Math.abs(_cropX1 - _cropX0);
    const h = Math.abs(_cropY1 - _cropY0);
    btnApplyCrop.disabled = w < CROP_MIN_PX || h < CROP_MIN_PX;
  };

  cropCanvas._sfDown = onDown;
  cropCanvas._sfMove = onMove;
  cropCanvas._sfUp = onUp;

  cropCanvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  cropCanvas.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", onUp);
}

function teardownCropInteraction() {
  if (!cropCanvas._sfDown) return;
  cropCanvas.removeEventListener("mousedown", cropCanvas._sfDown);
  window.removeEventListener("mousemove", cropCanvas._sfMove);
  window.removeEventListener("mouseup", cropCanvas._sfUp);
  cropCanvas.removeEventListener("touchstart", cropCanvas._sfDown);
  window.removeEventListener("touchmove", cropCanvas._sfMove);
  window.removeEventListener("touchend", cropCanvas._sfUp);
  cropCanvas._sfDown = cropCanvas._sfMove = cropCanvas._sfUp = null;
}

async function applyCropSelection() {
  if (!_cropImg || btnApplyCrop.disabled) return;
  const x0 = Math.min(_cropX0, _cropX1);
  const y0 = Math.min(_cropY0, _cropY1);
  const x1 = Math.max(_cropX0, _cropX1);
  const y1 = Math.max(_cropY0, _cropY1);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < CROP_MIN_PX || rh < CROP_MIN_PX) return;

  const fx = _cropImg.naturalWidth / cropCanvas.width;
  const fy = _cropImg.naturalHeight / cropCanvas.height;
  const sx = Math.max(0, Math.floor(x0 * fx));
  const sy = Math.max(0, Math.floor(y0 * fy));
  const sw = Math.min(_cropImg.naturalWidth - sx, Math.ceil(rw * fx));
  const sh = Math.min(_cropImg.naturalHeight - sy, Math.ceil(rh * fy));
  if (sw < CROP_MIN_PX || sh < CROP_MIN_PX) return;

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(_cropImg, sx, sy, sw, sh, 0, 0, sw, sh);

  let blob = await new Promise((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("crop failed"))),
      "image/jpeg",
      VISION_JPEG_QUALITY,
    );
  });

  try {
    blob = await prepareImageForUpload(new File([blob], "crop.jpg", { type: "image/jpeg" }));
  } catch { /* そのまま */ }

  try {
    _currentImageBlob = blob;
    _imageBase64 = await blobToBase64(blob);
    _imageMediaType = "image/jpeg";
    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src = objUrl;
  } catch {
    showError("切り取り画像の保存に失敗しました。");
    return;
  }

  closeCropPanel();
  clearError();
}

// =============================================
// カメラ直接撮影（枠合わせ）
// =============================================

let _cameraStream = null;

const btnOpenCamera    = document.getElementById("btn-open-camera");
const cameraOverlay    = document.getElementById("camera-overlay");
const cameraVideo      = document.getElementById("camera-video");
const cameraGuideBox   = document.getElementById("camera-guide-box");
const btnCameraCapture = document.getElementById("btn-camera-capture");
const btnCameraCancel  = document.getElementById("btn-camera-cancel");

if (btnOpenCamera) btnOpenCamera.style.display = "inline-block";

btnOpenCamera?.addEventListener("click", (e) => {
  e.stopPropagation();
  openCameraOverlay();
});

btnCameraCapture?.addEventListener("click", () => captureFromCamera());
btnCameraCancel?.addEventListener("click",  () => closeCameraOverlay());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cameraOverlay && !cameraOverlay.hidden) closeCameraOverlay();
});

async function openCameraOverlay() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      if (err.name === "NotAllowedError") {
        showError("カメラのアクセスが拒否されています。ブラウザの設定でカメラを許可してください。");
        return;
      }
      // getUserMedia 非対応端末は file input にフォールバック
      await showGuideAndCapture();
      return;
    }
  }
  _cameraStream = stream;
  cameraVideo.srcObject = stream;
  try { await cameraVideo.play(); } catch { /* autoplay属性で再生済みの場合は無視 */ }

  // 映像が実際に取得できているか確認（真っ暗＝0x0 の場合は file input fallback）
  await new Promise(r => setTimeout(r, 600));
  if (cameraVideo.videoWidth === 0) {
    closeCameraOverlay();
    await showGuideAndCapture();
    return;
  }

  cameraOverlay.removeAttribute("hidden");
}

// ネイティブカメラ使用時：撮影前にガイド枠を見せてから開く
function showGuideAndCapture() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.88)',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'gap:20px', 'padding:24px',
    ].join(';');

    const frame = document.createElement('div');
    frame.style.cssText = [
      'width:80%', 'aspect-ratio:3/2',
      'border:3px dashed #fff', 'border-radius:8px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'color:#fff', 'font-size:13px', 'text-align:center', 'padding:12px',
    ].join(';');
    frame.textContent = '原材料名・成分表示をこの枠に合わせて撮影してください';

    const hint = document.createElement('p');
    hint.style.cssText = 'color:#ccc;font-size:13px;text-align:center;margin:0;';
    hint.textContent = '近づいて成分表だけが枠内に入るようにしてください';

    const btnShoot = document.createElement('button');
    btnShoot.textContent = '📷 カメラを開く';
    btnShoot.style.cssText = [
      'padding:12px 32px', 'font-size:16px', 'font-weight:bold',
      'background:#1565c0', 'color:#fff',
      'border:none', 'border-radius:8px', 'cursor:pointer',
    ].join(';');

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'キャンセル';
    btnCancel.style.cssText = [
      'padding:8px 24px', 'font-size:14px',
      'background:transparent', 'color:#aaa',
      'border:1px solid #666', 'border-radius:8px', 'cursor:pointer',
    ].join(';');

    overlay.append(frame, hint, btnShoot, btnCancel);
    document.body.appendChild(overlay);

    btnShoot.addEventListener('click', () => {
      document.body.removeChild(overlay);
      imageInput.click();
      resolve();
    });
    btnCancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve();
    });
  });
}

function closeCameraOverlay() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach((t) => t.stop());
    _cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraOverlay.setAttribute("hidden", "");
}

function captureFromCamera() {
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  if (!vw || !vh) {
    showError("カメラの準備ができていません。少し待ってから撮影してください。");
    return;
  }

  const videoRect = cameraVideo.getBoundingClientRect();
  const guideRect = cameraGuideBox.getBoundingClientRect();

  // object-fit:cover の座標変換（表示座標 → 動画ピクセル座標）
  const scale = Math.max(videoRect.width / vw, videoRect.height / vh);
  const xOrig = (videoRect.width  - vw * scale) / 2;
  const yOrig = (videoRect.height - vh * scale) / 2;

  const gLeft = guideRect.left - videoRect.left;
  const gTop  = guideRect.top  - videoRect.top;

  const cropX = Math.max(0, (gLeft - xOrig) / scale);
  const cropY = Math.max(0, (gTop  - yOrig) / scale);
  const cropW = Math.min(guideRect.width  / scale, vw - cropX);
  const cropH = Math.min(guideRect.height / scale, vh - cropY);

  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(cropW);
  canvas.height = Math.round(cropH);
  canvas.getContext("2d").drawImage(
    cameraVideo,
    Math.round(cropX), Math.round(cropY), Math.round(cropW), Math.round(cropH),
    0, 0, canvas.width, canvas.height,
  );

  canvas.toBlob(async (rawBlob) => {
    closeCameraOverlay();
    if (!rawBlob) { showError("撮影に失敗しました。もう一度試してください。"); return; }
    let blob = rawBlob;
    try {
      blob = await prepareImageForUpload(new File([rawBlob], "camera.jpg", { type: "image/jpeg" }));
    } catch { /* リサイズ失敗時はそのまま */ }
    await setProcessedBlob(blob);
  }, "image/jpeg", 0.92);
}

// カメラ撮影後の共通後処理（既存フローと合流）
async function setProcessedBlob(blob) {
  try {
    _currentImageBlob = blob;
    _imageBase64      = await blobToBase64(blob);
    _imageMediaType   = "image/jpeg";

    const objUrl = URL.createObjectURL(blob);
    imagePreview.onload = () => URL.revokeObjectURL(objUrl);
    imagePreview.src    = objUrl;
    imagePreview.style.display    = "block";
    dropPlaceholder.style.display = "none";
    clearImageBtn.style.display   = "inline-block";
    imageToolbar.style.display    = "block";
    cropPanel.style.display       = "none";
    dropZone.classList.add("has-image");
    clearError();
    requestAnimationFrame(() =>
      imageToolbar?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  } catch {
    showError("撮影した画像の処理に失敗しました。");
  }
}
