"""滑鼠移到關鍵字上時顯示簡介（hover 預覽）。

兩種關鍵字：
1. 連到其他 wiki 頁面的連結：預覽內容取自目標頁的簡介框
   （角色、NPC、勢力等頁的 `!!! info ""`，集數頁的 `!!! abstract "本集概要"`）。
2. 名詞表裡、沒有專頁的名詞：取自 glossary.md 表格的「說明」欄。
   每頁只標記每個名詞第一次出現的位置（不含標題、連結、程式碼與表格標頭），
   名詞表、首頁、時間線這類 `backlinks: false` 的索引頁不標記。

HTML 端只加上 data-pv-* 屬性；顯示由 docs/javascripts/previews.js 負責，樣式在 extra.css 的「hover 預覽」段落。

這支 hook 必須排在 backlinks.py 前面，才不會替「出場與提及」區塊裡的連結也加上預覽。
"""

from __future__ import annotations

import html
import posixpath
import re
from urllib.parse import unquote, urlsplit

from mkdocs.utils.meta import get_data

GLOSSARY = "glossary.md"
SUMMARY_RE = re.compile(r'^!!!\s+(?:info|abstract)\b[^\n]*\n((?:[ \t]{4,}[^\n]*\n?|[ \t]*\n)+)', re.M)
MD_LINK_RE = re.compile(r'(?<!!)\[([^\]]*)\]\([^)]*\)')
ROW_RE = re.compile(r'^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$', re.M)
ANCHOR_RE = re.compile(r'<a\s([^>]*?)href="([^"]+)"([^>]*)>')
SKIP_TAGS = {"a", "code", "pre", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6", "th", "abbr", "button", "label", "summary"}
TAG_RE = re.compile(r'(<[^>]+>)')
TAG_NAME_RE = re.compile(r'^<\s*(/?)\s*([a-zA-Z0-9]+)')
VOID_TAGS = {"br", "img", "hr", "input", "meta", "link", "wbr"}
MAX_LEN = 140

_pages: dict[str, dict] = {}     # 網址（file.url）→ 預覽資料
_terms: list[tuple[str, str]] = []  # (名詞, 說明)，長的優先
_skip_terms: set[str] = set()    # backlinks: false 的頁面不標記名詞
_cat_labels: dict[str, str] = {}
_cat_emojis: dict[str, str] = {}


def _plain(md: str) -> str:
    text = MD_LINK_RE.sub(r"\1", md)
    text = re.sub(r"\*\*|__|`|<[^>]+>|\{[^}]*\}", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= MAX_LEN else text[:MAX_LEN].rstrip() + "……"


def on_config(config):
    wiki = (config.get("extra") or {}).get("wiki") or {}
    _cat_labels.clear()
    _cat_emojis.clear()
    for c in wiki.get("categories") or []:
        folder = str(c["folder"]).strip("/") + "/"
        _cat_labels[folder] = str(c.get("label", ""))
        _cat_emojis[folder] = str(c.get("emoji", ""))
    return config


def on_files(files, config):
    _pages.clear()
    _terms.clear()
    _skip_terms.clear()
    for f in files.documentation_pages():
        markdown, meta = get_data(f.content_string)
        if meta.get("backlinks") is False:
            _skip_terms.add(f.src_uri)
        if f.src_uri == GLOSSARY:
            for term_cell, desc in ROW_RE.findall(markdown):
                if term_cell in ("名詞", "---") or set(term_cell) <= set("-: "):
                    continue
                desc_plain = _plain(desc)
                for term in re.split(r"[、，,]", term_cell):
                    term = re.sub(r"[（(].*?[）)]", "", term).strip()
                    if len(term) >= 2 and " " not in term:
                        _terms.append((term, desc_plain))
            continue
        m = SUMMARY_RE.search(markdown)
        if not m:
            continue
        summary = _plain(m.group(1))
        if not summary:
            continue
        folder = f.src_uri.split("/")[0] + "/" if "/" in f.src_uri else ""
        h1 = re.search(r"^#\s+(.+?)\s*$", markdown, re.M)
        _pages[_url_key(f.url)] = {
            "title": str(meta.get("title") or (h1.group(1) if h1 else f.name)),
            "emoji": str(meta.get("emoji") or _cat_emojis.get(folder, "")),
            "kind": _cat_labels.get(folder, ""),
            "text": summary,
        }
    _terms.sort(key=lambda t: len(t[0]), reverse=True)
    return files


def _url_key(url: str) -> str:
    """MkDocs 的 file.url 是百分比編碼（首頁是 './'），統一成未編碼、結尾斜線、首頁為空字串。"""
    url = posixpath.normpath(unquote(url))
    return "" if url in (".", "/") else url.strip("/") + "/"


def _attrs(data: dict) -> str:
    return "".join(f' data-pv-{k}="{html.escape(v, quote=True)}"' for k, v in data.items() if v)


def _link_previews(html_out: str, page) -> str:
    here = _url_key(page.url)

    def repl(m):
        before, href, after = m.group(1), m.group(2), m.group(3)
        # 首頁卡片本身就有簡介，不再加預覽
        if any(s in before + after for s in ("data-pv-", "headerlink", "notion-card")):
            return m.group(0)
        parts = urlsplit(html.unescape(href))
        if parts.scheme or parts.netloc or not parts.path:
            return m.group(0)
        target = _url_key(posixpath.join(here, unquote(parts.path)))
        data = _pages.get(target)
        if not data or target == here:
            return m.group(0)
        return f'<a {before}href="{href}"{after}{_attrs(data)}>'

    return ANCHOR_RE.sub(repl, html_out)


def _term_previews(html_out: str) -> str:
    if not _terms:
        return html_out
    pattern = re.compile("|".join(re.escape(t) for t, _ in _terms))
    desc = dict(_terms)
    done: set[str] = set()
    stack: list[str] = []
    out = []
    for chunk in TAG_RE.split(html_out):
        if chunk.startswith("<"):
            tm = TAG_NAME_RE.match(chunk)
            if tm and not chunk.endswith("/>"):
                closing, name = tm.group(1), tm.group(2).lower()
                if name not in VOID_TAGS:
                    if closing:
                        if name in stack:
                            while stack and stack.pop() != name:
                                pass
                    else:
                        stack.append(name)
            out.append(chunk)
            continue
        if not chunk.strip() or any(t in SKIP_TAGS for t in stack):
            out.append(chunk)
            continue

        def repl(m):
            term = m.group(0)
            if term in done:
                return term
            done.add(term)
            data = {"title": term, "emoji": "📖", "kind": "名詞", "text": desc[term]}
            return f'<span class="wiki-term" tabindex="0"{_attrs(data)}>{term}</span>'

        out.append(pattern.sub(repl, chunk))
    return "".join(out)


def on_page_content(html_out, page, config, files):
    html_out = _link_previews(html_out, page)
    if page.file.src_uri not in _skip_terms:
        html_out = _term_previews(html_out)
    return html_out
