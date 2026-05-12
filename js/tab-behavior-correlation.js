/**
 * tab-behavior-correlation.js
 * Phase 2B：相關性分析 Tab — Pearson 熱力圖 + 散佈圖
 * 依賴：Chart.js (scatter)、behavior-loader.js
 */

const BehaviorCorrelationTab = (() => {

  // ── 欄位中文標籤 ─────────────────────────────────────────
  const FEAT_LABELS = {
    aud_completion_rate:          "聽覺教材完成率",
    aud_total_minutes:            "聽覺教材學習時間",
    vid_completion_rate:          "影音教材完成率",
    vid_total_minutes:            "影音教材學習時間",
    txt_completion_rate:          "文字教材完成率",
    txt_total_minutes:            "文字教材學習時間",
    sup_completion_rate:          "補充筆記完成率",
    sup_total_minutes:            "補充筆記學習時間",
    tut_total_minutes:            "輔導資源時間",
    quz_total_attempts:           "題庫作答次數",
    quz_pass_rate:                "題庫通過率",
    quz_coverage:                 "題庫涵蓋率",
    quz_late_cram:                "題庫考前集中度(3天)",
    total_learning_minutes:       "總學習時間",
    material_diversity_score:     "教材多樣性",
    consistency_score:            "學習穩定性",
    early_start_ratio:            "提早學習比例",
    cram_pattern_score:           "臨陣磨槍指數",
    pre_exam_intensity:           "考前學習強度",
    // Ph2b 新增：題庫品質指標
    quz_first_attempt_accuracy:   "首答正確率",
    quz_final_accuracy:           "最終正確率",
    quz_score_delta:              "成績進步幅度",
    quz_cramming_ratio:           "考前7天刷題比",
  };

  const GRADE_LABELS = {
    grade_midterm:  "期中成績",
    grade_final:    "期末成績",
    grade_total:    "學期成績",
    midterm_score:  "期中成績",
    final_score:    "期末成績",
    semester_score: "學期成績",
  };

  let _corrData     = null;
  let _scatterChart = null;
  let _currentTarget = null;

  // ── 篩選狀態 ─────────────────────────────────────────────
  let _allScatterData   = null;   // 全量 scatter_data（篩選的基底）
  let _behaviorByMasked = null;   // masked_id → behavior student
  let _behaviorByAnon   = null;   // anon_id → behavior student
  let _allSemesters     = [];     // 可用學期列表
  let _allEduTypes      = [];     // Ph2b：可用學制列表（動態從資料取）
  let _filterSemester   = "all";
  let _filterCluster    = "all";
  let _filterPass       = "all";
  let _filterEduType    = "all";  // Ph2b：學制篩選
  let _filterOutlier    = false;  // Ph2b：異常值排除開關
  let _corrType         = "pearson";

  /**
   * 讀取目前相關係數矩陣中的 r 值。
   * Ph2b Breaking change：pearson 結構從純 float 改為 {r, p, significant}。
   * 此函式統一解包，確保整個 module 取到的都是 number | null。
   */
  function _pearson(feat, target) {
    const m = (_corrType === "spearman")
      ? (_corrData?.spearman || _corrData?.pearson || {})
      : (_corrData?.pearson || {});
    const raw = m[feat]?.[target] ?? m[target]?.[feat] ?? null;
    // 支援新格式 {r, p, significant} 與舊格式 number 並存
    if (raw !== null && typeof raw === "object") return raw.r ?? null;
    return raw;
  }

  /**
   * Ph2b 新增：讀取 p-value（僅 Pearson 模式下有效）。
   */
  function _pearsonP(feat, target) {
    const m = _corrData?.pearson || {};
    const raw = m[feat]?.[target] ?? m[target]?.[feat] ?? null;
    if (raw !== null && typeof raw === "object") return raw.p ?? null;
    return null;
  }

  function _features() {
    if (_corrData?.features?.length) return _corrData.features;
    const p = _corrData?.pearson || {};
    const targets = _targets();
    const fromTargetRows = targets.flatMap(target => Object.keys(p[target] || {}));
    if (fromTargetRows.length) return [...new Set(fromTargetRows)];
    return Object.keys(p);
  }

  function _scatterRows(feat, target) {
    const raw = _corrData?.scatter_data || [];
    if (Array.isArray(raw)) {
      return raw
        .map(row => ({
          x: row.features?.[feat],
          y: row[target],
          masked_id: row.masked_id,
        }))
        .filter(row => row.x != null && row.y != null && isFinite(row.x) && isFinite(row.y));
    }
    return raw[`${feat}_vs_${target}`] || [];
  }

  function _toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function _hasUsableCorrelation(data) {
    const pearson = data?.pearson || {};
    const hasR = Object.values(pearson).some(row => {
      if (row && typeof row === "object") {
        return Object.values(row).some(v => {
          // 相容新格式 {r, p, significant} 與舊格式 float
          const rVal = (v && typeof v === "object") ? v.r : v;
          return Number.isFinite(Number(rVal));
        });
      }
      return Number.isFinite(Number(row));
    });
    const scatter = data?.scatter_data || [];
    const hasScatter = Array.isArray(scatter)
      ? scatter.length > 0
      : Object.keys(scatter).length > 0;
    return hasR && hasScatter;
  }

  function _featureListFromBehavior(students, sourceData) {
    if (sourceData?.features?.length) return sourceData.features;
    const seen = new Set();
    students.forEach(s => {
      Object.keys(s.features || {}).forEach(k => seen.add(k));
    });
    const preferred = Object.keys(FEAT_LABELS).filter(k => seen.has(k));
    const remaining = [...seen].filter(k => !preferred.includes(k));
    return [...preferred, ...remaining];
  }

  function _targetList(sourceData) {
    if (sourceData?.targets?.length) return sourceData.targets;
    if (sourceData?.grades?.length) return sourceData.grades;
    return ["midterm_score", "final_score"];
  }

  function _gradeRowsFromData(mainData, targetSemester) {
    const rows = [];
    const students = mainData?.students || {};
    Object.entries(students).forEach(([sourceId, info]) => {
      (info?.records || []).forEach(rec => {
        if (targetSemester && String(rec.semester || "") !== String(targetSemester)) return;
        if (_toNumber(rec.midterm) === null &&
            _toNumber(rec.final) === null &&
            _toNumber(rec.semester_score) === null) return;
        rows.push({
          source_id: sourceId,
          masked_id: info?.name_masked || sourceId,
          semester: String(rec.semester || ""),
          midterm_score: _toNumber(rec.midterm),
          final_score: _toNumber(rec.final),
          semester_score: _toNumber(rec.semester_score),
        });
      });
    });
    return rows;
  }

  function _pearsonValue(rows, feat, target) {
    const pairs = rows
      .map(row => ({ x: _toNumber(row.features?.[feat]), y: _toNumber(row[target]) }))
      .filter(p => p.x !== null && p.y !== null);
    if (pairs.length < 5) return null;
    const meanX = pairs.reduce((sum, p) => sum + p.x, 0) / pairs.length;
    const meanY = pairs.reduce((sum, p) => sum + p.y, 0) / pairs.length;
    let num = 0;
    let denX = 0;
    let denY = 0;
    pairs.forEach(p => {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    });
    const den = Math.sqrt(denX * denY);
    if (!den) return null;
    return Math.round((num / den) * 10000) / 10000;
  }

  // ── Spearman 等級相關係數 ─────────────────────────────────
  function _rankArray(arr) {
    const n = arr.length;
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && indexed[j].v === indexed[i].v) j++;
      const avg = (i + j + 1) / 2;
      for (let k = i; k < j; k++) ranks[indexed[k].i] = avg;
      i = j;
    }
    return ranks;
  }

  function _spearmanValue(rows, feat, target) {
    const pairs = rows
      .map(row => ({ x: _toNumber(row.features?.[feat]), y: _toNumber(row[target]) }))
      .filter(p => p.x !== null && p.y !== null);
    if (pairs.length < 5) return null;
    const xs = pairs.map(p => p.x);
    const ys = pairs.map(p => p.y);
    const rx = _rankArray(xs), ry = _rankArray(ys);
    const n = rx.length;
    const mX = rx.reduce((s, v) => s + v, 0) / n;
    const mY = ry.reduce((s, v) => s + v, 0) / n;
    let num = 0, dX = 0, dY = 0;
    for (let i = 0; i < n; i++) {
      const dx = rx[i] - mX, dy = ry[i] - mY;
      num += dx * dy; dX += dx * dx; dY += dy * dy;
    }
    const den = Math.sqrt(dX * dY);
    return den ? Math.round(num / den * 10000) / 10000 : null;
  }

  async function _rebuildCorrelationFromMainData(sourceData) {
    const mainData = typeof DATA !== "undefined" ? DATA : window.DATA;
    if (!mainData?.students || !BehaviorLoader?.loadBehaviorData) return sourceData;

    const behavior = await BehaviorLoader.loadBehaviorData();
    const students = behavior.students || [];
    // BUG-1 修正：使用實際篩選學期（而非硬編碼空字串），確保重建時不混入其他年度
    const targetSemester = (_filterSemester !== "all") ? _filterSemester : "";
    const gradeRows = _gradeRowsFromData(mainData, targetSemester);
    const targets = _targetList(sourceData);
    const features = _featureListFromBehavior(students, sourceData);
    const byAnon = new Map(students.map(s => [s.anon_id, s]));
    const byMasked = new Map(students.map(s => [s.masked_id, s]));

    const joined = gradeRows.map(grades => {
      const s = byAnon.get(grades.anon_id) || byMasked.get(grades.masked_id);
      if (!s) return null;
      return {
        anon_id: s.anon_id,
        masked_id: s.masked_id,
        semester: grades.semester || s.semester || "",
        cluster: s.cluster || "",
        features: s.features || {},
        ...grades,
      };
    }).filter(Boolean);

    if (!joined.length) return sourceData;

    const pearson = {};
    targets.forEach(target => {
      pearson[target] = {};
      features.forEach(feat => {
        pearson[target][feat] = _pearsonValue(joined, feat, target);
      });
    });

    return {
      ...sourceData,
      features,
      targets,
      pearson,
      scatter_data: joined,
      meta: {
        ...(sourceData?.meta || {}),
        semesters: sourceData?.meta?.semesters || mainData?.meta?.semesters || behavior.meta?.semesters || [],
        rebuilt_in_browser: true,
        joined_students: joined.length,
      },
    };
  }

  // ── 初始化 ───────────────────────────────────────────────

  async function init(heatmapId = "corrHeatmap", scatterWrapperId = "scatterSection") {
    BehaviorLoader.setLoading("tab-correlation", true);
    try {
      // 同步載入 correlation + behavior（用於分群 join）
      const [corrRaw, behaviorData] = await Promise.all([
        BehaviorLoader.load.correlation(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);

      _corrData = corrRaw;
      const rawScatter = _corrData?.scatter_data || [];
      const needsRebuild = !_hasUsableCorrelation(_corrData) ||
        (Array.isArray(rawScatter) && rawScatter.length > 0 &&
          (!rawScatter.some(r => r.semester) || !rawScatter.some(r => r.cluster)));
      if (needsRebuild) {
        _corrData = await _rebuildCorrelationFromMainData(_corrData);
      }

      // 建立 masked_id → behavior student 索引（取得 cluster）
      const bStudents = behaviorData?.students || [];
      _behaviorByMasked = new Map(bStudents.map(s => [s.masked_id, s]));
      _behaviorByAnon = new Map(bStudents.map(s => [s.anon_id, s]));

      // 備份全量並 join cluster 欄位
      const raw = _corrData?.scatter_data || [];
      _allScatterData = Array.isArray(raw)
        ? raw.map(row => {
            const behaviorRow = _behaviorByAnon.get(row.anon_id) || _behaviorByMasked.get(row.masked_id);
            return {
              ...row,
              cluster:  row.cluster  || behaviorRow?.cluster  || "",
              semester: row.semester || behaviorRow?.semester  || "",
              edu_type: row.edu_type || "",   // Ph2b：學制
            };
          })
        : raw;

      // 收集可用學期（從 meta）
      _allSemesters = Array.isArray(_corrData?.meta?.semesters)
        ? _corrData.meta.semesters
        : (behaviorData?.meta?.semesters || []);

      // Ph2b：動態收集可用學制（從 scatter_data.edu_type）
      _allEduTypes = Array.isArray(_allScatterData)
        ? [...new Set(_allScatterData.map(r => r.edu_type).filter(Boolean))]
        : [];

      _filterSemester = "all";
      _filterCluster  = "all";
      _filterPass     = "all";
      _filterEduType  = "all";
      _filterOutlier  = false;

      _renderFilterBar(heatmapId);
      _renderInsightsBadge(heatmapId);   // Ph2b：最高相關指標 badge
      _applyFiltersAndRender(heatmapId, scatterWrapperId);
    } catch (err) {
      BehaviorLoader.showError("tab-correlation", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-correlation", false);
    }
  }

  // ── 篩選列 ───────────────────────────────────────────────

  function _formatSemLabel(sem) {
    const s = String(sem || "").trim();
    const m = s.match(/^(\d{3})-?([12])$/);
    return m ? `${m[1]}(${m[2]})` : s;
  }

  const CLUSTER_NAMES_CORR = {
    P1: "影音輔導型", P2: "彈性聽覺型", P3: "平均使用型",
    P4: "題庫刷題型", P5: "被動低參與型",
  };

  function _renderFilterBar(insertBeforeId) {
    const anchor = document.getElementById(insertBeforeId);
    if (!anchor) return;

    // 避免重複插入
    const existing = document.getElementById("corrFilterBar");
    if (existing) { existing.remove(); }

    const semOptions = [
      `<option value="all">全部年度</option>`,
      ..._allSemesters.map(s => `<option value="${s}">${_formatSemLabel(s)}</option>`),
    ].join("");

    const _clCounts = {};
    if (Array.isArray(_allScatterData)) {
      _allScatterData.forEach(r => { const c = r.cluster || ""; if (c) _clCounts[c] = (_clCounts[c] || 0) + 1; });
    }
    const clusterOptions = [
      `<option value="all">全部分群（${Array.isArray(_allScatterData) ? _allScatterData.length : "—"}）</option>`,
      ...Object.entries(CLUSTER_NAMES_CORR).map(([k, n]) => {
        const cnt = _clCounts[k] || 0;
        const dis = cnt === 0 ? " disabled" : "";
        return `<option value="${k}"${dis}>${k} ${n}${cnt > 0 ? "（" + cnt + "）" : "（無資料）"}</option>`;
      }),
    ].join("");

    const passOptions = [
      `<option value="all">全部</option>`,
      `<option value="pass">及格</option>`,
      `<option value="fail">不及格</option>`,
    ].join("");

    // Ph2b：學制選單（依學制邏輯說明排序）
    const EDU_TYPE_ORDER = ["二技一般","二技在職","二技夜間","四技一般","學士後護","重修班","重修生"];
    const sortedEduTypes = [..._allEduTypes].sort(
      (a, b) => (EDU_TYPE_ORDER.indexOf(a) + 1 || 99) - (EDU_TYPE_ORDER.indexOf(b) + 1 || 99)
    );
    const eduTypeOptions = [
      `<option value="all">全部學制</option>`,
      ...sortedEduTypes.map(t => `<option value="${t}">${t}</option>`),
    ].join("");

    const hasOutlierData = Object.keys(_corrData?.outlier_thresholds || {}).length > 0;

    const bar = document.createElement("div");
    bar.id = "corrFilterBar";
    bar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;border:1px solid rgba(110,130,165,.22);border-radius:10px;background:var(--card-bg2,#1c2030)";
    bar.innerHTML = `
      <span style="font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap">篩選條件</span>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">年度</label>
        <select id="corrSemFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${semOptions}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">學制</label>
        <select id="corrEduTypeFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${eduTypeOptions}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">分群</label>
        <select id="corrClusterFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${clusterOptions}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">及格/不及格</label>
        <select id="corrPassFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${passOptions}
        </select>
      </div>
      ${hasOutlierData ? `
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap;cursor:pointer" for="corrOutlierToggle">
          <input type="checkbox" id="corrOutlierToggle"
                 onchange="BehaviorCorrelationTab.onFilterChange()"
                 style="margin-right:4px;cursor:pointer">
          排除異常值
        </label>
      </div>` : ""}
      <span id="corrFilterCount" style="font-size:.76rem;color:var(--text-dim,#888)"></span>
      <span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px">
        <span style="font-size:.76rem;color:var(--text-dim,#888)">方法</span>
        <button id="btnCorrPearson"  onclick="BehaviorCorrelationTab.setCorrType('pearson')">Pearson <i>r</i></button>
        <button id="btnCorrSpearman" onclick="BehaviorCorrelationTab.setCorrType('spearman')">Spearman <i>ρ</i></button>
      </span>`;

    anchor.parentNode.insertBefore(bar, anchor);
    _updateCorrTypeButtons();
  }

  function _updateCorrTypeButtons() {
    const btnP = document.getElementById("btnCorrPearson");
    const btnS = document.getElementById("btnCorrSpearman");
    if (!btnP || !btnS) return;
    const ip = _corrType === "pearson";
    const ac = "var(--accent,#3498db)";
    btnP.style.cssText = `font-size:.76rem;padding:3px 9px;border-radius:6px 0 0 6px;border:1px solid ${ac};background:${ip ? ac : "transparent"};color:${ip ? "#fff" : ac};cursor:pointer;font-family:inherit;font-weight:${ip ? "700" : "400"}`;
    btnS.style.cssText = `font-size:.76rem;padding:3px 9px;border-radius:0 6px 6px 0;border:1px solid ${ac};background:${ip ? "transparent" : ac};color:${ip ? ac : "#fff"};cursor:pointer;font-family:inherit;font-weight:${ip ? "400" : "700"}`;
  }

  function setCorrType(type) {
    _corrType = type;
    _updateCorrTypeButtons();
    _renderHeatmap("corrHeatmap");
  }

  function onFilterChange() {
    _filterSemester = document.getElementById("corrSemFilter")?.value     || "all";
    _filterCluster  = document.getElementById("corrClusterFilter")?.value  || "all";
    _filterPass     = document.getElementById("corrPassFilter")?.value     || "all";
    _filterEduType  = document.getElementById("corrEduTypeFilter")?.value  || "all";  // Ph2b
    _filterOutlier  = document.getElementById("corrOutlierToggle")?.checked ?? false; // Ph2b
    _applyFiltersAndRender("corrHeatmap", "scatterSection");
  }

  // ── 取得篩選後資料 ────────────────────────────────────────

  // BUG-3 修正：與 BehaviorTimeTab.PASS_THRESHOLD 對齊，統一使用此常數，
  // 避免兩處各自硬編碼 60 造成日後不同步。
  const PASS_THRESHOLD_CORR = 60;

  function _filteredScatterData() {
    const raw = _allScatterData;
    if (!Array.isArray(raw)) return raw;

    // Ph2b：異常值閾值（來自 ETL 預算）
    const thresholds = _corrData?.outlier_thresholds || {};

    return raw.filter(row => {
      if (_filterSemester !== "all") {
        const rowSem = String(row.semester || "").replace(/-/g,"");
        const selSem = String(_filterSemester).replace(/-/g,"");
        if (rowSem && rowSem !== selSem) return false;
      }
      if (_filterCluster !== "all") {
        if ((row.cluster || "") !== _filterCluster) return false;
      }
      if (_filterPass !== "all") {
        const score = _toNumber(row.semester_score ?? row.final_score ?? row.grade_total);
        if (score === null) return false;
        const passing = score >= PASS_THRESHOLD_CORR;
        if (_filterPass === "pass" && !passing) return false;
        if (_filterPass === "fail" && passing) return false;
      }
      // Ph2b：學制篩選
      if (_filterEduType !== "all") {
        if ((row.edu_type || "") !== _filterEduType) return false;
      }
      // Ph2b：異常值排除（IQR 法，使用 ETL 預算閾值）
      if (_filterOutlier && Object.keys(thresholds).length) {
        for (const [feat, bounds] of Object.entries(thresholds)) {
          const val = _toNumber(row.features?.[feat]);
          if (val === null) continue;
          if (val < bounds.iqr_lower || val > bounds.iqr_upper) return false;
        }
      }
      return true;
    });
  }

  function _applyFiltersAndRender(heatmapId, scatterWrapperId) {
    const filtered = _filteredScatterData();
    const count = Array.isArray(filtered) ? filtered.length : "—";

    // 更新人數標示
    const countEl = document.getElementById("corrFilterCount");
    const semHasSemesterField = Array.isArray(_allScatterData) &&
      _allScatterData.some(r => r.semester);
    const semNote = (_filterSemester !== "all" && !semHasSemesterField)
      ? "（年度欄位尚未由 ETL 產出，篩選無效）"
      : "";
    if (countEl) countEl.textContent = `共 ${count} 筆${semNote}`;

    // 用篩選後資料重建 pearson
    const features = _features();
    const targets  = _targets();
    if (Array.isArray(filtered) && filtered.length >= 5) {
      const pearson = {}, spearman = {};
      targets.forEach(target => {
        pearson[target] = {}; spearman[target] = {};
        features.forEach(feat => {
          pearson[target][feat]  = _pearsonValue(filtered, feat, target);
          spearman[target][feat] = _spearmanValue(filtered, feat, target);
        });
      });
      _corrData = { ..._corrData, pearson, spearman, scatter_data: filtered };
    } else {
      // 人數不足：保留既有矩陣（不重算），只更新 scatter_data
      _corrData = { ..._corrData, scatter_data: filtered };
    }

    _renderHeatmap(heatmapId);
    _renderScatterSelector(scatterWrapperId);
  }

  // ── Pearson 熱力圖（HTML table + 色彩映射）────────────────

  function _renderHeatmap(containerId) {
    const el = document.getElementById(containerId);
    if (!el || !_corrData) return;

    const features = _features();
    const grades   = _targets();
    const isSpearman = _corrType === "spearman";
    const matrix = isSpearman
      ? (_corrData.spearman || _corrData.pearson || {})
      : (_corrData.pearson || {});
    const pearson = matrix; // alias for _pearson() helper
    const corrSym = isSpearman ? "ρ" : "r";

    if (!features.length || !grades.length) {
      el.innerHTML = `<p class="text-muted small">相關性資料格式缺少 features / targets。</p>`;
      return;
    }

    const gradeHeaderCells = grades.map(g =>
      `<th class="text-center small fw-normal" style="min-width:90px">
        ${GRADE_LABELS[g] || g}
      </th>`
    ).join("");

    const rows = features.map(feat => {
      const cells = grades.map(g => {
        const r = _pearson(feat, g);
        if (r == null) return `<td class="text-center text-muted small">—</td>`;
        const bg        = _rToColor(r);
        const textColor = Math.abs(r) > 0.55 ? "#fff" : "var(--text,#dde3f5)";
        // Ph2b：p-value 顯著性星號（僅 Pearson 模式）
        const p = _corrType === "pearson" ? _pearsonP(feat, g) : null;
        const sig = p !== null ? (p < 0.01 ? "**" : p < 0.05 ? "*" : "") : "";
        const pTip = p !== null ? ` p=${p.toFixed(4)}` : "";
        return `<td class="text-center small" style="background:${bg};color:${textColor};cursor:pointer"
                    onclick="BehaviorCorrelationTab.showScatter('${feat}','${g}')"
                    title="${FEAT_LABELS[feat] || feat} vs ${GRADE_LABELS[g] || g}: ${corrSym}=${r}${pTip}">
                  ${corrSym}${r >= 0 ? "+" : ""}${r.toFixed(2)}${sig ? `<sup style="font-size:.65em;opacity:.9">${sig}</sup>` : ""}
                </td>`;
      }).join("");
      return `<tr>
        <td class="small text-nowrap pe-2">${FEAT_LABELS[feat] || feat}</td>
        ${cells}
      </tr>`;
    }).join("");

    el.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-bordered mb-1" style="font-size:0.85rem">
          <thead>
            <tr>
              <th class="text-muted fw-normal">學習行為指標</th>
              ${gradeHeaderCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="text-muted small mb-0">
        點擊儲存格可查看散佈圖（${isSpearman ? "Spearman ρ" : "Pearson r"}）。色彩：
        <span style="background:${_rToColor(0.6)};color:#fff;padding:1px 6px;border-radius:3px">強正相關</span>
        <span style="background:${_rToColor(-0.6)};color:#fff;padding:1px 6px;border-radius:3px;margin-left:4px">強負相關</span>
        <span style="background:${_rToColor(0)};color:var(--text,#dde3f5);padding:1px 6px;border-radius:3px;margin-left:4px">無相關</span>
        ${!isSpearman ? `<span style="margin-left:8px;font-size:.78em;opacity:.75">* p&lt;0.05　** p&lt;0.01</span>` : ""}
      </p>`;
  }

  /** r → rgba 顏色（正：藍，負：紅，0：白） */
  function _rToColor(r) {
    const abs = Math.min(Math.abs(r || 0), 1);
    const v   = Math.round(abs * 180);
    return r >= 0
      ? `rgba(${70 - v}, ${130 + v}, 220, ${0.15 + abs * 0.75})`
      : `rgba(${200 + v}, 60, 60, ${0.15 + abs * 0.75})`;
  }

  /**
   * Ph2b B6：最高相關指標 Badge + score_delta / cramming 洞察摘要。
   * 插入於熱力圖容器上方；無 correlation_insights 資料時靜默不顯示。
   */
  function _renderInsightsBadge(insertBeforeId) {
    const anchor = document.getElementById(insertBeforeId);
    if (!anchor) return;

    const existing = document.getElementById("corrInsightsBadge");
    if (existing) existing.remove();

    const ci = _corrData?.correlation_insights;
    if (!ci) return;

    const lines = [];

    // 最高相關指標
    const hr = ci.highest_r_feature;
    if (hr?.feature && hr?.r != null) {
      const featLabel   = FEAT_LABELS[hr.feature]   || hr.feature;
      const targetLabel = GRADE_LABELS[hr.target]   || hr.target;
      const rSign       = hr.r >= 0 ? "+" : "";
      lines.push(
        `🏆 <strong>最高相關指標</strong>：${featLabel} × ${targetLabel}　<code>r = ${rSign}${hr.r.toFixed(3)}</code>`
      );
    }

    // score_delta 相關性
    const sd = ci.score_delta_correlation;
    if (sd?.final != null) {
      const sign = sd.final >= 0 ? "+" : "";
      lines.push(
        `📈 <strong>成績進步幅度</strong> × 期末成績：<code>r = ${sign}${sd.final.toFixed(3)}</code>`
      );
    }

    // cramming_ratio 相關性
    const cr = ci.cramming_correlation;
    if (cr?.final != null) {
      const sign = cr.final >= 0 ? "+" : "";
      lines.push(
        `🕐 <strong>考前7天刷題比</strong> × 期末成績：<code>r = ${sign}${cr.final.toFixed(3)}</code>`
      );
    }

    if (!lines.length) return;

    const badge = document.createElement("div");
    badge.id = "corrInsightsBadge";
    badge.style.cssText = [
      "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding:9px 13px",
      "border:1px solid rgba(52,152,219,.25);border-radius:9px",
      "background:rgba(52,152,219,.06);font-size:.8rem;line-height:1.6",
      "color:var(--text-mid,#9aa0b8)",
    ].join(";");
    badge.innerHTML = lines.map(l => `<span>${l}</span>`).join("");

    anchor.parentNode.insertBefore(badge, anchor);
  }

  // ── 散佈圖選擇器 ─────────────────────────────────────────

  function _renderScatterSelector(wrapperId) {
    const el = document.getElementById(wrapperId);
    if (!el || !_corrData) return;

    const scatterData = _corrData.scatter_data || [];
    const hasScatterData = Array.isArray(scatterData)
      ? scatterData.length > 0
      : Object.keys(scatterData).length > 0;
    if (!hasScatterData) {
      const noDataReason = (_filterCluster !== "all")
        ? `分群 ${_filterCluster} 在本相關性資料集中無對應學生（兩資料集學生母體不同）`
        : (_filterSemester !== "all")
          ? `年度 ${_filterSemester} 尚無獨立散佈圖資料（ETL 尚未產出 by_semester）`
          : "散佈圖資料尚未產出，請執行 ETL";
      el.innerHTML = `<div style="padding:14px;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);border-radius:8px;font-size:.82rem;color:var(--accent3,#a04000)">⚠️ ${noDataReason}</div>`;
      return;
    }

    el.innerHTML = `
      <h6 class="mt-4 mb-2 fw-semibold">散佈圖</h6>
      <div id="scatterChartWrap" style="position:relative;height:320px;width:100%">
        <canvas id="scatterChart"></canvas>
      </div>`;

    if (Array.isArray(scatterData)) {
      const firstFeat = (_features())[0];
      const firstTarget = (_targets())[0];
      if (firstFeat && firstTarget) showScatter(firstFeat, firstTarget);
    } else {
      const firstKey                = Object.keys(scatterData)[0];
      const [featPart, , gradePart] = firstKey.split("_vs_");
      showScatter(featPart, gradePart || "grade_total");
    }
  }

  // ── 散佈圖渲染 ───────────────────────────────────────────

  /** 計算 value 在已排序陣列中的百分位（0–100） */
  function _percentile(sortedArr, value) {
    const below = sortedArr.filter(v => v < value).length;
    return Math.round((below / sortedArr.length) * 100);
  }

  function showScatter(feat, gradeCol) {
    if (!_corrData) return;
    _currentTarget = { feat, gradeCol };

    const raw    = _scatterRows(feat, gradeCol);
    const r      = _pearson(feat, gradeCol);
    const rLabel = r != null ? ` (r = ${r >= 0 ? "+" : ""}${r.toFixed(3)})` : "";

    const points  = raw.map(d => ({ x: d.x, y: d.y, masked: d.masked_id }));
    if (!points.length) return;

    // 預計算百分位排序陣列（提升到 render 時，避免每次 hover 重複運算）
    const sortedX = [...points.map(p => p.x)].sort((a, b) => a - b);
    const sortedY = [...points.map(p => p.y)].sort((a, b) => a - b);

    const isRateField = feat.includes("rate") || feat.includes("ratio") || feat.includes("score");

    const canvas = document.getElementById("scatterChart");
    if (!canvas) return;

    // BUG-2 修正：在 chart 建立前預先計算 Spearman ρ，避免每次 hover 重複 O(n) 運算
    const rho = _spearmanValue(
      raw.map(d => ({ features: { [feat]: d.x }, [gradeCol]: d.y })),
      feat, gradeCol
    );
    // BUG-2 修正：相關係數標籤依 _corrType 動態切換（非永遠顯示 Pearson r）
    const corrLabelInFooter = _corrType === "spearman"
      ? (rho  != null ? `📊 Spearman ρ = ${rho  >= 0 ? "+" : ""}${rho.toFixed(3)}` : null)
      : (r    != null ? `📈 Pearson  r = ${r    >= 0 ? "+" : ""}${r.toFixed(3)}`  : null);

    if (_scatterChart) { _scatterChart.destroy(); _scatterChart = null; }

    _scatterChart = new Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: {
        datasets: [{
          label: `${FEAT_LABELS[feat] || feat} vs ${GRADE_LABELS[gradeCol] || gradeCol}${rLabel}`,
          data: points,
          backgroundColor: "rgba(52, 152, 219, 0.55)",
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: FEAT_LABELS[feat] || feat, font: { size: 11 } },
            ticks: {
              callback: v => isRateField ? `${Math.round(v * 100)}%` : v,
            },
          },
          y: {
            title: { display: true, text: GRADE_LABELS[gradeCol] || gradeCol, font: { size: 11 } },
            min: 0, max: 100,
          },
        },
        plugins: {
          legend: { labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: ctx => ctx.length ? `學生 ${ctx[0].raw.masked}` : "",
              label: ctx => {
                const p      = ctx.raw;
                const xLabel = isRateField ? `${(p.x * 100).toFixed(1)}%` : p.x.toFixed(2);
                return [
                  ` ${FEAT_LABELS[feat] || feat}：${xLabel}`,
                  ` ${GRADE_LABELS[gradeCol] || gradeCol}：${p.y} 分`,
                ];
              },
              afterLabel: ctx => {
                const p    = ctx.raw;
                const xPct = _percentile(sortedX, p.x);
                const yPct = _percentile(sortedY, p.y);
                return [
                  ` 行為指標：高於 ${xPct}% 同學`,
                  ` 成績：高於 ${yPct}% 同學`,
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const lines = [];
                // BUG-2 修正：使用提升到 render 時預算的值（不再每次 hover 重算）
                if (r != null) {
                  const st = Math.abs(r) >= 0.5 ? "強" : Math.abs(r) >= 0.3 ? "中等" : "弱";
                  lines.push(`📈 Pearson r = ${r >= 0 ? "+" : ""}${r.toFixed(3)}  → ${st}${r >= 0 ? "正" : "負"}相關`);
                }
                if (rho != null) {
                  const ss = Math.abs(rho) >= 0.5 ? "強" : Math.abs(rho) >= 0.3 ? "中等" : "弱";
                  lines.push(`📊 Spearman ρ = ${rho >= 0 ? "+" : ""}${rho.toFixed(3)}  → ${ss}${rho >= 0 ? "正" : "負"}相關`);
                }
                return lines;
              },
            },
          },
        },
      },
    });
  }

  return { init, showScatter, onFilterChange, setCorrType };
})();
