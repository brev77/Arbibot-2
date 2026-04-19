"""
PRIO-P2-RECAL — stub recalibration job.

Fetches current token/route profiles from risk-service for auditing;
extend with historical analysis and proposed cap deltas.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from config import DEFAULT_RISK_API_BASE


def _get_json(url: str) -> object:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    base = os.environ.get("RISK_API_BASE", DEFAULT_RISK_API_BASE).rstrip("/")
    try:
        tokens = _get_json(f"{base}/policy/token-profiles")
        routes = _get_json(f"{base}/policy/route-profiles")
    except urllib.error.URLError as e:
        print(f"recalibration: cannot reach risk API at {base}: {e}", file=sys.stderr)
        return 1
    print("recalibration: token_profiles snapshot")
    print(json.dumps(tokens, indent=2)[:4000])
    print("recalibration: route_profiles snapshot")
    print(json.dumps(routes, indent=2)[:4000])
    print("recalibration: done (dry-run, no writes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
