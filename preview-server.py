from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import traceback


ROOT = Path(__file__).resolve().parent


class PreviewHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        if sys.stderr:
            super().log_message(format, *args)

    def do_GET(self):
        request_path = self.path.split("?", 1)[0]
        if request_path == "/preview.css":
            css = (ROOT / "app" / "globals.css").read_text(encoding="utf-8")
            css = css.replace('@import "tailwindcss";', "", 1)
            payload = css.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/css; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if request_path.startswith("/poker-assets/"):
            self.path = "/public" + self.path
        super().do_GET()


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 4173), PreviewHandler)
        if sys.stdout:
            print("Poker preview: http://127.0.0.1:4173", flush=True)
        server.serve_forever()
    except Exception:
        (ROOT / "preview-server-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        raise
