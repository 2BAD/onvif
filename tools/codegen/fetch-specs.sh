#!/bin/sh
# Refresh the vendored ONVIF specs and the external schemas they import.
# Usage: tools/codegen/fetch-specs.sh [onvif/specs commit]
set -eu

commit=${1:-b0ae7de3dc3ca9b5ca27629385f48167cacc715a}
specs=$(cd "$(dirname "$0")" && pwd)/specs
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q "$work/onvif"
git -C "$work/onvif" fetch -q --depth 1 https://github.com/onvif/specs.git "$commit"
git -C "$work/onvif" checkout -q FETCH_HEAD

rm -rf "$specs/onvif" "$specs/external"
(cd "$work/onvif/wsdl" && find . -type f \( -name '*.wsdl' -o -name '*.xsd' \)) | while read -r file; do
  mkdir -p "$specs/onvif/$(dirname "$file")"
  cp "$work/onvif/wsdl/$file" "$specs/onvif/$file"
done
echo "$commit" > "$specs/onvif/COMMIT"

for url in \
  http://docs.oasis-open.org/wsn/b-2.xsd \
  http://docs.oasis-open.org/wsn/t-1.xsd \
  http://docs.oasis-open.org/wsn/bw-2.wsdl \
  http://docs.oasis-open.org/wsrf/rw-2.wsdl \
  http://docs.oasis-open.org/wsrf/r-2.xsd \
  http://docs.oasis-open.org/wsrf/bf-2.xsd \
  http://www.w3.org/2005/08/addressing/ws-addr.xsd \
  http://www.w3.org/2001/xml.xsd \
  https://www.w3.org/2005/05/xmlmime \
  https://www.w3.org/2004/08/xop/include \
  https://www.w3.org/2003/05/soap-envelope; do
  target="$specs/external/$(echo "$url" | sed -E 's#^https?://##')"
  mkdir -p "$(dirname "$target")"
  curl -fsSL -H 'Accept: application/xml' -o "$target" "$url"
done
