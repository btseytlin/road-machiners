import importlib.util
import io
from pathlib import Path

import pytest


def load_status():
    path = Path(__file__).with_name('status.py')
    spec = importlib.util.spec_from_file_location('factory_status_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_returns_the_dashboard_json_unchanged(monkeypatch):
    module = load_status()
    payload = b'{"generatedAt":"now", "operations":{"status":"stale","value":{"status":"paused"}}, "futureField":123}'
    calls = []

    def fetch_status(request, *, timeout):
        calls.append((request.full_url, sorted(request.header_items()), timeout))
        return io.BytesIO(payload)

    monkeypatch.setattr(module, 'urlopen', fetch_status)
    read_status = module.create_status_handler(public_url='https://example.org', timeout_seconds=10)
    assert read_status({}) == payload.decode()
    assert calls == [('https://example.org/factory/api/snapshot', [
        ('Accept', 'application/json'), ('Cache-control', 'no-cache'), ('User-agent', 'curl/8.0'),
    ], 10)]


def test_unavailable_endpoint_is_an_error_without_a_second_status_source(monkeypatch):
    module = load_status()

    def fail_request(*args, **kwargs):
        raise TimeoutError('status request timed out')

    monkeypatch.setattr(module, 'urlopen', fail_request)
    read_status = module.create_status_handler(public_url='https://example.org', timeout_seconds=10)
    with pytest.raises(TimeoutError):
        read_status({})
    with pytest.raises(ValueError):
        read_status({'command': 'anything'})


@pytest.mark.parametrize('payload', [b'not json', b'[]'])
def test_rejects_invalid_status_json(monkeypatch, payload):
    module = load_status()
    monkeypatch.setattr(module, 'urlopen', lambda *args, **kwargs: io.BytesIO(payload))
    with pytest.raises(ValueError):
        module.create_status_handler(public_url='https://example.org', timeout_seconds=10)({})
