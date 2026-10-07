"""Checks that an issue has what the next stage needs before a reply routes to patch or redesign. No Hermes imports.

The agents read their reference images from the issue. This file applies the fetch rules of factory/src/media.ts,
and test_readiness.py compares their constants with that file, so a change there fails a test here.
The Hermes image has no Node, so the rules are written again in Python instead of called.
"""

import json
import re
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit

MAX_FILES = 12
MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_SECONDS = 20
MAX_HOPS = 3
MAX_SIDE = 16384
SOURCE_HOSTS = ("github.com", "user-images.githubusercontent.com", "private-user-images.githubusercontent.com")
SOURCE_PATHS = (
    re.compile(r"^/user-attachments/(assets/[0-9a-f-]{36}|files/\d+/[\w.-]+)$", re.IGNORECASE | re.ASCII),
    re.compile(r"^/[\w.-]+/[\w.-]+/assets/\d+/[0-9a-f-]{36}$", re.IGNORECASE | re.ASCII),
    re.compile(r"^/\d+/[\w.-]+$", re.ASCII),
)
REDIRECT_HOSTS = SOURCE_HOSTS + (
    "objects.githubusercontent.com",
    "github-production-user-asset-6210df.s3.amazonaws.com",
    "github-production-repository-file-5c1aeb.s3.amazonaws.com",
)
TOKEN_HOST = "github.com"
FIRST_PARTY_HOST = "roam-game.online"
FIRST_PARTY_PATH = re.compile(r"^/(concepts/)?[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(jpg|jpeg|png|webp)$")

MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*<?(https://[^\s)>]+)")
HTML_IMAGE = re.compile(r"<img\b[^>]*?\bsrc\s*=\s*[\"'](https://[^\"']+)[\"']", re.IGNORECASE)
ATTACHMENT_LINK = re.compile(r"(?<![(\"'=])(https://github\.com/user-attachments/assets/[0-9a-f-]{36})", re.IGNORECASE)
FIRST_PARTY_LINK = re.compile(r"(?<![(\"'=\w/.])(https://roam-game\.online/(?:concepts/)?[\w-]+\.(?:jpe?g|png|webp))(?![\w?#/.-])", re.IGNORECASE)
# The factory ignores a bare image link on another host, which is the case this catches in a route text.
BARE_IMAGE_LINK = re.compile(r"(?<![(\"'=])https://[^\s)>\"']+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)>\"']*)?", re.IGNORECASE)


class ReadinessError(Exception):
    """GitHub or its token could not be read, so readiness is unknown."""


@dataclass(frozen=True)
class Comment:
    login: str
    body: str
    created_at: float


@dataclass(frozen=True)
class IssueView:
    body: str
    updated_at: float
    comments: list


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict
    body: bytes


def extract_media_urls(text: str) -> list:
    """The images an issue text shows, in order, without repeats. Same rules as extractMediaUrls in media.ts."""
    found = []
    for pattern in (MARKDOWN_IMAGE, HTML_IMAGE, ATTACHMENT_LINK, FIRST_PARTY_LINK):
        found += [(m.start(), m.group(1)) for m in pattern.finditer(text)]
    return list(dict.fromkeys(url for _, url in sorted(found, key=lambda hit: hit[0])))


def _parse_https(raw: str):
    try:
        url = urlsplit(raw)
        plain = url.scheme == "https" and url.port is None and url.username is None and url.password is None
    except ValueError:
        return None
    return url if plain else None


def plain_url(raw: str) -> str:
    url = urlsplit(raw)
    return f"{url.scheme}://{url.hostname}{url.path or '/'}"


def first_party_source(raw: str) -> bool:
    url = _parse_https(raw)
    return url is not None and url.hostname == FIRST_PARTY_HOST and not url.query and not url.fragment and bool(FIRST_PARTY_PATH.match(url.path))


def allowed_source(raw: str) -> bool:
    if first_party_source(raw):
        return True
    url = _parse_https(raw)
    return url is not None and url.hostname in SOURCE_HOSTS and any(path.match(url.path) for path in SOURCE_PATHS)


def detect_type(data: bytes) -> Optional[str]:
    if data[:8] == bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]):
        return "png"
    if data[:3] == bytes([0xFF, 0xD8, 0xFF]):
        return "jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _jpeg_size(data: bytes):
    at = 2
    while at + 9 < len(data):
        if data[at] != 0xFF:
            return None
        marker = data[at + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(data[at + 7:at + 9], "big"), int.from_bytes(data[at + 5:at + 7], "big")
        at += 2 + int.from_bytes(data[at + 2:at + 4], "big")
    return None


def image_size(data: bytes, kind: str):
    """(width, height) from the header, or None. WebP gets a length check only, as in media.ts."""
    if kind == "png":
        return (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")) if len(data) >= 24 and data[12:16] == b"IHDR" else None
    if kind == "gif":
        return (int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")) if len(data) >= 10 else None
    if kind == "jpeg":
        return _jpeg_size(data)
    return (1, 1) if len(data) >= 30 else None


def _checked_hop(url: str, first_party: bool) -> str:
    target = _parse_https(url)
    host = target.hostname if target else "an invalid URL"
    if first_party:
        if target is None or not first_party_source(url):
            raise ValueError(f"it redirects to {host}, which is not an allowed first-party image")
    elif target is None or target.hostname not in REDIRECT_HOSTS:
        raise ValueError(f"it redirects to {host}, which is not a GitHub attachment host")
    return url


def download(fetch: Callable, start: str, token: Callable) -> bytes:
    """Follows redirects by hand, so every hop is checked before a request goes out, as download in media.ts does."""
    url = start
    first_party = first_party_source(start)
    for hop in range(MAX_HOPS + 1):
        target = _checked_hop(url, first_party)
        headers = {}
        if hop == 0 and urlsplit(target).hostname == TOKEN_HOST:
            bearer = token()
            if bearer:
                headers["Authorization"] = f"Bearer {bearer}"
        res = fetch(target, headers, TIMEOUT_SECONDS)
        location = res.headers.get("location")
        if 300 <= res.status < 400 and location:
            url = urljoin(target, location)
            continue
        if not 200 <= res.status < 300:
            raise ValueError(f"{urlsplit(url).hostname} answered HTTP {res.status}")
        if len(res.body) > MAX_BYTES:
            raise ValueError(f"it is over the {MAX_BYTES} byte limit")
        return res.body
    raise ValueError(f"it redirects more than {MAX_HOPS} times")


def check_image(fetch: Callable, raw: str, token: Callable) -> None:
    """Raises ValueError with the reason when the factory could not use the image."""
    data = download(fetch, raw, token)
    kind = detect_type(data)
    if kind is None:
        raise ValueError("it is not a PNG, JPEG, GIF or WebP image")
    size = image_size(data, kind)
    if size is None or not all(1 <= side <= MAX_SIDE for side in size):
        raise ValueError(f"it does not decode as a {kind} image")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def urllib_fetch(url: str, headers: dict, timeout: float) -> Response:
    """One request that follows no redirect. The body stops one byte past the limit, so an oversize file is seen without being read."""
    try:
        with _OPENER.open(urllib.request.Request(url, headers=headers), timeout=timeout) as res:
            return Response(res.status, {k.lower(): v for k, v in res.headers.items()}, res.read(MAX_BYTES + 1))
    except HTTPError as error:
        return Response(error.code, {k.lower(): v for k, v in error.headers.items()}, b"")


def _timestamp(raw: str) -> float:
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()


def _json_values(text: str) -> list:
    decoder, at, values = json.JSONDecoder(), 0, []
    while True:
        at = len(text) - len(text[at:].lstrip())
        if at >= len(text):
            return values
        value, at = decoder.raw_decode(text, at)
        values.append(value)


def _gh(run, args: list) -> str:
    done = run(["gh", *args], capture_output=True, text=True)
    if done.returncode != 0:
        raise ReadinessError(f"gh {' '.join(args[:2])} failed: {done.stderr.strip()}")
    return done.stdout


def github_issue_view(repo: str, run=subprocess.run) -> Callable:
    def view(issue: int) -> IssueView:
        head = json.loads(_gh(run, ["api", f"repos/{repo}/issues/{issue}"]))
        rows = _json_values(_gh(run, ["api", "--paginate", f"repos/{repo}/issues/{issue}/comments", "--jq", ".[] | {login: .user.login, body: .body, created_at: .created_at}"]))
        comments = [Comment(row["login"], row["body"] or "", _timestamp(row["created_at"])) for row in rows]
        return IssueView(head["body"] or "", _timestamp(head["updated_at"]), comments)

    return view


def github_token(run=subprocess.run) -> Callable:
    def token() -> Optional[str]:
        return _gh(run, ["auth", "token"]).strip() or None

    return token


@dataclass(frozen=True)
class Readiness:
    """`pending` holds the attachments of Telegram replies to each approval post. Hermes keeps them in its cache, so they reach the issue only when a member uploads them."""
    min_words: int
    pending: Path
    view: Callable
    token: Callable
    fetch: Callable = urllib_fetch
    now: Callable = time.time

    def _read(self) -> list:
        return json.loads(self.pending.read_text()) if self.pending.is_file() else []

    def _write(self, rows: list) -> None:
        self.pending.parent.mkdir(parents=True, exist_ok=True)
        self.pending.write_text(json.dumps(rows))

    def record_attachments(self, post: int, count: int) -> None:
        with _LOCK:
            self._write(self._read() + [{"post": post, "count": count, "at": self.now()}])

    def settle(self, post: int) -> None:
        with _LOCK:
            self._write([row for row in self._read() if row["post"] != post])

    def problems(self, issue: int, post: int, text: str) -> list:
        """What a patch or a redesign of this issue still lacks. Empty means ready. Raises ReadinessError when GitHub cannot be read."""
        found = []
        if len(text.split()) < self.min_words:
            found.append(f"The text is too short to name what to change. Write at least {self.min_words} words and quote the member.")
        view = self.view(issue)
        found += self._attachment_problems(issue, post, view)
        found += self._text_link_problems(issue, text, view)
        found += self._issue_media_problems(issue, view)
        return found

    def _attachment_problems(self, issue: int, post: int, view: IssueView) -> list:
        rows = [row for row in self._read() if row["post"] == post]
        if not rows:
            return []
        needed, since = sum(row["count"] for row in rows), min(row["at"] for row in rows)
        have = sum(len(extract_media_urls(c.body)) for c in view.comments if c.created_at >= since)
        have += len(extract_media_urls(view.body)) if view.updated_at >= since else 0
        if have >= needed:
            return []
        return [
            f"The member sent {needed} image(s) or file(s) in Telegram, and {have} of them reached issue #{issue}. "
            f"Telegram files stay in your cache and no tool of yours can put them on the issue. "
            f"Ask the member to upload them as a comment on issue #{issue} on GitHub."
        ]

    def _text_link_problems(self, issue: int, text: str, view: IssueView) -> list:
        on_issue = {plain_url(url) for source in [view.body, *(c.body for c in view.comments)] for url in extract_media_urls(source)}
        found = []
        for url in dict.fromkeys(extract_media_urls(text) + [m.group(0) for m in BARE_IMAGE_LINK.finditer(text)]):
            if _parse_https(url) is not None and plain_url(url) in on_issue:
                continue
            if allowed_source(url):
                found.append(f"The text links {plain_url(url)}, which is not on issue #{issue}. Post that link as a comment on the issue with gh, then route again.")
            else:
                found.append(f"The text links {plain_url(url)}, which the factory cannot fetch. Ask the member to upload the image to issue #{issue} on GitHub.")
        return found

    def _issue_media_problems(self, issue: int, view: IssueView) -> list:
        urls = list(dict.fromkeys(url for text in [view.body, *(c.body for c in view.comments)] for url in extract_media_urls(text)))
        found = [f"Issue #{issue} shows {len(urls)} images, and the factory reads at most {MAX_FILES}. Ask the member which to keep."] if len(urls) > MAX_FILES else []
        for url in urls[:MAX_FILES]:
            if not allowed_source(url):
                found.append(f"Issue #{issue} shows {plain_url(url)}, which the factory cannot fetch. Ask the member to upload the image to the issue on GitHub.")
                continue
            try:
                check_image(self.fetch, url, self.token)
            except (OSError, ValueError) as error:
                found.append(f"Issue #{issue} shows {plain_url(url)}, which the factory cannot download: {error}. Ask the member to upload it again on the issue.")
        return found


_LOCK = threading.Lock()


def refusal(problems: list) -> str:
    """The text Hermes or the member reads when a patch or a redesign is not ready. Nothing was queued."""
    return "Nothing was queued. The issue lacks what the next stage needs:\n" + "\n".join(f"- {p}" for p in problems) + "\nGet these from the member, then route again."
