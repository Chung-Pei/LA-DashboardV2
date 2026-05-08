/**
 * tab-behavior-correlation.js
 * Phase 2B：相關性分析 Tab — Pearson 熱力圖 + 散佈圖
 * 依賴：Chart.js (scatter)、behavior-loader.js
 */

const BehaviorCorrelationTab = (() => {

  // ── 欄位中文標籤 ─────────────────────────────────────────
  const FEAT_LABELS = {
    aud_completion_rate:      "聽覺教材完成率",
    aud_total_minutes:        "聽覺教材學習時間",
    vid_completion_rate:      "影音教材完成率",
    vid_total_minutes:        "影音教材學習時間",
    txt_completion_rate:      "文字教材完成率",
    txt_total_minutes:        "文字教材學習時間",
    sup_completion_rate:      "補充筆記完成率",
    sup_total_minutes:        "補充筆記學習時間",
    tut_total_minutes:        "輔導資源時間",
    quz_total_attempts:       "題庫作答次數",
    quz_pass_rate:            "題庫通過率",
    quz_coverage:             "題庫涵蓋率",
    quz_late_cram:            "題庫考前集中度",
    total_learning_minutes:   "總學習時間",
    material_diversity_score: "教材多樣性",
    consistency_score:        "學習穩定性",
    early_start_ratio:        "提早學習比例",
    cram_pattern_score:       "臨陣磨槍指數",
    pre_exam_intensity:       "考前學習強度",
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
  let _behaviorByMasked = null;   // masked_id → behavior student（用於 join cluster）
  let _allSemesters     = [];     // 可用學期列表
  let _filterSemester   = "all";  // 目前學期篩選
  let _filterCluster    = "all";  // 目前分群篩選
  let _corrType         = "pearson"; // "pearson" | "spearman"

  function _targets() {
    const explicit = _corrData?.targets || _corrData?.grades;
    if (explicit?.length) return explicit;
    const p = _corrData?.pearson || {};
    const targetLike = Object.keys(p).filter(k => /score|grade|midterm|final/i.test(k));
    return targetLike.length ? targetLike : Object.keys(p);
  }

  function _features() {
    if (_corrData?.features?.length) return _corrData.features;
    const p = _corrData?.pearson || {};
    const targets = _targets();
    const fromTargetRows = targets.flatMap(target => Object.keys(p[target] || {}));
    if (fromTargetRows.length) return [...new Set(fromTargetRows)];
    return Object.keys(p);
  }

  function _pearson(feat, target) {
    // Reads active matrix: spearman when _corrType==="spearman", else pearson
    const m = (_corrType === "spearman")
      ? (_corrData?.spearman || _corrData?.pearson || {})
      : (_corrData?.pearson || {});
    return m[feat]?.[target] ?? m[target]?.[feat] ?? null;
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
        return Object.values(row).some(v => Number.isFinite(Number(v)));
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

  function _pickGradeRecord(records, targetSemester) {
    const usable = (records || []).filter(rec => {
      if (targetSemester && String(rec.semester || "") !== String(targetSemester)) return false;
      return _toNumber(rec.midterm) !== null ||
        _toNumber(rec.final) !== null ||
        _toNumber(rec.semester_score) !== null;
    });
    if (!usable.length) return null;
    usable.sort((a, b) => {
      const scoreA = (_toNumber(a.midterm) !== null ? 1 : 0) +
        (_toNumber(a.final) !== null ? 1 : 0) +
        (_toNumber(a.semester_score) !== null ? 1 : 0);
      const scoreB = (_toNumber(b.midterm) !== null ? 1 : 0) +
        (_toNumber(b.final) !== null ? 1 : 0) +
        (_toNumber(b.semester_score) !== null ? 1 : 0);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return String(b.semester || "").localeCompare(String(a.semester || ""));
    });
    return usable[0];
  }

  function _gradeMapFromData(mainData, targetSemester) {
    const map = new Map();
    const students = mainData?.students || {};
    Object.entries(students).forEach(([sourceId, info]) => {
      const rec = _pickGradeRecord(info?.records, targetSemester);
      if (!rec) return;
      const row = {
        masked_id: info?.name_masked || sourceId,
        midterm_score: _toNumber(rec.midterm),
        final_score: _toNumber(rec.final),
        semester_score: _toNumber(rec.semester_score),
      };
      map.set(sourceId, row);
      map.set(row.masked_id, row);
    });
    return map;
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
    const targetSemester = sourceData?.meta?.semester || behavior.meta?.semester || mainData?.meta?.semester || "";
    let gradeMap = _gradeMapFromData(mainData, targetSemester);
    const targets = _targetList(sourceData);
    const features = _featureListFromBehavior(students, sourceData);

    let joined = students.map(s => {
      const grades = gradeMap.get(s.masked_id);
      if (!grades) return null;
      return {
        anon_id: s.anon_id,
        masked_id: s.masked_id,
        cluster: s.cluster || "",
        features: s.features || {},
        ...grades,
      };
    }).filter(Boolean);

    if (!joined.length && targetSemester) {
      gradeMap = _gradeMapFromData(mainData, "");
      joined = students.map(s => {
        const grades = gradeMap.get(s.masked_id);
        if (!grades) return null;
        return {
          anon_id: s.anon_id,
          masked_id: s.masked_id,
          cluster: s.cluster || "",
          features: s.features || {},
          ...grades,
        };
      }).filter(Boolean);
    }

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
      if (!_hasUsableCorrelation(_corrData)) {
        _corrData = await _rebuildCorrelationFromMainData(_corrData);
      }

      // 建立 masked_id → behavior student 索引（取得 cluster）
      const bStudents = behaviorData?.students || [];
      _behaviorByMasked = new Map(bStudents.map(s => [s.masked_id, s]));

      // 備份全量並 join cluster 欄位
      const raw = _corrData?.scatter_data || [];
      _allScatterData = Array.isArray(raw)
        ? raw.map(row => ({
            ...row,
            cluster: row.cluster || _behaviorByMasked.get(row.masked_id)?.cluster || "",
            semester: row.semester || "",
          }))
        : raw;

      // 收集可用學期（從 meta）
      _allSemesters = Array.isArray(_corrData?.meta?.semesters)
        ? _corrData.meta.semesters
        : (behaviorData?.meta?.semesters || []);

      _filterSemester = "all";
      _filterCluster  = "all";

      _renderFilterBar(heatmapId);
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

    const bar = document.createElement("div");
    bar.id = "corrFilterBar";
    bar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;border:1px solid rgba(110,130,165,.22);border-radius:10px;background:var(--card-bg2,#f8f9fa)";
    bar.innerHTML = `
      <span style="font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap">篩選條件</span>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">年度</label>
        <select id="corrSemFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${semOptions}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <label style="font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap">分群</label>
        <select id="corrClusterFilter"
                style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer"
                onchange="BehaviorCorrelationTab.onFilterChange()">
          ${clusterOptions}
        </select>
      </div>
      <span id="corrFilterCount" style="font-size:.76rem;color:var(--text-dim,#888)"></span>
      <span style="margin-left:auto;display:inline-flex;align-items:center;gap:5px">
        <span style="font-size:.76rem;color:var(--text-dim,#888)">方法</span>
        <button id="btnCorrPearson" onclick="BehaviorCorrelationTab.setCorrType('pearson')">Pearson <i>r</i></button><button id="btnCorrSpearman" onclick="BehaviorCorrelationTab.setCorrType('spearman')">Spearman <i>ρ</i></button>
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
    _filterSemester = document.getElementById("corrSemFilter")?.value || "all";
    _filterCluster  = document.getElementById("corrClusterFilter")?.value || "all";
    _applyFiltersAndRender("corrHeatmap", "scatterSection");
  }

  // ── 取得篩選後資料 ────────────────────────────────────────

  function _filteredScatterData() {
    const raw = _allScatterData;
    if (!Array.isArray(raw)) return raw;
    return raw.filter(row => {
      if (_filterSemester !== "all") {
        const rowSem = String(row.semester || "").replace(/-/g,"");
        const selSem = String(_filterSemester).replace(/-/g,"");
        if (rowSem && rowSem !== selSem) return false;
        // 若 scatter_data 本身無 semester，不過濾（data 是跨年彙總）
      }
      if (_filterCluster !== "all") {
        if ((row.cluster || "") !== _filterCluster) return false;
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
        const textColor = Math.abs(r) > 0.55 ? "#fff" : "#333";
        return `<td class="text-center small" style="background:${bg};color:${textColor};cursor:pointer"
                    onclick="BehaviorCorrelationTab.showScatter('${feat}','${g}')"
                    title="${FEAT_LABELS[feat] || feat} vs ${GRADE_LABELS[g] || g}: ${corrSym}=${r}">
                  ${corrSym}${r >= 0 ? "+" : ""}${r.toFixed(2)}
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
        <span style="background:${_rToColor(0)};color:#333;padding:1px 6px;border-radius:3px;margin-left:4px">無相關</span>
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
      el.innerHTML = `<div style="padding:14px;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);border-radius:8px;font-size:.82rem;color:#a04000">⚠️ ${noDataReason}</div>`;
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
                if (r != null) {
                  const st = Math.abs(r) >= 0.5 ? "強" : Math.abs(r) >= 0.3 ? "中等" : "弱";
                  lines.push(`📈 Pearson r = ${r >= 0 ? "+" : ""}${r.toFixed(3)}  → ${st}${r >= 0 ? "正" : "負"}相關`);
                }
                const rho = _spearmanValue(
                  _scatterRows(feat, gradeCol).map(d => ({ features: { [feat]: d.x }, [gradeCol]: d.y })),
                  feat, gradeCol
                );
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
