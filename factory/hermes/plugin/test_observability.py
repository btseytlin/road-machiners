import importlib.util
import json
from pathlib import Path

import pytest


def load_reporter():
    path = Path(__file__).with_name('observability.py')
    assert path.exists(), 'manager reporter is missing'
    spec = importlib.util.spec_from_file_location('factory_observation_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ManagerReporter


def test_records_safe_activity_without_chat_or_tool_arguments(tmp_path):
    reporter = load_reporter()(home=tmp_path, heartbeat_ms=10000)
    reporter.start_turn(session_id='private-session', user_message='PRIVATE chat')
    reporter.start_tool(session_id='private-session', tool_name='terminal', args={'command': 'PRIVATE secret'})
    value = json.loads((tmp_path / 'observations' / 'manager.json').read_text())
    assert value['data']['activity'] == 'command'
    assert value['data']['phase'] == 'running'
    assert 'PRIVATE' not in json.dumps(value)
    assert 'private-session' not in json.dumps(value)


def test_old_session_completion_does_not_clear_another_session(tmp_path):
    reporter = load_reporter()(home=tmp_path, heartbeat_ms=10000)
    reporter.start_turn(session_id='a')
    reporter.start_turn(session_id='b')
    reporter.finish_turn(session_id='a', completed=True)
    value = json.loads((tmp_path / 'observations' / 'manager.json').read_text())
    assert value['data']['phase'] == 'running'
    assert value['data']['active'] == 1
    reporter.finish_turn(session_id='b', completed=True)
    value = json.loads((tmp_path / 'observations' / 'manager.json').read_text())
    assert value['data']['phase'] == 'completed'
    assert value['data']['active'] == 0


def test_intent_survives_tool_and_model_activity_until_turn_completion(tmp_path):
    reporter = load_reporter()(home=tmp_path, heartbeat_ms=10000)
    reporter.start_turn(session_id='a')
    reporter.report_intent({'activity': 'investigate'}, session_id='a')
    reporter.finish_tool(session_id='a')
    reporter.start_tool(session_id='a', tool_name='terminal')
    value = json.loads((tmp_path / 'observations' / 'manager.json').read_text())
    assert value['data']['activity'] == 'command'
    assert value['data']['intent'] == 'investigate'
    reporter.finish_turn(session_id='a', completed=True)
    value = json.loads((tmp_path / 'observations' / 'manager.json').read_text())
    assert value['data']['intent'] is None


def test_status_tool_rejects_free_text_and_untracked_sessions(tmp_path):
    reporter = load_reporter()(home=tmp_path, heartbeat_ms=10000)
    with pytest.raises(ValueError):
        reporter.report_intent({'activity': 'PRIVATE note'}, session_id='a')
    with pytest.raises(ValueError):
        reporter.report_intent({'activity': 'investigate'}, session_id='missing')
