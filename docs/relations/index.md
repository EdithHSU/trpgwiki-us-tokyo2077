---
title: 關係圖
emoji: 🕸️
backlinks: false
hide:
  - toc
---

# 關係圖

人物放在所屬的勢力框裡。拖曳畫面可以移動、滾輪或雙指可以縮放；點人物或勢力會顯示簡介與相關的關係，滑鼠移到線上會顯示說明。左上角可以切換要看哪幾種關係。虛線框與標示「待確認」的項目還沒有定案。

<div class="viz-open">
  <button type="button" data-open-full="relation-graph"><span class="viz-open__icon" aria-hidden="true">⛶</span>全螢幕開啟關係圖</button>
  <span class="viz-open__hint">推薦用全螢幕瀏覽，按 Esc 離開</span>
</div>

<link rel="stylesheet" href="app/graph.css">
<div id="relation-graph" data-src="graph.json" data-base="../">關係圖載入中……</div>
<script type="module" src="app/graph.js"></script>
