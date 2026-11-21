---
title: 地圖
emoji: 🗾
backlinks: false
hide:
  - toc
---

# 地圖

東京 23 區的勢力分布，以及團錄裡出現的地標與事件。拖曳可以平移、滾輪或雙指可以縮放；點行政區會飛過去並在右側顯示詳情，進入行政區後拖曳可以旋轉視角。左下角可以切換到「事件時間軸」，依集數瀏覽事件。

!!! note "目前是測試資料"
    還沒有正式劇情的團錄，所以事件只有一則**模擬資料**（標示「模擬」）。勢力地盤依白板地圖暫定，大部分行政區還沒有設定。

<div class="viz-open">
  <button type="button" data-open-full="tokyo-map"><span class="viz-open__icon" aria-hidden="true">⛶</span>全螢幕開啟地圖</button>
  <span class="viz-open__hint">推薦用全螢幕瀏覽，按 Esc 離開</span>
</div>

<link rel="stylesheet" href="app/map.css">
<div id="tokyo-map" data-src="map.json" data-geo="tokyo23.geojson" data-base="../">地圖載入中……</div>
<script type="module" src="app/map.js"></script>
