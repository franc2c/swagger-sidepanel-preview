/* ==========================================================
   Swagger Side Preview — Side Panel Logic
   ========================================================== */

(function () {
  'use strict';

  // ---- DOM refs ----
  const inputPanel     = document.getElementById('input-panel');
  const swaggerViewer  = document.getElementById('swagger-viewer');
  const swaggerUiEl    = document.getElementById('swagger-ui');
  const viewerTitle    = document.getElementById('viewer-title');

  // Tabs
  const tabs           = document.querySelectorAll('.tab');
  const tabContents    = document.querySelectorAll('.tab-content');

  // URL tab
  const urlInput       = document.getElementById('url-input');
  const btnLoadUrl     = document.getElementById('btn-load-url');

  // Paste tab
  const pasteInput     = document.getElementById('paste-input');
  const btnLoadPaste   = document.getElementById('btn-load-paste');

  // Selection tab
  const selectionInput = document.getElementById('selection-input');
  const btnLoadSel     = document.getElementById('btn-load-selection');

  // Server override (input panel)
  const serverUrlInput = document.getElementById('server-url-input');

  // Server override (viewer toolbar)
  const viewerServerInput = document.getElementById('viewer-server-input');
  const btnApplyServer    = document.getElementById('btn-apply-server');
  const btnResetServer    = document.getElementById('btn-reset-server');

  // History
  const historyList    = document.getElementById('history-list');
  const btnClearHist   = document.getElementById('btn-clear-history');

  // Back button
  const btnBack        = document.getElementById('btn-back');

  // ---- State ----
  let currentSwaggerUI = null;
  let lastLoadedSpec = null;   // { url?, spec?, title }
  let activeServerOverride = '';

  // ===========================================================
  //  TAB SWITCHING
  // ===========================================================
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tabContents.forEach((tc) => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // ===========================================================
  //  SWAGGER UI RENDERING
  // ===========================================================

  function renderSwaggerUI({ url, spec, title }) {
    // Guard: make sure Swagger UI loaded
    if (typeof SwaggerUIBundle === 'undefined') {
      showToast('Swagger UI failed to load. Try reloading the extension.', 'error');
      return;
    }

    // Remember what we loaded so we can re-render on server change
    lastLoadedSpec = { url, spec, title };

    inputPanel.classList.add('hidden');
    swaggerViewer.classList.remove('hidden');
    viewerTitle.textContent = title || 'Preview';

    // Sync server input: prefer active override, then input-panel value
    if (activeServerOverride) {
      viewerServerInput.value = activeServerOverride;
    } else if (serverUrlInput.value.trim()) {
      viewerServerInput.value = serverUrlInput.value.trim();
      activeServerOverride = viewerServerInput.value;
    }
    updateServerHighlight();

    // Destroy previous instance
    if (currentSwaggerUI) {
      swaggerUiEl.innerHTML = '';
      currentSwaggerUI = null;
    }

    const doRender = (renderOpts) => {
      const opts = {
        dom_id: '#swagger-ui',
        deepLinking: false,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: 'BaseLayout',
        ...renderOpts,
      };

      // Server override
      const serverOverride = activeServerOverride || serverUrlInput.value.trim();
      if (serverOverride) {
        const overridePlugin = () => ({
          statePlugins: {
            spec: {
              wrapActions: {
                updateJsonSpec: (oriAction) => (specObj) => {
                  if (specObj.openapi) {
                    specObj.servers = [{ url: serverOverride }];
                  } else if (specObj.swagger) {
                    try {
                      const parsed = new URL(serverOverride);
                      specObj.host = parsed.host;
                      specObj.basePath = parsed.pathname === '/' ? specObj.basePath : parsed.pathname;
                      specObj.schemes = [parsed.protocol.replace(':', '')];
                    } catch (_) {}
                  }
                  return oriAction(specObj);
                }
              }
            }
          }
        });
        opts.plugins.push(overridePlugin);
      }

      try {
        currentSwaggerUI = SwaggerUIBundle(opts);
      } catch (e) {
        showToast('Failed to render spec: ' + e.message, 'error');
        goBack();
      }
    };

    if (url) {
      // Fetch the spec ourselves to avoid CORS/CSP issues in extension context
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          let parsed;
          try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
          if (parsed) {
            doRender({ spec: parsed });
          } else {
            // Fallback: let Swagger UI try with the URL directly
            doRender({ url });
          }
        })
        .catch((err) => {
          showToast('Failed to fetch URL: ' + err.message, 'error');
          goBack();
        });
    } else if (spec) {
      doRender({ spec });
    }
  }

  // ===========================================================
  //  PARSE SPEC TEXT  (JSON or YAML-ish)
  // ===========================================================

  function parseSpec(raw) {
    const trimmed = raw.trim();
    // Try JSON first
    try {
      return JSON.parse(trimmed);
    } catch (_) { /* not JSON */ }

    // Simple YAML: swagger-ui-bundle can handle YAML strings if passed as url
    // But for paste, we try a basic yaml→json via the bundle if available
    // If not, show an error
    if (typeof jsyaml !== 'undefined') {
      try {
        return jsyaml.load(trimmed);
      } catch (_) { /* not valid YAML */ }
    }

    // Last resort: try if it starts with { after trimming whitespace/BOM
    const cleaned = trimmed.replace(/^\uFEFF/, '');
    try {
      return JSON.parse(cleaned);
    } catch (_) { /* nope */ }

    return null;
  }

  // ===========================================================
  //  LOAD FROM URL
  // ===========================================================

  btnLoadUrl.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('Please enter a URL', 'error');
      return;
    }
    addHistory({ type: 'url', value: url, label: url });
    renderSwaggerUI({ url, title: url });
  });

  // Allow Enter key
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnLoadUrl.click();
  });

  // ===========================================================
  //  LOAD FROM PASTE
  // ===========================================================

  btnLoadPaste.addEventListener('click', () => {
    const raw = pasteInput.value.trim();
    if (!raw) {
      showToast('Please paste an OpenAPI spec', 'error');
      return;
    }
    const spec = parseSpec(raw);
    if (!spec) {
      showToast('Could not parse spec. Make sure it is valid JSON.', 'error');
      return;
    }
    const label = spec.info?.title || 'Pasted Spec';
    addHistory({ type: 'paste', value: raw, label });
    renderSwaggerUI({ spec, title: label });
  });

  // ===========================================================
  //  LOAD FROM BROWSER SELECTION (via context menu)
  // ===========================================================

  btnLoadSel.addEventListener('click', () => {
    const raw = selectionInput.value.trim();
    if (!raw) return;
    const spec = parseSpec(raw);
    if (!spec) {
      showToast('Could not parse selected text as OpenAPI spec', 'error');
      return;
    }
    const label = spec.info?.title || 'Selected Spec';
    addHistory({ type: 'selection', value: raw, label });
    renderSwaggerUI({ spec, title: label });
  });

  // Listen for messages from background (context menu import)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'IMPORT_SELECTION' && msg.text) {
      selectionInput.value = msg.text;
      btnLoadSel.disabled = false;

      // Switch to selection tab
      tabs.forEach((t) => t.classList.remove('active'));
      tabContents.forEach((tc) => tc.classList.remove('active'));
      document.querySelector('[data-tab="tab-selection"]').classList.add('active');
      document.getElementById('tab-selection').classList.add('active');

      // Try auto-render
      const spec = parseSpec(msg.text);
      if (spec) {
        const label = spec.info?.title || 'Selected Spec';
        addHistory({ type: 'selection', value: msg.text, label });
        renderSwaggerUI({ spec, title: label });
      }
    }
  });

  // ===========================================================
  //  BACK BUTTON
  // ===========================================================

  btnBack.addEventListener('click', goBack);

  function goBack() {
    swaggerViewer.classList.add('hidden');
    inputPanel.classList.remove('hidden');
    swaggerUiEl.innerHTML = '';
    currentSwaggerUI = null;
    lastLoadedSpec = null;
    activeServerOverride = '';
    viewerServerInput.value = '';
    updateServerHighlight();
  }

  // ===========================================================
  //  VIEWER SERVER OVERRIDE
  // ===========================================================

  function updateServerHighlight() {
    if (viewerServerInput.value.trim()) {
      viewerServerInput.classList.add('server-active');
    } else {
      viewerServerInput.classList.remove('server-active');
    }
  }

  btnApplyServer.addEventListener('click', () => {
    activeServerOverride = viewerServerInput.value.trim();
    updateServerHighlight();
    if (!lastLoadedSpec) return;
    // Re-render with the new server
    renderSwaggerUI(lastLoadedSpec);
    showToast(activeServerOverride ? 'Server overridden' : 'Using spec default servers', 'success');
  });

  btnResetServer.addEventListener('click', () => {
    viewerServerInput.value = '';
    activeServerOverride = '';
    updateServerHighlight();
    if (!lastLoadedSpec) return;
    renderSwaggerUI(lastLoadedSpec);
    showToast('Server reset to spec default', 'success');
  });

  viewerServerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnApplyServer.click();
  });

  // ===========================================================
  //  HISTORY (using chrome.storage.local)
  // ===========================================================

  const HISTORY_KEY = 'swagger_side_history';
  const MAX_HISTORY = 20;

  function loadHistory() {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      const items = data[HISTORY_KEY] || [];
      renderHistory(items);
    });
  }

  function addHistory(entry) {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      let items = data[HISTORY_KEY] || [];
      // Remove duplicate
      items = items.filter((i) => i.value !== entry.value);
      items.unshift({ ...entry, ts: Date.now() });
      if (items.length > MAX_HISTORY) items = items.slice(0, MAX_HISTORY);
      chrome.storage.local.set({ [HISTORY_KEY]: items }, () => renderHistory(items));
    });
  }

  function removeHistoryItem(ts) {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      let items = (data[HISTORY_KEY] || []).filter((i) => i.ts !== ts);
      chrome.storage.local.set({ [HISTORY_KEY]: items }, () => renderHistory(items));
    });
  }

  function renderHistory(items) {
    historyList.innerHTML = '';
    if (!items.length) {
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');

      const typeSpan = document.createElement('span');
      typeSpan.className = 'hist-type';
      typeSpan.textContent = item.type;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'hist-label';
      labelSpan.textContent = item.label || item.value;
      labelSpan.title = item.value;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'hist-remove';
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeHistoryItem(item.ts);
      });

      li.appendChild(typeSpan);
      li.appendChild(labelSpan);
      li.appendChild(removeBtn);

      li.addEventListener('click', () => {
        if (item.type === 'url') {
          renderSwaggerUI({ url: item.value, title: item.label });
        } else {
          const spec = parseSpec(item.value);
          if (spec) {
            renderSwaggerUI({ spec, title: item.label });
          } else {
            showToast('Stored spec could not be parsed', 'error');
          }
        }
      });

      historyList.appendChild(li);
    });
  }

  btnClearHist.addEventListener('click', () => {
    chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => renderHistory([]));
  });

  // ---- Init history ----
  loadHistory();

  // ===========================================================
  //  TOAST HELPER
  // ===========================================================

  function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
})();
