// Human Browser Copilot - DOM Highlighter & Element Inspector
(function() {
  if (window.__humanBrowserHighlighterInjected) return;
  window.__humanBrowserHighlighterInjected = true;

  let activeHighlights = [];
  let highlightedElementsMap = new Map();

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Check if element is within or near viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      return false;
    }
    return true;
  }

  function getInteractableElements() {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([type=hidden]):not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "[role=button]",
      "[role=link]",
      "[role=checkbox]",
      "[role=menuitem]",
      "[role=tab]",
      "[tabindex]:not([tabindex="-1"])",
      "[contenteditable=true]"
    ].join(", ");

    const elements = Array.from(document.querySelectorAll(selector));
    return elements.filter(isVisible);
  }

  function highlightElements(limit = 100) {
    clearHighlights();
    const interactables = getInteractableElements().slice(0, limit);
    const results = [];

    interactables.forEach((el, index) => {
      const id = index + 1;
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
      badge.textContent = id;
      box.appendChild(badge);

      document.body.appendChild(box);
      activeHighlights.push(box);
      highlightedElementsMap.set(id, el);

      // Extract descriptive text
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "";
      const text = (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 80);
      const name = el.getAttribute("name") || "";
      const role = el.getAttribute("role") || "";

      results.push({
        id,
        tag,
        type,
        role,
        name,
        text,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    });

    return results;
  }

  function clearHighlights() {
    activeHighlights.forEach(h => h.remove());
    activeHighlights = [];
    highlightedElementsMap.clear();
  }

  function getElementById(id) {
    return highlightedElementsMap.get(id);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "HIGHLIGHT_ELEMENTS") {
      const items = highlightElements(msg.limit || 80);
      sendResponse({ ok: true, elements: items, title: document.title, url: location.href });
    } else if (msg.type === "CLEAR_HIGHLIGHTS") {
      clearHighlights();
      sendResponse({ ok: true });
    } else if (msg.type === "GET_ELEMENT_COORDINATES") {
      const el = getElementById(msg.id) || (msg.selector ? document.querySelector(msg.selector) : null);
      if (el) {
        const rect = el.getBoundingClientRect();
        sendResponse({
          ok: true,
          found: true,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      } else {
        sendResponse({ ok: false, found: false, error: "Element not found" });
      }
    }
    return true;
  });
})();
