// ==UserScript==
// @name         Twitter Quote Copy
// @namespace    https://instinct.local/
// @version      1.4
// @downloadURL  https://raw.githubusercontent.com/tuta-amb/twitter-quote-copy/main/twitter-quote-copy.user.js
// @updateURL    https://raw.githubusercontent.com/tuta-amb/twitter-quote-copy/main/twitter-quote-copy.user.js
// @description  Adds a quote-copy button to every post's action bar on X/Twitter. Copies the post as a blockquote; on a permalink page it also nests the thread above it (parents get deeper > levels). Ends with the permalink in <small> tags.
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  var BTN_ATTR = "data-quote-copy-btn";
  var FLASH_MS = 1200;

  // Smaller glyph than the native 18.75px icons: the quote mark fills its box.
  var ICON_SVG =
    '<svg viewBox="4 4 16 16" aria-hidden="true" width="14" height="14" fill="currentColor" style="display:block">' +
    '<path d="M9.64 6.23c-2.8 1.06-4.64 3.45-4.64 6.19 0 2.11 1.5 3.58 3.36 3.58 1.63 0 2.87-1.23 2.87-2.81 0-1.55-1.08-2.63-2.58-2.63-.27 0-.53.04-.76.1.27-1.3 1.59-2.8 2.88-3.44L9.64 6.23zm8.36 0c-2.8 1.06-4.64 3.45-4.64 6.19 0 2.11 1.5 3.58 3.36 3.58 1.63 0 2.87-1.23 2.87-2.81 0-1.55-1.08-2.63-2.58-2.63-.27 0-.53.04-.76.1.27-1.3 1.59-2.8 2.88-3.44L18 6.23z"/>' +
    "</svg>";

  // "> " repeated depth times; trailing=false drops the last space for bare
  // separator lines and empty quoted lines.
  function depthPrefix(depth, trailing) {
    var s = "";
    for (var i = 0; i < depth; i++) s += "> ";
    return trailing ? s : s.replace(/ $/, "");
  }

  function quoteBlock(text, depth) {
    return text
      .split("\n")
      .map(function (line) {
        return line.length ? depthPrefix(depth, true) + line : depthPrefix(depth, false);
      })
      .join("\n");
  }

  // chainTexts: oldest ancestor first, the selected post last. The selected
  // post gets depth 1 ("> "), its parent depth 2 ("> > "), and so on. Between
  // a block at depth d+1 and the next at depth d there is a bare separator at
  // depth d (markdown needs it to close the deeper quote).
  function buildQuote(chainTexts, url) {
    var parts = [];
    var n = chainTexts.length;
    for (var i = 0; i < n - 1; i++) {
      var depth = n - i;
      parts.push(quoteBlock(chainTexts[i], depth));
      parts.push(depthPrefix(depth - 1, false));
    }
    parts.push(quoteBlock(chainTexts[n - 1], 1));
    return parts.join("\n") + "\n\n<small>" + url + "</small>";
  }

  function tweetInfo(article) {
    // The post's own text is the first tweetText that is not inside an
    // embedded quoted-post card (role="link"). Quoted cards are collected
    // separately and treated as sitting directly above the post.
    var textEls = Array.prototype.slice.call(
      article.querySelectorAll('[data-testid="tweetText"]')
    );
    var textEl = null;
    var quoted = [];
    textEls.forEach(function (el) {
      var card = el.closest('[role="link"]');
      var inCard = card && article.contains(card) && card !== article;
      if (inCard) quoted.push(el.innerText);
      else if (!textEl) textEl = el;
    });
    var text = textEl ? textEl.innerText : "";

    var url = null;
    var timeLink = article.querySelector("time");
    if (timeLink) {
      var anchor = timeLink.closest("a[href]");
      if (anchor) url = anchor.getAttribute("href");
    }
    if (!url) {
      var links = article.querySelectorAll('a[href*="/status/"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute("href");
        if (/\/status\/\d+/.test(href)) {
          url = href;
          break;
        }
      }
    }
    if (!url) return null;

    var m = url.match(/\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (!m) return null;
    return {
      text: text,
      quoted: quoted,
      url: "https://twitter.com/" + m[1] + "/status/" + m[2],
    };
  }

  // A post's chain entries: its quoted post(s) first (they count as the
  // post directly above it), then the post itself.
  function entriesFor(info) {
    return info.quoted.concat([info.text]);
  }

  function statusIdFromLocation() {
    var m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // Returns { texts: [oldest..selected], url } or null when the post has no
  // usable permalink. Thread ancestors are only collected on a permalink
  // page (/user/status/id): there, every article above the focused post is
  // part of its thread. Clicking an ancestor quotes the chain up to that
  // post; clicking a reply below the focused post quotes it alone.
  function collectChain(clicked) {
    var clickedInfo = tweetInfo(clicked);
    if (!clickedInfo) return null;

    var single = { texts: entriesFor(clickedInfo), url: clickedInfo.url };
    var statusId = statusIdFromLocation();
    if (!statusId) return single;

    var articles = Array.prototype.slice.call(document.querySelectorAll("article"));
    var clickedIdx = articles.indexOf(clicked);
    if (clickedIdx < 0) return single;

    var focusedIdx = -1;
    for (var i = 0; i < articles.length; i++) {
      var info = tweetInfo(articles[i]);
      if (info && info.url.indexOf("/status/" + statusId) !== -1) {
        focusedIdx = i;
        break;
      }
    }
    if (focusedIdx < 0 || clickedIdx > focusedIdx) return single;

    var texts = [];
    for (var j = 0; j <= clickedIdx; j++) {
      var inf = tweetInfo(articles[j]);
      if (inf) texts = texts.concat(entriesFor(inf));
    }
    return { texts: texts, url: clickedInfo.url };
  }

  function setClipboard(value, onDone) {
    if (typeof GM_setClipboard === "function") {
      try {
        GM_setClipboard(value, "text");
        onDone(true);
        return;
      } catch (e) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(
        function () {
          onDone(true);
        },
        function () {
          onDone(false);
        }
      );
      return;
    }
    onDone(false);
  }

  function flash(btn, ok) {
    var inner = btn.querySelector(".qc-icon-wrap");
    if (!inner) return;
    inner.style.color = ok ? "rgb(0, 186, 124)" : "rgb(249, 24, 128)";
    setTimeout(function () {
      inner.style.color = "";
    }, FLASH_MS);
  }

  function onCopyClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    var btn = ev.currentTarget;
    var article = btn.closest("article");
    if (!article) {
      flash(btn, false);
      return;
    }
    var result = collectChain(article);
    if (!result) {
      flash(btn, false);
      return;
    }
    setClipboard(buildQuote(result.texts, result.url), function (ok) {
      flash(btn, ok);
    });
  }

  function makeButton() {
    var btn = document.createElement("button");
    btn.setAttribute(BTN_ATTR, "1");
    btn.setAttribute("aria-label", "Copy as quote");
    btn.setAttribute("title", "Copy as quote");
    btn.type = "button";
    btn.className = "qc-btn";
    btn.innerHTML = '<span class="qc-icon-wrap">' + ICON_SVG + "</span>";
    btn.addEventListener("click", onCopyClick);
    return btn;
  }

  function injectInto(article) {
    var group = article.querySelector('div[role="group"]');
    if (!group) return;
    if (group.querySelector("[" + BTN_ATTR + "]")) return;

    var btn = makeButton();

    // Flex wrapper with zero line-height so it adds no height to the bar.
    var wrap = document.createElement("div");
    wrap.className = "qc-wrap";
    wrap.appendChild(btn);

    var anchor = null;
    var kids = group.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (
        el.querySelector('[aria-label*="Grok" i]') ||
        (el.getAttribute("aria-label") || "").match(/grok/i)
      ) {
        anchor = el;
        break;
      }
    }
    if (!anchor) {
      var share = group.querySelector('[aria-label="Share post"], [data-testid="caret"]');
      if (share) {
        anchor = share;
        while (anchor.parentElement && anchor.parentElement !== group) {
          anchor = anchor.parentElement;
        }
      }
    }
    if (anchor && anchor.parentElement === group) {
      group.insertBefore(wrap, anchor);
    } else {
      group.appendChild(wrap);
    }
  }

  function injectAll(root) {
    var articles;
    if (root.nodeType === 1 && root.matches && root.matches("article")) {
      articles = [root];
    } else if (root.querySelectorAll) {
      articles = root.querySelectorAll("article");
    } else {
      return;
    }
    for (var i = 0; i < articles.length; i++) injectInto(articles[i]);
  }

  function installStyles() {
    if (document.getElementById("qc-styles")) return;
    var style = document.createElement("style");
    style.id = "qc-styles";
    // 28px hit area fits inside the 34.75px native bar height; flex wrapper
    // with line-height:0 avoids the inline baseline gap that added padding.
    style.textContent =
      ".qc-wrap{display:flex;align-items:center;align-self:center;line-height:0;}" +
      ".qc-btn{display:flex;align-items:center;background:transparent;border:0;padding:0;margin:0;cursor:pointer;font:inherit;line-height:0;color:inherit;}" +
      ".qc-btn .qc-icon-wrap{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;color:rgb(113,118,123);transition:background-color 0.2s,color 0.2s;}" +
      ".qc-btn:hover .qc-icon-wrap{background-color:rgba(29,155,240,0.1);color:rgb(29,155,240);}";
    document.head.appendChild(style);
  }

  installStyles();
  injectAll(document.body);

  var scheduled = false;
  var observer = new MutationObserver(function (mutations) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) injectAll(added[j]);
      }
      injectAll(document.body);
    }, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
