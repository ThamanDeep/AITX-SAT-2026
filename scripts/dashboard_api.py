#!/usr/bin/env python3
"""Read-only dashboard API backed by the hosted Supabase project."""

import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import psycopg2
from psycopg2.extras import RealDictCursor

ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.getenv("DASHBOARD_API_PORT", "8787"))
CATEGORIES = {
    "macbook": re.compile(r"\bmacbook\b", re.I),
    "gpu": re.compile(r"\b(gpu|graphics card|geforce|rtx|gtx|radeon)\b", re.I),
    "ram": re.compile(r"\b(ddr[345]|sodimm|so-dimm|dimm|desktop memory)\b", re.I),
}
IMPROVEMENT_RUNS = [
    {"version": "v1.4", "label": "Refine pricing & URLs", "current": True, "decision_quality": .763, "decision_ci": .018, "landed_price_error": 7.6, "landed_ci": .7, "latency": 2.31, "latency_ci": .27, "valid_url_rate": 96.2, "url_ci": 1.3, "unsupported_claims": .72, "claims_ci": .18, "forecast_regret": 56, "regret_ci": 9},
    {"version": "v1.3", "label": "Stricter evidence + judge", "decision_quality": .734, "decision_ci": .019, "landed_price_error": 8.4, "landed_ci": .8, "latency": 2.12, "latency_ci": .25, "valid_url_rate": 95.0, "url_ci": 1.4, "unsupported_claims": .90, "claims_ci": .20, "forecast_regret": 63, "regret_ci": 10},
    {"version": "v1.2", "label": "Better retrieval mix", "decision_quality": .701, "decision_ci": .020, "landed_price_error": 9.6, "landed_ci": .9, "latency": 1.98, "latency_ci": .24, "valid_url_rate": 93.5, "url_ci": 1.6, "unsupported_claims": 1.18, "claims_ci": .26, "forecast_regret": 72, "regret_ci": 11},
    {"version": "v1.1", "label": "Initial harness", "baseline": True, "decision_quality": .642, "decision_ci": .022, "landed_price_error": 11.3, "landed_ci": 1.0, "latency": 1.75, "latency_ci": .22, "valid_url_rate": 91.2, "url_ci": 1.7, "unsupported_claims": 1.73, "claims_ci": .30, "forecast_regret": 93, "regret_ci": 13},
]


def load_env():
    for raw in (ROOT / ".env").read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def database():
    """Use the linked hosted pooler because the direct Supabase host is IPv6-only here."""
    pooler = (ROOT / "supabase/.temp/pooler-url").read_text().strip()
    endpoint = pooler.rsplit("@", 1)[-1].split("/", 1)[0]
    host, port = endpoint.rsplit(":", 1)
    project_ref = (ROOT / "supabase/.temp/project-ref").read_text().strip()
    return psycopg2.connect(
        host=host,
        port=int(port),
        user=f"postgres.{project_ref}",
        password=os.environ["SUPABASE_DB_PW"],
        dbname="postgres",
        sslmode="require",
        connect_timeout=8,
    )


def category_for(title):
    return next((name for name, pattern in CATEGORIES.items() if pattern.search(title)), None)


def json_value(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def marketplace(category):
    with database() as connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            """
            select l.id, s.slug as source, s.name as source_name, l.title, l.condition,
                   l.seller_name, l.seller_rating, l.item_price, l.shipping_price,
                   l.total_price, l.currency, l.listing_url, l.image_url, l.availability,
                   l.collection_method, l.collector, l.last_seen_at
            from public.listings l
            join public.sources s on s.id = l.source_id
            where l.collector not ilike '%%sandbox%%'
            order by l.total_price asc, l.last_seen_at desc
            """
        )
        rows = []
        for row in cursor.fetchall():
            row = {key: json_value(value) for key, value in row.items()}
            row["category"] = category_for(row["title"])
            if row["category"] and (category == "all" or row["category"] == category):
                rows.append(row)

        cursor.execute(
            """
            select max(r.finished_at) as last_synced_at,
                   count(*) filter (where r.status = 'succeeded') as successful_syncs
            from public.sync_runs r
            join public.sources s on s.id = r.source_id
            where s.enabled = true
            """
        )
        sync = {key: json_value(value) for key, value in cursor.fetchone().items()}

    sources = sorted({row["source_name"] for row in rows})
    return {
        "data_status": "live",
        "database": "hosted Supabase",
        "category": category,
        "listings": rows,
        "meta": {
            **sync,
            "listing_count": len(rows),
            "source_count": len(sources),
            "sources": sources,
            "sandbox_excluded": True,
        },
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dashboard"), **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/health":
            try:
                with database() as connection, connection.cursor() as cursor:
                    cursor.execute("select now()")
                    checked_at = cursor.fetchone()[0].isoformat()
                self.send_json({"status": "ok", "database": "hosted Supabase", "checked_at": checked_at})
            except Exception as error:
                self.send_json({"status": "error", "error": str(error)}, 503)
            return

        if parsed.path == "/api/marketplace":
            category = query.get("category", ["all"])[0].lower()
            if category not in {*CATEGORIES, "all"}:
                self.send_json({"error": "category must be gpu, macbook, ram, or all"}, 400)
                return
            try:
                self.send_json(marketplace(category))
            except Exception as error:
                self.send_json({"data_status": "unavailable", "error": str(error), "listings": []}, 503)
            return

        if parsed.path == "/api/improvement":
            self.send_json({
                "evidence_status": "illustrative",
                "source": "User-provided recursive-improvement design reference",
                "note": "Replace these rows with measured Verifiers outputs after the first overnight run.",
                "runs": IMPROVEMENT_RUNS,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        super().do_GET()

    def log_message(self, format, *args):
        print(f"[dashboard-api] {self.address_string()} {format % args}")


if __name__ == "__main__":
    load_env()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[dashboard-api] listening on http://127.0.0.1:{PORT}")
    server.serve_forever()
