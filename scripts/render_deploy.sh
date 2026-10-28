#!/usr/bin/env bash
# Renders a deploy/*.template file: replaces the KURA_* placeholders with their values from the environment and leaves
# everything else (nginx's $uri, $host ...) untouched.
#   KURA_PORT=3000 KURA_APP_DIR=/opt/kurastream ... scripts/render_deploy.sh deploy/nginx/kurastream.conf.template > out.conf
set -euo pipefail
template="${1:?usage: render_deploy.sh <template>}"
vars=$(grep -o '\${KURA_[A-Z_]*}' "$template" | sort -u | tr -d '${}' || true)
missing=0
list=""
for v in $vars; do
    if [ -z "${!v+x}" ]; then
        echo "render_deploy: $v is not set (needed by $template)" >&2
        missing=1
    fi
    list="$list \${$v}"
done
[ "$missing" = 0 ] || exit 1
if command -v envsubst >/dev/null 2>&1; then
    envsubst "$list" < "$template"
else
    # No gettext: do the same with perl (always present on Debian).
    perl -pe 's/\$\{(KURA_[A-Z_]+)\}/exists $ENV{$1} ? $ENV{$1} : $&/ge' "$template"
fi
