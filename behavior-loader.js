/**
 * behavior-loader.js
 * Phase 2 前端非同步資料載入框架
 * 負責：lazy load JSON、masked_id join、快取管理
 */

const BehaviorLoader = (() => {
  // ── 快取 ──────────────────────────────────────────────────
  const _cache = {};

  /**
   * 載入單一 JSON 檔案，結果快取於 _cache[key]
   * @param {string} key   - 快取識別鍵（如 "behavior"）
   * @param {string} url   - 相對或絕對路徑
   * @returns {Promise<any>}
   */
  async function fetchJSON(key, url) {
    if (_cache[key]) return _cache[key];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`載入失敗：${url}（${res.status}）`);
    _cache[key] = await res.json();
    return _cache[key];
  }

  // ── 各 JSON 檔的 lazy loader ──────────────────────────────

  const DATA_ROOT = "data/";   // 相對於 HTML 的 docs/data/ 目錄

  const loaders = {
    behavior:    () => fetchJSON("behavior",    DATA_ROOT + "behavior.json"),
    radar:       () => fetchJSON("radar",       DATA_ROOT + "radar_chart_data.json"),
    correlation: () => fetchJSON("correlation", DATA_ROOT + "correlation_matrix.json"),
    quiz:        () => fetchJSON("quiz",        DATA_ROOT + "quiz_behavior.json"),
    time:        () => fetchJSON("time",        DATA_ROOT + "time_distribution.json"),
    atRisk:      () => fetchJSON("atRisk",      DATA_ROOT + "at_risk_profile.json"),
  };

  /**
   * 載入行為資料並建立 masked_id → student record 的索引
   * @returns {Promise<{students: Array, byMaskedId: Map}>}
   */
  async function loadBehaviorData() {
    const data = await loaders.behavior();
    const students = data.students || [];
    const byMaskedId = new Map(
      students.map(s => [s.masked_id, s])
    );
    return { students, byMaskedId, meta: data.meta || {} };
  }

  /**
   * 將 behavior students 與另一個 JSON 的 masked_id 欄位 join
   * @param {Array}  sourceList  - 有 masked_id 欄位的資料列表
   * @param {Map}    behaviorMap - loadBehaviorData().byMaskedId
   * @returns {Array} joined records
   */
  function joinByMaskedId(sourceList, behaviorMap) {
    return sourceList.map(item => ({
      ...item,
      behavior: behaviorMap.get(item.masked_id) || null,
    }));
  }

  // ── 載入狀態管理 ─────────────────────────────────────────

  /**
   * 顯示/隱藏 loading 指示器
   * @param {string} containerId - DOM 容器的 id
   * @param {boolean} show
   */
  function setLoading(containerId, show) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle("is-loading", show);

    // 若容器有 loading overlay 子元素
    const overlay = el.querySelector(".loading-overlay");
    if (overlay) overlay.style.display = show ? "flex" : "none";
  }

  /**
   * 顯示錯誤訊息於指定容器
   */
  function showError(containerId, msg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="alert alert-warning py-2 px-3 mt-3" role="alert">
        <small>⚠️ 資料載入失敗：${msg}</small>
      </div>`;
  }

  // ── 公開 API ─────────────────────────────────────────────
  return {
    load: loaders,
    loadBehaviorData,
    joinByMaskedId,
    setLoading,
    showError,
    clearCache: () => Object.keys(_cache).forEach(k => delete _cache[k]),
  };
})();
