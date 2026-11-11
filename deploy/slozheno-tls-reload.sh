#!/usr/bin/env bash
set -euo pipefail

# The existing Certbot renews the certificate. Reload only when our file changes.
fingerprint="$(docker exec groz-education-nginx-1 sha256sum /etc/letsencrypt/live/true-4.ru/fullchain.pem | cut -d ' ' -f 1)"
stamp=/var/lib/slozheno-tls/certificate.sha256
if [[ -r "$stamp" && "$(cat "$stamp")" == "$fingerprint" ]]; then
    exit 0
fi
docker exec groz-education-nginx-1 nginx -t
docker exec groz-education-nginx-1 nginx -s reload
install -d -m 0700 /var/lib/slozheno-tls
umask 077
printf '%s\n' "$fingerprint" > "$stamp"
