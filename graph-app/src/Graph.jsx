import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType,
  NodeResizer, BaseEdge, useNodesState, useInternalNode, useReactFlow,
} from '@xyflow/react';

/* 各層關係線的顏色（深淺色模式共用） */
const COLORS = { family: '#2f80ed', bond: '#8d7462', rival: '#e03e3e', debt: '#d9730d' };
const DASH = { bond: '6 4', debt: '2 5' };
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

/* ---------- 節點 ---------- */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className="rg-handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="rg-handle" isConnectable={false} />
    </>
  );
}

function CardNode({ data }) {
  return (
    <div className={'rg-card' + (data.pc ? ' rg-card--pc' : '') + (data.unconfirmed ? ' rg-card--unconfirmed' : '')}>
      <Handles />
      <span className="rg-card__emoji">{data.emoji}</span>
      <span className="rg-card__body">
        <span className="rg-card__title">{data.id}</span>
        {(data.sub || data.unconfirmed) && <span className="rg-card__sub">{data.unconfirmed ? '待確認' : data.sub}</span>}
      </span>
    </div>
  );
}

function GroupNode({ data, selected }) {
  return (
    <div className={'rg-group' + (data.unconfirmed ? ' rg-group--unconfirmed' : '')}>
      {data.edit && <NodeResizer minWidth={150} minHeight={70} isVisible={selected} />}
      <Handles />
      <div className="rg-group__head">
        <span>{data.emoji}</span>
        <span className="rg-group__title">{data.id}</span>
        {data.unconfirmed && <span className="rg-tag">待確認</span>}
      </div>
    </div>
  );
}

const nodeTypes = { card: CardNode, group: GroupNode };

/* ---------- 關係線：從兩個節點的邊框出發的曲線 ---------- */
function rectOf(n) {
  const p = n.internals.positionAbsolute;
  return { x: p.x, y: p.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 };
}
function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
function borderPoint(r, toward) {
  const c = center(r), dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function RelationEdge({ id, source, target, markerEnd, markerStart, style, data }) {
  const s = useInternalNode(source), t = useInternalNode(target);
  if (!s || !t) return null;
  const rs = rectOf(s), rt = rectOf(t);
  const a = borderPoint(rs, center(rt)), b = borderPoint(rt, center(rs));
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(36, len * 0.14);
  // 控制點往垂直方向偏移：方向相反的兩條線（例如互欠人情）會自然分開
  const cx = (a.x + b.x) / 2 - (dy / len) * bend, cy = (a.y + b.y) / 2 + (dx / len) * bend;
  const path = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
  const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x, ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
  // 標籤畫在線的 SVG 裡（不用 EdgeLabelRenderer），才會和線一樣待在卡片底下
  const lw = [...data.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 12 : 7), 12);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} markerStart={markerStart} style={style} interactionWidth={18} />
      {data.showLabel && data.label && (
        <g className="rg-edge-label" transform={`translate(${lx} ${ly})`} style={{ color: COLORS[data.type] }}>
          <rect x={-lw / 2} y={-10} width={lw} height={20} rx={10} />
          <text textAnchor="middle" dominantBaseline="central">{data.label}</text>
        </g>
      )}
    </>
  );
}

const edgeTypes = { relation: RelationEdge };

/* ---------- 主畫面 ---------- */
/* 圖層順序（由下往上）：關係線 → 勢力框（越內層越上面）→ 人物卡片 → 聚焦中的關係線。
   平常線畫在框底下，框的標題與「待確認」標籤、人物卡片都不會被線壓到；
   點選或滑鼠停在某張卡片時，和它相關的線會提到卡片上方，才看得清楚連到哪裡。 */
const Z_EDGE = 5, Z_GROUP = 10, Z_CARD = 100;

function toFlowNode(n, depth) {
  return {
    id: n.id,
    type: n.group ? 'group' : 'card',
    position: { x: n.x, y: n.y },
    zIndex: n.group ? Z_GROUP + depth : Z_CARD,
    ...(n.parent ? { parentId: n.parent, extent: 'parent' } : {}),
    ...(n.group ? { width: n.w, height: n.h } : {}),
    data: n,
  };
}

function depthOf(nodes) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const memo = {};
  const d = (id) => {
    if (memo[id] !== undefined) return memo[id];
    const p = byId[id]?.parent;
    return (memo[id] = p && byId[p] ? d(p) + 1 : 0);
  };
  return Object.fromEntries(nodes.map((n) => [n.id, d(n.id)]));
}

function arrow(type) { return { type: MarkerType.ArrowClosed, color: COLORS[type], width: 16, height: 16 }; }

function useDarkMode() {
  const read = () => document.body.getAttribute('data-md-color-scheme') === 'slate';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const ob = new MutationObserver(() => setDark(read()));
    ob.observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
    return () => ob.disconnect();
  }, []);
  return dark;
}

function Inner({ data, base }) {
  const flow = useReactFlow();
  const dark = useDarkMode();
  const depthMap = useMemo(() => depthOf(data.nodes), [data]);
  const initialNodes = useMemo(() => data.nodes.map((n) => toFlowNode(n, depthMap[n.id])), [data, depthMap]);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [layers, setLayers] = useState(() => Object.fromEntries(data.layers.map((l) => [l.id, l.default !== false])));
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);       // { edge, x, y }
  const [hoverNode, setHoverNode] = useState(null);
  const [edit, setEdit] = useState(false);
  const [full, setFull] = useState(false);
  const [saved, setSaved] = useState('');

  const byId = useMemo(() => Object.fromEntries(data.nodes.map((n) => [n.id, n])), [data]);
  const visibleEdges = useMemo(() => data.edges.filter((e) => layers[e.type]), [data, layers]);

  // 選取的節點與它直接相關的節點；選到勢力框時，框裡的成員也算
  const related = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    visibleEdges.forEach((e) => {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    });
    data.nodes.forEach((n) => { if (n.parent === selected) set.add(n.id); });
    return set;
  }, [selected, visibleEdges, data]);

  const flowNodes = useMemo(() => nodes.map((n) => ({
    ...n,
    draggable: edit,
    className: [
      related && !n.data.group && !related.has(n.id) ? 'rg-dim' : '',
      n.id === selected ? 'rg-selected' : '',
    ].join(' '),
    data: { ...n.data, edit },
  })), [nodes, related, selected, edit]);

  const edgeLift = useCallback((e) => {
    const a = byId[e.from], b = byId[e.to];
    if (!a?.parent && !b?.parent) return 0;
    const z = (n) => (n.group ? Z_GROUP + depthMap[n.id] : Z_CARD);
    return Math.max(z(a), z(b));
  }, [byId, depthMap]);

  /* 線的三種狀態：
     - 平常（沒有點選、滑鼠也不在卡片上）：全部很淡，只看得出大致的連結
     - 聚焦（點選某張卡片，或滑鼠停在卡片上）：相關的線清楚顯示並附標籤，其他的線幾乎隱藏
     - 滑鼠停在某條線上：那條線清楚顯示 */
  const focus = selected || hoverNode;
  const flowEdges = useMemo(() => visibleEdges.map((e) => {
    const on = focus && (e.from === focus || e.to === focus);
    const hl = on || hover?.edge.id === e.id;
    return {
      id: e.id, source: e.from, target: e.to, type: 'relation',
      className: hl ? 'rg-edge-on' : focus ? 'rg-dim-edge' : 'rg-edge-idle',
      // React Flow 會把連到框內節點的線，自動加上兩端節點裡較高的 z-index；這裡先扣掉，讓所有線都留在 Z_EDGE
      // 平常線在卡片底下；聚焦（點選或滑鼠停在卡片、線上）時，相關的線與標籤提到卡片上方
      zIndex: (hl ? Z_CARD + 10 : Z_EDGE) - edgeLift(e),
      markerEnd: e.dir === 'none' ? undefined : arrow(e.type),
      markerStart: e.dir === 'both' ? arrow(e.type) : undefined,
      style: { stroke: COLORS[e.type], strokeWidth: hl ? 2.2 : 1.2, strokeDasharray: DASH[e.type] },
      data: { ...e, showLabel: hl },
    };
  }), [visibleEdges, focus, hover, edgeLift]);

  const select = useCallback((id, focus) => {
    setSelected(id);
    if (focus && id) {
      const n = flow.getInternalNode(id);
      if (n) {
        const r = rectOf(n);
        flow.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 400 });
      }
    }
  }, [flow]);

  useEffect(() => {
    // 等容器換完大小、React Flow 量好尺寸再置中
    // 上方留空給左上角的分層面板
    const t = setTimeout(() => flow.fitView({ padding: { top: '64px', left: '40px', right: '40px', bottom: '40px' }, duration: 300 }), 300);
    return () => clearTimeout(t);
  }, [full, flow]);

  // 頁面上的「全螢幕開啟」按鈕（data-open-full="relation-graph"）
  useEffect(() => {
    const btns = document.querySelectorAll('[data-open-full="relation-graph"]');
    const open = () => setFull(true);
    btns.forEach((b) => b.addEventListener('click', open));
    return () => btns.forEach((b) => b.removeEventListener('click', open));
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setFull(false); setSelected(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function savePositions() {
    const out = {};
    nodes.forEach((n) => {
      out[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      if (n.type === 'group') {
        out[n.id].w = Math.round(n.width ?? n.measured?.width ?? 0);
        out[n.id].h = Math.round(n.height ?? n.measured?.height ?? 0);
      }
    });
    const text = JSON.stringify(out, null, 1) + '\n';
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: 'positions.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        setSaved('已存檔：' + handle.name);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = 'positions.json';
        a.click();
        setSaved('已下載 positions.json，請放到 wiki\\data\\');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setSaved('存檔失敗：' + err.message);
    }
  }

  const sel = selected && byId[selected];
  const selEdges = selected ? visibleEdges.filter((e) => e.from === selected || e.to === selected) : [];
  const members = selected ? data.nodes.filter((n) => n.parent === selected) : [];

  return (
    <div className={'rg' + (full ? ' rg--full' : '') + (edit ? ' rg--edit' : '')}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => setSelected(n.id === selected && !edit ? null : n.id)}
        onNodeMouseEnter={(_, n) => { if (!n.data.group && !edit) setHoverNode(n.id); }}
        onNodeMouseLeave={() => setHoverNode(null)}
        onPaneClick={() => setSelected(null)}
        onEdgeMouseEnter={(ev, edge) => setHover({ edge, x: ev.clientX, y: ev.clientY })}
        onEdgeMouseMove={(ev, edge) => setHover({ edge, x: ev.clientX, y: ev.clientY })}
        onEdgeMouseLeave={() => setHover(null)}
        nodesDraggable={edit}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        nodesConnectable={false}
        edgesFocusable={false}
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        colorMode={dark ? 'dark' : 'light'}
        minZoom={0.15}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: { top: '64px', left: '40px', right: '40px', bottom: '40px' } }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2}
          nodeColor={(n) => (n.type === 'group' ? 'transparent' : n.data.pc ? '#d9730d' : '#9b9a97')} />
      </ReactFlow>

      <div className="rg-panel rg-layers">
        {data.layers.map((l) => (
          <label key={l.id} className="rg-layer">
            <input type="checkbox" checked={!!layers[l.id]} onChange={(e) => setLayers({ ...layers, [l.id]: e.target.checked })} />
            <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke={COLORS[l.id]} strokeWidth="2.5" strokeDasharray={DASH[l.id]} /></svg>
            {l.label}
          </label>
        ))}
        <div className="rg-layers__actions">
          <button type="button" onClick={() => setFull(!full)}>{full ? '離開全螢幕' : '全螢幕'}</button>
          {IS_LOCAL && <button type="button" onClick={() => { setEdit(!edit); setSaved(''); }}>{edit ? '結束編輯' : '編輯位置'}</button>}
          {edit && <button type="button" className="rg-primary" onClick={savePositions}>儲存位置</button>}
        </div>
        {edit && <div className="rg-hint">拖曳卡片或勢力框；點勢力框後可以拉邊角改大小。存到 wiki\data\positions.json。{saved && <strong> {saved}</strong>}</div>}
      </div>

      {sel && (
        <div className="rg-panel rg-info">
          <button type="button" className="rg-close" aria-label="關閉" onClick={() => setSelected(null)}>×</button>
          <div className="rg-info__head">
            <span className="rg-info__emoji">{sel.emoji}</span>
            <span className="rg-info__title">{sel.id}</span>
            <span className="rg-tag">{sel.unconfirmed ? '待確認' : sel.kind}</span>
          </div>
          {sel.sub && <div className="rg-info__sub">{sel.sub}</div>}
          {sel.text && <p className="rg-info__text">{sel.text}</p>}
          {sel.url && <a className="rg-info__link" href={base + sel.url}>前往頁面 →</a>}
          {members.length > 0 && (
            <>
              <div className="rg-info__section">成員</div>
              <div className="rg-chips">
                {members.map((m) => <button type="button" key={m.id} className="rg-chip" onClick={() => select(m.id, true)}>{m.emoji} {m.id}</button>)}
              </div>
            </>
          )}
          {selEdges.length > 0 && (
            <>
              <div className="rg-info__section">關係</div>
              <ul className="rg-rel">
                {selEdges.map((e) => {
                  const other = e.from === selected ? e.to : e.from;
                  const mark = e.dir === 'none' || e.dir === 'both' ? '↔' : e.from === selected ? '→' : '←';
                  return (
                    <li key={e.id}>
                      <span className="rg-rel__dot" style={{ background: COLORS[e.type] }} />
                      <span>
                        <span className="rg-rel__mark">{mark}</span>{' '}
                        <button type="button" className="rg-rel__name" onClick={() => select(other, true)}>{other}</button>
                        <span className="rg-rel__label" style={{ color: COLORS[e.type] }}>{e.label}</span>
                        {e.note && <span className="rg-rel__note">{e.note}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {hover && (
        <div className="rg-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="rg-tip__head">
            {hover.edge.data.from} {hover.edge.data.dir === 'to' ? '→' : '↔'} {hover.edge.data.to}
            <span style={{ color: COLORS[hover.edge.data.type] }}>{hover.edge.data.label}</span>
          </div>
          {hover.edge.data.note}
        </div>
      )}
    </div>
  );
}

export default function Graph(props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
