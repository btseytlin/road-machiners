import asyncio
import json
import re
import types
from pathlib import Path

import pytest

from test_route import SESSION, Adapter, make_readiness, plugin, readiness, route_setup

MEDIA_TS = (Path(__file__).parents[2] / "src" / "media.ts").read_text()

UUID = "0f8fad5b-d9cb-469f-a165-70867728950e"
ATTACHMENT = f"https://github.com/user-attachments/assets/{UUID}"
SIGNED = f"https://private-user-images.githubusercontent.com/1/{UUID}.png?jwt=abc"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (64).to_bytes(4, "big") + (48).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00"
TEXT = "Flip the grid icons to top-down."


def serve(routes):
    """A fetch over fixed answers. A url with no answer fails the test. `calls` records each request."""
    calls = []

    def fetch(url, headers, timeout):
        calls.append((url, headers))
        return routes[url]

    fetch.calls = calls
    return fetch


def ok(body=PNG):
    return readiness.Response(200, {}, body)


def issue(body="", comments=(), updated=0.0):
    return readiness.IssueView(body, updated, [readiness.Comment("ann", text, at) for text, at in comments])


def refusal_of(result):
    answer = json.loads(result)
    assert "error" in answer, answer
    assert "Nothing was queued." in answer["error"]
    return answer["error"]


def patch(handle, text=TEXT, route="patch"):
    return handle({"post": 55, "route": route, "text": text})


def test_constants_match_media_ts():
    def ts_list(name):
        return re.findall(r"'([^']+)'", re.search(rf"const {name} = \[(.*?)\];", MEDIA_TS, re.S).group(1))

    assert list(readiness.SOURCE_HOSTS) == ts_list("SOURCE_HOSTS")
    assert list(readiness.REDIRECT_HOSTS[len(readiness.SOURCE_HOSTS):]) == [h for h in ts_list("REDIRECT_HOSTS") if h not in ts_list("SOURCE_HOSTS")]
    assert re.search(r"FIRST_PARTY_HOST = '([^']+)'", MEDIA_TS).group(1) == readiness.FIRST_PARTY_HOST
    assert int(re.search(r"MAX_FILES = (\d+)", MEDIA_TS).group(1)) == readiness.MAX_FILES
    assert int(re.search(r"MAX_HOPS = (\d+)", MEDIA_TS).group(1)) == readiness.MAX_HOPS
    assert int(re.search(r"MAX_SIDE = (\d+)", MEDIA_TS).group(1)) == readiness.MAX_SIDE
    assert re.search(r"MAX_BYTES = 10 \* 1024 \* 1024", MEDIA_TS) and readiness.MAX_BYTES == 10 * 1024 * 1024
    assert int(re.search(r"TIMEOUT_MS = ([\d_]+)", MEDIA_TS).group(1).replace("_", "")) == readiness.TIMEOUT_SECONDS * 1000


def test_patterns_match_media_ts():
    def ts(source):
        return source.replace("\\/", "/")

    def py(pattern):
        return pattern.pattern.replace('\\"', '"')

    assert ts(re.search(r"const FIRST_PARTY_PATH = /(.*)/;", MEDIA_TS).group(1)) == readiness.FIRST_PARTY_PATH.pattern
    paths = re.search(r"const SOURCE_PATHS = \[(.*)\];", MEDIA_TS).group(1)
    assert [ts(p) for p in re.findall(r"/(\^.*?\$)/i?(?:,|$)", paths)] == [p.pattern for p in readiness.SOURCE_PATHS]
    extractors = re.findall(r"add\(/(.*)/[gi]+\);", MEDIA_TS)
    assert [ts(e) for e in extractors] == [py(p) for p in (readiness.MARKDOWN_IMAGE, readiness.HTML_IMAGE, readiness.ATTACHMENT_LINK, readiness.FIRST_PARTY_LINK)]


def test_extract_matches_the_factory_rules():
    text = f"![a]({ATTACHMENT}) <img src=\"{SIGNED}\"> {ATTACHMENT} https://roam-game.online/concepts/van.png ![b](https://i.imgur.com/x.png)"
    assert readiness.extract_media_urls(text) == [ATTACHMENT, SIGNED, "https://roam-game.online/concepts/van.png", "https://i.imgur.com/x.png"]


def test_ready_when_the_issue_and_text_are_complete(tmp_path):
    fetch = serve({ATTACHMENT: ok()})
    inbox, handle = route_setup(tmp_path, view=issue(f"Concept ![c]({ATTACHMENT})"), fetch=fetch)
    assert json.loads(patch(handle))["success"] is True
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text())["route"] == "patch"
    assert [url for url, _ in fetch.calls] == [ATTACHMENT]


def test_a_redirect_to_github_storage_is_followed_and_the_token_goes_to_the_first_hop_only(tmp_path):
    storage = f"https://objects.githubusercontent.com/x/{UUID}"
    fetch = serve({ATTACHMENT: readiness.Response(302, {"location": storage}, b""), storage: ok()})
    ready = make_readiness(tmp_path, view=issue(f"![c]({ATTACHMENT})"), fetch=fetch)
    ready = readiness.Readiness(ready.min_words, ready.pending, ready.view, lambda: "secret", fetch)
    assert ready.problems(12, 55, TEXT) == []
    assert fetch.calls == [(ATTACHMENT, {"Authorization": "Bearer secret"}), (storage, {})]


def test_refuses_a_short_text(tmp_path):
    inbox, handle = route_setup(tmp_path)
    assert "at least 3 words" in refusal_of(patch(handle, "fix it", "redesign"))
    assert list(inbox.iterdir()) == []


def test_refuses_an_issue_image_that_does_not_download(tmp_path):
    inbox, handle = route_setup(tmp_path, view=issue(f"![c]({ATTACHMENT})"), fetch=serve({ATTACHMENT: readiness.Response(403, {}, b"")}))
    assert "HTTP 403" in refusal_of(patch(handle))
    assert list(inbox.iterdir()) == []


def test_refuses_an_issue_image_that_redirects_off_github(tmp_path):
    fetch = serve({ATTACHMENT: readiness.Response(302, {"location": "https://evil.example/x.png"}, b"")})
    _, handle = route_setup(tmp_path, view=issue(f"![c]({ATTACHMENT})"), fetch=fetch)
    assert "not a GitHub attachment host" in refusal_of(patch(handle))


def test_refuses_an_issue_file_that_is_no_image(tmp_path):
    _, handle = route_setup(tmp_path, view=issue(f"![c]({ATTACHMENT})"), fetch=serve({ATTACHMENT: ok(b"<html>sign in</html>")}))
    assert "not a PNG, JPEG, GIF or WebP" in refusal_of(patch(handle))


def test_refuses_an_issue_image_on_an_external_host(tmp_path):
    inbox, handle = route_setup(tmp_path, view=issue("![c](https://i.imgur.com/x.png)"))
    assert "i.imgur.com/x.png, which the factory cannot fetch" in refusal_of(patch(handle))
    assert list(inbox.iterdir()) == []


def test_refuses_more_images_than_the_factory_reads(tmp_path):
    urls = [f"https://github.com/user-attachments/assets/{i:08d}-d9cb-469f-a165-70867728950e" for i in range(readiness.MAX_FILES + 1)]
    _, handle = route_setup(tmp_path, view=issue(" ".join(f"![c]({u})" for u in urls)), fetch=lambda url, headers, timeout: ok())
    assert f"at most {readiness.MAX_FILES}" in refusal_of(patch(handle))


def test_refuses_a_text_link_to_an_external_image(tmp_path):
    _, handle = route_setup(tmp_path)
    assert "https://i.imgur.com/x.png, which the factory cannot fetch" in refusal_of(patch(handle, f"{TEXT} Match https://i.imgur.com/x.png?w=9"))


def test_refuses_a_text_link_to_an_attachment_that_is_not_on_the_issue(tmp_path):
    _, handle = route_setup(tmp_path)
    assert "not on issue #12" in refusal_of(patch(handle, f"{TEXT} See {ATTACHMENT}"))


def test_a_text_link_that_is_on_the_issue_passes(tmp_path):
    _, handle = route_setup(tmp_path, view=issue(f"![c]({ATTACHMENT})"), fetch=serve({ATTACHMENT: ok()}))
    assert json.loads(patch(handle, f"{TEXT} See {ATTACHMENT}"))["success"] is True


def test_refuses_when_github_cannot_be_read(tmp_path):
    def broken(_issue):
        raise readiness.ReadinessError("gh api failed: HTTP 502")

    inbox, handle = route_setup(tmp_path)
    handle = plugin.make_route_handler(plugin.Config(str(inbox), str(tmp_path / "state"), "-100", plugin.Committee(str(tmp_path / "committee"), "1", "boss")), plugin.Readiness(3, tmp_path / "p.json", broken, lambda: None), session_env=lambda key: SESSION[key])
    assert "HTTP 502" in refusal_of(patch(handle))
    assert list(inbox.iterdir()) == []


def test_an_answer_needs_no_readiness(tmp_path):
    inbox, handle = route_setup(tmp_path, view=issue("![c](https://i.imgur.com/x.png)"))
    assert json.loads(patch(handle, "Where is the atlas?", "answer"))["success"] is True
    assert len(list(inbox.iterdir())) == 1


def hook_setup(tmp_path, ready):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "state.json").write_text('{"approvalPosts": {"55": 12}}')
    (tmp_path / "inbox").mkdir()
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id="1", user_name="Ann", chat_id="-100", platform="telegram")
    hook = plugin.make_hook(cfg, ready)

    def send(text, media=(), message_id="5"):
        event = types.SimpleNamespace(text=text, reply_to_message_id="55", source=source, message_id=message_id, media_urls=list(media))
        return asyncio.run(hook(event, gateway, None))

    return send, adapter, tmp_path / "inbox", cfg


def test_a_telegram_image_must_reach_the_issue_before_a_routed_patch(tmp_path):
    ready = make_readiness(tmp_path, view=issue("", [("unrelated", 900.0)]), now=lambda: 1000.0)
    send, _, inbox, cfg = hook_setup(tmp_path, ready)
    assert send("the top-down atlas looks like this", ["/cache/img_1.jpg"])["action"] == "rewrite"
    handle = plugin.make_route_handler(cfg, ready, session_env=lambda key: SESSION[key])
    error = refusal_of(patch(handle))
    assert "sent 1 image(s) or file(s) in Telegram, and 0 of them reached issue #12" in error
    assert len(list(inbox.iterdir())) == 1


def test_a_telegram_image_that_reached_the_issue_lets_the_patch_queue_and_is_settled(tmp_path):
    view = issue("", [(f"![c]({ATTACHMENT})", 1500.0)])
    ready = make_readiness(tmp_path, view=view, fetch=serve({ATTACHMENT: ok()}), now=lambda: 1000.0)
    send, _, inbox, cfg = hook_setup(tmp_path, ready)
    send("the top-down atlas looks like this", ["/cache/img_1.jpg"])
    handle = plugin.make_route_handler(cfg, ready, session_env=lambda key: SESSION[key])
    assert json.loads(patch(handle))["success"] is True
    assert json.loads(ready.pending.read_text()) == []


def test_an_image_posted_before_the_telegram_message_does_not_count(tmp_path):
    ready = make_readiness(tmp_path, view=issue("", [(f"![c]({ATTACHMENT})", 500.0)]), fetch=serve({ATTACHMENT: ok()}), now=lambda: 1000.0)
    send, _, _, cfg = hook_setup(tmp_path, ready)
    send("see the image", ["/cache/img_1.jpg"])
    assert "0 of them reached" in refusal_of(patch(plugin.make_route_handler(cfg, ready, session_env=lambda key: SESSION[key])))


def test_a_forced_patch_with_a_missing_image_is_answered_in_chat_and_queues_nothing(tmp_path):
    send, adapter, inbox, _ = hook_setup(tmp_path, make_readiness(tmp_path))
    result = send(f"patch: {TEXT}", ["/cache/img_1.jpg"])
    assert result == {"action": "skip", "reason": "factory-not-ready"}
    assert "Nothing was queued." in adapter.sent[0] and "Telegram" in adapter.sent[0]
    assert [p for p in inbox.iterdir()] == []


def test_a_forced_redesign_with_a_short_text_is_answered_in_chat(tmp_path):
    send, adapter, inbox, _ = hook_setup(tmp_path, make_readiness(tmp_path))
    assert send("redesign: nicer")["reason"] == "factory-not-ready"
    assert "at least 3 words" in adapter.sent[0]
    assert list(inbox.iterdir()) == []


def test_a_forced_patch_that_is_ready_queues(tmp_path):
    send, adapter, inbox, _ = hook_setup(tmp_path, make_readiness(tmp_path))
    assert send(f"patch: {TEXT}") == {"action": "skip", "reason": "factory-patch"}
    assert adapter.sent == []
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text())["kind"] == "patch"


def test_gh_view_reads_the_issue_and_every_comment_page():
    answers = {
        "repos/o/r/issues/12": json.dumps({"body": "Body", "updated_at": "2026-10-05T10:00:00Z"}),
        "repos/o/r/issues/12/comments": '{"login":"ann","body":"one","created_at":"2026-10-05T11:00:00Z"}\n{"login":"bob","body":null,"created_at":"2026-10-05T12:00:00Z"}\n',
    }

    def run(args, **kwargs):
        (path,) = [a for a in args if a.startswith("repos/")]
        return types.SimpleNamespace(returncode=0, stdout=answers[path], stderr="")

    view = readiness.github_issue_view("o/r", run)(12)
    assert (view.body, [c.body for c in view.comments]) == ("Body", ["one", ""])
    assert view.comments[1].created_at > view.comments[0].created_at > view.updated_at


def test_gh_failure_is_loud():
    run = lambda args, **kwargs: types.SimpleNamespace(returncode=1, stdout="", stderr="bad credentials")
    with pytest.raises(readiness.ReadinessError, match="bad credentials"):
        readiness.github_issue_view("o/r", run)(12)
