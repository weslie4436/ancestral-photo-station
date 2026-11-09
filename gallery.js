(function () {
  const ORIGIN = (window.VAULT_ORIGIN || "").replace(/\/$/, "");
  const FIRST = 12;
  const LIMIT = 24;
  const THUMB_CAP = 6;
  const SELECT_MAX = 99;
  const THUMB_CACHE = "famiphoto-thumbs-v2";
  const FEED_STORE = "famiphoto.feed.v1.";
  const FEED_KEEP = 96;
  const SKIP_TRASH_KEY = "family.skipTrashAsk";
  const HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20C10.5 18.4 7.3 15.8 5.4 11.9C4 9.1 5.2 6 8.4 6c1.8 0 3 1.1 3.6 2.2C12.6 7.1 13.8 6 15.6 6c3.2 0 4.4 3.1 3 5.9C16.7 15.8 13.5 18.4 12 20Z"/></svg>';
  const PLUS =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  let run = 0;
  let lightbox;
  let thumbActive = 0;
  const thumbWait = [];
  const blobUrls = [];
  const feedSnaps = {};
  let paintHint = function () {};
  let afterThumbs = function () {};
  let currentPerson = "";
  let currentTags = [];
  let currentScope = "";
  const TEXT_PRE = "text:";
  const QR_ANY = "qr:any";
  let beforeTrashTags = [];
  let trashMode = false;
  let favMode = false;
  let videoMode = false;
  let folderWall = false;
  let folderId = "";
  let fromClass = false;
  let nextFolderTitle = "新資料夾1";
  let selecting = false;
  let viewing = false;
  let picked = {};
  let selectHint = "";
  let workTile = null;
  let workState = null;
  try {
    caches.delete("famiphoto-thumbs-v1");
  } catch (e) {}

  function workPct(percent) {
    const n = Number(percent);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function workLabel(phase) {
    if (phase === "tag") return "標記中...";
    if (phase === "backup") return "備份中...";
    return "上傳中...";
  }

  function canShowWork() {
    return !!(
      currentPerson &&
      !folderWall &&
      !folderId &&
      !fromClass &&
      !trashMode &&
      !favMode &&
      !videoMode
    );
  }

  function hideWorkTile() {
    if (workTile && workTile.parentNode) workTile.parentNode.removeChild(workTile);
  }

  function paintWorkTile(phase, percent) {
    if (phase) {
      workState = { phase: phase, percent: workPct(percent) };
    }
    if (!workState) {
      hideWorkTile();
      return;
    }
    const feed = document.getElementById("feed");
    if (!feed || !canShowWork()) {
      hideWorkTile();
      return;
    }
    if (!workTile) {
      workTile = document.createElement("div");
      workTile.className = "tile tile-add";
      workTile.dataset.work = "1";
      workTile.setAttribute("aria-busy", "true");
      const inner = document.createElement("span");
      inner.className = "tile-plus";
      inner.innerHTML =
        '<div class="thinking-five hp-think" aria-hidden="true">' +
        "<span></span><span></span><span></span><span></span><span></span></div>" +
        '<span class="hp-text"></span>' +
        '<span class="hp-alt"><span class="hp-alt-pct"></span></span>';
      const shield = document.createElement("span");
      shield.className = "tile-shield";
      workTile.appendChild(inner);
      workTile.appendChild(shield);
    }
    const text = workTile.querySelector(".hp-text");
    const altPct = workTile.querySelector(".hp-alt-pct");
    if (text) text.textContent = workLabel(workState.phase);
    if (altPct) altPct.textContent = workState.percent + "%";
    const bar = feed.querySelector(".trash-bar");
    const first = bar ? bar.nextSibling : feed.firstChild;
    if (workTile.parentNode !== feed || workTile !== first) {
      feed.insertBefore(workTile, first);
    }
  }

  function clearWorkTile() {
    workState = null;
    hideWorkTile();
    workTile = null;
  }

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

  function thumbsBusy() {
    return thumbActive > 0 || thumbWait.length > 0;
  }

  function dropBlobs() {
    blobUrls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {}
    });
    blobUrls.length = 0;
  }

  function pumpThumbs() {
    while (thumbActive < THUMB_CAP && thumbWait.length) {
      const job = thumbWait.shift();
      thumbActive += 1;
      job(function () {
        thumbActive -= 1;
        pumpThumbs();
        paintHint();
        if (!thumbsBusy()) afterThumbs();
      });
    }
  }

  function thumbCache() {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(THUMB_CACHE).catch(function () {
      return null;
    });
  }

  function readCachedThumb(url) {
    return thumbCache()
      .then(function (cache) {
        if (!cache) return null;
        return cache.match(url);
      })
      .then(function (res) {
        return res ? res.blob() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function writeCachedThumb(key, blob) {
    if (!blob || !key) return;
    thumbCache()
      .then(function (cache) {
        if (!cache) return;
        return cache.put(
          key,
          new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } })
        );
      })
      .catch(function () {});
  }

  function thumbKey(item, size) {
    const base =
      typeof location !== "undefined" && location.origin
        ? location.origin
        : "https://famiphoto.local";
    return (
      base +
      "/famiphoto-t/" +
      encodeURIComponent(item.person || "") +
      "/" +
      encodeURIComponent(item.bucket || "") +
      "/" +
      encodeURIComponent(item.rel || "") +
      "/" +
      encodeURIComponent(size || "tile")
    );
  }

  function isTextTok(id) {
    return String(id || "").indexOf(TEXT_PRE) === 0;
  }

  function textFromTok(id) {
    if (!isTextTok(id)) return "";
    try {
      return decodeURIComponent(String(id).slice(TEXT_PRE.length));
    } catch (e) {
      return String(id).slice(TEXT_PRE.length);
    }
  }

  function splitTokens(ids) {
    const tags = [];
    let q = "";
    let hasQr = false;
    (ids || []).forEach(function (id) {
      if (id === QR_ANY) hasQr = true;
      else if (isTextTok(id)) q = textFromTok(id);
      else if (id) tags.push(id);
    });
    return { tags: tags, q: q, hasQr: hasQr };
  }

  function snapId(person, tagIds, trash, fav, scope, video) {
    return (
      person +
      "|" +
      (trash ? "1" : "0") +
      "|" +
      (fav ? "f" : "0") +
      "|" +
      (video ? "v" : "0") +
      "|" +
      tagKey(tagIds) +
      "|" +
      (scope || "")
    );
  }

  function photosPath(person, offset, limit, trash, fav) {
    const feed = document.getElementById("feed");
    let path =
      "/api/photos?person=" +
      encodeURIComponent(person) +
      "&offset=" +
      offset +
      "&limit=" +
      limit;
    const tags = ((feed && feed.dataset.tags) || "").split(",").filter(Boolean);
    if (tags.length) path += "&tags=" + tags.map(encodeURIComponent).join(",");
    if (feed && feed.dataset.q) path += "&q=" + encodeURIComponent(feed.dataset.q);
    if (feed && feed.dataset.qr === "1") path += "&qr=1";
    if (feed && feed.dataset.scope) path += "&scope=" + encodeURIComponent(feed.dataset.scope);
    if (trash) path += "&trash=1";
    if (fav) path += "&fav=1";
    if (feed && feed.dataset.video === "1") path += "&video=1";
    return path;
  }

  function readSnap(id) {
    if (feedSnaps[id] && feedSnaps[id].items && feedSnaps[id].items.length) {
      return feedSnaps[id];
    }
    try {
      const raw = localStorage.getItem(FEED_STORE + id);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.items && parsed.items.length) {
        feedSnaps[id] = parsed;
        return parsed;
      }
    } catch (e) {}
    return null;
  }

  function writeSnap(id, total, items) {
    feedSnaps[id] = { total: total, items: items.slice() };
    try {
      localStorage.setItem(
        FEED_STORE + id,
        JSON.stringify({ total: total, items: items.slice(0, FEED_KEEP) })
      );
    } catch (e) {
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(FEED_STORE) === 0) localStorage.removeItem(k);
        });
        localStorage.setItem(
          FEED_STORE + id,
          JSON.stringify({ total: total, items: items.slice(0, FEED_KEEP) })
        );
      } catch (e2) {}
    }
  }

  function sameHead(a, b, n) {
    const count = Math.min(n, a.length, b.length);
    if (!count) return false;
    for (let i = 0; i < count; i++) {
      if (itemKey(a[i]) !== itemKey(b[i])) return false;
    }
    return true;
  }

  function showBlob(img, blob, onReady) {
    const obj = URL.createObjectURL(blob);
    blobUrls.push(obj);
    function done() {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onErr);
      if (onReady) onReady();
    }
    function onLoad() {
      done();
    }
    function onErr() {
      done();
    }
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onErr);
    img.src = obj;
  }

  function watchThumb(img, item, size, eager) {
    const url = qs(item, "thumb", size);
    const key = thumbKey(item, size);
    img.dataset.thumbUrl = url;
    img.dataset.thumbKey = key;
    if (eager) {
      if (img.dataset.thumbBound) return;
      img.dataset.thumbBound = "1";
      bindThumb(img, url, key, function () {
        img.classList.add("is-on");
      });
      return;
    }
    if (!window.thumbObserver) {
      window.thumbObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            const node = en.target;
            window.thumbObserver.unobserve(node);
            const src = node.dataset.thumbUrl;
            const cacheKey = node.dataset.thumbKey;
            if (!src || node.dataset.thumbBound) return;
            node.dataset.thumbBound = "1";
            bindThumb(node, src, cacheKey, function () {
              node.classList.add("is-on");
            });
          });
        },
        { rootMargin: "240px 0px" }
      );
    }
    window.thumbObserver.observe(img);
  }

  function bindThumb(img, url, key, onReady) {
    readCachedThumb(key || url).then(function (cached) {
      if (cached) {
        showBlob(img, cached, onReady);
        return;
      }
      let tries = 0;
      function start(done) {
        function settle() {
          if (done) done();
        }
        fetch(url, url.indexOf("blob:") === 0 ? {} : { mode: "cors", credentials: "omit" })
          .then(function (res) {
            if (!res.ok) throw new Error("bad");
            return res.blob();
          })
          .then(function (blob) {
            writeCachedThumb(key || url, blob);
            showBlob(img, blob, function () {
              settle();
              if (img.isConnected && onReady) onReady();
            });
          })
          .catch(function () {
            function onLoad() {
              img.removeEventListener("load", onLoad);
              img.removeEventListener("error", onErr);
              settle();
              if (img.isConnected && onReady) onReady();
            }
            function onErr() {
              img.removeEventListener("load", onLoad);
              img.removeEventListener("error", onErr);
              settle();
              if (tries >= 1) return;
              tries += 1;
              window.setTimeout(function () {
                thumbWait.push(start);
                pumpThumbs();
              }, 450 * tries);
            }
            img.addEventListener("load", onLoad);
            img.addEventListener("error", onErr);
            img.src = tries ? url + "&retry=" + tries : url;
          });
      }
      thumbWait.push(start);
      pumpThumbs();
    });
  }

  function qs(item, kind, size) {
    if (window.FamilyDrive && window.FamilyDrive.isOn()) {
      return window.FamilyDrive.mediaUrl(item, kind === "full" ? "media" : kind, size);
    }
    const p = new URLSearchParams({
      person: item.person,
      bucket: item.bucket,
      rel: item.rel,
    });
    if (kind === "thumb" && size) p.set("size", size);
    if (kind === "full") p.set("full", "1");
    return api((kind === "thumb" ? "/thumb?" : "/media?") + p.toString());
  }

  function itemKey(item) {
    if (item.kind === "folder") return "folder:" + item.id;
    if (item.kind === "fav") return "folder:fav";
    if (item.kind === "videos") return "folder:videos";
    if (item.kind === "qr") return "folder:qr";
    if (item.kind === "add") return "folder:add";
    return item.person + "|" + item.bucket + "|" + item.rel;
  }

  function normalizedTags(tagIds) {
    const seen = {};
    return (tagIds || [])
      .map(function (id) {
        return String(id || "");
      })
      .filter(function (id) {
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      })
      .sort();
  }

  function tagKey(tagIds) {
    return normalizedTags(tagIds).join(",");
  }

  function pickCount() {
    return Object.keys(picked).length;
  }

  function toolsOn() {
    return !trashMode && (selecting || viewing);
  }

  function tellSelect(hint) {
    if (hint !== undefined) selectHint = hint || "";
    if (pickCount() > 0) selectHint = "";
    if (window.FamilyDoor && window.FamilyDoor.setSelect) {
      window.FamilyDoor.setSelect(
        selecting ? pickCount() : 0,
        trashMode,
        trashMode ? "" : selectHint
      );
    }
    if (window.FamilyDoor && window.FamilyDoor.setRail) {
      window.FamilyDoor.setRail(toolsOn());
    }
    if (window.FamilyDoor && window.FamilyDoor.paintRailHeart) {
      const items = targetItems();
      const loved = items.length > 0 && items.every(function (it) { return it.favorite; });
      window.FamilyDoor.paintRailHeart(loved);
    }
    if (window.FamilyDoor && window.FamilyDoor.paintRailMode) {
      window.FamilyDoor.paintRailMode();
    }
  }

  function markTile(a, on) {
    if (!a) return;
    a.classList.toggle("is-pick", !!on);
  }

  function paintPicked() {
    const feed = document.getElementById("feed");
    if (!feed) return;
    feed.querySelectorAll(".tile").forEach(function (a) {
      markTile(a, selecting && picked[a.dataset.key]);
    });
    tellSelect();
  }

  function enterSelect(item, tile) {
    if (trashMode) return;
    if (item && (item.kind === "fav" || item.kind === "videos" || item.kind === "qr" || item.kind === "add")) return;
    selecting = true;
    if (item) {
      const key = itemKey(item);
      if (!picked[key] && pickCount() >= SELECT_MAX) return;
      picked[key] = item;
      markTile(tile, true);
    }
    tellSelect();
  }

  function toggleSelect(item, tile) {
    if (trashMode) return;
    if (!selecting) {
      enterSelect(item, tile);
      return;
    }
    const key = itemKey(item);
    if (picked[key]) {
      delete picked[key];
      markTile(tile, false);
      if (!pickCount()) {
        selecting = false;
      }
    } else {
      if (pickCount() >= SELECT_MAX) return;
      picked[key] = item;
      markTile(tile, true);
    }
    tellSelect();
  }

  function clearSelect() {
    selecting = false;
    picked = {};
    selectHint = "";
    paintPicked();
  }

  function viewingItem() {
    if (!viewing || !lightbox || !lightbox.pswp || !lightbox._slides) return null;
    const slide = lightbox._slides[lightbox.pswp.currIndex];
    return (slide && slide.familyItem) || null;
  }

  function targetItems() {
    const keys = Object.keys(picked);
    if (keys.length) {
      return keys.map(function (key) {
        return picked[key];
      });
    }
    const one = viewingItem();
    return one ? [one] : [];
  }

  function targetRows() {
    return targetItems().map(function (item) {
      return { person: item.person, bucket: item.bucket, rel: item.rel };
    });
  }

  function prepareAction() {
    if (trashMode) return false;
    if (targetItems().length) return true;
    if (selecting) {
      clearSelect();
      return false;
    }
    selecting = true;
    tellSelect(
      folderWall ? "請點選資料夾，可一個或多個，再按一次" : "請點選照片，可一張或多張，再按一次"
    );
    return false;
  }

  function note(msg) {
    const el = document.getElementById("status");
    if (el) el.textContent = msg || "";
  }

  let busyDepth = 0;
  let busyClear = 0;

  function busyNode() {
    let node = document.getElementById("work-note");
    if (node) return node;
    node = document.createElement("div");
    node.id = "work-note";
    node.className = "work-note";
    node.hidden = true;
    const spin = document.createElement("span");
    spin.className = "work-spin";
    const text = document.createElement("span");
    text.className = "work-text";
    node.appendChild(spin);
    node.appendChild(text);
    document.body.appendChild(node);
    return node;
  }

  function paintBusy(msg, spinning) {
    const node = busyNode();
    node.querySelector(".work-text").textContent = msg || "";
    node.classList.toggle("is-done", !spinning);
    node.hidden = !msg;
  }

  // Every change tells the family it is being handled the moment they tap, so no
  // button ever looks like it did nothing while the vault writes.
  window.FamilyBusy = {
    start: function (msg) {
      busyDepth += 1;
      if (busyClear) {
        window.clearTimeout(busyClear);
        busyClear = 0;
      }
      paintBusy(msg || "處理中…", true);
    },
    done: function (msg) {
      busyDepth = Math.max(0, busyDepth - 1);
      if (busyDepth) return;
      if (!msg) {
        paintBusy("", false);
        return;
      }
      paintBusy(msg, false);
      busyClear = window.setTimeout(function () {
        busyClear = 0;
        paintBusy("", false);
      }, 1800);
    },
  };

  function skipTrashAsk() {
    try {
      return localStorage.getItem(SKIP_TRASH_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function rememberSkipTrash() {
    try {
      localStorage.setItem(SKIP_TRASH_KEY, "1");
    } catch (e) {}
  }

  function askTrash() {
    if (skipTrashAsk()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      const mask = document.createElement("div");
      mask.className = "ask-mask";
      mask.innerHTML =
        '<div class="ask-card" role="dialog" aria-modal="true">' +
        "<p>將照片丟進垃圾桶?</p>" +
        '<label class="ask-skip"><span>不再提示</span><input type="checkbox" role="switch"/><span class="ask-sw"></span></label>' +
        '<div class="ask-actions"><button type="button" class="ask-no">取消</button><button type="button" class="ask-yes">丟掉</button></div>' +
        "</div>";
      const box = mask.querySelector("input");
      function finish(ok) {
        if (ok && box && box.checked) rememberSkipTrash();
        mask.remove();
        resolve(ok);
      }
      mask.querySelector(".ask-no").addEventListener("click", function () {
        finish(false);
      });
      mask.querySelector(".ask-yes").addEventListener("click", function () {
        finish(true);
      });
      mask.addEventListener("click", function (ev) {
        if (ev.target === mask) finish(false);
      });
      document.body.appendChild(mask);
    });
  }

  function askFolderDrop() {
    return new Promise(function (resolve) {
      const mask = document.createElement("div");
      mask.className = "ask-mask";
      mask.innerHTML =
        '<div class="ask-card" role="dialog" aria-modal="true">' +
        "<p>將資料夾丟掉?</p>" +
        '<div class="ask-actions"><button type="button" class="ask-no">取消</button><button type="button" class="ask-yes">丟掉</button></div>' +
        "</div>";
      function finish(ok) {
        mask.remove();
        resolve(ok);
      }
      mask.querySelector(".ask-no").addEventListener("click", function () {
        finish(false);
      });
      mask.querySelector(".ask-yes").addEventListener("click", function () {
        finish(true);
      });
      mask.addEventListener("click", function (ev) {
        if (ev.target === mask) finish(false);
      });
      document.body.appendChild(mask);
    });
  }

  function folderPost(body) {
    return call("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ person: currentPerson }, body)),
    }).then(function (res) {
      if (!res.ok) throw new Error("bad");
      return res.json();
    });
  }

  function bindFolderTile(a, item) {
    if (item.kind === "folder") {
      let press = 0;
      let sx = 0;
      let sy = 0;
      let fromHold = false;
      function clearPress() {
        if (press) {
          window.clearTimeout(press);
          press = 0;
        }
      }
      a.addEventListener("pointerdown", function (ev) {
        if (ev.button && ev.button !== 0) return;
        sx = ev.clientX;
        sy = ev.clientY;
        fromHold = false;
        clearPress();
        press = window.setTimeout(function () {
          press = 0;
          fromHold = true;
          if (selecting) toggleSelect(item, a);
          else enterSelect(item, a);
        }, 400);
      });
      a.addEventListener("pointermove", function (ev) {
        if (!press) return;
        if (Math.abs(ev.clientX - sx) > 14 || Math.abs(ev.clientY - sy) > 14) clearPress();
      });
      a.addEventListener("pointerup", clearPress);
      a.addEventListener("pointercancel", clearPress);
      ["contextmenu", "selectstart", "dragstart"].forEach(function (name) {
        a.addEventListener(name, function (ev) {
          ev.preventDefault();
        });
      });
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (fromHold) {
          fromHold = false;
          return;
        }
        if (selecting) {
          toggleSelect(item, a);
          return;
        }
        window.FamilyFeed.start(currentPerson, item.tag_ids || [], {
          folderId: item.id,
          fromClass: true,
        });
      });
      return;
    }
    a.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (selecting) return;
      if (item.kind === "add") {
        if (window.FamilyTags && window.FamilyTags.openFolderCard) {
          window.FamilyTags.openFolderCard(null);
        }
        return;
      }
      if (item.kind === "videos") {
        window.FamilyFeed.start(currentPerson, [], { video: true, fromClass: true });
        return;
      }
      if (item.kind === "qr") {
        window.FamilyFeed.start(currentPerson, [QR_ANY], { fromClass: true });
        return;
      }
      window.FamilyFeed.start(currentPerson, [], { fav: true, fromClass: true });
    });
  }

  function folderTitleText(title) {
    const max = window.matchMedia("(max-width: 560px)").matches ? 5 : 15;
    const s = String(title || "");
    if (s.length <= max) return s;
    return s.slice(0, max) + "...";
  }

  function folderTile(item) {
    const a = document.createElement("div");
    a.className = "tile";
    a.setAttribute("role", "button");
    a.tabIndex = 0;
    a.dataset.key = itemKey(item);
    const shield = document.createElement("span");
    shield.className = "tile-shield";
    if (item.kind === "add") {
      a.classList.add("tile-add");
      const mark = document.createElement("span");
      mark.className = "tile-plus";
      mark.innerHTML = PLUS;
      a.appendChild(mark);
      a.appendChild(shield);
      bindFolderTile(a, item);
      return a;
    }
    if (item.cover && item.cover.rel) {
      const img = document.createElement("img");
      img.decoding = "async";
      img.alt = "";
      img.draggable = false;
      watchThumb(img, item.cover, "tile", true);
      a.appendChild(img);
    }
    if (item.kind === "fav") {
      const heart = document.createElement("span");
      heart.className = "tile-heart";
      heart.innerHTML = HEART;
      a.appendChild(heart);
    }
    const ep = document.createElement("span");
    ep.className = "tile-ep";
    ep.textContent =
      item.kind === "fav"
        ? "最愛"
        : item.kind === "videos"
          ? "影片"
          : item.kind === "qr"
            ? "QR code"
            : folderTitleText(item.title || "");
    a.appendChild(ep);
    a.appendChild(shield);
    if (item.kind === "folder") markTile(a, selecting && picked[a.dataset.key]);
    bindFolderTile(a, item);
    return a;
  }

  function startFolderWall(person) {
    const feed = document.getElementById("feed");
    const sentinel = document.getElementById("feed-sentinel");
    const hint = document.getElementById("feed-hint");
    if (!feed || !person) return;
    const my = ++run;
    folderWall = true;
    folderId = "";
    fromClass = true;
    trashMode = false;
    favMode = false;
    videoMode = false;
    currentPerson = person;
    currentTags = [];
    currentScope = "";
    document.documentElement.classList.remove("trash-open");
    feed.dataset.person = person;
    feed.dataset.folders = "1";
    feed.dataset.tags = "";
    feed.dataset.q = "";
    feed.dataset.qr = "";
    feed.dataset.fav = "";
    feed.dataset.video = "";
    feed.dataset.trash = "";
    feed.classList.remove("is-trash");
    if (window.thumbObserver) {
      window.thumbObserver.disconnect();
      window.thumbObserver = null;
    }
    thumbWait.length = 0;
    dropBlobs();
    clearSelect();
    feed.innerHTML = "";
    if (sentinel) sentinel.hidden = true;
    if (hint) hint.hidden = true;
    afterThumbs = function () {};
    paintHint = function () {};
    tellSelect();
    call("/api/folders?person=" + encodeURIComponent(person))
      .then(function (res) {
        if (!res.ok) throw new Error("bad");
        return res.json();
      })
      .then(function (payload) {
        if (my !== run || !folderWall) return;
        nextFolderTitle = payload.next_title || "新資料夾1";
        feed.innerHTML = "";
        feed.appendChild(folderTile({ kind: "fav", id: "fav", cover: payload.fav_cover || null }));
        feed.appendChild(
          folderTile({ kind: "videos", id: "videos", cover: payload.video_cover || null })
        );
        if (payload.has_qr) {
          feed.appendChild(
            folderTile({ kind: "qr", id: "qr", cover: payload.qr_cover || null })
          );
        }
        (payload.folders || []).forEach(function (row) {
          feed.appendChild(
            folderTile({
              kind: "folder",
              id: row.id,
              title: row.title,
              tag_ids: row.tag_ids || [],
              cover: row.cover || null,
            })
          );
        });
        feed.appendChild(folderTile({ kind: "add", id: "add" }));
        paintWorkTile();
      })
      .catch(function () {
        if (my !== run) return;
        feed.innerHTML = "";
        const empty = document.createElement("p");
        empty.className = "feed-empty";
        empty.textContent = "分類還沒讀到，請再試一次。";
        feed.appendChild(empty);
      });
  }

  function downloadName(item, mime) {
    let name = String(item.rel || "photo").split(/[/\\]/).pop() || "photo";
    mime = String(mime || "");
    if (/\.hei[cf]$/i.test(name) && mime.indexOf("jpeg") >= 0) {
      name = name.replace(/\.hei[cf]$/i, ".jpg");
    }
    if (item.kind === "video" && mime.indexOf("mp4") >= 0 && /\.(mov|m4v)$/i.test(name)) {
      name = name.replace(/\.(mov|m4v)$/i, ".mp4");
    }
    return name;
  }

  function blobFile(item) {
    return fetch(qs(item, "full"))
      .then(function (res) {
        if (!res.ok) throw new Error("bad");
        return res.blob();
      })
      .then(function (blob) {
        const mime = blob.type || (item.kind === "video" ? "video/mp4" : "image/jpeg");
        return new File([blob], downloadName(item, mime), { type: mime });
      })
      .catch(function () {
        return null;
      });
  }

  function clickDownload(file) {
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(href);
    }, 8000);
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function saveItems(items) {
    if (!items.length) return Promise.resolve();
    const batch = items.length <= 8;
    note(items.length > 1 ? "正在下載 1 / " + items.length : "正在下載…");
    function shareOrSave(files) {
      if (!files.length) {
        note("現在下載不了，請再試一次");
        return Promise.resolve();
      }
      if (navigator.canShare && navigator.canShare({ files: files })) {
        return navigator.share({ files: files }).then(
          function () {
            note(files.length > 1 ? "已送出 " + files.length + " 張" : "已送出");
            clearSelect();
          },
          function (err) {
            if (err && err.name === "AbortError") {
              note("");
              return;
            }
            files.forEach(clickDownload);
            note(files.length > 1 ? "已下載 " + files.length + " 張" : "已下載");
            clearSelect();
          }
        );
      }
      files.forEach(clickDownload);
      note(files.length > 1 ? "已下載 " + files.length + " 張" : "已下載");
      clearSelect();
      return Promise.resolve();
    }
    if (batch) {
      const files = [];
      let chain = Promise.resolve();
      items.forEach(function (item, i) {
        chain = chain.then(function () {
          note("正在下載 " + (i + 1) + " / " + items.length);
          return blobFile(item).then(function (file) {
            if (file) files.push(file);
          });
        });
      });
      return chain.then(function () {
        return shareOrSave(files);
      });
    }
    let chain = Promise.resolve();
    let saved = 0;
    items.forEach(function (item, i) {
      chain = chain.then(function () {
        note("正在下載 " + (i + 1) + " / " + items.length);
        return blobFile(item).then(function (file) {
          if (!file) return;
          clickDownload(file);
          saved += 1;
          return wait(400);
        });
      });
    });
    return chain.then(function () {
      note(saved ? "已下載 " + saved + " 張" : "現在下載不了，請再試一次");
      if (saved) clearSelect();
    });
  }

  function tagPost(body) {
    if (window.FamilyTags && window.FamilyTags.act) return window.FamilyTags.act(body);
    return call("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error("bad");
      return res.json();
    });
  }

  function displayBox(nw, nh) {
    nw = Number(nw) || 0;
    nh = Number(nh) || 0;
    if (nw < 8 || nh < 8) {
      nw = 1600;
      nh = 1067;
    }
    const need = Math.max(window.innerWidth || 0, window.innerHeight || 0);
    const edge = Math.max(nw, nh);
    if (need && edge < need) {
      const k = need / edge;
      return { w: Math.round(nw * k), h: Math.round(nh * k) };
    }
    return { w: nw, h: nh };
  }

  function sameShape(slide, nw, nh) {
    if (!slide || !slide.width || !slide.height || !nw || !nh) return false;
    return Math.abs(slide.width / slide.height - nw / nh) < 0.01;
  }

  function rememberShape(slide, nw, nh) {
    const box = displayBox(nw, nh);
    if (!slide) return box;
    slide.width = box.w;
    slide.height = box.h;
    if (slide.familyItem) {
      slide.familyItem.w = nw;
      slide.familyItem.h = nh;
    }
    return box;
  }

  // Grid tiles keep the real aspect. Index may not have w/h for older shots, and
  // the 3:2 fallback is what stretched those photos in PhotoSwipe.
  function refreshSlideShape(slide) {
    if (!slide || slide.html) return;
    const img = slide.element && slide.element.querySelector && slide.element.querySelector("img");
    if (!img || img.naturalWidth < 8 || img.naturalHeight < 8) return;
    if (sameShape(slide, img.naturalWidth, img.naturalHeight)) return;
    rememberShape(slide, img.naturalWidth, img.naturalHeight);
  }

  function applySlideSize(content, nw, nh) {
    if (!content) return;
    const box = rememberShape(content.data, nw, nh);
    content.width = box.w;
    content.height = box.h;
    const slide = content.slide;
    if (!slide) return;
    slide.width = box.w;
    slide.height = box.h;
    // Opening animation still owns zoom. Store the real shape and wait.
    if (!openAnimDone) return;
    // slide.resize() skips redraw when currZoomLevel !== the *new* initial,
    // which is exactly the missing-dims case: guessed 3:2, then the JPEG arrives.
    if (typeof slide.calculateSize === "function") slide.calculateSize();
    slide.currentResolution = 0;
    if (typeof slide.zoomAndPanToInitial === "function") slide.zoomAndPanToInitial();
    if (typeof slide.applyCurrentZoomPan === "function") slide.applyCurrentZoomPan();
    if (typeof slide.updateContentSize === "function") slide.updateContentSize(true);
  }

  function fitContentToImage(content) {
    const el = content && content.element;
    if (!el || el.tagName !== "IMG" || el.classList.contains("pswp__img--placeholder")) return;
    if (!el.naturalWidth || !el.naturalHeight) return;
    if (sameShape(content.slide || content.data, el.naturalWidth, el.naturalHeight)) return;
    applySlideSize(content, el.naturalWidth, el.naturalHeight);
  }

  function monthLabel(group) {
    const m = /^(\d{4})-(\d{2})$/.exec(group || "");
    if (!m) return group || "";
    return m[1] + "年" + Number(m[2]) + "月";
  }

  function slideFor(item, tile) {
    const tileUrl = qs(item, "thumb", "tile");
    // Index w/h when known; otherwise a 3:2 guess until the tile or JPEG corrects it.
    const box = displayBox(item.w, item.h);
    if (item.kind === "video") {
      const src = qs(item, "media");
      return {
        html:
          '<div class="pswp-video"><video controls playsinline webkit-playsinline preload="auto" poster="' +
          tileUrl.replace(/"/g, "") +
          '" src="' +
          src.replace(/"/g, "") +
          '"></video></div>',
        msrc: tileUrl,
        width: box.w,
        height: box.h,
        element: tile,
        familyItem: item,
      };
    }
    return {
      src: qs(item, "media"),
      msrc: tileUrl,
      width: box.w,
      height: box.h,
      alt: item.who,
      element: tile,
      thumbCropped: true,
      familyItem: item,
    };
  }

  let openAnimDone = false;
  let revealedIndex = -1;
  let waitGen = 0;
  let waitTimer = 0;
  let waitArmedFor = -1;
  let waitShownFor = -1;

  function pswpRoot() {
    return lightbox && lightbox.pswp && lightbox.pswp.element;
  }

  let uiOff = false;

  function applyViewerUi() {
    const root = pswpRoot();
    if (root) root.classList.toggle("is-ui-off", uiOff);
    document.documentElement.classList.toggle("is-ui-off", uiOff);
  }

  function resetViewerUi() {
    uiOff = false;
    applyViewerUi();
  }

  // PhotoSwipe already drops drag, pinch, and double-tap zoom before this runs.
  function onViewerTap(_point, originalEvent) {
    if (!viewing) return;
    if (document.documentElement.classList.contains("kb-up")) return;
    const target = originalEvent && originalEvent.target;
    if (target && target.closest && target.closest(".pswp-face, button, input, textarea, a, video")) {
      return;
    }
    uiOff = !uiOff;
    applyViewerUi();
  }

  function hideViewerChrome() {
    const root = pswpRoot();
    if (root) root.classList.add("is-chrome-off");
  }

  function stopMediaWait() {
    waitGen += 1;
    waitArmedFor = -1;
    waitShownFor = -1;
    if (waitTimer) {
      window.clearTimeout(waitTimer);
      waitTimer = 0;
    }
    const root = pswpRoot();
    const el = root && root.querySelector(".pswp-media-wait");
    if (el) el.hidden = true;
  }

  function ensureMediaWait() {
    const root = pswpRoot();
    if (!root) return null;
    let el = root.querySelector(".pswp-media-wait");
    if (el) return el;
    el = document.createElement("div");
    el.className = "pswp-media-wait";
    el.hidden = true;
    const rose = document.createElement("div");
    rose.className = "rose-two";
    const msg = document.createElement("p");
    msg.className = "pswp-media-wait-msg";
    msg.textContent = "準備中...";
    el.appendChild(rose);
    el.appendChild(msg);
    root.appendChild(el);
    return el;
  }

  function armMediaWait() {
    const pswp = lightbox && lightbox.pswp;
    const index = pswp ? pswp.currIndex : -1;
    if (index === revealedIndex || waitShownFor === index) return;
    if (waitArmedFor === index && waitTimer) return;
    if (waitArmedFor !== index) {
      const hold = ensureMediaWait();
      if (hold) hold.hidden = true;
    }
    waitArmedFor = index;
    if (waitTimer) window.clearTimeout(waitTimer);
    const gen = ++waitGen;
    waitTimer = window.setTimeout(function () {
      waitTimer = 0;
      if (gen !== waitGen || revealedIndex === index) return;
      const node = ensureMediaWait();
      if (node) {
        const rose = node.querySelector(".rose-two");
        if (window.RoseTwo && window.RoseTwo.mount) window.RoseTwo.mount(rose);
        node.hidden = false;
        waitShownFor = index;
      }
    }, 1200);
  }

  function currentMediaReady() {
    const pswp = lightbox && lightbox.pswp;
    if (!pswp || !pswp.currSlide) return false;
    const content = pswp.currSlide.content;
    if (!content) return false;
    if (typeof content.isError === "function" && content.isError()) return true;
    const data = content.data || {};
    if (data.html) {
      const el = content.element;
      const video = el && el.querySelector && el.querySelector("video");
      if (!video) return false;
      return video.readyState >= 2 && video.videoWidth > 0;
    }
    const el = content.element;
    if (!el || el.tagName !== "IMG") return false;
    if (el.classList.contains("pswp__img--placeholder")) return false;
    return !!(el.complete && el.naturalWidth);
  }

  function revealViewer() {
    stopMediaWait();
    const root = pswpRoot();
    if (root) root.classList.remove("is-chrome-off");
    viewing = true;
    applyViewerUi();
    tellSelect();
    if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
  }

  function syncViewerMedia() {
    const pswp = lightbox && lightbox.pswp;
    if (!pswp) return;
    const index = pswp.currIndex;
    if (index === revealedIndex) return;
    if (!openAnimDone || !currentMediaReady()) {
      hideViewerChrome();
      armMediaWait();
      return;
    }
    revealedIndex = index;
    revealViewer();
  }

  function bindVideoWait(video) {
    if (!video || video.dataset.waitBound) return;
    video.dataset.waitBound = "1";
    ["loadeddata", "canplay", "playing"].forEach(function (name) {
      video.addEventListener(name, syncViewerMedia);
    });
  }

  function playVideo(video) {
    if (!video) return;
    video.playsInline = true;
    const play = video.play();
    if (play && play.catch) play.catch(function () {});
  }

  function ensureLightbox() {
    if (lightbox || !window.PhotoSwipeLightbox || !window.PhotoSwipe) return lightbox;
    lightbox = new window.PhotoSwipeLightbox({
      pswpModule: window.PhotoSwipe,
      loop: false,
      bgOpacity: 0.92,
      errorMsg: "目前無法載入",
      clickToCloseNonZoomable: false,
      imageClickAction: onViewerTap,
      tapAction: onViewerTap,
      maxZoomLevel: 12,
    });
    lightbox.addFilter("isContentZoomable", function (zoomable, content) {
      if (content && content.data && content.data.html) return true;
      return zoomable;
    });
    lightbox.addFilter("numItems", function () {
      return lightbox._slides ? lightbox._slides.length : 0;
    });
    lightbox.addFilter("itemData", function (itemData, index) {
      return (lightbox._slides && lightbox._slides[index]) || itemData;
    });
    lightbox.on("contentActivate", function (evt) {
      fitContentToImage(evt.content);
      const el = evt.content && evt.content.element;
      const video = el && el.querySelector && el.querySelector("video");
      if (video && !video.getAttribute("src") && video.getAttribute("data-src")) {
        video.src = video.getAttribute("data-src");
      }
      if (video) {
        bindVideoWait(video);
        playVideo(video);
        const content = evt.content;
        function sizeVid() {
          if (!video.videoWidth) return;
          if (sameShape(content.slide, video.videoWidth, video.videoHeight)) return;
          applySlideSize(content, video.videoWidth, video.videoHeight);
        }
        if (video.videoWidth) sizeVid();
        else video.addEventListener("loadedmetadata", sizeVid, { once: true });
      }
      if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
      syncViewerMedia();
    });
    lightbox.on("contentDeactivate", function (evt) {
      const el = evt.content && evt.content.element;
      const video = el && el.querySelector && el.querySelector("video");
      if (video) video.pause();
    });
    lightbox.on("contentLoad", function (evt) {
      const el = evt.content && evt.content.element;
      const video = el && el.querySelector && el.querySelector("video[data-src]");
      if (!video) return;
      if (!video.getAttribute("src")) {
        video.src = video.getAttribute("data-src");
        video.load();
      }
    });
    lightbox.on("loadComplete", function (evt) {
      fitContentToImage(evt.content);
      if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
      const curr = lightbox.pswp && lightbox.pswp.currSlide;
      if (curr && evt.content && curr.content === evt.content) syncViewerMedia();
    });
    lightbox.on("loadError", function () {
      openAnimDone = true;
      const pswp = lightbox.pswp;
      if (pswp) revealedIndex = pswp.currIndex;
      revealViewer();
    });
    lightbox.on("close", function () {
      viewing = false;
      openAnimDone = false;
      revealedIndex = -1;
      resetViewerUi();
      stopMediaWait();
      document.querySelectorAll(".pswp-video video").forEach(function (v) {
        v.pause();
      });
      if (window.FamilyTags) window.FamilyTags.closePhoto();
      tellSelect();
    });
    lightbox.on("openingAnimationStart", function () {
      openAnimDone = false;
      revealedIndex = -1;
      viewing = false;
      resetViewerUi();
      hideViewerChrome();
      armMediaWait();
      tellSelect();
    });
    lightbox.on("openingAnimationEnd", function () {
      openAnimDone = true;
      const curr = lightbox.pswp && lightbox.pswp.currSlide;
      if (curr) fitContentToImage(curr.content);
      syncViewerMedia();
      if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
    });
    lightbox.on("afterInit", function () {
      viewing = false;
      openAnimDone = false;
      revealedIndex = -1;
      hideViewerChrome();
      armMediaWait();
      tellSelect();
      const pswp = lightbox.pswp;
      if (!pswp) return;
      window.setTimeout(function () {
        if (!lightbox.pswp || openAnimDone) return;
        openAnimDone = true;
        const curr = lightbox.pswp.currSlide;
        if (curr) fitContentToImage(curr.content);
        syncViewerMedia();
      }, 500);
      pswp.on("resize", function () {
        if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
      });
      pswp.on("imageSizeChange", function () {
        if (window.FamilyTags && window.FamilyTags.layoutFaces) window.FamilyTags.layoutFaces();
      });
      pswp.on("resolutionChanged", function () {
        if (window.FamilyTags && window.FamilyTags.syncFaceZoom) window.FamilyTags.syncFaceZoom();
      });
      pswp.on("zoomPanUpdate", function () {
        if (window.FamilyTags && window.FamilyTags.syncFaceZoom) window.FamilyTags.syncFaceZoom();
      });
    });
    lightbox.on("change", function () {
      if (!lightbox.pswp || !lightbox._slides) return;
      document.querySelectorAll(".pswp-video video").forEach(function (v) {
        const item = v.closest(".pswp__item");
        const on = item && item.getAttribute("aria-hidden") !== "true";
        if (!on) v.pause();
      });
      if (lightbox.pswp.currIndex >= lightbox._slides.length - 5 && lightbox._nearEnd) {
        lightbox._nearEnd();
      }
      if (!openAnimDone || !currentMediaReady()) {
        hideViewerChrome();
        armMediaWait();
      }
      const slide = lightbox._slides[lightbox.pswp.currIndex];
      if (window.FamilyTags && slide && slide.familyItem) {
        if (window.FamilyTags.beforePhotoChange) window.FamilyTags.beforePhotoChange();
        window.FamilyTags.showPhoto(slide.familyItem);
      }
      syncViewerMedia();
      tellSelect();
    });
    lightbox.init();
    return lightbox;
  }

  window.FamilyFeed = {
    start: function (person, tagIds, opts) {
      const feed = document.getElementById("feed");
      const sentinel = document.getElementById("feed-sentinel");
      const hint = document.getElementById("feed-hint");
      if (!feed || !person) return;
      if (opts && opts.folders) {
        startFolderWall(person);
        return;
      }
      folderWall = false;
      folderId = (opts && opts.folderId) || "";
      fromClass = !!(opts && (opts.fromClass || opts.folderId));
      feed.dataset.folders = "";
      tagIds = normalizedTags(tagIds);
      const pins = (opts && opts.pin) || [];
      const my = ++run;
      let offset = 0;
      let total = 0;
      let loading = false;
      let lastGroup = "";
      let headBusy = false;
      const slides = [];
      const loadedItems = [];
      if (window.thumbObserver) {
        window.thumbObserver.disconnect();
        window.thumbObserver = null;
      }
      thumbWait.length = 0;
      dropBlobs();
      feed.innerHTML = "";
      feed.dataset.person = person;
      const parts = splitTokens(tagIds);
      if (opts && opts.scope != null) currentScope = opts.scope || "";
      else if (!parts.q && !parts.hasQr) currentScope = "";
      feed.dataset.tags = parts.tags.join(",");
      feed.dataset.q = parts.q || "";
      feed.dataset.qr = parts.hasQr ? "1" : "";
      feed.dataset.scope = currentScope;
      currentPerson = person;
      currentTags = tagIds;
      trashMode = !!(opts && opts.trash);
      favMode = !!(opts && opts.fav) && !trashMode;
      videoMode = !!(opts && opts.video) && !trashMode && !favMode;
      document.documentElement.classList.toggle("trash-open", trashMode);
      feed.dataset.trash = trashMode ? "1" : "";
      feed.dataset.fav = favMode ? "1" : "";
      feed.dataset.video = videoMode ? "1" : "";
      feed.classList.toggle("is-trash", trashMode);
      if (
        !trashMode &&
        !(opts && (opts.fav || opts.video || opts.folderId || opts.fromClass)) &&
        window.FamilyTags &&
        window.FamilyTags.setApplied
      ) {
        window.FamilyTags.setApplied(tagIds);
      }
      if (!opts || !opts.keepSelect) clearSelect();
      if (trashMode || fromClass) {
        const bar = document.createElement("div");
        bar.className = "trash-bar";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "ins-icon nav-back";
        back.setAttribute("aria-label", trashMode ? "返回相簿" : "返回分類");
        back.innerHTML =
          '<span class="ins-ring"></span><span class="ins-face"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5M8.5 12H20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        back.addEventListener("click", function () {
          if (trashMode) window.FamilyFeed.closeTrash();
          else window.FamilyFeed.closeFolder();
        });
        bar.appendChild(back);
        feed.appendChild(bar);
      }
      const viewId = snapId(person, tagIds, trashMode, favMode, currentScope, videoMode);
      if (pins.length) {
        delete feedSnaps[viewId];
        try {
          localStorage.removeItem(FEED_STORE + viewId);
        } catch (e) {}
      }

      function showHint() {
        if (!hint || my !== run) return;
        hint.hidden = !(loading && !feed.querySelector(".tile"));
      }
      paintHint = showHint;

      const lb = ensureLightbox();
      if (lb) {
        lb._slides = slides;
        lb._nearEnd = function () {
          loadMore();
        };
      }

      function tile(item, index) {
        item.trash = trashMode;
        const a = document.createElement("div");
        a.className = "tile" + (item.kind === "video" ? " is-video" : "");
        a.setAttribute("role", "button");
        a.tabIndex = 0;
        a.dataset.key = itemKey(item);
        const img = document.createElement("img");
        img.decoding = "async";
        img.alt = "";
        img.draggable = false;
        watchThumb(img, item, "tile", index < FIRST);
        const shield = document.createElement("span");
        shield.className = "tile-shield";
        a.appendChild(img);
        a.appendChild(shield);
        if (item.favorite && !trashMode) {
          const heart = document.createElement("span");
          heart.className = "tile-heart";
          heart.innerHTML = HEART;
          a.appendChild(heart);
        }
        markTile(a, selecting && picked[a.dataset.key]);
        let press = 0;
        let sx = 0;
        let sy = 0;
        let fromHold = false;
        function clearPress() {
          if (press) {
            window.clearTimeout(press);
            press = 0;
          }
        }
        a.addEventListener("pointerdown", function (ev) {
          if (trashMode) return;
          if (ev.button && ev.button !== 0) return;
          sx = ev.clientX;
          sy = ev.clientY;
          fromHold = false;
          clearPress();
          press = window.setTimeout(function () {
            press = 0;
            fromHold = true;
            if (selecting) toggleSelect(item, a);
            else enterSelect(item, a);
          }, 400);
        });
        a.addEventListener("pointermove", function (ev) {
          if (!press) return;
          if (Math.abs(ev.clientX - sx) > 14 || Math.abs(ev.clientY - sy) > 14) clearPress();
        });
        a.addEventListener("pointerup", clearPress);
        a.addEventListener("pointercancel", clearPress);
        ["contextmenu", "selectstart", "dragstart"].forEach(function (name) {
          a.addEventListener(name, function (ev) {
            ev.preventDefault();
          }, true);
        });
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (fromHold) {
            return;
          }
          if (selecting) {
            toggleSelect(item, a);
            return;
          }
          if (!lb) return;
          slides.forEach(refreshSlideShape);
          lb._slides = slides;
          lb.loadAndOpen(index);
          if (item.kind === "video") {
            playVideo(document.querySelector(".pswp-video video"));
          }
        });
        return a;
      }

      function mergeFront(items) {
        const seen = {};
        const out = [];
        (pins || []).concat(items || []).forEach(function (item) {
          if (!item || !item.rel) return;
          const k = itemKey(item);
          if (seen[k]) return;
          seen[k] = true;
          out.push(item);
        });
        return out;
      }

      function appendItems(items) {
        (items || []).forEach(function (item) {
          if (!item || !item.rel) return;
          const k = itemKey(item);
          if (loadedItems.some(function (it) { return itemKey(it) === k; })) return;
          loadedItems.push(item);
          if (item.group && item.group !== lastGroup) {
            lastGroup = item.group;
            const h = document.createElement("p");
            h.className = "feed-month";
            h.textContent = monthLabel(item.group);
            feed.appendChild(h);
          }
          const index = slides.length;
          const a = tile(item, index);
          slides.push(slideFor(item, a));
          feed.appendChild(a);
        });
        paintWorkTile();
      }

      function clearTiles() {
        lastGroup = "";
        loadedItems.length = 0;
        slides.length = 0;
        feed.querySelectorAll(".tile:not([data-work]), .feed-month, .feed-empty").forEach(function (el) {
          el.remove();
        });
      }

      function paintEmpty() {
        const empty = document.createElement("p");
        empty.className = "feed-empty";
        empty.textContent = trashMode
          ? "垃圾桶是空的。"
          : favMode
            ? "還沒有最愛。"
            : fromClass
              ? "這個資料夾還沒有照片。"
              : feed.dataset.q || feed.dataset.qr || (feed.dataset.tags || "").length
                ? "沒有照片。"
                : "這個櫃子還沒有照片。";
        if (!trashMode) {
          feed.querySelectorAll(".tile:not([data-work]), .feed-month, .feed-empty").forEach(function (el) {
            el.remove();
          });
        }
        feed.appendChild(empty);
        paintWorkTile();
      }

      function sentinelNear() {
        if (!sentinel || sentinel.hidden) return false;
        const box = sentinel.getBoundingClientRect();
        return box.top < (window.innerHeight || 0) + 1600;
      }

      afterThumbs = function () {
        if (my !== run) return;
        if (sentinelNear()) loadMore();
      };

      async function refreshHead() {
        if (my !== run) return;
        headBusy = true;
        try {
          const res = await call(photosPath(person, 0, FIRST, trashMode, favMode));
          const data = await res.json();
          if (my !== run) return;
          total = data.total;
          const fresh = data.items || [];
          const shown = pins.length ? mergeFront(fresh) : fresh;
          if (!sameHead(loadedItems, shown, shown.length || FIRST)) {
            clearTiles();
            appendItems(shown);
            offset = fresh.length;
            if (!loadedItems.length) paintEmpty();
          }
          writeSnap(viewId, total, loadedItems);
          if (sentinelNear()) loadMore();
        } catch (err) {
        } finally {
          headBusy = false;
        }
      }

      async function loadMore() {
        if (loading || headBusy || my !== run) return;
        if (total && offset >= total) return;
        if (offset && thumbsBusy()) return;
        loading = true;
        showHint();
        try {
          const res = await call(
            photosPath(person, offset, offset ? LIMIT : FIRST, trashMode, favMode)
          );
          const data = await res.json();
          if (my !== run) return;
          total = data.total;
          const page = data.items || [];
          if (!offset && pins.length) appendItems(mergeFront(page));
          else appendItems(page);
          offset += page.length;
          if (!page.length) {
            total = Math.max(Number(total) || 0, loadedItems.length);
            offset = Math.max(offset, total);
          }
          if (!loadedItems.length) paintEmpty();
          writeSnap(viewId, total, loadedItems);
        } catch (err) {
          if (my !== run) return;
          if (!offset) {
            const empty = document.createElement("p");
            empty.className = "feed-empty is-offline";
            empty.textContent = "維護中,請5分鐘後再試";
            feed.querySelectorAll(".tile:not([data-work]), .feed-month, .feed-empty").forEach(function (el) {
              el.remove();
            });
            feed.appendChild(empty);
            paintWorkTile();
          }
        } finally {
          loading = false;
          showHint();
          if (
            my === run &&
            offset &&
            !(total && offset >= total) &&
            sentinelNear()
          ) {
            loadMore();
          }
        }
      }

      const snap = readSnap(viewId);
      if (!pins.length && snap && snap.items && snap.items.length) {
        appendItems(snap.items);
        offset = loadedItems.length;
      }

      if (window.feedObserver) window.feedObserver.disconnect();
      if (sentinel) {
        sentinel.hidden = false;
        window.feedObserver = new IntersectionObserver(
          function (entries) {
            if (entries.some(function (e) { return e.isIntersecting; })) loadMore();
          },
          { rootMargin: "600px 0px" }
        );
        window.feedObserver.observe(sentinel);
      }
      showHint();
      paintWorkTile();
      if (offset) refreshHead();
      else loadMore();
    },
    filter: function (tagIds, opts) {
      const person = (document.getElementById("feed") || {}).dataset.person;
      const next = normalizedTags(tagIds);
      if (!person || trashMode) return;
      const force = !!(opts && opts.force);
      const fav = !!(opts && opts.fav);
      const scope = opts && opts.scope != null ? opts.scope : currentScope;
      if (folderWall || folderId || fromClass) {
        folderWall = false;
        folderId = "";
        fromClass = false;
        window.FamilyFeed.start(person, next, { fav: fav, scope: scope });
        return;
      }
      if (
        !force &&
        person === currentPerson &&
        tagKey(next) === tagKey(currentTags) &&
        fav === favMode &&
        scope === currentScope
      ) {
        return;
      }
      if (force) {
        const viewId = snapId(person, next, trashMode, fav, scope, false);
        delete feedSnaps[viewId];
        try {
          localStorage.removeItem(FEED_STORE + viewId);
        } catch (e) {}
      }
      window.FamilyFeed.start(person, next, { fav: fav, scope: scope });
    },
    refresh: function () {
      if (!currentPerson) return;
      if (lightbox && lightbox.pswp) lightbox.pswp.close();
      window.FamilyFeed.start(currentPerson, currentTags, {
        trash: trashMode,
        fav: favMode,
        video: videoMode,
        scope: currentScope,
        fromClass: fromClass,
        folderId: folderId,
      });
    },
    prepareAction: function () {
      return prepareAction();
    },
    trashSelected: function () {
      if (trashMode) return Promise.resolve();
      if (folderWall) {
        const folders = targetItems().filter(function (it) {
          return it.kind === "folder";
        });
        if (!folders.length) {
          prepareAction();
          return Promise.resolve();
        }
        return askFolderDrop().then(function (ok) {
          if (!ok) return;
          const ids = folders.map(function (it) {
            return it.id;
          });
          window.FamilyBusy.start(ids.length > 1 ? "正在丟掉資料夾…" : "正在丟掉…");
          return folderPost({ op: "delete", ids: ids }).then(
            function () {
              window.FamilyBusy.done(ids.length > 1 ? "已丟掉 " + ids.length + " 個資料夾" : "已丟掉");
              startFolderWall(currentPerson);
            },
            function () {
              window.FamilyBusy.done("丟不掉，請再試一次");
            }
          );
        });
      }
      const rows = targetRows();
      if (!rows.length) {
        prepareAction();
        return Promise.resolve();
      }
      return askTrash().then(function (ok) {
        if (!ok) return;
      const chosen = {};
      targetItems().forEach(function (item) {
        chosen[itemKey(item)] = true;
      });
      const feed = document.getElementById("feed");
      const pulled = [];
      if (feed) {
        feed.querySelectorAll(".tile").forEach(function (a) {
          if (!chosen[a.dataset.key]) return;
          a.classList.add("is-gone");
          pulled.push(a);
        });
      }
      const open = viewingItem();
      if (open && chosen[itemKey(open)] && lightbox && lightbox.pswp) lightbox.pswp.close();
      clearSelect();
      window.FamilyBusy.start(rows.length > 1 ? "正在丟掉 " + rows.length + " 張…" : "正在丟掉…");
      return tagPost({
        action: "trash",
        person: currentPerson,
        photos: rows,
      }).then(
        function () {
          window.FamilyBusy.done(rows.length > 1 ? "已丟掉 " + rows.length + " 張" : "已丟掉");
        },
        function () {
          pulled.forEach(function (a) {
            a.classList.remove("is-gone");
          });
          window.FamilyBusy.done("丟不掉，請再試一次");
        }
      );
      });
    },
    tagSelected: function (choices) {
      if (trashMode) return Promise.resolve();
      const rows = targetRows();
      const list = Array.isArray(choices) ? choices : [choices];
      const ids = [];
      let fresh = "";
      const labels = [];
      list.forEach(function (choice) {
        if (choice && typeof choice === "object" && choice.id) {
          if (ids.indexOf(choice.id) < 0) ids.push(choice.id);
          labels.push(choice.label || choice.id);
          return;
        }
        const name = String(
          choice && typeof choice === "object" ? choice.label || "" : choice || ""
        )
          .trim()
          .replace(/^#/, "");
        if (!name) return;
        if (!fresh) fresh = name;
        labels.push(name);
      });
      if (!rows.length || (!ids.length && !fresh)) return Promise.resolve();
      const count = ids.length + (fresh ? 1 : 0);
      window.FamilyBusy.start(count > 1 ? "正在加上 " + count + " 個標籤…" : "正在加上 #" + labels[0] + "…");
      return tagPost({
        action: "attach_many",
        person: currentPerson,
        ids: ids,
        kind: "custom",
        label: fresh,
        photos: rows,
      }).then(
        function (payload) {
          clearSelect();
          if (window.FamilyTags && window.FamilyTags.accept) {
            window.FamilyTags.accept(payload);
          }
          if (window.FamilyTags && window.FamilyTags.refreshPhoto) {
            window.FamilyTags.refreshPhoto();
          }
          window.FamilyBusy.done(count > 1 ? "已加上 " + count + " 個標籤" : "已加上 #" + labels[0]);
          return payload;
        },
        function () {
          window.FamilyBusy.done("加不上，請再試一次");
          return null;
        }
      );
    },
    downloadSelected: function () {
      if (trashMode) return Promise.resolve();
      if (!prepareAction()) return Promise.resolve();
      return saveItems(targetItems());
    },
    toggleHeart: function () {
      if (trashMode) return Promise.resolve();
      const rows = targetRows();
      if (!rows.length) {
        prepareAction();
        return Promise.resolve();
      }
      const items = targetItems();
      const allOn = items.every(function (it) { return it.favorite; });
      return call("/api/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !allOn, photos: rows, person: currentPerson }),
      }).then(function (res) {
        if (!res.ok) throw new Error("fail");
        return res.json();
      }).then(function () {
        items.forEach(function (it) { it.favorite = !allOn; });
        if (favMode && allOn) {
          window.FamilyFeed.start(currentPerson, currentTags, { fav: true, keepSelect: false });
          return;
        }
        const feed = document.getElementById("feed");
        if (!feed) return;
        feed.querySelectorAll(".tile").forEach(function (a) {
          const hit = items.some(function (it) { return itemKey(it) === a.dataset.key; });
          if (!hit) return;
          const mark = a.querySelector(".tile-heart");
          if (!allOn && !mark) {
            const heart = document.createElement("span");
            heart.className = "tile-heart";
            heart.innerHTML = HEART;
            a.appendChild(heart);
          } else if (allOn && mark) {
            mark.remove();
          }
        });
        clearSelect();
      }).catch(function () {
        window.FamilyBusy.done("最愛沒加上，請再試一次");
      });
    },
    openTrash: function () {
      if (!currentPerson) return;
      if (lightbox && lightbox.pswp) lightbox.pswp.close();
      clearSelect();
      beforeTrashTags = currentTags.slice();
      window.FamilyFeed.start(currentPerson, [], { trash: true });
    },
    closeTrash: function () {
      if (!currentPerson) return;
      const tags = beforeTrashTags.slice();
      beforeTrashTags = [];
      window.FamilyFeed.start(currentPerson, tags);
    },
    showFolders: function (person) {
      startFolderWall(person || currentPerson);
    },
    closeFolder: function () {
      if (!currentPerson) return;
      startFolderWall(currentPerson);
    },
    isFolderWall: function () {
      return folderWall;
    },
    folderId: function () {
      return folderId;
    },
    selectedFolder: function () {
      const rows = targetItems().filter(function (it) {
        return it.kind === "folder";
      });
      return rows.length === 1 ? rows[0] : null;
    },
    nextFolderTitle: function () {
      return nextFolderTitle;
    },
    saveFolder: function (data) {
      const op = data && data.id ? "update" : "create";
      return folderPost({
        op: op,
        id: data && data.id,
        title: (data && data.title) || "",
        tag_ids: (data && data.tag_ids) || [],
      }).then(function () {
        startFolderWall(currentPerson);
      });
    },
    setFolderCover: function () {
      if (!folderId || folderWall || trashMode) return Promise.resolve();
      const items = targetItems().filter(function (it) {
        return it && it.rel;
      });
      if (!items.length) {
        prepareAction();
        return Promise.resolve();
      }
      const item = items[0];
      return folderPost({
        op: "cover",
        id: folderId,
        photos: [{ person: item.person, bucket: item.bucket, rel: item.rel }],
      }).then(
        function () {
          clearSelect();
        },
        function () {
          window.FamilyBusy.done("封面沒換上，請再試一次");
        }
      );
    },
    pswp: function () {
      return lightbox && lightbox.pswp;
    },
    syncTools: function () {
      tellSelect();
    },
    stop: function () {
      run += 1;
      paintHint = function () {};
      afterThumbs = function () {};
      currentPerson = "";
      trashMode = false;
      favMode = false;
      videoMode = false;
      folderWall = false;
      folderId = "";
      fromClass = false;
      document.documentElement.classList.remove("trash-open");
      beforeTrashTags = [];
      clearSelect();
      dropBlobs();
      if (window.thumbObserver) window.thumbObserver.disconnect();
      window.thumbObserver = null;
      if (window.feedObserver) window.feedObserver.disconnect();
      const sentinel = document.getElementById("feed-sentinel");
      const hint = document.getElementById("feed-hint");
      if (sentinel) sentinel.hidden = true;
      if (hint) hint.hidden = true;
      hideWorkTile();
    },
    showWork: function (opts) {
      paintWorkTile((opts && opts.phase) || "upload", opts && opts.percent);
    },
    updateWork: function (opts) {
      paintWorkTile((opts && opts.phase) || "upload", opts && opts.percent);
    },
    clearWork: clearWorkTile,
    isWorkActive: function () {
      return !!(workTile && workTile.parentNode);
    },
  };
})();
