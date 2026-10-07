"""What a patch or a redesign needs before it queues, and the member's Telegram files that come with it. No Hermes imports.

A patch or a redesign needs only text that names what to change. Images never gate it.
Hermes keeps a member's Telegram files in its cache, where the factory cannot read them, so the hook copies them,
best effort, into the inbox's media folder under the approval post. The tick hands them to the agent when it routes the post,
and checks each one itself. A file the plugin cannot copy leaves a `.skipped` note with the reason, which the agent sees as not available.
"""

import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

# The same limits as factory/src/media.ts. test_readiness.py compares them with that file.
MAX_FILES = 12
MAX_BYTES = 10 * 1024 * 1024
SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
log = logging.getLogger(__name__)


def post_media_dir(inbox: str, post: int) -> Path:
    """Where the files of the replies to one approval post wait. factory/src/reply-media.ts reads the same path."""
    return Path(inbox) / "media" / f"post-{post}"


@dataclass(frozen=True)
class Readiness:
    min_words: int
    inbox: str

    def problems(self, text: str) -> list:
        """What a patch or a redesign still lacks. Empty means it queues."""
        if len(text.split()) < self.min_words:
            return [f"The text is too short to name what to change. Write at least {self.min_words} words and quote the member."]
        return []

    def save_attachments(self, post: int, message: int, paths: list) -> list:
        """Copies each Telegram file into the post's folder. Never raises, since a lost file must not stop the route. Returns the reasons of the skipped ones."""
        skipped = []
        try:
            folder = post_media_dir(self.inbox, post)
            folder.mkdir(parents=True, exist_ok=True)
            taken = len([p for p in folder.iterdir() if not p.name.endswith(".tmp")])
        except OSError as error:
            log.warning("Factory could not keep the files of a reply to post %s: %s", post, error)
            return [str(error)] * len(paths)
        for index, raw in enumerate(paths):
            name = f"{message}-{index + 1}"
            reason = None if taken < MAX_FILES else f"the post already holds {MAX_FILES} files"
            try:
                if reason is None:
                    reason = _copy(str(raw), folder, name)
                if reason is not None:
                    _write(folder / f"{name}.skipped", reason.encode())
            except OSError as error:
                reason = str(error)
            if reason is not None:
                log.warning("Factory skipped file %s of a reply to post %s: %s", index + 1, post, reason)
                skipped.append(reason)
            taken += 1
        return skipped


def _copy(source: str, folder: Path, name: str):
    """Copies one local file, or returns why it was not taken. The factory checks the bytes, so only the size is checked here."""
    path = Path(source)
    if "://" in source or not path.is_absolute():
        return "Telegram gave no local file for it"
    if not path.is_file():
        return "the file is no longer in Hermes's cache"
    if path.stat().st_size > MAX_BYTES:
        return f"it is over the {MAX_BYTES} byte limit"
    suffix = path.suffix.lower() if path.suffix.lower() in SUFFIXES else ".bin"
    temp = folder / f"{name}{suffix}.tmp"
    shutil.copyfile(path, temp)
    os.chmod(temp, 0o640)
    os.replace(temp, folder / f"{name}{suffix}")
    return None


def _write(path: Path, data: bytes) -> None:
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(data)
    os.chmod(temp, 0o640)
    os.replace(temp, path)


def refusal(problems: list) -> str:
    """The text Hermes or the member reads when a patch or a redesign is refused. Nothing was queued."""
    return "Nothing was queued:\n" + "\n".join(f"- {p}" for p in problems) + "\nFix the text, then route again."
