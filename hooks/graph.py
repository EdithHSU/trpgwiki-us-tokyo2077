"""關係圖的資料 hook。

建站時讀 data/relations.yml（關係線、沒有專頁的節點、勢力的上下層）與 data/positions.json（位置），
加上各頁面的標題、emoji 與簡介，產生 relations/graph.json，給 docs/relations/app/graph.js（React Flow 小程式）使用。

- 節點：人物頁與勢力頁（勢力是框，資料夾見 GROUP_FOLDERS），id 是頁面標題。
- 人物在哪個框裡：relations.yml 的 parents 優先，其次是 front matter 的 faction（忽略括號內的文字）。
- 位置：positions.json 有的照用（相對於所在的框）；沒有的自動排，所以新增節點不用先給位置。
- relations.yml 提到不存在的節點會發出警告，--strict 建站會失敗。
"""

from __future__ import annotations

import json
import logging
import math
import re
from pathlib import Path
from urllib.parse import unquote

import yaml
from mkdocs.structure.files import File
from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.graph")

OUTPUT = "relations/graph.json"
GROUP_FOLDERS = {"factions"}                 # 這些分類的頁面是「框」
NODE_FOLDERS = {"characters", "npcs", "factions", "places"}   # 地點也是卡片
PC_FOLDER = "characters"
SUMMARY_RE = re.compile(r'^!!!\s+(?:info|abstract)\b[^\n]*\n((?:[ \t]{4,}[^\n]*\n?|[ \t]*\n)+)', re.M)
MD_LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\([^)]*\)')

# 自動排版的尺寸（要和 graph-app/src/graph.css 的卡片大小一致）
CARD_W, CARD_H = 168, 52
PAD, HEAD, GAP = 24, 48, 44
EMPTY_W, EMPTY_H = 190, 84
WRAP_W = 2200


def _plain(md: str) -> str:
    text = MD_LINK_RE.sub(r"\1", md)
    text = re.sub(r"\*\*|__|`|<[^>]+>|\{[^}]*\}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _layout(nodes: dict, children: dict, order: list[str], pos: dict) -> None:
    """替沒有位置的節點算出位置；框的大小由內容決定。座標相對於所在的框。"""

    def size(nid: str) -> tuple[int, int]:
        n = nodes[nid]
        if not n["group"]:
            return CARD_W, CARD_H
        kids = children.get(nid, [])
        cards = [k for k in kids if not nodes[k]["group"]]
        groups = [k for k in kids if nodes[k]["group"]]
        x, y, width = PAD, HEAD, 0
        if cards:
            cols = max(2, math.ceil(math.sqrt(len(cards))))
            for i, k in enumerate(cards):
                nodes[k]["x"] = PAD + (i % cols) * (CARD_W + GAP)
                nodes[k]["y"] = HEAD + (i // cols) * (CARD_H + GAP)
            rows = math.ceil(len(cards) / cols)
            width = min(cols, len(cards)) * (CARD_W + GAP) - GAP
            y = HEAD + rows * (CARD_H + GAP)
        row_h = 0
        for k in groups:
            w, h = size(k)
            nodes[k]["x"], nodes[k]["y"] = x, y
            x += w + GAP
            row_h = max(row_h, h)
        if groups:
            width = max(width, x - GAP - PAD)
            y += row_h + GAP
        if not kids:
            n["w"], n["h"] = EMPTY_W, EMPTY_H
        else:
            n["w"], n["h"] = width + PAD * 2, y - GAP + PAD
        return n["w"], n["h"]

    top = [i for i in order if i in nodes and not nodes[i]["parent"]]
    top += [i for i in nodes if not nodes[i]["parent"] and i not in top]
    x = y = row_h = 0
    for nid in top:
        w, h = size(nid)
        if x and x + w > WRAP_W:
            x, y, row_h = 0, y + row_h + GAP * 2, 0
        nodes[nid]["x"], nodes[nid]["y"] = x, y
        x += w + GAP * 2
        row_h = max(row_h, h)

    # 存檔過的位置優先
    for nid, p in pos.items():
        n = nodes.get(nid)
        if not n:
            continue
        n["x"], n["y"] = p.get("x", n["x"]), p.get("y", n["y"])
        if n["group"] and "w" in p and "h" in p:
            n["w"], n["h"] = p["w"], p["h"]


def on_files(files, config):
    root = Path(config.config_file_path).parent
    data_file = root / "data" / "relations.yml"
    if not data_file.exists():
        return files
    data = yaml.safe_load(data_file.read_text(encoding="utf-8")) or {}
    pos_file = root / "data" / "positions.json"
    pos = json.loads(pos_file.read_text(encoding="utf-8")) if pos_file.exists() else {}

    wiki = (config.get("extra") or {}).get("wiki") or {}
    cats = {str(c["folder"]).strip("/"): c for c in wiki.get("categories") or []}

    nodes: dict[str, dict] = {}
    factions: dict[str, str] = {}
    for f in files.documentation_pages():
        folder = f.src_uri.split("/")[0] if "/" in f.src_uri else ""
        if folder not in NODE_FOLDERS:
            continue
        markdown, meta = get_data(f.content_string)
        h1 = re.search(r"^#\s+(.+?)\s*$", markdown, re.M)
        nid = str(meta.get("title") or (h1.group(1) if h1 else f.name))
        m = SUMMARY_RE.search(markdown)
        cat = cats.get(folder, {})
        nodes[nid] = {
            "id": nid,
            "emoji": str(meta.get("emoji") or cat.get("emoji", "")),
            "kind": str(cat.get("label", "")),
            "group": folder in GROUP_FOLDERS,
            "pc": folder == PC_FOLDER,
            "url": unquote(f.url),
            "text": _plain(m.group(1)) if m else "",
            "sub": str(meta.get("playbook") or ""),
            "parent": None,
        }
        if meta.get("faction"):
            factions[nid] = re.sub(r"[（(].*", "", str(meta["faction"])).strip()

    for extra in data.get("extra_nodes") or []:
        nid = str(extra["id"])
        if nid in nodes:
            log.warning("relations.yml 的 extra_nodes「%s」已經有專頁，請移除", nid)
            continue
        nodes[nid] = {
            "id": nid, "emoji": str(extra.get("emoji", "")), "kind": str(extra.get("kind", "")),
            "group": bool(extra.get("group")), "pc": False, "url": "", "text": str(extra.get("text", "")),
            "sub": str(extra.get("sub", "")), "parent": extra.get("parent"),
            "unconfirmed": bool(extra.get("unconfirmed")),
        }

    for nid, n in nodes.items():
        parent = (data.get("parents") or {}).get(nid, n["parent"] or factions.get(nid))
        if parent and parent not in nodes:
            if nid in (data.get("parents") or {}) or n["parent"]:
                log.warning("關係圖：「%s」的上層「%s」不存在", nid, parent)
            parent = None
        if parent and not nodes[parent]["group"]:
            log.warning("關係圖：「%s」的上層「%s」不是勢力框", nid, parent)
            parent = None
        n["parent"] = parent if parent != nid else None

    children: dict[str, list[str]] = {}
    for nid, n in nodes.items():
        if n["parent"]:
            children.setdefault(n["parent"], []).append(nid)

    _layout(nodes, children, [str(i) for i in data.get("order") or []], pos)

    # 上層要排在下層前面（React Flow 的要求）
    ordered: list[dict] = []

    def visit(nid: str):
        ordered.append(nodes[nid])
        for k in children.get(nid, []):
            visit(k)

    for nid, n in nodes.items():
        if not n["parent"]:
            visit(nid)

    edges = []
    for i, e in enumerate(data.get("edges") or []):
        a, b = str(e.get("from")), str(e.get("to"))
        if a not in nodes or b not in nodes:
            log.warning("關係圖：關係線 %s → %s 提到不存在的節點", a, b)
            continue
        edges.append({
            "id": f"e{i}", "from": a, "to": b, "type": str(e.get("type", "bond")),
            "dir": str(e.get("dir", "to")), "label": str(e.get("label", "")), "note": str(e.get("note", "")),
            **({"since": str(e["since"])} if e.get("since") else {}),
            **({"until": str(e["until"])} if e.get("until") else {}),
        })

    out = {"layers": data.get("layers") or [], "nodes": ordered, "edges": edges}
    files.append(File.generated(config, OUTPUT, content=json.dumps(out, ensure_ascii=False)))
    return files
