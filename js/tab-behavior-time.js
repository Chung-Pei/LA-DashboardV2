/**
 * tab-behavior-time.js
 * Phase 2C：時間分析 Tab
 *   - 週強度折線圖（題庫作答）
 *   - 平時及考前學習強度
 *   - 學習時段圓環圖
 * 依賴：Chart.js、behavior-loader.js
 */

const BehaviorTimeTab = (() => {

  const SLOT_LABELS = {
    MORNING:    "上午 06-12",
    AFTERNOON:  "下午 12-18",
    EVENING:    "傍晚 18-23",
    LATE_NIGHT: "深夜 23-06",
  };

  const SLOT_COLORS = [
    "rgba(241, 196, 15,  0.80)",
    "rgba(52,  152, 219, 0.80)",
    "rgba(155, 89,  182, 0.80)",
    "rgba(44,  62,  80,  0.75)",
  ];

  const SLOT_TIPS = {
    MORNING:    "早晨學習，記憶力佳、專注度高",
    AFTERNOON:  "午後學習，效率穩定",
    EVENING:    "傍晚學習，適合複習整理",
    LATE_NIGHT: "深夜學習可能影響睡眠品質，建議調整",
  };

  const CLUSTER_NAMES = {
    P1: "影音輔導型",
    P2: "彈性聽覺型",
    P3: "平均使用型",
    P4: "題庫刷題型",
    P5: "被動低參與型",
  };

  const PREP_TYPES = [
    { key: "steady", label: "平時準備型", color: "rgba(46, 204, 113, 0.78)" },
    { key: "high_cram", label: "高度衝刺型", color: "rgba(231, 76, 60, 0.78)" },
    { key: "moderate", label: "適度備考型", color: "rgba(52, 152, 219, 0.78)" },
    { key: "low", label: "考試低準備型", color: "rgba(149, 165, 166, 0.72)" },
  ];

  let _quizData = null;
  let _timeData = null;
  let _behaviorData = null;
  let _charts = {};
  let _filterSemester = "all";
  let _filterCluster = "all";
  let _filterPass = "all";
  let _allSemesters = [];

  function _avg(values) {
    const nums = values.filter(v => v != null && isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }

  function _num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function _normalizeSem(value) {
    return String(value || "").replace(/-/g, "");
  }

  function _formatSemLabel(sem) {
    const s = String(sem || "").trim();
    const m = s.match(/^(\d{3})-?([12])$/);
    return m ? `${m[1]}(${m[2]})` : s;
  }

  function _isPassing(row) {
    const score = _num(row.final_score ?? row.semester_score);
    return Number.isFinite(score) && score >= 60;
  }

  function _weekAvgAttempts(w) {
    if (w.avg_attempts != null) return _num(w.avg_attempts);
    return _avg([w.pass_group_avg_attempts, w.fail_group_avg_attempts].map(_num));
  }

  function _weekPassRate(w) {
    return _num(w.avg_pass_rate ?? w.overall_pass_rate);
  }

  function _weekActiveStudents(w) {
    return _num(w.active_students ?? w.total_students ??
      ((w.pass_group_active_students || 0) + (w.fail_group_active_students || 0)));
  }

  function _availableSemesters() {
    const fromMeta = [
      ...(_behaviorData?.meta?.semesters || []),
      ...(_timeData?.meta?.semesters || []),
      ...(_quizData?.meta?.semesters || []),
    ];
    const fromRows = _studentRows(false).map(r => r.semester).filter(Boolean);
    return [...new Set([...fromMeta, ...fromRows])].sort();
  }

  async function init() {
    BehaviorLoader.setLoading("tab-time", true);
    try {
      [_quizData, _timeData, _behaviorData] = await Promise.all([
        BehaviorLoader.load.quiz(),
        BehaviorLoader.load.time(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);
      _allSemesters = _availableSemesters();
      _renderFilterBar();
      _renderAll();
    } catch (err) {
      BehaviorLoader.showError("tab-time", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-time", false);
    }
  }

  function _renderFilterBar() {
    const el = document.getElementById("tab-time");
    if (!el) return;
    const semOptions = [
      `<option value="all">全部年度</option>`,
      ..._allSemesters.map(s => `<option value="${s}"${s === _filterSemester ? " selected" : ""}>${_formatSemLabel(s)}</option>`),
    ].join("");
    const clusterOptions = [
      `<option value="all">全部分群</option>`,
      ...Object.entries(CLUSTER_NAMES).map(([k, v]) => `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${v}</option>`),
    ].join("");
    const passOptions = [
      `<option value="all">全部</option>`,
      `<option value="pass"${_filterPass === "pass" ? " selected" : ""}>及格</option>`,
      `<option value="fail"${_filterPass === "fail" ? " selected" : ""}>不及格</option>`,
    ].join("");
    el.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;padding:10px 12px;border:1px solid rgba(110,130,165,.22);border-radius:10px;background:var(--card-bg2,#f8f9fa)">
        <span style="font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap">篩選條件</span>
        <label style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--text-dim,#888)">年度
          <select id="timeSemFilter" onchange="BehaviorTimeTab.onFilterChange()" style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer">${semOptions}</select>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--text-dim,#888)">分群
          <select id="timeClusterFilter" onchange="BehaviorTimeTab.onFilterChange()" style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer">${clusterOptions}</select>
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:.78rem;color:var(--text-dim,#888)">及格/不及格
          <select id="timePassFilter" onchange="BehaviorTimeTab.onFilterChange()" style="font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#ddd);background:var(--surface2,#f8f9fa);color:var(--text-mid,#444);cursor:pointer">${passOptions}</select>
        </label>
        <span id="timeFilterCount" style="font-size:.76rem;color:var(--text-dim,#888)"></span>
      </div>`;
  }

  function onFilterChange() {
    _filterSemester = document.getElementById("timeSemFilter")?.value || "all";
    _filterCluster = document.getElementById("timeClusterFilter")?.value || "all";
    _filterPass = document.getElementById("timePassFilter")?.value || "all";
    _renderAll();
  }

  function _renderAll() {
    const rows = _filteredStudentRows();
    const countEl = document.getElementById("timeFilterCount");
    const hasSemesterField = _studentRows(false).some(r => r.semester);
    const semNote = _filterSemester !== "all" && !hasSemesterField
      ? "（目前資料未含學生年度欄位，請重跑新版 ETL 取得精準分年）"
      : "";
    if (countEl) countEl.textContent = `共 ${rows.length.toLocaleString()} 筆${semNote}`;
    renderWeeklyQuiz("weeklyQuizChart");
    renderPreExamIntensity("preExamChart");
    renderTimeSlotDonut("timeSlotChart");
  }

  function _mainGradeRows() {
    const mainData = typeof DATA !== "undefined" ? DATA : window.DATA;
    const students = mainData?.students || {};
    const rows = [];
    Object.entries(students).forEach(([sourceId, info]) => {
      (info?.records || []).forEach(rec => {
        rows.push({
          source_id: sourceId,
          masked_id: info?.name_masked || sourceId,
          semester: String(rec.semester || ""),
          final_score: rec.final,
          semester_score: rec.semester_score,
        });
      });
    });
    return rows;
  }

  function _studentRows(applyFilters = true) {
    const timeByAnon = new Map((_timeData?.students || []).map(s => [s.anon_id, s]));
    const timeByMasked = new Map((_timeData?.students || []).map(s => [s.masked_id, s]));
    const source = (_behaviorData?.students?.length ? _behaviorData.students : _timeData?.students) || [];
    const byMasked = new Map(source.map(s => [s.masked_id, s]));
    const gradeRows = _mainGradeRows();
    const rowSource = gradeRows.length
      ? gradeRows.map(g => ({ ...(byMasked.get(g.masked_id) || {}), ...g }))
      : source;
    const rows = rowSource.map(s => {
      const timeRow = timeByAnon.get(s.anon_id) || timeByMasked.get(s.masked_id) || {};
      const features = s.features || {};
      const profile = s.time_profile || {};
      return {
        anon_id: s.anon_id || timeRow.anon_id,
        masked_id: s.masked_id || timeRow.masked_id,
        semester: s.semester || timeRow.semester || "",
        cluster: s.cluster || timeRow.cluster || "",
        final_score: s.final_score ?? timeRow.final_score,
        semester_score: s.semester_score ?? timeRow.semester_score,
        totalMinutes: _num(features.total_learning_minutes ?? timeRow.total_learning_minutes),
        preMidterm: _num(profile.pre_midterm_7d_minutes ?? timeRow.pre_midterm_7d_minutes),
        preFinal: _num(profile.pre_final_7d_minutes ?? timeRow.pre_final_7d_minutes),
        midRegular: _num(profile.midterm_regular_minutes ?? timeRow.midterm_regular_minutes),
        finalRegular: _num(profile.final_regular_minutes ?? timeRow.final_regular_minutes),
        midPeriod: _num(profile.midterm_period_minutes ?? timeRow.midterm_period_minutes),
        finalPeriod: _num(profile.final_period_minutes ?? timeRow.final_period_minutes),
        activeWeeks: _num(profile.active_weeks ?? timeRow.active_weeks),
        timeSlotDistribution: profile.time_slot_distribution || timeRow.time_slot_distribution || {},
      };
    });
    return applyFilters ? _filterRows(rows) : rows;
  }

  function _filterRows(rows) {
    return rows.filter(row => {
      if (_filterSemester !== "all" && row.semester &&
          _normalizeSem(row.semester) !== _normalizeSem(_filterSemester)) return false;
      if (_filterCluster !== "all" && row.cluster !== _filterCluster) return false;
      if (_filterPass !== "all") {
        const hasScore = row.final_score != null || row.semester_score != null;
        if (!hasScore) return false;
        const pass = _isPassing(row);
        if (_filterPass === "pass" && !pass) return false;
        if (_filterPass === "fail" && pass) return false;
      }
      return true;
    });
  }

  function _filteredStudentRows() {
    return _studentRows(true);
  }

  // Chart.js 自訂 plugin：在 W9 / W18 畫紅色垂直標線
  const examLinePlugin = {
    id: "examVerticalLines",
    afterDraw(chart) {
      const { ctx, scales, data } = chart;
      const xScale = scales.x;
      if (!xScale) return;
      const examWeeks = [9, 18];
      const examLabels = { 9: "期中考", 18: "期末考" };
      data.labels.forEach((label, i) => {
        const weekNum = parseInt(label.replace("W", ""), 10);
        if (!examWeeks.includes(weekNum)) return;
        const x = xScale.getPixelForValue(i);
        const top = chart.chartArea.top;
        const bottom = chart.chartArea.bottom;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
        ctx.lineWidth = 2;
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillStyle = "rgba(220, 38, 38, 0.90)";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(examLabels[weekNum], x, top - 4);
        ctx.restore();
      });
    },
  };

  function _segmentKey() {
    const sem = _filterSemester === "all" ? "all" : _normalizeSem(_filterSemester);
    return `${sem}|${_filterCluster}|${_filterPass}`;
  }

  function _weeksForFilter() {
    const baseWeeks = _quizData?.weeks || [];
    const semData = _filterSemester !== "all"
      ? _quizData?.by_semester?.[_filterSemester] || _quizData?.by_semester?.[_normalizeSem(_filterSemester)]
      : null;
    const sourceWeeks = semData?.weeks || baseWeeks;
    const key = _segmentKey();
    return sourceWeeks.map(w => w.segments?.[key] || w.segments?.[`all|${_filterCluster}|${_filterPass}`] || w);
  }

  function renderWeeklyQuiz(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_quizData) return;

    const rawWeeks = _weeksForFilter();
    const weekMap = new Map(rawWeeks.map(w => [Number(w.week), w]));
    const weeks = [];
    for (let i = 1; i <= 18; i++) {
      const fallback = i === 9 || i === 18
        ? { week: i, title: `第${i}週 ${i === 9 ? "期中考" : "期末考"}`, is_exam_week: true, exam_type: i === 9 ? "midterm" : "final", active_students: 0, avg_attempts: 0, overall_pass_rate: 0 }
        : { week: i, title: `第${i}週 練習題庫`, active_students: 0, avg_attempts: 0, overall_pass_rate: 0 };
      weeks.push({ ...fallback, ...(weekMap.get(i) || {}) });
    }

    const labels = weeks.map(w => `W${w.week}`);
    const avgAttempts = weeks.map(w => _weekAvgAttempts(w));
    const avgPassRate = weeks.map(w => _weekPassRate(w) * 100);
    const activeStudents = weeks.map(w => _weekActiveStudents(w));
    const validAttempts = avgAttempts.filter(v => v != null);
    const semAvg = validAttempts.reduce((a, b) => a + b, 0) / (validAttempts.length || 1);
    const maxStudents = Math.max(...activeStudents.filter(v => v != null), 1);

    if (_charts.weeklyQuiz) { _charts.weeklyQuiz.destroy(); }
    try { Chart.register(examLinePlugin); } catch(_) {}

    _charts.weeklyQuiz = new Chart(canvas.getContext("2d"), {
      type: "line",
      plugins: [examLinePlugin],
      data: {
        labels,
        datasets: [
          {
            label: "平均作答次數",
            data: avgAttempts,
            borderColor: "rgba(52, 152, 219, 0.9)",
            backgroundColor: "rgba(52, 152, 219, 0.1)",
            fill: true,
            tension: 0.35,
            yAxisID: "yAttempts",
            pointRadius: 3,
            spanGaps: true,
          },
          {
            label: "平均及格率 (%)",
            data: avgPassRate,
            borderColor: "rgba(39, 174, 96, 0.9)",
            backgroundColor: "transparent",
            borderDash: [5, 4],
            tension: 0.35,
            yAxisID: "yPassRate",
            pointRadius: 2,
            spanGaps: true,
          },
          {
            label: "作答人數",
            data: activeStudents,
            borderColor: "rgba(127, 140, 141, 0.95)",
            backgroundColor: "transparent",
            borderDash: [3, 3],
            tension: 0.2,
            yAxisID: "yAttempts",
            pointRadius: 2,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: true },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          yAttempts: { position: "left", title: { display: true, text: "次數 / 人數", font: { size: 10 } }, min: 0 },
          yPassRate: { position: "right", title: { display: true, text: "及格率 (%)", font: { size: 10 } }, min: 0, max: 100, grid: { drawOnChartArea: false } },
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: ctx => {
                if (!ctx.length) return "";
                const w = weeks[ctx[0].dataIndex];
                const examTag = w.is_exam_week
                  ? (w.exam_type === "final" ? " 期末考週" : " 期中考週")
                  : (w.is_pre_exam ? " 考前週" : "");
                return `第 ${w.week} 週${examTag}`;
              },
              label: ctx => {
                if (ctx.dataset.label.includes("及格率")) return ` 題庫及格率：${ctx.raw.toFixed(1)}%`;
                if (ctx.dataset.label.includes("人數")) return ` 作答人數：${Math.round(ctx.raw)} 人`;
                return ` 平均作答次數：${ctx.raw.toFixed(1)} 次`;
              },
              afterBody: ctx => {
                if (!ctx.length) return [];
                const w = weeks[ctx[0].dataIndex];
                if (w.is_exam_week) return [];
                const diff = _weekAvgAttempts(w) - semAvg;
                return [diff >= 0 ? `高於學期均值 ${diff.toFixed(1)} 次` : `低於學期均值 ${Math.abs(diff).toFixed(1)} 次`];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const total = _weekActiveStudents(weeks[ctx[0].dataIndex]);
                if (!total) return [];
                return [`作答人數佔峰值 ${Math.round((total / maxStudents) * 100)}%`];
              },
            },
          },
        },
      },
    });
  }

  function _periodValues(row, exam) {
    const pre = exam === "midterm" ? row.preMidterm : row.preFinal;
    const explicitRegular = exam === "midterm" ? row.midRegular : row.finalRegular;
    const explicitPeriod = exam === "midterm" ? row.midPeriod : row.finalPeriod;
    const period = explicitPeriod > 0 ? explicitPeriod : Math.max(row.totalMinutes, pre);
    const regular = explicitRegular > 0 ? explicitRegular : Math.max(period - pre, 0);
    return { pre, regular, period: Math.max(period, pre + regular, 0) };
  }

  function _prepType(row, exam) {
    const { pre, regular, period } = _periodValues(row, exam);
    if (period <= 0) return "low";
    const regularRatio = regular / period;
    const preRatio = pre / period;
    if (regularRatio > 0.75) return "steady";
    if (preRatio >= 0.35) return "high_cram";
    if (preRatio >= 0.10) return "moderate";
    return "low";
  }

  function renderPreExamIntensity(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;
    const rows = _filteredStudentRows();
    const exams = [
      { key: "midterm", label: "期中考" },
      { key: "final", label: "期末考" },
    ];
    const labels = exams.flatMap(exam => PREP_TYPES.map(t => `${exam.label} ${t.label}`));
    const counts = exams.flatMap(exam => PREP_TYPES.map(t => rows.filter(row => _prepType(row, exam.key) === t.key).length));
    const colors = exams.flatMap(() => PREP_TYPES.map(t => t.color));

    _renderPreExamSummary(canvas, rows, counts);

    if (_charts.preExam) { _charts.preExam.destroy(); }
    _charts.preExam = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "人數",
          data: counts,
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "人數", font: { size: 10 } } },
          x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 0 } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = rows.length || 1;
                const count = ctx.raw || 0;
                return ` ${count} 人（${(count / total * 100).toFixed(1)}%）`;
              },
            },
          },
        },
      },
    });
  }

  function _renderPreExamSummary(canvas, rows, counts) {
    const card = canvas.closest(".chart-card") || canvas.parentElement;
    if (!card) return;
    let el = card.querySelector(".pre-exam-summary");
    if (!el) {
      el = document.createElement("div");
      el.className = "pre-exam-summary";
      card.appendChild(el);
    }
    const total = rows.length || 1;
    const cardHtml = [
      ["分析人數", `${rows.length.toLocaleString()} 人`],
      ["期中平時準備型", `${counts[0] || 0} 人（${(((counts[0] || 0) / total) * 100).toFixed(1)}%）`],
      ["期中高度衝刺型", `${counts[1] || 0} 人（${(((counts[1] || 0) / total) * 100).toFixed(1)}%）`],
      ["期末平時準備型", `${counts[4] || 0} 人（${(((counts[4] || 0) / total) * 100).toFixed(1)}%）`],
      ["期末高度衝刺型", `${counts[5] || 0} 人（${(((counts[5] || 0) / total) * 100).toFixed(1)}%）`],
    ].map(([label, value]) => `
      <div style="border:1px solid rgba(110,130,165,.18);border-radius:8px;padding:7px 9px;background:var(--card-bg2,#f8f9fa)">
        <div style="font-size:.72rem;color:var(--text-dim,#888);line-height:1.2">${label}</div>
        <div style="font-weight:700;color:var(--text-mid,#4f5f78);margin-top:3px">${value}</div>
      </div>`).join("");

    el.innerHTML =
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:10px">${cardHtml}</div>` +
      '<div style="margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--card-bg2,#f0f4f8);font-size:.76rem;color:var(--text-dim,#666);line-height:1.6">' +
        '<b>平時及考前學習強度定義：</b>' +
        '平時 = 考前一週之前；考前1週 = 考前7天。' +
        '若平時累計大於該考試期間總閱讀時數 75%，歸為「平時準備型」；' +
        '若考前1週佔比大於等於 35%，歸為「高度衝刺型」；' +
        '若考前1週佔比 10% 至小於 35%，歸為「適度備考型」；' +
        '若考前1週佔比小於 10%，歸為「考試低準備型」。' +
      '</div>' +
      '<div style="margin-top:5px;font-size:.73rem;color:var(--text-dim,#999)">' +
        '若資料尚未包含考試期間分段時數，新版前端會以總閱讀時數與考前7天時數估算；重跑新版 ETL 後可取得精準分段。' +
      '</div>';
  }

  function renderTimeSlotDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const rows = _filteredStudentRows();
    const slots = Object.keys(SLOT_LABELS);
    const values = slots.map(slot => _avg(rows.map(row => _num(row.timeSlotDistribution?.[slot]))) * 100);
    const totalDaily = _avg(rows.map(row => row.totalMinutes / Math.max(row.activeWeeks || 1, 1)));

    if (_charts.timeSlot) { _charts.timeSlot.destroy(); }

    _charts.timeSlot = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: slots.map(s => SLOT_LABELS[s]),
        datasets: [{ data: values, backgroundColor: SLOT_COLORS, borderWidth: 2, hoverOffset: 8 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: "bottom",
            align: "center",
            labels: {
              boxWidth: 26,
              boxHeight: 10,
              font: { size: 12, weight: "600" },
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` 佔比：${ctx.raw.toFixed(1)}%`,
              afterLabel: ctx => {
                if (!totalDaily) return "";
                const ratio = values[ctx.dataIndex] / 100 || 0;
                return ` 每週約 ${Math.round(ratio * totalDaily)} 分鐘`;
              },
              footer: ctx => ctx.length ? [SLOT_TIPS[slots[ctx[0].dataIndex]] || ""] : [],
            },
          },
        },
      },
    });
  }

  return { init, onFilterChange, renderWeeklyQuiz, renderPreExamIntensity, renderTimeSlotDonut };
})();
