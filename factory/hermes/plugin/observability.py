"""Publish manager activity without conversation or command contents."""

import atexit
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

ACTIVITIES = {'reading', 'editing', 'command', 'model', 'review', 'investigate', 'waiting', 'git', 'finished'}
TOOL_ACTIVITIES = {'terminal': 'command', 'read_file': 'reading', 'search_files': 'reading', 'write_file': 'editing', 'patch': 'editing', 'delegate_task': 'waiting', 'factory_route_reply': 'git', 'factory_queue_change': 'git', 'factory_queue_task': 'git'}


def read_session_key(fields):
    key = fields.get('session_id') or fields.get('task_id')
    if not isinstance(key, str) or not key:
        raise ValueError('Manager observation has no session identity')
    return key


class ManagerReporter:
    def __init__(self, *, home: Path, heartbeat_ms: float):
        if heartbeat_ms <= 0:
            raise ValueError('Invalid manager heartbeat interval')
        self.home = home
        self.interval = heartbeat_ms / 1000
        self.lock = threading.RLock()
        self.active = {}
        self.intents = {}
        self.previous = None
        self.stopped = threading.Event()

    def start_heartbeat(self):
        threading.Thread(target=self.run_heartbeat, name='factory-observation', daemon=True).start()
        atexit.register(self.stopped.set)

    def run_heartbeat(self):
        while not self.stopped.wait(self.interval):
            try:
                with self.lock:
                    self.write_status()
            except Exception:
                logging.exception('Factory manager observation failed')

    def write_status(self):
        now = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        key = next(reversed(self.active), None)
        activity = self.active.get(key, 'finished')
        data = {'type': 'manager', 'activity': activity, 'intent': self.intents.get(key), 'phase': 'running' if self.active else 'completed', 'issue': None, 'active': len(self.active)}
        since = self.previous['since'] if self.previous and self.previous['data'] == data else now
        record = {'kind': 'observation', 'producer': 'manager', 'at': now, 'since': since, 'data': data}
        directory = self.home / 'observations'
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / f'manager.{os.getpid()}.tmp'
        temporary.write_text(json.dumps(record))
        temporary.chmod(0o600)
        temporary.replace(directory / 'manager.json')
        self.previous = record

    def start_turn(self, **kwargs):
        with self.lock:
            self.active[read_session_key(kwargs)] = 'model'
            self.write_status()

    def start_tool(self, **kwargs):
        with self.lock:
            self.active[read_session_key(kwargs)] = TOOL_ACTIVITIES.get(kwargs.get('tool_name'), 'command')
            self.write_status()

    def finish_tool(self, **kwargs):
        self.start_turn(**kwargs)

    def finish_turn(self, **kwargs):
        with self.lock:
            key = read_session_key(kwargs)
            self.active.pop(key, None)
            self.intents.pop(key, None)
            self.write_status()

    def report_intent(self, args, **kwargs):
        activity = args.get('activity')
        if activity not in ACTIVITIES or set(args) != {'activity'}:
            raise ValueError('Use one allowed activity without notes')
        with self.lock:
            key = read_session_key(kwargs)
            if key not in self.active:
                raise ValueError('Manager session is not active')
            self.intents[key] = activity
            self.write_status()
        return json.dumps({'reported': True})


def register_observation(ctx, *, home: Path, heartbeat_ms: float):
    reporter = ManagerReporter(home=home, heartbeat_ms=heartbeat_ms)
    ctx.register_hook('pre_llm_call', reporter.start_turn)
    ctx.register_hook('pre_api_request', reporter.start_turn)
    ctx.register_hook('pre_tool_call', reporter.start_tool)
    ctx.register_hook('post_tool_call', reporter.finish_tool)
    ctx.register_hook('on_session_end', reporter.finish_turn)
    ctx.register_hook('on_session_finalize', reporter.finish_turn)
    ctx.register_tool(name='factory_report_activity', toolset='factory', schema={
        'name': 'factory_report_activity',
        'description': 'Report a change of activity. Do not send conversation text or commands.',
        'parameters': {'type': 'object', 'properties': {'activity': {'type': 'string', 'enum': sorted(ACTIVITIES)}}, 'required': ['activity'], 'additionalProperties': False},
    }, handler=reporter.report_intent)
    reporter.start_heartbeat()
