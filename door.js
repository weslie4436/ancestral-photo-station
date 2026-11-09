(function () {
  const ORIGIN = (window.VAULT_ORIGIN || "").replace(/\/$/, "");
  const NEED_LINK = "請用給你的專用連結打開";
  const DISCONNECTED = "維護中,請5分鐘後再試";
  const CHECK =
    '<span class="ios-check" aria-label="已同步"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#34c759"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7.2 12.4l3.1 3.2 6.5-7.2"/></svg></span>';
  const statusEl = document.getElementById("status");
  const hall = document.getElementById("hall");
  const homeHead = document.getElementById("home-head");
  const cabHud = document.getElementById("cab-hud");
  const faceImg = document.getElementById("face-img");
  const faceEmpty = document.getElementById("face-empty");
  const readerName = document.getElementById("reader-name");
  const album = document.getElementById("album");
  const feed = document.getElementById("feed");
  const coverInputEl = document.getElementById("cover-input");
  const backdropInput = document.getElementById("backdrop-input");
  const stageBg = document.getElementById("stage-bg");
  let openPerson = "";
  let names = {};
  let lastCab = "";
  let coverInput = coverInputEl;
  let coverPerson = "";
  let backdropUrl = "";
  let uploadInput = null;
  let uploadPerson = "";
  let uploadBtn = null;
  let uploadBusy = false;
  let upBar = null;
  let upHide = 0;
  let latestPeople = {};
  let uploadWork = null;
  let settingsWrap = null;
  let settingsCatch = null;
  const UPLOAD_CAP = 480 * 1024 * 1024;
  // Small enough that a phone finishes one before anything between it and the vault
  // gives up, and that the bar moves often, since Safari reports no progress of its own.
  const BATCH_CAP = 12 * 1024 * 1024;
  let backupAsk = {};

  function bumpWork(phase, percent) {
    if (!window.FamilyFeed) return;
    if (window.FamilyFeed.isWorkActive && window.FamilyFeed.isWorkActive()) {
      if (window.FamilyFeed.updateWork) window.FamilyFeed.updateWork({ phase: phase, percent: percent });
    } else if (window.FamilyFeed.showWork) {
      window.FamilyFeed.showWork({ phase: phase, percent: percent });
    }
  }

  function clearWork() {
    if (window.FamilyFeed && window.FamilyFeed.clearWork) window.FamilyFeed.clearWork();
  }

  function finishUploadWork() {
    if (!uploadWork) return;
    const w = uploadWork;
    uploadWork = null;
    if (uploadBtn) uploadBtn.classList.remove("is-run");
    clearWork();
    if (w.pinned && w.pinned.length && openPerson === w.person && window.FamilyFeed) {
      window.FamilyFeed.start(w.person, [], { pin: w.pinned, trash: false });
    }
  }

  function abortUploadWork() {
    uploadWork = null;
    if (uploadBtn) uploadBtn.classList.remove("is-run");
    clearWork();
  }

  function tagWorkPct(tagJob) {
    if (!tagJob) return 0;
    const pct = Number(tagJob.percent);
    if (Number.isFinite(pct)) return Math.max(0, Math.min(100, Math.round(pct)));
    const total = Number(tagJob.total) || 0;
    const done = Number(tagJob.done) || 0;
    if (total > 0) return Math.max(0, Math.min(100, Math.round((done * 100) / total)));
    return 0;
  }

  function syncUploadWorkTag(person, tagJob) {
    if (!uploadWork || uploadWork.person !== person || uploadWork.phase !== "tag") return;
    if (tagJob && tagJob.state === "running") {
      uploadWork.sawTag = true;
      bumpWork("tag", tagWorkPct(tagJob));
    } else if (uploadWork.sawTag || Date.now() - uploadWork.doneAt > 12000) {
      finishUploadWork();
    } else {
      bumpWork("tag", tagWorkPct(tagJob));
    }
  }

  function backupWorkPct(p) {
    const n = Number(p && p.percent);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
    const total = Number(p && p.backup_total) || 0;
    const done = Number(p && p.backup_done) || 0;
    if (total > 0) return Math.max(0, Math.min(100, Math.round((done * 100) / total)));
    return 0;
  }

  function syncCabinetWork(p) {
    if (!p) return;
    if (uploadWork && uploadWork.person === p.id) {
      if (uploadWork.phase === "tag") syncUploadWorkTag(p.id, p.tag || {});
      return;
    }
    if (openPerson && p.id !== openPerson) return;
    const backupRun = p.sync === "running" || !!backupAsk[p.id];
    const tagRun = !!(p.tag && p.tag.state === "running");
    if (backupRun) {
      bumpWork("backup", backupWorkPct(p));
      return;
    }
    if (tagRun) {
      bumpWork("tag", tagWorkPct(p.tag));
      return;
    }
    clearWork();
  }
  let selectLine = "";
  const CAMERA =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="8" width="17" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8l1.4-2.4h5.2L16 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="13.6" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  const REFRESH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 4.5V9h-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const UPLOAD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16.5V4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7.4 9.4L12 4.8l4.6 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 15.4v2.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const TRASH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V6.8A1.8 1.8 0 0 1 9.8 5h4.4A1.8 1.8 0 0 1 16 6.8V8M5 8h14M9 11v7M12 11v7M15 11v7M7 8l.8 12.2A1.6 1.6 0 0 0 9.4 22h5.2a1.6 1.6 0 0 0 1.6-1.8L17 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const HASH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4l-1.2 16M15.2 4l-1.2 16M4.5 9h15M4 15h15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const DOWNLOAD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 11.5L12 16l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const GEAR =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 3.8l.6-1.3h3.6l.6 1.3 1.6.7 1.4-.5 2.5 2.5-.5 1.4.7 1.6 1.3.6v3.6l-1.3.6-.7 1.6.5 1.4-2.5 2.5-1.4-.5-1.6.7-.6 1.3h-3.6l-.6-1.3-1.6-.7-1.4.5-2.5-2.5.5-1.4-.7-1.6-1.3-.6v-3.6l1.3-.6.7-1.6-.5-1.4L6.6 4l1.4.5 1.6-.7z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/><circle cx="12" cy="11.9" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const MAG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.2L20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const SCENE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 16.2l4.2-4.6 3 3.2 2.2-2.4 3.6 3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="9" cy="9.2" r="1.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const PERSON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.4" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.2 18.6c.9-3.3 3.2-5 5.8-5s4.9 1.7 5.8 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20C10.5 18.4 7.3 15.8 5.4 11.9C4 9.1 5.2 6 8.4 6c1.8 0 3 1.1 3.6 2.2C12.6 7.1 13.8 6 15.6 6c3.2 0 4.4 3.1 3 5.9C16.7 15.8 13.5 18.4 12 20Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const STICK =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 12h.01M12 12h.01M16 12h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  let waitBusy = false;
  let waitTimer = 0;

  function api(path) {
    const url = ORIGIN + path;
    const k = window.FAMILY_VIEW_KEY;
    if (!k) return url;
    return url + (path.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(k);
  }

  function call(path, opts) {
    if (window.FamilyDrive && window.FamilyDrive.isOn()) {
      return window.FamilyDrive.request(path, opts);
    }
    return fetch(api(path), opts || {});
  }

  function lineFrom(data) {
    if (!data) return DISCONNECTED;
    return "";
  }

  async function readJson(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, 20000);
    try {
      const res = await call(path, { signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) {
        const err = new Error("need_key");
        err.code = "need_key";
        throw err;
      }
      if (!res.ok) throw new Error("bad status");
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function personFromHash() {
    const h = (location.hash || "").replace(/^#/, "");
    return /^[a-z][a-z0-9-]{0,31}$/.test(h) ? h : "";
  }

  function personIds() {
    return Object.keys(names);
  }

  function primaryPersonId() {
    const ids = personIds();
    const host = ids.find(function (id) {
      return latestPeople[id] && latestPeople[id].host;
    });
    return host || ids[0] || "";
  }

  function hudFor(person) {
    if (person && openPerson && person !== openPerson) return null;
    return cabHud;
  }

  function layoutStage() {
    if (!stageBg || !hall || stageBg.hidden) return;
    const hallBox = hall.getBoundingClientRect();
    const tags = document.getElementById("tag-board");
    const startBox = tags && !tags.hidden ? tags.getBoundingClientRect() : (feed ? feed.getBoundingClientRect() : null);
    const endBox = feed ? feed.getBoundingClientRect() : startBox;
    const start = startBox ? Math.max(0, startBox.top - hallBox.top) : 180;
    const end = endBox ? Math.max(start + 24, endBox.top - hallBox.top) : start + 80;
    const fade = "linear-gradient(to bottom, #000 0, #000 " + Math.round(start) + "px, transparent " + Math.round(end) + "px)";
    stageBg.style.height = Math.round(end) + "px";
    stageBg.style.webkitMaskImage = fade;
    stageBg.style.maskImage = fade;
    if (backdropUrl) tuneNameOnBackdrop(backdropUrl);
  }

  function lumaBehindName(img, stage, nameEl) {
    const stageBox = stage.getBoundingClientRect();
    const nameBox = nameEl.getBoundingClientRect();
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (stageBox.width < 8 || nameBox.height < 4 || !iw || !ih) return null;
    const scale = Math.max(stageBox.width / iw, stageBox.height / ih);
    const ox = (stageBox.width - iw * scale) / 2;
    const pad = 10;
    const sx = (nameBox.left - stageBox.left - ox - pad) / scale;
    const sy = (nameBox.top - stageBox.top - pad) / scale;
    const sw = (nameBox.width + pad * 2) / scale;
    const sh = (nameBox.height + pad * 2) / scale;
    const x = Math.max(0, Math.min(iw - 1, sx));
    const y = Math.max(0, Math.min(ih - 1, sy));
    const w = Math.max(1, Math.min(iw - x, sw));
    const h = Math.max(1, Math.min(ih - y, sh));
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 12;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(img, x, y, w, h, 0, 0, 24, 12);
      const data = ctx.getImageData(0, 0, 24, 12).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      }
      return sum / (data.length / 4);
    } catch (err) {
      return null;
    }
  }

  function tuneNameOnBackdrop(url) {
    if (!readerName || !stageBg || stageBg.hidden || !url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      if (url !== backdropUrl) return;
      const luma = lumaBehindName(img, stageBg, readerName);
      const light = luma != null && luma >= 0.65;
      readerName.classList.toggle("is-on-light", light);
      readerName.classList.toggle("is-on-dark", !light);
    };
    img.src = url;
  }

  function paintStage(reader) {
    if (!stageBg || !hall) return;
    if (window.FamilyDrive && window.FamilyDrive.isOn()) {
      const url = window.FamilyDrive.backdropUrl();
      if (url) {
        backdropUrl = url;
        hall.classList.add("has-backdrop");
        if (readerName) {
          readerName.classList.remove("is-on-light");
          readerName.classList.add("is-on-dark");
        }
        stageBg.style.backgroundImage = "url(" + backdropUrl + ")";
        stageBg.hidden = false;
        requestAnimationFrame(layoutStage);
      } else {
        backdropUrl = "";
        hall.classList.remove("has-backdrop");
        if (readerName) readerName.classList.remove("is-on-light", "is-on-dark");
        stageBg.hidden = true;
        stageBg.style.backgroundImage = "";
      }
      return;
    }
    if (reader && reader.has_backdrop && reader.id) {
      backdropUrl = api("/backdrop?person=" + encodeURIComponent(reader.id) + "&r=" + (reader.backdrop_rev || 0));
      hall.classList.add("has-backdrop");
      if (readerName) {
        readerName.classList.remove("is-on-light");
        readerName.classList.add("is-on-dark");
      }
      stageBg.style.backgroundImage = "url(" + backdropUrl + ")";
      stageBg.hidden = false;
      requestAnimationFrame(layoutStage);
    } else {
      backdropUrl = "";
      hall.classList.remove("has-backdrop");
      if (readerName) readerName.classList.remove("is-on-light", "is-on-dark");
      stageBg.hidden = true;
      stageBg.style.backgroundImage = "";
    }
  }

  function paintFace(p) {
    if (!p) return;
    if (readerName) readerName.textContent = p.display_name || "";
    if (faceImg) {
      faceImg.alt = p.display_name || "";
      if (window.FamilyDrive && window.FamilyDrive.isOn()) {
        faceImg.src = window.FamilyDrive.coverUrl() || "./face-default.jpg?v=2";
      } else if (p.has_cover) {
        faceImg.src = api("/cover?person=" + encodeURIComponent(p.id) + "&v=" + (p.cover_rev || 0));
      } else {
        faceImg.src = "./face-default.jpg?v=2";
      }
      faceImg.hidden = false;
    }
    if (faceEmpty) faceEmpty.hidden = true;
    paintStage(p);
  }

  function paintIdentityRow() {
    const row = document.querySelector('.settings-entry[data-job="identity"]');
    if (row) row.hidden = personIds().length < 2;
  }

  function showHome() {
    const primary = primaryPersonId();
    if (primary) {
      showAlbum(primary, names[primary]);
      return;
    }
    openPerson = "";
    if (window.FamilyFeed) window.FamilyFeed.stop();
    if (album) album.hidden = true;
    if (feed) feed.innerHTML = "";
    if (homeHead) homeHead.hidden = true;
    showRail(false);
    showSettings(false);
  }

  function showAlbum(person, name) {
    if (homeHead) homeHead.hidden = false;
    if (cabHud) cabHud.hidden = false;
    if (album) album.hidden = false;
    if (window.FamilyTags) window.FamilyTags.show(person);
    if (window.FamilyFeed && window.FamilyFeed.syncTools) window.FamilyFeed.syncTools();
    else showRail(false);
    showSettings(true, person);
    paintIdentityRow();
    const p = latestPeople[person];
    const same = openPerson === person;
    if (p) {
      if (!same) paintFace(p);
      fillHud(cabHud, p);
    }
    if (same) return;
    openPerson = person;
    if (window.FamilyFeed) window.FamilyFeed.start(person);
  }

  function fail(msg) {
    const text = msg || DISCONNECTED;
    if (!statusEl) return;
    const hall = document.getElementById("hall");
    const albumView =
      hall &&
      !hall.classList.contains("is-booting") &&
      !hall.classList.contains("is-invite");
    if (albumView && text === DISCONNECTED) {
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = text;
  }

  function isBooting() {
    const hall = document.getElementById("hall");
    return !!(hall && hall.classList.contains("is-booting"));
  }

  function endBoot() {
    const hall = document.getElementById("hall");
    if (!hall || !hall.classList.contains("is-booting")) return;
    hall.classList.remove("is-booting");
    if (statusEl && !isRailStatus(statusEl.textContent)) statusEl.textContent = "";
    paintBackdrop();
  }

  // The twelve second poll rewrites the status line, and the album scrolls it off the
  // top the moment there are photos, so an upload gets a strip that stays put instead.
  function upNode() {
    if (upBar) return upBar;
    upBar = document.createElement("div");
    upBar.className = "up-bar";
    upBar.hidden = true;
    const status = hpRow("backup");
    status.classList.add("up-status");
    const sub = document.createElement("div");
    sub.className = "up-sub";
    upBar.appendChild(status);
    upBar.appendChild(sub);
    document.body.appendChild(upBar);
    return upBar;
  }

  function paintUp(view, sub) {
    const bar = upNode();
    if (upHide) {
      window.clearTimeout(upHide);
      upHide = 0;
    }
    bar.hidden = false;
    paintHp(bar.querySelector(".hp"), view);
    bar.querySelector(".up-sub").textContent = sub || "";
  }

  function closeUp(after) {
    if (upHide) window.clearTimeout(upHide);
    upHide = window.setTimeout(function () {
      upHide = 0;
      if (upBar) upBar.hidden = true;
    }, after);
  }

  function pickCover(person) {
    coverPerson = person;
    if (!coverInput) {
      coverInput = document.createElement("input");
      coverInput.type = "file";
      coverInput.accept = "image/*";
      coverInput.setAttribute("aria-hidden", "true");
      coverInput.style.cssText =
        "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";
      document.body.appendChild(coverInput);
      coverInput.addEventListener("change", function () {
        const file = coverInput.files && coverInput.files[0];
        const who = coverPerson;
        coverInput.value = "";
        if (!file || !who) return;
        uploadCover(who, file);
      });
    }
    coverInput.value = "";
    coverInput.click();
  }

  async function uploadCover(person, file) {
    const body = new FormData();
    body.append("cover", file, file.name || "cover.jpg");
    fail("正在換封面…");
    const entry = document.querySelector('.settings-entry[data-job="cover"]');
    setJobRun(entry, true);
    try {
      const res = await fetch(api("/api/cover?person=" + encodeURIComponent(person)), {
        method: "POST",
        body: body,
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "fail");
      lastCab = "";
      await boot();
      if (statusEl && statusEl.textContent === "正在換封面…") statusEl.textContent = "";
    } catch (err) {
      fail("封面換不上，請再選一次，或確認家裡這台有開");
    } finally {
      setJobRun(entry, false);
    }
  }

  function pickBackdrop(person) {
    coverPerson = person;
    if (backdropInput) {
      backdropInput.value = "";
      backdropInput.click();
    }
  }

  async function uploadBackdrop(person, file) {
    if (waitBusy) return;
    waitBusy = true;
    const body = new FormData();
    body.append("backdrop", file, file.name || "backdrop.jpg");
    const entry = document.querySelector('.settings-entry[data-job="backdrop"]');
    showWaitCard("更換背景中");
    waitTimer = window.setInterval(tickWait, 280);
    setJobRun(entry, true);
    try {
      await postFile(api("/api/backdrop?person=" + encodeURIComponent(person)), body, function (n) {
        if (waitTimer) {
          window.clearInterval(waitTimer);
          waitTimer = 0;
        }
        setWaitPct(n);
      });
      setWaitPct(100);
      lastCab = "";
      await boot();
    } catch (err) {
      fail("背景換不上，請再選一次，或確認家裡這台有開");
    } finally {
      hideWaitCard();
      setJobRun(entry, false);
      waitBusy = false;
    }
  }

  // A phone that will not sync to iCloud and will not talk to Windows over the cable can
  // still open this page, so hand-picking the stranded pictures is the last way in.
  function pickUpload(person, btn) {
    if (uploadBusy || uploadWork) {
      fail("上一批還在處理，稍後再選");
      return;
    }
    uploadPerson = person;
    uploadBtn = btn || null;
    openPicker();
  }

  // iOS re-encodes every HEIC before it will part with a pick, and keeps its own picker
  // on screen until the last one is done. Nothing here runs or can be seen during that
  // wait, so the strip below can only start once the pictures are already in hand.
  function openPicker() {
    if (!uploadInput) {
      uploadInput = document.createElement("input");
      uploadInput.type = "file";
      uploadInput.accept = "image/*,video/*";
      uploadInput.multiple = true;
      uploadInput.setAttribute("aria-hidden", "true");
      uploadInput.style.cssText =
        "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";
      document.body.appendChild(uploadInput);
      uploadInput.addEventListener("change", function () {
        // The input keeps its pick until the next one is opened. Emptying it here would
        // be tidier, but iOS backs each File with a temporary file it is free to drop
        // the moment the input lets go, and then the vault is handed nothing at all.
        const picked = Array.prototype.slice.call(uploadInput.files || []);
        const who = uploadPerson;
        if (!picked.length || !who) return;
        // Let the strip paint before the sizes get added up, so a big pick does not
        // spend its first moment back from the picker looking just as dead as before.
        if (uploadBtn) uploadBtn.classList.add("is-run");
        uploadWork = {
          person: who,
          phase: "upload",
          pinned: [],
          doneAt: 0,
          sawTag: false,
        };
        bumpWork("upload", 0);
        window.setTimeout(function () {
          sendUploads(who, picked);
        }, 50);
      });
    }
    uploadInput.value = "";
    uploadInput.click();
  }

  async function sendUploads(person, files) {
    if (uploadBusy) {
      fail("上一批還在傳，傳完再選下一批");
      return;
    }
    uploadBusy = true;
    const url = api("/api/upload?person=" + encodeURIComponent(person));
    if (!uploadWork || uploadWork.person !== person) {
      uploadWork = {
        person: person,
        phase: "upload",
        pinned: [],
        doneAt: 0,
        sawTag: false,
      };
      bumpWork("upload", 0);
    }
    const groups = [];
    let saved = 0;
    let already = 0;
    let failed = 0;
    let total = 0;
    let bytes = 0;
    const pinned = [];
    files.forEach(function (f) {
      if (f.size > UPLOAD_CAP) {
        failed += 1;
        return;
      }
      if (!groups.length || bytes + f.size > BATCH_CAP) {
        groups.push([]);
        bytes = 0;
      }
      groups[groups.length - 1].push(f);
      bytes += f.size;
      total += f.size;
    });
    let done = 0;
    const why = [];
    function blame(word) {
      if (why.indexOf(word) < 0) why.push(word);
    }
    try {
      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        const body = new FormData();
        let weight = 0;
        group.forEach(function (f) {
          body.append("photo", f, f.name || "photo.jpg");
          weight += f.size;
        });
        try {
          const xhr = await postFile(url, body, function (batchPct) {
            const sent = done + (weight * batchPct) / 100;
            bumpWork("upload", total ? Math.round((sent * 100) / total) : batchPct);
          });
          let data = null;
          try {
            data = JSON.parse(xhr.responseText || "null");
          } catch (parseErr) {
            data = null;
          }
          if (!data) {
            blame("伺服器回 " + xhr.status);
            failed += group.length;
          } else {
            saved += (data.saved || []).length;
            already += (data.already || []).length;
            failed += (data.rejected || []).length;
            (data.items || []).forEach(function (it) {
              pinned.push(it);
            });
          }
        } catch (err) {
          blame("送不出去（" + (err && err.name ? err.name : "不明") + "）");
          failed += group.length;
        }
        done += weight;
        bumpWork("upload", total ? Math.round((done * 100) / total) : 100);
      }
      const complete = Math.min(files.length, saved + already);
      if (failed > 0 || complete === 0) {
        abortUploadWork();
        fail(
          failed
            ? "備份未完成" + (why.length ? "，" + why.join("、") : "")
            : "沒有存進櫃子"
        );
        return;
      }
      bumpWork("upload", 100);
      uploadWork.pinned = pinned;
      lastCab = "";
      await boot();
      if (saved > 0) {
        uploadWork.phase = "tag";
        uploadWork.doneAt = Date.now();
        bumpWork("tag", 0);
        syncUploadWorkTag(person, (latestPeople[person] && latestPeople[person].tag) || {});
      } else {
        finishUploadWork();
      }
    } catch (err) {
      abortUploadWork();
      fail("備份失敗");
    } finally {
      uploadBusy = false;
    }
  }

  function insButton(className, svg, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ins-icon " + className;
    btn.setAttribute("aria-label", label);
    btn.title = label;
    const ring = document.createElement("span");
    ring.className = "ins-ring";
    const face = document.createElement("span");
    face.className = "ins-face";
    face.innerHTML = svg;
    btn.appendChild(ring);
    btn.appendChild(face);
    return btn;
  }

  function closeSettings() {
    const wrap = settingsWrap || document.getElementById("album-settings");
    if (!wrap) return;
    const menu = wrap.querySelector(".settings-menu") || document.querySelector(".settings-menu");
    const toggle = wrap.querySelector(".settings-toggle");
    if (menu) {
      menu.hidden = true;
      if (menu.parentNode !== wrap) wrap.appendChild(menu);
    }
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.classList.remove("is-live");
    }
    if (settingsCatch) settingsCatch.hidden = true;
    document.documentElement.classList.remove("settings-open");
  }

  function ensureSettingsCatch() {
    if (settingsCatch && settingsCatch.isConnected) return settingsCatch;
    const catcher = document.createElement("div");
    catcher.className = "settings-catch";
    catcher.hidden = true;
    catcher.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    });
    catcher.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeSettings();
    });
    document.body.appendChild(catcher);
    settingsCatch = catcher;
    return catcher;
  }

  function openSettingsMenu(toggle, menu) {
    const catcher = ensureSettingsCatch();
    catcher.hidden = false;
    document.body.appendChild(catcher);
    document.body.appendChild(menu);
    menu.hidden = false;
    document.documentElement.classList.add("settings-open");
    requestAnimationFrame(function () {
      placeSettingsMenu(toggle, menu);
    });
  }

  function jobBadge(svg) {
    const badge = document.createElement("span");
    badge.className = "ins-icon job-icon";
    badge.setAttribute("aria-hidden", "true");
    const ring = document.createElement("span");
    ring.className = "ins-ring";
    const face = document.createElement("span");
    face.className = "ins-face";
    face.innerHTML = svg;
    badge.appendChild(ring);
    badge.appendChild(face);
    return badge;
  }

  function setJobRun(entry, on) {
    if (!entry) return;
    entry.classList.toggle("is-run", !!on);
    entry.disabled = !!on;
    entry.setAttribute("aria-disabled", on ? "true" : "false");
    const badge = entry.querySelector(".ins-icon");
    if (badge) badge.classList.toggle("is-run", !!on);
  }

  function showWaitCard(title) {
    const mask = document.getElementById("waitMask");
    const head = document.getElementById("waitTitle");
    const pct = document.getElementById("waitPct");
    if (head) head.textContent = title || "更換背景中";
    if (pct) pct.textContent = "0%";
    if (mask) mask.hidden = false;
  }

  function setWaitPct(n) {
    const pct = document.getElementById("waitPct");
    if (pct) pct.textContent = Math.max(0, Math.min(100, Math.round(n))) + "%";
  }

  function hideWaitCard() {
    const mask = document.getElementById("waitMask");
    if (mask) mask.hidden = true;
    if (waitTimer) {
      window.clearInterval(waitTimer);
      waitTimer = 0;
    }
  }

  function tickWait() {
    const pct = document.getElementById("waitPct");
    const n = parseInt((pct && pct.textContent) || "0", 10) || 0;
    if (n < 90) setWaitPct(n + 1);
  }

  function postFile(url, body, onPct) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
        else reject(new Error("fail"));
      };
      xhr.onerror = function () { reject(new Error("net")); };
      if (xhr.upload) {
        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable && ev.total) onPct(Math.round((ev.loaded / ev.total) * 100));
        };
      }
      xhr.send(body);
    });
  }

  function ensureSettings() {
    if (settingsWrap && settingsWrap.isConnected) {
      const host = cabHud && cabHud.querySelector(".cab-wrap");
      if (host && settingsWrap.parentNode !== host) host.appendChild(settingsWrap);
      return settingsWrap;
    }
    const existing = document.getElementById("album-settings");
    const wrap = existing && existing.isConnected ? existing : document.createElement("div");
    settingsWrap = wrap;
    wrap.id = "album-settings";
    wrap.className = "album-settings";
    wrap.hidden = true;
    wrap.innerHTML = "";
    const toggle = insButton("settings-toggle", GEAR, "設定");
    toggle.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "settings-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.addEventListener("pointerdown", function (ev) {
      ev.stopPropagation();
    });
    function entry(svg, label, action, job) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-entry";
      btn.setAttribute("role", "menuitem");
      if (job) btn.dataset.job = job;
      btn.appendChild(jobBadge(svg));
      const text = document.createElement("span");
      text.textContent = label;
      btn.appendChild(text);
      btn.addEventListener("click", function () {
        if (btn.classList.contains("is-run") || btn.disabled) return;
        closeSettings();
        action();
      });
      return btn;
    }
    menu.appendChild(
      entry(REFRESH, "備份iCloud照片", function () {
        const pid = wrap.dataset.person || openPerson;
        if (pid) startBackup(pid);
      }, "icloud")
    );
    menu.appendChild(
      entry(UPLOAD, "備份本機照片", function () {
        if (window.FamilyDrive && window.FamilyDrive.isOn()) {
          window.FamilyDrive.runBackup();
          return;
        }
        const pid = wrap.dataset.person || openPerson;
        if (pid) pickUpload(pid);
      }, "local")
    );
    menu.appendChild(
      entry(STICK, "打開隨身碟", function () {
        if (window.FamilyDrive && window.FamilyDrive.pick) window.FamilyDrive.pick();
      }, "drive")
    );
    menu.appendChild(
      entry(CAMERA, "更換大頭照", function () {
        const pid = wrap.dataset.person || openPerson;
        if (pid) pickCover(pid);
      }, "cover")
    );
    menu.appendChild(
      entry(SCENE, "更換背景", function () {
        const pid = wrap.dataset.person || openPerson;
        if (pid) pickBackdrop(pid);
      }, "backdrop")
    );
    menu.appendChild(
      entry(MAG, "搜尋設定", function () {
        if (window.FamilyTags && window.FamilyTags.openSearchSettings) {
          window.FamilyTags.openSearchSettings();
        }
      }, "search")
    );
    const idRow = entry(PERSON, "切換身分", function () {
      const ids = personIds();
      if (ids.length < 2) return;
      const i = Math.max(0, ids.indexOf(openPerson));
      const next = ids[(i + 1) % ids.length];
      location.hash = next;
    }, "identity");
    idRow.hidden = true;
    menu.appendChild(idRow);
    menu.appendChild(
      entry(TRASH, "開啟垃圾桶", function () {
        if (window.FamilyFeed) window.FamilyFeed.openTrash();
      })
    );
    toggle.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const open = menu.hidden;
      if (open) openSettingsMenu(toggle, menu);
      else closeSettings();
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.classList.toggle("is-live", open);
    });
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    const host = cabHud && cabHud.querySelector(".cab-wrap");
    if (host) host.appendChild(wrap);
    else document.body.appendChild(wrap);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeSettings();
    });
    window.addEventListener("resize", function () {
      placeSettingsMenu(toggle, menu);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        placeSettingsMenu(toggle, menu);
      });
    }
    return wrap;
  }

  function showSettings(on, pid) {
    const wrap = ensureSettings();
    pid = pid || openPerson;
    if (on && pid && cabHud) {
      const host = cabHud.querySelector(".cab-wrap");
      if (host && wrap.parentNode !== host) host.appendChild(wrap);
      wrap.dataset.person = pid;
    }
    wrap.hidden = !on;
    if (!on) closeSettings();
    paintIdentityRow();
    paintDriveGear();
  }

  function paintDriveGear() {
    const driveOn = !!(window.FamilyDrive && window.FamilyDrive.isOn());
    const menu = document.querySelector(".settings-menu");
    if (!menu) return;
    ["icloud", "cover", "backdrop"].forEach(function (job) {
      const row = menu.querySelector('[data-job="' + job + '"]');
      if (row) row.hidden = driveOn;
    });
  }

  function bindCastTrash(btn) {
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.FamilyFeed) window.FamilyFeed.trashSelected();
    });
  }

  function hpRow(kind) {
    const row = document.createElement("div");
    row.className = "hp";
    row.dataset.kind = kind;
    const label = document.createElement("div");
    label.className = "hp-label";
    const text = document.createElement("span");
    text.className = "hp-text";
    const alt = document.createElement("span");
    alt.className = "hp-alt";
    alt.hidden = true;
    alt.innerHTML = '<span class="hp-alt-pct"></span><span class="hp-alt-count"></span>';
    const mark = document.createElement("span");
    mark.className = "hp-check";
    mark.hidden = true;
    mark.innerHTML = CHECK;
    const think = document.createElement("div");
    think.className = "thinking-five hp-think";
    think.setAttribute("aria-hidden", "true");
    think.innerHTML = "<span></span><span></span><span></span><span></span><span></span>";
    think.hidden = true;
    label.appendChild(text);
    label.appendChild(alt);
    label.appendChild(think);
    label.appendChild(mark);
    const meter = document.createElement("div");
    meter.className = "hp-meter";
    const track = document.createElement("div");
    track.className = "hp-track";
    const fill = document.createElement("div");
    fill.className = "hp-fill";
    track.appendChild(fill);
    const num = document.createElement("span");
    num.className = "hp-num";
    meter.appendChild(track);
    meter.appendChild(num);
    row.appendChild(label);
    row.appendChild(meter);
    return row;
  }

  function paintBackdrop() {
    if (isBooting()) return;
    const blobs = document.getElementById("blobs");
    if (blobs) blobs.hidden = true;
    const p = latestPeople[openPerson];
    if (p) paintStage(p);
    else layoutStage();
  }

  function placeSettingsMenu(toggle, menu) {
    if (!toggle || !menu || menu.hidden) return;
    const box = toggle.getBoundingClientRect();
    const pad = 10;
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const vo = vv ? vv.offsetTop : 0;
    const vl = vv ? vv.offsetLeft : 0;
    const mw = menu.offsetWidth || 220;
    const mh = menu.offsetHeight || 200;
    let left = box.right - mw;
    if (left < vl + pad) left = vl + pad;
    if (left + mw > vl + vw - pad) left = Math.max(vl + pad, vl + vw - mw - pad);
    let top = box.bottom + 8;
    if (top + mh > vo + vh - pad) top = box.top - mh - 8;
    if (top < vo + pad) top = vo + pad;
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  function paintCap(el, view, idle) {
    if (!el) return;
    if (view && (view.running || view.error)) {
      el.hidden = false;
      paintHp(el, view);
      return;
    }
    if (idle) {
      el.hidden = false;
      const text = el.querySelector(".hp-text");
      const alt = el.querySelector(".hp-alt");
      if (text) text.textContent = idle;
      if (alt) alt.hidden = true;
      el.classList.remove("is-run", "is-wait", "is-done", "is-error");
      return;
    }
    el.hidden = true;
  }

  function fillHud(hud, p) {
    if (!hud || !p) return;
    const id = p.id;
    syncCabinetWork(p);
    const backupRun = p.sync === "running";
    if (backupRun) backupAsk[id] = false;
    if (!backupRun && (p.sync === "synced" || p.percent === 100)) {
      try {
        localStorage.setItem("family.backupDone." + id, "1");
      } catch (e) {}
    }
    const localRun =
      !!(uploadWork && uploadWork.person === id && uploadWork.phase === "upload") ||
      (uploadBusy && uploadPerson === id);
    const icloudRun = !localRun && (backupRun || !!backupAsk[id]);
    const cover = hud.querySelector(".cab-cover");
    if (cover) cover.classList.remove("is-run");
    const cap = hud.querySelector(".cab-caption");
    paintCap(cap, null, selectLine);
    const box = settingsWrap || document.getElementById("album-settings");
    const menu = document.querySelector(".settings-menu");
    if (box && box.dataset.person === id) {
      setJobRun((menu || box).querySelector('[data-job="icloud"]'), icloudRun);
      setJobRun((menu || box).querySelector('[data-job="local"]'), localRun);
    }
    paintBackdrop();
  }

  function paintHp(row, view) {
    if (!row) return;
    const text = row.querySelector(".hp-text");
    const alt = row.querySelector(".hp-alt");
    const mark = row.querySelector(".hp-check");
    const fill = row.querySelector(".hp-fill");
    const num = row.querySelector(".hp-num");
    const pct = view.percent == null ? null : Number(view.percent);
    const shown = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
    if (text) {
      text.textContent = view.error
        ? view.errorText || "備份失敗"
        : view.running
          ? view.busyText
          : view.info
            ? view.infoText || view.doneText
            : view.done
              ? view.doneText
              : view.waitText;
    }
    if (alt) {
      const doneCount = Number(view.doneCount);
      const totalCount = Number(view.totalCount);
      const hasCount =
        view.running &&
        Number.isFinite(doneCount) &&
        Number.isFinite(totalCount) &&
        totalCount > 0;
      const hasPercent = view.running && shown != null;
      alt.querySelector(".hp-alt-pct").textContent = hasPercent ? Math.round(shown) + "%" : "";
      alt.querySelector(".hp-alt-count").textContent = hasCount
        ? Math.max(0, Math.round(doneCount)) + "/" + Math.round(totalCount)
        : "";
      alt.hidden = !hasPercent && !hasCount;
      alt.classList.toggle("has-two", hasPercent && hasCount);
      alt.classList.toggle("count-only", !hasPercent && hasCount);
    }
    if (mark) mark.hidden = !view.done;
    const think = row.querySelector(".hp-think");
    if (think) think.hidden = !view.running;
    if (fill) fill.style.width = (view.done ? 100 : shown == null ? (view.running ? 42 : 0) : shown) + "%";
    if (num) {
      num.textContent = "";
    }
    row.classList.toggle("is-run", !!view.running);
    row.classList.toggle("is-wait", !!view.running && shown == null);
    row.classList.toggle("is-done", !!view.done);
    row.classList.toggle("is-error", !!view.error);
  }

  function startBackup(person) {
    const row = latestPeople[person];
    if (backupAsk[person] || (row && row.sync === "running")) return;
    backupAsk[person] = true;
    try {
      localStorage.removeItem("family.backupDone." + person);
    } catch (e) {}
    const hud = hudFor(person);
    if (hud && row) fillHud(hud, row);
    paintBackdrop();
    fetch(api("/api/sync?person=" + encodeURIComponent(person)), { method: "POST" })
      .then(function (res) {
        return res.json().then(function (j) {
          return { res: res, j: j };
        });
      })
      .then(function (x) {
        if (!x.res.ok && x.j && x.j.sync !== "running") {
          throw new Error(x.j.error || "fail");
        }
        lastCab = "";
        boot();
      })
      .catch(function () {
        backupAsk[person] = false;
        fail("現在同步不了，請聯絡維護的那個傢伙");
        const p = latestPeople[person];
        const next = hudFor(person);
        if (p && next) fillHud(next, p);
        else paintBackdrop();
      });
  }

  function cardStamp(people) {
    return JSON.stringify(
      (people || []).map(function (p) {
        return {
          id: p.id,
          sync: p.sync,
          has_cover: p.has_cover,
          cover_rev: p.cover_rev,
          has_backdrop: p.has_backdrop,
          backdrop_rev: p.backdrop_rev,
          display_name: p.display_name,
        };
      })
    );
  }

  function applyDrive(p) {
    if (!p || !p.id) return;
    names[p.id] = p.display_name;
    latestPeople[p.id] = p;
    if (openPerson === p.id) openPerson = "";
    lastCab = "drive:" + p.id;
    if (window.FamilyDrive && window.FamilyDrive.hidePick) window.FamilyDrive.hidePick();
    endBoot();
    showAlbum(p.id, p.display_name);
    paintDriveGear();
  }

  async function boot() {
    if (window.FamilyDrive && window.FamilyDrive.isOn()) {
      if (!openPerson) applyDrive(window.FamilyDrive.cabinet());
      return;
    }
    if (window.FamilyDrive && window.FamilyDrive.showPick) window.FamilyDrive.showPick();
    if (!ORIGIN || !window.FAMILY_VIEW_KEY) {
      lastCab = "";
      return;
    }
    try {
      const pub = await readJson("/api/public");
      if (window.FamilyDrive && window.FamilyDrive.isOn()) return;
      if (statusEl) {
        statusEl.textContent = isBooting() ? "正在打開相簿…" : lineFrom(pub);
      }
      const cab = await readJson("/api/cabinets");
      if (window.FamilyDrive && window.FamilyDrive.isOn()) return;
      names = {};
      latestPeople = {};
      (cab.people || []).forEach(function (p) {
        names[p.id] = p.display_name;
        latestPeople[p.id] = p;
      });
      const stamp = cardStamp(cab.people);
      const current = latestPeople[openPerson] || latestPeople[primaryPersonId()];
      if (current && cabHud) {
        if (stamp !== lastCab) paintFace(current);
        fillHud(cabHud, current);
      }
      lastCab = stamp;
      window._familyRunning = (cab.people || []).some(function (p) {
        return p.sync === "running";
      });
      window._familyTagging = (cab.people || []).some(function (p) {
        return p.tag && p.tag.state === "running";
      });
      if (window.FamilyDrive && window.FamilyDrive.hidePick) window.FamilyDrive.hidePick();
      endBoot();
    } catch (err) {
      if (lastCab && lastCab.indexOf("drive:") !== 0) return;
      if (window.FamilyDrive && window.FamilyDrive.showPick) window.FamilyDrive.showPick();
    }
    if (window.FamilyDrive && window.FamilyDrive.isOn()) return;
    route();
  }

  function route() {
    const id = personFromHash();
    if (id && names[id]) {
      showAlbum(id, names[id] || id);
      return;
    }
    showHome();
  }

  function isRailStatus(text) {
    return (
      text.indexOf("已選") === 0 ||
      text.indexOf("請點選") === 0 ||
      text.indexOf("正在下載") === 0 ||
      text.indexOf("已下載") === 0 ||
      text.indexOf("已送出") === 0 ||
      text === "正在看垃圾桶"
    );
  }

  function paintRailHeart(on) {
    const rail = document.getElementById("photo-rail");
    const heart = rail && rail.querySelector(".rail-heart");
    if (heart) heart.classList.toggle("is-on", !!on);
  }

  function showRail(on) {
    const rail = ensureRail();
    if (rail) rail.hidden = !on;
    document.documentElement.classList.toggle("has-rail", !!on);
    if (!on) paintRailHeart(false);
  }

  function ensureRail() {
    const rail = document.getElementById("photo-rail");
    if (!rail) return null;
    if (rail.dataset.ready) return rail;
    rail.dataset.ready = "1";
    const hash = insButton("rail-hash", HASH, "新增標記");
    hash.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.FamilyFeed && window.FamilyFeed.isFolderWall && window.FamilyFeed.isFolderWall()) {
        const one = window.FamilyFeed.selectedFolder && window.FamilyFeed.selectedFolder();
        if (!one) {
          window.FamilyFeed.prepareAction();
          return;
        }
        if (window.FamilyTags && window.FamilyTags.openFolderCard) {
          window.FamilyTags.openFolderCard(one);
        }
        return;
      }
      if (!window.FamilyFeed || !window.FamilyFeed.prepareAction()) return;
      if (window.FamilyTags && window.FamilyTags.openBatch) {
        window.FamilyTags.openBatch();
      }
    });
    const trash = insButton("rail-trash", TRASH, "丟進垃圾桶");
    bindCastTrash(trash);
    const down = insButton("rail-down", DOWNLOAD, "下載");
    down.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.FamilyFeed) window.FamilyFeed.downloadSelected();
    });
    const cover = insButton("rail-cover", CAMERA, "設為封面");
    cover.hidden = true;
    cover.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.FamilyFeed && window.FamilyFeed.setFolderCover) {
        window.FamilyFeed.setFolderCover();
      }
    });
    rail.appendChild(hash);
    rail.appendChild(trash);
    rail.appendChild(down);
    rail.appendChild(cover);
    const heart = insButton("rail-heart", HEART, "愛心");
    heart.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.FamilyFeed && window.FamilyFeed.toggleHeart) window.FamilyFeed.toggleHeart();
    });
    rail.appendChild(heart);
    return rail;
  }

  function paintRailMode() {
    const rail = ensureRail();
    if (!rail) return;
    const wall = window.FamilyFeed && window.FamilyFeed.isFolderWall && window.FamilyFeed.isFolderWall();
    const inFolder = !!(window.FamilyFeed && window.FamilyFeed.folderId && window.FamilyFeed.folderId());
    const one = wall && window.FamilyFeed.selectedFolder && window.FamilyFeed.selectedFolder();
    const hash = rail.querySelector(".rail-hash");
    const down = rail.querySelector(".rail-down");
    const heart = rail.querySelector(".rail-heart");
    const cover = rail.querySelector(".rail-cover");
    if (hash) {
      hash.hidden = !!(wall && !one);
      hash.setAttribute("aria-label", wall ? "編輯資料夾" : "新增標記");
      hash.title = wall ? "編輯資料夾" : "新增標記";
    }
    if (down) down.hidden = !!wall;
    if (heart) heart.hidden = !!wall;
    if (cover) cover.hidden = !inFolder || !!wall;
  }

  window.FamilyDoor = {
    boot: function () {
      boot();
      startPoll();
    },
    onDrive: function (p) {
      applyDrive(p);
    },
    setSelect: function (count, inTrash, hint) {
      const n = Number(count) || 0;
      if (inTrash) selectLine = "正在看垃圾桶";
      else if (hint) selectLine = hint;
      else if (n > 0) selectLine = "已選 " + n + " / 99";
      else selectLine = "";
      if (statusEl && isRailStatus(statusEl.textContent)) statusEl.textContent = "";
      const pid = openPerson;
      const p = pid && latestPeople[pid];
      const hud = pid && hudFor(pid);
      if (p && hud) fillHud(hud, p);
    },
    setRail: function (on) {
      showRail(!!on);
      paintRailMode();
    },
    paintRailMode: paintRailMode,
    paintRailHeart: function (on) {
      paintRailHeart(!!on);
    },
    layoutStage: layoutStage,
  };
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", layoutStage);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", layoutStage);
  if (coverInput) {
    coverInput.addEventListener("change", function () {
      const file = coverInput.files && coverInput.files[0];
      const who = coverPerson || openPerson;
      coverInput.value = "";
      if (!file || !who) return;
      uploadCover(who, file);
    });
  }
  if (backdropInput) {
    backdropInput.addEventListener("change", function () {
      const file = backdropInput.files && backdropInput.files[0];
      const who = coverPerson || openPerson;
      backdropInput.value = "";
      if (!file || !who) return;
      uploadBackdrop(who, file);
    });
  }
  let polling = false;
  function startPoll() {
    if (polling) return;
    polling = true;
    (function poll() {
      const wait = uploadWork || window._familyRunning || window._familyTagging ? 3000 : 12000;
      setTimeout(function () {
        if ((window.FamilyDrive && window.FamilyDrive.isOn()) || !ORIGIN) {
          poll();
          return;
        }
        Promise.resolve(boot()).then(poll);
      }, wait);
    })();
  }
  if (window.FamilyDrive && window.FamilyDrive.showPick && !window.FAMILY_FORCE_INVITE) {
    window.FamilyDrive.showPick();
  }
  if (window.FamiphotoGate) {
    window.FamiphotoGate.start();
  } else {
    boot();
    startPoll();
  }
})();
