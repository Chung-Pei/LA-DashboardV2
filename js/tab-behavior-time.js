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

  // ── 1. 週強度折線圖（題庫作答 + 及格率）────────────────────

  function renderWeeklyQuiz(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_quizData) return;

    const weeks          = _quizData.weeks || [];
    const labels         = weeks.map(w => `W${w.week}`);
    const avgAttempts    = weeks.map(_weekAvgAttempts);
    const avgPassRate    = weeks.map(w => _weekPassRate(w) * 100);
    const activeStudents = weeks.map(_weekActiveStudents);

    // 預計算學期均值與最大作答人數（避免每次 hover 重複運算）
    const semAvg      = avgAttempts.reduce((a, b) => a + b, 0) / (avgAttempts.length || 1);
    const maxStudents = Math.max(...activeStudents, 1);

    if (_charts.weeklyQuiz) { _charts.weeklyQuiz.destroy(); }

    _charts.weeklyQuiz = new Chart(canvas.getContext("2d"), {
      type: "line",
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
          },
          {
            label: "作答人數",
            data: activeStudents,
            borderColor: "rgba(189, 195, 199, 0.8)",
            backgroundColor: "transparent",
            borderDash: [3, 3],
            tension: 0.2,
            yAxisID: "yAttempts",
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: true },
        scales: {
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
                const examTag = w.is_exam_week ? " ⚠️ 考試週"
                              : w.is_pre_exam  ? " 📅 考前週" : "";
                return `第 ${w.week} 週${examTag}`;
              },
              label: ctx => {
                if (ctx.dataset.label.includes("及格率"))
                  return ` 題庫及格率：${ctx.raw.toFixed(1)}%`;
                if (ctx.dataset.label.includes("人數"))
                  return ` 作答人數：${Math.round(ctx.raw)} 人`;
                return ` 平均作答次數：${ctx.raw.toFixed(1)} 次`;
              },
              afterBody: ctx => {
                if (!ctx.length) return [];
                const w    = weeks[ctx[0].dataIndex];
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
                return [`作答人數佔全體 ${Math.round((total / maxStudents) * 100)}%`];
              },
            },
          },
        },
      },
    });
  }

  // ── 2. 考前強度橫條圖 ────────────────────────────────────

  function renderPreExamIntensity(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const classAvg = _classAvgTime();
    const rows = _preExamRows();
    const totalStudents = rows.length || ((_timeData.students || []).length);
    const avgPreMidterm = _avg(rows.map(s => s.preMidterm));
    const avgPreFinal   = _avg(rows.map(s => s.preFinal));
    const avgWeekly     = classAvg.avg_weekly_minutes ?? _regularWeeklyAverage(rows);
    const activeCount = rows.filter(s => s.totalMinutes > 0).length;
    const midCount = rows.filter(s => s.preMidterm > 0).length;
    const finCount = rows.filter(s => s.preFinal > 0).length;
    const anyCount = rows.filter(s => s.preMidterm > 0 || s.preFinal > 0).length;
    const onlyAnyCount = rows.filter(s =>
      (s.preMidterm > 0 || s.preFinal > 0) &&
      Math.max(s.totalMinutes - s.preMidterm - s.preFinal, 0) <= 1e-9
    ).length;
    const pct = count => totalStudents ? (count / totalStudents) * 100 : 0;
    const preExam  = [
      { label: `期中考前 7 天（${midCount}人，${pct(midCount).toFixed(1)}%）`, value: avgPreMidterm || 0, count: midCount, pct: pct(midCount) },
      { label: `期末考前 7 天（${finCount}人，${pct(finCount).toFixed(1)}%）`, value: avgPreFinal   || 0, count: finCount, pct: pct(finCount) },
      { label: "其餘週均學習時間", value: avgWeekly || 0, count: totalStudents, pct: totalStudents ? 100 : 0 },
    ];
    const regularAvg = preExam[2].value;
    _renderPreExamSummary(canvas, {
      totalStudents, activeCount, midCount, finCount, anyCount, onlyAnyCount,
      pct, avgPreMidterm, avgPreFinal, avgWeekly,
    });

    if (_charts.preExam) { _charts.preExam.destroy(); }

    _charts.preExam = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: preExam.map(d => d.label),
        datasets: [{
          label: "平均學習時間（分鐘/7天）",
          data:  preExam.map(d => d.value),
          backgroundColor: [
            "rgba(230, 126, 34,  0.75)",
            "rgba(192, 57,  43,  0.75)",
            "rgba(149, 165, 166, 0.65)",
          ],
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
                const mins = ctx.raw;
                return ` ${Math.round(mins)} 分鐘（${(mins / 60).toFixed(1)} 小時）`;
              },
              afterLabel: ctx => ` → 每日約 ${Math.round(ctx.raw / 7)} 分鐘`,
              footer: ctx => {
                if (!ctx.length) return [];
                const idx = ctx[0].dataIndex;
                if (idx < 2) {
                  const row = preExam[idx];
                  const lines = [
                    `有時數人數：${row.count} / ${totalStudents} 人（${row.pct.toFixed(1)}%）`,
                    `任一考前 7 天有時數：${anyCount} 人（${pct(anyCount).toFixed(1)}%）`,
                    `只在考前 7 天有時數：${onlyAnyCount} 人（${pct(onlyAnyCount).toFixed(1)}%）`,
                  ];
                  if (regularAvg > 0) {
                    const ratio = (ctx[0].raw / regularAvg).toFixed(1);
                    lines.push(ctx[0].raw > regularAvg
                      ? `📈 為其餘週均的 ${ratio} 倍`
                      : `📉 低於其餘週均（${ratio} 倍）`);
                  }
                  return lines;
                }
                if (idx < 2 && regularAvg > 0) {
                  const ratio = (ctx[0].raw / regularAvg).toFixed(1);
                  return [ctx[0].raw > regularAvg
                    ? `📈 為平日學習強度的 ${ratio} 倍`
                    : `📉 低於平日學習強度（${ratio} 倍）`,
                  ];
                }
                return [];
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "學習時間（分鐘）", font: { size: 10 } },
            min: 0,
          },
        },
      },
    });
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

  function _renderPreExamSummary(canvas, stats) {
    const card = canvas.closest(".chart-card") || canvas.parentElement;
    if (!card) return;
    let el = card.querySelector(".pre-exam-summary");
    if (!el) {
      el = document.createElement("div");
      el.className = "pre-exam-summary";
      card.appendChild(el);
    }
    const items = [
      ["總分析人數", `${stats.totalStudents.toLocaleString()} 人`],
      ["有任何學習紀錄", `${stats.activeCount.toLocaleString()} 人 (${stats.pct(stats.activeCount).toFixed(1)}%)`],
      ["期中考前 7 天有時數", `${stats.midCount.toLocaleString()} 人 (${stats.pct(stats.midCount).toFixed(1)}%)`],
      ["期末考前 7 天有時數", `${stats.finCount.toLocaleString()} 人 (${stats.pct(stats.finCount).toFixed(1)}%)`],
      ["任一考前 7 天有時數", `${stats.anyCount.toLocaleString()} 人 (${stats.pct(stats.anyCount).toFixed(1)}%)`],
      ["只在考前 7 天才有時數", `${stats.onlyAnyCount.toLocaleString()} 人 (${stats.pct(stats.onlyAnyCount).toFixed(1)}%)`],
    ];
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:10px">
        ${items.map(([label, value]) => `
          <div style="border:1px solid rgba(110,130,165,.18);border-radius:8px;padding:7px 9px;background:var(--card-bg2,#f8f9fa)">
            <div style="font-size:.72rem;color:var(--text-dim,#888);line-height:1.2">${label}</div>
            <div style="font-weight:700;color:var(--text-mid,#4f5f78);margin-top:3px">${value}</div>
          </div>
        `).join("")}
      </div>
      <div style="margin-top:7px;font-size:.76rem;color:var(--text-dim,#888)">
        圖中長條為全體平均分鐘數；人數統計以 behavior.json 的學生 time_profile 為準，避免未重跑 ETL 時被舊 time_distribution.json 影響。
      </div>`;
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
                return chart.data.labels.map((label, i) => ({
                  text:        `${label}  ${ds.data[i].toFixed(1)}%`,
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
