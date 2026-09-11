(function () {
  "use strict";

  // scripts/html_review_workbench/common.py の MERMAID_INIT_JS と同じ内容を保つ
  // (通常は書き出し元の init script をそのまま引き継ぐので、これは取得できない時の予備)。
  const MERMAID_INIT_JS = "(function(){function t(){var d=document.documentElement.dataset.theme;if(d!=='dark'&&d!=='light'){d=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}return d==='dark'?'dark':'default';}function boot(){mermaid.initialize({startOnLoad:false,theme:t(),securityLevel:'strict'});}window.__rhwRerenderMermaid=function(){var n=Array.prototype.slice.call(document.querySelectorAll('.mermaid[data-mermaid-source]'));if(!n.length){return Promise.resolve();}n.forEach(function(el){el.removeAttribute('data-processed');el.textContent=el.getAttribute('data-mermaid-source');});boot();return Promise.resolve(mermaid.run({nodes:n})).catch(function(){});};boot();document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('.mermaid').forEach(function(el){el.setAttribute('data-mermaid-source',el.textContent);});mermaid.run();if(window.matchMedia){var mq=window.matchMedia('(prefers-color-scheme: dark)');var f=function(){var d=document.documentElement.dataset.theme;if(d==='dark'||d==='light'){return;}window.__rhwRerenderMermaid();};if(mq.addEventListener){mq.addEventListener('change',f);}else if(mq.addListener){mq.addListener(f);}}});})()";
  const DEFAULT_PUBLISH_OVERRIDES =
    "html,body{background:var(--bg-app);}\n" +
    ".canvas{overflow:visible;height:auto;min-height:100vh;}\n" +
    "@media(prefers-color-scheme:dark){:root{--bg-app:#131519;--bg-rail:#171a1f;--paper:#1c1f24;--paper-2:#20242a;--ink:#e7e3da;--ink-2:#a6a299;--ink-3:#7d7a72;--ink-faint:#5b5851;--line-1:#2c2f35;--line-2:#393d44;--line-3:#4a4e56;--brand:#6ea4dc;--brand-soft:#1f2d3c;--open:#6ea4dc;--open-bg:#1c2c3b;--open-line:#355472;--reply:#d6a85a;--reply-bg:#352c18;--reply-line:#604c25;--resolved:#6dba88;--resolved-bg:#1c2e23;--resolved-line:#345240;--code-bg:#15181d;--code-bg-2:#1b1f25;--code-line:#262b32;--sh-1:0 1px 2px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.04);--sh-2:0 2px 8px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.05);--sh-3:0 10px 30px rgba(0,0,0,.6),0 2px 6px rgba(0,0,0,.4);--focus-ring:0 0 0 3px color-mix(in srgb,var(--brand) 40%,transparent);}}\n";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(value) {
    return (value || "document").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").slice(0, 48) || "document";
  }

  function toast(message) {
    const element = document.createElement("div");
    element.className = "pub-toast";
    element.innerHTML = [
      '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>',
      escapeHtml(message),
    ].join("");
    document.body.appendChild(element);
    window.requestAnimationFrame(() => {
      element.classList.add("show");
    });
    window.setTimeout(() => {
      element.classList.remove("show");
      window.setTimeout(() => {
        element.remove();
      }, 240);
    }, 2600);
  }

  async function collectCSS() {
    let css = "";
    for (let index = 0; index < document.styleSheets.length; index += 1) {
      try {
        const rules = document.styleSheets[index].cssRules;
        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
          css += rules[ruleIndex].cssText + "\n";
        }
      } catch (_error) {
        var href = document.styleSheets[index].href;
        if (href) {
          try {
            var resp = await fetch(href);
            if (resp.ok) {
              css += (await resp.text()) + "\n";
            }
          } catch (_fetchError) { /* skip */ }
        }
      }
    }
    return css;
  }

  async function fetchAssetText(path) {
    try {
      const response = await fetch(new URL(path, window.location.href).toString(), { cache: "no-store" });
      if (response.ok) {
        return await response.text();
      }
    } catch (_error) { /* skip */ }
    return "";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  async function embedImages(container) {
    var imgs = container.querySelectorAll("img[src]");
    var promises = Array.prototype.map.call(imgs, function(img) {
      var src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) {
        return Promise.resolve();
      }
      var origImg = document.querySelector('img[src="' + cssEscape(src) + '"]') ||
                    document.querySelector('img[src="' + src + '"]');
      if (origImg && origImg.naturalWidth > 0 && origImg.complete) {
        try {
          var cvs = document.createElement("canvas");
          cvs.width = origImg.naturalWidth;
          cvs.height = origImg.naturalHeight;
          cvs.getContext("2d").drawImage(origImg, 0, 0);
          img.setAttribute("src", cvs.toDataURL("image/png"));
          return Promise.resolve();
        } catch (_canvasError) { /* fall through to fetch */ }
      }
      return fetch(src).then(function(r) { return r.blob(); }).then(function(blob) {
        return new Promise(function(resolve) {
          var reader = new FileReader();
          reader.onloadend = function() {
            img.setAttribute("src", reader.result);
            resolve();
          };
          reader.onerror = function() { resolve(); };
          reader.readAsDataURL(blob);
        });
      }).catch(function() { /* keep original src */ });
    });
    await Promise.all(promises);
  }

  function collectMermaidInitScript() {
    const initScript = document.querySelector('script[data-role="reviewable-mermaid-init"]');
    const source = initScript ? initScript.textContent.trim() : "";
    return source || MERMAID_INIT_JS;
  }

  async function collectMermaidScripts(clone) {
    const needsMermaid = Boolean(
      clone.querySelector(".mermaid") ||
      document.querySelector('script[src*="assets/mermaid.min.js"]')
    );
    if (!needsMermaid) {
      return "";
    }
    const mermaid = await fetchAssetText("assets/mermaid.min.js");
    const zoom = await fetchAssetText("assets/diagram-zoom.js");
    let scripts = "";
    if (mermaid) {
      scripts += "<script>\n" + mermaid + "\n</script>\n";
      scripts += "<script>" + collectMermaidInitScript() + "</script>\n";
    }
    if (zoom) {
      scripts += "<script>\n" + zoom + "\n</script>\n";
    }
    return scripts;
  }

  async function buildPublishedDoc() {
    const shell = document.querySelector("#canvas .doc-shell");
    if (!shell) {
      return null;
    }
    const clone = shell.cloneNode(true);

    // 目次は残す (公開出力でも読み手が節を辿れるようにするため)。
    // コメント rail とレビュー用の表示だけを外す
    clone.querySelectorAll(".cmt-rail, .doc-status, .byline, .cx-num, .review-comment-badges").forEach((node) => node.remove());

    clone.querySelectorAll(".cx").forEach((element) => {
      const parent = element.parentNode;
      if (!parent) {
        return;
      }
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
    });

    clone.querySelectorAll("[data-comment]").forEach((node) => {
      node.removeAttribute("data-comment");
    });
    clone.querySelectorAll("[data-cstate-host]").forEach((node) => {
      node.removeAttribute("data-cstate-host");
    });
    clone.querySelectorAll("[data-review-block]").forEach((node) => {
      node.removeAttribute("data-review-block");
      node.removeAttribute("data-review-required");
      node.removeAttribute("data-block-type");
    });

    clone.querySelectorAll(".review-comment-highlight").forEach((element) => {
      const parent = element.parentNode;
      if (!parent) {
        return;
      }
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
    });
    clone.querySelectorAll(".review-comment-badge").forEach((node) => node.remove());
    clone.querySelectorAll(".review-comment-badges").forEach((node) => node.remove());

    await embedImages(clone);

    const root = document.documentElement;
    const density = root.getAttribute("data-density") || "compact";
    const docLang = root.lang || "ja";
    const canvas = document.getElementById("canvas");
    const isWide = canvas && canvas.classList.contains("is-wide");
    const titleElement = clone.querySelector(".doc-title");
    const title = titleElement ? titleElement.textContent.trim() : "document";

    const summaryEl = clone.querySelector(".summary p");
    const firstP = clone.querySelector(".document-content .block-content p");
    const description = (summaryEl || firstP || { textContent: "" }).textContent.trim().slice(0, 200);

    const eyebrow = clone.querySelector(".eyebrow");
    if (eyebrow) {
      eyebrow.innerHTML = '<a href="https://github.com/u-ichi/reviewable-html-workbench" ' +
        'style="color:inherit;text-decoration:none;" target="_blank" rel="noopener">' +
        escapeHtml(eyebrow.textContent.trim()) + "</a>";
    }

    const css = await collectCSS();
    const publishOverrides = await fetchAssetText("assets/publish-overrides.css") || DEFAULT_PUBLISH_OVERRIDES;
    const mermaidScripts = await collectMermaidScripts(clone);
    // 目次を残した出力には、移動と現在位置ハイライトの script を添える。
    // これが無いと目次は「リンクは飛ぶがハイライトが動かない」状態になる
    let tocNavScript = "";
    if (clone.querySelector(".toc")) {
      const tocNav = await fetchAssetText("assets/toc-nav.js");
      if (tocNav) {
        tocNavScript = "<script>\n" + tocNav + "\n</script>\n";
      } else {
        // toc-nav.js を同梱する前に render された bundle には asset が無い。黙って省略すると
        // 目次が光らない HTML がそのまま公開されるので、書き出した人に知らせる
        toast("目次の script が見つかりません。資料を render し直してから書き出してください");
      }
    }
    const html =
      "<!DOCTYPE html>\n<html lang=\"" + docLang + "\" data-density=\"" + density + "\">\n" +
      "<head>\n<meta charset=\"utf-8\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
      "<title>" + escapeHtml(title) + "</title>\n" +
      '<meta property="og:title" content="' + escapeHtml(title) + '">\n' +
      '<meta property="og:description" content="' + escapeHtml(description) + '">\n' +
      '<meta property="og:type" content="article">\n' +
      '<meta name="twitter:card" content="summary">\n' +
      '<meta name="twitter:title" content="' + escapeHtml(title) + '">\n' +
      '<meta name="twitter:description" content="' + escapeHtml(description) + '">\n' +
      "<style>\n" + css +
      "\n/* published export overrides */\n" +
      publishOverrides +
      "</style>\n" +
      mermaidScripts +
      "</head>\n" +
      "<body class=\"is-published\">\n" +
      "<main class=\"canvas" + (isWide ? " is-wide" : "") + "\">\n" +
      clone.outerHTML + "\n</main>\n" + tocNavScript + "</body>\n</html>\n";
    return { html, title };
  }

  async function downloadPublishedDoc(options) {
    const doc = await buildPublishedDoc();
    if (!doc) {
      return;
    }
    const blob = new Blob([doc.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = slugify(doc.title) + ".html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);
    toast((options && options.toastMessage) || "Published HTML exported");
  }

  window.reviewableWorkbenchPublish = Object.freeze({
    buildPublishedDoc,
    collectCSS,
    collectMermaidScripts,
    downloadPublishedDoc,
    embedImages,
    escapeHtml,
    fetchAssetText,
    slugify,
    toast,
  });
})();
