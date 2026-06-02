# 美股市场状态

这是一个不依赖原 ETF Monitor 页面、可独立部署的静态市场情绪站点。页面数据由 `scripts/update-data.mjs` 从公开数据源生成，并写入：

- `data/market-sentiment.json`
- `data/latest-data.js`
- `data/daily-log.json`

`index.html` 直接引用 `data/latest-data.js`，所以可以用静态托管服务部署，也可以直接本地预览。

## 数据源

- VIX：Cboe VIX 历史数据 CSV
- 标普500：FRED `SP500`，作为无钥匙的 SPY 走势代理
- 纳指100：FRED `NASDAQ100`
- 美债利率：FRED `DGS10` / `DGS2`，用于后续宏观指标扩展

## 本地运行

```bash
npm run update
npm run preview
```

预览地址默认是 `http://localhost:4173`。

如果 Windows PowerShell 禁止执行 `npm.ps1`，可以直接运行：

```bash
node scripts/update-data.mjs
node scripts/serve.mjs
```

## 每天自动更新

`.github/workflows/update-data.yml` 已配置每天北京时间 08:30 运行一次。把本目录作为仓库根目录推到 GitHub 后，开启 GitHub Pages，即可让站点每天自动更新数据文件。

也可以在 GitHub Actions 页面手动运行 `Update market sentiment data`。

`data/daily-log.json` 会按 `asOf` 去重保存每日核心指标与最新图表点位，即使以后想换数据源，也可以保留从当前站点开始积累的日度记录。

## 免责声明

本页面模仿自https://etfmonitor.cn/，有需要其他资源请联系该网站所有人。
页面仅用于个人研究和可视化，不构成投资建议。公开免费数据源可能存在延迟、缺失或限流。
