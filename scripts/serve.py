#!/usr/bin/env python3
"""Local preview server for the site.

`python3 -m http.server` doesn't support HTTP Range requests, which the .pmtiles
basemap and terrain files need. GitHub Pages does, so this is only for local testing.

Usage: python3 scripts/serve.py [port]   (run from the repo root; default port 8000)
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeRequestHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().send_head()

        size = os.path.getsize(path)
        start, end = match.groups()
        if start:
            start, end = int(start), min(int(end) if end else size - 1, size - 1)
        else:
            start, end = max(size - int(end), 0), size - 1
        if start > end:
            self.send_error(416, 'Requested Range Not Satisfiable')
            return None

        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, '_remaining', None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._remaining = None


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Serving on http://localhost:{port}')
    ThreadingHTTPServer(('', port), RangeRequestHandler).serve_forever()
