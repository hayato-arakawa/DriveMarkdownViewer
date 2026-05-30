/**
 * Drive Markdown Viewer — Content Script
 * Adds a toggle button to the Google Drive file preview toolbar
 * to render Markdown files inline.
 */
(() => {
  'use strict';
  // ── State ──────────────────────────────────────────────────
  let isRendered = false;
  let overlayEl = null;
  let toggleBtn = null;
  let fileContent = null;
  let isLoading = false;
  // ── Helpers ────────────────────────────────────────────────
  const FILE_ID_RE = /\/file\/d\/([a-zA-Z0-9_-]+)/;
  function getFileId() {
    const m = location.pathname.match(FILE_ID_RE);
    return m ? m[1] : null;
  }
  function isMarkdownFile() {
    // Check the page title or filename in the header
    const titleEl = document.querySelector('[data-tooltip]') ||
      document.querySelector('[class*="name"]') ||
      document.title;
    const title = typeof titleEl === 'string' ? titleEl : (titleEl?.textContent || '');
    return /\.md(\s|$|-|–)/i.test(title) || /\.markdown(\s|$|-|–)/i.test(title);
  }
  // ── SVG Icons ──────────────────────────────────────────────
  const ICON_MD = `<svg class="md-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
    <path d="M9 15l2-2 2 2"/>
    <path d="M13 13l2 2"/>
  </svg>`;
  const ICON_CLOSE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M1 1l12 12M13 1L1 13"/>
  </svg>`;
  const ICON_MD_HEADER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    <path d="M7 15V9l2.5 3L12 9v6"/>
    <path d="M15 13l2 2 2-2"/>
    <path d="M17 15V9"/>
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
    // Google Drive uses different structures, try multiple selectors
    const selectors = [
      // The header action bar area — look for the "Open with" or "Share" buttons
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
      // Walk up to the parent container that holds the buttons
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
    // Fallback: try to find any toolbar-like container at the top
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
    // Last resort: find the top header bar and append
    const headers = document.querySelectorAll('header, [role="banner"]');
    for (const header of headers) {
      // Find the right side of the header (where action buttons live)
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
  // ── Fetch File Content ─────────────────────────────────────
  async function fetchFileContent(fileId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_DRIVE_FILE', fileId },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve(response.content);
          } else {
            reject(new Error(response?.error || 'Unknown error'));
          }
        }
      );
    });
  }
  // ── Extract text from the preview page itself ──────────────
  function extractTextFromPage() {
    // Google Drive renders text files in the preview area
    // Try to find the text content containers
    const previewSelectors = [
      '.drive-viewer-text-page',
      '[class*="text-page"]',
      '[class*="viewer"] [class*="content"]',
      '[class*="preview"] [class*="content"]',
      '.ndfHFb-c4YZDc-Wrber',  // Known Drive preview content class
    ];
    for (const sel of previewSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 0) {
        return el.textContent;
      }
    }
    // Try to find any large text block in the page that looks like file content
    const allDivs = document.querySelectorAll('div[style*="white-space"]');
    for (const div of allDivs) {
      if (div.textContent.trim().length > 20) {
        return div.textContent;
      }
    }
    return null;
  }
  // ── Render Markdown ────────────────────────────────────────
  function renderMarkdown(rawText) {
    // Configure marked
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        gfm: true,
        breaks: true,
      });
      let html = marked.parse(rawText);
      // Sanitize with DOMPurify if available
      if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['target'],
        });
      }
      return html;
    }
    // Fallback: very basic markdown rendering
    return basicMarkdownRender(rawText);
  }
  function basicMarkdownRender(text) {
    // Ultra-basic markdown for when marked.js isn't available
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold / italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }
  // ── Create Overlay ─────────────────────────────────────────
  function createOverlay(htmlContent) {
    if (overlayEl) {
      overlayEl.remove();
    }
    overlayEl = document.createElement('div');
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
    // Attach close handler
    document.getElementById('md-viewer-close').addEventListener('click', () => {
      hideOverlay();
    });
    // ESC to close
    document.addEventListener('keydown', handleEscape);
    // Animate in
    requestAnimationFrame(() => {
      overlayEl.classList.add('md-viewer-visible');
    });
  }
  function hideOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.remove('md-viewer-visible');
    setTimeout(() => {
      overlayEl?.remove();
      overlayEl = null;
    }, 350);
    isRendered = false;
    if (toggleBtn) {
      toggleBtn.classList.remove('md-viewer-active');
      toggleBtn.innerHTML = `${ICON_MD}<span>MD</span>`;
      toggleBtn.title = 'Markdownとしてレンダリング';
    }
    document.removeEventListener('keydown', handleEscape);
  }
  function handleEscape(e) {
    if (e.key === 'Escape') {
      hideOverlay();
    }
  }
  // ── Show Error ─────────────────────────────────────────────
  function showError(message) {
    const html = `
      <div class="md-viewer-error">
        <div class="md-viewer-error-icon">⚠️</div>
        <h3>コンテンツを取得できませんでした</h3>
        <p>${message}</p>
      </div>
    `;
    createOverlay(html);
  }
  // ── Toggle Handler ─────────────────────────────────────────
  async function handleToggle() {
    if (isLoading) return;
    if (isRendered) {
      hideOverlay();
      return;
    }
    isLoading = true;
    toggleBtn.innerHTML = `<div class="md-spinner"></div><span>読み込み中…</span>`;
    try {
      const fileId = getFileId();
      if (!fileId) {
        showError('ファイルIDを取得できませんでした。');
        return;
      }
      // Try to get content from the page itself first
      let content = extractTextFromPage();
      // If that fails, try fetching via background script
      if (!content || content.trim().length < 5) {
        try {
          content = await fetchFileContent(fileId);
        } catch (fetchErr) {
          console.warn('[MD Viewer] Fetch failed:', fetchErr);
        }
      }
      if (!content || content.trim().length < 2) {
        showError('ファイルの内容を取得できませんでした。ファイルが共有されているか、アクセス権があることを確認してください。');
        return;
      }
      // Check if the fetched content is HTML (error page) rather than markdown
      if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
        // Try to extract text from the preview instead
        content = extractTextFromPage();
        if (!content) {
          showError('ファイルの内容を取得できませんでした。ページのプレビューからテキストを抽出できません。');
          return;
        }
      }
      fileContent = content;
      const renderedHtml = renderMarkdown(content);
      createOverlay(renderedHtml);
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
    // Only activate on markdown-ish files or try anyway
    // since detecting file type from title is unreliable at first load
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
