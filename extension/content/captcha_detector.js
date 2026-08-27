// Human Browser Copilot - Intelligent CAPTCHA & Challenge Detector
(function() {
  if (window.__humanBrowserCaptchaDetectorInjected) return;
  window.__humanBrowserCaptchaDetectorInjected = true;

  let isChallengeActive = false;
  let activeChallengeType = null;
  let bannerEl = null;

  const CHALLENGE_SIGNATURES = [
    {
      type: "cloudflare_turnstile",
      name: "Cloudflare Turnstile",
      selectors: [
        "iframe[src*="challenges.cloudflare.com"]",
        ".cf-turnstile",
        "#cf-turnstile",
        "[name="cf-turnstile-response"]"
      ]
    },
    {
      type: "cloudflare_interstitial",
      name: "Cloudflare 5s Challenge",
      selectors: [
        "#challenge-running",
        "#challenge-stage",
        ".cf-browser-verification",
        "div[id*="cf-please-wait"]"
      ]
    },
    {
      type: "google_recaptcha",
      name: "Google reCAPTCHA",
      selectors: [
        "iframe[src*="google.com/recaptcha"]",
        "iframe[src*="recaptcha.net/recaptcha"]",
        ".g-recaptcha",
        "#g-recaptcha-response"
      ]
    },
    {
      type: "hcaptcha",
      name: "hCaptcha",
      selectors: [
        "iframe[src*="hcaptcha.com"]",
        ".h-captcha",
        "[name="h-captcha-response"]"
      ]
    },
    {
      type: "arkose_funcaptcha",
      name: "Arkose Labs FunCaptcha",
      selectors: [
        "iframe[src*="arkoselabs.com"]",
        "iframe[src*="funcaptcha.com"]",
        "#fc-iframe-wrap"
      ]
    },
    {
      type: "geetest",
      name: "GeeTest Challenge",
      selectors: [
        ".geetest_holder",
        ".geetest_radar_btn",
        ".geetest_popup_wrap"
      ]
    }
  ];

  function detectChallenge() {
    for (const sig of CHALLENGE_SIGNATURES) {
      for (const sel of sig.selectors) {
        const el = document.querySelector(sel);
        if (el) {
          // Verify visibility
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0 || sig.type === "cloudflare_interstitial") {
            return { detected: true, type: sig.type, name: sig.name, element: el };
          }
        }
      }
    }
    return { detected: false };
  }

  function showInPageAlert(challengeName) {
    if (document.getElementById("human-browser-alert-banner")) return;

    bannerEl = document.createElement("div");
    bannerEl.id = "human-browser-alert-banner";
    bannerEl.innerHTML = `
      <div style="font-size: 20px;">🧩</div>
      <div>
        <div style="font-weight: 700; font-size: 13px;">${challengeName} Detected</div>
        <div style="font-size: 11px; opacity: 0.8;">Agent paused. Please complete or click in browser to resume.</div>
      </div>
      <button class="human-browser-btn" id="human-browser-solved-btn">I Solved It</button>
    `;
    document.documentElement.appendChild(bannerEl);

    document.getElementById("human-browser-solved-btn").addEventListener("click", () => {
      resolveChallenge("user_clicked_solved");
    });
  }

  function hideInPageAlert() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  function resolveChallenge(reason) {
    if (!isChallengeActive) return;
    isChallengeActive = false;
    hideInPageAlert();
    chrome.runtime.sendMessage({
      type: "CAPTCHA_RESOLVED",
      challengeType: activeChallengeType,
      reason: reason || "auto_detected"
    });
  }

  function checkStatus() {
    const result = detectChallenge();
    if (result.detected) {
      if (!isChallengeActive) {
        isChallengeActive = true;
        activeChallengeType = result.type;
        showInPageAlert(result.name);
        chrome.runtime.sendMessage({
          type: "CAPTCHA_DETECTED",
          challengeType: result.type,
          name: result.name,
          url: location.href
        });
      }
    } else {
      if (isChallengeActive) {
        resolveChallenge("challenge_vanished");
      }
    }
  }

  // MutationObserver for dynamic injection
  const observer = new MutationObserver(() => {
    checkStatus();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });

  // Polling check for edge cases
  setInterval(checkStatus, 1500);

  // Initial check
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkStatus);
  } else {
    checkStatus();
  }
})();
