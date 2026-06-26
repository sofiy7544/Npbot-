#!/usr/bin/env bash
# Stanley Brand site — local static server.
cd "$(dirname "$0")"
echo "Site:  http://localhost:8000"
echo "Admin: http://localhost:8000/admin.html"
echo "Ctrl+C to stop."
python3 -m http.server 8000
