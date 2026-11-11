"""仿 Notion 版面的 hook。

- 每頁一個 emoji 圖示：front matter 的 `emoji`，沒有就用分類的預設值。
  圖示會出現在頁首（標題上方）、左側導覽、反向連結清單，以及瀏覽器分頁的 favicon。
- 標題下方的「屬性」列（像 Notion 資料庫頁面）：類型、properties 列出的欄位、日期、劇情位置、
  章節、出場集數。出場集數由 backlinks hook 寫進 page.meta["backlink_episodes"]。
  沒有確切日期的集數用 front matter 的 `date_label` 顯示說明；`position` 顯示劇情位置
  （例如「位置未定」）。不要用 `status`，那是 Material 的導覽狀態欄位。
- front matter 設 `cover: true` 的頁面在頂端加一張封面（樣式見 extra.css）。
- `confirm: true` 時，頁首右上角放待確認名詞表單（docs/confirm/）的入口。

設定都在 mkdocs.yml 的 extra.wiki：

    extra:
      wiki:
        episodes: episodes            # 集數資料夾
        chapters: [第一章, 第二章]     # front matter 的 chapter: 1 對應第一個；不分章就留空
        confirm: true
        categories:                   # 集數以外的分類也列在這裡；tab 是反向連結分頁名稱（預設同 label）
          - {folder: episodes, label: 集數, emoji: "📜"}
          - {folder: characters, label: 玩家角色, emoji: "🗡️"}
        properties:                   # 屬性列的欄位，依序顯示；tones 讓值變成彩色標籤
          - {key: full_name, icon: "🪪", label: 全名}
          - {key: alignment, icon: "⚖️", label: 目前陣營, tones: {邪惡: evil, 善良: good}, default_tone: neutral}

必須排在 hooks/backlinks.py 之後載入。
"""

from __future__ import annotations

import html
import re
from urllib.parse import quote, unquote, urljoin

from mkdocs.utils.meta import get_data

# 由 on_config 從 extra.wiki 讀入
DEFAULT_EMOJI: dict[str, str] = {}   # 資料夾/ → emoji
TYPE_LABEL: dict[str, str] = {}      # 資料夾/ → 類型名稱
CHAPTERS: list[str] = []
PROPERTIES: list[dict] = []
CONFIRM = False

_emoji: dict[str, str] = {}       # src_uri → emoji
_url_to_src: dict[str, str] = {}  # 未編碼的頁面 URL → src_uri


def on_config(config):
    global CHAPTERS, PROPERTIES, CONFIRM
    wiki = (config.get("extra") or {}).get("wiki") or {}
    DEFAULT_EMOJI.clear()
    TYPE_LABEL.clear()
    for c in wiki.get("categories") or []:
        folder = str(c["folder"]).strip("/") + "/"
        DEFAULT_EMOJI[folder] = str(c.get("emoji") or "📄")
        TYPE_LABEL[folder] = str(c["label"])
    CHAPTERS = [str(c) for c in wiki.get("chapters") or []]
    PROPERTIES = list(wiki.get("properties") or [])
    CONFIRM = bool(wiki.get("confirm"))
    return config


def _folder(src: str) -> str:
    return src.split("/", 1)[0] + "/" if "/" in src else ""


def on_files(files, config):
    _emoji.clear()
    _url_to_src.clear()
    for f in files.documentation_pages():
        _, meta = get_data(f.content_string)
        _emoji[f.src_uri] = str(meta.get("emoji") or DEFAULT_EMOJI.get(_folder(f.src_uri), "📄"))
        _url_to_src[unquote(f.url).removeprefix("./")] = f.src_uri  # 首頁的 url 是 "./"
    return files


def _icon(src: str, cls: str) -> str:
    return f'<span class="{cls}" aria-hidden="true">{_emoji.get(src, "📄")}</span>'


def _property_value(prop: dict, value) -> str:
    text = html.escape(str(value))
    tones = prop.get("tones")
    if not tones:
        return text
    tone = next((t for word, t in tones.items() if word in str(value)), prop.get("default_tone", "neutral"))
    return f'<span class="notion-tag notion-tag--{html.escape(str(tone))}">{text}</span>'


def _properties(page) -> str:
    src, meta = page.file.src_uri, page.meta
    rows = []
    folder = _folder(src)
    if folder in TYPE_LABEL:
        rows.append(("🏷️", "類型", f'<span class="notion-tag">{html.escape(TYPE_LABEL[folder])}</span>'))
    for prop in PROPERTIES:
        if meta.get(prop["key"]):
            rows.append((prop.get("icon", "•"), html.escape(str(prop["label"])), _property_value(prop, meta[prop["key"]])))
    # 沒有確切日期的集數用 date_label 說明（例如「2025-12（確切日期不詳）」）
    if meta.get("date") or meta.get("date_label"):
        rows.append(("📅", "日期", html.escape(str(meta.get("date") or meta["date_label"]))))
    if meta.get("position"):
        rows.append(("📍", "劇情位置", f'<span class="notion-tag notion-tag--pending">{html.escape(str(meta["position"]))}</span>'))
    chapter = meta.get("chapter")
    if isinstance(chapter, int) and 1 <= chapter <= len(CHAPTERS):
        tone = (chapter - 1) % 4 + 1  # extra.css 有 ch1～ch4 四種顏色，超過就循環
        rows.append(("📖", "章節", f'<span class="notion-tag notion-tag--ch{tone}">{html.escape(CHAPTERS[chapter - 1])}</span>'))
    episodes = meta.get("backlink_episodes")
    if episodes:
        rows.append(("🔗", "出場集數", f'<a href="#出場與提及">{episodes} 集</a>'))
    if not rows:
        return ""
    body = "".join(
        f'<div class="notion-prop"><div class="notion-prop__key"><span>{i}</span>{k}</div>'
        f'<div class="notion-prop__value">{v}</div></div>'
        for i, k, v in rows
    )
    return f'<div class="notion-props">{body}</div>'


def _pager(page) -> str:
    """頁尾的上一頁／下一頁卡片，放在內文欄裡，跟內文對齊（取代 Material 的頁尾）。"""
    cards = []
    for other, cls, label in ((page.previous_page, "prev", "← 上一頁"), (page.next_page, "next", "下一頁 →")):
        if other is None:
            cards.append(f'<span class="notion-pager__spacer"></span>')
            continue
        url = html.escape(other.file.url_relative_to(page.file))
        cards.append(
            f'<a class="notion-pager__link notion-pager__link--{cls}" href="{url}">'
            f'<span class="notion-pager__dir">{label}</span>'
            f'<span class="notion-pager__title">{_icon(other.file.src_uri, "notion-inline-icon")}'
            f'<span class="notion-pager__text">{html.escape(other.title or "")}</span></span></a>'
        )
    return f'<nav class="notion-pager" aria-label="上一頁與下一頁" data-search-exclude>{"".join(cards)}</nav>'


def on_page_content(html_out, page, config, files):
    src = page.file.src_uri
    html_out += _pager(page)
    head = ""
    if page.meta.get("cover"):
        head += '<div class="notion-cover" aria-hidden="true"></div>'
    head += _icon(src, "notion-page-icon")
    # 圖示放在 h1 前、屬性列放在 h1 後
    m = re.search(r"<h1[^>]*>.*?</h1>", html_out, re.S)
    if not m:
        return head + html_out
    # 反向連結清單裡的來源頁加上圖示
    rest = re.sub(
        r'<a class="backlink-page" data-src="([^"]+)"',
        lambda b: f'{_icon(html.unescape(b.group(1)), "notion-inline-icon")}<a class="backlink-page"',
        html_out[m.end():],
    )
    return html_out[:m.start()] + head + m.group(0) + _properties(page) + rest


def _favicon(emoji: str) -> str:
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>{emoji}</text></svg>"
    return "data:image/svg+xml," + quote(svg)


def on_post_page(output, page, config):
    base = "http://site/" + unquote(page.url)

    def nav_icon(m):
        target = unquote(urljoin(base, m.group(2)).split("#")[0].removeprefix("http://site/"))
        src = _url_to_src.get(target)
        return m.group(0) + (_icon(src, "notion-nav-icon") if src else "")

    # 左側導覽的頁面連結（不含頁內目錄 #錨點）
    output = re.sub(r'(<a href="([^"#]*)" class="md-nav__link[^"]*">)', nav_icon, output)
    # 手機版目前頁面的 label
    output = output.replace(
        '<label class="md-nav__link md-nav__link--active" for="__toc">',
        '<label class="md-nav__link md-nav__link--active" for="__toc">'
        + _icon(page.file.src_uri, "notion-nav-icon"),
    )
    # 頁首右上角（搜尋前）放待確認名詞表單的入口；表單是 docs/confirm/index.html 靜態頁
    if CONFIRM:
        confirm = "../" * page.url.count("/") + "confirm/"
        output = output.replace(
            '<label class="md-header__button md-icon" for="__search">',
            f'<a class="md-header__button md-header__confirm" href="{confirm}" title="待確認名詞">'
            '<span aria-hidden="true">📝</span><span class="md-header__confirm-text">待確認名詞</span></a>'
            '<label class="md-header__button md-icon" for="__search">',
            1,
        )
    # 每頁用自己的 emoji 當 favicon
    output = re.sub(
        r'<link rel="icon" href="[^"]*">',
        f'<link rel="icon" href="{_favicon(_emoji.get(page.file.src_uri, "📄"))}">',
        output,
    )
    return output
