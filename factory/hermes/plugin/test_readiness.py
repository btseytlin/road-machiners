import asyncio
import json
import re
import types
from pathlib import Path

from test_route import SESSION, Adapter, make_readiness, plugin, readiness

MEDIA_TS = (Path(__file__).parents[2] / "src" / "media.ts").read_text()
REPLY_MEDIA_TS = (Path(__file__).parents[2] / "src" / "reply-media.ts").read_text()
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (64).to_bytes(4, "big") + (48).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00"
TEXT = "Delete the middle dot from the inventory header."


def test_limits_and_folder_match_the_factory():
    assert int(re.search(r"MAX_FILES = (\d+)", MEDIA_TS).group(1)) == readiness.MAX_FILES
    assert re.search(r"MAX_BYTES = 10 \* 1024 \* 1024", MEDIA_TS) and readiness.MAX_BYTES == 10 * 1024 * 1024
    assert "join(home, 'inbox', 'media', `post-${post}`)" in REPLY_MEDIA_TS
    assert readiness.post_media_dir("/home/inbox", 55) == Path("/home/inbox/media/post-55")


def refusal_of(result):
    answer = json.loads(result)
    assert "error" in answer, answer
    assert "Nothing was queued" in answer["error"]
    return answer["error"]


def commands(inbox):
    return [json.loads(p.read_text()) for p in sorted(inbox.glob("*.json"))]


def hook_setup(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "state.json").write_text('{"approvalPosts": {"55": 12}}')
    (tmp_path / "inbox").mkdir()
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id="1", user_name="Ann", chat_id="-100", platform="telegram")
    ready = make_readiness(tmp_path)
    hook = plugin.make_hook(cfg, ready)

    def send(text, media=(), message_id="5"):
        event = types.SimpleNamespace(text=text, reply_to_message_id="55", source=source, message_id=message_id, media_urls=list(media))
        return asyncio.run(hook(event, gateway, None))

    route = plugin.make_route_handler(cfg, ready, session_env=lambda key: SESSION[key])
    return send, route, adapter, tmp_path / "inbox"


def cached_image(tmp_path, name="img_1.png", data=PNG):
    path = tmp_path / "cache" / name
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(data)
    return str(path)


def test_a_routed_text_patch_queues_with_a_telegram_image_that_is_not_on_the_issue(tmp_path):
    send, route, _, inbox = hook_setup(tmp_path)
    assert send("remove the dot please", [cached_image(tmp_path)])["action"] == "rewrite"
    assert json.loads(route({"post": 55, "route": "patch", "text": TEXT}))["success"] is True
    assert [c["kind"] for c in commands(inbox)] == ["reply", "route"]
    saved = inbox / "media" / "post-55" / "5-1.png"
    assert saved.read_bytes() == PNG
    assert saved.stat().st_mode & 0o777 == 0o640


def test_a_forced_patch_with_an_image_queues_and_keeps_the_image(tmp_path):
    send, _, adapter, inbox = hook_setup(tmp_path)
    assert send(f"patch: {TEXT}", [cached_image(tmp_path)]) == {"action": "skip", "reason": "factory-patch"}
    assert adapter.sent == []
    assert [c["kind"] for c in commands(inbox)] == ["patch"]
    assert (inbox / "media" / "post-55" / "5-1.png").is_file()


def test_an_image_that_cannot_be_kept_is_noted_and_the_patch_still_queues(tmp_path):
    send, _, adapter, inbox = hook_setup(tmp_path)
    big = cached_image(tmp_path, "big.png", b"\0" * (readiness.MAX_BYTES + 1))
    result = send(f"redesign: {TEXT}", [str(tmp_path / "cache" / "gone.jpg"), "https://api.telegram.org/file/x.jpg", big])
    assert result == {"action": "skip", "reason": "factory-redesign"}
    assert adapter.sent == []
    folder = inbox / "media" / "post-55"
    assert sorted(p.name for p in folder.iterdir()) == ["5-1.skipped", "5-2.skipped", "5-3.skipped"]
    assert "no longer in Hermes's cache" in (folder / "5-1.skipped").read_text()
    assert "no local file" in (folder / "5-2.skipped").read_text()
    assert "byte limit" in (folder / "5-3.skipped").read_text()
    assert [c["kind"] for c in commands(inbox)] == ["redesign"]


def test_a_post_keeps_at_most_the_files_the_factory_reads(tmp_path):
    ready = make_readiness(tmp_path)
    image = cached_image(tmp_path)
    assert ready.save_attachments(55, 5, [image] * (readiness.MAX_FILES + 1)) == [f"the post already holds {readiness.MAX_FILES} files"]
    folder = tmp_path / "inbox" / "media" / "post-55"
    assert len(list(folder.glob("*.png"))) == readiness.MAX_FILES
    assert (folder / f"5-{readiness.MAX_FILES + 1}.skipped").is_file()


def test_a_folder_that_cannot_be_made_never_stops_the_reply(tmp_path):
    (tmp_path / "inbox").write_text("not a folder")
    assert len(make_readiness(tmp_path).save_attachments(55, 5, ["/a.png", "/b.png"])) == 2


def test_a_text_only_patch_queues(tmp_path):
    send, route, _, inbox = hook_setup(tmp_path)
    assert json.loads(route({"post": 55, "route": "redesign", "text": TEXT}))["success"] is True
    assert send(f"patch: {TEXT}") == {"action": "skip", "reason": "factory-patch"}
    assert sorted(c["kind"] for c in commands(inbox)) == ["patch", "route"]
    assert not (inbox / "media").exists()


def test_a_short_text_is_still_refused(tmp_path):
    send, route, adapter, inbox = hook_setup(tmp_path)
    assert "at least 3 words" in refusal_of(route({"post": 55, "route": "patch", "text": "nicer"}))
    assert send("redesign: nicer", [cached_image(tmp_path)])["reason"] == "factory-not-ready"
    assert "at least 3 words" in adapter.sent[0]
    assert commands(inbox) == []
    # The image waits for a later route of the same post.
    assert (inbox / "media" / "post-55" / "5-1.png").is_file()


def test_an_answer_needs_no_word_count(tmp_path):
    _, route, _, inbox = hook_setup(tmp_path)
    assert json.loads(route({"post": 55, "route": "answer", "text": "Why?"}))["success"] is True
    assert len(commands(inbox)) == 1
