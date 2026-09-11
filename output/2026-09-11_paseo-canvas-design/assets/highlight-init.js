/* highlight.js 適用起動。
 * 除外 3 条件:
 *  (1) pre.diff 配下
 *  (2) .nohighlight (要素自身または祖先)
 *  (3) tok-* descendant を持つ code (既存手動着色の保持)
 */
(function () {
  function hasTokDescendant(code) {
    if (!code || !code.querySelectorAll) return false;
    return code.querySelectorAll('[class*="tok-"]').length > 0;
  }

  function shouldSkip(code) {
    if (!code) return true;
    if (code.closest && code.closest("pre.diff")) return true;
    if (code.classList && code.classList.contains("nohighlight")) return true;
    if (code.closest && code.closest(".nohighlight")) return true;
    if (hasTokDescendant(code)) return true;
    return false;
  }

  function applyHighlight() {
    if (typeof hljs === "undefined" || typeof hljs.highlightElement !== "function") {
      return;
    }
    var nodes = document.querySelectorAll("pre code");
    for (var i = 0; i < nodes.length; i++) {
      var code = nodes[i];
      if (shouldSkip(code)) continue;
      try {
        hljs.highlightElement(code);
      } catch (err) {
        /* 個別 block の失敗で全体を止めない */
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyHighlight);
  } else {
    applyHighlight();
  }
})();
