/**
 * Drive Markdown Viewer — Content Script
 * Adds a toggle button to the Google Drive file preview toolbar
 * to render Markdown files inline within the Drive preview pane.
 */
(() => {
  'use strict';
  // ── State ──────────────────────────────────────────────────
  let isRendered = false;
  let toggleBtn = null;
  let fileContent = null;
  let isLoading = false;
  let originalContentEl = null;   // reference to the original text container
  let mdRenderedEl = null;        // the injected markdown container
  // ── Selectors (from actual Google Drive DOM) ───────────────
  // File name element
  const FILENAME_SELECTOR = 'div.exjswb > span > span > span';
  // Raw text content (inside <pre>)
  const TEXT_CONTENT_SELECTOR = 'div.a-b-r > div > div > div > pre';
  // The parent container where MD should be rendered inline
  // (the scrollable content area in Drive preview)
  const INLINE_CONTAINER_SELECTOR = 'div.a-b-r > div > div';

  // ── Helpers ────────────────────────────────────────────────
  const FILE_ID_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;
  function getFileId() {
    const m = location.pathname.match(FILE_ID_RE);
    return m ? m[1] : null;
  }

  function getFileName() {
    // Try the user-provided selector first
    const el = document.querySelector(FILENAME_SELECTOR);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
    // Fallback: page title
    return document.title || '';
  }

  function isMarkdownFile() {
    const name = getFileName();
    return /\.md(\s|$|-|–)/i.test(name) || /\.markdown(\s|$|-|–)/i.test(name);
  }

  // ── SVG Icons ──────────────────────────────────────────────
  const ICON_MD = `<svg class="md-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
    <path d="M9 15l2-2 2 2"/>
    <path d="M13 13l2 2"/>
  </svg>`;

  // ── Create Toggle Button ───────────────────────────────────
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.className = 'md-viewer-toggle-btn';
    btn.id = 'md-viewer-toggle';
    btn.innerHTML = `${ICON_MD}<span>MD</span>`;
    btn.title = 'Markdownとしてレンダリング';
    btn.addEventListener('click', handleToggle);
    return btn;
  }

  // ── Insert Button into Toolbar ─────────────────────────────
  function insertButton() {
    if (document.getElementById('md-viewer-toggle')) return;
    // Strategy: find the toolbar/action bar at the top of file preview
    const selectors = [
      '[data-tooltip="Google ドキュメント で開く"]',
      '[data-tooltip="Open with Google Docs"]',
      '[aria-label="Google ドキュメント で開く"]',
      '[aria-label="Open with Google Docs"]',
      '[data-tooltip="共有"]',
      '[data-tooltip="Share"]',
      '[aria-label="共有"]',
      '[aria-label="Share"]',
    ];
    let anchorEl = null;
    for (const sel of selectors) {
      anchorEl = document.querySelector(sel);
      if (anchorEl) break;
    }
    if (anchorEl) {
      const container = anchorEl.closest('[role="toolbar"]') ||
        anchorEl.closest('[class*="header"]') ||
        anchorEl.parentElement?.parentElement ||
        anchorEl.parentElement;
      if (container) {
        toggleBtn = createToggleButton();
        container.appendChild(toggleBtn);
        return true;
      }
    }
    // Fallback selectors
    const fallbackSelectors = [
      '[role="toolbar"]',
      '[class*="toolbar"]',
      '[class*="header-actions"]',
    ];
    for (const sel of fallbackSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        toggleBtn = createToggleButton();
        el.appendChild(toggleBtn);
        return true;
      }
    }
    // Last resort: header
    const headers = document.querySelectorAll('header, [role="banner"]');
    for (const header of headers) {
      const rightSide = header.querySelector('[style*="flex"]') ||
        header.querySelector('[class*="right"]') ||
        header.lastElementChild;
      if (rightSide) {
        toggleBtn = createToggleButton();
        rightSide.appendChild(toggleBtn);
        return true;
      }
    }
    return false;
  }



  // ── Extract text from the preview page DOM ─────────────────
  function extractTextFromPage() {
    // Primary: use user-provided selector for <pre> content
    const preEl = document.querySelector(TEXT_CONTENT_SELECTOR);
    if (preEl && preEl.textContent.trim().length > 0) {
      return preEl.textContent;
    }
    // Broader search: try to find <pre> inside the Drive preview area
    const preElements = document.querySelectorAll('div.a-b-r pre, div.a-b-ah pre');
    for (const el of preElements) {
      if (el.textContent.trim().length > 0) {
        return el.textContent;
      }
    }
    // Legacy fallback selectors
    const fallbackSelectors = [
      '.drive-viewer-text-page',
      '[class*="text-page"]',
      '[class*="viewer"] [class*="content"]',
      '[class*="preview"] [class*="content"]',
      '.ndfHFb-c4YZDc-Wrber',
    ];
    for (const sel of fallbackSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 0) {
        return el.textContent;
      }
    }
    // Try any element with white-space styling
    const allDivs = document.querySelectorAll('div[style*="white-space"]');
    for (const div of allDivs) {
      if (div.textContent.trim().length > 20) {
        return div.textContent;
      }
    }
    return null;
  }

  // ── Find the inline container where MD should be rendered ──
  function findInlineContainer() {
    // Primary selector from user
    const container = document.querySelector(INLINE_CONTAINER_SELECTOR);
    if (container) return container;
    // Broader fallback
    const fallbacks = [
      'div.a-b-r > div > div',
      'div.a-b-ah > div > div',
    ];
    for (const sel of fallbacks) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── Render Markdown ────────────────────────────────────────
  function renderMarkdown(rawText) {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        gfm: true,
        breaks: true,
      });
      let html = marked.parse(rawText);
      if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['target'],
        });
      }
      return html;
    }
    return basicMarkdownRender(rawText);
  }

  function basicMarkdownRender(text) {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── Show Markdown Inline (inside Drive preview container) ──
  function showMarkdownInline(htmlContent) {
    const container = findInlineContainer();
    if (!container) {
      // Fallback: show as overlay if container not found
      showAsOverlay(htmlContent);
      return;
    }

    // Hide all original children
    for (const child of container.children) {
      if (!child.classList.contains('md-viewer-inline')) {
        child._mdOriginalDisplay = child.style.display;
        child.style.display = 'none';
      }
    }
    originalContentEl = container;

    // Create the inline markdown view
    mdRenderedEl = document.createElement('div');
    mdRenderedEl.className = 'md-viewer-inline md-viewer-content';
    mdRenderedEl.id = 'md-viewer-rendered';
    mdRenderedEl.innerHTML = htmlContent;
    container.appendChild(mdRenderedEl);

    // Animate in
    requestAnimationFrame(() => {
      mdRenderedEl.classList.add('md-viewer-inline-visible');
    });
  }

  // ── Fallback: overlay mode (only when inline container not found) ──
  function showAsOverlay(htmlContent) {
    const ICON_CLOSE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M1 1l12 12M13 1L1 13"/>
    </svg>`;
    const ICON_MD_HEADER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M7 15V9l2.5 3L12 9v6"/>
      <path d="M15 13l2 2 2-2"/>
      <path d="M17 15V9"/>
    </svg>`;

    const overlayEl = document.createElement('div');
    overlayEl.className = 'md-viewer-overlay';
    overlayEl.id = 'md-viewer-overlay';
    overlayEl.innerHTML = `
      <div class="md-viewer-header">
        <div class="md-viewer-header-title">
          ${ICON_MD_HEADER}
          <span>Markdown Preview</span>
        </div>
        <button class="md-viewer-close-btn" id="md-viewer-close">
          ${ICON_CLOSE}
          <span>閉じる</span>
        </button>
      </div>
      <div class="md-viewer-content" id="md-viewer-rendered">
        ${htmlContent}
      </div>
    `;
    document.body.appendChild(overlayEl);

    document.getElementById('md-viewer-close').addEventListener('click', () => {
      hideMarkdown();
    });
    document.addEventListener('keydown', handleEscape);

    requestAnimationFrame(() => {
      overlayEl.classList.add('md-viewer-visible');
    });
  }

  // ── Hide Markdown / Restore Original ───────────────────────
  function hideMarkdown() {
    // If inline mode was used
    if (mdRenderedEl && originalContentEl) {
      mdRenderedEl.classList.remove('md-viewer-inline-visible');
      setTimeout(() => {
        mdRenderedEl?.remove();
        mdRenderedEl = null;
        // Restore original children
        if (originalContentEl) {
          for (const child of originalContentEl.children) {
            if (child._mdOriginalDisplay !== undefined) {
              child.style.display = child._mdOriginalDisplay;
              delete child._mdOriginalDisplay;
            }
          }
          originalContentEl = null;
        }
      }, 300);
    }

    // If overlay mode was used
    const overlayEl = document.getElementById('md-viewer-overlay');
    if (overlayEl) {
      overlayEl.classList.remove('md-viewer-visible');
      setTimeout(() => overlayEl.remove(), 350);
      document.removeEventListener('keydown', handleEscape);
    }

    isRendered = false;
    if (toggleBtn) {
      toggleBtn.classList.remove('md-viewer-active');
      toggleBtn.innerHTML = `${ICON_MD}<span>MD</span>`;
      toggleBtn.title = 'Markdownとしてレンダリング';
    }
  }

  function handleEscape(e) {
    if (e.key === 'Escape') {
      hideMarkdown();
    }
  }

  // ── Show Error (inline) ────────────────────────────────────
  function showError(message) {
    const html = `
      <div class="md-viewer-error">
        <div class="md-viewer-error-icon">⚠️</div>
        <h3>コンテンツを取得できませんでした</h3>
        <p>${message}</p>
      </div>
    `;
    showMarkdownInline(html);
  }

  // ── Toggle Handler ─────────────────────────────────────────
  function handleToggle() {
    if (isLoading) return;

    if (isRendered) {
      hideMarkdown();
      return;
    }

    isLoading = true;
    toggleBtn.innerHTML = `<div class="md-spinner"></div><span>読み込み中…</span>`;

    try {
      // Extract content directly from the Drive preview DOM
      const content = extractTextFromPage();

      if (!content || content.trim().length < 2) {
        showError('ファイルの内容を取得できませんでした。Driveプレビューにテキストが表示されていることを確認してください。');
        return;
      }

      fileContent = content;
      const renderedHtml = renderMarkdown(content);

      // Show inline within Drive preview, NOT as fullscreen overlay
      showMarkdownInline(renderedHtml);

      isRendered = true;
      toggleBtn.classList.add('md-viewer-active');
      toggleBtn.innerHTML = `${ICON_MD}<span>元に戻す</span>`;
      toggleBtn.title = '元の表示に戻す';
    } catch (err) {
      console.error('[MD Viewer] Error:', err);
      showError(`エラーが発生しました: ${err.message}`);
    } finally {
      isLoading = false;
      if (!isRendered && toggleBtn) {
        toggleBtn.innerHTML = `${ICON_MD}<span>MD</span>`;
      }
    }
  }

  // ── Observe DOM and Insert Button ──────────────────────────
  function init() {
    const fileId = getFileId();
    if (!fileId) return;

    // Try to insert immediately
    if (insertButton()) return;

    // Otherwise, watch for the toolbar to appear
    const observer = new MutationObserver((mutations, obs) => {
      if (insertButton()) {
        obs.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Failsafe: stop observing after 30s
    setTimeout(() => observer.disconnect(), 30000);
  }

  // ── Kick off ───────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
