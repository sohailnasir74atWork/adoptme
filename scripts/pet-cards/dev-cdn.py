"""Serve the local card art like the CDN, for dev builds (cardsMock.js uses it).

    python3 scripts/pet-cards/dev-cdn.py            # http://localhost:8765
    adb reverse tcp:8765 tcp:8765                   # Android emulator / device

  /pets/index.json        keys with HD art (out/1024)
  /pets/<key>.webp        out/1024
  /pets/512/<key>.webp    out/512
  /index.json             painted assets in art/export (if any)
  /<ID>.webp              art/export/<ID>.webp
  /kit/<file>             out/remaster_kit (redraw references, for the browser)
  POST /remaster/<key>    saves an AI redraw to out/remaster/<key>.png
"""

import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "hd-art", "out")
ART = os.path.join(HERE, "..", "..", "art", "export")


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # The redraw helper runs inside chatgpt.com in the app's browser pane.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        m = re.fullmatch(r"/remaster/([a-z0-9]{1,60})", self.path.split("?")[0])
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if 0 < n < 30_000_000 else b""
        if not m or not (body[:8] == b"\x89PNG\r\n\x1a\n" or body[:4] == b"RIFF" or body[:3] == b"\xff\xd8\xff"):
            self.send_error(400)
            return
        os.makedirs(os.path.join(OUT, "remaster"), exist_ok=True)
        ext = ".png" if body[:4] == b"\x89PNG" else ".webp" if body[:4] == b"RIFF" else ".jpg"
        with open(os.path.join(OUT, "remaster", m.group(1) + ext), "wb") as f:
            f.write(body)
        self._send(json.dumps({"saved": m.group(1) + ext, "bytes": n}).encode(), "application/json")

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/pets/index.json":
            keys = sorted(f[:-5] for f in os.listdir(os.path.join(OUT, "1024")) if f.endswith(".webp"))
            return self._send(json.dumps(keys).encode(), "application/json")
        if p == "/pets/2k/index.json":
            d = os.path.join(OUT, "2048")
            keys = sorted(f[:-5] for f in os.listdir(d) if f.endswith(".webp")) if os.path.isdir(d) else []
            return self._send(json.dumps(keys).encode(), "application/json")
        if p == "/index.json":
            ids = sorted(f[:-5] for f in os.listdir(ART) if f.endswith(".webp")) if os.path.isdir(ART) else []
            return self._send(json.dumps(ids).encode(), "application/json")
        if p.startswith("/kit/"):
            path = os.path.join(OUT, "remaster_kit", os.path.basename(p))
            if not os.path.isfile(path):
                self.send_error(404)
                return
            with open(path, "rb") as f:
                return self._send(f.read(), "image/png")
        if p.startswith("/pets/2k/"):
            path = os.path.join(OUT, "2048", os.path.basename(p))
        elif p.startswith("/pets/512/"):
            path = os.path.join(OUT, "512", os.path.basename(p))
        elif p.startswith("/pets/"):
            path = os.path.join(OUT, "1024", os.path.basename(p))
        else:
            path = os.path.join(ART, os.path.basename(p))
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            self._send(f.read(), "image/webp")


if __name__ == "__main__":
    print("dev card CDN on http://localhost:8765")
    ThreadingHTTPServer(("0.0.0.0", 8765), Handler).serve_forever()
