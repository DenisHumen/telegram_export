"""Turn the archived rows into the files the user actually walks away with.

Everything here reads from MySQL, never from Telegram — which is what makes
``POST /api/export/jobs/{id}/rebuild`` cheap: change the layout or add a format
and re-render without touching the network.

The HTML viewer is deliberately built as ``index.html`` + ``assets/data.js``
(a ``window.TGVAULT_DATA = …`` assignment) rather than a ``fetch()`` of a JSON
file: browsers block ``fetch`` on ``file://`` URLs, and this archive has to
open by double-clicking it years from now with no server involved.
"""

from __future__ import annotations

import csv
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.db.models import Account, Chat, ExportJob, MediaFile, Message
from app.services.layout import sort_key
from app.services.options import ExportOptions

log = logging.getLogger("tgvault.render")

_MEDIA_LABELS_RU = {
    "none": "Текст",
    "photo": "Фото",
    "video": "Видео",
    "video_note": "Кружочек",
    "voice": "Голосовое",
    "audio": "Аудио",
    "document": "Документ",
    "sticker": "Стикер",
    "animation": "GIF",
    "contact": "Контакт",
    "poll": "Опрос",
    "geo": "Геопозиция",
    "venue": "Место",
    "webpage": "Ссылка",
    "game": "Игра",
    "invoice": "Счёт",
    "dice": "Дайс",
    "unsupported": "Прочее",
}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _message_dict(message: Message, files: list[MediaFile]) -> dict[str, Any]:
    return {
        "id": message.tg_message_id,
        "date": _iso(message.date),
        "edit_date": _iso(message.edit_date),
        "sender_id": message.sender_id,
        "sender_name": message.sender_name,
        "sender_username": message.sender_username,
        "post_author": message.post_author,
        "text": message.text,
        "text_html": message.text_html,
        "media_type": message.media_type,
        "grouped_id": message.grouped_id,
        "reply_to_msg_id": message.reply_to_msg_id,
        "forward": (
            {
                "name": message.fwd_from_name,
                "id": message.fwd_from_id,
                "date": _iso(message.fwd_from_date),
                "post_id": message.fwd_from_post_id,
            }
            if message.fwd_from_name or message.fwd_from_id
            else None
        ),
        "views": message.views,
        "forwards": message.forwards,
        "replies": message.replies_count,
        "reactions": message.reactions,
        "is_service": message.is_service,
        "service_action": message.service_action,
        "is_pinned": message.is_pinned,
        "is_outgoing": message.is_outgoing,
        "extra": message.raw,
        "files": [
            {
                "kind": f.kind,
                "file_name": f.file_name,
                "rel_path": f.rel_path,
                "size": f.size,
                "mime_type": f.mime_type,
                "width": f.width,
                "height": f.height,
                "duration": f.duration,
                "status": f.status,
            }
            for f in files
        ],
        # Sorting helpers, stripped before writing.
        "tg_message_id": message.tg_message_id,
        "sender_name_sort": message.sender_name,
    }


async def collect_messages(
    session: AsyncSession, chat_id: int, options: ExportOptions
) -> list[dict[str, Any]]:
    """Load the archived messages for a chat, filtered and sorted per options."""
    query = select(Message).where(Message.chat_id == chat_id)
    if options.date_from:
        query = query.where(Message.date >= options.date_from)
    if options.date_to:
        query = query.where(Message.date <= options.date_to)
    if options.min_id:
        query = query.where(Message.tg_message_id > options.min_id)
    if options.max_id:
        query = query.where(Message.tg_message_id <= options.max_id)
    if not options.include_service_messages:
        query = query.where(Message.is_service.is_(False))
    query = query.order_by(Message.date.asc())

    messages = (await session.execute(query)).scalars().all()
    if not messages:
        return []

    ids = [m.id for m in messages]
    files_by_message: dict[int, list[MediaFile]] = {}
    # Chunked IN() — MySQL chokes on a placeholder list with 100k entries.
    for start in range(0, len(ids), 1000):
        chunk = ids[start : start + 1000]
        rows = (
            await session.execute(select(MediaFile).where(MediaFile.message_id.in_(chunk)))
        ).scalars().all()
        for row in rows:
            files_by_message.setdefault(row.message_id, []).append(row)

    items = [_message_dict(m, files_by_message.get(m.id, [])) for m in messages]
    items.sort(key=sort_key(options.sort_field), reverse=options.sort_order == "desc")
    return items


def _strip_sort_helpers(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned = []
    for item in items:
        copy = dict(item)
        copy.pop("tg_message_id", None)
        copy.pop("sender_name_sort", None)
        cleaned.append(copy)
    return cleaned


def _stats(items: list[dict[str, Any]]) -> dict[str, Any]:
    by_type: dict[str, int] = {}
    total_bytes = 0
    files = 0
    for item in items:
        by_type[item["media_type"]] = by_type.get(item["media_type"], 0) + 1
        for file in item["files"]:
            files += 1
            total_bytes += file.get("size") or 0
    dates = [item["date"] for item in items if item.get("date")]
    return {
        "messages": len(items),
        "media_files": files,
        "bytes": total_bytes,
        "by_media_type": by_type,
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
    }


# --------------------------------------------------------------------------
# writers
# --------------------------------------------------------------------------


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )


def write_jsonl(path: Path, items: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


def write_csv(path: Path, items: list[dict[str, Any]]) -> None:
    columns = [
        "id",
        "date",
        "sender_name",
        "sender_username",
        "media_type",
        "text",
        "files",
        "size_bytes",
        "views",
        "forwards",
        "reactions",
        "reply_to",
        "grouped_id",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            reactions = item.get("reactions") or []
            writer.writerow(
                {
                    "id": item["id"],
                    "date": item["date"],
                    "sender_name": item.get("sender_name") or "",
                    "sender_username": item.get("sender_username") or "",
                    "media_type": item["media_type"],
                    "text": (item.get("text") or "").replace("\r\n", "\n"),
                    "files": " | ".join(f["rel_path"] or "" for f in item["files"]),
                    "size_bytes": sum(f.get("size") or 0 for f in item["files"]),
                    "views": item.get("views") or "",
                    "forwards": item.get("forwards") or "",
                    "reactions": " ".join(
                        f"{r.get('emoji') or '?'}×{r.get('count')}" for r in reactions
                    ),
                    "reply_to": item.get("reply_to_msg_id") or "",
                    "grouped_id": item.get("grouped_id") or "",
                }
            )


def write_txt(path: Path, chat_title: str, items: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{chat_title}\n{'=' * len(chat_title)}\n")
        handle.write(f"Экспортировано: {datetime.now():%Y-%m-%d %H:%M:%S} · TgVault {__version__}\n")
        handle.write(f"Сообщений: {len(items)}\n\n")
        for item in items:
            author = item.get("sender_name") or item.get("post_author") or "—"
            date = (item.get("date") or "").replace("T", " ")
            handle.write(f"[{date}] {author} (#{item['id']})\n")
            if item.get("is_service"):
                handle.write(f"  * служебное: {item.get('service_action')}\n")
            if item.get("text"):
                for line in item["text"].splitlines():
                    handle.write(f"  {line}\n")
            for file in item["files"]:
                label = _MEDIA_LABELS_RU.get(file["kind"], file["kind"])
                handle.write(f"  [{label}] {file.get('rel_path') or file.get('file_name')}\n")
            handle.write("\n")


def _html_document(title: str) -> str:
    """The offline viewer shell. Data arrives from ``assets/data.js``."""
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — TgVault</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="logo">TV</span>
    <div>
      <h1 id="chat-title">…</h1>
      <p id="chat-sub" class="muted"></p>
    </div>
  </div>
  <div class="stats" id="stats"></div>
</header>
<div class="toolbar">
  <input id="search" type="search" placeholder="Поиск по тексту…" autocomplete="off">
  <select id="type-filter"></select>
  <select id="sort-order">
    <option value="asc">Сначала старые</option>
    <option value="desc">Сначала новые</option>
  </select>
  <span class="count" id="count"></span>
</div>
<main id="feed"></main>
<div id="sentinel"></div>
<footer class="muted">Сформировано TgVault {__version__} · архив работает офлайн</footer>
<script src="assets/data.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
"""


_HTML_CSS = """
:root{--bg:#0b0f14;--panel:#111823;--panel2:#151e2b;--line:rgba(255,255,255,.07);
--text:#e6edf6;--muted:#8b9bb0;--accent:#3390ec;--accent2:#5cc8ff;--ok:#3dd68c;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
font:15px/1.55 ui-sans-serif,Inter,system-ui,"Segoe UI",Roboto,sans-serif;}
h1{font-size:20px;margin:0}
.muted{color:var(--muted)}
.topbar{display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:center;
padding:20px 24px;background:linear-gradient(180deg,var(--panel),transparent);border-bottom:1px solid var(--line)}
.brand{display:flex;gap:14px;align-items:center}
.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-weight:700;
background:linear-gradient(135deg,var(--accent),var(--accent2));color:#03121f}
.stats{display:flex;gap:22px;flex-wrap:wrap}
.stat b{display:block;font-size:18px}
.stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.toolbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;flex-wrap:wrap;align-items:center;
padding:12px 24px;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
input,select{background:var(--panel2);border:1px solid var(--line);color:var(--text);
border-radius:10px;padding:9px 12px;font-size:14px;outline:none}
input:focus,select:focus{border-color:var(--accent)}
input#search{flex:1;min-width:220px}
.count{margin-left:auto;color:var(--muted);font-size:13px}
main{max-width:900px;margin:0 auto;padding:24px 16px 80px}
.msg{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:12px}
.msg.service{background:transparent;border-style:dashed;text-align:center;color:var(--muted);font-size:13px}
.msg-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.author{font-weight:600;color:var(--accent2)}
.meta{font-size:12px;color:var(--muted)}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--panel2);
border:1px solid var(--line);color:var(--muted)}
.text{white-space:pre-wrap;word-break:break-word}
.text a{color:var(--accent2)}
.text code{background:var(--panel2);padding:1px 5px;border-radius:5px;font-family:ui-monospace,Menlo,monospace}
.media{margin-top:10px;display:flex;flex-wrap:wrap;gap:10px}
.media img,.media video{max-width:100%;border-radius:12px;background:#000}
.media img{max-height:460px}
.media video{max-height:460px}
.round video{width:220px;height:220px;border-radius:50%;object-fit:cover}
audio{width:100%;max-width:420px}
.file-chip{display:flex;gap:10px;align-items:center;background:var(--panel2);border:1px solid var(--line);
border-radius:12px;padding:10px 12px;text-decoration:none;color:var(--text);min-width:220px}
.file-chip .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;
background:linear-gradient(135deg,var(--accent),var(--accent2));color:#03121f;font-weight:700;font-size:12px}
.file-chip small{display:block;color:var(--muted)}
.missing{opacity:.55;border-style:dashed}
.reactions{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
.reaction{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:13px}
.fwd{font-size:12px;color:var(--muted);border-left:2px solid var(--accent);padding-left:8px;margin-bottom:6px}
footer{text-align:center;padding:24px;font-size:12px}
#sentinel{height:1px}
"""


_HTML_JS = """
(function () {
  var DATA = window.TGVAULT_DATA || { messages: [], chat: {}, stats: {} };
  var LABELS = DATA.labels || {};
  var feed = document.getElementById('feed');
  var search = document.getElementById('search');
  var typeFilter = document.getElementById('type-filter');
  var sortOrder = document.getElementById('sort-order');
  var countEl = document.getElementById('count');
  var PAGE = 60, shown = 0, filtered = DATA.messages.slice();

  document.getElementById('chat-title').textContent = DATA.chat.title || 'Экспорт';
  var sub = [];
  if (DATA.chat.username) sub.push('@' + DATA.chat.username);
  if (DATA.chat.kind) sub.push(DATA.chat.kind);
  if (DATA.stats.date_from) sub.push(DATA.stats.date_from.slice(0, 10) + ' — ' + (DATA.stats.date_to || '').slice(0, 10));
  document.getElementById('chat-sub').textContent = sub.join(' · ');

  var stats = [
    ['Сообщений', DATA.stats.messages || 0],
    ['Файлов', DATA.stats.media_files || 0],
    ['Объём', human(DATA.stats.bytes || 0)]
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>';
  }).join('');

  var types = {};
  DATA.messages.forEach(function (m) { types[m.media_type] = (types[m.media_type] || 0) + 1; });
  var opts = ['<option value="">Все типы (' + DATA.messages.length + ')</option>'];
  Object.keys(types).sort().forEach(function (t) {
    opts.push('<option value="' + t + '">' + (LABELS[t] || t) + ' (' + types[t] + ')</option>');
  });
  typeFilter.innerHTML = opts.join('');

  function human(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function duration(sec) {
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function mediaHtml(m) {
    if (!m.files || !m.files.length) return '';
    return '<div class="media">' + m.files.map(function (f) {
      if (f.status !== 'done' || !f.rel_path) {
        return '<div class="file-chip missing"><div class="ic">!</div><div>' +
          esc(f.file_name || f.kind) + '<small>файл не скачан</small></div></div>';
      }
      var p = encodeURI(f.rel_path);
      if (f.kind === 'photo' || f.kind === 'sticker') {
        return '<a href="' + p + '" target="_blank"><img loading="lazy" src="' + p + '" alt=""></a>';
      }
      if (f.kind === 'video_note') {
        return '<div class="round"><video src="' + p + '" controls preload="none"></video></div>';
      }
      if (f.kind === 'video' || f.kind === 'animation') {
        return '<video src="' + p + '" controls preload="none"' +
          (f.kind === 'animation' ? ' loop muted' : '') + '></video>';
      }
      if (f.kind === 'voice' || f.kind === 'audio') {
        return '<div style="flex:1"><audio controls preload="none" src="' + p + '"></audio>' +
          '<small class="muted">' + esc(f.file_name || '') + ' ' + duration(f.duration) + '</small></div>';
      }
      return '<a class="file-chip" href="' + p + '" download><div class="ic">' +
        esc((f.ext || f.kind || '?').replace('.', '').slice(0, 3).toUpperCase()) +
        '</div><div>' + esc(f.file_name || f.kind) + '<small>' + human(f.size) + '</small></div></a>';
    }).join('') + '</div>';
  }

  function render(m) {
    if (m.is_service) {
      return '<div class="msg service">' + esc(m.service_action || 'служебное сообщение') +
        ' · ' + esc((m.date || '').replace('T', ' ')) + '</div>';
    }
    var head = '<div class="msg-head"><span class="author">' +
      esc(m.sender_name || m.post_author || 'Неизвестно') + '</span>' +
      '<span class="meta">' + esc((m.date || '').replace('T', ' ')) + '</span>' +
      '<span class="badge">#' + m.id + '</span>' +
      (m.media_type !== 'none' ? '<span class="badge">' + esc(LABELS[m.media_type] || m.media_type) + '</span>' : '') +
      (m.views ? '<span class="meta">👁 ' + m.views + '</span>' : '') + '</div>';
    var fwd = m.forward ? '<div class="fwd">Переслано от ' + esc(m.forward.name || m.forward.id) + '</div>' : '';
    var body = m.text_html ? '<div class="text">' + m.text_html + '</div>'
      : (m.text ? '<div class="text">' + esc(m.text) + '</div>' : '');
    var reactions = (m.reactions && m.reactions.length)
      ? '<div class="reactions">' + m.reactions.map(function (r) {
        return '<span class="reaction">' + esc(r.emoji || '★') + ' ' + r.count + '</span>';
      }).join('') + '</div>' : '';
    return '<div class="msg">' + head + fwd + body + mediaHtml(m) + reactions + '</div>';
  }

  function apply() {
    var q = search.value.trim().toLowerCase();
    var type = typeFilter.value;
    filtered = DATA.messages.filter(function (m) {
      if (type && m.media_type !== type) return false;
      if (!q) return true;
      return ((m.text || '') + ' ' + (m.sender_name || '')).toLowerCase().indexOf(q) !== -1;
    });
    if (sortOrder.value === 'desc') filtered = filtered.slice().reverse();
    feed.innerHTML = '';
    shown = 0;
    more();
    countEl.textContent = 'Показано ' + Math.min(shown, filtered.length) + ' из ' + filtered.length;
  }

  function more() {
    var slice = filtered.slice(shown, shown + PAGE);
    if (!slice.length) return;
    var html = slice.map(render).join('');
    feed.insertAdjacentHTML('beforeend', html);
    shown += slice.length;
    countEl.textContent = 'Показано ' + shown + ' из ' + filtered.length;
  }

  search.addEventListener('input', debounce(apply, 250));
  typeFilter.addEventListener('change', apply);
  sortOrder.addEventListener('change', apply);
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  var io = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) more();
  }, { rootMargin: '600px' });
  io.observe(document.getElementById('sentinel'));

  apply();
})();
"""


async def write_outputs(
    session: AsyncSession,
    *,
    job_id: int,
    chat_id: int,
    account_id: int,
    output_dir: Path,
    options: ExportOptions,
    progress: dict[str, Any] | None = None,
) -> list[str]:
    """Write every requested format plus ``manifest.json``. Returns filenames."""
    output_dir.mkdir(parents=True, exist_ok=True)
    chat = await session.get(Chat, chat_id)
    account = await session.get(Account, account_id)
    job = await session.get(ExportJob, job_id) if job_id else None

    items = await collect_messages(session, chat_id, options)
    clean = _strip_sort_helpers(items)
    stats = _stats(items)
    if progress:
        stats.setdefault("downloaded_files", progress.get("media_files"))
        stats.setdefault("downloaded_bytes", progress.get("bytes"))

    manifest = {
        "tgvault_version": __version__,
        "exported_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "job_id": job_id,
        "account": {
            "id": account.id if account else None,
            "tg_user_id": account.tg_user_id if account else None,
            "username": account.username if account else None,
        },
        "chat": {
            "id": chat.id if chat else None,
            "tg_chat_id": chat.tg_chat_id if chat else None,
            "title": chat.title if chat else "",
            "kind": chat.kind if chat else None,
            "username": chat.username if chat else None,
            "about": chat.about if chat else None,
            "participants_count": chat.participants_count if chat else None,
        },
        "options": options.model_dump(mode="json"),
        "stats": stats,
        "files": [
            {
                "message_id": item["id"],
                "kind": file["kind"],
                "rel_path": file["rel_path"],
                "size": file["size"],
                "status": file["status"],
            }
            for item in clean
            for file in item["files"]
        ],
    }
    write_json(output_dir / "manifest.json", manifest)
    written = ["manifest.json"]

    formats = set(options.formats)
    if "json" in formats:
        write_json(
            output_dir / "messages.json",
            {"chat": manifest["chat"], "stats": stats, "messages": clean},
        )
        written.append("messages.json")
    if "jsonl" in formats:
        write_jsonl(output_dir / "messages.jsonl", clean)
        written.append("messages.jsonl")
    if "csv" in formats:
        write_csv(output_dir / "messages.csv", clean)
        written.append("messages.csv")
    if "txt" in formats:
        write_txt(output_dir / "messages.txt", chat.title if chat else "Экспорт", clean)
        written.append("messages.txt")
    if "html" in formats:
        assets = output_dir / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        (assets / "style.css").write_text(_HTML_CSS, encoding="utf-8")
        (assets / "app.js").write_text(_HTML_JS, encoding="utf-8")
        payload = {
            "chat": manifest["chat"],
            "stats": stats,
            "labels": _MEDIA_LABELS_RU,
            "messages": clean,
        }
        (assets / "data.js").write_text(
            "window.TGVAULT_DATA = "
            + json.dumps(payload, ensure_ascii=False, default=str)
            + ";\n",
            encoding="utf-8",
        )
        (output_dir / "index.html").write_text(
            _html_document(chat.title if chat else "Экспорт"), encoding="utf-8"
        )
        written.extend(["index.html", "assets/data.js"])

    if job is not None:
        job.output_dir = str(output_dir)
    log.info("Rendered %s for chat #%s → %s", ", ".join(written), chat_id, output_dir)
    return written
