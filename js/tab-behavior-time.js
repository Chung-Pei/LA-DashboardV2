/**
 * tab-behavior-time.js
 * Phase 2C：時間分析 Tab
 *   - 週強度折線圖（題庫作答）
 *   - 考前強度橫條圖
 *   - 學習時段圓環圖
 * 依賴：Chart.js、behavior-loader.js
 */

const BehaviorTimeTab = (() => {

  const SLOT_LABELS = {
    MORNING:    "上午 06–12",
    AFTERNOON:  "下午 12–18",
    EVENING:    "傍晚 18–23",
    LATE_NIGHT: "深夜 23–06",
  };

  const SLOT_COLORS = [
    "rgba(241, 196, 15,  0.80)",  // MORNING    黃
    "rgba(52,  152, 219, 0.80)",  // AFTERNOON  藍
    "rgba(155, 89,  182, 0.80)",  // EVENING    紫
    "rgba(44,  62,  80,  0.75)",  // LATE_NIGHT 深灰
  ];

  const SLOT_TIPS = {
    MORNING:    "☀️  早晨學習，記憶力佳、專注度高",
    AFTERNOON:  "🌤  午後小憩後學習，效率穩定",
    EVENING:    "🌆 傍晚學習，適合複習整理",
    LATE_NIGHT: "🌙 深夜學習可能影響睡眠品質，建議調整",
  };

  let _quizData = null;
  let _timeData = null;
  let _behaviorData = null;
  let _charts   = {};

  function _avg(values) {
    const nums = values.filter(v => v != null && isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }

  function _num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function _weekAvgAttempts(w) {
    if (w.avg_attempts != null) return w.avg_attempts;
    return _avg([w.pass_group_avg_attempts, w.fail_group_avg_attempts]);
  }

  function _weekPassRate(w) {
    return w.avg_pass_rate ?? w.overall_pass_rate ?? 0;
  }

  function _weekActiveStudents(w) {
    return w.active_students ?? w.total_students ??
      ((w.pass_group_active_students || 0) + (w.fail_group_active_students || 0));
  }

  function _studentAvg(field) {
    return _avg((_timeData?.students || []).map(s => s[field]));
  }

  function _classAvgTime() {
    return _timeData?.class_avg_time_distribution || {};
  }

  function _slotDistribution() {
    const classAvg = _classAvgTime();
    return classAvg.avg_time_slot_distribution || classAvg;
  }

  // ── 初始化 ───────────────────────────────────────────────

  async function init() {
    BehaviorLoader.setLoading("tab-time", true);
    try {
      [_quizData, _timeData, _behaviorData] = await Promise.all([
        BehaviorLoader.load.quiz(),
        BehaviorLoader.load.time(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);
      renderWeeklyQuiz("weeklyQuizChart");
      renderPreExamIntensity("preExamChart");
      renderTimeSlotDonut("timeSlotChart");
    } catch (err) {
      BehaviorLoader.showError("tab-time", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-time", false);
    }
  }

  // ── 1. 週強度折線圖（18週，W9/W18考試週標線）────────────────────

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

  function renderWeeklyQuiz(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_quizData) return;

    // 確保18週：若資料只有17週，補上 W18 空資料
    const rawWeeks = _quizData.weeks || [];
    const weeks = [...rawWeeks];
    if (!weeks.find(w => w.week === 18)) {
      weeks.push({ week: 18, title: "第18週 期末考", is_exam_week: true, exam_type: "final",
                   pass_group_avg_attempts: 0, fail_group_avg_attempts: 0, overall_pass_rate: 0, active_students: 0 });
    }
    weeks.sort((a, b) => a.week - b.week);

    const labels         = weeks.map(w => `W${w.week}`);
    const avgAttempts    = weeks.map(w => (w.is_exam_week && w.week === 18) ? null : _weekAvgAttempts(w));
    const avgPassRate    = weeks.map(w => (w.is_exam_week && w.week === 18) ? null : _weekPassRate(w) * 100);
    const activeStudents = weeks.map(w => (w.is_exam_week && w.week === 18) ? null : _weekActiveStudents(w));

    const validAttempts = avgAttempts.filter(v => v != null);
    const semAvg      = validAttempts.reduce((a, b) => a + b, 0) / (validAttempts.length || 1);
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
            spanGaps: false,
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
            spanGaps: false,
          },
          {
            label: "作答人數",
            data: activeStudents,
            borderColor: "rgba(189, 195, 199, 0.85)",
            backgroundColor: "transparent",
            borderDash: [3, 3],
            tension: 0.2,
            yAxisID: "yAttempts",
            pointRadius: 2,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: true },
        scales: {
          x: {
            ticks: { font: { size: 10 } },
          },
          yAttempts: {
            position: "left",
            title: { display: true, text: "次數 / 人數", font: { size: 10 } },
            min: 0,
          },
          yPassRate: {
            position: "right",
            title: { display: true, text: "及格率 (%)", font: { size: 10 } },
            min: 0, max: 100,
            grid: { drawOnChartArea: false },
          },
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: ctx => {
                if (!ctx.length) return "";
                const w       = weeks[ctx[0].dataIndex];
                const examTag = w.is_exam_week
                  ? (w.exam_type === "final" ? " 🎓 期末考週" : " ⚠️ 期中考週")
                  : (w.is_pre_exam ? " 📅 考前週" : "");
                return `第 ${w.week} 週${examTag}`;
              },
              label: ctx => {
                if (ctx.raw == null) return " (考試週，無作答資料)";
                if (ctx.dataset.label.includes("及格率"))
                  return ` 題庫及格率：${ctx.raw.toFixed(1)}%`;
                if (ctx.dataset.label.includes("人數"))
                  return ` 作答人數：${Math.round(ctx.raw)} 人`;
                return ` 平均作答次數：${ctx.raw.toFixed(1)} 次`;
              },
              afterBody: ctx => {
                if (!ctx.length) return [];
                const w    = weeks[ctx[0].dataIndex];
                if (w.is_exam_week) return [];
                const diff = _weekAvgAttempts(w) - semAvg;
                return [diff >= 0
                  ? `▲ 高於學期均值 ${diff.toFixed(1)} 次`
                  : `▼ 低於學期均值 ${Math.abs(diff).toFixed(1)} 次`,
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const w     = weeks[ctx[0].dataIndex];
                const total = _weekActiveStudents(w);
                if (!total) return [];
                return [`作答人數佔峰值 ${Math.round((total / maxStudents) * 100)}%`];
              },
            },
          },
        },
      },
    });
  }

  // ── 2. 考前學習強度分析（以週為單位，W8=期中考前1週、W7-W5=考前2-4週）────────────────────

  function renderPreExamIntensity(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const classAvg = _classAvgTime();
    const rows = _preExamRows();
    const totalStudents = rows.length || ((_timeData.students || []).length);

    // ── 核心指標計算 ──
    // pre_midterm_7d_minutes / pre_final_7d_minutes 為考前7天累積時數
    // 換算為週均：考前1週 ≈ 7天總時數；考前2-4週 = 考前8-28天，但資料只有7天，故：
    // 以「考前7天」vs「一般週均」比較強弱
    const avgPreMidterm7d = _avg(rows.map(s => s.preMidterm));  // 考前7天(1週)
    const avgPreFinal7d   = _avg(rows.map(s => s.preFinal));
    // 「其他週均」= (總時數 - 考前7天*2) / (18-2) 週
    const avgWeekly = classAvg.avg_weekly_minutes ?? _regularWeeklyAverage(rows);
    // 換算考前1週 vs 考前週均 (7天 vs 7天)
    const weeklyPer7d = avgWeekly; // 已是7天單位

    // ── 人數統計 ──
    const midCount = rows.filter(s => s.preMidterm > 0).length;
    const finCount = rows.filter(s => s.preFinal > 0).length;
    const bothCount = rows.filter(s => s.preMidterm > 0 && s.preFinal > 0).length;
    const eitherCount = rows.filter(s => s.preMidterm > 0 || s.preFinal > 0).length;
    const neitherCount = rows.filter(s => s.preMidterm === 0 && s.preFinal === 0).length;
    const activeCount = rows.filter(s => s.totalMinutes > 0).length;
    const pct = count => totalStudents ? (count / totalStudents) * 100 : 0;

    // ── 圖表資料：3種情境比較（以7天/1週為單位）──
    const chartData = [
      {
        label: `期中考前1週（W8）有學習：${midCount}人（${pct(midCount).toFixed(1)}%）`,
        value: avgPreMidterm7d || 0,
        count: midCount,
        pct: pct(midCount),
        color: "rgba(230, 126, 34, 0.75)",
      },
      {
        label: `期末考前1週（W17）有學習：${finCount}人（${pct(finCount).toFixed(1)}%）`,
        value: avgPreFinal7d || 0,
        count: finCount,
        pct: pct(finCount),
        color: "rgba(192, 57, 43, 0.75)",
      },
      {
        label: "全學期週均學習時間（每7天）",
        value: weeklyPer7d || 0,
        count: activeCount,
        pct: pct(activeCount),
        color: "rgba(149, 165, 166, 0.65)",
      },
    ];

    // ── 摘要卡片 ──
    _renderPreExamSummaryV2(canvas, {
      totalStudents, activeCount, midCount, finCount, bothCount, eitherCount, neitherCount, pct,
      avgPreMidterm7d, avgPreFinal7d, weeklyPer7d,
    });

    if (_charts.preExam) { _charts.preExam.destroy(); }

    _charts.preExam = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: chartData.map(d => d.label),
        datasets: [{
          label: "平均學習時間（分鐘/週）",
          data:  chartData.map(d => d.value),
          backgroundColor: chartData.map(d => d.color),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const mins = ctx.raw || 0;
                return ` ${Math.round(mins)} 分鐘/週（約 ${(mins/60).toFixed(1)} 小時）`;
              },
              afterLabel: ctx => {
                const weeklyRef = chartData[2].value;
                const mins = ctx.raw || 0;
                if (ctx.dataIndex < 2 && weeklyRef > 0) {
                  const ratio = (mins / weeklyRef).toFixed(1);
                  return mins > weeklyRef
                    ? ` 📈 為週均的 ${ratio} 倍（考前衝刺）`
                    : ` 📉 低於週均（${ratio} 倍），強度不足`;
                }
                return "";
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const d = chartData[ctx[0].dataIndex];
                return [`有學習時數人數：${d.count} 人（${d.pct.toFixed(1)}%）`];
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "學習時間（分鐘/週）", font: { size: 10 } },
            min: 0,
          },
        },
      },
    });
  }

  function _renderPreExamSummaryV2(canvas, stats) {
    const card = canvas.closest(".chart-card") || canvas.parentElement;
    if (!card) return;
    let el = card.querySelector(".pre-exam-summary");
    if (!el) {
      el = document.createElement("div");
      el.className = "pre-exam-summary";
      card.appendChild(el);
    }

    // 判斷衝刺型 vs 提前型
    const midRatio = stats.weeklyPer7d > 0 ? stats.avgPreMidterm7d / stats.weeklyPer7d : 0;
    const finRatio = stats.weeklyPer7d > 0 ? stats.avgPreFinal7d / stats.weeklyPer7d : 0;

    const items = [
      ["總分析人數", `${stats.totalStudents.toLocaleString()} 人`],
      ["有任何學習紀錄", `${stats.activeCount.toLocaleString()} 人（${stats.pct(stats.activeCount).toFixed(1)}%）`],
      ["期中考前1週有學習", `${stats.midCount.toLocaleString()} 人（${stats.pct(stats.midCount).toFixed(1)}%）`],
      ["期末考前1週有學習", `${stats.finCount.toLocaleString()} 人（${stats.pct(stats.finCount).toFixed(1)}%）`],
      ["兩次考前都有學習", `${stats.bothCount.toLocaleString()} 人（${stats.pct(stats.bothCount).toFixed(1)}%）`],
      ["任一考前1週有學習", `${stats.eitherCount.toLocaleString()} 人（${stats.pct(stats.eitherCount).toFixed(1)}%）`],
    ];

    const midTag = midRatio >= 1.5 ? "🔥 高度衝刺" : midRatio >= 1.0 ? "📘 適度備考" : "⚠️ 強度偏低";
    const finTag = finRatio >= 1.5 ? "🔥 高度衝刺" : finRatio >= 1.0 ? "📘 適度備考" : "⚠️ 強度偏低";

    const cardsHtml = items.map(([label, value]) => [
      '<div style="border:1px solid rgba(110,130,165,.18);border-radius:8px;padding:7px 9px;background:var(--card-bg2,#f8f9fa)">',
      '<div style="font-size:.72rem;color:var(--text-dim,#888);line-height:1.2">' + label + '</div>',
      '<div style="font-weight:700;color:var(--text-mid,#4f5f78);margin-top:3px">' + value + '</div>',
      '</div>',
    ].join('')).join('');
    el.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:10px">' + cardsHtml + '</div>' +
      '<div style="margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--card-bg2,#f0f4f8);font-size:.76rem;color:var(--text-dim,#666);line-height:1.6">' +
        '📌 <b>考前備考強度定義：</b>' +
        '「考前1週」= 期中考（W9）/期末考（W18）前7天的累積學習時數。' +
        '「週均」= (全學期總時數 - 考前兩段7天) ÷ 16週。' +
        '強度比 ≥ 1.5 = 高度衝刺型；1.0–1.5 = 適度備考；&lt; 1.0 = 強度偏低。<br>' +
        '期中考前1週強度比：<b>' + midRatio.toFixed(2) + '</b>（' + midTag + '）；' +
        '期末考前1週強度比：<b>' + finRatio.toFixed(2) + '</b>（' + finTag + '）' +
      '</div>' +
      '<div style="margin-top:5px;font-size:.73rem;color:var(--text-dim,#999)">' +
        '人數統計以 behavior.json 的 time_profile 為準。「有學習」= 考前7天累積時數 &gt; 0。' +
      '</div>';
  }

  function _preExamRows() {
    const byMasked = new Map((_timeData.students || []).map(s => [s.masked_id, s]));
    const source = (_behaviorData?.students?.length ? _behaviorData.students : _timeData.students) || [];
    return source.map(s => {
      const timeRow = byMasked.get(s.masked_id) || {};
      const features = s.features || {};
      const profile = s.time_profile || {};
      return {
        preMidterm: _num(profile.pre_midterm_7d_minutes ?? timeRow.pre_midterm_7d_minutes),
        preFinal: _num(profile.pre_final_7d_minutes ?? timeRow.pre_final_7d_minutes),
        totalMinutes: _num(features.total_learning_minutes ?? timeRow.total_learning_minutes),
        activeWeeks: _num(profile.active_weeks ?? timeRow.active_weeks),
      };
    });
  }


  function _regularWeeklyAverage(rows) {
    if (!rows.length) return 0;
    const meta = _behaviorData?.meta || _timeData?.meta || {};
    const semesterCount = Array.isArray(meta.semesters) && meta.semesters.length ? meta.semesters.length : 1;
    const totalWeeks = Math.max(semesterCount * 18, 3);
    const regularWeeks = Math.max(totalWeeks - 2, 1);
    return _avg(rows.map(s => Math.max(s.totalMinutes - s.preMidterm - s.preFinal, 0) / regularWeeks));
  }

  // ── 3. 學習時段圓環圖 ────────────────────────────────────

  function renderTimeSlotDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const distData   = _slotDistribution();
    const totalDaily = _classAvgTime().avg_daily_minutes;
    const slots      = Object.keys(SLOT_LABELS);
    const values     = slots.map(s => (distData[s] || 0) * 100);

    if (_charts.timeSlot) { _charts.timeSlot.destroy(); }

    _charts.timeSlot = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: slots.map(s => SLOT_LABELS[s]),
        datasets: [{
          data: values,
          backgroundColor: SLOT_COLORS,
          borderWidth: 2,
          hoverOffset: 8,
        }],
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
              generateLabels: chart => {
                const ds = chart.data.datasets[0];
                // 各主要學習時段的學期成績及格率（以 dominant_time_slot 分群計算）
                const slotPassRate = { "上午 06–12": 61.3, "下午 12–18": 63.5, "傍晚 18–23": 63.6, "深夜 23–06": 63.0 };
                const slotFailRate = { "上午 06–12": 38.7, "下午 12–18": 36.5, "傍晚 18–23": 36.4, "深夜 23–06": 37.0 };
                return chart.data.labels.map((label, i) => ({
                  text:        `${label}  ${ds.data[i].toFixed(1)}%  ✅${slotPassRate[label]||0}% ❌${slotFailRate[label]||0}%`,
                  fillStyle:   ds.backgroundColor[i],
                  strokeStyle: "#fff",
                  lineWidth:   1,
                  index:       i,
                }));
              },
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` 佔比：${ctx.raw.toFixed(1)}%`,
              afterLabel: ctx => {
                if (!totalDaily) return "";
                const ratio   = distData[slots[ctx.dataIndex]] || 0;
                return ` 每日約 ${Math.round(ratio * totalDaily)} 分鐘`;
              },
              footer: ctx => {
                if (!ctx.length) return [];
                return [SLOT_TIPS[slots[ctx[0].dataIndex]] || ""];
              },
            },
          },
        },
      },
    });
  }

  // ── 公開 API ─────────────────────────────────────────────
  return { init, renderWeeklyQuiz, renderPreExamIntensity, renderTimeSlotDonut };
})();
