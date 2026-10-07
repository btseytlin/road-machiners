import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

plugin_dir = Path(__file__).parent
spec = importlib.util.spec_from_file_location("factory_plugin", plugin_dir / "__init__.py", submodule_search_locations=[str(plugin_dir)])
plugin = importlib.util.module_from_spec(spec)
sys.modules["factory_plugin"] = plugin
spec.loader.exec_module(plugin)

CFG = plugin.Config("/inbox", "/state", "-100", None)
POSTS = {"55": 12}
readiness = sys.modules["factory_plugin.readiness"]


def make_readiness(tmp_path):
    return plugin.Readiness(min_words=3, inbox=str(tmp_path / "inbox"))


def route(text, reply=None, chat="-100"):
    return plugin.route(text, reply, chat, POSTS, CFG)


def test_approve_reply():
    assert route("approve", "55") == ("approve", 12)
    assert route("  Approve \n", "55") == ("approve", 12)


def test_other_reply_goes_to_hermes():
    assert route("make it bigger", "55") == ("reply", 12, "make it bigger")
    assert route("approve it", "55") == ("reply", 12, "approve it")


def test_route_prefix_picks_the_route_itself():
    assert route("patch: make the horn louder", "55") == ("patch", 12, "make the horn louder")
    assert route("  Redesign : use top-down icons\nfor the grid", "55") == ("redesign", 12, "use top-down icons\nfor the grid")
    assert route("patching is fine", "55") == ("reply", 12, "patching is fine")
    assert route("patch: x", "99") is None


def test_reply_to_unknown_post_is_normal_chat():
    assert route("approve", "99") is None


def test_change_request():
    assert route("/change add rain") == ("change", "add rain")
    assert route("/change") is None
    assert route("/changelog") is None








REL = plugin.Release(issue=40, post_id=90)


def rroute(text, reply="90"):
    return plugin.route(text, reply, "-100", POSTS, CFG, REL)


def test_release_ship_reply():
    assert rroute("ship") == ("ship", 40)
    assert rroute("  SHIP \n") == ("ship", 40)


def test_release_remove_reply():
    assert rroute("remove #7") == ("remove", 7, "remove #7")
    assert rroute("Remove 12") == ("remove", 12, "Remove 12")
    assert rroute("remove #12 it crashes on load") == ("remove", 12, "remove #12 it crashes on load")
    assert rroute("  REMOVE 3 too loud\n") == ("remove", 3, "  REMOVE 3 too loud\n")


def test_release_remove_needs_a_word_boundary_after_the_number():
    assert rroute("remove 12abc") == ("release-task", "remove 12abc")


def test_release_other_reply_opens_task():
    assert rroute("add rain") == ("release-task", "add rain")
    assert rroute("remove the fog") == ("release-task", "remove the fog")
    assert rroute("ship it") == ("release-task", "ship it")


def test_release_reply_to_old_or_null_post_is_normal_chat():
    assert rroute("ship", "91") is None
    assert plugin.route("ship", "90", "-100", POSTS, CFG, plugin.Release(40, None)) is None
    assert plugin.route("ship", "90", "-100", POSTS, CFG, None) is None


def test_approval_reply_still_works_with_release():
    assert plugin.route("approve", "55", "-100", POSTS, CFG, REL) == ("approve", 12)


def test_release_reply_in_other_chat_is_normal_chat():
    assert plugin.route("ship", "90", "-200", POSTS, CFG, REL) is None


def test_other_chat_is_normal_chat():
    assert route("approve", "55", chat="-200") is None
    assert route("/change x", chat="-200") is None


def test_ids_compare_as_strings():
    assert plugin.route("approve", 55, -100, POSTS, CFG) == ("approve", 12)


def test_inbox_command_shapes():
    assert plugin.inbox_command(("approve", 12), 1, "Ann", -100, "77", "60") == {
        "kind": "approve", "issue": 12, "text": None, "by": "1", "byName": "Ann", "chat": "-100", "messageId": 77, "postId": 60,
    }
    assert plugin.inbox_command(("reply", 12, "x y"), 1, None, -100, 78, 60) == {
        "kind": "reply", "issue": 12, "text": "x y", "by": "1", "byName": None, "chat": "-100", "messageId": 78, "postId": 60,
    }
    assert plugin.inbox_command(("patch", 12, "x"), 1, None, -100, 78, 60)["kind"] == "patch"
    assert plugin.inbox_command(("redesign", 12, "x"), 1, None, -100, 78, 60)["issue"] == 12
    assert plugin.inbox_command(("change", "z"), 1, "", -100, 79, None) == {
        "kind": "change", "issue": None, "text": "z", "by": "1", "byName": None, "chat": "-100", "messageId": 79, "postId": None,
    }


def test_inbox_command_release_shapes():
    assert plugin.inbox_command(("ship", 40), 1, "Ann", -100, 80, 70) == {
        "kind": "ship", "issue": 40, "text": None, "by": "1", "byName": "Ann", "chat": "-100", "messageId": 80, "postId": 70,
    }
    assert plugin.inbox_command(("remove", 7, "remove #7"), 1, "Ann", -100, 81, 70) == {
        "kind": "remove", "issue": 7, "text": "remove #7", "by": "1", "byName": "Ann", "chat": "-100", "messageId": 81, "postId": 70,
    }
    assert plugin.inbox_command(("release-task", "add rain"), 1, "Ann", -100, 82, 70) == {
        "kind": "release-task", "issue": None, "text": "add rain", "by": "1", "byName": "Ann", "chat": "-100", "messageId": 82, "postId": 70,
    }


def test_write_inbox_is_atomic(tmp_path, monkeypatch):
    seen = []
    real = plugin.os.replace

    def spy(src, dst):
        seen.append((Path(src).name, Path(dst).name, Path(src).exists(), Path(dst).exists()))
        real(src, dst)

    monkeypatch.setattr(plugin.os, "replace", spy)
    command = plugin.inbox_command(("change", "z"), 1, "Ann", -100, 79, None)
    path = plugin.write_inbox(str(tmp_path), command, now_ms=1700000000000)
    assert path.name == "1700000000000-79.json"
    assert json.loads(path.read_text()) == command
    assert seen == [("1700000000000-79.json.tmp", "1700000000000-79.json", True, False)]
    assert [p.name for p in tmp_path.iterdir()] == ["1700000000000-79.json"]


def env(tmp_path):
    return {
        "FACTORY_INBOX": "/in", "FACTORY_STATE_DIR": str(tmp_path / "state"), "FACTORY_COMMITTEE_CHAT": "-100",
        "FACTORY_OBSERVATION_HEARTBEAT_MS": "10000",
        "FACTORY_PUBLIC_URL": "https://example.org", "FACTORY_STATUS_TIMEOUT_MS": "10000",
        "FACTORY_ROUTE_MIN_WORDS": "4", "FACTORY_REPO": "owner/repo",
        "FACTORY_COMMITTEE_DIR": str(tmp_path / "committee"),
        "FACTORY_COMMITTEE_BOOTSTRAP": "1", "FACTORY_COMMITTEE_BOOTSTRAP_GITHUB": "boss",
    }


def test_load_config(tmp_path):
    cfg = plugin.load_config(env(tmp_path))
    assert (cfg.inbox, cfg.state_dir, cfg.chat) == ("/in", str(tmp_path / "state"), "-100")
    assert cfg.committee.bootstrap == "1"


@pytest.mark.parametrize("key", plugin.REQUIRED_KEYS)
def test_load_config_fails_loud(tmp_path, key):
    values = {k: v for k, v in env(tmp_path).items() if k != key}
    with pytest.raises(RuntimeError, match=key):
        plugin.load_config(values)


def test_register_seeds_the_file(tmp_path):
    hooks = []
    ctx = types.SimpleNamespace(register_hook=lambda name, fn: hooks.append(name), register_tool=lambda **kw: None, register_telegram_handler=lambda fn: None)
    plugin_env = env(tmp_path)
    old = plugin.os.environ.copy()
    plugin.os.environ.update(plugin_env)
    try:
        plugin.register(ctx)
    finally:
        plugin.os.environ.clear()
        plugin.os.environ.update(old)
    assert hooks == ["pre_gateway_dispatch", "pre_llm_call", "pre_api_request", "pre_tool_call", "post_tool_call", "on_session_end", "on_session_finalize"]
    data = json.loads((tmp_path / "committee" / "committee.json").read_text())
    assert data == {"members": [{"telegram": "1", "github": "boss", "name": None}]}


def test_read_approval_posts(tmp_path):
    assert plugin.read_approval_posts(str(tmp_path)) == {}
    (tmp_path / "state.json").write_text('{"approvalPosts": {"7": 3}}')
    assert plugin.read_approval_posts(str(tmp_path)) == {"7": 3}


def test_read_state_release(tmp_path):
    assert plugin.read_state(str(tmp_path)) == ({}, None)
    state = tmp_path / "state.json"
    state.write_text('{"approvalPosts": {}}')
    assert plugin.read_state(str(tmp_path)) == ({}, None)
    state.write_text('{"approvalPosts": {}, "release": null}')
    assert plugin.read_state(str(tmp_path)) == ({}, None)
    state.write_text('{"approvalPosts": {"7": 3}, "release": {"issue": 40, "branch": "release/x", "day": "x", "postId": 90, "removed": []}}')
    assert plugin.read_state(str(tmp_path)) == ({"7": 3}, plugin.Release(40, 90))
    state.write_text('{"approvalPosts": {}, "release": {"issue": 40, "postId": null}}')
    assert plugin.read_state(str(tmp_path))[1] == plugin.Release(40, None)


@pytest.mark.parametrize("release", ['"x"', '{}', '{"issue": "4"}', '{"issue": 4, "postId": "9"}', '{"issue": true, "postId": 1}', '[]'])
def test_read_state_malformed_release_raises(tmp_path, release):
    (tmp_path / "state.json").write_text('{"approvalPosts": {}, "release": %s}' % release)
    with pytest.raises(ValueError, match="release"):
        plugin.read_state(str(tmp_path))


class Adapter:
    def __init__(self):
        self.sent = []

    async def send(self, chat_id, text, reply_to=None):
        self.sent.append(text)
        return types.SimpleNamespace(success=True, error=None)


def dispatch(tmp_path, user, text="/change x", chat="-100", monkeypatch=None):
    (tmp_path / "state").mkdir(exist_ok=True)
    (tmp_path / "inbox").mkdir(exist_ok=True)
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id=user, user_name="Ann", chat_id=chat, platform="telegram")
    event = types.SimpleNamespace(text=text, reply_to_message_id=None, source=source, message_id="5")
    result = asyncio.run(plugin.make_hook(cfg, make_readiness(tmp_path))(event, gateway, None))
    return result, adapter, tmp_path / "inbox"


def test_hook_routes_release_reply(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "state.json").write_text('{"approvalPosts": {}, "release": {"issue": 40, "branch": "b", "day": "d", "postId": 90, "removed": []}}')
    (tmp_path / "inbox").mkdir()
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    adapter = Adapter()
    gateway = types.SimpleNamespace(adapters={"telegram": adapter})
    source = types.SimpleNamespace(user_id="1", user_name="Ann", chat_id="-100", platform="telegram")
    event = types.SimpleNamespace(text="ship", reply_to_message_id="90", source=source, message_id="5")
    result = asyncio.run(plugin.make_hook(cfg, make_readiness(tmp_path))(event, gateway, None))
    assert result == {"action": "skip", "reason": "factory-ship"}
    (file,) = (tmp_path / "inbox").iterdir()
    assert json.loads(file.read_text())["issue"] == 40


def test_hook_queues_a_plain_approval_reply_and_hands_it_to_hermes_with_a_header(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "state.json").write_text('{"approvalPosts": {"55": 12}}')
    (tmp_path / "inbox").mkdir()
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    cfg = plugin.Config(str(tmp_path / "inbox"), str(tmp_path / "state"), "-100", committee)
    gateway = types.SimpleNamespace(adapters={"telegram": Adapter()})
    source = types.SimpleNamespace(user_id="1", user_name="Ann", chat_id="-100", platform="telegram")
    event = types.SimpleNamespace(text="show us the top-down atlas", reply_to_message_id="55", source=source, message_id="5")
    result = asyncio.run(plugin.make_hook(cfg, make_readiness(tmp_path))(event, gateway, None))
    assert result["action"] == "rewrite"
    assert result["text"].startswith("[Factory: a committee reply to the approval post 55 of issue #12.")
    assert "factory_route_reply" in result["text"]
    assert result["text"].endswith("\n\nshow us the top-down atlas")
    (file,) = (tmp_path / "inbox").iterdir()
    assert json.loads(file.read_text()) | {} == {
        "kind": "reply", "issue": 12, "text": "show us the top-down atlas", "by": "1", "byName": "Ann", "chat": "-100", "messageId": 5, "postId": 55,
    }


def route_setup(tmp_path, session=None):
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "state.json").write_text('{"approvalPosts": {"55": 12}}')
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    cfg = plugin.Config(str(inbox), str(tmp_path / "state"), "-100", committee)
    values = SESSION if session is None else session
    return inbox, plugin.make_route_handler(cfg, make_readiness(tmp_path), session_env=lambda key: values.get(key, ""))


@pytest.mark.parametrize("route_name", ["answer", "patch", "redesign"])
def test_route_tool_writes_a_route_command_for_an_open_post(tmp_path, route_name):
    inbox, handle = route_setup(tmp_path)
    result = json.loads(handle({"post": 55, "route": route_name, "text": "  Flip the grid icons to top-down.  "}))
    assert result == {"success": True, "message": plugin.ROUTE_DONE[route_name]}
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text()) == {
        "kind": "route", "issue": 12, "text": "Flip the grid icons to top-down.", "route": route_name,
        "by": "1", "byName": "Ann", "chat": "-100", "messageId": 77, "postId": 55,
    }


@pytest.mark.parametrize("args", [
    {"post": 99, "route": "patch", "text": "x"},
    {"post": 55, "route": "ship", "text": "x"},
    {"post": 55, "route": "patch", "text": "  "},
])
def test_route_tool_refuses_a_closed_post_an_unknown_route_or_no_text(tmp_path, args):
    inbox, handle = route_setup(tmp_path)
    assert "error" in json.loads(handle(args))
    assert list(inbox.iterdir()) == []


def test_route_tool_refuses_a_non_member(tmp_path):
    inbox, handle = route_setup(tmp_path, {**SESSION, "HERMES_SESSION_USER_ID": "2"})
    assert "error" in json.loads(handle({"post": 55, "route": "patch", "text": "x"}))
    assert list(inbox.iterdir()) == []


def test_hook_queues_without_a_reply_of_its_own(tmp_path):
    result, adapter, inbox = dispatch(tmp_path, "1")
    assert result == {"action": "skip", "reason": "factory-change"}
    assert adapter.sent == []
    (file,) = inbox.iterdir()
    assert json.loads(file.read_text())["by"] == "1"


@pytest.mark.parametrize("chat", ["-100", "-200"])
@pytest.mark.parametrize("text", ["/change x", "hello", "/committee list", "/committee add 5"])
def test_hook_drops_non_members_silently(tmp_path, chat, text):
    result, adapter, inbox = dispatch(tmp_path, "9", text=text, chat=chat)
    assert result == {"action": "skip", "reason": "factory-not-committee"}
    assert adapter.sent == []
    assert list(inbox.iterdir()) == []
    assert plugin.Committee(str(tmp_path / "committee"), "1", "boss").ids() == frozenset({"1"})


def test_member_plain_chat_in_other_chat_passes(tmp_path):
    result, adapter, _ = dispatch(tmp_path, "1", text="hello", chat="-200")
    assert result is None
    assert adapter.sent == []


def test_committee_list_in_any_chat(tmp_path):
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee list", chat="-200")
    assert result["reason"] == "factory-committee"
    assert "1 github: boss" in adapter.sent[0]


def test_committee_add_schedules_restart(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(plugin, "_schedule_restart", lambda: calls.append(1))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee add 7 bob")
    assert result["reason"] == "factory-committee"
    assert "Added 7" in adapter.sent[0]
    assert calls == [1]
    assert (tmp_path / ".env").read_text() == "TELEGRAM_ALLOWED_USERS=1,7\n"


def test_committee_bad_input_replies_without_restart(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(plugin, "_schedule_restart", lambda: calls.append(1))
    result, adapter, _ = dispatch(tmp_path, "1", text="/committee add abc")
    assert "number" in adapter.sent[0]
    assert calls == []


def test_committee_args():
    assert plugin.committee_args("/committee") == ""
    assert plugin.committee_args(" /committee list ") == "list"
    assert plugin.committee_args("/committeex") is None
    assert plugin.committee_args("hello") is None


def queue_setup(tmp_path, session):
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    cfg = plugin.Config(str(inbox), "/st", "-100", committee)
    return inbox, plugin.make_queue_handler(cfg, session_env=lambda key: session.get(key, ""))


SESSION = {
    "HERMES_SESSION_CHAT_ID": "-100", "HERMES_SESSION_USER_ID": "1",
    "HERMES_SESSION_USER_NAME": "Ann", "HERMES_SESSION_MESSAGE_ID": "77",
}


def test_queue_tool_writes_adhoc_command(tmp_path):
    inbox, handle = queue_setup(tmp_path, SESSION)
    result = json.loads(handle({"request": "  Run npm run combat and report hit rates.  "}))
    assert result["success"] is True
    files = list(inbox.iterdir())
    assert len(files) == 1
    assert json.loads(files[0].read_text()) == {
        "kind": "adhoc", "issue": None, "text": "Run npm run combat and report hit rates.",
        "by": "1", "byName": "Ann", "chat": "-100", "messageId": 77, "postId": None,
    }


def test_change_tool_writes_change_command(tmp_path):
    committee = plugin.Committee(str(tmp_path / "committee"), "1", "boss")
    committee.seed()
    inbox = tmp_path / "inbox"
    inbox.mkdir()
    cfg = plugin.Config(str(inbox), "/st", "-100", committee)
    handle = plugin.make_queue_handler(cfg, session_env=lambda key: SESSION.get(key, ""), kind="change", done=plugin.CHANGE_DONE)
    assert json.loads(handle({"request": "Set FACTORY_TEST_WORKERS to 2."}))["message"] == plugin.CHANGE_DONE
    [path] = list(inbox.iterdir())
    assert json.loads(path.read_text())["kind"] == "change"
    assert json.loads(path.read_text())["text"] == "Set FACTORY_TEST_WORKERS to 2."


def test_change_guidance_asks_for_an_acknowledgment_not_silence():
    assert "[SILENT]" in plugin.CHANGE_DONE
    assert "Never reply with [SILENT]" in plugin.CHANGE_DONE
    assert "Queued for a PR." in plugin.CHANGE_DONE
    assert "Add nothing about it" not in plugin.CHANGE_DONE


def test_queue_tool_refuses_non_member(tmp_path):
    inbox, handle = queue_setup(tmp_path, {**SESSION, "HERMES_SESSION_USER_ID": "2"})
    assert "error" in json.loads(handle({"request": "x"}))
    assert list(inbox.iterdir()) == []


@pytest.mark.parametrize("key", list(SESSION))
def test_queue_tool_refuses_missing_session_value(tmp_path, key):
    inbox, handle = queue_setup(tmp_path, {**SESSION, key: ""})
    assert key in json.loads(handle({"request": "x"}))["error"]
    assert list(inbox.iterdir()) == []


def test_queue_tool_refuses_empty_request(tmp_path):
    inbox, handle = queue_setup(tmp_path, SESSION)
    assert "error" in json.loads(handle({"request": "  "}))
    assert list(inbox.iterdir()) == []


def test_queue_tool_two_calls_make_two_files(tmp_path, monkeypatch):
    inbox, handle = queue_setup(tmp_path, SESSION)
    monkeypatch.setattr(plugin.time, "time", lambda: 1700000000.0)
    handle({"request": "first"})
    handle({"request": "second"})
    texts = sorted(json.loads(p.read_text())["text"] for p in inbox.iterdir())
    assert texts == ["first", "second"]


def test_register_adds_queue_tool(tmp_path, monkeypatch):
    for key, value in env(tmp_path).items():
        monkeypatch.setenv(key, value)
    calls = []
    ctx = types.SimpleNamespace(
        register_hook=lambda *a: None, register_tool=lambda **kw: calls.append(kw), register_telegram_handler=lambda fn: None,
    )
    plugin.register(ctx)
    assert calls[0]["name"] == "factory_queue_task" and calls[0]["toolset"] == "factory"
    assert calls[0]["schema"]["parameters"]["required"] == ["request"]
    assert calls[1]["name"] == "factory_queue_change" and calls[1]["toolset"] == "factory"
    assert calls[2]["name"] == "factory_route_reply" and calls[2]["toolset"] == "factory"
    assert calls[3]["name"] == "factory_status" and calls[3]["toolset"] == "factory"
    assert calls[2]["schema"]["parameters"]["required"] == ["post", "route", "text"]
