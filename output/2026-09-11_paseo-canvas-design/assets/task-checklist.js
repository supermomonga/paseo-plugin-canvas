/**
 * 作業チェックリスト。
 *
 * 文書モデルの html block に書かれた [data-task-check] のチェックボックスを集め、
 * チェック状態を localStorage へ保存・復元し、全体とセクション別の進捗を表示する。
 * localStorage が使えない環境 (file:// を制限するブラウザ等) でも、
 * JSON の書き出し・読み込みで状態を持ち運べるようにしている。
 */
(() => {
  "use strict";

  const CHECK_SELECTOR = "input[type=checkbox][data-task-check]";
  const STORAGE_PREFIX = "rhw-checklist:";
  const RESET_ARM_MS = 4000;

  const boxes = Array.from(document.querySelectorAll(CHECK_SELECTOR));
  if (boxes.length === 0) {
    return;
  }

  const documentId = resolveDocumentId();
  const storageKey = STORAGE_PREFIX + documentId;
  const storage = resolveStorage();
  const remoteUrl = resolveRemoteUrl();
  const sections = collectSections(boxes);
  const ui = buildPanel();

  bindEvents();
  init();

  /**
   * まず手元の保存値で表示し、preview server があればその状態で追い越す。
   * サーバー保存があると、別の端末やブラウザで開いても同じ進捗が見える。
   */
  async function init() {
    restoreLocal();
    refresh();
    const remote = await loadRemote();
    if (remote) {
      applyState(remote);
      persistLocal();
      refresh();
    }
  }

  /**
   * サーバー保存に使う URL を決める。file:// で開いた場合は保存先が無いので null。
   */
  function resolveRemoteUrl() {
    if (window.location.protocol !== "http:" && window.location.protocol !== "https:") {
      return null;
    }
    return new URL("annotations/checklist-state.json", window.location.href).toString();
  }

  /** サーバーに保存された状態を読む。未保存・サーバー無しの場合は null を返す。 */
  async function loadRemote() {
    if (!remoteUrl) {
      return null;
    }
    try {
      const response = await fetch(remoteUrl, { cache: "no-store" });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      if (payload && typeof payload === "object" && payload.state) {
        return payload.state;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  /** サーバーへ保存する。サーバーが無い場合や失敗した場合は手元の保存だけで続ける。 */
  async function saveRemote() {
    if (!remoteUrl) {
      return;
    }
    try {
      await fetch(remoteUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
    } catch (err) {
      // サーバーが落ちていても手元の保存で作業を続けられる
    }
  }

  /** localStorage が使えるかを実際の書き込みで確かめる。使えなければ null を返す。 */
  function resolveStorage() {
    try {
      const probe = "__rhw_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      return null;
    }
  }

  /** 保存 key に使う文書識別子を決める。属性が無い場合は title へ退避する。 */
  function resolveDocumentId() {
    const holder = document.querySelector("[data-document-id]");
    const value = holder && holder.getAttribute("data-document-id");
    if (value) {
      return value;
    }
    return document.title || "document";
  }

  /** チェックボックスを所属セクションごとにまとめる。 */
  function collectSections(items) {
    const map = new Map();
    items.forEach((box) => {
      const section = box.closest("section") || document.body;
      if (!map.has(section)) {
        map.set(section, { section: section, boxes: [], label: sectionLabel(section), badge: null });
      }
      map.get(section).boxes.push(box);
    });
    return Array.from(map.values());
  }

  /** セクション見出しの文字列を取り出す。見つからない場合は id で代用する。 */
  function sectionLabel(section) {
    const heading = section.querySelector("h2, h3, h4");
    if (heading && heading.textContent.trim()) {
      return heading.textContent.trim();
    }
    return section.id || "セクション";
  }

  /** 進捗パネルを組み立てて本文の先頭へ差し込む。 */
  function buildPanel() {
    const panel = document.createElement("div");
    panel.className = "checklist-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "作業進捗");

    const head = document.createElement("div");
    head.className = "cl-head";
    const title = document.createElement("span");
    title.className = "cl-title";
    title.textContent = "作業進捗";
    const count = document.createElement("span");
    count.className = "cl-count";
    head.appendChild(title);
    head.appendChild(count);

    const bar = document.createElement("div");
    bar.className = "cl-bar";
    const fill = document.createElement("div");
    fill.className = "cl-fill";
    bar.appendChild(fill);

    const list = document.createElement("div");
    list.className = "cl-sections";

    const actions = document.createElement("div");
    actions.className = "cl-actions";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "cl-btn";
    exportBtn.textContent = "進捗を書き出す";

    const importLabel = document.createElement("label");
    importLabel.className = "cl-btn";
    importLabel.textContent = "進捗を読み込む";
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = "application/json,.json";
    importInput.hidden = true;
    importLabel.appendChild(importInput);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "cl-btn danger";
    resetBtn.textContent = "全解除";

    actions.appendChild(exportBtn);
    actions.appendChild(importLabel);
    actions.appendChild(resetBtn);

    const notice = document.createElement("p");
    notice.className = "cl-notice";
    notice.hidden = true;

    panel.appendChild(head);
    panel.appendChild(bar);
    panel.appendChild(list);
    panel.appendChild(actions);
    panel.appendChild(notice);

    const anchor = document.querySelector(".document-content") || document.querySelector(".paper");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor);
    } else {
      document.body.insertBefore(panel, document.body.firstChild);
    }

    const rows = sections.map((entry) => {
      const row = document.createElement("div");
      row.className = "cl-row";
      const name = document.createElement("span");
      name.className = "cl-row-name";
      name.textContent = entry.label;
      const value = document.createElement("span");
      value.className = "cl-row-count";
      row.appendChild(name);
      row.appendChild(value);
      row.addEventListener("click", () => {
        entry.section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      list.appendChild(row);
      entry.badge = attachHeadingBadge(entry.section);
      return { entry: entry, value: value };
    });

    if (!storage && !remoteUrl) {
      notice.hidden = false;
      notice.textContent =
        "このブラウザでは進捗を自動保存できません。ページを閉じる前に「進捗を書き出す」でファイルへ保存してください。";
    }

    return {
      panel: panel,
      count: count,
      fill: fill,
      rows: rows,
      notice: notice,
      exportBtn: exportBtn,
      importInput: importInput,
      resetBtn: resetBtn,
    };
  }

  /** セクション見出しの右側に件数バッジを付ける。 */
  function attachHeadingBadge(section) {
    const heading = section.querySelector("h2, h3, h4");
    if (!heading) {
      return null;
    }
    const badge = document.createElement("span");
    badge.className = "cl-badge";
    heading.appendChild(badge);
    return badge;
  }

  function bindEvents() {
    boxes.forEach((box) => {
      box.addEventListener("change", () => {
        persist();
        refresh();
      });
    });
    ui.exportBtn.addEventListener("click", exportState);
    ui.importInput.addEventListener("change", importState);
    ui.resetBtn.addEventListener("click", handleReset);
  }

  /** 現在のチェック状態を key/value の平坦な object にする。 */
  function snapshot() {
    const state = {};
    boxes.forEach((box) => {
      state[box.getAttribute("data-task-check")] = box.checked;
    });
    return state;
  }

  /** 書き出しとサーバー保存で共通に使う payload を作る。 */
  function buildPayload() {
    return {
      schema_version: "1.0",
      document_id: documentId,
      exported_at: new Date().toISOString(),
      state: snapshot(),
    };
  }

  function persist() {
    persistLocal();
    saveRemote();
  }

  function persistLocal() {
    if (!storage) {
      return;
    }
    try {
      storage.setItem(storageKey, JSON.stringify(snapshot()));
    } catch (err) {
      ui.notice.hidden = false;
      ui.notice.textContent = "進捗の保存に失敗しました。「進捗を書き出す」でファイルへ保存してください。";
    }
  }

  function restoreLocal() {
    if (!storage) {
      return;
    }
    let raw = null;
    try {
      raw = storage.getItem(storageKey);
    } catch (err) {
      return;
    }
    if (!raw) {
      return;
    }
    try {
      applyState(JSON.parse(raw));
    } catch (err) {
      // 壊れた保存値は無視して初期状態から始める
    }
  }

  /** 保存された状態をチェックボックスへ反映する。 */
  function applyState(state) {
    if (!state || typeof state !== "object") {
      return;
    }
    boxes.forEach((box) => {
      const key = box.getAttribute("data-task-check");
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        box.checked = Boolean(state[key]);
      }
    });
  }

  /** 全体・セクション別の件数表示と、チェック済み行の見た目を更新する。 */
  function refresh() {
    const done = boxes.filter((box) => box.checked).length;
    const total = boxes.length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    ui.count.textContent = done + " / " + total + " (" + percent + "%)";
    ui.fill.style.width = percent + "%";
    ui.panel.setAttribute("data-complete", done === total ? "true" : "false");

    ui.rows.forEach((row) => {
      const entryDone = row.entry.boxes.filter((box) => box.checked).length;
      const entryTotal = row.entry.boxes.length;
      const text = entryDone + " / " + entryTotal;
      row.value.textContent = text;
      row.entry.section.setAttribute("data-checklist-complete", entryDone === entryTotal ? "true" : "false");
      if (row.entry.badge) {
        row.entry.badge.textContent = text;
        row.entry.badge.setAttribute("data-complete", entryDone === entryTotal ? "true" : "false");
      }
    });

    boxes.forEach((box) => {
      const row = box.closest("tr, li");
      if (row) {
        row.classList.toggle("is-checked", box.checked);
      }
    });
  }

  function exportState() {
    const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "checklist-" + documentId + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function importState(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        applyState(payload && payload.state ? payload.state : payload);
        persist();
        refresh();
        ui.notice.hidden = false;
        ui.notice.textContent = "進捗を読み込みました。";
      } catch (err) {
        ui.notice.hidden = false;
        ui.notice.textContent = "読み込めませんでした。書き出した JSON ファイルを選んでください。";
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  /** 全解除は誤操作を防ぐため 2 回押しで確定する。 */
  function handleReset() {
    if (ui.resetBtn.getAttribute("data-armed") === "true") {
      ui.resetBtn.removeAttribute("data-armed");
      ui.resetBtn.textContent = "全解除";
      boxes.forEach((box) => {
        box.checked = false;
      });
      persist();
      refresh();
      return;
    }
    ui.resetBtn.setAttribute("data-armed", "true");
    ui.resetBtn.textContent = "もう一度押すと全解除";
    window.setTimeout(() => {
      if (ui.resetBtn.getAttribute("data-armed") === "true") {
        ui.resetBtn.removeAttribute("data-armed");
        ui.resetBtn.textContent = "全解除";
      }
    }, RESET_ARM_MS);
  }
})();
