(function () {
  const board = document.getElementById("tag-board");
  const RENAMEABLE = { person: 1, place_country: 1, place_city: 1, custom: 1 };
  const DELETE_ID = "media:delete";
  const TEXT_PRE = "text:";
  const QR_ANY = "qr:any";
  let findScope = { tag: true, text: true, qr: true };
  const ARROW =
    '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="18"/><path d="M15.2 11.5L22.5 18l-7.3 6.5"/></svg>';
  const MAG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.2L20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const CHEV =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let person = "";
  let selected = [];
  let applied = [];
  let collapsed = { "地點": true, "類型": true, "自訂": true, "人物": true };
  let mode = "all";
  let modeActive = "all";
  let finding = false;
  let lastBoard = { groups: [], job: {} };
  let sheet = null;
  let sheetItem = null;
  let faceLayer = null;
  let faceBoxes = [];
  let faceTick = 0;
  let faceLayTries = 0;
  let faceLayFrame = 0;
  let faceCtrl = null;
  let faceCube = null;
  let selectedTag = null;
  let selectedBBox = null;
  let pickerRefresh = function () {};
  let batchSheet = null;
  let listSheet = null;
  let listBody = null;
  let findSheet = null;
  let findRefresh = function () {};
  let lastLoadAt = 0;
  let feedNeedsSync = false;

  function api(path, opts) {
    const origin = (window.VAULT_ORIGIN || "").replace(/\/$/, "");
    const k = window.FAMILY_VIEW_KEY;
    let url = origin + path;
    if (k) url += (path.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(k);
    return fetch(url, opts || {});
  }

  function post(body) {
    return api("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ person: person }, body)),
    }).then(function (res) {
      if (!res.ok) throw new Error("bad");
      return res.json();
    });
  }

  function allTags() {
    const seen = {};
    const out = [];
    (lastBoard.groups || []).forEach(function (group) {
      (group.tags || []).forEach(function (tag) {
        if (!tag || !tag.id || seen[tag.id]) return;
        seen[tag.id] = true;
        out.push(tag);
      });
    });
    return out;
  }

  function tagById(id) {
    const rows = allTags();
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  function tagPool(opts) {
    opts = opts || {};
    return allTags().filter(function (tag) {
      if (opts.kind && tag.kind !== opts.kind) return false;
      if (opts.exceptId && tag.id === opts.exceptId) return false;
      if (opts.exceptIds && opts.exceptIds[tag.id]) return false;
      if (opts.customPeople && tag.kind === "person" && tag.auto) return false;
      return true;
    });
  }

  function recommendations(opts) {
    opts = opts || {};
    const pool = tagPool(opts).filter(function (tag) {
      return !(
        opts.hideAutoPeople &&
        tag.kind === "person" &&
        tag.auto &&
        /^p\d+$/i.test(String(tag.label || ""))
      );
    });
    const recent = pool
      .filter(function (tag) {
        return Number(tag.used_at) > 0;
      })
      .sort(function (a, b) {
        return Number(b.used_at) - Number(a.used_at) || Number(b.count) - Number(a.count);
      });
    const popular = pool.slice().sort(function (a, b) {
      return (
        Number(b.count) - Number(a.count) ||
        Number(b.used_at) - Number(a.used_at) ||
        String(a.label || "").localeCompare(String(b.label || ""), "zh-Hant")
      );
    });
    const out = [];
    const seen = {};
    recent.slice(0, 4).concat(popular).forEach(function (tag) {
      if (out.length >= 8 || seen[tag.id]) return;
      seen[tag.id] = true;
      out.push(tag);
    });
    return out;
  }

  function foldQuery(s) {
    return String(s || "")
      .trim()
      .replace(/^#/, "")
      .toLowerCase()
      .replace(/身份/g, "身分");
  }

  function isSearchTok(id) {
    return id === QR_ANY || String(id || "").indexOf(TEXT_PRE) === 0;
  }

  function textTok(q) {
    return TEXT_PRE + encodeURIComponent(String(q || "").trim());
  }

  function tokenTag(id) {
    if (id === QR_ANY) return { id: QR_ANY, label: "有QR", kind: "search" };
    if (String(id || "").indexOf(TEXT_PRE) === 0) {
      let q = String(id).slice(TEXT_PRE.length);
      try {
        q = decodeURIComponent(q);
      } catch (e) {}
      return { id: id, label: q, kind: "search" };
    }
    return tagById(id);
  }

  function scopeString() {
    const out = [];
    if (findScope.tag) out.push("tag");
    if (findScope.text) out.push("text");
    if (findScope.qr) out.push("qr");
    return out.join(",") || "tag,text,qr";
  }

  function feedFilter(ids, extra) {
    extra = extra || {};
    extra.scope = scopeString();
    if (window.FamilyFeed) window.FamilyFeed.filter(ids, extra);
  }

  function catalogOf(query, opts) {
    const q = foldQuery(query);
    if (!q) return recommendations(opts);
    return tagPool(opts)
      .filter(function (tag) {
        return foldQuery(tag.label).indexOf(q) >= 0;
      })
      .sort(function (a, b) {
        const al = foldQuery(a.label);
        const bl = foldQuery(b.label);
        return (
          Number(bl === q) - Number(al === q) ||
          Number(bl.indexOf(q) === 0) - Number(al.indexOf(q) === 0) ||
          Number(b.count) - Number(a.count) ||
          Number(b.used_at) - Number(a.used_at)
        );
      })
      .slice(0, 8);
  }

  function tagInput(placeholder) {
    const input = document.createElement("input");
    input.type = "search";
    input.name = "search";
    input.maxLength = 48;
    input.placeholder = placeholder || "新增標籤";
    input.autocomplete = "off";
    input.autocapitalize = "none";
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.setAttribute("enterkeyhint", "done");
    input.className = "tag-search-input";
    // iOS: focus after a tap, not finger-down — scrolling across the field must not open the keyboard.
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) {
      let sx = 0;
      let sy = 0;
      let moved = false;
      input.addEventListener(
        "touchstart",
        function (ev) {
          const t = ev.touches[0];
          if (!t) return;
          sx = t.clientX;
          sy = t.clientY;
          moved = false;
          if (document.activeElement !== input) input.readOnly = true;
        },
        { passive: true }
      );
      input.addEventListener(
        "touchmove",
        function (ev) {
          const t = ev.touches[0];
          if (!t || moved) return;
          if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) {
            moved = true;
          }
        },
        { passive: true }
      );
      input.addEventListener("touchend", function (ev) {
        input.readOnly = false;
        if (moved || document.activeElement === input) return;
        ev.preventDefault();
        try {
          input.focus({ preventScroll: true });
        } catch (e) {
          input.focus();
        }
      });
      input.addEventListener("touchcancel", function () {
        moved = true;
        input.readOnly = false;
      });
    }
    return input;
  }

  function submitArrow(label, extraClass) {
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "apple-next tag-submit" + (extraClass ? " " + extraClass : "");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = ARROW;
    return button;
  }

  function tagChip(tag, on, choose) {
    const chip = document.createElement("button");
    chip.type = "button";
    let kind = "";
    if (on === "picked") kind = " is-picked";
    else if (on) kind = " is-on";
    chip.className = "tag-chip" + kind;
    chip.dataset.tagId = tag.id;
    chip.textContent = (tag.kind === "search" ? "" : "#") + tag.label;
    chip.addEventListener("click", function (ev) {
      ev.preventDefault();
      choose(tag);
    });
    return chip;
  }

  function removableTagChip(tag, remove, pending) {
    const wrap = document.createElement("span");
    wrap.className = "tag-chip-wrap" + (pending ? " is-picked" : " is-on");
    wrap.dataset.id = tag.id;
    wrap.appendChild(tagChip(tag, pending ? "picked" : true, remove));
    const x = document.createElement("button");
    x.type = "button";
    x.className = "ins-x";
    x.setAttribute("aria-label", "取消 " + (tag.kind === "search" ? tag.label : "#" + tag.label));
    x.textContent = "×";
    x.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      remove(tag);
    });
    wrap.appendChild(x);
    return wrap;
  }

  function tagKey(ids) {
    return (ids || []).slice().sort().join(",");
  }

  function rewriteIds(ids, src, dst) {
    src = String(src || "");
    dst = String(dst || "");
    if (!src || !dst || src === dst) return;
    const seen = {};
    const out = [];
    (ids || []).forEach(function (id) {
      const next = id === src ? dst : id;
      if (!next || seen[next]) return;
      seen[next] = true;
      out.push(next);
    });
    ids.splice.apply(ids, [0, ids.length].concat(out));
  }

  function followMerge(src, dst) {
    src = String(src || "");
    dst = String(dst || "");
    const hit =
      (src && applied.indexOf(src) >= 0) || (dst && applied.indexOf(dst) >= 0);
    rewriteIds(selected, src, dst);
    rewriteIds(applied, src, dst);
    if (hit) feedNeedsSync = true;
  }

  function syncFeedIfNeeded() {
    if (!feedNeedsSync || sheetItem) return;
    feedNeedsSync = false;
    if (!applied.length) {
      mode = "all";
      modeActive = "all";
      selected.splice(0, selected.length);
    }
    feedFilter(applied.slice(), { force: true });
  }

  function setBoardInert(on) {
    if (!board) return;
    board.toggleAttribute("inert", !!on);
  }

  function lockSheetPage(mask, close) {
    let press = null;
    mask.addEventListener("pointerdown", function (ev) {
      if (ev.target !== mask) {
        press = null;
        return;
      }
      press = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, at: Date.now() };
    });
    mask.addEventListener("pointermove", function (ev) {
      if (!press || ev.pointerId !== press.id) return;
      if (Math.abs(ev.clientX - press.x) > 10 || Math.abs(ev.clientY - press.y) > 10) {
        press = null;
      }
    });
    mask.addEventListener("pointerup", function (ev) {
      const held = press && Date.now() - press.at >= 40;
      const ok = held && ev.pointerId === press.id && ev.target === mask;
      press = null;
      if (ok) close();
    });
    mask.addEventListener("pointercancel", function () {
      press = null;
    });
    let lastY = 0;
    mask.addEventListener("touchstart", function (ev) {
      if (ev.touches && ev.touches[0]) lastY = ev.touches[0].clientY;
    }, { passive: true });
    mask.addEventListener(
      "touchmove",
      function (ev) {
        const node = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
        const scroller = node && node.closest && node.closest(".tag-picker-suggest, .list-tag-body");
        const y = ev.touches && ev.touches[0] ? ev.touches[0].clientY : lastY;
        const dy = y - lastY;
        lastY = y;
        if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
          const atTop = scroller.scrollTop <= 0 && dy > 0;
          const atBot = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && dy < 0;
          if (!atTop && !atBot) return;
        }
        ev.preventDefault();
      },
      { passive: false }
    );
  }

  function suggestChip(tag, choose) {
    let done = false;
    let moved = false;
    let x = 0;
    let y = 0;
    function pick(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (done || moved) return;
      done = true;
      choose(tag);
    }
    const chip = tagChip(tag, false, pick);
    chip.addEventListener("pointerdown", function (ev) {
      moved = false;
      x = ev.clientX;
      y = ev.clientY;
    });
    chip.addEventListener("pointermove", function (ev) {
      if (Math.abs(ev.clientX - x) > 10 || Math.abs(ev.clientY - y) > 10) moved = true;
    });
    return chip;
  }

  function renderSuggestions(host, query, opts, choose) {
    host.innerHTML = "";
    const hits = catalogOf(query, opts);
    if (!hits.length) return;
    const title = document.createElement("p");
    title.className = "tag-suggest-title";
    title.textContent = opts && opts.kind === "person" ? "建議的人物" : "建議的標籤";
    host.appendChild(title);
    hits.forEach(function (tag) {
      host.appendChild(suggestChip(tag, choose));
    });
  }

  function createPicker(opts) {
    const root = document.createElement("div");
    root.className = "tag-picker" + (opts.hideInput ? " no-search" : "");
    const card = document.createElement("div");
    card.className = "tag-picker-card";
    const chosen = opts.chosenHost || document.createElement("div");
    if (!opts.chosenHost) chosen.className = "tag-picker-chosen";
    const form = document.createElement("form");
    form.className = "tag-picker-form";
    form.autocomplete = "off";
    const findAsk = opts.mainAction && opts.ids && opts.ids.length ? "再找？" : "找照片？";
    const input = tagInput(opts.mainAction ? findAsk : "搜尋標籤");
    const go = opts.hideGo ? null : submitArrow(opts.actionText, opts.mainAction ? "mode-pick" : "");
    const suggest = document.createElement("div");
    suggest.className = "tag-picker-suggest";
    let blurTimer = 0;
    if (!opts.hideInput) form.appendChild(input);
    if (go) form.appendChild(go);
    if (!opts.chosenHost && !opts.hideChosen) card.appendChild(chosen);
    card.appendChild(form);
    card.appendChild(suggest);
    root.appendChild(card);

    function ids() {
      return opts.ids;
    }

    function toggle(tag, keepFocus) {
      const at = ids().indexOf(tag.id);
      if (at >= 0) ids().splice(at, 1);
      else ids().push(tag.id);
      input.value = "";
      if (keepFocus && input.isConnected) {
        try {
          input.focus({ preventScroll: true });
        } catch (e) {
          input.focus();
        }
      }
      refresh();
      if (opts.onChange) opts.onChange(ids().slice());
    }

    function refresh() {
      if (!opts.hideChosen) {
        chosen.innerHTML = "";
        chosen.hidden = !ids().length;
        ids().forEach(function (id) {
          const tag = tagById(id);
          if (tag) {
            const pending = !!(opts.appliedIds && opts.appliedIds().indexOf(id) < 0);
            chosen.appendChild(
              removableTagChip(
                tag,
                function (picked) {
                  toggle(picked, false);
                },
                pending
              )
            );
          }
        });
      }
      const exceptIds = {};
      ids().forEach(function (id) {
        exceptIds[id] = true;
      });
      const q = String(input.value || "").trim();
      const searching =
        root.classList.contains("is-searching") || document.activeElement === input;
      let showSuggest = false;
      if (!opts.hideInput) {
        if (q) showSuggest = true;
        else if (opts.alwaysSuggest) showSuggest = !searching;
        else showSuggest = searching;
      }
      if (showSuggest) {
        const pickSuggest = function (picked) {
          toggle(picked, opts.keepOpen || !opts.mainAction);
          if (opts.keepOpen || !opts.mainAction) return;
          if (blurTimer) window.clearTimeout(blurTimer);
          blurTimer = 0;
          root.classList.remove("is-searching");
          suggest.innerHTML = "";
          input.blur();
        };
        if (opts.customSuggest) {
          opts.customSuggest(suggest, input.value, pickSuggest);
        } else {
          renderSuggestions(
            suggest,
            input.value,
            { exceptIds: exceptIds, hideAutoPeople: !input.value },
            pickSuggest
          );
        }
      } else {
        suggest.innerHTML = "";
      }
      board.querySelectorAll(".tag-row .tag-chip").forEach(function (chip) {
        chip.classList.toggle("is-on", ids().indexOf(chip.dataset.tagId) >= 0);
      });
      const dirty = opts.appliedIds && tagKey(ids()) !== tagKey(opts.appliedIds());
      if (opts.mainAction && board) {
        board.classList.toggle("is-dirty", !!dirty);
        board.classList.toggle("is-finding", !!finding);
      }
      if (go && opts.mainAction) {
        go.hidden = false;
        go.disabled = !ids().length || !dirty;
      } else if (go) {
        go.disabled = !ids().length && !String(input.value || "").trim();
      }
    }

    input.addEventListener("focus", function () {
      if (blurTimer) window.clearTimeout(blurTimer);
      root.classList.add("is-searching");
      if (opts.mainAction) input.placeholder = "輸入文字尋找";
      refresh();
    });
    function finishBlur() {
      blurTimer = 0;
      if (document.activeElement === input) return;
      if (document.documentElement.classList.contains("kb-up")) {
        blurTimer = window.setTimeout(finishBlur, 120);
        return;
      }
      root.classList.remove("is-searching");
      if (opts.mainAction) input.placeholder = opts.ids && opts.ids.length ? "再找？" : "找照片？";
      refresh();
    }
    input.addEventListener("blur", function () {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(finishBlur, 180);
    });
    input.addEventListener("input", refresh);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      const label = String(input.value || "").trim().replace(/^#/, "");
      const exact = catalogOf(label, {}).filter(function (tag) {
        return foldQuery(tag.label) === foldQuery(label);
      })[0];
      if (opts.takeQuery && label) {
        const tok = textTok(label);
        if (ids().indexOf(tok) < 0) ids().push(tok);
      } else if (exact && ids().indexOf(exact.id) < 0) {
        ids().push(exact.id);
      }
      refresh();
      if (opts.onChange) opts.onChange(ids().slice());
      if (opts.mainAction && go && go.disabled) return;
      const choices = ids()
        .map(tokenTag)
        .filter(Boolean);
      const fresh = opts.allowNew && label && !exact ? label : "";
      if (opts.mainAction) {
        root.classList.remove("is-searching");
        suggest.innerHTML = "";
        input.blur();
      }
      opts.onSubmit(choices, fresh);
    });
    refresh();
    return { node: root, refresh: refresh, input: input };
  }

  function updateModeButtons() {
    if (!board) return;
    board.querySelectorAll(".mode-btn[data-mode]").forEach(function (btn) {
      const on = btn.dataset.mode === "find" ? finding : btn.dataset.mode === modeActive;
      btn.classList.toggle("is-on", on);
    });
  }

  function unlockBoard() {
    if (listSheet || findSheet || batchSheet) return;
    setBoardInert(false);
    document.documentElement.classList.remove("tag-modal-open");
  }

  function isDirty() {
    return tagKey(selected) !== tagKey(applied);
  }

  function applyHome() {
    closeFind({ repaint: false });
    closeList();
    if (!selected.length) {
      backToAll();
      return;
    }
    feedFilter(selected.slice());
    finding = false;
    if (board) board.classList.toggle("is-finding", false);
    updateModeButtons();
    paint(lastBoard);
  }

  function paintHomeChosen(host) {
    host.innerHTML = "";
    host.hidden = !selected.length;
    selected.forEach(function (id) {
      const tag = tokenTag(id);
      if (!tag) return;
      host.appendChild(
        removableTagChip(
          tag,
          function (picked) {
            const at = selected.indexOf(picked.id);
            if (at >= 0) selected.splice(at, 1);
            if (!selected.length && applied.length) {
              backToAll();
              return;
            }
            paint(lastBoard);
          },
          applied.indexOf(id) < 0
        )
      );
    });
  }

  function applyButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-apply";
    btn.hidden = !selected.length || !isDirty();
    const face = document.createElement("span");
    face.className = "tag-apply-face";
    const label = document.createElement("span");
    const onlyTags = selected.every(function (id) {
      return !isSearchTok(id);
    });
    label.textContent = onlyTags
      ? selected.length > 1
        ? "尋找這些標籤的照片"
        : "尋找有此標籤的照片"
      : "尋找這些照片";
    face.appendChild(label);
    face.insertAdjacentHTML("beforeend", CHEV);
    btn.appendChild(face);
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      applyHome();
    });
    return btn;
  }

  function backToAll() {
    closeList();
    closeFind({ repaint: false });
    if (
      mode === "all" &&
      modeActive === "all" &&
      !selected.length &&
      !applied.length
    ) {
      return;
    }
    mode = "all";
    modeActive = "all";
    selected.splice(0, selected.length);
    findScope = { tag: true, text: true, qr: true };
    feedFilter([]);
    paint(lastBoard);
  }

  function modeBtn(id, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.mode = id;
    btn.className = "mode-btn" + (id === "find" ? " mode-find" : "");
    if (id === "find") {
      btn.innerHTML = MAG + "<span>" + (selected.length ? "再找？" : "找照片？") + "</span>";
      if (finding) btn.classList.add("is-on");
    } else {
      btn.textContent = label;
      if (modeActive === id) btn.classList.add("is-on");
    }
    btn.addEventListener("click", function () {
      if (id === "folders") {
        closeFind({ repaint: false });
        closeList();
        modeActive = "folders";
        mode = "all";
        selected.splice(0, selected.length);
        applied = [];
        const who = person || (document.getElementById("feed") || {}).dataset.person;
        if (who && window.FamilyFeed && window.FamilyFeed.showFolders) {
          window.FamilyFeed.showFolders(who);
        }
        paint(lastBoard);
        return;
      }
      if (id === "all") {
        backToAll();
        return;
      }
      if (id === "find") {
        closeList();
        if (findSheet) {
          closeFind();
          if (!applied.length) modeActive = "all";
          updateModeButtons();
          return;
        }
        modeActive = "";
        openFind();
        return;
      }
      closeFind({ repaint: false });
      if (listSheet) return;
      openList();
    });
    return btn;
  }

  function paint(data) {
    if (!board) return;
    lastBoard = data || lastBoard;
    selected = selected.filter(function (id) {
      return isSearchTok(id) || !!tagById(id);
    });
    const keptApplied = applied.filter(function (id) {
      return isSearchTok(id) || !!tagById(id);
    });
    if (tagKey(keptApplied) !== tagKey(applied)) {
      applied = keptApplied;
      feedNeedsSync = true;
    }
    board.hidden = false;
    board.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "mode-bar";
    bar.appendChild(modeBtn("folders", "分類"));
    bar.appendChild(modeBtn("all", "全部"));
    bar.appendChild(modeBtn("list", "列表"));
    bar.appendChild(modeBtn("find", selected.length ? "再找？" : "找照片？"));
    board.appendChild(bar);
    board.classList.toggle("is-finding", finding);
    board.classList.toggle("is-dirty", isDirty());
    const chosen = document.createElement("div");
    chosen.className = "tag-picker-chosen tag-main-chosen";
    board.appendChild(chosen);
    paintHomeChosen(chosen);
    board.appendChild(applyButton());
    pickerRefresh = function () {
      if (findSheet) return;
      paint(lastBoard);
    };
    if (window.FamilyDoor && window.FamilyDoor.layoutStage) window.FamilyDoor.layoutStage();
  }

  function load() {
    if (!person) return;
    lastLoadAt = Date.now();
    api("/api/tags?person=" + encodeURIComponent(person))
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        const active = document.activeElement;
        if (
          batchSheet ||
          listSheet ||
          findSheet ||
          (active && active.classList && active.classList.contains("tag-search-input"))
        ) {
          lastBoard = data || lastBoard;
          if (listSheet && listBody) fillListGroups(listBody);
          if (findSheet) findRefresh();
          return;
        }
        paint(data);
      })
      .catch(function () {});
  }

  function accept(payload) {
    if (payload && payload.groups) {
      lastBoard = payload;
      if (listSheet && listBody) {
        fillListGroups(listBody);
        return payload;
      }
      if (findSheet) {
        findRefresh();
        return payload;
      }
      paint(payload);
    }
    return payload;
  }

  function restoreHomeMode() {
    mode = "all";
    modeActive = applied.length ? "" : "all";
  }

  function closeList() {
    if (listSheet) listSheet.remove();
    listSheet = null;
    listBody = null;
    unlockBoard();
    if (mode === "list") restoreHomeMode();
  }

  function closeFind(opts) {
    opts = opts || {};
    const wasOpen = !!findSheet;
    if (findSheet) findSheet.remove();
    findSheet = null;
    finding = false;
    if (board) board.classList.toggle("is-finding", false);
    unlockBoard();
    if (wasOpen && opts.repaint !== false) paint(lastBoard);
  }

  function fillListGroups(host) {
    host.innerHTML = "";
    (lastBoard.groups || []).forEach(function (group) {
      const available = (group.tags || []).filter(function (tag) {
        return selected.indexOf(tag.id) < 0;
      });
      if (!available.length) return;
      const wrap = document.createElement("section");
      wrap.className = "tag-group";
      const closed = collapsed[group.id] === true;
      const head = document.createElement("button");
      head.type = "button";
      head.className = "tag-head";
      head.textContent = (closed ? "▸ " : "▾ ") + group.title;
      head.addEventListener("click", function () {
        collapsed[group.id] = !closed;
        fillListGroups(host);
      });
      wrap.appendChild(head);
      if (!closed) {
        const row = document.createElement("div");
        row.className = "tag-row";
        available.forEach(function (tag) {
          row.appendChild(
            tagChip(tag, false, function (picked) {
              if (selected.indexOf(picked.id) < 0) selected.push(picked.id);
              closeList();
              paint(lastBoard);
            })
          );
        });
        wrap.appendChild(row);
      }
      host.appendChild(wrap);
    });
  }

  function openList() {
    closeBatch();
    closeFind({ repaint: false });
    closeList();
    mode = "list";
    modeActive = "list";
    updateModeButtons();
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask list-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet list-tag-sheet";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = "List";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", function () {
      closeList();
      updateModeButtons();
    });
    head.appendChild(title);
    head.appendChild(close);
    const body = document.createElement("div");
    body.className = "list-tag-body";
    fillListGroups(body);
    card.appendChild(head);
    card.appendChild(body);
    mask.appendChild(card);
    lockSheetPage(mask, function () {
      closeList();
      updateModeButtons();
    });
    document.body.appendChild(mask);
    listSheet = mask;
    listBody = body;
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function openFind() {
    closeBatch();
    closeList();
    if (findSheet) findSheet.remove();
    findSheet = null;
    finding = true;
    modeActive = "";
    if (board) board.classList.toggle("is-finding", true);
    updateModeButtons();
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask list-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet list-tag-sheet";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = selected.length ? "再找？" : "找照片？";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", function () {
      closeFind();
      if (!applied.length) modeActive = "all";
      updateModeButtons();
    });
    head.appendChild(title);
    head.appendChild(close);
    function findSuggest(host, query, choose) {
      host.innerHTML = "";
      const q = String(query || "").trim().replace(/^#/, "");
      const exceptIds = {};
      selected.forEach(function (id) {
        exceptIds[id] = true;
      });
      if (findScope.tag) {
        const hits = catalogOf(query, { exceptIds: exceptIds, hideAutoPeople: !q });
        if (hits.length) {
          const cap = document.createElement("p");
          cap.className = "tag-suggest-title";
          cap.textContent = "標籤";
          host.appendChild(cap);
          hits.forEach(function (tag) {
            host.appendChild(suggestChip(tag, choose));
          });
        }
      }
      if (!q && findScope.qr && selected.indexOf(QR_ANY) < 0) {
        const cap = document.createElement("p");
        cap.className = "tag-suggest-title";
        cap.textContent = "QR";
        host.appendChild(cap);
        host.appendChild(
          suggestChip({ id: QR_ANY, label: "有QR", kind: "search" }, choose)
        );
      }
      if (q && (findScope.text || findScope.qr || findScope.tag)) {
        const tok = textTok(q);
        if (selected.indexOf(tok) < 0) {
          const cap = document.createElement("p");
          cap.className = "tag-suggest-title";
          cap.textContent = findScope.text ? "文字" : findScope.qr ? "QR" : "標籤";
          host.appendChild(cap);
          host.appendChild(
            suggestChip({ id: tok, label: q, kind: "search" }, choose)
          );
        }
      }
    }
    const picker = createPicker({
      ids: selected,
      actionText: "尋找這些照片",
      mainAction: true,
      hideGo: true,
      hideChosen: true,
      alwaysSuggest: true,
      takeQuery: true,
      customSuggest: findSuggest,
      appliedIds: function () {
        return applied;
      },
      allowNew: false,
      onChange: function () {
        closeFind();
      },
      onSubmit: function (choices) {
        const ids = choices.map(function (tag) {
          return tag.id;
        });
        selected.splice.apply(selected, [0, selected.length].concat(ids));
        closeFind();
      },
    });
    findRefresh = picker.refresh;
    card.appendChild(head);
    card.appendChild(picker.node);
    mask.appendChild(card);
    lockSheetPage(mask, function () {
      closeFind();
      if (!applied.length) modeActive = "all";
      updateModeButtons();
    });
    document.body.appendChild(mask);
    findSheet = mask;
    const box = mask.querySelector(".tag-picker-suggest");
    if (box) {
      box.scrollTop = 1;
      box.scrollTop = 0;
    }
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function addScopeSwitch(host, key, label) {
    const lab = document.createElement("label");
    lab.className = "ask-skip";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = !!findScope[key];
    const sw = document.createElement("span");
    sw.className = "ask-sw";
    lab.appendChild(name);
    lab.appendChild(input);
    lab.appendChild(sw);
    input.addEventListener("change", function () {
      findScope[key] = !!input.checked;
      if (findRefresh) findRefresh();
    });
    host.appendChild(lab);
  }

  function openSearchSettings() {
    closeFind({ repaint: false });
    closeList();
    closeBatch();
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = "搜尋設定";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", closeBatch);
    head.appendChild(title);
    head.appendChild(close);
    card.appendChild(head);
    addScopeSwitch(card, "tag", "標籤");
    addScopeSwitch(card, "text", "文字");
    addScopeSwitch(card, "qr", "QR");
    mask.appendChild(card);
    lockSheetPage(mask, closeBatch);
    document.body.appendChild(mask);
    batchSheet = mask;
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function closeBatch() {
    if (findSheet && batchSheet) {
      findSheet.remove();
      findSheet = null;
      finding = false;
    }
    if (batchSheet) batchSheet.remove();
    batchSheet = null;
    unlockBoard();
  }

  function openFolderFind(ids, onPicked) {
    if (findSheet) {
      findSheet.remove();
      findSheet = null;
    }
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask list-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet list-tag-sheet";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = ids.length ? "再找？" : "搜尋標籤";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    function shut() {
      closeFind({ repaint: false });
    }
    close.addEventListener("click", shut);
    head.appendChild(title);
    head.appendChild(close);
    const picker = createPicker({
      ids: ids,
      hideGo: true,
      hideChosen: true,
      alwaysSuggest: true,
      allowNew: false,
      onChange: function () {
        closeFind({ repaint: false });
        if (onPicked) onPicked();
      },
      onSubmit: function () {},
    });
    findRefresh = picker.refresh;
    card.appendChild(head);
    card.appendChild(picker.node);
    mask.appendChild(card);
    lockSheetPage(mask, shut);
    document.body.appendChild(mask);
    findSheet = mask;
    const box = mask.querySelector(".tag-picker-suggest");
    if (box) {
      box.scrollTop = 1;
      box.scrollTop = 0;
    }
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function openFolderCard(folder) {
    closeFind({ repaint: false });
    closeList();
    closeBatch();
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet is-folder";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = folder && folder.title ? folder.title : "新資料夾";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", closeBatch);
    head.appendChild(title);
    head.appendChild(close);
    const name = tagInput(
      (window.FamilyFeed && window.FamilyFeed.nextFolderTitle && window.FamilyFeed.nextFolderTitle()) ||
        "新資料夾1"
    );
    name.placeholder =
      (window.FamilyFeed && window.FamilyFeed.nextFolderTitle && window.FamilyFeed.nextFolderTitle()) ||
      "新資料夾1";
    if (folder && folder.title && !/^新資料夾\d+$/.test(folder.title)) {
      name.value = folder.title;
    } else if (folder && folder.title) {
      name.value = folder.title;
    }
    name.setAttribute("enterkeyhint", "done");
    const nameRow = document.createElement("form");
    nameRow.className = "tag-picker-form";
    nameRow.autocomplete = "off";
    nameRow.addEventListener("submit", function (ev) {
      ev.preventDefault();
      name.blur();
    });
    nameRow.appendChild(name);
    const ids = ((folder && folder.tag_ids) || []).slice();
    const go = document.createElement("button");
    go.type = "button";
    go.className = "tag-apply";
    go.disabled = !ids.length;
    const picker = createPicker({
      ids: ids,
      hideGo: true,
      hideInput: true,
      allowNew: false,
      onChange: function () {
        go.disabled = !ids.length;
      },
      onSubmit: function () {},
    });
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "tag-search-input";
    ask.textContent = "搜尋標籤";
    const askRow = document.createElement("div");
    askRow.className = "tag-picker-form folder-find-ask";
    askRow.appendChild(ask);
    ask.addEventListener("click", function () {
      openFolderFind(ids, function () {
        picker.refresh();
        go.disabled = !ids.length;
      });
    });
    name.addEventListener("focus", function () {
      card.classList.add("is-folder-name");
    });
    name.addEventListener("blur", function () {
      window.setTimeout(function () {
        if (document.activeElement === name) return;
        card.classList.remove("is-folder-name");
      }, 180);
    });
    const face = document.createElement("span");
    face.className = "tag-apply-face";
    const label = document.createElement("span");
    label.textContent = "確認";
    face.appendChild(label);
    go.appendChild(face);
    let busy = false;
    function submitFolder(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busy || go.disabled || !ids.length || !window.FamilyFeed || !window.FamilyFeed.saveFolder) {
        return;
      }
      busy = true;
      go.disabled = true;
      if (name.blur) name.blur();
      window.FamilyFeed.saveFolder({
        id: folder && folder.id,
        title: String(name.value || "").trim(),
        tag_ids: ids.slice(),
      }).then(
        function () {
          closeBatch();
        },
        function () {
          busy = false;
          go.disabled = !ids.length;
        }
      );
    }
    go.addEventListener("pointerdown", function (ev) {
      if (ev.button && ev.button !== 0) return;
      ev.preventDefault();
      submitFolder(ev);
    });
    go.addEventListener("click", submitFolder);
    card.appendChild(head);
    card.appendChild(nameRow);
    card.appendChild(picker.node);
    card.appendChild(askRow);
    card.appendChild(go);
    mask.appendChild(card);
    lockSheetPage(mask, closeBatch);
    document.body.appendChild(mask);
    batchSheet = mask;
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function openBatch() {
    closeFind({ repaint: false });
    closeList();
    closeBatch();
    const mask = document.createElement("div");
    mask.className = "batch-tag-mask";
    const card = document.createElement("div");
    card.className = "batch-tag-sheet";
    const head = document.createElement("div");
    head.className = "batch-tag-head";
    const title = document.createElement("p");
    title.textContent = "加上標籤";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "batch-tag-close";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    close.addEventListener("click", closeBatch);
    head.appendChild(title);
    head.appendChild(close);
    const ids = [];
    const picker = createPicker({
      ids: ids,
      actionText: "加上",
      allowNew: true,
      onSubmit: function (choices, fresh) {
        const picks = choices.slice();
        if (fresh) picks.push({ label: fresh });
        if (!picks.length || !window.FamilyFeed) return;
        window.FamilyFeed.tagSelected(picks).then(function (payload) {
          if (payload) closeBatch();
        });
      },
    });
    card.appendChild(head);
    card.appendChild(picker.node);
    mask.appendChild(card);
    mask.addEventListener("click", function (ev) {
      if (ev.target === mask) closeBatch();
    });
    document.body.appendChild(mask);
    batchSheet = mask;
    setBoardInert(true);
    document.documentElement.classList.add("tag-modal-open");
  }

  function ensureSheet() {
    if (sheet && sheet.isConnected) return sheet;
    sheet = document.createElement("div");
    sheet.className = "pswp-tag-sheet";
    sheet.hidden = true;
    sheet.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });
    sheet.addEventListener("pointerdown", function (ev) {
      ev.stopPropagation();
    });
    return sheet;
  }

  function hostSheet() {
    const host = document.querySelector(".pswp");
    const node = ensureSheet();
    if (host && node.parentNode !== host) host.appendChild(node);
    return node;
  }

  function faceCubeOn() {
    try {
      return localStorage.getItem("family.faceCube") !== "0";
    } catch (e) {
      return true;
    }
  }

  function applyFaceCube() {
    const on = faceCubeOn();
    if (faceCube) {
      const box = faceCube.querySelector("input");
      if (box) box.checked = on;
      faceCube.hidden = !sheetItem || sheetItem.kind === "video";
    }
    if (faceLayer) faceLayer.classList.toggle("is-off", !on);
  }

  function ensureFaceCube() {
    if (faceCube && faceCube.isConnected) return faceCube;
    faceCube = document.createElement("label");
    faceCube.className = "pswp-face-cube";
    const name = document.createElement("span");
    name.className = "pswp-face-cube-name";
    name.textContent = "face cube";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("role", "switch");
    box.setAttribute("aria-label", "face cube");
    box.checked = faceCubeOn();
    const sw = document.createElement("span");
    sw.className = "pswp-face-cube-sw";
    box.addEventListener("change", function () {
      try {
        localStorage.setItem("family.faceCube", box.checked ? "1" : "0");
      } catch (e) {}
      applyFaceCube();
      if (box.checked) layoutFaces();
    });
    faceCube.appendChild(name);
    faceCube.appendChild(box);
    faceCube.appendChild(sw);
    return faceCube;
  }

  function hostFaceCube() {
    const host = document.querySelector(".pswp");
    const node = ensureFaceCube();
    if (host && node.parentNode !== host) host.appendChild(node);
    applyFaceCube();
    return node;
  }

  function afterChange(payload, item, body) {
    if (body && body.action === "merge") followMerge(body.id, body.into);
    if (item && stillOn(item)) paintSheet(payload);
    // The write already answers with the whole board, so fetching it again
    // only doubled the wait after every tap.
    if (payload && payload.groups) paint(payload);
    else load();
    if (!sheetItem) syncFeedIfNeeded();
  }

  function runChange(body, working, said) {
    const item = sheetItem;
    window.FamilyBusy.start(working);
    return photoPost(body, item).then(
      function (payload) {
        window.FamilyBusy.done(said);
        afterChange(payload, item, body);
        return payload;
      },
      function () {
        window.FamilyBusy.done("沒有存到，請再試一次");
        return null;
      }
    );
  }

  function photoAsk() {
    if (!sheet) return;
    const input = sheet.querySelector(".tag-search-input");
    if (!input) return;
    const searching = sheet.classList.contains("is-searching");
    const on = sheet.querySelector(".tag-chip-wrap.is-on");
    const tag = on && tagById(on.dataset.id);
    if (searching && tag && tag.kind === "person") {
      input.placeholder = "輸入人物標籤";
    } else if (tag && RENAMEABLE[tag.kind]) {
      input.placeholder = "更改標籤";
    } else {
      input.placeholder = "新增標籤";
    }
  }

  function paintSheet(data, keepFaces) {
    if (data && data.groups) lastBoard.groups = data.groups;
    const node = hostSheet();
    node.classList.remove("is-searching");
    node.innerHTML = "";
    const card = document.createElement("div");
    card.className = "pswp-tag-card";
    node.appendChild(card);
    const title = document.createElement("p");
    title.className = "pswp-tag-title";
    title.textContent = sheetItem && sheetItem.trash
      ? "垃圾桶"
      : sheetItem && sheetItem.kind === "video"
        ? "這支的標記"
        : "這張的標記";
    card.appendChild(title);
    const row = document.createElement("div");
    row.className = "pswp-tag-row";
    const photoTags = (data && data.photo && data.photo.tags) || [];
    const tags = sheetItem && sheetItem.trash
      ? photoTags.filter(function (tag) {
          return tag && tag.id === DELETE_ID;
        })
      : photoTags;
    const onPhoto = {};
    tags.forEach(function (tag) {
      if (tag && tag.id) onPhoto[tag.id] = true;
    });
    if (!tags.length) {
      const empty = document.createElement("span");
      empty.className = "pswp-tag-empty";
      empty.textContent = "還沒有標記";
      empty.style.opacity = "0.7";
      empty.style.fontSize = "13px";
      row.appendChild(empty);
    }
    let renaming = null;
    function renameTarget() {
      if (renaming) return renaming;
      const on = row.querySelector(".tag-chip-wrap.is-on");
      if (!on) return null;
      const id = on.dataset.id;
      for (let i = 0; i < tags.length; i++) {
        if (tags[i].id === id && RENAMEABLE[tags[i].kind]) return tags[i];
      }
      return null;
    }
    const form = document.createElement("form");
    form.className = "pswp-tag-add tag-picker-form";
    form.autocomplete = "off";
    const input = tagInput("新增標籤");
    const go = submitArrow("新增");
    const suggest = document.createElement("div");
    suggest.className = "pswp-tag-suggest tag-picker-suggest";

    function ghostChip(label) {
      const empty = row.querySelector(".pswp-tag-empty");
      if (empty) empty.remove();
      const wrap = document.createElement("span");
      wrap.className = "tag-chip-wrap is-ghost";
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip";
      chip.textContent = "#" + label;
      wrap.appendChild(chip);
      row.appendChild(wrap);
      input.value = "";
      renderSuggest();
    }

    function isAutoPersonCluster(tag) {
      return !!(
        tag &&
        tag.kind === "person" &&
        tag.auto &&
        /^p\d+$/i.test(String(tag.label || ""))
      );
    }

    function tagPhotoCount(tagId) {
      const row = tagById(tagId);
      return row ? Number(row.count) || 0 : 0;
    }

    function runMerge(src, dst, done) {
      runChange(
        { action: "merge", id: src.id, into: dst.id },
        "正在把 #" + src.label + " 併進 #" + dst.label + "…",
        "已併進 #" + dst.label
      );
      if (done) done();
    }

    function askNamedMergeConfirm(src, dst, onClose) {
      const count = tagPhotoCount(src.id);
      const mask = document.createElement("div");
      mask.className = "batch-tag-mask retag-choice-mask retag-confirm-mask";
      const card = document.createElement("div");
      card.className = "batch-tag-sheet retag-choice-sheet";
      const head = document.createElement("div");
      head.className = "batch-tag-head";
      const title = document.createElement("p");
      title.textContent =
        "此步驟會修改 " + count + " 張照片的標記，無法復原。";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "batch-tag-close";
      close.setAttribute("aria-label", "關閉");
      close.textContent = "×";
      function shut() {
        mask.remove();
        if (onClose) onClose();
      }
      close.addEventListener("click", shut);
      head.appendChild(title);
      head.appendChild(close);
      const go = document.createElement("button");
      go.type = "button";
      go.className = "tag-apply";
      const face = document.createElement("span");
      face.className = "tag-apply-face";
      face.textContent = "修改標籤";
      go.appendChild(face);
      go.addEventListener("click", function () {
        shut();
        runMerge(src, dst);
      });
      card.appendChild(head);
      card.appendChild(go);
      mask.appendChild(card);
      lockSheetPage(mask, shut);
      document.body.appendChild(mask);
    }

    function askRetagChoice(src, dst) {
      const box = selectedBBox ? selectedBBox.slice() : null;
      const mask = document.createElement("div");
      mask.className = "batch-tag-mask retag-choice-mask";
      const card = document.createElement("div");
      card.className = "batch-tag-sheet retag-choice-sheet";
      const head = document.createElement("div");
      head.className = "batch-tag-head";
      const title = document.createElement("p");
      title.textContent =
        "這張標成 #" + src.label + "，要改成 #" + dst.label + " 嗎？";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "batch-tag-close";
      close.setAttribute("aria-label", "關閉");
      close.textContent = "×";
      function shut() {
        mask.remove();
      }
      close.addEventListener("click", shut);
      head.appendChild(title);
      head.appendChild(close);
      const coverLab = document.createElement("label");
      coverLab.className = "ask-skip retag-cover-all";
      const coverName = document.createElement("span");
      coverName.textContent = "覆蓋所有";
      const coverAll = document.createElement("input");
      coverAll.type = "checkbox";
      coverAll.setAttribute("role", "switch");
      coverAll.checked = false;
      const coverSw = document.createElement("span");
      coverSw.className = "ask-sw";
      coverLab.appendChild(coverName);
      coverLab.appendChild(coverAll);
      coverLab.appendChild(coverSw);
      const go = document.createElement("button");
      go.type = "button";
      go.className = "tag-apply";
      const face = document.createElement("span");
      face.className = "tag-apply-face";
      function syncGo() {
        face.textContent = coverAll.checked ? "全部修改" : "只改這張";
      }
      coverAll.addEventListener("change", syncGo);
      syncGo();
      go.appendChild(face);
      go.addEventListener("click", function () {
        if (!coverAll.checked) {
          shut();
          const body = { action: "retag_on_photo", id: src.id, into: dst.id };
          if (box) body.bbox = box;
          runChange(
            body,
            "正在把這張改成 #" + dst.label + "…",
            "這張已改成 #" + dst.label
          );
          return;
        }
        if (isAutoPersonCluster(src)) {
          shut();
          runMerge(src, dst);
          return;
        }
        askNamedMergeConfirm(src, dst, shut);
      });
      card.appendChild(head);
      card.appendChild(coverLab);
      card.appendChild(go);
      mask.appendChild(card);
      lockSheetPage(mask, shut);
      document.body.appendChild(mask);
    }

    function askDeleteTag(tag) {
      if (!tag || !tag.id) return;
      if (tag.id === DELETE_ID) {
        const ok = window.confirm("把這張從垃圾桶救回來？");
        if (!ok) return;
        runChange({ action: "detach", id: DELETE_ID }, "正在救回…", "已救回").then(
          function (payload) {
            if (payload && window.FamilyFeed && window.FamilyFeed.refresh) {
              window.FamilyFeed.refresh();
            }
          }
        );
        return;
      }
      const ok = window.confirm("從這張拿掉「#" + tag.label + "」？");
      if (!ok) return;
      runChange(
        { action: "detach", id: tag.id },
        "正在拿掉 #" + tag.label + "…",
        "已從這張拿掉 #" + tag.label
      );
    }

    function showChipX() {
      if (!sheet) return;
      sheet.querySelectorAll(".tag-chip-wrap").forEach(function (wrap) {
        const x = wrap.querySelector(".ins-x");
        if (x) x.hidden = !wrap.classList.contains("is-on");
      });
    }

    function matches() {
      const q = input.value;
      const target = renameTarget();
      if (target) {
        return catalogOf(q, {
          kind: target.kind,
          exceptId: target.id,
          customPeople: target.kind === "person",
        });
      }
      return catalogOf(q, { exceptIds: onPhoto, hideAutoPeople: !q });
    }

    let searchArm = 0;
    let searchArmTimer = 0;

    function clearSearchArm() {
      if (searchArmTimer) {
        window.clearTimeout(searchArmTimer);
        searchArmTimer = 0;
      }
    }

    function renderSuggest() {
      if (!node.classList.contains("is-searching")) {
        suggest.innerHTML = "";
        return;
      }
      const target = renameTarget();
      renderSuggestions(
        suggest,
        input.value,
        target
          ? {
              kind: target.kind,
              exceptId: target.id,
              customPeople: target.kind === "person",
            }
          : { exceptIds: onPhoto, hideAutoPeople: !input.value },
        function (hit) {
          if (Date.now() < searchArm) return;
          const target = renameTarget();
          if (target) {
            askRetagChoice(target, hit);
            return;
          }
          ghostChip(hit.label);
          runChange(
            { action: "attach", id: hit.id },
            "正在加上 #" + hit.label + "…",
            "已加上 #" + hit.label
          );
        }
      );
    }

    function exitRename() {
      renaming = null;
      go.setAttribute("aria-label", "新增");
      go.title = "新增";
      input.value = "";
      renderSuggest();
      photoAsk();
    }

    function enterRename(tag) {
      renaming = tag;
      go.setAttribute("aria-label", "改名");
      go.title = "改名";
      input.value =
        tag.kind === "person" && tag.auto && /^p\d+$/i.test(String(tag.label || ""))
          ? ""
          : tag.label;
      if (document.activeElement === input && input.value) input.select();
    }

    function revealSearch(fromType) {
      clearSearchArm();
      if (fromType) searchArm = 0;
      if (!input.isConnected) return;
      const target = renameTarget();
      if (target && !renaming) enterRename(target);
      node.classList.add("is-searching");
      title.textContent = target && target.kind === "person" ? "這是誰?" : "建議的標籤";
      renderSuggest();
      photoAsk();
    }

    function enterSearch() {
      if (node.classList.contains("is-searching")) {
        revealSearch();
        return;
      }
      const target = renameTarget();
      if (target && !renaming) enterRename(target);
      photoAsk();
      // Same tap that focuses the field also used to paint the white card and
      // name chips under the finger. iOS then hid the keyboard and treated the
      // leftover click as "change to that name". Keep the field still until
      // this gesture is finished.
      searchArm = Date.now() + 480;
      clearSearchArm();
      searchArmTimer = window.setTimeout(function () {
        searchArmTimer = 0;
        if (document.activeElement !== input) return;
        revealSearch();
      }, 400);
    }

    function leaveSearch() {
      window.setTimeout(function () {
        if (node.contains(document.activeElement)) return;
        clearSearchArm();
        node.classList.remove("is-searching");
        title.textContent = sheetItem && sheetItem.kind === "video" ? "這支的標記" : "這張的標記";
        suggest.innerHTML = "";
        photoAsk();
      }, 0);
    }

    tags.forEach(function (tag) {
      const wrap = document.createElement("span");
      const restore = !!(sheetItem && sheetItem.trash && tag.id === DELETE_ID);
      wrap.className =
        "tag-chip-wrap" +
        (RENAMEABLE[tag.kind] ? "" : " is-lock") +
        (restore ? " is-on" : "");
      wrap.dataset.id = tag.id;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (RENAMEABLE[tag.kind] ? "" : " is-lock");
      chip.textContent = "#" + tag.label;
      chip.dataset.id = tag.id;
      const x = document.createElement("button");
      x.type = "button";
      x.className = "ins-x";
      x.setAttribute("aria-label", "刪除標記");
      x.textContent = "×";
      x.hidden = !restore;
      x.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        askDeleteTag(tag);
      });
      chip.addEventListener("click", function () {
        highlightFace(tag.id, null);
        showChipX();
        if (renaming && renaming.id === tag.id) {
          exitRename();
          highlightFace(null);
          showChipX();
          return;
        }
        if (renaming) exitRename();
      });
      wrap.appendChild(chip);
      wrap.appendChild(x);
      row.appendChild(wrap);
    });
    card.appendChild(row);
    if (sheetItem && sheetItem.trash) {
      paintFaces([]);
      return;
    }

    let addClick = false;
    go.addEventListener("pointerdown", function () {
      addClick = true;
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      const byAdd = addClick;
      addClick = false;
      if (!byAdd) return;
      const label = (input.value || "").trim().replace(/^#/, "");
      if (!label) return;
      const target = renameTarget();
      if (target) {
        const exact = matches().filter(function (hit) {
          return String(hit.label || "").toLowerCase() === label.toLowerCase();
        });
        if (exact.length === 1) {
          askRetagChoice(target, exact[0]);
          return;
        }
        const body = { action: "retag_on_photo", id: target.id, label: label };
        if (selectedBBox) body.bbox = selectedBBox.slice();
        runChange(
          body,
          "正在把這張改成 #" + label + "…",
          "這張已改成 #" + label
        );
        return;
      }
      const exact = matches().filter(function (hit) {
        return String(hit.label || "").toLowerCase() === label.toLowerCase();
      });
      ghostChip(label);
      if (exact.length === 1) {
        runChange(
          { action: "attach", id: exact[0].id },
          "正在加上 #" + label + "…",
          "已加上 #" + label
        );
        return;
      }
      runChange(
        { action: "create_on_photo", kind: "custom", label: label },
        "正在新增 #" + label + "…",
        "已新增 #" + label
      );
    });
    input.addEventListener("focus", enterSearch);
    input.addEventListener("blur", leaveSearch);
    input.addEventListener("input", function () {
      if (!node.classList.contains("is-searching")) {
        revealSearch(true);
        return;
      }
      renderSuggest();
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && renaming) {
        ev.preventDefault();
        exitRename();
      }
    });
    form.appendChild(input);
    form.appendChild(go);
    card.appendChild(form);
    card.appendChild(suggest);
    const shipped = (data && data.photo && data.photo.faces) || [];
    // The tag sheet and the face boxes are fetched side by side, so whichever
    // lands second must not wipe out boxes the other one already drew.
    if (!keepFaces || shipped.length) paintFaces(shipped);
    if (selectedTag) highlightFace(selectedTag, selectedBBox);
    else photoAsk();
  }

  function currentPswp() {
    return window.FamilyFeed && typeof window.FamilyFeed.pswp === "function"
      ? window.FamilyFeed.pswp()
      : null;
  }

  function isFacePhoto(el) {
    return !!(
      el &&
      el.tagName === "IMG" &&
      el.parentNode &&
      !el.classList.contains("pswp__img--placeholder")
    );
  }

  function currentPhotoImg() {
    const pswp = currentPswp();
    const slide = pswp && pswp.currSlide;
    if (slide && slide.content && isFacePhoto(slide.content.element)) {
      return slide.content.element;
    }
    const items = document.querySelectorAll(".pswp__item");
    let item = null;
    items.forEach(function (el) {
      if (el.getAttribute("aria-hidden") !== "true") item = el;
    });
    if (!item && items.length) item = items[0];
    if (!item) return null;
    const imgs = item.querySelectorAll("img.pswp__img");
    let img = null;
    imgs.forEach(function (el) {
      if (isFacePhoto(el)) img = el;
    });
    return img;
  }

  function cancelFaceLayout() {
    if (faceLayFrame) {
      window.cancelAnimationFrame(faceLayFrame);
      faceLayFrame = 0;
    }
    faceLayTries = 0;
  }

  function askFaceLayout() {
    if (faceLayFrame) return;
    faceLayFrame = window.requestAnimationFrame(function () {
      faceLayFrame = 0;
      layoutFaces();
    });
  }

  function ensureFaceLayer() {
    if (faceLayer && faceLayer.isConnected) return faceLayer;
    document.querySelectorAll(".pswp-face-layer").forEach(function (el) {
      el.remove();
    });
    faceLayer = document.createElement("div");
    faceLayer.className = "pswp-face-layer";
    return faceLayer;
  }

  function clearFaces() {
    faceTick += 1;
    cancelFaceLayout();
    faceBoxes = [];
    document.querySelectorAll(".pswp-face-layer").forEach(function (el) {
      el.remove();
    });
    faceLayer = null;
  }

  function wrapScale(slide) {
    if (!slide) return 1;
    const base = slide.currentResolution || (slide.zoomLevels && slide.zoomLevels.initial) || 1;
    const z = (slide.currZoomLevel || base) / base;
    return z > 0 ? z : 1;
  }

  function syncFaceZoom() {
    if (!faceLayer || !faceLayer.isConnected || !faceBoxes.length) return false;
    const img = currentPhotoImg();
    if (!img || !img.parentNode) return false;
    const pswp = currentPswp();
    const content = pswp && pswp.currSlide && pswp.currSlide.content;
    let w = img.offsetWidth;
    let h = img.offsetHeight;
    if (content && content.element === img && content.displayedImageWidth >= 8) {
      w = content.displayedImageWidth;
      h = content.displayedImageHeight;
    }
    if (w < 8 || h < 8) return false;
    const widthPx = w + "px";
    const heightPx = h + "px";
    if (faceLayer.style.width !== widthPx) faceLayer.style.width = widthPx;
    if (faceLayer.style.height !== heightPx) faceLayer.style.height = heightPx;
    const leftPx = img.offsetLeft + "px";
    const topPx = img.offsetTop + "px";
    if (faceLayer.style.left !== leftPx) faceLayer.style.left = leftPx;
    if (faceLayer.style.top !== topPx) faceLayer.style.top = topPx;
    const z = wrapScale(pswp && pswp.currSlide);
    faceLayer.style.setProperty("--face-z", String(z));
    placeFaceNames(z);
    return true;
  }

  function placeFaceNames(z) {
    if (!faceLayer) return;
    const lw = faceLayer.offsetWidth;
    const lh = faceLayer.offsetHeight;
    if (lw < 8 || lh < 8) return;
    z = z > 0 ? z : 1;
    const pad = 4;
    const nodes = faceLayer.querySelectorAll(".pswp-face");
    nodes.forEach(function (box, i) {
      const face = faceBoxes[i];
      if (!face || !face.bbox) return;
      const cap = box.querySelector("span");
      if (cap) {
        cap.style.maxWidth = Math.min(160, Math.max(32, lw - pad * 2)) + "px";
      }
      const nw = box.offsetWidth;
      const nh = box.offsetHeight;
      const vw = nw / z;
      const vh = nh / z;
      const x1 = face.bbox[0];
      const y1 = face.bbox[1];
      const x2 = face.bbox[2];
      const y2 = face.bbox[3];
      const cx = ((x1 + x2) / 2) * lw;
      const faceTop = y1 * lh;
      const faceBot = y2 * lh;
      let left = cx - vw / 2;
      let top = faceTop - vh - pad;
      if (top < pad) top = faceBot + pad;
      if (top + vh > lh - pad) top = Math.max(pad, lh - pad - vh);
      if (left < pad) left = pad;
      if (left + vw > lw - pad) left = Math.max(pad, lw - pad - vw);
      box.style.left = Math.round(left) + "px";
      box.style.top = Math.round(top) + "px";
      box.style.transform = "scale(" + 1 / z + ")";
      box.style.transformOrigin = "0 0";
    });
  }

  function fillFaceBoxes() {
    const layer = ensureFaceLayer();
    layer.innerHTML = "";
    faceBoxes.forEach(function (face) {
      const box = document.createElement("div");
      box.className = "pswp-face";
      box.dataset.id = face.id;
      const cap = document.createElement("span");
      cap.textContent = face.label || "";
      const x = document.createElement("button");
      x.type = "button";
      x.className = "ins-x";
      x.setAttribute("aria-label", "刪除人物標記");
      x.textContent = "×";
      x.hidden = true;
      x.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const ok = window.confirm(
          "從這張拿掉「#" + (face.label || "") + "」？"
        );
        if (!ok) return;
        runChange(
          { action: "detach", id: face.id, bbox: face.bbox },
          "正在拿掉 #" + (face.label || "") + "…",
          "已從這張拿掉 #" + (face.label || "")
        );
      });
      box.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        highlightFace(face.id, face.bbox);
      });
      box.appendChild(cap);
      box.appendChild(x);
      layer.appendChild(box);
    });
    if (selectedTag) highlightFace(selectedTag, selectedBBox);
  }

  function layoutFaces() {
    const layer = ensureFaceLayer();
    if (sheetItem && sheetItem.kind === "video") {
      if (layer.parentNode) layer.remove();
      return;
    }
    applyFaceCube();
    if (!faceBoxes.length) {
      if (layer.parentNode) layer.remove();
      return;
    }
    const img = currentPhotoImg();
    const wrap = img && img.parentNode;
    if (!img || !wrap || img.offsetWidth < 8 || img.offsetHeight < 8) {
      if (img && !img.complete && !img.dataset.faceLay) {
        img.dataset.faceLay = "1";
        img.addEventListener(
          "load",
          function () {
            img.dataset.faceLay = "";
            layoutFaces();
          },
          { once: true }
        );
      }
      if (faceLayTries < 24) {
        faceLayTries += 1;
        askFaceLayout();
      }
      return;
    }
    wrap.appendChild(layer);
    if (!layer.querySelector(".pswp-face")) fillFaceBoxes();
    applyFaceCube();
    if (syncFaceZoom()) {
      faceLayTries = 0;
      return;
    }
    if (faceLayTries < 24) {
      faceLayTries += 1;
      askFaceLayout();
    }
  }

  function paintFaces(faces) {
    faceTick += 1;
    faceLayTries = 0;
    faceBoxes = (faces || []).filter(function (face) {
      return face && face.bbox && face.bbox.length === 4;
    });
    if (!faceBoxes.length) {
      layoutFaces();
      return;
    }
    fillFaceBoxes();
    layoutFaces();
  }

  function sameBBox(left, right) {
    if (!left || !right || left.length < 4 || right.length < 4) return false;
    for (let i = 0; i < 4; i++) {
      if (Math.abs(Number(left[i]) - Number(right[i])) > 0.0005) return false;
    }
    return true;
  }

  function highlightFace(id, bbox) {
    selectedTag = id;
    selectedBBox = bbox ? bbox.slice() : null;
    if (faceLayer) {
      faceLayer.querySelectorAll(".pswp-face").forEach(function (el, i) {
        const face = faceBoxes[i];
        const on = !!(
          face &&
          face.id === id &&
          (!selectedBBox || sameBBox(face.bbox, selectedBBox))
        );
        el.classList.toggle("is-on", on);
        const x = el.querySelector(".ins-x");
        if (x) x.hidden = !on;
      });
    }
    if (sheet) {
      sheet.querySelectorAll(".tag-chip-wrap").forEach(function (el) {
        const on = el.dataset.id === id;
        el.classList.toggle("is-on", on);
        const chip = el.querySelector(".tag-chip");
        if (chip) chip.classList.toggle("is-on", on);
        const x = el.querySelector(".ins-x");
        if (x) x.hidden = !on;
      });
    }
    photoAsk();
  }

  function photoQuery(item) {
    return (
      "person=" + encodeURIComponent(item.person) +
      "&bucket=" + encodeURIComponent(item.bucket) +
      "&rel=" + encodeURIComponent(item.rel)
    );
  }

  function photoPost(body, item) {
    item = item || sheetItem;
    if (!item) return Promise.resolve({});
    return post(
      Object.assign(
        {
          person: item.person,
          bucket: item.bucket,
          rel: item.rel,
        },
        body
      )
    );
  }

  function stillOn(item) {
    return (
      !!sheetItem &&
      sheetItem.person === item.person &&
      sheetItem.rel === item.rel &&
      sheetItem.bucket === item.bucket
    );
  }

  function loadPhoto(item) {
    selectedTag = null;
    selectedBBox = null;
    sheetItem = item;
    faceTick += 1;
    cancelFaceLayout();
    faceBoxes = [];
    if (faceLayer) faceLayer.innerHTML = "";
    const node = hostSheet();
    node.classList.remove("is-searching");
    node.innerHTML = "";
    node.hidden = false;
    node.classList.toggle("is-video", item.kind === "video");
    node.classList.toggle("is-trash-photo", !!item.trash);
    setBoardInert(true);
    if (item.trash) {
      if (faceCube) faceCube.hidden = true;
    } else {
      hostFaceCube();
    }
    if (faceCtrl) faceCtrl.abort();
    faceCtrl = new AbortController();
    const ac = faceCtrl;
    const query = photoQuery(item);
    let drewFaces = false;
    // Both answers are wanted straight away. Holding the face request until the
    // tag sheet came back is what left the cubes trailing the photo.
    api("/api/tags?" + query, { signal: ac.signal })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (stillOn(item)) paintSheet(data, drewFaces);
      })
      .catch(function () {});
    if (item.kind === "video" || item.trash) return;
    api("/api/faces?" + query, { signal: ac.signal })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.faces || !stillOn(item)) return;
        drewFaces = true;
        paintFaces(data.faces);
      })
      .catch(function () {});
  }

  function closePhoto() {
    selectedTag = null;
    selectedBBox = null;
    sheetItem = null;
    if (faceCtrl) faceCtrl.abort();
    if (sheet) sheet.hidden = true;
    if (faceCube) faceCube.hidden = true;
    setBoardInert(false);
    clearFaces();
    window.setTimeout(syncFeedIfNeeded, 0);
  }

  function beforePhotoChange() {
    const active = document.activeElement;
    if (sheet && active && sheet.contains(active) && active.blur) active.blur();
    if (sheet) {
      sheet.classList.remove("is-searching");
      const suggest = sheet.querySelector(".pswp-tag-suggest");
      if (suggest) suggest.innerHTML = "";
    }
  }

  function refreshPhoto() {
    if (sheetItem) loadPhoto(sheetItem);
  }

  // iOS does not shrink the layout viewport for the on-screen keyboard, so a sheet
  // pinned to bottom:0 ends up underneath it. visualViewport is the only thing that
  // knows how much of the window the keyboard is actually covering.
  (function watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardUp = false;
    let lastLift = -1;
    let revealTimer = 0;
    let closeTimer = 0;
    let lastHeight = -1;
    let lastTop = -1;
    function sync() {
      const lift = Math.max(0, window.innerHeight - vv.height);
      const height = Math.round(vv.height);
      const top = Math.round(vv.offsetTop);
      if (Math.abs(height - lastHeight) >= 2 || lastHeight < 0) {
        lastHeight = height;
        document.documentElement.style.setProperty("--vvh", height + "px");
      }
      if (Math.abs(top - lastTop) >= 2 || lastTop < 0) {
        lastTop = top;
        document.documentElement.style.setProperty("--vv-top", top + "px");
      }
      if (!keyboardUp && lift > 100) {
        if (closeTimer) window.clearTimeout(closeTimer);
        closeTimer = 0;
        keyboardUp = true;
      } else if (keyboardUp && lift < 40 && !closeTimer) {
        closeTimer = window.setTimeout(function () {
          closeTimer = 0;
          if (Math.max(0, window.innerHeight - vv.height) >= 40) return;
          keyboardUp = false;
          lastLift = 0;
          document.documentElement.style.setProperty("--kb", "0px");
          document.documentElement.classList.remove("kb-up");
        }, 220);
      } else if (lift >= 40 && closeTimer) {
        window.clearTimeout(closeTimer);
        closeTimer = 0;
      }
      if (!(keyboardUp && lift < 40) && (Math.abs(lift - lastLift) >= 6 || lastLift < 0)) {
        lastLift = lift;
        document.documentElement.style.setProperty("--kb", Math.round(lift) + "px");
      }
      document.documentElement.classList.toggle("kb-up", keyboardUp);
    }
    vv.addEventListener("resize", sync);
    document.addEventListener("focusin", function (ev) {
      const target = ev.target;
      if (!target || !target.classList || !target.classList.contains("tag-search-input")) return;
      if (revealTimer) window.clearTimeout(revealTimer);
      revealTimer = window.setTimeout(function () {
        revealTimer = 0;
        sync();
        if (target.closest(".batch-tag-mask, .pswp")) return;
        if (!keyboardUp || document.activeElement !== target || !target.scrollIntoView) return;
        const box = target.getBoundingClientRect();
        const visibleBottom = vv.offsetTop + vv.height;
        if (box.bottom > visibleBottom - 12) target.scrollIntoView({ block: "nearest" });
      }, 520);
    });
    sync();
  })();

  window.FamilyTags = {
    show: function (who) {
      if (person === who) {
        if (Date.now() - lastLoadAt > 15000) load();
        return;
      }
      closeList();
      closeFind({ repaint: false });
      closeBatch();
      person = who;
      mode = "all";
      modeActive = "all";
      finding = false;
      selected = [];
      applied = [];
      lastBoard = { groups: [], job: (lastBoard && lastBoard.job) || {} };
      paint(lastBoard);
      load();
    },
    showPhoto: function (item) {
      if (!item || !item.person) return;
      loadPhoto(item);
    },
    layoutFaces: layoutFaces,
    syncFaceZoom: syncFaceZoom,
    closePhoto: closePhoto,
    beforePhotoChange: beforePhotoChange,
    refreshPhoto: refreshPhoto,
    openBatch: openBatch,
    openFolderCard: openFolderCard,
    openSearchSettings: openSearchSettings,
    setApplied: function (ids) {
      applied = (ids || []).slice();
      selected.splice.apply(selected, [0, selected.length].concat(applied));
      if (!(modeActive === "all" && !applied.length)) modeActive = "";
      if (findSheet) findRefresh();
      else pickerRefresh();
      updateModeButtons();
    },
    accept: accept,
    act: post,
  };
})();
