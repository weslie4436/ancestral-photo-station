(function () {
  function typingField(target) {
    const el = target && target.nodeType === 3 ? target.parentElement : target;
    if (!el) return false;
    if (el.closest && el.closest("input, textarea, [contenteditable='true'], [contenteditable='']")) {
      return true;
    }
    const ae = document.activeElement;
    return !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
  }
  function blockAppChrome(ev) {
    if (typingField(ev.target)) return;
    ev.preventDefault();
  }
  document.addEventListener("contextmenu", blockAppChrome, true);
  document.addEventListener("selectstart", blockAppChrome, true);
  document.addEventListener("dragstart", blockAppChrome, true);
  document.addEventListener("selectionchange", function () {
    if (typingField(document.activeElement)) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return;
    if (typingField(sel.anchorNode)) return;
    sel.removeAllRanges();
  });
  const ORIGIN = (window.VAULT_ORIGIN || "").replace(/\/$/, "");
  const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
  const DISCONNECTED = "維護中,請5分鐘後再試";
  const BAD_PASS = "Apple帳號密碼錯誤";
  const statusEl = document.getElementById("status");
  const hall = document.getElementById("hall");
  const blobs = document.getElementById("blobs");
  const panel = document.getElementById("invite-panel");
  const hey = document.getElementById("invite-hey");
  const safariNote = document.getElementById("invite-safari");
  const goBtn = document.getElementById("invite-go");
  const driveBtn = document.getElementById("drive-go");
  const appleForm = document.getElementById("invite-apple-form");
  const passForm = document.getElementById("invite-pass-form");
  const mfaForm = document.getElementById("invite-mfa");
  const waitEl = document.getElementById("invite-wait");
  const waitBar = document.getElementById("invite-wait-bar");
  const appleErr = document.getElementById("invite-apple-err");
  const passErr = document.getElementById("invite-pass-err");
  const mfaErr = document.getElementById("invite-mfa-err");
  const homeInstall = document.getElementById("home-install");
  let inviteKey = "";
  let ticket = "";
  let appleId = "";
  let busy = false;
  let codeSent = false;

  function api(path, key) {
    const url = ORIGIN + path;
    const k = key || window.FAMILY_VIEW_KEY;
    if (!k) return url;
    return url + (path.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(k);
  }

  function fail(msg) {
    if (statusEl) statusEl.textContent = msg || DISCONNECTED;
  }

  function readJson(path, key) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, 8000);
    return fetch(api(path, key), { signal: ctrl.signal }).then(function (res) {
      return res.json().then(function (j) {
        return { res: res, j: j };
      });
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function postJson(path, key, body) {
    return fetch(api(path, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (j) {
        return { res: res, j: j };
      });
    });
  }

  function cookiePath() {
    return location.pathname.replace(/[^/]+$/, "") || "/";
  }

  function writeViewCookie(token) {
    if (!KEY_RE.test(token || "")) return;
    document.cookie =
      "family.viewKey=" +
      encodeURIComponent(token) +
      "; path=" +
      cookiePath() +
      "; max-age=31536000; Secure; SameSite=Lax";
  }

  function writeInstallManifest(token) {
    if (!KEY_RE.test(token || "")) return;
    // iOS 16.4+ ignores the current URL and launches start_url. A static ./
    // empties the icon. data: manifests are also ignored. Do not attach one.
    if (typeof navigator.standalone === "boolean") return;
    const start = new URL("./", location.href);
    start.searchParams.set("k", token);
    const icon = function (file, size) {
      return {
        src: new URL("./icons/" + file, location.href).href,
        sizes: size,
        type: "image/png",
        purpose: "any",
      };
    };
    const manifest = {
      id: start.pathname + start.search,
      name: "Famiphoto",
      short_name: "Famiphoto",
      start_url: start.href,
      scope: new URL("./", location.href).href,
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      capture_links: "none",
      background_color: "#fafafa",
      theme_color: "#fafafa",
      lang: "zh-Hant",
      icons: [
        icon("rose-two-192.png", "192x192"),
        icon("rose-two-512.png", "512x512"),
      ],
    };
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.setAttribute(
      "href",
      "data:application/manifest+json," + encodeURIComponent(JSON.stringify(manifest))
    );
  }

  function keepUrlKey(token) {
    if (!KEY_RE.test(token || "")) return;
    window.FAMILY_URL_KEY = token;
    const next =
      location.pathname +
      "?k=" + encodeURIComponent(token) +
      "#k=" + encodeURIComponent(token);
    if (location.pathname + location.search + location.hash !== next) {
      history.replaceState({}, "", next);
    }
  }

  function savePersonal(token) {
    if (!KEY_RE.test(token || "")) return;
    window.FAMILY_VIEW_KEY = token;
    try {
      localStorage.setItem("family.viewKey", token);
    } catch (e) {}
    writeViewCookie(token);
    try {
      sessionStorage.removeItem("family.claim");
    } catch (e) {}
    writeInstallManifest(token);
    if (typeof navigator.standalone === "boolean" && !navigator.standalone) {
      keepUrlKey(token);
      return;
    }
    stripUrlKey();
  }

  function stripUrlKey() {
    if (!window.FAMILY_URL_KEY && !(location.search || "").match(/(^|[?&])k=/)) return;
    history.replaceState({}, "", location.pathname + (location.hash || ""));
    window.FAMILY_URL_KEY = "";
  }

  function isStandalone() {
    if (window.navigator.standalone) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function needsSafari() {
    if (isStandalone()) return false;
    const ua = navigator.userAgent || "";
    const ios =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    return !(/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Line\//.test(ua));
  }

  function hideAllInvite() {
    if (hey) hey.hidden = true;
    if (safariNote) safariNote.hidden = true;
    if (goBtn) goBtn.hidden = true;
    if (driveBtn) driveBtn.hidden = true;
    if (appleForm) appleForm.hidden = true;
    if (passForm) passForm.hidden = true;
    if (mfaForm) mfaForm.hidden = true;
    if (waitEl) waitEl.hidden = true;
  }

  function focusField(id) {
    window.requestAnimationFrame(function () {
      const el = document.getElementById(id);
      if (el && el.focus) el.focus();
    });
  }

  function showWait() {
    hideAllInvite();
    if (statusEl) statusEl.textContent = "";
    if (waitEl) waitEl.hidden = false;
    if (waitBar && window.RoseTwo && window.RoseTwo.mountBar) {
      window.RoseTwo.mountBar(waitBar);
    }
  }

  function showLanding() {
    hideAllInvite();
    busy = false;
    codeSent = false;
    if (statusEl) statusEl.textContent = "";
    if (hey) hey.hidden = false;
    if (needsSafari()) {
      if (safariNote) safariNote.hidden = false;
      return;
    }
    if (goBtn) goBtn.hidden = false;
  }

  function showOffline() {
    hideAllInvite();
    busy = false;
    codeSent = false;
    if (statusEl) statusEl.textContent = DISCONNECTED;
    if (window.FAMILY_FORCE_INVITE || !window.FAMILY_VIEW_KEY) showInviteChrome();
  }

  function showPass(err) {
    hideAllInvite();
    busy = false;
    codeSent = false;
    if (passForm) passForm.hidden = false;
    if (passErr) passErr.textContent = err || "";
    const passEl = document.getElementById("invite-pass");
    if (passEl) passEl.value = "";
    focusField("invite-pass");
  }

  function showMfa(err) {
    hideAllInvite();
    busy = false;
    if (mfaForm) mfaForm.hidden = false;
    if (mfaErr) mfaErr.textContent = err || "";
    focusField("invite-code");
  }

  function showInviteChrome() {
    if (hall) hall.classList.add("is-invite");
    if (blobs) blobs.hidden = false;
    if (panel) panel.hidden = false;
  }

  function hideInviteChrome() {
    if (hall) hall.classList.remove("is-invite");
    if (blobs && !(hall && hall.classList.contains("is-booting"))) blobs.hidden = true;
    if (panel) panel.hidden = true;
    hideAllInvite();
  }

  function showHomeInstallIfNeeded() {
    if (!homeInstall) return;
    if (isStandalone()) {
      try {
        sessionStorage.removeItem("family.needInstall");
      } catch (e) {}
      homeInstall.hidden = true;
      return;
    }
    let need = false;
    try {
      need = sessionStorage.getItem("family.needInstall") === "1";
    } catch (e) {}
    homeInstall.hidden = !need;
    if (need && window.FAMILY_VIEW_KEY) keepUrlKey(window.FAMILY_VIEW_KEY);
  }

  function goToPersonal() {
    try {
      if (isStandalone()) sessionStorage.removeItem("family.needInstall");
      else sessionStorage.setItem("family.needInstall", "1");
    } catch (e) {}
    if (window.FAMILY_FORCE_INVITE) {
      const t = window.FAMILY_VIEW_KEY || "";
      location.replace(
        KEY_RE.test(t)
          ? "./?k=" + encodeURIComponent(t) + "#k=" + encodeURIComponent(t)
          : "./"
      );
      return;
    }
    openAlbum();
    showHomeInstallIfNeeded();
  }

  function openAlbum() {
    if (window.FAMILY_FORCE_INVITE) {
      const t = window.FAMILY_VIEW_KEY || "";
      location.replace(
        KEY_RE.test(t)
          ? "./?k=" + encodeURIComponent(t) + "#k=" + encodeURIComponent(t)
          : "./"
      );
      return;
    }
    hideInviteChrome();
    if (window.FamilyDoor && window.FamilyDoor.boot) {
      if (!window.FAMILY_VIEW_KEY) {
        try {
          window.FAMILY_VIEW_KEY = localStorage.getItem("family.viewKey") || "";
        } catch (e) {}
      }
      window.FamilyDoor.boot();
    }
  }

  function watchAuth() {
    readJson("/api/invite/auth?t=" + encodeURIComponent(ticket), inviteKey)
      .then(function (x) {
        if (!x.res.ok) {
          fail((x.j && x.j.error) || DISCONNECTED);
          showLanding();
          return;
        }
        if (x.j.phase === "failed") {
          codeSent = false;
          showPass(x.j.error || BAD_PASS);
          return;
        }
        if (x.j.phase === "ready" && x.j.token) {
          savePersonal(x.j.token);
          goToPersonal();
          return;
        }
        if (x.j.need_mfa && !codeSent) {
          if (!mfaForm || mfaForm.hidden) showMfa("");
        } else if (!waitEl || waitEl.hidden) {
          showWait();
        }
        window.setTimeout(watchAuth, 1200);
      })
      .catch(function () {
        window.setTimeout(watchAuth, 2000);
      });
  }

  function startInvite(key) {
    inviteKey = key;
    try {
      ticket = sessionStorage.getItem("family.claim") || "";
    } catch (e) {
      ticket = "";
    }
    showInviteChrome();
    if (ticket) {
      showWait();
      watchAuth();
      return;
    }
    showLanding();
  }

  if (goBtn) {
    goBtn.addEventListener("click", function () {
      hideAllInvite();
      if (appleForm) appleForm.hidden = false;
      if (appleErr) appleErr.textContent = "";
      focusField("invite-apple");
    });
  }

  if (appleForm) {
    appleForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      const apple = ((document.getElementById("invite-apple") || {}).value || "").trim();
      if (!apple) return;
      appleId = apple;
      if (appleErr) appleErr.textContent = "";
      hideAllInvite();
      if (passForm) passForm.hidden = false;
      if (passErr) passErr.textContent = "";
      focusField("invite-pass");
    });
  }

  if (passForm) {
    passForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      const pass = (document.getElementById("invite-pass") || {}).value || "";
      if (!pass) return;
      busy = true;
      codeSent = false;
      showWait();
      postJson("/api/invite/login", inviteKey, { apple_id: appleId, password: pass })
        .then(function (x) {
          if (!x.res.ok) {
            showPass((x.j && x.j.error) || BAD_PASS);
            return;
          }
          ticket = x.j.ticket || "";
          try {
            sessionStorage.setItem("family.claim", ticket);
          } catch (e) {}
          const passEl = document.getElementById("invite-pass");
          if (passEl) passEl.value = "";
          watchAuth();
        })
        .catch(function () {
          showPass(DISCONNECTED);
        });
    });
  }

  if (mfaForm) {
    mfaForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      const code = (document.getElementById("invite-code") || {}).value || "";
      if (!code) return;
      busy = true;
      showWait();
      postJson("/api/invite/code", inviteKey, { ticket: ticket, code: code })
        .then(function (x) {
          if (!x.res.ok) {
            codeSent = false;
            showMfa((x.j && x.j.error) || "驗證碼送不出去");
            return;
          }
          codeSent = true;
          watchAuth();
        })
        .catch(function () {
          showMfa(DISCONNECTED);
        });
    });
  }

  const installed = document.getElementById("home-installed");
  if (installed) {
    installed.addEventListener("click", function () {
      try {
        sessionStorage.removeItem("family.needInstall");
      } catch (e) {}
      if (homeInstall) homeInstall.hidden = true;
    });
  }

  function start() {
    showHomeInstallIfNeeded();
    if (window.FAMILY_FORCE_INVITE) {
      const urlK = window.FAMILY_URL_KEY || "";
      if (!urlK) {
        fail("請用給你的專用連結打開");
        return;
      }
      if (!ORIGIN) {
        showOffline();
        return;
      }
      readJson("/api/door", urlK)
        .then(function (x) {
          if (x.res.ok && x.j && x.j.kind === "invite") {
            startInvite(urlK);
            return;
          }
          if ((x.j && x.j.error) === "need_key") {
            fail("請用給你的專用連結打開");
            startInvite(urlK);
            return;
          }
          showOffline();
        })
        .catch(function () {
          showOffline();
        });
      return;
    }
    if (!ORIGIN) {
      fail(DISCONNECTED);
      if (window.FamilyDoor && window.FamilyDoor.boot) window.FamilyDoor.boot();
      return;
    }
    const urlK = window.FAMILY_URL_KEY || "";
    const stored = window.FAMILY_VIEW_KEY || "";
    const probe = urlK || stored;
    if (!probe) {
      fail("請用給你的專用連結打開");
      if (window.FamilyDoor && window.FamilyDoor.boot) window.FamilyDoor.boot();
      return;
    }
    readJson("/api/door", probe)
      .then(function (x) {
        if (!x.res.ok || !x.j || !x.j.kind) {
          if ((x.j && x.j.error) === "need_key") {
            fail("請用給你的專用連結打開");
            if (!urlK && window.FamilyDoor && window.FamilyDoor.boot) window.FamilyDoor.boot();
            return;
          }
          fail(DISCONNECTED);
          if (stored && window.FamilyDoor && window.FamilyDoor.boot) {
            window.FamilyDoor.boot();
            return;
          }
          if (urlK) showOffline();
          return;
        }
        if (x.j.kind === "invite") {
          startInvite(probe);
          return;
        }
        savePersonal(probe);
        openAlbum();
        showHomeInstallIfNeeded();
      })
      .catch(function () {
        fail(DISCONNECTED);
        if (stored && window.FamilyDoor && window.FamilyDoor.boot) {
          window.FamilyDoor.boot();
          showHomeInstallIfNeeded();
          return;
        }
        if (urlK) showOffline();
        else showHomeInstallIfNeeded();
      });
  }

  window.FamiphotoGate = { start: start };

  // iOS keyboard: the layout viewport does not shrink. Subtracting visualViewport
  // offsetTop AND calling scrollIntoView on every vv "scroll" fights iOS — the
  // password field (lower than Apple ID) ping-pongs until you tap it again.
  (function watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    let painted = -1;
    let kbOn = false;
    function cover() {
      return Math.max(0, window.innerHeight - vv.height);
    }
    function paint() {
      const lift = cover();
      if (Math.abs(lift - painted) >= 8) {
        painted = lift;
        document.documentElement.style.setProperty("--kb", Math.round(lift) + "px");
      }
      if (lift > 100) kbOn = true;
      else if (lift < 40) kbOn = false;
      document.documentElement.classList.toggle("kb-up", kbOn);
    }
    function fieldCovered(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      const top = vv.offsetTop;
      const bottom = vv.offsetTop + vv.height;
      return r.top < top + 8 || r.bottom > bottom - 8;
    }
    function reveal() {
      const focused = document.activeElement;
      if (!focused || (focused.tagName !== "INPUT" && focused.tagName !== "TEXTAREA")) return;
      if (focused.classList && focused.classList.contains("tag-search-input")) return;
      if (!fieldCovered(focused) || !focused.scrollIntoView) return;
      focused.scrollIntoView({ block: "nearest" });
    }
    vv.addEventListener("resize", paint);
    window.addEventListener("focusin", function () {
      paint();
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(reveal);
      });
    });
    paint();
  })();
})();
