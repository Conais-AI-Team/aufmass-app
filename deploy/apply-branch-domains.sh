#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

repo_dir="/var/www/aufmass-api"
source_config="${repo_dir}/deploy/nginx-branch-split.conf"
target_config="/etc/nginx/sites-available/aufmass-branches"
enabled_config="/etc/nginx/sites-enabled/aufmass-branches"
domains=(
  "ayluxsi.cnsform.com"
  "ayluxmu.cnsform.com"
  "ayluxgk.cnsform.com"
  "ayluxms.cnsform.com"
)

for command_name in nginx certbot curl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -f "${source_config}" ]]; then
  echo "Nginx source config is missing: ${source_config}" >&2
  exit 1
fi
if [[ ! -f "${repo_dir}/dist/index.html" ]]; then
  echo "Frontend build is missing: ${repo_dir}/dist/index.html" >&2
  exit 1
fi

install -m 0644 "${source_config}" "${target_config}"
ln -sfn "../sites-available/aufmass-branches" "${enabled_config}"

nginx -t
systemctl reload nginx

certbot_args=(
  --nginx
  --redirect
  --non-interactive
  --agree-tos
  --register-unsafely-without-email
)
for domain in "${domains[@]}"; do
  certbot_args+=(-d "${domain}")
done
certbot "${certbot_args[@]}"

nginx -t
systemctl reload nginx

failed=0
for domain in "${domains[@]}"; do
  if curl \
    --fail \
    --silent \
    --show-error \
    --head \
    --max-time 20 \
    "https://${domain}/" >/dev/null; then
    echo "HTTPS OK: ${domain}"
  else
    echo "HTTPS FAILED: ${domain}" >&2
    failed=1
  fi
done

if [[ "${failed}" -ne 0 ]]; then
  exit 1
fi

echo "All separated branch domains are live with HTTPS."
