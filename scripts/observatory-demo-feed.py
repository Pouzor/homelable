"""Local-only fictional feed for reviewing the optional Observatory integration."""
import json
import os
import secrets
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = os.environ.get("OBSERVATORY_TOKEN", "")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        supplied = self.headers.get("Authorization", "")
        if not secrets.compare_digest(supplied.encode(), ("Bearer " + TOKEN).encode()):
            self.send_error(401)
            return
        if self.path != "/api/integration/snapshot":
            self.send_error(404)
            return
        body = json.dumps({
            "snapshot": {
                "host": {"name": "Synthetic lab", "cpu_percent": 24.5,
                         "memory_used_gib": 8, "memory_total_gib": 32},
                "collected_at": datetime.now(UTC).isoformat(),
                "collection_state": "complete", "stale_after_seconds": 60,
                "guests": [{"id": 100, "kind": "VM", "name": "demo-web", "state": "running"}],
            },
            "insights": [{"level": "ok", "title": "CPU within threshold",
                          "explanation": "Fictional reading below 85%; not real infrastructure."}],
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise SystemExit("Set OBSERVATORY_TOKEN to a dedicated test token of at least 32 characters.")
    print("Fictional feed listening on 127.0.0.1:8061. No lab connection is made.")
    HTTPServer(("127.0.0.1", 8061), Handler).serve_forever()
