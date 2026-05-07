/**
 * tab-behavior-radar.js
 * Phase 2A：學習行為分析 Tab — 雷達圖
 * 依賴：Chart.js (radar)、behavior-loader.js
 */

const BehaviorRadarTab = (() => {

  // ── 維度中文標籤映射 ──────────────────────────────────────
  const DIM_LABELS = {
    AUD:                   "AUD 聽覺教材",
    VID:                   "VID 影音教材",
    TXT:                   "TXT 文字教材",
    SUP:                   "SUP 補充筆記",
    TUT:                   "TUT 輔導資源",
    QUZ:                   "QUZ 題庫測驗",
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
    P1: "影音輔導型", P2: "彈性聽覺型", P3: "平均使用型",
    P4: "題庫刷題型", P5: "被動低參與型",
  };

  const RANK_MEDALS = ["🥇", "🥈", "🥉"];

  let _radarChart = null;
  let _radarData  = null;
  let _behaviorMeta = {};
  let _behaviorStudents = [];
  let _allStudents = [];      // 全量學生（用於年度篩選）
  let _allSemesters = [];     // 所有可用學期列表
  let _selectedSemester = "all"; // 目前選擇的學期

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

  function _nonEmpty(value) {
    return value !== undefined && value !== null && value !== "" &&
      !(Array.isArray(value) && value.length === 0);
  }

  function _mergedMeta() {
    const meta = {};
    [_behaviorMeta || {}, _radarData?.meta || {}].forEach(source => {
      Object.entries(source).forEach(([key, value]) => {
        if (_nonEmpty(value)) meta[key] = value;
      });
    });
    return meta;
  }

  function _values(row, dims) {
    if (!row) return [];
    const raw = Array.isArray(row.values)
      ? row.values
      : dims.map(d => row[d] ?? row[String(d).toLowerCase()] ?? 0);
    return raw.map(_clampRate);
  }

  function _clampRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(n, 1));
  }

  function _clusterTotal() {
    const rows = _clusterRows();
    const total = Object.values(rows).reduce((sum, row) => sum + (Number(row?.count) || 0), 0);
    const meta = _mergedMeta();
    return total || Number(meta?.student_count) || 0;
  }

  function _passFailCount(key, row) {
    const explicit = Number(row?.count);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const students = _behaviorStudents || [];
    if (!students.length) return 0;
    return students.filter(s => {
      const score = Number(s.final_score ?? s.features?.final_score);
      if (!Number.isFinite(score)) return false;
      return key === "pass" ? score >= 60 : score < 60;
    }).length;
  }

  function _formatSemester(sem) {
    const s = String(sem || "").trim();
    const m = s.match(/^(\d{3})-?([12])$/);
    return m ? `${m[1]}(${m[2]})` : s;
  }

  function _semesterText(meta = {}) {
    if (meta.semester_range_label) return meta.semester_range_label;
    if (meta.semester_range) return meta.semester_range;
    const sems = Array.isArray(meta.semesters) ? meta.semesters.filter(Boolean) : [];
    if (sems.length) {
      const labels = sems.map(_formatSemester);
      return labels[0] === labels[labels.length - 1]
        ? labels[0]
        : `${labels[0]}-${labels[labels.length - 1]}`;
    }
    return _formatSemester(meta.semester) || "未標示";
  }

  function _formatDateTime(value) {
    if (!value) return "未標示";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function _renderBehaviorMetaStrip() {
    const meta = _mergedMeta();
    const total = _clusterTotal();
    // 若有選擇特定年度，顯示該年度標籤；否則顯示全範圍
    const semesterText = _selectedSemester && _selectedSemester !== "all"
      ? _formatSemester(_selectedSemester)
      : _semesterText(meta);
    const el = document.getElementById("behaviorMetaStrip");
    if (el) {
      el.style.display = "";
      el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
          <div style="border:1px solid rgba(46,204,113,.28);background:rgba(46,204,113,.08);border-radius:8px;padding:8px 10px">
            <div style="font-size:.74rem;color:var(--text-dim,#888)">行為資料年度</div>
            <div style="font-weight:700;color:#239b56">${semesterText}</div>
          </div>
          <div style="border:1px solid rgba(79,142,247,.25);background:rgba(79,142,247,.08);border-radius:8px;padding:8px 10px">
            <div style="font-size:.74rem;color:var(--text-dim,#888)">總分析人數</div>
            <div style="font-weight:700;color:var(--accent,#3498db)">${total.toLocaleString()} 位學生</div>
          </div>
          <div style="border:1px solid rgba(110,130,165,.22);background:var(--card-bg2,#f8f9fa);border-radius:8px;padding:8px 10px">
            <div style="font-size:.74rem;color:var(--text-dim,#888)">行為資料更新</div>
            <div style="font-weight:700;color:var(--text-mid,#566)">${_formatDateTime(meta.generated_at)}</div>
          </div>
        </div>`;
    }
    const badge = document.getElementById("behaviorRangeBadge");
    if (badge && total) {
      badge.style.display = "inline-flex";
      badge.textContent = `行為 ${semesterText} · ${total.toLocaleString()}人`;
    }
  }

  // ── 初始化 ───────────────────────────────────────────────

  async function init(canvasId = "radarChart", controlsId = "radarControls") {
    BehaviorLoader.setLoading("tab-behavior", true);
    try {
      const [radarData, behaviorData] = await Promise.all([
        BehaviorLoader.load.radar(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);
      _radarData = radarData;
      _behaviorMeta = behaviorData?.meta || {};
      _behaviorStudents = behaviorData?.students || [];
      _allStudents = _behaviorStudents;
      // 收集所有學期（從 meta.semesters 或學生資料）
      _allSemesters = Array.isArray(_behaviorMeta.semesters) && _behaviorMeta.semesters.length
        ? [..._behaviorMeta.semesters]
        : [];
      _selectedSemester = "all";
      _renderBehaviorMetaStrip();
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

    // ── 年度選擇器 ──
    const semOptions = [
      `<option value="all">全部年度（${(_behaviorMeta.semester_range_label || _behaviorMeta.semester_range || "—")}）</option>`,
      ..._allSemesters.map(s => `<option value="${s}">${_formatSemester(s)}</option>`),
    ].join("");

    const yearSelector = _allSemesters.length
      ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
           <span style="font-size:.8rem;color:var(--text-dim,#888);white-space:nowrap">選擇年度：</span>
           <select id="behaviorYearSelect"
                   style="font-size:.82rem;padding:4px 8px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer"
                   onchange="BehaviorRadarTab.onYearChange(this.value)">
             ${semOptions}
           </select>
         </div>`
      : "";

    // ── 顯示模式按鈕（先放，邏輯主開關）──
    const viewBtns = `
      <div class="behavior-view-toggle" role="group" aria-label="雷達圖顯示模式" style="margin-bottom:8px">
        <button class="behavior-view-btn active" id="btnViewCluster"
                onclick="BehaviorRadarTab.switchView('cluster')">依分群</button>
        <button class="behavior-view-btn" id="btnViewPassFail"
                onclick="BehaviorRadarTab.switchView('passfail')">及格/不及格</button>
      </div>`;

    // ── P1–P5 分群篩選按鈕（依分群模式下才顯示）──
    const clusterBtns = Object.entries(CLUSTER_NAMES).map(([key, name]) => `
      <button class="cluster-toggle active"
              data-cluster="${key}"
              style="--cluster-color:${CLUSTER_COLORS[key].border};--cluster-bg:${CLUSTER_COLORS[key].bg};"
              onclick="BehaviorRadarTab.toggleCluster('${key}', this)">
        <span class="cluster-code">${key}</span>
        <span>${name}</span>
      </button>`).join("");

    el.innerHTML = `
      <style>
        #${containerId} .behavior-control-panel {
          display:flex;
          flex-direction:column;
          gap:4px;
        }
        #${containerId} .cluster-panel {
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          margin-top:4px;
        }
        #${containerId} .cluster-toggle {
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 10px;
          border-radius:20px;
          border:1.5px solid var(--cluster-color);
          background:transparent;
          color:var(--cluster-color);
          font-size:.78rem;
          cursor:pointer;
          transition:background .15s,color .15s;
          font-family:inherit;
        }
        #${containerId} .cluster-toggle.active {
          background:var(--cluster-bg);
        }
        #${containerId} .cluster-code {
          font-weight:700;
          font-family:'JetBrains Mono','Courier New',monospace;
        }
        #${containerId} .behavior-view-toggle {
          display:inline-flex;
          border-radius:8px;
          overflow:hidden;
          border:1px solid var(--accent,#3498db);
        }
        #${containerId} .behavior-view-btn {
          padding:5px 14px;
          border:none;
          background:transparent;
          color:var(--accent,#3498db);
          cursor:pointer;
          font-size:.82rem;
          font-family:inherit;
        }
        #${containerId} .behavior-view-btn.active {
          background:var(--accent,#3498db);
          color:#fff;
        }
      </style>
      <div class="behavior-control-panel">
        ${yearSelector}
        ${viewBtns}
        <div class="cluster-panel" id="clusterBtnPanel">
          ${clusterBtns}
        </div>
      </div>`;
  }
  // ── 切換顯示模式 ──────────────────────────────────────────

  function switchView(mode) {
    document.getElementById("btnViewCluster")?.classList.toggle("active", mode === "cluster");
    document.getElementById("btnViewPassFail")?.classList.toggle("active", mode === "passfail");
    // 依分群模式才顯示 P1-P5 按鈕
    const clusterPanel = document.getElementById("clusterBtnPanel");
    if (clusterPanel) clusterPanel.style.display = mode === "cluster" ? "flex" : "none";
    if (mode === "cluster") {
      renderClusterView("radarChart", Object.keys(CLUSTER_NAMES));
    } else {
      renderPassFailView("radarChart");
    }
  }

  function onYearChange(semester) {
    _selectedSemester = semester;

    if (semester === "all") {
      // 全部年度：使用頂層 clusters / pass_vs_fail（跨年彙總）
      _behaviorStudents = _allStudents;
      // 還原 _radarData 至全量
      if (_radarData?._base) {
        _radarData = _radarData._base;
      }
    } else {
      // 特定年度：切換到 by_semester[semester]
      const base = _radarData?._base || _radarData;
      const semData = base?.by_semester?.[semester];
      if (semData) {
        // 建立一個暫時的 radarData 結構，覆蓋 clusters / pass_vs_fail
        _radarData = {
          ...base,
          _base: base,               // 保留原始資料供切回「全部」使用
          clusters:    semData.clusters,
          pass_vs_fail: semData.pass_vs_fail,
          meta: {
            ...(base.meta || {}),
            student_count: semData.student_count,
          },
        };
      } else {
        // 無對應年度資料（舊版 ETL 產出），保留全量並提示
        console.warn(`[BehaviorRadarTab] by_semester["${semester}"] 不存在，請重新執行 ETL`);
        const base2 = _radarData?._base || _radarData;
        _radarData = { ...base2, _base: base2 };
      }
      // 篩選 behaviorStudents（用於 pass/fail 人數統計）
      _behaviorStudents = _allStudents.filter(s =>
        String(s.semester || "").replace(/-/g, "") === String(semester).replace(/-/g, "")
      );
    }

    // 更新 meta strip 顯示
    _renderBehaviorMetaStrip();

    // 重繪
    const activeMode = document.getElementById("btnViewPassFail")?.classList.contains("active")
      ? "passfail" : "cluster";
    // 重置分群按鈕為全選狀態
    document.querySelectorAll(".cluster-toggle").forEach(b => b.classList.add("active"));
    switchView(activeMode);
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
            ? `及格（n=${_passFailCount(k, rows[k])}）`
            : `不及格（n=${_passFailCount(k, rows[k])}）`,
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
        maintainAspectRatio: false,
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
            align: "center",
            labels: {
              boxWidth: 34,
              boxHeight: 12,
              font: { size: 13, weight: "600" },
              padding: 16,
            },
          },
          tooltip: {
            mode: "nearest",
            intersect: true,
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
    const total = _clusterTotal();
    const totalCard = `
      <div class="behavior-cluster-card"
           style="flex:0 0 150px;min-width:150px;border:1px solid rgba(46,204,113,.28);border-radius:8px;background:rgba(46,204,113,.08);padding:10px 12px;box-shadow:0 2px 8px rgba(20,35,60,.06)">
        <div style="font-size:.78rem;color:var(--text-dim,#888)">總分析人數</div>
        <div style="margin-top:4px;font-weight:800;color:#239b56;font-size:1.45rem;line-height:1">${total.toLocaleString()}</div>
        <div style="margin-top:6px;font-size:.78rem;line-height:1.25;color:#4f5f78">100.0%</div>
      </div>`;
    const cards = Object.entries(CLUSTER_NAMES).map(([key, name]) => {
      const n   = rows[key]?.count || 0;
      const pct = total ? (n / total) * 100 : 0;
      const col = CLUSTER_COLORS[key];
      return `
        <div class="behavior-cluster-card"
             style="flex:0 0 144px;min-width:144px;border:1px solid rgba(110,130,165,.22);border-radius:8px;background:#fff;padding:10px 12px;box-shadow:0 2px 8px rgba(20,35,60,.06)">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
            <span style="font-weight:700;color:${col.border};font-size:.92rem">${key}</span>
            <span style="font-weight:700;color:${col.border};font-size:1.45rem;line-height:1">${n}</span>
          </div>
          <div title="${name}" style="margin-top:6px;font-size:.82rem;line-height:1.25;color:#4f5f78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="margin-top:3px;font-size:.76rem;line-height:1.2;color:var(--text-dim,#888)">佔 ${pct.toFixed(1)}%</div>
        </div>`;
    }).join("");
    el.innerHTML = `
      <div style="display:flex;flex-direction:row;gap:10px;align-items:stretch;overflow-x:auto;padding:4px 2px 8px">
        ${totalCard}
        ${cards}
      </div>`;
  }

  return { init, switchView, toggleCluster, renderClusterSummary, onYearChange };
})();
