import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

plugin_dir = Path(__file__).parent
spec = importlib.util.spec_from_file_location("factory_plugin_buttons", plugin_dir / "__init__.py", submodule_search_locations=[str(plugin_dir)])
plugin = importlib.util.module_from_spec(spec)
sys.modules["factory_plugin_buttons"] = plugin
spec.loader.exec_module(plugin)


class FakeCommittee:
    def is_member(self, telegram):
        return str(telegram) == "7"


class FakeQuery:
    def __init__(self, data, user_id=7, name="Ann Lee", fail=False):
        self.data = data
        self.from_user = SimpleNamespace(id=user_id, full_name=name)
        self.message = SimpleNamespace(message_id=55, chat=SimpleNamespace(id=-100))
        self.answers = []
        self.markups = []
        self.fail = fail

    async def answer(self, text=None):
        if self.fail:
            raise RuntimeError("boom")
        self.answers.append(text)

    async def edit_message_reply_markup(self, reply_markup=None):
        if self.fail:
            raise RuntimeError("boom")
        self.markups.append(reply_markup)


def press(tmp_path, query, state=None):
    state_dir = tmp_path / "state"
    state_dir.mkdir(exist_ok=True)
    if state is not None:
        (state_dir / "state.json").write_text(json.dumps(state))
    cfg = plugin.Config(str(tmp_path), str(state_dir), "-100", FakeCommittee())
    handler = plugin.make_button_handler(cfg)
    asyncio.run(handler(SimpleNamespace(callback_query=query), None))
    return [json.loads(f.read_text()) for f in sorted(tmp_path.glob("*.json"))]


def test_parse_button():
    assert plugin.parse_button("factory:approve:12") == ("approve", 12)
    assert plugin.parse_button("factory:deny:3") == ("deny", 3)
    assert plugin.parse_button("factory:ship:40") == ("ship", 40)
    for bad in ("factory:approve:", "factory:merge:1", "factory:approve:1x", "xfactory:approve:1", "factory:approve:1\n", None):
        assert plugin.parse_button(bad) is None


def test_pattern_scopes_core_buttons():
    import re
    assert re.match(plugin.BUTTON_PATTERN, "factory:approve:12")
    assert re.match(plugin.BUTTON_PATTERN, "factory:ship:12")
    assert not re.match(plugin.BUTTON_PATTERN, "ea:once:12")
    assert not re.match(plugin.BUTTON_PATTERN, "factory:approve:x")


def test_member_approve_writes_command_and_clears_markup(tmp_path):
    query = FakeQuery("factory:approve:12")
    assert press(tmp_path, query) == [{
        "kind": "approve", "issue": 12, "text": None, "by": "7", "byName": "Ann Lee", "chat": "-100", "messageId": 55, "postId": 55,
    }]
    assert query.answers == ["Approve queued"]
    assert query.markups == [None]


def test_waste_review_button_queues_its_change(tmp_path):
    query = FakeQuery("factory:waste:301")
    assert press(tmp_path, query) == [{
        "kind": "waste-change", "issue": 301, "text": None, "by": "7", "byName": "Ann Lee", "chat": "-100", "messageId": 55, "postId": 55,
    }]
    assert query.answers == ["Change queued"]
    assert query.markups == [None]


def test_member_deny(tmp_path):
    query = FakeQuery("factory:deny:9")
    commands = press(tmp_path, query)
    assert commands[0]["kind"] == "deny" and commands[0]["issue"] == 9
    assert query.answers == ["Deny queued"]


def release_state(post_id):
    return {"approvalPosts": {}, "release": {"issue": 40, "branch": "release/d", "day": "d", "postId": post_id, "removed": []}}


def test_ship_on_current_post_queues(tmp_path):
    query = FakeQuery("factory:ship:40")
    commands = press(tmp_path, query, release_state(55))
    assert [(c["kind"], c["issue"], c["messageId"]) for c in commands] == [("ship", 40, 55)]
    assert query.answers == ["Ship queued"]
    assert query.markups == [None]


@pytest.mark.parametrize("state", [release_state(54), release_state(None), {"approvalPosts": {}, "release": None}, {"approvalPosts": {}}, None])
def test_ship_on_stale_post_queues_nothing(tmp_path, state):
    query = FakeQuery("factory:ship:40")
    assert press(tmp_path, query, state) == []
    assert query.answers == [plugin.BUTTON_STALE]
    assert query.markups == []


def test_ship_by_non_member_is_refused(tmp_path):
    query = FakeQuery("factory:ship:40", user_id=8)
    assert press(tmp_path, query, release_state(55)) == []
    assert query.answers == [plugin.BUTTON_REFUSED]


def test_non_member_is_refused(tmp_path):
    query = FakeQuery("factory:approve:12", user_id=8)
    assert press(tmp_path, query) == []
    assert query.answers == [plugin.BUTTON_REFUSED]
    assert query.markups == []


def test_bad_data_is_ignored(tmp_path):
    query = FakeQuery("factory:approve:x")
    assert press(tmp_path, query) == []
    assert query.answers == [] and query.markups == []


def test_toast_and_markup_errors_keep_the_command(tmp_path):
    query = FakeQuery("factory:approve:12", fail=True)
    assert len(press(tmp_path, query)) == 1


def test_factory_registers_scoped_handler(monkeypatch):
    added = []
    telegram = SimpleNamespace()
    ext = SimpleNamespace(CallbackQueryHandler=lambda callback, pattern: ("cqh", callback, pattern))
    monkeypatch.setitem(sys.modules, "telegram", telegram)
    monkeypatch.setitem(sys.modules, "telegram.ext", ext)
    cfg = plugin.Config("/inbox", "/state", "-100", FakeCommittee())
    plugin.make_button_factory(cfg)(SimpleNamespace(add_handler=added.append), None)
    assert added[0][0] == "cqh" and added[0][2] == plugin.BUTTON_PATTERN
