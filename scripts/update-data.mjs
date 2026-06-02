import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputJson = resolve(rootDir, "data", "market-sentiment.json");
const outputJs = resolve(rootDir, "data", "latest-data.js");
const dailyLogJson = resolve(rootDir, "data", "daily-log.json");

const SOURCES = {
  cboeVix: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
  fredSeries: (series) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`
};

const sourceList = [
  {
    name: "Cboe VIX",
    url: "https://www.cboe.com/tradable_products/vix/vix_historical_data/"
  },
  {
    name: "FRED SP500/NASDAQ100",
    url: "https://fred.stlouisfed.org/"
  }
];

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "market-sentiment-dashboard/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim() || /^No data/i.test(text.trim())) {
    throw new Error(`${label} returned empty data`);
  }
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] || "").trim();
    });
    return record;
  });
}

function toIsoDate(value) {
  const trimmed = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return "";
}

function numberFrom(record, candidates) {
  for (const candidate of candidates) {
    const key = Object.keys(record).find((item) => item.toLowerCase() === candidate.toLowerCase());
    if (!key) continue;
    const raw = String(record[key]).replaceAll(",", "").trim();
    if (!raw || raw === ".") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}

function normalizePriceRows(rows, label) {
  const normalized = rows
    .map((row) => {
      const dateKey = Object.keys(row).find((key) => /date/i.test(key) || /observation/i.test(key));
      const date = toIsoDate(dateKey ? row[dateKey] : row.Date);
      const close = numberFrom(row, ["Close", "CLOSE", "VIX Close", label]);
      return { date, close };
    })
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (normalized.length < 30) {
    throw new Error(`${label} has too few usable rows`);
  }
  return dedupeByDate(normalized);
}

function dedupeByDate(rows) {
  const map = new Map();
  rows.forEach((row) => map.set(row.date, row));
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadFredSeries(series) {
  const text = await fetchText(SOURCES.fredSeries(series), `FRED ${series}`);
  const rows = parseCsv(text)
    .map((row) => {
      const date = toIsoDate(row.observation_date || row.DATE || row.Date);
      const raw = String(row[series] || "").trim();
      const value = raw && raw !== "." ? Number(raw) : NaN;
      return { date, close: value };
    })
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  return dedupeByDate(rows);
}

function latest(rows) {
  return rows[rows.length - 1];
}

function valueDaysAgo(rows, days) {
  return rows[rows.length - 1 - days]?.close;
}

function pctChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current / previous) - 1) * 100;
}

function percentile(values, current) {
  const ready = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ready.length || !Number.isFinite(current)) return null;
  const lessOrEqual = ready.filter((value) => value <= current).length;
  return (lessOrEqual / ready.length) * 100;
}

function yearsBefore(date, years) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result.toISOString().slice(0, 10);
}

function vixZone(vix) {
  if (vix < 20) return "<20：常态区间";
  if (vix < 25) return "20-25：观察区间";
  if (vix < 35) return "25-35：压力区间";
  return ">=35：极端压力区间";
}

function movingAverage(rows, endIndex, windowSize) {
  const start = endIndex - windowSize + 1;
  if (start < 0) return null;
  let total = 0;
  for (let index = start; index <= endIndex; index += 1) {
    total += rows[index].close;
  }
  return total / windowSize;
}

function calculateDeviationRows(rows) {
  return rows
    .map((row, index) => {
      const ma20 = movingAverage(rows, index, 20);
      const ma60 = movingAverage(rows, index, 60);
      const ma120 = movingAverage(rows, index, 120);
      const ma200 = movingAverage(rows, index, 200);
      return {
        date: row.date,
        close: round(row.close, 2),
        dev20: ma20 ? round(pctChange(row.close, ma20), 2) : null,
        dev60: ma60 ? round(pctChange(row.close, ma60), 2) : null,
        dev120: ma120 ? round(pctChange(row.close, ma120), 2) : null,
        dev200: ma200 ? round(pctChange(row.close, ma200), 2) : null
      };
    })
    .filter((row) => row.dev20 !== null || row.dev60 !== null || row.dev120 !== null || row.dev200 !== null);
}

function alignVixMarket(vixRows, marketRows) {
  const marketByDate = new Map(marketRows.map((row) => [row.date, row.close]));
  const aligned = vixRows
    .filter((row) => marketByDate.has(row.date))
    .map((row) => ({
      date: row.date,
      vix: row.close,
      marketClose: marketByDate.get(row.date)
    }));

  if (aligned.length < 2) return [];
  const base = aligned[0].marketClose;
  return aligned.map((row) => ({
    date: row.date,
    vix: round(row.vix, 2),
    marketClose: round(row.marketClose, 2),
    spyReturn: round(pctChange(row.marketClose, base), 2)
  }));
}

function trimCalendarYears(rows, asOf, years) {
  const start = yearsBefore(asOf, years);
  return rows.filter((row) => row.date >= start);
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function buildDailyLogEntry(data) {
  return {
    asOf: data.asOf,
    generatedAt: data.generatedAt,
    metrics: data.metrics,
    latest: {
      vixAndSp500: data.series.vixSpy.at(-1) || null,
      nasdaqDeviation: data.series.nasdaqDeviation.at(-1) || null
    }
  };
}

async function updateDailyLog(data) {
  const current = await readJsonIfExists(dailyLogJson, []);
  const rows = Array.isArray(current) ? current : [];
  const byDate = new Map(rows.map((row) => [row.asOf, row]));
  byDate.set(data.asOf, buildDailyLogEntry(data));
  return [...byDate.values()].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

async function buildData() {
  const [vixText, sp500Rows, nasdaqRows, dgs10, dgs2] = await Promise.all([
    fetchText(SOURCES.cboeVix, "Cboe VIX"),
    loadFredSeries("SP500"),
    loadFredSeries("NASDAQ100"),
    loadFredSeries("DGS10").catch(() => []),
    loadFredSeries("DGS2").catch(() => [])
  ]);

  const vixRows = normalizePriceRows(parseCsv(vixText), "VIX");
  const asOf = [latest(vixRows).date, latest(sp500Rows).date, latest(nasdaqRows).date].sort()[0];
  const vixUntilAsOf = vixRows.filter((row) => row.date <= asOf);
  const sp500UntilAsOf = sp500Rows.filter((row) => row.date <= asOf);
  const nasdaqUntilAsOf = nasdaqRows.filter((row) => row.date <= asOf);
  const currentVix = latest(vixUntilAsOf).close;
  const tenYearVix = trimCalendarYears(vixUntilAsOf, asOf, 10).map((row) => row.close);
  const latestDgs10 = dgs10.filter((row) => row.date <= asOf).at(-1);
  const latestDgs2 = dgs2.filter((row) => row.date <= asOf).at(-1);
  const twoTenSpread = latestDgs10 && latestDgs2 ? latestDgs10.close - latestDgs2.close : null;

  return {
    generatedAt: new Date().toISOString(),
    asOf,
    dataQuality: "live",
    nasdaqLabel: "纳指100",
    sources: sourceList,
    metrics: {
      vix: round(currentVix, 2),
      vixZone: vixZone(currentVix),
      vixPercentile10y: round(percentile(tenYearVix, currentVix), 0),
      vixFiveDayChange: round(currentVix - valueDaysAgo(vixUntilAsOf, 5), 2),
      sp500TwentyDayReturn: round(pctChange(latest(sp500UntilAsOf).close, valueDaysAgo(sp500UntilAsOf, 20)), 1),
      spyTwentyDayReturn: round(pctChange(latest(sp500UntilAsOf).close, valueDaysAgo(sp500UntilAsOf, 20)), 1),
      tenYearYield: latestDgs10 ? round(latestDgs10.close, 2) : null,
      twoTenSpread: round(twoTenSpread, 2)
    },
    series: {
      vixSpy: alignVixMarket(trimCalendarYears(vixUntilAsOf, asOf, 5), trimCalendarYears(sp500UntilAsOf, asOf, 5)),
      nasdaqDeviation: calculateDeviationRows(trimCalendarYears(nasdaqUntilAsOf, asOf, 6)).slice(-1300)
    }
  };
}

async function main() {
  const data = await buildData();
  const dailyLog = await updateDailyLog(data);
  await mkdir(dirname(outputJson), { recursive: true });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(outputJson, json, "utf8");
  await writeFile(outputJs, `window.MARKET_SENTIMENT_DATA = ${json};`, "utf8");
  await writeFile(dailyLogJson, `${JSON.stringify(dailyLog, null, 2)}\n`, "utf8");
  console.log(`Updated market data through ${data.asOf}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
