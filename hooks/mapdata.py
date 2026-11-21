"""互動地圖的資料 hook。

建站時讀 data/map.yml，補上各勢力、地點、人物頁的名稱、簡介與網址，產生 map/map.json，
給 docs/map/app/map.js（three.js 小程式）使用。行政區界線是靜態檔 docs/map/tokyo23.geojson。

- 勢力的 id 是 wiki 勢力頁的標題；name、summary 沒寫時取自該頁。
- 地標、事件的 page 與 people 填頁面標題，會轉成網址。
- 提到不存在的頁面、勢力或行政區代碼會發出警告，--strict 建站會失敗。
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from urllib.parse import unquote

import yaml
from mkdocs.structure.files import File
from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.mapdata")

OUTPUT = "map/map.json"
SUMMARY_RE = re.compile(r'^!!!\s+(?:info|abstract)\b[^\n]*\n((?:[ \t]{4,}[^\n]*\n?|[ \t]*\n)+)', re.M)
MD_LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\([^)]*\)')
PAGE_FOLDERS = {"characters", "npcs", "factions", "places"}


def _plain(md: str) -> str:
    text = MD_LINK_RE.sub(r"\1", md)
    text = re.sub(r"\*\*|__|`|<[^>]+>|\{[^}]*\}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def on_files(files, config):
    root = Path(config.config_file_path).parent
    data_file = root / "data" / "map.yml"
    if not data_file.exists():
        return files
    data = yaml.safe_load(data_file.read_text(encoding="utf-8")) or {}

    pages: dict[str, dict] = {}
    for f in files.documentation_pages():
        folder = f.src_uri.split("/")[0] if "/" in f.src_uri else ""
        if folder not in PAGE_FOLDERS:
            continue
        markdown, meta = get_data(f.content_string)
        h1 = re.search(r"^#\s+(.+?)\s*$", markdown, re.M)
        title = str(meta.get("title") or (h1.group(1) if h1 else f.name))
        m = SUMMARY_RE.search(markdown)
        pages[title] = {"url": unquote(f.url), "summary": _plain(m.group(1)) if m else "",
                        "emoji": str(meta.get("emoji") or "")}

    def link(title, where):
        if not title:
            return None
        p = pages.get(str(title))
        if not p:
            log.warning("地圖：%s 提到的頁面「%s」不存在", where, title)
            return None
        return {"name": str(title), "url": p["url"], "emoji": p["emoji"]}

    factions = []
    for fc in data.get("factions") or []:
        fid = str(fc["id"])
        p = pages.get(fid)
        if not p and not fc.get("name"):
            log.warning("地圖：勢力「%s」沒有對應的頁面，也沒有寫 name", fid)
        factions.append({
            "id": fid,
            "name": str(fc.get("name") or fid),
            "nameEn": str(fc.get("nameEn") or ""),
            "color": str(fc.get("color") or "#8A929B"),
            "summary": str(fc.get("summary") or (p["summary"] if p else "")),
            "url": p["url"] if p else "",
        })
    fac_ids = {f["id"] for f in factions}

    wards = []
    for w in data.get("wards") or []:
        fac = w.get("faction")
        if fac and fac not in fac_ids:
            log.warning("地圖：行政區 %s 的勢力「%s」不在 factions 裡", w.get("name"), fac)
        wards.append({
            "code": str(w["code"]), "slug": str(w["slug"]), "name": str(w["name"]),
            "faction": str(fac) if fac else None, "contested": bool(w.get("contested")),
            "summary": str(w.get("summary") or "目前還沒有和這一區有關的設定。"),
        })
    ward_codes = {w["code"] for w in wards}

    def check_ward(item, where):
        if str(item.get("ward")) not in ward_codes:
            log.warning("地圖：%s 的行政區代碼 %s 不存在", where, item.get("ward"))

    landmarks = []
    for lm in data.get("landmarks") or []:
        where = f"地標「{lm.get('name')}」"
        check_ward(lm, where)
        page = link(lm.get("page"), where)
        landmarks.append({
            "id": str(lm["id"]), "name": str(lm["name"]), "ward": str(lm["ward"]),
            "position": [float(v) for v in lm["position"]],
            "summary": str(lm.get("summary") or ""), "detail": str(lm.get("detail") or ""),
            "page": page, "people": [p for p in (link(n, where) for n in lm.get("people") or []) if p],
        })

    events = []
    for ev in data.get("events") or []:
        where = f"事件「{ev.get('title')}」"
        check_ward(ev, where)
        for fid in ev.get("factions") or []:
            if fid not in fac_ids:
                log.warning("地圖：%s 的勢力「%s」不在 factions 裡", where, fid)
        events.append({
            "id": str(ev["id"]), "title": str(ev["title"]), "ward": str(ev["ward"]),
            "position": [float(v) for v in ev["position"]], "session": int(ev.get("session") or 0),
            "factions": [str(f) for f in ev.get("factions") or []],
            "summary": str(ev.get("summary") or ""), "excerpt": str(ev.get("excerpt") or ""),
            "mock": bool(ev.get("mock")), "page": link(ev.get("page"), where),
            "people": [p for p in (link(n, where) for n in ev.get("people") or []) if p],
        })

    out = {"meta": data.get("meta") or {}, "factions": factions, "wards": wards,
           "landmarks": landmarks, "events": events}
    files.append(File.generated(config, OUTPUT, content=json.dumps(out, ensure_ascii=False)))
    return files
