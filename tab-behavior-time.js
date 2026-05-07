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
  let _charts   = {};

  // ── 初始化 ───────────────────────────────────────────────

  async function init() {
    BehaviorLoader.setLoading("tab-time", true);
    try {
      [_quizData, _timeData] = await Promise.all([
        BehaviorLoader.load.quiz(),
        BehaviorLoader.load.time(),
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
    const avgAttempts    = weeks.map(w => w.avg_attempts    || 0);
    const avgPassRate    = weeks.map(w => (w.avg_pass_rate  || 0) * 100);
    const activeStudents = weeks.map(w => w.active_students || 0);

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
        interaction: { mode: "index", intersect: false },
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
                const diff = (w.avg_attempts || 0) - semAvg;
                return [diff >= 0
                  ? `▲ 高於學期均值 ${diff.toFixed(1)} 次`
                  : `▼ 低於學期均值 ${Math.abs(diff).toFixed(1)} 次`,
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const w     = weeks[ctx[0].dataIndex];
                const total = w.active_students || 0;
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

    const classAvg = _timeData.class_avg_time_distribution || {};
    const preExam  = [
      { label: "期中考前 7 天",   value: classAvg.avg_pre_midterm_7d_minutes || 0 },
      { label: "期末考前 7 天",   value: classAvg.avg_pre_final_7d_minutes   || 0 },
      { label: "其餘週均學習時間", value: classAvg.avg_weekly_minutes          || 0 },
    ];
    const regularAvg = preExam[2].value;

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

  // ── 3. 學習時段圓環圖 ────────────────────────────────────

  function renderTimeSlotDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const distData   = _timeData.class_avg_time_distribution?.avg_time_slot_distribution || {};
    const totalDaily = _timeData.class_avg_time_distribution?.avg_daily_minutes;
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
        maintainAspectRatio: true,
        cutout: "62%",
        plugins: {
          legend: {
            position: "right",
            labels: {
              font: { size: 11 },
              padding: 10,
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
