"""Read the dashboard snapshot without maintaining another status projection."""

import json
import math
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def create_status_handler(*, public_url: str, timeout_seconds: float):
    url = urlsplit(public_url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        raise ValueError('Factory status requires a public HTTPS origin')
    if url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('Factory status requires an origin without a path or query')
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError('Factory status timeout must be positive')
    endpoint = f'{public_url.rstrip("/")}/factory/api/snapshot'

    def read_status(args: dict, **kwargs) -> str:
        if args:
            raise ValueError('factory_status takes no arguments')
        request = Request(endpoint, headers={'Accept': 'application/json', 'Cache-Control': 'no-cache'})
        with urlopen(request, timeout=timeout_seconds) as response:
            body = response.read().decode('utf-8')
        if not isinstance(json.loads(body), dict):
            raise ValueError('Factory status is not a JSON object')
        return body

    return read_status


def register_status(ctx, *, public_url: str, timeout_seconds: float):
    ctx.register_tool(name='factory_status', toolset='factory', schema={
        'name': 'factory_status',
        'description': 'Read the same complete JSON snapshot used by the factory dashboard. Includes source freshness, pause state, workers, scheduling reasons, release contents, manager activity, server measurements and usage. Missing or stale fields are not zero.',
        'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False},
    }, handler=create_status_handler(public_url=public_url, timeout_seconds=timeout_seconds))
