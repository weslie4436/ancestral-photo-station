(function () {
  const BUCKET = "photos";
  const DELETE_ID = "media:delete";
  const KIND_TITLE = {
    time_year: "年",
    time_month: "月",
    place_country: "地點",
    place_city: "地點",
    event: "類型",
    media: "類型",
    custom: "自訂",
  };
  const KIND_ORDER = ["年", "月", "地點", "類型", "自訂"];
  const SHORTCUT_NAME = "Famiphoto備份";
  const IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, heic: 1, heif: 1 };
  const VIDEO_EXT = { mp4: 1, mov: 1, m4v: 1 };
  let on = false;
  let busy = false;
  let personId = "";
  let who = "";
  let files = {};
  let items = [];
  let seed = { photos: {}, tags: {}, favorites: [], cabinets: {}, deleted: {} };
  let overlay = emptyOverlay();
  let blobs = {};
  let seedFav = {};
  let waitMounted = false;

  function emptyOverlay() {
    return { favorites: {}, deleted: {}, restored: {}, photos: {}, tags: {}, folders: null };
  }

  function keyOf(rel) {
    return personId + "|" + BUCKET + "|" + rel;
  }

  function jsonRes(obj, status) {
    return Promise.resolve(
      new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  function parseQuery(path) {
    const q = path.indexOf("?");
    const search = q >= 0 ? path.slice(q + 1) : "";
    const base = q >= 0 ? path.slice(0, q) : path;
    return { base: base, params: new URLSearchParams(search) };
  }

  function readBody(opts) {
    if (!opts || !opts.body) return Promise.resolve({});
    if (typeof opts.body === "string") {
      try {
        return Promise.resolve(JSON.parse(opts.body));
      } catch (e) {
        return Promise.resolve({});
      }
    }
    return Promise.resolve({});
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open("famiphoto-drive", 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains("overlay")) db.createObjectStore("overlay");
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        resolve(null);
      };
    });
  }

  function loadOverlay() {
    return openDb().then(function (db) {
      if (!db || !personId) return;
      return new Promise(function (resolve) {
        const tx = db.transaction("overlay", "readonly");
        const req = tx.objectStore("overlay").get(personId);
        req.onsuccess = function () {
          const row = req.result;
          overlay = row && typeof row === "object" ? row : emptyOverlay();
          if (!overlay.favorites) overlay.favorites = {};
          if (!overlay.deleted) overlay.deleted = {};
          if (!overlay.restored) overlay.restored = {};
          if (!overlay.photos) overlay.photos = {};
          if (!overlay.tags) overlay.tags = {};
          resolve();
        };
        req.onerror = function () {
          overlay = emptyOverlay();
          resolve();
        };
      });
    });
  }

  function saveOverlay() {
    return openDb().then(function (db) {
      if (!db || !personId) return;
      return new Promise(function (resolve) {
        const tx = db.transaction("overlay", "readwrite");
        tx.objectStore("overlay").put(overlay, personId);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      });
    });
  }

  function dropBlobs() {
    Object.keys(blobs).forEach(function (k) {
      try {
        URL.revokeObjectURL(blobs[k]);
      } catch (e) {}
    });
    blobs = {};
  }

  function objectUrl(file) {
    if (!file) return "";
    const k = file.webkitRelativePath || file.name;
    if (!blobs[k]) blobs[k] = URL.createObjectURL(file);
    return blobs[k];
  }

  function findRoot(list) {
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const rel = String(list[i].webkitRelativePath || list[i].name || "").replace(/\\/g, "/");
      if (!/(^|\/)index\.json$/i.test(rel)) continue;
      const prefix = rel.replace(/index\.json$/i, "");
      if (best == null || prefix.length < best.length) best = prefix;
    }
    return best;
  }

  function stripRoot(rel, root) {
    rel = String(rel || "").replace(/\\/g, "/");
    if (root && rel.indexOf(root) === 0) return rel.slice(root.length);
    return rel;
  }

  function extOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  function kindOf(name) {
    const ext = extOf(name);
    if (IMAGE_EXT[ext]) return "image";
    if (VIDEO_EXT[ext]) return "video";
    return "";
  }

  function skipName(name) {
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".part") || lower.endsWith(".aae")) return true;
    if (lower.indexOf("-adjusted.") >= 0 || lower.indexOf("_hevc.") >= 0) return true;
    return false;
  }

  function groupOf(rel, mtime) {
    const parts = String(rel || "").split("/");
    if (
      parts.length >= 3 &&
      /^\d{4}$/.test(parts[0]) &&
      /^\d{1,2}$/.test(parts[1]) &&
      Number(parts[1]) >= 1 &&
      Number(parts[1]) <= 12
    ) {
      return parts[0] + "-" + ("0" + Number(parts[1])).slice(-2);
    }
    const dt = new Date(mtime * 1000);
    if (!isNaN(dt.getTime())) {
      return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2);
    }
    return "";
  }

  function fileAt() {
    for (let i = 0; i < arguments.length; i++) {
      const rel = arguments[i];
      if (rel && files[rel]) return files[rel];
    }
    return null;
  }

  function rowOf(it) {
    return {
      person: personId,
      who: who,
      bucket: BUCKET,
      rel: it.rel,
      kind: it.kind,
      group: it.group || "",
      w: it.w || 0,
      h: it.h || 0,
      thumb: it.thumb || "",
      favorite: isFav(keyOf(it.rel)),
    };
  }

  function catalog() {
    const out = Object.assign({}, seed.tags || {});
    Object.keys(overlay.tags || {}).forEach(function (id) {
      out[id] = overlay.tags[id];
    });
    return out;
  }

  function tagsFor(key) {
    const have = (seed.photos[key] || []).slice();
    const extra = overlay.photos[key] || [];
    extra.forEach(function (id) {
      if (id && have.indexOf(id) < 0) have.push(id);
    });
    return have.filter(function (id) {
      const drop = overlay.photos[key + ":drop"];
      return !(drop && drop.indexOf(id) >= 0);
    });
  }

  function isFav(key) {
    if (Object.prototype.hasOwnProperty.call(overlay.favorites, key)) {
      return !!overlay.favorites[key];
    }
    return !!seedFav[key];
  }

  function isGone(key) {
    if (overlay.restored[key]) return false;
    if (overlay.deleted[key]) return true;
    if (seed.deleted && seed.deleted[key]) return true;
    return tagsFor(key).indexOf(DELETE_ID) >= 0;
  }

  function foldersLive() {
    if (overlay.folders) return overlay.folders;
    const rows = ((seed.cabinets || {})[personId] || []).map(function (row) {
      return {
        id: row.id,
        title: row.title,
        tag_ids: (row.tag_ids || []).slice(),
        cover: row.cover || "",
      };
    });
    overlay.folders = rows;
    return rows;
  }

  function hitsTags(key, wanted) {
    if (!wanted.length) return true;
    const have = tagsFor(key);
    return wanted.every(function (tid) {
      return have.indexOf(tid) >= 0;
    });
  }

  function boardPayload(photoRel) {
    const counts = {};
    const cat = catalog();
    items.forEach(function (it) {
      const key = keyOf(it.rel);
      if (isGone(key)) return;
      tagsFor(key).forEach(function (tid) {
        if (tid === DELETE_ID) return;
        const meta = cat[tid];
        if (!meta || meta.kind === "person") return;
        counts[tid] = (counts[tid] || 0) + 1;
      });
    });
    const grouped = {};
    Object.keys(cat).forEach(function (tid) {
      const meta = cat[tid];
      if (!meta || meta.kind === "person" || tid === DELETE_ID) return;
      const title = KIND_TITLE[meta.kind];
      if (!title || !counts[tid]) return;
      grouped[title] = grouped[title] || [];
      grouped[title].push({
        id: tid,
        kind: meta.kind,
        label: meta.label || tid,
        count: counts[tid],
        auto: !!meta.auto,
      });
    });
    const groups = [];
    KIND_ORDER.forEach(function (title) {
      const rows = grouped[title] || [];
      if (!rows.length) return;
      if (title === "年") {
        rows.sort(function (a, b) {
          return parseInt(String(b.label).replace(/\D/g, ""), 10) - parseInt(String(a.label).replace(/\D/g, ""), 10);
        });
      } else if (title === "月") {
        rows.sort(function (a, b) {
          return parseInt(String(a.label).replace(/\D/g, ""), 10) - parseInt(String(b.label).replace(/\D/g, ""), 10);
        });
      } else {
        rows.sort(function (a, b) {
          return b.count - a.count || String(a.label).localeCompare(String(b.label), "zh");
        });
      }
      groups.push({ id: title, title: title, tags: rows });
    });
    const payload = { groups: groups, job: {} };
    if (photoRel) {
      const key = keyOf(photoRel);
      payload.photo = {
        tags: tagsFor(key)
          .map(function (tid) {
            const meta = cat[tid] || {};
            if (meta.kind === "person") return null;
            return { id: tid, kind: meta.kind || "", label: meta.label || tid, auto: !!meta.auto };
          })
          .filter(Boolean),
        faces: [],
      };
    }
    return payload;
  }

  function photosPayload(params) {
    const trash = params.get("trash") === "1";
    const fav = params.get("fav") === "1";
    const video = params.get("video") === "1";
    const qtext = (params.get("q") || "").trim().toLowerCase();
    const tagIds = (params.get("tags") || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s && s !== DELETE_ID && s.indexOf("text:") !== 0 && s !== "qr:any";
      });
    let rows = items.filter(function (it) {
      const key = keyOf(it.rel);
      if (trash) return isGone(key);
      if (isGone(key)) return false;
      if (fav && !isFav(key)) return false;
      if (video && it.kind !== "video") return false;
      if (tagIds.length && !hitsTags(key, tagIds)) return false;
      if (qtext) {
        const cat = catalog();
        const labels = tagsFor(key)
          .map(function (tid) {
            return String((cat[tid] && cat[tid].label) || tid).toLowerCase();
          })
          .join(" ");
        if (labels.indexOf(qtext) < 0 && String(it.name || "").toLowerCase().indexOf(qtext) < 0) {
          return false;
        }
      }
      return true;
    });
    const offset = Math.max(0, parseInt(params.get("offset") || "0", 10) || 0);
    const limit = Math.min(80, Math.max(1, parseInt(params.get("limit") || "48", 10) || 48));
    return {
      total: rows.length,
      offset: offset,
      items: rows.slice(offset, offset + limit).map(rowOf),
    };
  }

  function firstCover(want) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = keyOf(it.rel);
      if (isGone(key) || !want(it, key)) continue;
      return { person: personId, bucket: BUCKET, rel: it.rel, kind: it.kind || "" };
    }
    return null;
  }

  function folderCover(folder) {
    const cover = String(folder.cover || "");
    if (cover) {
      const parts = cover.split("|");
      const rel = parts.length === 3 ? parts[2] : "";
      if (rel && !isGone(cover)) {
        return { person: personId, bucket: BUCKET, rel: rel, kind: "image" };
      }
    }
    return firstCover(function (it, key) {
      return hitsTags(key, folder.tag_ids || []);
    });
  }

  function foldersPayload() {
    const rows = foldersLive();
    const folders = rows
      .filter(function (row) {
        return (row.tag_ids || []).length;
      })
      .map(function (row) {
        const cover = folderCover(row);
        const out = { id: row.id, title: row.title, tag_ids: row.tag_ids || [] };
        if (cover) out.cover = cover;
        return out;
      });
    let n = 1;
    const used = {};
    folders.forEach(function (row) {
      const m = String(row.title || "").match(/^新資料夾(\d+)$/);
      if (m) used[Number(m[1])] = 1;
    });
    while (used[n]) n += 1;
    return {
      folders: folders,
      next_title: "新資料夾" + n,
      fav_cover: firstCover(function (it, key) {
        return isFav(key);
      }),
      video_cover: firstCover(function (it) {
        return it.kind === "video";
      }),
      qr_cover: null,
      has_qr: false,
    };
  }

  function ensureTag(label, kind) {
    const name = String(label || "").replace(/^#/, "").trim();
    if (!name) return "";
    const cat = catalog();
    const ids = Object.keys(cat);
    for (let i = 0; i < ids.length; i++) {
      const meta = cat[ids[i]];
      if (meta && meta.label === name && (meta.kind || "custom") === (kind || "custom")) return ids[i];
    }
    const id = "custom:" + personId + ":" + Date.now();
    overlay.tags[id] = { kind: kind || "custom", label: name, auto: false, owner: personId };
    return id;
  }

  function addTag(key, tid) {
    if (!tid) return;
    const have = overlay.photos[key] || [];
    if (have.indexOf(tid) < 0) {
      overlay.photos[key] = have.concat([tid]);
    }
    const drop = overlay.photos[key + ":drop"] || [];
    overlay.photos[key + ":drop"] = drop.filter(function (id) {
      return id !== tid;
    });
  }

  function dropTag(key, tid) {
    const have = overlay.photos[key] || [];
    overlay.photos[key] = have.filter(function (id) {
      return id !== tid;
    });
    const drop = overlay.photos[key + ":drop"] || [];
    if (drop.indexOf(tid) < 0) overlay.photos[key + ":drop"] = drop.concat([tid]);
  }

  function photoKeys(body) {
    const rows = Array.isArray(body.photos) ? body.photos : [];
    const out = [];
    rows.forEach(function (row) {
      if (!row || !row.rel) return;
      out.push(keyOf(String(row.rel)));
    });
    if (body.rel) out.push(keyOf(String(body.rel)));
    return out;
  }

  function handleTagsPost(body) {
    const action = String(body.action || "");
    const keys = photoKeys(body);
    if (action === "attach" || action === "attach_many") {
      const ids = [];
      (Array.isArray(body.ids) ? body.ids : []).forEach(function (id) {
        if (id && ids.indexOf(id) < 0) ids.push(id);
      });
      if (body.id && ids.indexOf(body.id) < 0) ids.push(body.id);
      if (body.label) {
        const fresh = ensureTag(body.label, body.kind || "custom");
        if (fresh && ids.indexOf(fresh) < 0) ids.push(fresh);
      }
      keys.forEach(function (key) {
        ids.forEach(function (tid) {
          addTag(key, tid);
        });
      });
    } else if (action === "detach") {
      keys.forEach(function (key) {
        dropTag(key, body.id);
      });
    } else if (action === "create" || action === "create_on_photo") {
      const tid = ensureTag(body.label, body.kind || "custom");
      keys.forEach(function (key) {
        addTag(key, tid);
      });
    } else if (action === "trash") {
      keys.forEach(function (key) {
        overlay.deleted[key] = Date.now();
        delete overlay.restored[key];
        addTag(key, DELETE_ID);
      });
    } else if (action === "delete") {
      const tid = String(body.id || "");
      if (tid && overlay.tags[tid]) delete overlay.tags[tid];
      Object.keys(overlay.photos).forEach(function (key) {
        if (key.indexOf(":drop") >= 0) return;
        dropTag(key, tid);
      });
      foldersLive().forEach(function (row) {
        row.tag_ids = (row.tag_ids || []).filter(function (id) {
          return id !== tid;
        });
      });
    } else {
      return jsonRes({ error: "bad_action" }, 400);
    }
    return saveOverlay().then(function () {
      return jsonRes(boardPayload());
    });
  }

  function handleFoldersPost(body) {
    const rows = foldersLive();
    const op = String(body.op || "");
    if (op === "create") {
      const ids = (body.tag_ids || []).filter(Boolean);
      if (!ids.length) return jsonRes({ error: "要選標籤" }, 400);
      rows.push({
        id: "fld:" + Date.now(),
        title: String(body.title || "").trim() || foldersPayload().next_title,
        tag_ids: ids,
        cover: "",
      });
    } else if (op === "update") {
      rows.forEach(function (row) {
        if (row.id !== body.id) return;
        if (body.title != null) row.title = String(body.title);
        if (body.tag_ids) row.tag_ids = body.tag_ids.filter(Boolean);
      });
    } else if (op === "delete") {
      const drop = {};
      (body.ids || []).concat(body.id ? [body.id] : []).forEach(function (id) {
        drop[id] = 1;
      });
      overlay.folders = rows.filter(function (row) {
        return !drop[row.id];
      });
    } else if (op === "cover") {
      const photo = (body.photos && body.photos[0]) || {};
      rows.forEach(function (row) {
        if (row.id !== body.id) return;
        if (photo.rel) row.cover = keyOf(photo.rel);
      });
    }
    return saveOverlay().then(function () {
      return jsonRes(foldersPayload());
    });
  }

  function request(path, opts) {
    const parsed = parseQuery(path);
    const method = ((opts && opts.method) || "GET").toUpperCase();
    if (parsed.base === "/api/photos") return jsonRes(photosPayload(parsed.params));
    if (parsed.base === "/api/folders" && method === "GET") return jsonRes(foldersPayload());
    if (parsed.base === "/api/folders" && method === "POST") {
      return readBody(opts).then(handleFoldersPost);
    }
    if (parsed.base === "/api/tags" && method === "GET") {
      return jsonRes(boardPayload(parsed.params.get("rel") || ""));
    }
    if (parsed.base === "/api/tags" && method === "POST") {
      return readBody(opts).then(handleTagsPost);
    }
    if (parsed.base === "/api/favorite") {
      return readBody(opts).then(function (body) {
        const onFav = !!body.on;
        photoKeys(body).forEach(function (key) {
          overlay.favorites[key] = onFav;
        });
        return saveOverlay().then(function () {
          return jsonRes({ ok: true });
        });
      });
    }
    if (parsed.base === "/api/cabinets" || parsed.base === "/api/public") {
      return jsonRes({ people: [cabinet()] });
    }
    if (parsed.base === "/cover") {
      const file = fileAt("cover.jpg");
      if (!file) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(file));
    }
    if (parsed.base === "/backdrop") {
      const file = fileAt("backdrop.jpg");
      if (!file) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(file));
    }
    if (parsed.base === "/api/sync" || parsed.base === "/api/upload" || parsed.base === "/api/cover" || parsed.base === "/api/backdrop") {
      return jsonRes({ error: "drive" }, 400);
    }
    return jsonRes({ error: "missing" }, 404);
  }

  function mediaUrl(item, kind, size) {
    if (!item || !item.rel) return "";
    if (kind === "thumb") {
      const thumbName = item.thumb || "";
      const thumb = (thumbName && files["thumbs/" + thumbName + ".jpg"]) || files["thumbs/" + item.rel];
      if (thumb) return objectUrl(thumb);
    }
    const file = files["photos/" + item.rel];
    return file ? objectUrl(file) : "";
  }

  function cabinet() {
    return {
      id: personId,
      display_name: who,
      has_cover: !!fileAt("cover.jpg"),
      cover_rev: on ? 1 : 0,
      has_backdrop: !!fileAt("backdrop.jpg"),
      backdrop_rev: on ? 1 : 0,
      sync: "idle",
      percent: 100,
    };
  }

  function panelEls() {
    return {
      panel: document.getElementById("invite-panel"),
      hey: document.getElementById("invite-hey"),
      go: document.getElementById("invite-go"),
      drive: document.getElementById("drive-go"),
      wait: document.getElementById("invite-wait"),
      bar: document.getElementById("invite-wait-bar"),
      status: document.getElementById("status"),
      safari: document.getElementById("invite-safari"),
      apple: document.getElementById("invite-apple-form"),
      pass: document.getElementById("invite-pass-form"),
      mfa: document.getElementById("invite-mfa"),
    };
  }

  function showPick() {
    if (on || window.FAMILY_FORCE_INVITE) return;
    const els = panelEls();
    if (els.status) els.status.textContent = "";
    if (els.hey) els.hey.hidden = true;
    if (els.go) els.go.hidden = true;
    if (els.safari) els.safari.hidden = true;
    if (els.apple) els.apple.hidden = true;
    if (els.pass) els.pass.hidden = true;
    if (els.mfa) els.mfa.hidden = true;
    if (els.wait) els.wait.hidden = true;
    if (els.drive) els.drive.hidden = false;
    if (els.panel) els.panel.hidden = false;
  }

  function hidePick() {
    const els = panelEls();
    if (els.drive) els.drive.hidden = true;
    if (els.wait) els.wait.hidden = true;
    if (els.panel && !window.FAMILY_FORCE_INVITE) els.panel.hidden = true;
  }

  function showWait() {
    const els = panelEls();
    if (els.drive) els.drive.hidden = true;
    if (els.go) els.go.hidden = true;
    if (els.hey) els.hey.hidden = true;
    if (els.status) els.status.textContent = "";
    if (els.panel) els.panel.hidden = false;
    if (els.wait) els.wait.hidden = false;
    if (els.bar && window.RoseTwo && window.RoseTwo.mountBar && !waitMounted) {
      window.RoseTwo.mountBar(els.bar);
      waitMounted = true;
    }
  }

  function bindInput(input) {
    if (!input || input.dataset.driveBound) return input;
    input.dataset.driveBound = "1";
    input.addEventListener("change", function () {
      const list = input.files;
      input.value = "";
      if (!list || !list.length) {
        busy = false;
        showPick();
        return;
      }
      mount(list).catch(function () {
        busy = false;
        showPick();
        const status = document.getElementById("status");
        if (status) status.textContent = "找不到相簿資料夾";
      });
    });
    return input;
  }

  function pick() {
    if (busy) return;
    busy = true;
    showWait();
    let input = document.getElementById("drive-input");
    if (!input) {
      input = document.createElement("input");
      input.id = "drive-input";
      input.type = "file";
      input.hidden = true;
      document.body.appendChild(input);
    }
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.multiple = true;
    bindInput(input);
    let settled = false;
    function undo() {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      if (!on) {
        busy = false;
        showPick();
      }
    }
    function onFocus() {
      window.setTimeout(function () {
        if (!settled && !(input.files && input.files.length)) undo();
      }, 900);
    }
    window.addEventListener("focus", onFocus);
    input.click();
  }

  function mount(list) {
    showWait();
    const root = findRoot(list);
    if (root == null) {
      return Promise.reject(new Error("no index"));
    }
    files = {};
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const rel = stripRoot(file.webkitRelativePath || file.name, root);
      if (!rel || rel.indexOf("..") >= 0) continue;
      files[rel] = file;
    }
    const indexFile = files["index.json"];
    if (!indexFile) return Promise.reject(new Error("no index"));
    return indexFile
      .text()
      .then(function (raw) {
        const data = JSON.parse(raw);
        personId = data.person || "album";
        who = data.who || personId;
        const known = {};
        items = (data.items || []).map(function (it) {
          known[it.rel] = 1;
          return it;
        });
        const still = {};
        items.forEach(function (it) {
          if (it.kind === "image") still[String(it.name || "").replace(/\.[^.]+$/, "").toUpperCase()] = 1;
        });
        Object.keys(files).forEach(function (rel) {
          if (rel.indexOf("photos/") !== 0) return;
          const path = rel.slice("photos/".length);
          if (!path || known[path] || skipName(path)) return;
          const name = path.split("/").pop();
          const kind = kindOf(name);
          if (!kind) return;
          if (kind === "video" && still[name.replace(/\.[^.]+$/, "").toUpperCase()]) return;
          const mtime = (files[rel].lastModified || 0) / 1000;
          items.push({
            rel: path,
            kind: kind,
            name: name,
            mtime: mtime,
            group: groupOf(path, mtime),
          });
        });
        items.sort(function (a, b) {
          return String(b.group || "").localeCompare(String(a.group || "")) || b.mtime - a.mtime;
        });
        const tagsFile = files["tags.json"];
        if (!tagsFile) return {};
        return tagsFile.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (e) {
            return {};
          }
        });
      })
      .then(function (tags) {
        seed = tags && typeof tags === "object" ? tags : { photos: {}, tags: {}, favorites: [], cabinets: {}, deleted: {} };
        if (!seed.photos) seed.photos = {};
        if (!seed.tags) seed.tags = {};
        if (!seed.favorites) seed.favorites = [];
        if (!seed.cabinets) seed.cabinets = {};
        if (!seed.deleted) seed.deleted = {};
        seedFav = {};
        seed.favorites.forEach(function (k) {
          seedFav[k] = 1;
        });
        dropBlobs();
        return loadOverlay();
      })
      .then(function () {
        on = true;
        busy = false;
        hidePick();
        if (window.FamilyDoor && window.FamilyDoor.onDrive) {
          window.FamilyDoor.onDrive(cabinet());
        }
      });
  }

  function coverUrl() {
    const file = fileAt("cover.jpg");
    return file ? objectUrl(file) : "";
  }

  function backdropUrl() {
    const file = fileAt("backdrop.jpg");
    return file ? objectUrl(file) : "";
  }

  function runBackup() {
    const added = localStorage.getItem("famiphoto.shortcut") === "1";
    if (!added) {
      try {
        localStorage.setItem("famiphoto.shortcut", "1");
      } catch (e) {}
      location.href = new URL("./backup.shortcut", location.href).href;
      return;
    }
    location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(SHORTCUT_NAME);
  }

  const driveBtn = document.getElementById("drive-go");
  if (driveBtn) {
    driveBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      pick();
    });
  }
  bindInput(document.getElementById("drive-input"));

  window.FamilyDrive = {
    isOn: function () {
      return on;
    },
    mount: mount,
    request: request,
    mediaUrl: mediaUrl,
    coverUrl: coverUrl,
    backdropUrl: backdropUrl,
    cabinet: cabinet,
    pick: pick,
    showPick: showPick,
    hidePick: hidePick,
    runBackup: runBackup,
  };
})();
