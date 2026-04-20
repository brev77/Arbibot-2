#!/usr/bin/env python3
"""
Recalibration CLI (PRIO-P2-RECAL): load route_scoring JSONL export, aggregate, emit proposed policy fragments.

Example:
  npm run export:route-scoring-history > /tmp/rs.jsonl
  python tools/recalibration/main.py --from 2026-04-01 --to 2026-04-20 --history /tmp/rs.jsonl
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Arbibot recalibration — route scoring → proposed config fragments")
    p.add_argument("--from", dest="date_from", required=True, help="Start date YYYY-MM-DD")
    p.add_argument("--to", dest="date_to", required=True, help="End date YYYY-MM-DD")
    p.add_argument("--tokens", type=str, default="", help="Comma-separated instrument keys (filter)")
    p.add_argument("--history", type=str, default="", help="Path to JSONL from export-route-scoring-history.mjs")
    p.add_argument("--out", type=str, default="", help="Optional output file path")
    return p.parse_args()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def aggregate_scores(rows: list[dict[str, Any]]) -> dict[str, list[float]]:
    by_route: dict[str, list[float]] = {}
    for r in rows:
        rk = str(r.get("routeKey") or r.get("route_key") or "").strip()
        if not rk:
            continue
        try:
            s = float(r.get("score", 0))
        except (TypeError, ValueError):
            continue
        by_route.setdefault(rk, []).append(s)
    return by_route


def propose_intake_throttling(scores: list[float]) -> dict[str, Any]:
    if not scores:
        return {
            "samplesPerSecond": 50,
            "minRouteScore": 0.35,
            "requireAuditOnThrottle": False,
            "note": "No history rows — stub defaults",
        }
    med = statistics.median(scores)
    # Higher median → can allow slightly higher minRouteScore (tunable stub).
    min_route = max(0.2, min(0.65, round(med * 0.6, 3)))
    sps = 80 if med >= 0.5 else 50
    return {
        "samplesPerSecond": sps,
        "minRouteScore": min_route,
        "requireAuditOnThrottle": False,
        "note": f"Derived from median score {med:.4f} (stub heuristic)",
    }


def main() -> int:
    args = parse_args()
    tokens = [t.strip() for t in args.tokens.split(",") if t.strip()] if args.tokens else []

    history_path = args.history.strip()
    rows: list[dict[str, Any]] = []
    if history_path:
        p = Path(history_path)
        if not p.is_file():
            raise SystemExit(f"History file not found: {p}")
        rows = load_jsonl(p)

    by_route = aggregate_scores(rows)
    flat_scores = [s for vals in by_route.values() for s in vals]

    proposal: dict[str, Any] = {
        "version": 1,
        "generatedFor": {"from": args.date_from, "to": args.date_to},
        "tokens": tokens,
        "routeAggregates": {
            k: {"count": len(v), "median": round(statistics.median(v), 6) if v else None}
            for k, v in sorted(by_route.items())
        },
        "proposedFragments": {
            "intake.throttling": propose_intake_throttling(flat_scores),
            "intake.routing.tiers": {
                "note": "Tune hot/warm/cold lists manually after review; stub leaves structure to operator.",
                "hot": {"enabled": True, "instrumentKeys": []},
                "warm": {"enabled": True, "instrumentKeys": []},
                "cold": {"enabled": True, "instrumentKeys": []},
            },
            "paper.discovery": {
                "note": "Optional tuning — apply via config-service with approval only.",
            },
        },
    }

    text = json.dumps(proposal, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
