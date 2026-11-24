#!/usr/bin/env bash
# Retakes the plugin registry listing images and icon (ADR 20):
#   assets/icon.png and assets/listing/*.webp
# Renders the Canvas panel with sample canvases through the fixture server,
# screenshots it with agent-browser, and frames the screenshots with
# tests/listing/slides.html. Needs agent-browser, ffmpeg with libwebp, and
# network access for the Inter font.
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$PWD
out=$root/.test-output/listing
port=49619
url=http://127.0.0.1:$port
ab=(agent-browser --session canvas-listing --allow-file-access)

for tool in agent-browser ffmpeg; do
  command -v "$tool" >/dev/null || {
    echo "capture.sh needs $tool" >&2
    exit 1
  }
done
mkdir -p "$out"

# Inter stands in for the macOS system font that Paseo uses.
if [ ! -f "$out/inter.woff2" ]; then
  font=$(mktemp -d)
  (cd "$font" && npm pack --silent @fontsource-variable/inter@5.3.0 >/dev/null && tar -xzf ./*.tgz)
  cp "$font/package/files/inter-latin-opsz-normal.woff2" "$out/inter.woff2"
  rm -rf "$font"
fi

npm run --silent build # renderer modules that the server imports
node tests/listing/build.mjs
node --import tsx tests/listing/serve.ts >"$out/serve.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; "${ab[@]}" close >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do
  grep -q "Listing preview" "$out/serve.log" && break
  sleep 0.5
done
plan=$(head -1 "$out/serve.log" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8"))["Search indexing plan"]')

# Finds an element's ref in the accessibility snapshot by a fragment of its line.
ref() {
  "${ab[@]}" snapshot -i | grep -F -- "$1" | head -1 | grep -o 'ref=e[0-9]*' | sed 's/ref=/@/'
}
click() {
  local target
  target=$(ref "$1")
  [ -n "$target" ] || {
    echo "No element matches: $1" >&2
    exit 1
  }
  "${ab[@]}" click "$target" >/dev/null
  sleep 0.6
}
# Scrolls the widest scrollable element, the document, to a position.
scroll_to() {
  "${ab[@]}" eval "(() => {
    const target = [...document.querySelectorAll('div')]
      .filter((d) => /(auto|scroll)/.test(getComputedStyle(d).overflowY) && d.scrollHeight > d.clientHeight + 10)
      .sort((a, b) => b.clientWidth - a.clientWidth)[0];
    if (target) target.scrollTop = $1;
  })()" >/dev/null
  sleep 0.4
}
visit() { # width height path
  "${ab[@]}" batch "set viewport $1 $2 2" "open $url/$3" "wait 2500" >/dev/null
}
shot() {
  "${ab[@]}" screenshot "$out/shot-$1.png" >/dev/null
}

visit 1440 900 "?canvas=$plan"
shot overview
visit 1360 1250 "?canvas=$plan"
scroll_to 200
shot markdown

# Comment on the milestones table, send it, and let the agent answer.
visit 1360 850 "?canvas=$plan"
click 'button "Comment mode"'
click 'checkbox "Select table for comment'
click 'button "Add comment"'
"${ab[@]}" fill "$(ref 'textbox "Comment"')" "Turn on the flag one region at a time. Add a rollout section with a row for each region." >/dev/null
scroll_to 250
shot comment
click 'button "Save comment"'
click 'button "Open comment 1"'
click 'button "Send comment 1 to agent"'
click 'button "Agent session"'
click 'button "Implement background indexing"'
shot send
click 'button "Send"'
sleep 1
node -e '
const [url, canvasId] = process.argv.slice(1);
fetch(`${url}/fixture/reply`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    canvasId,
    kind: "applied",
    replace: [
      "## Checklist",
      "## Rollout\n\n| Region | Backfill | Flag |\n|:---|:---|:---|\n| us-east | Done | On |\n| eu-west | In progress | Off |\n| ap-northeast | Not started | Off |\n\n## Checklist",
    ],
    body: "Added a Rollout section with one row per region. The flag turns on in each region after its backfill finishes.",
  }),
}).then((response) => {
  if (!response.ok) process.exit(1);
});
' "$url" "$plan"
sleep 2
"${ab[@]}" set viewport 1360 1120 2 >/dev/null
sleep 1
scroll_to 470
shot reply

visit 1120 760 "?canvas=$plan"
click 'button "Edit"'
sleep 1.5
shot edit
visit 760 360 "?view=activity"
shot activity

# Frame the screenshots.
node tests/listing/render-icon.mjs tests/listing/icon.svg "$out/icon.png" 512
node tests/listing/render-icon.mjs tests/listing/icon.svg assets/icon.png 256
cp tests/listing/slides.html "$out/slides.html"
mkdir -p assets/listing
for slide in 1-overview 2-markdown 3-comment 4-agent 5-timeline 6-locks; do
  "${ab[@]}" batch "set viewport 1920 1200 1" "open file://$out/slides.html?slide=$slide" "wait 800" "screenshot $out/$slide.png" >/dev/null
  ffmpeg -loglevel error -y -i "$out/$slide.png" -c:v libwebp -quality 90 -compression_level 6 "assets/listing/$slide.webp"
  echo "assets/listing/$slide.webp"
done
