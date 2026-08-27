// Human Browser Copilot - DOM Highlighter & Element Inspector (M2)
(function() {
  if (window.__humanBrowserHighlighterInjected) return;
  window.__humanBrowserHighlighterInjected = true;

  let activeHighlights = [];
  let currentSnapshotId = null;
  let highlightedElementsMap = new Map();

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      return false;
    }
    return true;
  }

  function getAllElementsIncludingShadow(root) {
    const elements = [];
    const children = root.querySelectorAll('*');
    for (const child of children) {
      elements.push(child);
      if (child.shadowRoot) {
        elements.push(...getAllElementsIncludingShadow(child.shadowRoot));
      }
    }
    return elements;
  }

  function getInteractableElements() {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "button",
      "input:not([type=hidden]):not([disabled])",
      "input:not([type=hidden])",
      "textarea:not([disabled])",
      "textarea",
      "select:not([disabled])",
      "select",
      "[role=button]",
      "div[role=button]",
      "span[role=button]",
      "[role=link]",
      "[role=checkbox]",
      "[role=menuitem]",
      "[role=tab]",
      "[role=textbox]",
      "[role=combobox]",
      '[tabindex]:not([tabindex="-1"])',
      "[contenteditable=true]",
      "[contenteditable]",
      '[contenteditable="plaintext-only"]',
      "[aria-haspopup]"
    ].join(", ");

    const allElements = getAllElementsIncludingShadow(document);
    const interactables = [];

    allElements.forEach(el => {
      let matches = false;
      try { matches = el.matches(selector); } catch (e) {}
      if (matches) {
        interactables.push(el);
      } else if (isVisible(el)) {
        const style = window.getComputedStyle(el);
        if (style && style.cursor === "pointer") {
          interactables.push(el);
        }
      }
    });

    return interactables.filter(isVisible);
  }

  function highlightElements(limit = 100) {
    clearHighlights();
    currentSnapshotId = `snap_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const interactables = getInteractableElements().slice(0, limit);
    const results = [];

    interactables.forEach((el, index) => {
      const id = `el_${index + 1}`;
      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      const box = document.createElement("div");
      box.className = "human-browser-highlight-box";
      box.style.left = (rect.left + scrollX) + "px";
      box.style.top = (rect.top + scrollY) + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";

      const badge = document.createElement("div");
      badge.className = "human-browser-highlight-badge";
      badge.textContent = id.replace("el_", "");
      box.appendChild(badge);

      document.body.appendChild(box);
      activeHighlights.push(box);
      highlightedElementsMap.set(id, {
        element: el,
        tag: el.tagName.toLowerCase(),
        snapshotId: currentSnapshotId,
        text: el.innerText || el.value || el.placeholder || ""
      });

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || undefined;
      const text = (el.innerText || el.value || "").trim().slice(0, 150) || undefined;
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || undefined;
      const placeholder = el.getAttribute("placeholder") || undefined;
      const href = el.getAttribute("href") || undefined;
      const role = el.getAttribute("role") || tag;

      results.push({
        id,
        tag,
        type,
        role,
        text,
        label,
        placeholder,
        href,
        visible: true,
        enabled: !el.disabled,
        boundingBox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    });

    return { snapshotId: currentSnapshotId, elements: results };
  }

  function clearHighlights() {
    activeHighlights.forEach(h => h.remove());
    activeHighlights = [];
    highlightedElementsMap.clear();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "HIGHLIGHT_ELEMENTS" || msg.type === "OBSERVE_PAGE") {
      const data = highlightElements(msg.limit || 100);
      sendResponse({
        ok: true,
        snapshotId: data.snapshotId,
        elements: data.elements,
        title: document.title,
        url: location.href,
        visibleText: (document.body ? document.body.innerText : "").slice(0, 50000)
      });
    } else if (msg.type === "READ_PAGE_TEXT") {
      const text = document.body ? document.body.innerText : "";
      sendResponse({ ok: true, text });
    } else if (msg.type === "CLEAR_HIGHLIGHTS") {
      clearHighlights();
      sendResponse({ ok: true });
    } else if (msg.type === "GET_ELEMENT_COORDINATES") {
      const elId = msg.id;
      let targetEl = null;

      if (elId && highlightedElementsMap.has(elId)) {
        const record = highlightedElementsMap.get(elId);
        // Stale check
        if (!record.element || !record.element.isConnected) {
          sendResponse({ ok: false, code: "STALE_ELEMENT", error: `Element ${elId} is no longer connected to the DOM.` });
          return true;
        }
        targetEl = record.element;
      } else if (msg.selector) {
        targetEl = document.querySelector(msg.selector);
        if (!targetEl) {
          sendResponse({ ok: false, code: "STALE_ELEMENT", error: `Element not found for selector: ${msg.selector}` });
          return true;
        }
      }

      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        sendResponse({
          ok: true,
          found: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          boundingBox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      } else {
        sendResponse({ ok: false, code: "STALE_ELEMENT", error: `Element ${elId || msg.selector} is stale or invalid.` });
      }
    }
    return true;
  });
})();
