#!/usr/bin/env bash
set -euo pipefail

output_root=".."
matrix_path="internal_dependency_matrix.json"

usage() {
  cat <<'EOF'
Usage: checkout_internal_dependency_consumers.sh [--output-root PATH] [--matrix PATH]

Clone QuantStrategyLab consumer repositories referenced by the internal dependency matrix.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-root)
      output_root="${2:?--output-root requires a path}"
      shift 2
      ;;
    --matrix)
      matrix_path="${2:?--matrix requires a path}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required to checkout internal dependency consumer repos." >&2
  exit 1
fi

if [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GH_TOKEN or GITHUB_TOKEN is required to checkout internal dependency consumer repos." >&2
  exit 1
fi

export GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN}}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
matrix_file="${matrix_path}"
if [ ! -f "${matrix_file}" ]; then
  matrix_file="${repo_root}/${matrix_path}"
fi
if [ ! -f "${matrix_file}" ]; then
  echo "Matrix file not found: ${matrix_path}" >&2
  exit 1
fi

mkdir -p "${output_root}"
output_root="$(cd "${output_root}" && pwd)"

mapfile -t consumer_repos < <(
  python3 - "${matrix_file}" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
repos = sorted(
    {
        item["consumer_repo"]
        for item in payload.get("dependencies", [])
        if isinstance(item, dict) and item.get("consumer_repo")
    }
)
for repo in repos:
    print(repo)
PY
)

for consumer_repo in "${consumer_repos[@]}"; do
  target_dir="${output_root}/${consumer_repo}"
  if [ -d "${target_dir}/.git" ]; then
    echo "Already checked out ${consumer_repo} at ${target_dir}"
    continue
  fi
  echo "Cloning QuantStrategyLab/${consumer_repo} into ${target_dir}"
  gh repo clone "QuantStrategyLab/${consumer_repo}" "${target_dir}" -- --depth 1 --branch main
done

echo "Checked out ${#consumer_repos[@]} internal dependency consumer repositories under ${output_root}."
