/**
 * tab-behavior-correlation.js
 * Phase 2B：相關性分析 Tab — Pearson 熱力圖 + 散佈圖
 * 依賴：Chart.js (scatter)、behavior-loader.js
 */

const BehaviorCorrelationTab = (() => {

  // ── 欄位中文標籤 ─────────────────────────────────────────
  const FEAT_LABELS = {
    aud_completion_rate:      "聽覺教材完成率",
    vid_completion_rate:      "影音教材完成率",
    txt_completion_rate:      "文字教材完成率",
    sup_completion_rate:      "補充筆記完成率",
    tut_total_minutes:        "輔導資源時間",
    quz_total_attempts:       "題庫作答次數",
    quz_pass_rate:            "題庫通過率",
    total_learning_minutes:   "總學習時間",
    material_diversity_score: "教材多樣性",
    consistency_score:        "學習穩定性",
    early_start_ratio:        "提早學習比例",
    cram_pattern_score:       "臨陣磨槍指數",
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
    const p = _corrData?.pearson || {};
    return p[feat]?.[target] ?? p[target]?.[feat] ?? null;
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

  // ── 初始化 ───────────────────────────────────────────────

  async function init(heatmapId = "corrHeatmap", scatterWrapperId = "scatterSection") {
    BehaviorLoader.setLoading("tab-correlation", true);
    try {
      _corrData = await BehaviorLoader.load.correlation();
      _renderHeatmap(heatmapId);
      _renderScatterSelector(scatterWrapperId);
    } catch (err) {
      BehaviorLoader.showError("tab-correlation", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-correlation", false);
    }
  }

  // ── Pearson 熱力圖（HTML table + 色彩映射）────────────────

  function _renderHeatmap(containerId) {
    const el = document.getElementById(containerId);
    if (!el || !_corrData) return;

    const features = _features();
    const grades   = _targets();
    const pearson  = _corrData.pearson  || {};

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
                    title="${FEAT_LABELS[feat] || feat} vs ${GRADE_LABELS[g] || g}: r=${r}">
                  ${r >= 0 ? "+" : ""}${r.toFixed(2)}
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
        點擊儲存格可查看散佈圖。色彩：
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
      el.innerHTML = `<p class="text-muted small">（散佈圖資料尚未產出，請執行 ETL）</p>`;
      return;
    }

    el.innerHTML = `
      <h6 class="mt-4 mb-2 fw-semibold">散佈圖</h6>
      <div id="scatterChartWrap">
        <canvas id="scatterChart" style="max-height:320px"></canvas>
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
                if (!ctx.length || r == null) return [];
                const strength = Math.abs(r) >= 0.5 ? "強" : Math.abs(r) >= 0.3 ? "中等" : "弱";
                const dir      = r >= 0 ? "正" : "負";
                return [
                  `📈 Pearson r = ${r >= 0 ? "+" : ""}${r.toFixed(3)}`,
                  `   → ${strength}${dir}相關`,
                ];
              },
            },
          },
        },
      },
    });
  }

  return { init, showScatter };
})();
