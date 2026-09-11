/**
 * 操作部品が触った結果を保存・復元する共通ヘルパー。
 *
 * html block に書いたスライダー・トグル・並べ替えなどが、値をどこに置くかを揃えるために使う。
 * preview server があれば `PUT /annotations/state/<name>.json` で保存し、端末をまたいで共有する。
 * server が無い場合 (publish した standalone HTML、file:// で開いた場合) は localStorage に落ちる。
 * どちらも使えない環境ではメモリ上だけで動き、操作そのものは止めない。
 *
 * 保存した状態は agent が `annotations/state/<name>.json` として読める。
 * 触って決めた結果を作業へ戻す経路がこれで成立する。
 */
(function () {
  "use strict";

  var STATE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  var memory = {};
  var pending = {};

  /** server 保存に使う URL を決める。file:// で開いた場合は保存先が無いので null。 */
  function resolveRemoteUrl(name) {
    var protocol = window.location.protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return new URL("annotations/state/" + name + ".json", window.location.href).toString();
  }

  /** localStorage が使えるかを実際の書き込みで確かめる。使えなければ null を返す。 */
  function resolveStorage() {
    try {
      var probe = "__rhw_state_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      return null;
    }
  }

  function localKey(name) {
    return "rhw-state:" + (document.documentElement.dataset.documentId || "doc") + ":" + name;
  }

  function assertName(name) {
    if (typeof name !== "string" || !STATE_NAME_RE.test(name)) {
      throw new Error(
        "state name must match [A-Za-z0-9][A-Za-z0-9_-]{0,63} (got: " + String(name) + ")"
      );
    }
  }

  /**
   * 保存済みの状態を読む。server → localStorage → メモリの順に探し、
   * どこにも無ければ null を返す。
   */
  async function load(name) {
    assertName(name);
    // debounce 待ちの値は server に届いていないため、手元の値を優先する
    if (pending[name] && Object.prototype.hasOwnProperty.call(memory, name)) {
      return memory[name];
    }
    var remoteUrl = resolveRemoteUrl(name);
    if (remoteUrl) {
      try {
        var response = await fetch(remoteUrl, { cache: "no-store" });
        if (response.ok) {
          var payload = await response.json();
          if (payload && typeof payload === "object" && payload.state) {
            return payload.state;
          }
        }
      } catch (err) {
        // server が落ちていても手元の保存で続ける
      }
    }
    var storage = resolveStorage();
    if (storage) {
      try {
        var raw = storage.getItem(localKey(name));
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            return parsed;
          }
        }
      } catch (err) {
        // 壊れた保存値は無いものとして扱う
      }
    }
    return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null;
  }

  /**
   * 状態を保存する。server と localStorage の両方へ書き、
   * どちらも使えない場合もメモリに残して操作を止めない。
   *
   * options.debounce にミリ秒を渡すと、その時間だけ入力が止まってから書き込む。
   * スライダーやテキスト入力を動かしている間ずっと呼んでも、server への PUT は
   * 止まった時の 1 回になる。手元の保存 (memory / localStorage) は毎回すぐ行うので、
   * 呼び出し側は表示の更新と保存の呼び出しを同じ場所に書ける。
   */
  async function save(name, state, options) {
    assertName(name);
    if (!state || typeof state !== "object") {
      throw new Error("state must be an object");
    }
    var wait = options && typeof options.debounce === "number" ? options.debounce : 0;
    if (wait > 0) {
      return saveDebounced(name, state, wait);
    }
    return saveNow(name, state);
  }

  /**
   * 手元の保存だけ即時に行い、server への書き込みを wait ミリ秒遅らせる。
   * 待っている間に再度呼ばれたら、前の予約を捨てて新しい値で取り直す。
   */
  function saveDebounced(name, state, wait) {
    memory[name] = state;
    var storage = resolveStorage();
    if (storage) {
      try {
        storage.setItem(localKey(name), JSON.stringify(state));
      } catch (err) {
        // 容量超過等は無視して server 保存の予約へ進む
      }
    }
    if (pending[name]) {
      window.clearTimeout(pending[name].timer);
      pending[name].resolve({ saved: "superseded" });
    }
    return new Promise(function (resolve) {
      var timer = window.setTimeout(function () {
        delete pending[name];
        saveNow(name, state).then(resolve);
      }, wait);
      pending[name] = { timer: timer, resolve: resolve };
    });
  }

  async function saveNow(name, state) {
    memory[name] = state;
    var storage = resolveStorage();
    if (storage) {
      try {
        storage.setItem(localKey(name), JSON.stringify(state));
      } catch (err) {
        // 容量超過等は無視して server 保存を試す
      }
    }
    var remoteUrl = resolveRemoteUrl(name);
    if (!remoteUrl) {
      return { saved: storage ? "local" : "memory" };
    }
    try {
      var response = await fetch(remoteUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: state, updated_at: new Date().toISOString() }),
      });
      if (response.ok) {
        return { saved: "remote" };
      }
    } catch (err) {
      // server が落ちていても手元の保存で続ける
    }
    return { saved: storage ? "local" : "memory" };
  }

  window.RHWState = { load: load, save: save };
})();
