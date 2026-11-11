import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './graph.css';
import Graph from './Graph.jsx';

const el = document.getElementById('relation-graph');
if (el) {
  fetch(el.dataset.src)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((data) => createRoot(el).render(<Graph data={data} base={el.dataset.base || ''} />))
    .catch((err) => {
      el.textContent = '關係圖資料載入失敗（' + err.message + '）';
    });
}
