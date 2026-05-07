/**
 * tab-behavior-radar.js
 * Phase 2A：學習行為分析 Tab — 雷達圖
 * 依賴：Chart.js (radar)、behavior-loader.js
 */

const BehaviorRadarTab = (() => {

  // ── 維度中文標籤映射 ──────────────────────────────────────
  const DIM_LABELS = {
    aud_completion_rate:   "聽覺教材",
    vid_completion_rate:   "影音教材",
    txt_completion_rate:   "文字教材",
    sup_completion_rate:   "補充筆記",
    tut_ratio:             "輔導資源",
    quz_pass_rate:         "題庫通過率",
    consistency_score:     "學習穩定性",
    material_diversity:    "教材多樣性",
  };

  // ── 分群顏色 ─────────────────────────────────────────────
  const CLUSTER_COLORS = {
    P1:   { border: "rgba(52,  152, 219, 0.9)", bg: "rgba(52,  152, 219, 0.15)" },
    P2:   { border: "rgba(46,  204, 113, 0.9)", bg: "rgba(46,  204, 113, 0.15)" },
    P3:   { border: "rgba(155, 89,  182, 0.9)", bg: "rgba(155, 89,  182, 0.15)" },
    P4:   { border: "rgba(230, 126, 34,  0.9)", bg: "rgba(230, 126, 34,  0.15)" },
    P5:   { border: "rgba(189, 195, 199, 0.9)", bg: "rgba(189, 195, 199, 0.15)" },
    pass: { border: "rgba(39,  174, 96,  0.9)", bg: "rgba(39,  174, 96,  0.12)" },
    fail: { border: "rgba(192, 57,  43,  0.9)", bg: "rgba(192, 57,  43,  0.12)" },
  };

  const CLUSTER_NAMES = {
    P1: "影音輔導型", P2: "彈性聽覺型", P3: "按部就班型",
    P4: "題庫刷題型", P5: "被動低參與型",
  };

  const RANK_MEDALS = ["🥇", "🥈", "🥉"];

  let _radarChart = null;
  let _radarData  = null;

  function _dimensions() {
    const explicit = _radarData?.dimensions || _radarData?.meta?.dimensions;
    if (explicit?.length) return explicit;
    const firstCluster = Object.values(_clusterRows()).find(row => Array.isArray(row?.values));
    if (firstCluster?.values?.length === 6) return ["AUD", "VID", "TXT", "SUP", "TUT", "QUZ"];
    return firstCluster?.values?.map((_, i) => `D${i + 1}`) || [];
  }

  function _clusterRows() {
    return _radarData?.clusters || _radarData || {};
  }

  function _passFailRows() {
    return _radarData?.pass_vs_fail || _radarData || {};
  }

  function _values(row, dims) {
    if (!row) return [];
    if (Array.isArray(row.values)) return row.values;
    return dims.map(d => row[d] ?? row[String(d).toLowerCase()] ?? 0);
  }

  // ── 初始化 ───────────────────────────────────────────────

  async function init(canvasId = "radarChart", controlsId = "radarControls") {
    BehaviorLoader.setLoading("tab-behavior", true);
    try {
      _radarData = await BehaviorLoader.load.radar();
      _renderControls(controlsId);
      renderClusterView(canvasId, Object.keys(CLUSTER_NAMES));
    } catch (err) {
      BehaviorLoader.showError("tab-behavior", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-behavior", false);
    }
  }

  // ── 控制列 ────────────────────────────────────────────────

  function _renderControls(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const clusterBtns = Object.entries(CLUSTER_NAMES).map(([key, name]) => `
      <button class="btn btn-sm cluster-toggle active me-1 mb-1"
              data-cluster="${key}"
              style="border-color:${CLUSTER_COLORS[key].border};color:${CLUSTER_COLORS[key].border};"
              onclick="BehaviorRadarTab.toggleCluster('${key}', this)">
        ${key} ${name}
      </button>`).join("");

    const viewBtns = `
      <div class="btn-group btn-group-sm ms-3" role="group">
        <button class="btn btn-outline-secondary active" id="btnViewCluster"
                onclick="BehaviorRadarTab.switchView('cluster')">依分群</button>
        <button class="btn btn-outline-secondary" id="btnViewPassFail"
                onclick="BehaviorRadarTab.switchView('passfail')">及格/不及格</button>
      </div>`;

    el.innerHTML = `
      <div class="d-flex flex-wrap align-items-center py-2">
        <span class="text-muted me-2 small">顯示分群：</span>
        ${clusterBtns}
        ${viewBtns}
      </div>`;
  }

  // ── 切換顯示模式 ──────────────────────────────────────────

  function switchView(mode) {
    document.getElementById("btnViewCluster")?.classList.toggle("active", mode === "cluster");
    document.getElementById("btnViewPassFail")?.classList.toggle("active", mode === "passfail");
    if (mode === "cluster") {
      renderClusterView("radarChart", Object.keys(CLUSTER_NAMES));
    } else {
      renderPassFailView("radarChart");
    }
  }

  function toggleCluster(key, btn) {
    btn.classList.toggle("active");
    const active = [...document.querySelectorAll(".cluster-toggle.active")]
      .map(b => b.dataset.cluster);
    renderClusterView("radarChart", active);
  }

  // ── 雷達圖：依分群 ────────────────────────────────────────

  function renderClusterView(canvasId, visibleClusters = Object.keys(CLUSTER_NAMES)) {
    if (!_radarData) return;
    const dims   = _dimensions();
    const rows   = _clusterRows();
    const labels = dims.map(d => DIM_LABELS[d] || d);
    const datasets = visibleClusters
      .filter(k => rows[k])
      .map(k => {
        const col = CLUSTER_COLORS[k];
        return {
          label: `${k} ${CLUSTER_NAMES[k]}（n=${rows[k].count || 0}）`,
          data:  _values(rows[k], dims),
          borderColor:          col.border,
          backgroundColor:      col.bg,
          pointBackgroundColor: col.border,
          borderWidth: 2,
          pointRadius: 3,
        };
      });
    if (!labels.length || !datasets.length) {
      _renderEmpty(canvasId, "雷達圖資料格式缺少 dimensions 或 clusters。");
      return;
    }
    _renderChart(canvasId, labels, datasets);
  }

  // ── 雷達圖：及格 vs 不及格 ────────────────────────────────

  function renderPassFailView(canvasId) {
    if (!_radarData) return;
    const dims   = _dimensions();
    const rows   = _passFailRows();
    const labels = dims.map(d => DIM_LABELS[d] || d);
    const datasets = ["pass", "fail"]
      .filter(k => rows[k])
      .map(k => {
        const col = CLUSTER_COLORS[k];
        return {
          label: k === "pass"
            ? `及格（n=${rows[k].count || 0}）`
            : `不及格（n=${rows[k].count || 0}）`,
          data:  _values(rows[k], dims),
          borderColor:          col.border,
          backgroundColor:      col.bg,
          pointBackgroundColor: col.border,
          borderWidth: 2.5,
          pointRadius: 4,
        };
      });
    if (!labels.length || !datasets.length) {
      _renderEmpty(canvasId, "及格/不及格雷達圖資料格式缺少 pass_vs_fail。");
      return;
    }
    _renderChart(canvasId, labels, datasets);
  }

  function _renderEmpty(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    const wrap = canvas?.parentElement;
    if (wrap) {
      canvas.style.display = "none";
      let msg = wrap.querySelector(".behavior-empty-message");
      if (!msg) {
        msg = document.createElement("div");
        msg.className = "behavior-empty-message text-muted small";
        msg.style.cssText = "padding:24px;text-align:center";
        wrap.appendChild(msg);
      }
      msg.textContent = message;
    }
  }

  // ── Chart.js 實例管理 ─────────────────────────────────────

  function _renderChart(canvasId, labels, datasets) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = "";
    canvas.parentElement?.querySelector(".behavior-empty-message")?.remove();
    if (_radarChart) {
      _radarChart.destroy();
      _radarChart = null;
    }
    _radarChart = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            min: 0,
            max: 1,
            ticks: {
              stepSize: 0.2,
              callback: v => `${Math.round(v * 100)}%`,
              font: { size: 10 },
            },
            pointLabels: { font: { size: 12 } },
          },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { size: 12 }, padding: 12 },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              title: ctx => ctx.length ? `📊 ${ctx[0].label}` : "",
              label: ctx => ` ${ctx.dataset.label.split("（")[0]}：${(ctx.raw * 100).toFixed(1)}%`,
              afterBody: ctx => {
                if (!ctx.length) return [];
                const sorted   = [...ctx].sort((a, b) => b.raw - a.raw);
                const dimLabel = ctx[0].label;
                return [
                  `🏆 ${dimLabel} 各群排名：`,
                  ...sorted.map((c, i) => {
                    const medal = RANK_MEDALS[i] ?? `${i + 1}.`;
                    return `  ${medal} ${c.dataset.label.split("（")[0]}：${(c.raw * 100).toFixed(1)}%`;
                  }),
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const lines = ["👥 各群人數："];
                ctx.forEach(c => {
                  const m = c.dataset.label.match(/n=(\d+)/);
                  if (m) lines.push(`  ${c.dataset.label.split("（")[0]}：${m[1]} 人`);
                });
                return lines;
              },
            },
          },
        },
      },
    });
  }

  // ── 分群人數摘要卡片 ──────────────────────────────────────

  function renderClusterSummary(containerId) {
    if (!_radarData) return;
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = _clusterRows();
    const cards = Object.entries(CLUSTER_NAMES).map(([key, name]) => {
      const n   = rows[key]?.count || 0;
      const col = CLUSTER_COLORS[key];
      return `
        <div class="behavior-cluster-card"
             style="flex:0 0 132px;min-width:132px;border:1px solid rgba(110,130,165,.22);border-radius:8px;background:#fff;padding:10px 12px;box-shadow:0 2px 8px rgba(20,35,60,.06)">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
            <span style="font-weight:700;color:${col.border};font-size:.92rem">${key}</span>
            <span style="font-weight:700;color:${col.border};font-size:1.45rem;line-height:1">${n}</span>
          </div>
          <div title="${name}" style="margin-top:6px;font-size:.82rem;line-height:1.25;color:#4f5f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
        </div>`;
    }).join("");
    el.innerHTML = `
      <div style="display:flex;flex-direction:row;gap:10px;align-items:stretch;overflow-x:auto;padding:4px 2px 8px">
        ${cards}
      </div>`;
  }

  return { init, switchView, toggleCluster, renderClusterSummary };
})();
