(function () {
  const data = window.MARKET_SENTIMENT_DATA;
  const ranges = {
    "1m": 31,
    "3m": 93,
    "1y": 366,
    "3y": 366 * 3,
    "5y": 366 * 5
  };

  const palette = {
    text: "#111827",
    muted: "#687586",
    grid: "rgba(113, 128, 150, 0.18)",
    teal: "#168378",
    amber: "#bd5b0b",
    red: "#df2430",
    wine: "#8f1f26",
    vix: "#b75d17",
    spy: "#6f98ad",
    price: "#b3bcc3",
    green: "#7aa59c",
    purple: "#b69ac7"
  };

  const state = {
    vixRange: "3m",
    deviationRange: "3y"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
    return Number(value).toFixed(digits);
  }

  function formatPercent(value, digits = 0, sign = false) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
    const prefix = sign && value > 0 ? "+" : "";
    return `${prefix}${Number(value).toFixed(digits)}%`;
  }

  function pctChange(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return ((current / previous) - 1) * 100;
  }

  function formatDate(date) {
    if (!date) return "--";
    return String(date).replaceAll("-", "/");
  }

  function rangeFilter(items, rangeKey) {
    if (!items || !items.length) return [];
    const last = new Date(items[items.length - 1].date);
    const start = new Date(last);
    start.setDate(start.getDate() - (ranges[rangeKey] || ranges["3m"]));
    return items.filter((item) => new Date(item.date) >= start);
  }

  function niceTicks(min, max, count) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      const base = Number.isFinite(min) ? min : 0;
      return [base - 1, base, base + 1];
    }
    const span = max - min;
    const raw = span / Math.max(1, count - 1);
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalized = raw / power;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let value = start; value <= end + step / 2; value += step) {
      ticks.push(Number(value.toFixed(8)));
    }
    return ticks;
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function drawLine(ctx, points, color, width = 2) {
    const ready = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (ready.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ready.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawAxes(ctx, plot, leftTicks, rightTicks, options = {}) {
    ctx.save();
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.muted;
    ctx.lineWidth = 1;

    leftTicks.forEach((tick) => {
      const y = options.yLeft(tick);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.fillText(options.leftLabel(tick), 8, y);
    });

    ctx.textAlign = "right";
    rightTicks.forEach((tick) => {
      const y = options.yRight(tick);
      ctx.fillText(options.rightLabel(tick), plot.right + 46, y);
    });

    ctx.strokeStyle = "rgba(17,24,39,0.16)";
    ctx.beginPath();
    ctx.moveTo(plot.left, plot.bottom);
    ctx.lineTo(plot.right, plot.bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawDateLabels(ctx, items, plot) {
    if (!items.length) return;
    const steps = Math.min(6, items.length);
    const used = new Set();
    ctx.save();
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let index = 0; index < steps; index += 1) {
      const itemIndex = Math.round((items.length - 1) * (index / Math.max(1, steps - 1)));
      if (used.has(itemIndex)) continue;
      used.add(itemIndex);
      const x = plot.left + ((plot.right - plot.left) * itemIndex) / Math.max(1, items.length - 1);
      const date = items[itemIndex].date.slice(2).replace("-", "/").replace("-", "/");
      ctx.fillText(date, x, plot.bottom + 16);
    }
    ctx.restore();
  }

  function drawVixSpyChart() {
    const canvas = $("vixSpyChart");
    const box = $("vixSpyEmpty");
    const rawItems = rangeFilter(data.series.vixSpy, state.vixRange);
    const baseClose = rawItems.find((item) => Number.isFinite(item.marketClose))?.marketClose;
    const items = rawItems.map((item) => ({
      ...item,
      rangeReturn: Number.isFinite(item.marketClose) ? pctChange(item.marketClose, baseClose) : item.spyReturn
    }));
    box.hidden = items.length >= 2;
    if (items.length < 2) return;

    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const plot = {
      left: 58,
      right: width - 60,
      top: 24,
      bottom: height - 46
    };
    const leftValues = items.map((item) => item.vix).filter(Number.isFinite);
    const rightValues = items.map((item) => item.rangeReturn).filter(Number.isFinite);
    const leftTicks = niceTicks(Math.min(...leftValues), Math.max(...leftValues), 6);
    const rightTicks = niceTicks(Math.min(...rightValues), Math.max(...rightValues), 6);
    const leftMin = leftTicks[0];
    const leftMax = leftTicks[leftTicks.length - 1];
    const rightMin = rightTicks[0];
    const rightMax = rightTicks[rightTicks.length - 1];

    const xOf = (index) => plot.left + ((plot.right - plot.left) * index) / Math.max(1, items.length - 1);
    const yLeft = (value) => plot.bottom - ((value - leftMin) / Math.max(1e-9, leftMax - leftMin)) * (plot.bottom - plot.top);
    const yRight = (value) => plot.bottom - ((value - rightMin) / Math.max(1e-9, rightMax - rightMin)) * (plot.bottom - plot.top);

    drawAxes(ctx, plot, leftTicks, rightTicks, {
      yLeft,
      yRight,
      leftLabel: (tick) => String(Math.round(tick)),
      rightLabel: (tick) => formatPercent(tick, 0, true)
    });

    drawDateLabels(ctx, items, plot);
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yLeft(item.vix) })),
      palette.vix,
      2.2
    );
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yRight(item.rangeReturn) })),
      palette.spy,
      1.7
    );
  }

  function drawDeviationChart() {
    const canvas = $("deviationChart");
    const box = $("deviationEmpty");
    const items = rangeFilter(data.series.nasdaqDeviation, state.deviationRange);
    box.hidden = items.length >= 2;
    if (items.length < 2) return;

    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const plot = {
      left: 58,
      right: width - 64,
      top: 22,
      bottom: height - 48
    };
    const deviationKeys = ["dev20", "dev60", "dev120", "dev200"];
    const deviationValues = items.flatMap((item) => deviationKeys.map((key) => item[key])).filter(Number.isFinite);
    const priceValues = items.map((item) => item.close).filter(Number.isFinite);
    const devTicks = niceTicks(Math.min(-5, ...deviationValues), Math.max(5, ...deviationValues), 7);
    const priceTicks = niceTicks(Math.min(...priceValues), Math.max(...priceValues), 6);
    const devMin = devTicks[0];
    const devMax = devTicks[devTicks.length - 1];
    const priceMin = priceTicks[0];
    const priceMax = priceTicks[priceTicks.length - 1];

    const xOf = (index) => plot.left + ((plot.right - plot.left) * index) / Math.max(1, items.length - 1);
    const yDev = (value) => plot.bottom - ((value - devMin) / Math.max(1e-9, devMax - devMin)) * (plot.bottom - plot.top);
    const yPrice = (value) => plot.bottom - ((value - priceMin) / Math.max(1e-9, priceMax - priceMin)) * (plot.bottom - plot.top);

    drawAxes(ctx, plot, devTicks, priceTicks, {
      yLeft: yDev,
      yRight: yPrice,
      leftLabel: (tick) => formatPercent(tick, 0, true),
      rightLabel: (tick) => compactPrice(tick)
    });
    drawDateLabels(ctx, items, plot);

    ctx.save();
    ctx.strokeStyle = "rgba(17,24,39,0.28)";
    ctx.beginPath();
    ctx.moveTo(plot.left, yDev(0));
    ctx.lineTo(plot.right, yDev(0));
    ctx.stroke();
    ctx.restore();

    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yPrice(item.close) })),
      palette.price,
      1.4
    );
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yDev(item.dev200) })),
      palette.purple,
      1.3
    );
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yDev(item.dev120) })),
      palette.spy,
      1.3
    );
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yDev(item.dev60) })),
      palette.green,
      1.3
    );
    drawLine(
      ctx,
      items.map((item, index) => ({ x: xOf(index), y: yDev(item.dev20) })),
      palette.red,
      2
    );
  }

  function compactPrice(value) {
    if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
    return String(Math.round(value));
  }

  function createArc(cx, cy, radius, startAngle, endAngle) {
    const start = polar(cx, cy, radius, endAngle);
    const end = polar(cx, cy, radius, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  }

  function polar(cx, cy, radius, angle) {
    const rad = ((angle - 180) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  }

  function drawGauge(value) {
    const svg = $("vixGauge");
    const min = 10;
    const max = 40;
    const clamped = Math.max(min, Math.min(max, Number(value) || min));
    const angle = ((clamped - min) / (max - min)) * 180;
    const needle = polar(180, 160, 102, angle);
    const zones = [
      { start: 0, end: 58, color: palette.teal },
      { start: 58, end: 105, color: palette.amber },
      { start: 105, end: 138, color: palette.red },
      { start: 138, end: 180, color: palette.wine }
    ];

    svg.innerHTML = `
      <g fill="none" stroke-linecap="butt">
        ${zones
          .map((zone) => `<path d="${createArc(180, 160, 112, zone.start, zone.end)}" stroke="${zone.color}" stroke-width="76"></path>`)
          .join("")}
        <path d="${createArc(180, 160, 70, 0, 180)}" stroke="#fff" stroke-width="2"></path>
      </g>
      <line x1="180" y1="160" x2="${needle.x}" y2="${needle.y}" stroke="${palette.text}" stroke-width="7" stroke-linecap="round"></line>
      <circle cx="180" cy="160" r="10" fill="${palette.text}" stroke="#fff" stroke-width="5"></circle>
    `;
  }

  function bindSegmented(groupId, stateKey, render) {
    const group = $(groupId);
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-range]");
      if (!button) return;
      state[stateKey] = button.dataset.range;
      group.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      render();
    });
  }

  function renderMetrics() {
    const metrics = data.metrics || {};
    $("vixValue").textContent = formatNumber(metrics.vix, 2);
    $("vixZone").textContent = metrics.vixZone || "--";
    $("vixPercentile").textContent = formatPercent(metrics.vixPercentile10y, 0);
    $("vixChange").textContent = formatNumber(metrics.vixFiveDayChange, 2);
    $("spyReturn").textContent = formatPercent(metrics.sp500TwentyDayReturn ?? metrics.spyTwentyDayReturn, 1, true);
    $("asOfDate").textContent = formatDate(data.asOf);
    if (data.dataQuality === "live") {
      $("updateStatus").textContent = `已更新 ${formatDate(data.asOf)}`;
      $("dataLabel").textContent = "定时任务已生成最新公开数据。";
    } else if (data.dataQuality === "partial") {
      $("updateStatus").textContent = `部分更新 ${formatDate(data.asOf)}`;
      $("dataLabel").textContent = "部分数据源临时不可用，已沿用最近一次成功数据。";
    } else {
      $("updateStatus").textContent = "预览数据";
      $("dataLabel").textContent = "运行更新脚本后替换为实时公开数据。";
    }
    $("deviationSubtitle").textContent = `${data.nasdaqLabel || "纳指100"}收盘价相对均线的偏离幅度；灰线为价格。`;
    $("sourceLine").textContent = `数据来源：${(data.sources || []).map((source) => source.name).join("、") || "公开数据源"}。`;
    drawGauge(metrics.vix);
  }

  function renderAll() {
    if (!data) return;
    renderMetrics();
    drawVixSpyChart();
    drawDeviationChart();
  }

  if (!data) {
    $("updateStatus").textContent = "未找到数据";
    return;
  }

  bindSegmented("vixRange", "vixRange", drawVixSpyChart);
  bindSegmented("deviationRange", "deviationRange", drawDeviationChart);
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__chartResizeTimer);
    window.__chartResizeTimer = window.setTimeout(renderAll, 120);
  });
  renderAll();
})();
