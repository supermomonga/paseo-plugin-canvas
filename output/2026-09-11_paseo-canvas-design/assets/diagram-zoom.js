(function () {
  "use strict";

  const MIN_SCALE = 0.2;
  const MAX_SCALE = 8;
  const ZOOM_STEP = 1.2;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function initDiagramZoom() {
    if (document.body.dataset.diagramZoomReady === "true") {
      return;
    }
    document.body.dataset.diagramZoomReady = "true";
    document.body.addEventListener("click", (event) => {
      const button = event.target.closest?.(".diagram-zoom-btn");
      if (!button) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const wrapper = button.closest(".diagram-wrap");
      const sourceSvg = wrapper ? wrapper.querySelector("svg") : null;
      if (!sourceSvg) {
        return;
      }
      openZoomOverlay(sourceSvg, button);
    });
  }

  function diagramFileStem(sourceSvg) {
    // 図の見出し (直近の review-block の title) があればファイル名に使う。無ければ id か連番。
    const block = sourceSvg.closest("[data-review-block]");
    const heading = block ? block.querySelector("h2, h3, h4") : null;
    const raw = (heading && heading.textContent ? heading.textContent : "").trim();
    const cleaned = raw.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (cleaned) {
      return "diagram-" + cleaned;
    }
    const all = Array.from(document.querySelectorAll(".diagram-wrap svg"));
    const index = all.indexOf(sourceSvg);
    return "diagram-" + (index >= 0 ? index + 1 : Date.now());
  }

  function serializeSvg(sourceSvg, options) {
    const clone = sourceSvg.cloneNode(true);
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const box = sourceSvg.viewBox && sourceSvg.viewBox.baseVal;
    const rect = sourceSvg.getBoundingClientRect();
    const width = (box && box.width) || rect.width || 800;
    const height = (box && box.height) || rect.height || 600;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (options && options.flattenLabels) {
      flattenForeignObjects(sourceSvg, clone);
    }
    inlineStyles(clone);
    return { xml: new XMLSerializer().serializeToString(clone), width, height };
  }

  /**
   * Mermaid のノードラベルを SVG <text> へ置き換える。
   *
   * Mermaid v11 は htmlLabels 既定 true でラベルを <foreignObject> の HTML として描く。
   * data URI の SVG を <img> 経由で canvas に描くと foreignObject の中身は描画されず、
   * 文字だけが消えた PNG が保存される (無言の失敗)。そのため PNG 化の前に
   * foreignObject を、同じ位置・同じ行構成の <text>/<tspan> に置き換える。
   * 置換に失敗した foreignObject が残った場合は呼び出し側が SVG fallback へ落とす。
   */
  function flattenForeignObjects(sourceSvg, clone) {
    const originals = sourceSvg.querySelectorAll("foreignObject");
    const clones = clone.querySelectorAll("foreignObject");
    for (let i = 0; i < clones.length; i += 1) {
      const target = clones[i];
      const origin = originals[i];
      const lines = extractLabelLines(origin || target);
      if (lines.length === 0) {
        target.remove();
        continue;
      }
      const styleSource = origin ? origin.querySelector("span, p, div") : null;
      const computed = styleSource ? getComputedStyle(styleSource) : null;
      const fontSize = computed ? parseFloat(computed.fontSize) || 14 : 14;
      const fontFamily = computed ? computed.fontFamily : "sans-serif";
      const fill = computed ? computed.color : "#333";
      const width = parseFloat(target.getAttribute("width")) || 0;
      const height = parseFloat(target.getAttribute("height")) || 0;
      const lineHeight = fontSize * 1.2;
      // edge ラベルは元々 HTML 側の背景色で線を隠している。text だけに置き換えると
      // 線が文字を横切って読めなくなるため、同じ位置へ背景矩形を復元する。
      const labelBackground = origin ? resolveLabelBackground(origin) : "";
      if (labelBackground) {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));
        rect.setAttribute("fill", labelBackground);
        target.parentNode.insertBefore(rect, target);
        // foreignObject と同じ transform 配下に置くため、rect にも同じ属性を写す
        const transform = target.getAttribute("transform");
        if (transform) {
          rect.setAttribute("transform", transform);
        }
        ["x", "y"].forEach((name) => {
          const value = target.getAttribute(name);
          if (value) {
            rect.setAttribute(name, value);
          }
        });
      }
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(width / 2));
      // foreignObject の縦中央に行全体を収める
      const firstBaseline = (height - lineHeight * (lines.length - 1)) / 2 + fontSize * 0.35;
      text.setAttribute("y", String(firstBaseline));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", String(fontSize));
      text.setAttribute("font-family", fontFamily);
      text.setAttribute("fill", fill);
      lines.forEach((line, index) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", String(width / 2));
        if (index > 0) {
          tspan.setAttribute("dy", String(lineHeight));
        }
        tspan.textContent = line;
        text.appendChild(tspan);
      });
      target.replaceWith(text);
    }
  }

  /**
   * ラベルの実効背景色を求める。
   *
   * Mermaid は edge ラベルを `.edgeLabel` の背景色で塗って線を隠す。透明な祖先を
   * 遡って最初の不透明色を採り、見つからない場合は空文字を返す (矩形を作らない)。
   * ノードラベルは親の shape が既に塗られているため、透明のまま矩形不要になる。
   */
  function resolveLabelBackground(foreignObject) {
    let node = foreignObject.querySelector("span, div, p") || foreignObject;
    let depth = 0;
    while (node && depth < 4) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(color)) {
        return color;
      }
      node = node.parentElement;
      depth += 1;
    }
    return "";
  }

  function extractLabelLines(foreignObject) {
    // <p> / <div> / <br> のいずれで改行されていても 1 行ずつ取り出す
    const blocks = foreignObject.querySelectorAll("p, div.label > span, br");
    const lines = [];
    if (blocks.length > 0) {
      const html = foreignObject.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      const holder = document.createElement("div");
      holder.innerHTML = html;
      holder.querySelectorAll("p, div").forEach((node) => {
        node.insertAdjacentText("afterend", "\n");
      });
      holder.textContent.split("\n").forEach((part) => {
        const trimmed = part.trim();
        if (trimmed) {
          lines.push(trimmed);
        }
      });
    }
    if (lines.length === 0) {
      const raw = (foreignObject.textContent || "").trim();
      if (raw) {
        lines.push(raw);
      }
    }
    return lines;
  }

  /**
   * 外部 stylesheet に依存している見た目を属性へ写す。
   *
   * 直列化した SVG は単独ファイルとして読まれるため、bundle の style.css は効かない。
   * Mermaid が付ける stroke / fill は要素側の style 属性にあるので、
   * ここでは stylesheet 側で決まる text 色だけを補う。
   */
  function inlineStyles(clone) {
    clone.querySelectorAll("text").forEach((node) => {
      if (!node.getAttribute("fill") && !(node.style && node.style.fill)) {
        node.setAttribute("fill", "#333");
      }
    });
  }

  function triggerDownload(href, filename) {
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadSvgFallback(xml, stem) {
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, stem + ".svg");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadDiagram(sourceSvg) {
    // PNG (2x) を第一候補にする。ラベルは <text> へ平坦化してから描くので
    // foreignObject 由来の文字落ちは起きない。それでも描画・変換に失敗した場合は
    // 黙らず SVG ダウンロードへ落とす。
    const stem = diagramFileStem(sourceSvg);
    const flattened = serializeSvg(sourceSvg, { flattenLabels: true });
    // 平坦化しきれない foreignObject が残っていたら PNG 化を試さない (文字が落ちるため)
    if (/<foreignObject/i.test(flattened.xml)) {
      downloadSvgFallback(serializeSvg(sourceSvg).xml, stem);
      return;
    }
    const { xml, width, height } = flattened;
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        // 透過 PNG は dark 背景で読めなくなるため、拡大表示と同じ地色を敷く
        ctx.fillStyle = overlayBackgroundColor();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            downloadSvgFallback(xml, stem);
            return;
          }
          const url = URL.createObjectURL(blob);
          triggerDownload(url, stem + ".png");
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }, "image/png");
      } catch (error) {
        downloadSvgFallback(xml, stem);
      }
    };
    image.onerror = () => downloadSvgFallback(xml, stem);
    image.src = svgUrl;
  }

  function isTransparent(color) {
    return !color || color === "transparent" || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(color);
  }

  function overlayBackgroundColor() {
    // overlay の地色は theme 追従 (--paper-2)。overlay が閉じている / CSS 変数が未解決の
    // 場合は紙面 (body) の地色へ倒し、それも取れなければ白を敷く
    const overlay = document.querySelector(".diagram-zoom-overlay");
    const color = overlay ? getComputedStyle(overlay).backgroundColor : "";
    if (!isTransparent(color)) {
      return color;
    }
    const bodyColor = getComputedStyle(document.body).backgroundColor;
    return isTransparent(bodyColor) ? "#ffffff" : bodyColor;
  }

  function openZoomOverlay(sourceSvg, triggerButton) {
    const existing = document.querySelector(".diagram-zoom-overlay");
    if (existing && typeof existing.closeDiagramZoom === "function") {
      existing.closeDiagramZoom();
    }

    const originalParent = sourceSvg.parentNode;
    const placeholder = document.createComment("diagram zoom placeholder");
    originalParent.insertBefore(placeholder, sourceSvg);
    const originalSvgAttrs = {
      width: sourceSvg.getAttribute("width"),
      height: sourceSvg.getAttribute("height"),
      style: sourceSvg.getAttribute("style"),
    };
    const svgBox = sourceSvg.viewBox?.baseVal;
    if (svgBox && svgBox.width > 0 && svgBox.height > 0) {
      sourceSvg.setAttribute("width", String(svgBox.width));
      sourceSvg.setAttribute("height", String(svgBox.height));
    }

    const overlay = document.createElement("div");
    overlay.className = "diagram-zoom-overlay is-open";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Diagram zoom");

    const viewport = document.createElement("div");
    viewport.className = "zoom-viewport";

    const container = document.createElement("div");
    container.className = "zoom-container";
    container.appendChild(sourceSvg);
    viewport.appendChild(container);

    const toolbar = document.createElement("div");
    toolbar.className = "zoom-toolbar";
    toolbar.innerHTML = [
      '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>',
      '<button type="button" data-zoom="out" aria-label="Zoom out">-</button>',
      '<button type="button" data-zoom="reset" aria-label="Reset zoom">reset</button>',
      '<button type="button" data-zoom="download" aria-label="Download image">save</button>',
      '<button type="button" data-zoom="close" aria-label="Close">x</button>',
    ].join("");

    overlay.appendChild(viewport);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);
    document.body.classList.add("zoom-open");

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragging = false;
    let activeDragType = "";
    let movedDuringDrag = false;
    let suppressNextClick = false;
    let lastDownPoint = null;
    let lastX = 0;
    let lastY = 0;

    function applyTransform() {
      container.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    function zoomAt(nextScale, x, y) {
      const next = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const beforeX = (x - tx) / scale;
      const beforeY = (y - ty) / scale;
      scale = next;
      tx = x - beforeX * scale;
      ty = y - beforeY * scale;
      applyTransform();
    }

    function panBy(deltaX, deltaY) {
      tx -= deltaX;
      ty -= deltaY;
      applyTransform();
    }

    function resetZoom() {
      const viewportRect = viewport.getBoundingClientRect();
      const svgRect = sourceSvg.getBoundingClientRect();
      const width = svgRect.width || sourceSvg.viewBox.baseVal.width || viewportRect.width;
      const height = svgRect.height || sourceSvg.viewBox.baseVal.height || viewportRect.height;
      scale = clamp(Math.min((viewportRect.width * 0.86) / width, (viewportRect.height * 0.78) / height, 1.5), MIN_SCALE, MAX_SCALE);
      tx = (viewportRect.width - width * scale) / 2;
      ty = (viewportRect.height - height * scale) / 2;
      applyTransform();
    }

    function closeOverlay() {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", stopGlobalEvent, true);
      document.body.classList.remove("zoom-open");
      if (placeholder.parentNode) {
        placeholder.parentNode.insertBefore(sourceSvg, placeholder);
        restoreAttribute(sourceSvg, "width", originalSvgAttrs.width);
        restoreAttribute(sourceSvg, "height", originalSvgAttrs.height);
        restoreAttribute(sourceSvg, "style", originalSvgAttrs.style);
        placeholder.remove();
      }
      overlay.remove();
      if (triggerButton && typeof triggerButton.focus === "function") {
        triggerButton.focus();
      }
    }

    function restoreAttribute(node, name, value) {
      if (value === null) {
        node.removeAttribute(name);
      } else {
        node.setAttribute(name, value);
      }
    }

    function stopGlobalEvent(event) {
      event.stopPropagation();
    }

    function onKeyDown(event) {
      if (!document.body.classList.contains("zoom-open")) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = viewport.getBoundingClientRect();
        zoomAt(scale * ZOOM_STEP, rect.width / 2, rect.height / 2);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = viewport.getBoundingClientRect();
        zoomAt(scale / ZOOM_STEP, rect.width / 2, rect.height / 2);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetZoom();
      }
    }

    overlay.closeDiagramZoom = closeOverlay;

    function recordDownPoint(event) {
      if (event.target.closest?.(".zoom-toolbar")) {
        lastDownPoint = null;
        return;
      }
      lastDownPoint = { x: event.clientX, y: event.clientY };
    }

    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = event.target.closest?.("[data-zoom]")?.getAttribute("data-zoom");
      const movedFromDown = lastDownPoint
        ? Math.abs(event.clientX - lastDownPoint.x) + Math.abs(event.clientY - lastDownPoint.y) > 4
        : false;
      if (action === "close") {
        closeOverlay();
      } else if (action === "download") {
        downloadDiagram(sourceSvg);
      } else if (action === "in") {
        const rect = viewport.getBoundingClientRect();
        zoomAt(scale * ZOOM_STEP, rect.width / 2, rect.height / 2);
      } else if (action === "out") {
        const rect = viewport.getBoundingClientRect();
        zoomAt(scale / ZOOM_STEP, rect.width / 2, rect.height / 2);
      } else if (action === "reset") {
        resetZoom();
      } else if ((event.target === overlay || event.target === viewport) && !suppressNextClick && !movedFromDown) {
        closeOverlay();
      }
      suppressNextClick = false;
      lastDownPoint = null;
    });

    overlay.addEventListener("pointerdown", recordDownPoint, true);
    overlay.addEventListener("mousedown", recordDownPoint, true);

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        zoomAt(scale * factor, event.clientX - rect.left, event.clientY - rect.top);
      } else {
        panBy(event.deltaX, event.deltaY);
      }
    }, { passive: false });

    function beginDrag(event) {
      if (activeDragType) {
        return;
      }
      if (event.target.closest?.(".zoom-toolbar")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activeDragType = event.type.startsWith("pointer") ? "pointer" : "mouse";
      movedDuringDrag = false;
      suppressNextClick = event.target !== viewport && event.target !== overlay;
      lastX = event.clientX;
      lastY = event.clientY;
      if (activeDragType === "pointer") {
        viewport.setPointerCapture?.(event.pointerId);
      }
    }

    function updateDrag(event) {
      const eventType = event.type.startsWith("pointer") ? "pointer" : "mouse";
      if (!activeDragType || eventType !== activeDragType) {
        return;
      }
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (!dragging && Math.abs(dx) + Math.abs(dy) <= 2) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!dragging) {
        dragging = true;
        movedDuringDrag = true;
        suppressNextClick = true;
        container.classList.add("is-dragging");
      }
      tx += dx;
      ty += dy;
      lastX = event.clientX;
      lastY = event.clientY;
      applyTransform();
    }

    function endDrag(event) {
      const eventType = event.type.startsWith("pointer") ? "pointer" : "mouse";
      if (!activeDragType || eventType !== activeDragType) {
        return;
      }
      const wasDragging = dragging;
      if (wasDragging) {
        event.preventDefault();
        event.stopPropagation();
      }
      dragging = false;
      activeDragType = "";
      suppressNextClick = suppressNextClick || movedDuringDrag;
      movedDuringDrag = false;
      container.classList.remove("is-dragging");
      if (eventType === "pointer") {
        viewport.releasePointerCapture?.(event.pointerId);
      }
    }

    function cancelDrag() {
      if (activeDragType && dragging) {
        suppressNextClick = true;
      }
      dragging = false;
      activeDragType = "";
      movedDuringDrag = false;
      container.classList.remove("is-dragging");
    }

    viewport.addEventListener("pointerdown", beginDrag);
    viewport.addEventListener("pointermove", updateDrag);
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", cancelDrag);
    viewport.addEventListener("pointerleave", cancelDrag);
    viewport.addEventListener("mousedown", beginDrag);
    viewport.addEventListener("mousemove", updateDrag);
    viewport.addEventListener("mouseup", endDrag);
    viewport.addEventListener("mouseleave", cancelDrag);

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", stopGlobalEvent, true);
    window.requestAnimationFrame(resetZoom);
    const closeButton = toolbar.querySelector('[data-zoom="close"]');
    closeButton?.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDiagramZoom);
  } else {
    initDiagramZoom();
  }

  window.initDiagramZoom = initDiagramZoom;
  window.openZoomOverlay = openZoomOverlay;
})();
