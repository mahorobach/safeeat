/**
 * EatEase — バーコードスキャン・マイリストUI
 * 商品保存、マイリスト表示、バーコード登録画面を担当する。
 */

// ===== バーコードスキャン・マイリスト保存 =====
(function () {
  let _html5QrCode = null;
  let _scannedProduct = null;

  async function stopBarcodeScanner() {
    if (_html5QrCode) {
      try { await _html5QrCode.stop(); } catch (e) { /* ignore */ }
      _html5QrCode = null;
    }
  }

  function closeBarcodeArea() {
    stopBarcodeScanner();
    _scannedProduct = null;
    const area = document.getElementById('barcode-scan-area');
    const preview = document.getElementById('barcode-result-preview');
    const errEl = document.getElementById('barcode-scan-error');
    if (area) area.style.display = 'none';
    if (preview) preview.style.display = 'none';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }

  window._stopBarcodeScanner = stopBarcodeScanner;

  document.getElementById('btn-save-product-open')?.addEventListener('click', async () => {
    if (!window.SafeEatAuth) return;
    const area = document.getElementById('barcode-scan-area');
    if (!area) return;
    area.style.display = '';
    document.getElementById('barcode-result-preview').style.display = 'none';
    document.getElementById('barcode-scan-error').style.display = 'none';

    const errEl = document.getElementById('barcode-scan-error');
    try {
      _html5QrCode = new Html5Qrcode('qr-reader');
      await _html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
          supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        },
        async (decodedText) => {
          await stopBarcodeScanner();
          errEl.style.display = 'none';
          try {
            const product = await lookupProduct(decodedText);
            _scannedProduct = product;
            document.getElementById('barcode-product-name').textContent = product.product_name;
            const img = document.getElementById('barcode-product-image');
            img.src = product.image_url || '';
            img.style.display = product.image_url ? '' : 'none';
            const link = document.getElementById('barcode-product-link');
            link.href = product.shop_url || '#';
            const amazonLink = document.getElementById('barcode-amazon-link');
            const amazonQuery = product.jan_code || product.product_name;
            amazonLink.href = `https://www.amazon.co.jp/s?k=${encodeURIComponent(amazonQuery)}&i=grocery&tag=vegeatease-22`;
            document.getElementById('barcode-result-preview').style.display = '';
          } catch (e) {
            errEl.textContent = e.message || '商品情報の取得に失敗しました';
            errEl.style.display = '';
          }
        },
        () => {}
      );
    } catch (e) {
      errEl.textContent = 'カメラを起動できませんでした';
      errEl.style.display = '';
    }
  });

  document.getElementById('btn-barcode-close')?.addEventListener('click', closeBarcodeArea);
  document.getElementById('btn-barcode-cancel')?.addEventListener('click', closeBarcodeArea);

  document.getElementById('btn-barcode-skip')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-barcode-skip');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await saveProduct({
        diet_mode:       currentSessionMode || 'oriental',
        ingredient_text: _lastExtractedText || null,
        is_safe:         true,
      });
      _ALL_PAGES.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('scanner-page').style.display = 'block';
      const saveSection = document.getElementById('save-product-section');
      if (saveSection) saveSection.style.display = 'none';
      const msg = document.getElementById('mylist-saved-message');
      if (msg) msg.style.display = '';
    } catch (e) {
      const errEl = document.getElementById('barcode-scan-error');
      errEl.textContent = e.message || '保存に失敗しました';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = 'バーコードなしで保存する';
    }
  });

  document.getElementById('btn-barcode-save')?.addEventListener('click', async () => {
    if (!_scannedProduct) return;
    const btn = document.getElementById('btn-barcode-save');
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
      await saveProduct({
        jan_code:        _scannedProduct.jan_code,
        product_name:    _scannedProduct.product_name,
        image_url:       _scannedProduct.image_url,
        shop_url:        _scannedProduct.shop_url,
        amazon_url:      `https://www.amazon.co.jp/s?k=${encodeURIComponent(_scannedProduct.jan_code)}&i=grocery&tag=vegeatease-22`,
        diet_mode:       currentSessionMode || 'oriental',
        ingredient_text: _lastExtractedText || null,
        is_safe:         true,
      });
      btn.textContent = '✅ 保存しました';
      setTimeout(closeBarcodeArea, 1200);
    } catch (e) {
      const errEl = document.getElementById('barcode-scan-error');
      errEl.textContent = e.message || '保存に失敗しました';
      errEl.style.display = '';
      btn.disabled = false;
      btn.textContent = '保存する';
    }
  });

  // ===== 判定OK後マイリスト登録バーコードスキャンページ =====
  let _saveBarcodeScanner = null;

  function openSaveBarcodePage() {
    showById('save-barcode-page');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const resultArea = document.getElementById('barcode-save-result');
    if (resultArea) resultArea.style.display = 'none';
    _saveBarcodeScanner = new Html5Qrcode('save-qr-reader');
    _saveBarcodeScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 100 }, supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA] },
      async (janCode) => {
        await _saveBarcodeScanner.stop().catch(() => {});
        _saveBarcodeScanner = null;
        await onSaveBarcodeScanned(janCode);
      },
      () => {}
    ).catch(() => {});
  }

  async function stopSaveBarcodeScanner() {
    if (_saveBarcodeScanner) {
      await _saveBarcodeScanner.stop().catch(() => {});
      _saveBarcodeScanner = null;
    }
  }

  async function closeSaveBarcodePage() {
    if (_saveBarcodeScanner) {
      await _saveBarcodeScanner.stop().catch(() => {});
      _saveBarcodeScanner = null;
    }
    showById('scanner-page');
  }

  async function onSaveBarcodeScanned(janCode) {
    // スキャン情報を保持（保存ボタン押下時に使用）
    _lastScannedProduct = {
      jan_code:   janCode,
      image_url:  null,
      shop_url:   null,
      amazon_url: `https://www.amazon.co.jp/s?k=${encodeURIComponent(janCode)}&i=grocery&tag=vegeatease-22`,
    };

    // 商品情報を取得（失敗しても続行）
    let productName = null;
    try {
      const productData = await lookupProduct(janCode);
      productName                   = productData?.product_name ?? null;
      _lastScannedProduct.image_url = productData?.image_url    ?? null;
      _lastScannedProduct.shop_url  = productData?.shop_url     ?? null;
    } catch (e) {
      console.warn('商品情報取得失敗', e);
    }

    // save-barcode-page を閉じて scanner-page に戻る
    _ALL_PAGES.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.getElementById('scanner-page').style.display = 'block';

    // save-to-mylist-area を確認入力モードに切り替え
    const area = document.getElementById('save-to-mylist-area');
    if (area) area.style.display = '';
    document.getElementById('btn-save-to-mylist')?.style && (document.getElementById('btn-save-to-mylist').style.display = 'none');
    document.getElementById('btn-save-no-barcode')?.style && (document.getElementById('btn-save-no-barcode').style.display = 'none');
    const form = document.getElementById('save-no-barcode-form');
    if (form) form.style.display = '';
    const input = document.getElementById('input-product-name');
    if (input) {
      input.value       = productName || _lastExtractedProductName || '';
      input.placeholder = '商品名を入力してください（省略可）';
      input.focus();
    }

    setTimeout(() => {
      window.scrollTo(0, 0);
      setTimeout(() => {
        const form = document.getElementById('save-no-barcode-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }, 50);
  }

  async function doSaveToMylist(productData = {}) {
    const btn = document.getElementById('btn-save-to-mylist');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

    let savedOk = false;
    let is409   = false;

    try {
      await saveProduct({
        ingredient_text: _lastExtractedText || null,
        diet_mode:       currentSessionMode || 'oriental',
        is_safe:         true,
        ...productData,
      });
      savedOk = true;
    } catch (e) {
      if (e.message?.includes('保存済み')) {
        is409 = true;
      } else {
        if (btn) { btn.disabled = false; btn.style.display = ''; btn.textContent = '📷 バーコードを読み取り、この商品をリストに登録'; }
        const resultArea = document.getElementById('barcode-save-result');
        const statusEl   = document.getElementById('barcode-save-status');
        if (statusEl) statusEl.textContent = '保存に失敗しました: ' + (e.message || '');
        if (resultArea) resultArea.style.display = '';
        return;
      }
    }

    // 成功 or 保存済み
    await stopSaveBarcodeScanner();

    // 登録ボタンエリアを非表示
    const saveSection = document.getElementById('save-product-section');
    if (saveSection) saveSection.style.display = 'none';
    const saveToMylistArea = document.getElementById('save-to-mylist-area');
    if (saveToMylistArea) saveToMylistArea.style.display = 'none';

    // 保存完了メッセージを表示
    const savedMsg = document.getElementById('mylist-saved-message');
    if (savedMsg) {
      savedMsg.style.display = '';
      const rakutenBtn = document.getElementById('btn-rakuten-after-save');
      const rakutenUrl = productData?.shop_url || null;
      if (rakutenBtn && rakutenUrl) {
        rakutenBtn.href = rakutenUrl;
        rakutenBtn.style.display = '';
      } else if (rakutenBtn) {
        rakutenBtn.style.display = 'none';
      }

      const amazonBtn = document.getElementById('btn-amazon-after-save');
      const amazonUrl = productData?.amazon_url || null;
      if (amazonBtn && amazonUrl) {
        amazonBtn.href = amazonUrl;
        amazonBtn.style.display = '';
      } else if (amazonBtn) {
        amazonBtn.style.display = 'none';
      }
    }

    // scanner-page に戻る
    _ALL_PAGES.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.getElementById('scanner-page').style.display = 'block';

  }

  document.getElementById('btn-save-to-mylist')?.addEventListener('click', openSaveBarcodePage);

  // 「バーコードなしで保存」ボタン → 入力欄を展開
  document.getElementById('btn-save-no-barcode')?.addEventListener('click', () => {
    const form = document.getElementById('save-no-barcode-form');
    if (form) {
      form.style.display = form.style.display === 'none' ? '' : 'none';
      if (form.style.display !== 'none') {
        const input = document.getElementById('input-product-name');
        if (input) {
          if (!input.value) input.value = _lastExtractedProductName || '';
          input.focus();
        }
      }
    }
  });

  // 「保存する」ボタン（バーコードなし or バーコードスキャン後の確認）
  document.getElementById('btn-save-no-barcode-confirm')?.addEventListener('click', async () => {
    const productName = document.getElementById('input-product-name')?.value.trim() || null;
    await doSaveToMylist({
      product_name: productName,
      ...(_lastScannedProduct || {}),
    });
  });

  document.getElementById('barcode-goto-mylist')?.addEventListener('click', () => {
    showById('mylist-page');
    loadMyList();
  });

  document.getElementById('barcode-new-scan')?.addEventListener('click', () => {
    showById('scanner-page');
    document.getElementById('btn-result-reset')?.click();
  });

  // ===== マイリストページ =====
  document.getElementById('drawer-nav-mylist')?.addEventListener('click', async (e) => {
    e.preventDefault();
    window.closeDrawer?.();
    showById('mylist-page');
    await loadMyList();
  });

  document.getElementById('drawer-nav-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.closeDrawer?.();
    showById('scanner-page');
    setTimeout(() => {
      const section = document.getElementById('save-product-section');
      if (section) section.style.display = '';
      document.getElementById('btn-save-product-open')?.click();
    }, 100);
  });

  document.getElementById('btn-mylist-back')?.addEventListener('click', () => {
    showById('scanner-page');
  });

  async function loadMyList() {
    const itemsEl = document.getElementById('mylist-items');
    const emptyEl = document.getElementById('mylist-empty');
    if (!itemsEl) return;
    itemsEl.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;">読み込み中…</p>';
    try {
      const items = await getMyList();
      itemsEl.innerHTML = '';
      if (items.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'mylist-card';
        card.innerHTML = `
          ${item.image_url ? `<img class="mylist-card-image" src="${esc(item.image_url)}" alt="">` : '<div class="mylist-card-no-image">📦</div>'}
          <div class="mylist-card-body">
            <div class="mylist-card-name">${esc(item.product_name || '（商品名未登録）')}</div>
            <div class="mylist-card-mode">${esc(item.diet_mode)}</div>
            <div class="mylist-card-links">
              ${item.shop_url ? `<a class="mylist-card-link" href="${esc(item.shop_url)}" target="_blank" rel="noopener">楽天 →</a>` : ''}
              <a class="mylist-card-link mylist-card-link--amazon" href="https://www.amazon.co.jp/s?k=${encodeURIComponent(item.jan_code)}&tag=vegeatease-22" target="_blank" rel="noopener">Amazon →</a>
            </div>
          </div>
          <button class="mylist-card-delete" data-id="${esc(item.id)}" aria-label="削除">✕</button>
        `;
        card.querySelector('.mylist-card-delete')?.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          if (!confirm('このアイテムを削除しますか？')) return;
          try {
            await deleteProduct(id);
            card.remove();
            const remaining = itemsEl.querySelectorAll('.mylist-card');
            if (remaining.length === 0 && emptyEl) emptyEl.style.display = '';
          } catch (err) {
            alert(err.message || '削除に失敗しました');
          }
        });
        itemsEl.appendChild(card);
      });
    } catch (e) {
      itemsEl.innerHTML = `<p style="text-align:center;color:#c00;padding:2rem;">${e.message || '取得に失敗しました'}</p>`;
    }
  }

  window.openSaveBarcodePage = openSaveBarcodePage;
  window.loadMyList = loadMyList;

  // ===== マイリスト追加専用スキャンページ =====
  let _mylistAddScanner = null;

  function openMylistAddPage() {
    _ALL_PAGES.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.getElementById('mylist-add-page').style.display = 'block';
    const errEl = document.getElementById('mylist-add-error');
    errEl.style.display = 'none';
    _mylistAddScanner = new Html5Qrcode('mylist-add-qr-reader');
    _mylistAddScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 100 },
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA] },
      async (janCode) => {
        await _mylistAddScanner.stop().catch(() => {});
        _mylistAddScanner = null;
        try {
          const product = await lookupProduct(janCode);
          await saveProduct({
            jan_code:        product.jan_code,
            product_name:    product.product_name,
            image_url:       product.image_url,
            shop_url:        product.shop_url,
            amazon_url:      `https://www.amazon.co.jp/s?k=${encodeURIComponent(janCode)}&i=grocery&tag=vegeatease-22`,
            diet_mode:       currentSessionMode || 'oriental',
            ingredient_text: null,
            is_safe:         true,
          });
        } catch (e) {
          await saveProduct({
            jan_code:        janCode,
            product_name:    null,
            diet_mode:       currentSessionMode || 'oriental',
            ingredient_text: null,
            is_safe:         true,
          });
        }
        showById('mylist-page');
        await loadMyList();
      },
      () => {}
    ).catch(() => {
      errEl.textContent = 'カメラを起動できませんでした';
      errEl.style.display = '';
    });
  }

  document.getElementById('btn-mylist-add-back')?.addEventListener('click', async () => {
    if (_mylistAddScanner) {
      await _mylistAddScanner.stop().catch(() => {});
      _mylistAddScanner = null;
    }
    showById('mylist-page');
    await loadMyList();
  });

  document.getElementById('btn-add-to-mylist')?.addEventListener('click', () => {
    openMylistAddPage();
  });

  document.getElementById('btn-goto-mylist-from-settings')?.addEventListener('click', () => {
    showById('mylist-page');
    loadMyList();
  });

  document.getElementById('btn-goto-mylist-after-save')?.addEventListener('click', () => {
    document.getElementById('mylist-saved-message').style.display = 'none';
    showById('mylist-page');
    loadMyList();
  });
})();
