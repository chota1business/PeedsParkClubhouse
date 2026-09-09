#!/usr/bin/env python3
"""
Diagnostic script to check if the overflow fix is working
Run from your repo root: python diagnose.py
"""
import time
import threading
import os
import urllib.parse
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

REPO_ROOT = Path.cwd()
MOCK_CONFIG = b'window.CONFIG = {SUPABASE_URL: "", SUPABASE_ANON_KEY: ""};'

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        repo_root_str = str(REPO_ROOT)
        if path.startswith('/config.js'):
            return 'CONFIG_JS_MOCK'
        path = path.split('?', 1)[0]
        path = path.split('#', 1)[0]
        path = urllib.parse.unquote(path)
        if path.startswith('/'):
            path = path[1:]
        full_path = os.path.join(repo_root_str, path)
        return full_path

    def send_file(self, full_path):
        try:
            with open(full_path, 'rb') as f:
                content = f.read()
        except OSError:
            self.send_error(404)
            return False
        self.send_response(200)
        if full_path.endswith('.js'):
            ctype = 'application/javascript'
        elif full_path.endswith('.css'):
            ctype = 'text/css'
        else:
            ctype = 'text/html'
        self.send_header('Content-type', ctype)
        self.send_header('Content-Length', len(content))
        self.end_headers()
        self.wfile.write(content)
        return True

    def do_GET(self):
        path = self.translate_path(self.path)
        if path == 'CONFIG_JS_MOCK':
            self.send_response(200)
            self.send_header('Content-type', 'application/javascript')
            self.send_header('Content-Length', len(MOCK_CONFIG))
            self.end_headers()
            self.wfile.write(MOCK_CONFIG)
            return
        self.send_file(path)

    def log_message(self, *args):
        pass

print("\n🔍 CHECKING CSS FIX...")

# Check if html { overflow-x: hidden; } is in style.css
style_path = Path("css/style.css")
if style_path.exists():
    with open(style_path, 'r') as f:
        content = f.read()
    has_html_rule = "html {" in content and "overflow-x: hidden" in content
    print(f"✅ css/style.css exists")
    print(f"{'✅' if has_html_rule else '❌'} HTML overflow-x rule: {'FOUND' if has_html_rule else 'MISSING'}")
    if not has_html_rule:
        print("\n⚠️  FIX NOT APPLIED: Add this to the top of css/style.css:")
        print("""
html {
  overflow-x: hidden;
}
""")
else:
    print("❌ css/style.css not found")
    exit(1)

print("\n🌐 STARTING TEST SERVER...\n")

server = HTTPServer(("127.0.0.1", 8000), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
time.sleep(0.5)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 375, "height": 812})

        print("📱 Loading index.html at 375px viewport...")
        page.goto("http://127.0.0.1:8000/index.html", wait_until="domcontentloaded", timeout=10000)
        page.wait_for_timeout(1500)

        html_overflow = page.evaluate("getComputedStyle(document.documentElement).overflowX")
        scroll_width = page.evaluate("document.documentElement.scrollWidth")
        client_width = page.evaluate("document.documentElement.clientWidth")
        has_overflow = scroll_width > client_width + 2

        print(f"\n📊 RESULTS:")
        print(f"   html overflow-x CSS: {html_overflow}")
        print(f"   scrollWidth: {scroll_width}px")
        print(f"   clientWidth: {client_width}px")

        if has_overflow:
            print(f"\n❌ OVERFLOW DETECTED: {scroll_width - client_width}px too wide")
            print("   This means the CSS fix is NOT working correctly")
        else:
            print(f"\n✅ NO OVERFLOW - M-index.html test should PASS")

        page.close()
        browser.close()
finally:
    server.shutdown()
