(function () {
  "use strict";

  const I18N = Object.freeze({
    ja: {
      cardState: { open: "未対応", reply: "返信あり", resolved: "解決済み" },
      railLabel: "レビューコメント",
      railHeader: "レビュー",
      resolvedBanner: "解決済みにしました",
      replyPlaceholder: "返信を入力…",
      replyLabel: "返信",
      submitBtn: "送信",
      resolveBtn: "解決",
      reopenBtn: "再オープン",
      deleteBtn: "削除",
      commentCount: function (u, t) { return u + " 件未解決 / " + t + " 件"; },
      filterAll: "すべて",
      filterHideResolved: "未解決のみ",
      filterOnlyOpen: "未対応のみ",
      filterLabel: "レビューフィルタ",
      themeTitle: "テーマ切替",
      tocLabel: "目次",
      tocHeader: "目次",
      tocToggleLabel: "目次",
      tocToggleTitle: "目次の表示切替",
      commentsToggleLabel: "コメント",
      commentsToggleTitle: "コメントの表示切替",
      jsonToggleLabel: "JSON",
      jsonToggleTitle: "comments.json の Export / Import",
      publishLabel: "公開プレビュー",
      publishActive: "プレビュー中",
      publishTitle: "公開プレビュー",
      publishStandard: "標準",
      publishMax: "最大化",
      publishDownload: "公開用HTMLを書き出し",
      publishExit: "編集に戻る",
      publishExitLabel: "公開プレビュー",
      publishToast: "公開用HTMLを書き出しました",
      agentReplied: "エージェントが返信しました",
      docUpdated: "ドキュメントが更新されました。リロードして最新版を確認できます",
      saveError: "コメント保存エラー: ",
      reloadBtn: "リロード",
      closeBtn: "閉じる",
    },
    en: {
      cardState: { open: "Open", reply: "Has reply", resolved: "Resolved" },
      railLabel: "Review comments",
      railHeader: "Review",
      resolvedBanner: "Marked as resolved",
      replyPlaceholder: "Write a reply…",
      replyLabel: "Reply",
      submitBtn: "Send",
      resolveBtn: "Resolve",
      reopenBtn: "Reopen",
      deleteBtn: "Delete",
      commentCount: function (u, t) { return u + " unresolved / " + t + " total"; },
      filterAll: "All",
      filterHideResolved: "Unresolved only",
      filterOnlyOpen: "Open only",
      filterLabel: "Review filter",
      themeTitle: "Toggle theme",
      tocLabel: "Table of contents",
      tocHeader: "Contents",
      tocToggleLabel: "Contents",
      tocToggleTitle: "Toggle table of contents",
      commentsToggleLabel: "Comments",
      commentsToggleTitle: "Toggle comments",
      jsonToggleLabel: "JSON",
      jsonToggleTitle: "Export / import comments.json",
      publishLabel: "Publish preview",
      publishActive: "Previewing",
      publishTitle: "Publish preview",
      publishStandard: "Standard",
      publishMax: "Maximize",
      publishDownload: "Export published HTML",
      publishExit: "Back to edit",
      publishExitLabel: "Published preview",
      publishToast: "Published HTML exported",
      agentReplied: "Agent replied",
      docUpdated: "Document has been updated. Reload to see the latest version.",
      saveError: "Comment save error: ",
      reloadBtn: "Reload",
      closeBtn: "Close",
    },
  });

  const lang = document.documentElement.lang === "ja" ? "ja" : "en";
  const t = I18N[lang];

  // 目次から飛んだとき、見出しを可視領域の上端から何 px 下に止めるか。
  // 基準は block の上端ではなく見出しそのものにする。block の上余白は種類ごとに違い
  // (実測 14px / 38px)、上端合わせだと見出しの止まる位置が節ごとにばらつくため。
  const TOC_JUMP_OFFSET = 28;

  const COMMENTS_URL = "annotations/comments.json";
  const STORAGE_PREFIX = "reviewable-html-comments:";
  const THEME_STORAGE_KEY = "reviewable-theme";
  // 目次列とコメント列のドラッグ変更幅の保存先
  const COL_WIDTH_STORAGE_KEY = "reviewable-col-widths";
  const COMMENT_STATUS = Object.freeze({
    needsAgentReview: "needs_agent_review",
    needsUserReply: "needs_user_reply",
    resolved: "resolved",
  });
  const STATUS_VALUES = [
    COMMENT_STATUS.needsAgentReview,
    COMMENT_STATUS.needsUserReply,
    COMMENT_STATUS.resolved,
  ];

  const documentId = document.querySelector("[data-document-id]")?.dataset.documentId || "document";
  const storageKey = STORAGE_PREFIX + documentId;
  const state = {
    comments: { schema_version: "1.0", document_id: documentId, comments: [] },
    selected: null,
    selectionRect: null,
    serverWritable: false,
    ignoreSelectionChange: false,
    activeCommentId: null,
    filter: "all",
    positionFrame: 0,
  };

  // コメントのハイライトと番号は本文の中へ後から差し込まれる。番号は inline なので文字幅が
  // 増え、差し込みの前後で行の折り返しが変わって文章が一瞬ずれて見える (実測で本文が 165px
  // 伸びた)。差し込みが終わるまで本文を隠し、確定した状態だけを見せる。
  // JS が動かない環境では最初から付かないので、本文が消えたままにはならない。
  hideProseUntilSettled();
  initI18nLabels();

  const ui = createUi();
  document.body.appendChild(ui.root);

  initThemeToggle();
  initFilter();
  initPanelToggles();
  initUtilityToggle();
  initColumnResizers();
  initPublishToggle();
  initTocScrollSpy();
  initCommentRailScroll();

  document.addEventListener("selectionchange", scheduleSelectionCapture);
  document.addEventListener("keyup", scheduleSelectionCapture);
  document.addEventListener("mouseup", scheduleSelectionCapture);
  document.addEventListener("pointerup", scheduleSelectionCapture);
  document.addEventListener("scroll", hideFloatingUi, true);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("resize", schedulePositionCards);
  window.addEventListener("load", schedulePositionCards);
  document.fonts?.ready?.then(schedulePositionCards);
  ui.toolbar.addEventListener("mousedown", preserveDocumentSelection);
  ui.commentButton.addEventListener("mousedown", preserveDocumentSelection);
  ui.commentButton.addEventListener("click", openComposerForSelection);
  ui.cancelButton.addEventListener("click", closeComposer);
  ui.saveButton.addEventListener("click", addCommentFromComposer);
  ui.commentBody.addEventListener("keydown", async (event) => {
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      await addCommentFromComposer();
    }
  });
  ui.exportButton.addEventListener("click", exportComments);
  ui.importInput.addEventListener("change", importComments);

  loadComments().then(function () {
    schedulePositionCards();
    initEventSource();
  });

  function createUi() {
    const root = document.createElement("div");
    root.className = "review-comments-root";
    root.innerHTML = [
      '<div class="review-comments-toolbar" data-comments-toolbar hidden>',
      '  <button type="button" data-comment-button>Comment</button>',
      "</div>",
      '<section class="review-comments-composer" data-comments-composer hidden>',
      '  <textarea data-comment-body rows="3" placeholder="Add a comment"></textarea>',
      '  <div class="review-comments-composer-actions">',
      '    <button type="button" data-cancel-comment>Cancel</button>',
      '    <button type="button" data-save-comment>Comment</button>',
      "  </div>",
      "</section>",
      // 常時表示しない。fixed の bar は rail 下部の返信欄・送信ボタンと重なるため、
      // topbar の JSON ボタンで開いたときだけ出す
      '<div class="review-comments-utility" hidden>',
      '  <span class="review-comments-status" data-comments-status>standalone</span>',
      '  <button type="button" data-export-comments>Export</button>',
      '  <label class="review-comments-import">Import<input type="file" accept="application/json" data-import-comments></label>',
      "</div>",
    ].join("");
    const commentRail = ensureCommentRail();
    return {
      root,
      toolbar: root.querySelector("[data-comments-toolbar]"),
      commentButton: root.querySelector("[data-comment-button]"),
      composer: root.querySelector("[data-comments-composer]"),
      commentBody: root.querySelector("[data-comment-body]"),
      cancelButton: root.querySelector("[data-cancel-comment]"),
      saveButton: root.querySelector("[data-save-comment]"),
      exportButton: root.querySelector("[data-export-comments]"),
      importInput: root.querySelector("[data-import-comments]"),
      utilityBar: root.querySelector(".review-comments-utility"),
      status: root.querySelector("[data-comments-status]"),
      commentRail,
      commentLayer: commentRail.querySelector("#cmtLayer"),
      commentCount: commentRail.querySelector("#cmtCount"),
    };
  }

  function ensureCommentRail() {
    const existingLayer = document.getElementById("cmtLayer");
    if (existingLayer) {
      return existingLayer.closest(".cmt-rail") || existingLayer.parentElement;
    }
    const rail = document.createElement("aside");
    rail.className = "cmt-rail review-comments-margin-rail";
    rail.setAttribute("aria-label", t.railLabel);
    rail.innerHTML = [
      '<div class="cmt-rail-h">',
      "  <span>" + t.railHeader + "</span>",
      '  <span class="cmt-rail-count" id="cmtCount">—</span>',
      "</div>",
      '<div class="cmt-layer" id="cmtLayer"></div>',
    ].join("");
    document.body.appendChild(rail);
    return rail;
  }

  function hideProseUntilSettled() {
    const prose = document.querySelector(".prose");
    if (!prose) {
      return;
    }
    prose.classList.add("is-settling");
    // コメントの読み込みが失敗して revealProse に届かない場合の保険。
    // 本文が隠れたままになるのが最悪なので、時間が来たら必ず出す
    window.setTimeout(revealProse, 1200);
  }

  function revealProse() {
    document.querySelector(".prose")?.classList.remove("is-settling");
  }

  async function loadComments() {
    const local = readLocalComments();
    try {
      const response = await fetch(COMMENTS_URL, { cache: "no-store" });
      if (response.ok) {
        state.comments = normalizeComments(await response.json());
        state.serverWritable = true;
      } else {
        state.comments = local;
      }
    } catch (_error) {
      state.comments = local;
    }
    writeLocalComments();
    renderComments();
    revealProse();
  }

  async function saveComments() {
    writeLocalComments();
    try {
      const response = await fetch(COMMENTS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.comments, null, 2),
      });
      if (response.ok) {
        state.serverWritable = true;
        setStatus("comments.json");
      } else {
        var errorMessage = "";
        try {
          var body = await response.json();
          errorMessage = body.error || "";
        } catch (_parseErr) { /* ignore */ }
        state.serverWritable = false;
        setStatus("standalone");
        showSaveError(errorMessage);
      }
      return response.ok;
    } catch (_error) {
      state.serverWritable = false;
      setStatus("standalone");
      return true;
    }
  }

  function scheduleSelectionCapture(event) {
    if (shouldIgnoreSelectionCaptureEvent(event)) {
      return;
    }
    window.setTimeout(captureSelection, 0);
  }

  function shouldIgnoreSelectionCaptureEvent(event) {
    if (!event?.target) {
      return false;
    }
    if (ui.root.contains(event.target) || ui.commentRail?.contains(event.target)) {
      return true;
    }
    return Boolean(event.target.closest?.(".cx[data-comment], [data-comment-badge]"));
  }

  function captureSelection() {
    if (document.body.classList.contains("is-published")) {
      return;
    }
    if (state.ignoreSelectionChange) {
      return;
    }
    if (ui.root.contains(document.activeElement) || ui.commentRail?.contains(document.activeElement)) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelected(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelected(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (closestCommentHighlight(range.commonAncestorContainer)) {
      ui.toolbar.hidden = true;
      return;
    }
    const block = reviewBlockForRange(range);
    if (!block) {
      setSelected(null);
      return;
    }
    const blockText = block.textContent || "";
    const offset = blockText.indexOf(text);
    const anchor = selectionAnchorInBlock(block, range);
    setSelected(
      {
        blockId: block.dataset.reviewBlock,
        selectedText: text,
        prefix: offset >= 0 ? blockText.slice(Math.max(0, offset - 48), offset) : "",
        suffix: offset >= 0 ? blockText.slice(offset + text.length, offset + text.length + 48) : "",
        anchor,
      },
      getRangeRect(range),
    );
  }

  function openComposerForSelection(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.selected || !state.selectionRect) {
      return;
    }
    ui.toolbar.hidden = true;
    showComposerAt(state.selectionRect);
    ui.commentBody.value = "";
    ui.commentBody.focus();
  }

  async function addCommentFromComposer() {
    if (!state.selected) {
      return;
    }
    const comment = ui.commentBody.value;
    if (!comment || !comment.trim()) {
      return;
    }
    const thread = {
      id: "cmt_" + Date.now().toString(36),
      document_id: documentId,
      block_id: state.selected.blockId,
      selected_text: state.selected.selectedText,
      prefix: state.selected.prefix,
      suffix: state.selected.suffix,
      anchor: state.selected.anchor,
      comment: comment.trim(),
      status: COMMENT_STATUS.needsAgentReview,
      created_at: new Date().toISOString(),
      replies: [],
    };
    state.comments.comments.push(thread);
    await saveComments();
    renderComments();
    activate(thread.id, true);
    closeComposer();
    window.getSelection()?.removeAllRanges();
  }

  function renderComments() {
    clearReviewHighlights();
    clearBlockCommentBadges();
    for (const block of document.querySelectorAll("[data-review-block]")) {
      block.classList.remove("has-review-comments");
      block.classList.remove("has-review-replies");
    }
    state.comments.comments.forEach((thread, index) => {
      const block = document.querySelector(`[data-review-block="${cssEscape(thread.block_id)}"]`);
      if (block && !isResolvedThread(thread)) {
        block.classList.add("has-review-comments");
      }
      if (block && isNeedsUserReply(thread)) {
        block.classList.add("has-review-replies");
      }
      if (block) {
        const highlighted = highlightThreadSelection(block, thread, index + 1);
        if (!highlighted) {
          addBlockCommentBadge(block, thread, index + 1);
        }
      }
    });
    renderCommentCards();
    applyFilterVisibility();
    setStatus(state.serverWritable ? "comments.json" : "standalone");
    schedulePositionCards();
  }

  function clearReviewHighlights() {
    for (const highlight of document.querySelectorAll(".cx[data-comment]:not([data-comment-badge])")) {
      const parent = highlight.parentNode;
      if (!parent) {
        continue;
      }
      highlight.querySelectorAll(".cx-num").forEach((badge) => badge.remove());
      while (highlight.firstChild) {
        parent.insertBefore(highlight.firstChild, highlight);
      }
      parent.removeChild(highlight);
      parent.normalize();
    }
  }

  function clearBlockCommentBadges() {
    for (const container of document.querySelectorAll("[data-comment-badges]")) {
      container.remove();
    }
    for (const badge of document.querySelectorAll("[data-comment-badge]")) {
      badge.remove();
    }
  }

  function ensureBlockBadgeContainer(block) {
    let container = block.querySelector(":scope > [data-comment-badges]");
    if (!container) {
      container = document.createElement("div");
      container.className = "review-comment-badges";
      container.dataset.commentBadges = "";
      block.appendChild(container);
    }
    return container;
  }

  function addBlockCommentBadge(block, thread, number) {
    const container = ensureBlockBadgeContainer(block);
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "cx review-comment-badge";
    badge.dataset.comment = thread.id || "";
    badge.dataset.commentBadge = thread.id || "";
    badge.dataset.state = threadCardState(thread);
    // 吹き出しアイコン + 番号。「Comment N」と綴ると 5 個並んだだけで幅を大きく取るため、
    // 何のバッジかはアイコンで示し、文字は番号だけにする
    badge.innerHTML =
      '<svg class="rcb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 3.5h10v7H8l-3 2.5V10.5H3z"/></svg>';
    badge.appendChild(document.createTextNode(String(number)));
    badge.setAttribute("aria-label", `Comment ${number}`);
    badge.title = `Comment ${number}`;
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activate(thread.id, true);
    });
    container.appendChild(badge);
  }

  function highlightThreadSelection(block, thread, number) {
    // Re-resolve offsets against the block's CURRENT text so a highlight stays
    // on the words it was attached to even after the body was edited (or after
    // an earlier comment in the same block shifted the text). Falls back to a
    // plain text search, then to a badge, when the text can't be located.
    const resolved = resolveHighlightOffsets(block, thread);
    if (resolved && highlightByOffsets(block, thread, resolved.start, resolved.end, number)) {
      return true;
    }
    const selectedText = typeof thread.selected_text === "string" ? thread.selected_text.trim() : "";
    if (!selectedText) {
      return false;
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes(selectedText)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (isSvgTextNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest(".cx[data-comment]")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const node = walker.nextNode();
    if (!node) {
      return false;
    }
    const start = node.nodeValue.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selectedText.length);
    const highlight = createHighlightElement(thread);
    range.surroundContents(highlight);
    appendHighlightNumber(highlight, number);
    return true;
  }

  function highlightByOffsets(block, thread, start, end, number) {
    if (end <= start) {
      return false;
    }
    const textNodes = textNodesIn(block);
    let position = 0;
    let highlighted = false;
    for (const node of textNodes) {
      const text = node.nodeValue || "";
      const nodeStart = position;
      const nodeEnd = position + text.length;
      const overlapStart = Math.max(start, nodeStart);
      const overlapEnd = Math.min(end, nodeEnd);
      position = nodeEnd;
      if (overlapStart >= overlapEnd) {
        continue;
      }
      if (isSvgTextNode(node)) {
        continue;
      }
      const includeNumber = !highlighted;
      highlighted = wrapTextNodeSlice(node, overlapStart - nodeStart, overlapEnd - nodeStart, thread, includeNumber ? number : null) || highlighted;
    }
    return highlighted;
  }

  function wrapTextNodeSlice(node, start, end, thread, number) {
    if (start < 0 || end > node.nodeValue.length || start >= end) {
      return false;
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const highlight = createHighlightElement(thread);
    range.surroundContents(highlight);
    if (number) {
      appendHighlightNumber(highlight, number);
    }
    return true;
  }

  // The concatenated text of the block as seen by highlightByOffsets/anchor
  // math (text already inside a comment highlight is excluded, matching the
  // basis used when the anchor was first captured).
  function blockAnchorText(block) {
    return textNodesIn(block).map((node) => node.nodeValue || "").join("");
  }

  // Decide which character offsets to highlight for a thread. Prefer the stored
  // absolute offsets when they still point at the selected text; otherwise
  // re-locate the selected text by its surrounding context so edits to the body
  // don't leave the highlight stranded on the wrong words.
  function resolveHighlightOffsets(block, thread) {
    const selected = typeof thread.selected_text === "string" ? thread.selected_text : "";
    const anchor = thread.anchor;
    const hasAnchor = anchor && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.end > anchor.start;
    if (!selected) {
      return hasAnchor ? { start: anchor.start, end: anchor.end } : null;
    }
    const fullText = blockAnchorText(block);
    if (hasAnchor) {
      const slice = fullText.slice(anchor.start, anchor.end);
      if (slice === selected || slice.trim() === selected) {
        return { start: anchor.start, end: anchor.end };
      }
    }
    return findBestOccurrence(fullText, selected, thread.prefix, thread.suffix);
  }

  // Locate `selected` inside `fullText`. When it occurs more than once, pick the
  // occurrence whose neighbouring text best matches the stored prefix/suffix.
  function findBestOccurrence(fullText, selected, prefix, suffix) {
    if (!selected) {
      return null;
    }
    const occurrences = [];
    let from = fullText.indexOf(selected);
    while (from !== -1) {
      occurrences.push(from);
      from = fullText.indexOf(selected, from + 1);
    }
    if (occurrences.length === 0) {
      return null;
    }
    if (occurrences.length === 1) {
      return { start: occurrences[0], end: occurrences[0] + selected.length };
    }
    const pref = typeof prefix === "string" ? prefix : "";
    const suff = typeof suffix === "string" ? suffix : "";
    let best = occurrences[0];
    let bestScore = -1;
    for (const start of occurrences) {
      const before = fullText.slice(0, start);
      const after = fullText.slice(start + selected.length);
      const score = commonSuffixLen(before, pref) + commonPrefixLen(after, suff);
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    return { start: best, end: best + selected.length };
  }

  function commonPrefixLen(a, b) {
    const max = Math.min(a.length, b.length);
    let count = 0;
    while (count < max && a[count] === b[count]) {
      count += 1;
    }
    return count;
  }

  function commonSuffixLen(a, b) {
    let i = a.length;
    let j = b.length;
    let count = 0;
    while (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i -= 1;
      j -= 1;
      count += 1;
    }
    return count;
  }

  function createHighlightElement(thread) {
    const highlight = document.createElement("span");
    highlight.className = "cx";
    highlight.dataset.comment = thread.id || "";
    highlight.dataset.state = threadCardState(thread);
    highlight.setAttribute("aria-label", thread.comment || "Review comment");
    highlight.tabIndex = 0;
    highlight.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activate(thread.id, true);
    });
    highlight.addEventListener("focus", () => activate(thread.id, false));
    return highlight;
  }

  function appendHighlightNumber(highlight, number) {
    const badge = document.createElement("span");
    badge.className = "cx-num";
    badge.textContent = String(number);
    highlight.appendChild(badge);
  }

  function renderCommentCards() {
    if (!ui.commentLayer) {
      return;
    }
    ui.commentLayer.innerHTML = "";
    state.comments.comments.forEach((thread, index) => {
      ui.commentLayer.appendChild(createCommentCard(thread, index + 1));
    });
    updateCommentCount();
    if (state.activeCommentId) {
      setActiveClasses(state.activeCommentId);
    }
  }

  function createCommentCard(thread, number) {
    const card = document.createElement("aside");
    const cardState = threadCardState(thread);
    card.className = "cmt";
    card.dataset.cstate = cardState;
    card.dataset.for = thread.id || "";
    card.id = cardId(thread.id);
    card.tabIndex = 0;
    card.innerHTML = cardInner(thread, number);
    bindCommentCard(card, thread);
    return card;
  }

  function cardInner(thread, number) {
    const cardState = threadCardState(thread);
    const replies = renderReplies(thread);
    const resolvedBanner = cardState === "resolved"
      ? '<div class="cmt-resolved-by">' + t.resolvedBanner + '</div>'
      : "";
    const replyInput = cardState === "resolved"
      ? ""
      : [
          '<div class="cmt-foot">',
          '  <textarea class="cmt-input" data-thread-reply rows="2" placeholder="' + t.replyPlaceholder + '" aria-label="' + t.replyLabel + '"></textarea>',
          '  <button type="button" class="btn primary" data-thread-reply-submit>' + t.submitBtn + '</button>',
          "</div>",
        ].join("");
    const statusAction = cardState === "resolved"
      ? '<button type="button" class="btn reopen" data-thread-reopen>' + t.reopenBtn + '</button>'
      : '<button type="button" class="btn resolve" data-thread-resolve>' + t.resolveBtn + '</button>';
    return [
      '<div class="cmt-head">',
      '  <div class="cmt-author"><span class="av">You</span> <span>Reviewer</span></div>',
      `  <span class="cmt-state">${escapeHtml(t.cardState[cardState])}</span>`,
      "</div>",
      `<blockquote class="cmt-quote">${escapeHtml(thread.selected_text || thread.block_id || `Comment ${number}`)}</blockquote>`,
      `<div class="cmt-body review-comment-main-body" data-thread-comment-display tabindex="0">${renderCommentMarkdown(thread.comment || "")}</div>`,
      `<textarea data-thread-comment-editor rows="3" hidden>${escapeHtml(thread.comment || "")}</textarea>`,
      replies,
      resolvedBanner,
      replyInput,
      '<div class="cmt-foot">',
      `  ${statusAction}`,
      '  <button type="button" class="btn ghost" data-thread-delete>' + t.deleteBtn + '</button>',
      "</div>",
    ].join("");
  }

  function bindCommentCard(card, thread) {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, textarea, select")) {
        return;
      }
      activate(thread.id, false);
      scrollBodyToComment(thread);
    });
    card.addEventListener("focus", () => activate(thread.id, false));
    card.querySelector("[data-thread-comment-display]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const display = event.currentTarget;
      const editor = card.querySelector("[data-thread-comment-editor]");
      enterCommentEditMode(display, editor);
    });
    const commentEditor = card.querySelector("[data-thread-comment-editor]");
    commentEditor?.addEventListener("keydown", async (event) => {
      if (isSubmitShortcut(event)) {
        event.preventDefault();
        await saveEditedComment(thread, commentEditor);
      }
    });
    commentEditor?.addEventListener("blur", async () => {
      await saveEditedComment(thread, commentEditor);
    });
    card.querySelector("[data-thread-reply-submit]")?.addEventListener("click", async () => {
      const replyEditor = card.querySelector("[data-thread-reply]");
      await addReplyFromEditor(thread, replyEditor);
    });
    card.querySelector("[data-thread-reply]")?.addEventListener("keydown", async (event) => {
      if (isReplySubmitShortcut(event)) {
        event.preventDefault();
        await addReplyFromEditor(thread, event.target);
      }
    });
    card.querySelector("[data-thread-resolve]")?.addEventListener("click", async () => {
      await updateThreadStatus(thread, COMMENT_STATUS.resolved);
    });
    card.querySelector("[data-thread-reopen]")?.addEventListener("click", async () => {
      await updateThreadStatus(thread, COMMENT_STATUS.needsAgentReview);
    });
    card.querySelector("[data-thread-delete]")?.addEventListener("click", async () => {
      state.comments.comments = state.comments.comments.filter((item) => item.id !== thread.id);
      if (state.activeCommentId === thread.id) {
        state.activeCommentId = null;
      }
      await saveComments();
      renderComments();
    });
  }

  async function updateThreadStatus(thread, status) {
    if (!thread || thread.status === status) {
      return;
    }
    thread.status = status;
    await saveComments();
    refreshThreadDisplay(thread);
    activate(thread.id, false);
  }

  function refreshThreadDisplay(thread) {
    replaceCommentCard(thread);
    updateThreadAnchors(thread);
    updateBlockCommentState(thread.block_id);
    updateCommentCount();
    applyFilterVisibility();
    setStatus(state.serverWritable ? "comments.json" : "standalone");
    schedulePositionCards();
  }

  function replaceCommentCard(thread) {
    const index = state.comments.comments.findIndex((item) => item.id === thread.id);
    const current = document.getElementById(cardId(thread.id));
    if (!current || index < 0) {
      return;
    }
    current.replaceWith(createCommentCard(thread, index + 1));
  }

  function updateThreadAnchors(thread) {
    document.querySelectorAll(commentSelector(thread.id)).forEach((element) => {
      element.dataset.state = threadCardState(thread);
    });
  }

  function updateBlockCommentState(blockId) {
    const block = document.querySelector(`[data-review-block="${cssEscape(blockId)}"]`);
    if (!block) {
      return;
    }
    const blockThreads = state.comments.comments.filter((thread) => thread.block_id === blockId);
    block.classList.toggle("has-review-comments", blockThreads.some((thread) => !isResolvedThread(thread)));
    block.classList.toggle("has-review-replies", blockThreads.some(isNeedsUserReply));
  }

  function renderReplies(thread) {
    if (!Array.isArray(thread.replies) || thread.replies.length === 0) {
      return '<div class="cmt-thread"></div>';
    }
    const replies = thread.replies.map((reply) => {
      const agentClass = reply.role === "agent" ? " from-agent" : "";
      return [
        `<div class="reply${agentClass}">`,
        `  <div class="av">${escapeHtml(replyInitials(reply))}</div>`,
        "  <div>",
        `    <div class="reply-name">${escapeHtml(replyAuthor(reply))}<span class="reply-time">${escapeHtml(formatDateTime(reply.created_at))}</span></div>`,
        `    <div class="reply-body">${renderCommentMarkdown(reply.body)}</div>`,
        "  </div>",
        "</div>",
      ].join("");
    }).join("");
    return `<div class="cmt-thread">${replies}</div>`;
  }

  function enterCommentEditMode(display, editor) {
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }
    display.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  async function saveEditedComment(thread, editor) {
    if (!(editor instanceof HTMLTextAreaElement) || editor.hidden) {
      return;
    }
    const body = editor.value.trim();
    if (!body) {
      renderComments();
      activate(thread.id, false);
      return;
    }
    if (body !== thread.comment) {
      thread.comment = body;
      await saveComments();
    }
    renderComments();
    activate(thread.id, false);
  }

  async function addReplyFromEditor(thread, editor) {
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }
    const body = editor.value.trim();
    if (!body) {
      editor.focus();
      return;
    }
    thread.replies = Array.isArray(thread.replies) ? thread.replies : [];
    thread.replies.push({
      id: "reply_" + Date.now().toString(36),
      author: "user",
      role: "user",
      kind: "note",
      body,
      created_at: new Date().toISOString(),
    });
    thread.status = COMMENT_STATUS.needsAgentReview;
    await saveComments();
    renderComments();
    activate(thread.id, false);
    window.setTimeout(() => {
      const nextEditor = document.querySelector(`#${cardId(thread.id)} [data-thread-reply]`);
      if (nextEditor instanceof HTMLTextAreaElement) {
        nextEditor.focus();
      }
    }, 0);
  }

  // Cards flow normally inside the independently scrolling rail; here we only
  // order them to follow their anchors' reading order in the document. The
  // document is never scrolled — the rail scrolls on its own (see
  // scrollActiveCardIntoView). Re-ordering happens only when the order actually
  // changed, so an in-progress rail scroll is never interrupted.
  function positionCards() {
    const layer = document.getElementById("cmtLayer");
    if (!layer) {
      return;
    }
    const cards = Array.from(layer.querySelectorAll(".cmt"));
    for (const card of cards) {
      card.style.position = "";
      card.style.top = "";
    }
    if (!isDesktopRail() || cards.length === 0) {
      return;
    }
    const sorted = cards
      .map((card) => {
        const anchor = document.querySelector(commentSelector(card.dataset.for));
        const top = anchor ? anchor.getBoundingClientRect().top : Number.MAX_SAFE_INTEGER;
        return { card, top };
      })
      .sort((a, b) => a.top - b.top)
      .map((entry) => entry.card);
    const sameOrder = sorted.every((card, index) => cards[index] === card);
    if (!sameOrder) {
      for (const card of sorted) {
        layer.appendChild(card);
      }
    }
  }

  // Scroll ONLY the comment rail so the active card is visible. The document
  // itself never moves; the rail is an independent scroll container.
  function scrollActiveCardIntoView(commentId) {
    const layer = document.getElementById("cmtLayer");
    const card = document.getElementById(cardId(commentId));
    if (!layer || !card || !isDesktopRail()) {
      return;
    }
    const margin = 12;
    const cardTop = card.offsetTop;
    const cardBottom = cardTop + card.offsetHeight;
    const viewTop = layer.scrollTop;
    const viewBottom = viewTop + layer.clientHeight;
    let target = viewTop;
    if (cardTop < viewTop + margin) {
      target = cardTop - margin;
    } else if (cardBottom > viewBottom - margin) {
      target = cardBottom - layer.clientHeight + margin;
    } else {
      return;
    }
    target = Math.max(0, target);
    if (typeof layer.scrollTo === "function") {
      layer.scrollTo({ top: target, behavior: "smooth" });
    } else {
      layer.scrollTop = target;
    }
  }

  function schedulePositionCards() {
    if (state.positionFrame) {
      return;
    }
    state.positionFrame = window.requestAnimationFrame(() => {
      state.positionFrame = 0;
      positionCards();
    });
  }

  function isDesktopRail() {
    const viewDoc = document.getElementById("viewDoc");
    return window.matchMedia("(min-width: 901px)").matches && (!viewDoc || viewDoc.classList.contains("active"));
  }

  // Keep wheel scrolling inside the comment rail from leaking to the document,
  // so the comment column and the body column scroll independently.
  function initCommentRailScroll() {
    const layer = document.getElementById("cmtLayer");
    if (!layer) {
      return;
    }
    layer.addEventListener("wheel", (event) => {
      const maxScroll = layer.scrollHeight - layer.clientHeight;
      if (maxScroll <= 0) {
        return;
      }
      const atTop = layer.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = layer.scrollTop >= maxScroll && event.deltaY > 0;
      if (!atTop && !atBottom) {
        event.preventDefault();
        layer.scrollTop += event.deltaY;
      }
    }, { passive: false });
  }

  // scrollCard=true: activation came from the document side (highlight, badge,
  // new comment) — reveal the matching card by scrolling the RAIL to it, never
  // the document. false: the user is already working inside the card.
  // カードのクリックで、そのコメントが付いた本文位置へ飛ぶ。
  // ハイライトが無いコメント (位置を特定できなかったもの) は所属 block へ飛ぶ
  function scrollBodyToComment(thread) {
    const target =
      document.querySelector(commentSelector(thread.id)) ||
      (thread.block_id ? document.getElementById(thread.block_id) : null);
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const viewHeight = window.innerHeight;
    // 既に視界の読みやすい帯 (上 15%〜70%) にあるなら動かさない
    if (rect.top >= viewHeight * 0.15 && rect.bottom <= viewHeight * 0.7) {
      return;
    }
    const sc = document.getElementById("canvas") || document.documentElement;
    const top =
      rect.top - sc.getBoundingClientRect().top + sc.scrollTop - viewHeight * 0.25;
    sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function activate(commentId, scrollCard = true) {
    if (!commentId) {
      return;
    }
    state.activeCommentId = commentId;
    setActiveClasses(commentId);
    schedulePositionCards();
    if (scrollCard) {
      window.requestAnimationFrame(() => scrollActiveCardIntoView(commentId));
    }
  }

  function setActiveClasses(commentId) {
    document.querySelectorAll(".cx.is-active, .cmt.is-active").forEach((element) => {
      element.classList.remove("is-active");
    });
    if (!commentId) {
      return;
    }
    document.querySelectorAll(commentSelector(commentId)).forEach((highlight) => {
      highlight.classList.add("is-active");
    });
    const card = document.getElementById(cardId(commentId));
    card?.classList.add("is-active");
  }

  function updateCommentCount() {
    if (!ui.commentCount) {
      return;
    }
    const total = state.comments.comments.length;
    const unresolved = state.comments.comments.filter((thread) => !isResolvedThread(thread)).length;
    ui.commentCount.textContent = t.commentCount(unresolved, total);
  }

  function applyFilterVisibility() {
    const canvas = document.getElementById("canvas") || document.body;
    canvas.classList.toggle("hide-resolved", state.filter === "hide-resolved");
    canvas.classList.toggle("only-open", state.filter === "only-open");
    state.comments.comments.forEach((thread) => {
      const visible = shouldShowThreadByFilter(thread);
      document.querySelectorAll(commentSelector(thread.id)).forEach((highlight) => {
        highlight.querySelectorAll(".cx-num").forEach((badge) => {
          badge.hidden = !visible;
        });
      });
      const card = document.getElementById(cardId(thread.id));
      if (card) {
        card.hidden = !visible;
      }
    });
    schedulePositionCards();
  }

  function shouldShowThreadByFilter(thread) {
    const cardState = threadCardState(thread);
    if (state.filter === "hide-resolved") {
      return cardState !== "resolved";
    }
    if (state.filter === "only-open") {
      return cardState === "open";
    }
    return true;
  }

  function initI18nLabels() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.dataset.i18n;
      if (t[key] === undefined) { return; }
      if (el.tagName === "SELECT" || el.tagName === "ASIDE" || el.tagName === "NAV") {
        el.setAttribute("aria-label", t[key]);
      } else {
        el.textContent = t[key];
      }
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.dataset.i18nTitle;
      if (t[key] !== undefined) { el.title = t[key]; }
    });
    document.querySelectorAll("[data-i18n] option[data-i18n]").forEach(function (opt) {
      var key = opt.dataset.i18n;
      if (t[key] !== undefined) { opt.textContent = t[key]; }
    });
  }

  // theme 切替に Mermaid を追従させる。描き直しの実体は mermaid init script 側にあり
  // (公開版にも同じ処理が要るため)、ここは切替後の呼び出しとカード再配置だけを持つ。
  function rerenderMermaid() {
    if (typeof window.__rhwRerenderMermaid !== "function") { return; }
    Promise.resolve(window.__rhwRerenderMermaid()).then(schedulePositionCards, () => {});
  }

  // 目次列とコメント列の幅をドラッグで変える。列幅は CSS 変数 (--toc-w / --rail-w) に
  // 一本化されており、ここは変数の書き換え・clamp・保存だけを行う (grid 構造は変えない)
  function initColumnResizers() {
    const grid = document.querySelector("#canvas .doc-grid");
    if (!grid) {
      return;
    }
    const defs = [
      { key: "toc", varName: "--toc-w", host: ".toc", grow: 1, min: 160, max: 400 },
      { key: "rail", varName: "--rail-w", host: ".cmt-rail", grow: -1, min: 240, max: 560 },
    ];
    let saved = {};
    try {
      saved = JSON.parse(safeLocalStorageGet(COL_WIDTH_STORAGE_KEY) || "{}") || {};
    } catch (e) {
      saved = {};
    }
    defs.forEach((def) => {
      const host = grid.querySelector(def.host);
      if (!host) {
        return;
      }
      const clampWidth = (w) => Math.min(def.max, Math.max(def.min, Math.round(w)));
      if (Number.isFinite(saved[def.key])) {
        grid.style.setProperty(def.varName, clampWidth(saved[def.key]) + "px");
      }
      const handle = document.createElement("div");
      handle.className = "col-resizer col-resizer-" + def.key;
      grid.appendChild(handle);

      let startX = 0;
      let startWidth = 0;
      const onMove = (event) => {
        // grow=1 は右へ引くと広がる列 (目次)、-1 は左へ引くと広がる列 (コメント)
        const width = clampWidth(startWidth + def.grow * (event.clientX - startX));
        grid.style.setProperty(def.varName, width + "px");
        schedulePositionCards();
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.classList.remove("is-col-resizing");
        saved[def.key] = clampWidth(host.getBoundingClientRect().width);
        safeLocalStorageSet(COL_WIDTH_STORAGE_KEY, JSON.stringify(saved));
      };
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        startX = event.clientX;
        startWidth = host.getBoundingClientRect().width;
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.body.classList.add("is-col-resizing");
      });
      handle.addEventListener("dblclick", () => {
        grid.style.removeProperty(def.varName);
        delete saved[def.key];
        safeLocalStorageSet(COL_WIDTH_STORAGE_KEY, JSON.stringify(saved));
        schedulePositionCards();
      });
    });
  }

  // comments.json の Export/Import bar は常時出さず、topbar の JSON ボタンで開閉する。
  // 出しっぱなしだと fixed の bar が rail 下部の返信欄・送信ボタンを覆って操作できない
  function initUtilityToggle() {
    const toolset = document.querySelector(".topbar .toolset");
    if (!toolset || !ui.utilityBar) {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn ghost";
    button.id = "jsonToggle";
    button.title = t.jsonToggleTitle;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML =
      '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"' +
      ' stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12v2h10v-2"/></svg>';
    const label = document.createElement("span");
    label.textContent = t.jsonToggleLabel;
    button.appendChild(label);
    button.addEventListener("click", () => {
      const open = ui.utilityBar.hidden;
      ui.utilityBar.hidden = !open;
      button.setAttribute("aria-pressed", open ? "true" : "false");
    });
    toolset.appendChild(button);
  }

  function initThemeToggle() {
    // 保存済み theme の反映は head の early-theme script が済ませている
    // (Mermaid の初期化より前に確定させる必要があるため)。
    const button = document.getElementById("themeToggle");
    if (!button) {
      return;
    }
    const label = button.querySelector(".tt-label");
    if (label) {
      const current = document.documentElement.dataset.theme || "light";
      label.textContent = current === "dark" ? "Light" : "Dark";
    }
    button.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme;
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      safeLocalStorageSet(THEME_STORAGE_KEY, next);
      if (label) {
        label.textContent = next === "dark" ? "Light" : "Dark";
      }
      rerenderMermaid();
      schedulePositionCards();
    });
  }

  function initFilter() {
    const select = document.getElementById("filterSelect");
    if (!select) {
      return;
    }
    const storageKey = "reviewFilter_" + documentId;
    const saved = localStorage.getItem(storageKey);
    if (saved && Array.from(select.options).some((o) => o.value === saved)) {
      select.value = saved;
    }
    state.filter = select.value || "all";
    select.addEventListener("change", () => {
      state.filter = select.value || "all";
      localStorage.setItem(storageKey, state.filter);
      applyFilterVisibility();
    });
  }

  /**
   * レイアウト変更の前後で、読んでいた箇所を画面上の同じ高さに留める。
   * mutate 内で class や DOM を変え、直後に scrollTop を補正する。
   */
  function keepReadingPosition(mutate) {
    const canvas = document.getElementById("canvas");
    if (!canvas || typeof mutate !== "function") {
      if (typeof mutate === "function") {
        mutate();
      }
      return;
    }
    const paper = canvas.querySelector(".paper");
    const prose = canvas.querySelector(".prose");
    const canvasTopBefore = canvas.getBoundingClientRect().top;
    const anchor = pickReadingAnchor(paper, prose, canvasTopBefore);
    let beforeOffset = null;
    let beforeRatio = null;
    let straddling = false;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      straddling = rect.top < canvasTopBefore && rect.bottom > canvasTopBefore;
      if (straddling && rect.height > 0) {
        beforeRatio = (canvasTopBefore - rect.top) / rect.height;
      } else {
        beforeOffset = rect.top - canvasTopBefore;
      }
    }

    mutate();

    if (!anchor || !document.contains(anchor)) {
      return;
    }
    const canvasTopAfter = canvas.getBoundingClientRect().top;
    const rectAfter = anchor.getBoundingClientRect();
    let delta = 0;
    if (straddling && beforeRatio != null && rectAfter.height > 0) {
      const desiredTop = canvasTopAfter - beforeRatio * rectAfter.height;
      delta = rectAfter.top - desiredTop;
    } else if (beforeOffset != null) {
      const afterOffset = rectAfter.top - canvasTopAfter;
      delta = afterOffset - beforeOffset;
    }
    if (Math.abs(delta) > 0.5) {
      canvas.scrollTop += delta;
    }
  }

  function pickReadingAnchor(paper, prose, canvasTop) {
    const candidates = [];
    const collect = (parent) => {
      if (!parent) {
        return;
      }
      Array.from(parent.children).forEach((el) => {
        if (el.nodeType !== 1) {
          return;
        }
        candidates.push(el);
      });
    };
    collect(paper);
    collect(prose);
    // document 順 (木の先順) に近い並び: paper 直下の後に prose 直下だが、
    // prose は paper 内にあることが多いので、位置でソートする
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
    // 可視領域上端より下に上端がある最初の要素
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) {
        continue;
      }
      if (rect.top >= canvasTop) {
        return el;
      }
    }
    // 上端をまたぐ最も内側 (面積が小さく top が近い) 要素
    let best = null;
    let bestArea = Infinity;
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      if (rect.top < canvasTop && rect.bottom > canvasTop) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          bestArea = area;
          best = el;
        }
      }
    });
    return best;
  }

  function applyHideClass(canvas, className, hide) {
    canvas.classList.toggle(className, hide);
  }

  function initPanelToggles() {
    const canvas = document.getElementById("canvas");
    const tocButton = document.getElementById("tocToggle");
    const commentsButton = document.getElementById("commentsToggle");
    if (!canvas) {
      return;
    }

    const applyStored = (button, className, storageKey) => {
      if (!button) {
        return;
      }
      const stored = localStorage.getItem(storageKey);
      // "true" = 非表示。未設定は表示 (aria-pressed=true)
      const hide = stored === "true";
      applyHideClass(canvas, className, hide);
      button.setAttribute("aria-pressed", hide ? "false" : "true");
    };

    // 初期化はスクロール前のため keepReadingPosition を通さない
    applyStored(tocButton, "hide-toc", "rw:hide-toc");
    applyStored(commentsButton, "hide-comments", "rw:hide-comments");
    if (tocButton || commentsButton) {
      schedulePositionCards();
    }

    const bindToggle = (button, className, storageKey) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        keepReadingPosition(() => {
          const willHide = !canvas.classList.contains(className);
          applyHideClass(canvas, className, willHide);
          button.setAttribute("aria-pressed", willHide ? "false" : "true");
          localStorage.setItem(storageKey, willHide ? "true" : "false");
          schedulePositionCards();
        });
      });
    };

    bindToggle(tocButton, "hide-toc", "rw:hide-toc");
    bindToggle(commentsButton, "hide-comments", "rw:hide-comments");
  }

  function initPublishToggle() {
    const button = document.getElementById("publishToggle");
    if (!button) {
      return;
    }

    button.addEventListener("click", () => {
      setPublished(!document.body.classList.contains("is-published"));
    });

    const exitButton = document.getElementById("pubExitBtn");
    if (exitButton) {
      exitButton.addEventListener("click", () => setPublished(false));
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("is-published")) {
        setPublished(false);
      }
    });

    document.querySelectorAll(".pe-w").forEach((widthButton) => {
      widthButton.addEventListener("click", () => {
        const canvas = document.getElementById("canvas");
        if (!canvas) {
          return;
        }
        keepReadingPosition(() => {
          const isMax = widthButton.getAttribute("data-pw") === "max";
          canvas.classList.toggle("is-wide", isMax);
          localStorage.setItem("rw:pub-wide", isMax ? "true" : "false");
          document.querySelectorAll(".pe-w").forEach((buttonItem) => {
            buttonItem.classList.toggle("on", buttonItem === widthButton);
          });
          schedulePositionCards();
        });
      });
    });

    const downloadButton = document.getElementById("pubDownloadBtn");
    if (downloadButton) {
      downloadButton.addEventListener("click", () => {
        if (window.reviewableWorkbenchPublish) {
          window.reviewableWorkbenchPublish.downloadPublishedDoc({ toastMessage: t.publishToast });
        }
      });
    }
  }

  function setPublished(on) {
    keepReadingPosition(() => {
      document.body.classList.toggle("is-published", on);
      const button = document.getElementById("publishToggle");
      if (button) {
        button.setAttribute("aria-pressed", on ? "true" : "false");
        const label = button.querySelector(".pt-label");
        if (label) {
          label.textContent = on ? t.publishActive : t.publishLabel;
        }
      }
      if (on) {
        const canvas = document.getElementById("canvas");
        if (canvas) {
          const storedWide = localStorage.getItem("rw:pub-wide") === "true";
          canvas.classList.toggle("is-wide", storedWide);
          document.querySelectorAll(".pe-w").forEach((widthButton) => {
            const isMax = widthButton.getAttribute("data-pw") === "max";
            widthButton.classList.toggle("on", isMax === storedWide);
          });
        }
      }
      schedulePositionCards();
    });
  }

  function initTocScrollSpy() {
    const toc = document.querySelector(".toc");
    if (!toc) {
      return;
    }
    const links = Array.from(toc.querySelectorAll("a[href^='#']"));
    // 現在位置の判定は block を対象にする。目次のリンク先は block の id であり、
    // 見出し要素 (h2 等) には id が付かないため、見出しを対象にすると常に該当なしになる
    const blocks = Array.from(document.querySelectorAll(".prose [data-review-block][id]"));
    const canvas = document.getElementById("canvas");
    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const id = link.getAttribute("href")?.slice(1);
        const target = id ? document.getElementById(id) : null;
        if (!target) {
          return;
        }
        const heading = target.querySelector(":scope > h2, :scope > h3, :scope > h4") || target;
        const sc = canvas || document.documentElement;
        sc.scrollTop =
          heading.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - TOC_JUMP_OFFSET;
      });
    });
    const onScroll = rafThrottle(() => updateCurrentSection(links, blocks));
    if (canvas) {
      canvas.addEventListener("scroll", onScroll);
    }
    window.addEventListener("scroll", onScroll);
    updateCurrentSection(links, blocks);

    const tocList = toc.querySelector("ol.toc-list");
    if (tocList) {
      tocList.addEventListener("wheel", (e) => {
        const maxScroll = tocList.scrollHeight - tocList.clientHeight;
        if (maxScroll <= 0) { return; }
        const atTop = tocList.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = tocList.scrollTop >= maxScroll && e.deltaY > 0;
        if (!atTop && !atBottom) {
          e.preventDefault();
          tocList.scrollTop += e.deltaY;
        }
      }, { passive: false });
    }
  }

  function updateCurrentSection(links, blocks) {
    let current = null;
    for (const block of blocks) {
      if (block.getBoundingClientRect().top <= 100) {
        current = block;
      }
    }
    links.forEach((link) => link.classList.remove("current"));
    if (!current) {
      return;
    }
    const link = links.find((item) => item.getAttribute("href") === `#${current.id}`);
    link?.classList.add("current");
  }

  function rafThrottle(callback) {
    let ticking = false;
    return () => {
      if (ticking) {
        return;
      }
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        callback();
      });
    };
  }

  function threadCardState(thread) {
    if (isResolvedThread(thread) || thread.status === "addressed") {
      return "resolved";
    }
    if (isNeedsUserReply(thread) || thread.status === "reply") {
      return "reply";
    }
    return "open";
  }

  function isSubmitShortcut(event) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey);
  }

  function isReplySubmitShortcut(event) {
    if (event.isComposing || event.shiftKey) {
      return false;
    }
    return event.key === "Enter";
  }

  function replyAuthor(reply) {
    if (reply.role === "agent") {
      return reply.author || "Codex";
    }
    if (reply.role === "system") {
      return "System";
    }
    return "You";
  }

  function replyInitials(reply) {
    if (reply.role === "agent") {
      return "AI";
    }
    if (reply.role === "system") {
      return "SYS";
    }
    return "You";
  }

  function isNeedsUserReply(thread) {
    return thread.status === COMMENT_STATUS.needsUserReply;
  }

  function isResolvedThread(thread) {
    return thread.status === COMMENT_STATUS.resolved;
  }

  function handleDocumentClick(event) {
    if (ui.root.contains(event.target) || ui.commentRail?.contains(event.target)) {
      return;
    }
    if (event.target.closest?.(".cx[data-comment]")) {
      return;
    }
    if (captureImageBlockClick(event)) {
      return;
    }
    clearActiveComment();
    closeComposer();
  }

  function clearActiveComment() {
    if (!state.activeCommentId) {
      return;
    }
    state.activeCommentId = null;
    setActiveClasses(null);
  }

  function captureImageBlockClick(event) {
    const image = event.target.closest?.(".generated-image img");
    if (!image) {
      return false;
    }
    const block = image.closest("[data-review-block]");
    if (!block) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    clearDocumentSelectionForNonTextTarget();
    const title = block.querySelector("h2")?.textContent?.trim();
    const caption = block.querySelector("figcaption")?.textContent?.trim();
    setSelected(
      {
        blockId: block.dataset.reviewBlock,
        selectedText: image.getAttribute("alt") || title || caption || "Image",
        prefix: "",
        suffix: caption || "",
        anchor: null,
      },
      image.getBoundingClientRect(),
    );
    return true;
  }

  function preserveDocumentSelection(event) {
    event.preventDefault();
  }

  function closeComposer() {
    ui.composer.hidden = true;
    ui.commentBody.value = "";
  }

  function clearDocumentSelectionForNonTextTarget() {
    state.ignoreSelectionChange = true;
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => {
      state.ignoreSelectionChange = false;
    }, 0);
  }

  function hideFloatingUi(event) {
    if (event?.target && (ui.root.contains(event.target) || ui.commentRail?.contains(event.target))) {
      return;
    }
    ui.toolbar.hidden = true;
    closeComposer();
    schedulePositionCards();
  }

  function exportComments() {
    const blob = new Blob([JSON.stringify(state.comments, null, 2) + "\n"], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "comments.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importComments(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      state.comments = normalizeComments(JSON.parse(String(reader.result)));
      await saveComments();
      renderComments();
    });
    reader.readAsText(file);
    event.target.value = "";
  }

  function readLocalComments() {
    const raw = safeLocalStorageGet(storageKey);
    if (!raw) {
      return { schema_version: "1.0", document_id: documentId, comments: [] };
    }
    try {
      return normalizeComments(JSON.parse(raw));
    } catch (_error) {
      return { schema_version: "1.0", document_id: documentId, comments: [] };
    }
  }

  function writeLocalComments() {
    safeLocalStorageSet(storageKey, JSON.stringify(state.comments));
  }

  function normalizeComments(payload) {
    return {
      schema_version: "1.0",
      document_id: typeof payload.document_id === "string" && payload.document_id ? payload.document_id : documentId,
      comments: Array.isArray(payload.comments) ? payload.comments.map(normalizeThread) : [],
    };
  }

  function normalizeThread(thread) {
    return {
      ...thread,
      status: normalizeThreadStatus(thread?.status),
      replies: Array.isArray(thread?.replies) ? thread.replies : [],
    };
  }

  function normalizeThreadStatus(status) {
    return STATUS_VALUES.includes(status) ? status : COMMENT_STATUS.needsAgentReview;
  }

  function setSelected(selection, rect = null) {
    state.selected = selection;
    state.selectionRect = rect;
    closeComposer();
    if (!selection || !rect) {
      ui.toolbar.hidden = true;
      return;
    }
    positionPopover(ui.toolbar, rect, "above");
    ui.toolbar.hidden = false;
  }

  function showComposerAt(rect) {
    ui.composer.hidden = false;
    positionPopover(ui.composer, rect, "below");
  }

  function setStatus(label) {
    ui.status.textContent = label;
  }

  function closestReviewBlock(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest("[data-review-block]");
  }

  function reviewBlockForRange(range) {
    const commonBlock = closestReviewBlock(range.commonAncestorContainer);
    if (commonBlock) {
      return commonBlock;
    }
    const startBlock = closestReviewBlock(range.startContainer);
    const endBlock = closestReviewBlock(range.endContainer);
    if (startBlock && startBlock === endBlock) {
      return startBlock;
    }
    return startBlock || endBlock;
  }

  function closestCommentHighlight(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest(".cx[data-comment]");
  }

  function getRangeRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    return rects[0] || range.getBoundingClientRect();
  }

  function selectionAnchorInBlock(block, range) {
    const textNodes = textNodesIn(block);
    let position = 0;
    let start = null;
    let end = null;
    for (const node of textNodes) {
      const length = (node.nodeValue || "").length;
      if (node === range.startContainer) {
        start = position + range.startOffset;
      }
      if (node === range.endContainer) {
        end = position + range.endOffset;
      }
      position += length;
    }
    if (start === null || end === null || end <= start) {
      return null;
    }
    return { start, end };
  }

  function textNodesIn(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest(".cx[data-comment], .cx-num")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function isSvgTextNode(node) {
    return Boolean(node.parentElement?.closest("svg"));
  }

  function positionPopover(element, rect, placement) {
    element.hidden = false;
    element.style.visibility = "hidden";
    const margin = 8;
    const width = element.offsetWidth || 280;
    const height = element.offsetHeight || 40;
    const viewportTop = window.scrollY + 8;
    const viewportBottom = window.scrollY + window.innerHeight - 16;
    const belowTop = window.scrollY + rect.bottom + margin;
    const aboveTop = window.scrollY + rect.top - height - margin;
    const fitsBelow = belowTop + height <= viewportBottom;
    const fitsAbove = aboveTop >= viewportTop;
    let rawTop = placement === "above" ? aboveTop : belowTop;
    if (placement === "below" && !fitsBelow && (fitsAbove || aboveTop > viewportTop)) {
      rawTop = aboveTop;
    } else if (placement === "above" && !fitsAbove && fitsBelow) {
      rawTop = belowTop;
    }
    const rawLeft = window.scrollX + rect.left + rect.width / 2 - width / 2;
    const left = Math.min(window.scrollX + window.innerWidth - width - 16, Math.max(window.scrollX + 16, rawLeft));
    const top = Math.min(viewportBottom - height, Math.max(viewportTop, rawTop));
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.style.visibility = "";
  }

  function cardId(commentId) {
    return `card-${cssIdentifier(commentId)}`;
  }

  function commentSelector(commentId) {
    return `.cx[data-comment="${cssEscape(commentId || "")}"]`;
  }

  function cssIdentifier(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // コメント本文の最小 Markdown 表示。> 引用 (入れ子可)・**強調**・`code` だけを
  // HTML へ変換する。保存データと編集 textarea は生テキストのまま、表示だけ変える。
  // 見出しやリンクは対応しない (コメントで実際に使われるのが引用と強調のため)
  function renderCommentMarkdown(text) {
    const lines = String(text || "").split("\n");
    const parts = [];
    let i = 0;
    while (i < lines.length) {
      if (/^\s*>/.test(lines[i])) {
        const quoted = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*> ?/, ""));
          i += 1;
        }
        // 1 段むいた中身を再帰で処理すると > > の入れ子がそのまま入れ子 blockquote になる
        parts.push("<blockquote>" + renderCommentMarkdown(quoted.join("\n")) + "</blockquote>");
      } else {
        const plain = [];
        while (i < lines.length && !/^\s*>/.test(lines[i])) {
          plain.push(lines[i]);
          i += 1;
        }
        let segment = plain.join("\n");
        // blockquote は block 要素で前後に視覚的な区切りが付くため、隣接する空行を
        // pre-wrap でそのまま出すと余白が二重になる。引用に接する側の改行を 1 つ落とす
        if (parts.length) {
          segment = segment.replace(/^\n/, "");
        }
        if (i < lines.length) {
          segment = segment.replace(/\n$/, "");
        }
        parts.push(renderInlineMarkdown(segment));
      }
    }
    return parts.join("");
  }

  function renderInlineMarkdown(text) {
    // escape が先、変換が後。逆にすると本文の HTML が script として解釈される
    let s = escapeHtml(text);
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    return s;
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function safeLocalStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // localStorage can be disabled in strict browser modes; comments still render.
    }
  }

  function initEventSource() {
    if (typeof EventSource === "undefined") {
      return;
    }
    var es = new EventSource("/events");
    es.addEventListener("comment_updated", function (event) {
      try {
        var data = JSON.parse(event.data);
        if (data.source === "browser") {
          return;
        }
      } catch (_error) {
        // continue with refresh
      }
      fetchAndMergeComments();
    });
    es.addEventListener("document_updated", function (event) {
      var message = t.docUpdated;
      try {
        var data = JSON.parse(event.data);
        if (data.message) {
          message = data.message;
        }
      } catch (_error) {
        // use default message
      }
      showUpdateBanner(message);
    });
    es.addEventListener("error", function () {
      // EventSource auto-reconnects; no action needed
    });
  }

  async function fetchAndMergeComments() {
    try {
      var response = await fetch(COMMENTS_URL, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      var payload = normalizeComments(await response.json());
      mergeRemoteComments(payload);
    } catch (_error) {
      // fetch failed; skip this update
    }
  }

  function mergeRemoteComments(newPayload) {
    var oldThreads = state.comments.comments;
    var newThreads = newPayload.comments;
    var oldMap = {};
    oldThreads.forEach(function (thread) { oldMap[thread.id] = thread; });
    var hasNewAgentReply = false;
    var hasNewThread = false;
    var changed = false;
    var changedExistingThreads = [];

    newThreads.forEach(function (newThread) {
      var old = oldMap[newThread.id];
      if (!old) {
        state.comments.comments.push(newThread);
        hasNewAgentReply = true;
        hasNewThread = true;
        changed = true;
        return;
      }
      var oldReplyCount = (old.replies || []).length;
      var newReplyCount = (newThread.replies || []).length;
      if (newReplyCount > oldReplyCount) {
        var addedReplies = newThread.replies.slice(oldReplyCount);
        old.replies = newThread.replies;
        var hasAgent = addedReplies.some(function (r) { return r.role === "agent"; });
        if (hasAgent) {
          hasNewAgentReply = true;
        }
        if (changedExistingThreads.indexOf(old) === -1) {
          changedExistingThreads.push(old);
        }
        changed = true;
      }
      if (old.status !== newThread.status) {
        old.status = newThread.status;
        if (changedExistingThreads.indexOf(old) === -1) {
          changedExistingThreads.push(old);
        }
        changed = true;
      }
    });

    if (!changed) {
      return;
    }
    writeLocalComments();
    if (hasNewThread) {
      renderComments();
    } else {
      changedExistingThreads.forEach(refreshThreadDisplay);
    }
    if (hasNewAgentReply) {
      toast(t.agentReplied);
    }
  }

  function showUpdateBanner(message) {
    var existing = document.getElementById("reviewUpdateBanner");
    if (existing) {
      existing.remove();
    }
    var banner = document.createElement("div");
    banner.id = "reviewUpdateBanner";
    banner.className = "review-update-banner";
    banner.innerHTML = [
      '<svg class="rub-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 100-2 1 1 0 000 2z"/></svg>',
      '<span class="rub-message">' + escapeHtml(message) + '</span>',
      '<button type="button" class="rub-reload">' + escapeHtml(t.reloadBtn) + '</button>',
      '<button type="button" class="rub-close" aria-label="close">×</button>',
    ].join("");
    document.body.appendChild(banner);
    banner.querySelector(".rub-reload").addEventListener("click", function () {
      window.location.reload();
    });
    banner.querySelector(".rub-close").addEventListener("click", function () {
      banner.remove();
    });
    window.requestAnimationFrame(function () {
      banner.classList.add("show");
    });
  }

  function showSaveError(errorMessage) {
    var existing = document.getElementById("reviewSaveError");
    if (existing) {
      existing.remove();
    }
    var banner = document.createElement("div");
    banner.id = "reviewSaveError";
    banner.className = "review-save-error";
    banner.innerHTML = [
      '<span class="rse-text">' + t.saveError + escapeHtml(errorMessage) + '</span>',
      '<button type="button" class="rse-close" aria-label="close">&times;</button>',
    ].join("");
    banner.querySelector(".rse-close").addEventListener("click", function () {
      banner.remove();
    });
    document.body.prepend(banner);
  }
})();
