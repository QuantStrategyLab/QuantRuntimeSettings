#!/usr/bin/env bash
set -euo pipefail

output_root=".."
matrix_path="internal_dependency_matrix.json"

usage() {
  cat <<'EOF'
Usage: checkout_internal_dependency_consumers.sh [--output-root PATH] [--matrix PATH]

Clone QuantStrategyLab consumer repositories referenced by the internal dependency matrix.
Preserve existing checkouts; emit one JSON evidence record per repository to stdout.
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
repo_root="$(cd "${script_dir}/../.." && pwd)"
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

consumer_repos_text="$(
  python3 - "${matrix_file}" <<'PY'
import json
import re
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("dependencies"), list):
        raise ValueError
    repos = set()
    for item in payload["dependencies"]:
        repo = item["consumer_repo"]
        if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", repo):
            raise ValueError
        if item["path"] not in ("requirements.txt", "requirements-lock.txt", "pyproject.toml", "uv.lock"):
            raise ValueError
        repos.add(repo)
except (OSError, ValueError, KeyError, TypeError, AttributeError):
    sys.exit("Invalid internal dependency matrix repository or dependency path.")
repos = sorted(repos)
for repo in repos:
    print(repo)
PY
)"
consumer_repos=()
if [ -n "${consumer_repos_text}" ]; then
  mapfile -t consumer_repos <<< "${consumer_repos_text}"
fi

consumer_ref="${QSL_CONSUMER_REF:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-main}}}"
if ! git check-ref-format --branch "${consumer_ref}" >/dev/null 2>&1; then
  echo "Invalid consumer checkout ref." >&2
  exit 1
fi

for consumer_repo in "${consumer_repos[@]}"; do
  target_dir="${output_root}/${consumer_repo}"
  checkout_kind="existing"
  if [ ! -e "${target_dir}" ] && [ ! -L "${target_dir}" ]; then
    checkout_kind="cloned"
    checkout_ref="main"
    if gh api "repos/QuantStrategyLab/${consumer_repo}/branches/${consumer_ref}" >/dev/null 2>&1; then
      checkout_ref="${consumer_ref}"
    fi
    echo "Cloning QuantStrategyLab/${consumer_repo}@${checkout_ref}" >&2
    # Git/gh errors may contain a credential-bearing remote; never relay them.
    if ! gh repo clone "QuantStrategyLab/${consumer_repo}" "${target_dir}" -- --depth 1 --branch "${checkout_ref}" >/dev/null 2>&1; then
      echo "Clone failed for QuantStrategyLab/${consumer_repo}; no complete checkout evidence was produced." >&2
      exit 1
    fi
  fi
  GIT_NO_LAZY_FETCH=1 python3 - "${target_dir}" "${consumer_repo}" "${consumer_ref}" "${checkout_kind}" "${matrix_file}" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

target = Path(sys.argv[1])
consumer_repo, requested_ref, checkout_kind = sys.argv[2:5]

def fail(message):
    sys.exit(f"Checkout evidence failed for QuantStrategyLab/{consumer_repo}: {message}")

def git(*args, required=True):
    result = subprocess.run(["git", "-C", str(target), *args], capture_output=True)
    if required and result.returncode:
        fail("Git checkout integrity check failed; remote and command output withheld.")
    return result

if target.is_symlink() or not target.is_dir():
    fail("expected an independent repository directory.")
top = git("rev-parse", "--show-toplevel").stdout.decode().strip()
if Path(top).resolve() != target.resolve():
    fail("directory is not the repository root.")

# Inspect the URL privately, then emit only the expected canonical owner/repo.
origin_bytes = git("remote", "get-url", "--all", "origin").stdout
try:
    origins = origin_bytes.decode().splitlines()
    if not origins:
        raise ValueError
    for origin in origins:
        if origin.startswith("git@github.com:"):
            origin_path = origin[len("git@github.com:"):]
        else:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("https", "ssh") or parsed.hostname != "github.com" or parsed.query or parsed.fragment:
                raise ValueError
            if parsed.port not in (None, 22 if parsed.scheme == "ssh" else 443):
                raise ValueError
            origin_path = parsed.path.removeprefix("/")
        if origin_path.endswith(".git"):
            origin_path = origin_path[:-4]
        if origin_path.casefold() != f"QuantStrategyLab/{consumer_repo}".casefold():
            raise ValueError
except ValueError:
    fail("repository identity does not match the matrix; origin URL withheld.")

head_result = git("rev-parse", "--verify", "HEAD^{commit}", required=False)
head = head_result.stdout.decode().strip()
if head_result.returncode or not re.fullmatch(r"[0-9a-f]{40}", head):
    fail("HEAD is not a complete Git commit SHA.")
git("fsck", "--connectivity-only", "--no-dangling")
branch = git("symbolic-ref", "--quiet", "--short", "HEAD", required=False).stdout.decode().strip()
status = git("status", "--porcelain", "--untracked-files=normal").stdout
matrix_bytes = Path(sys.argv[5]).read_bytes()
payload = json.loads(matrix_bytes)
paths = {item["path"] for item in payload["dependencies"] if item["consumer_repo"] == consumer_repo}
supported_paths = ("requirements.txt", "requirements-lock.txt", "pyproject.toml", "uv.lock")
if not paths.issubset(supported_paths):
    fail("matrix dependency paths changed or are invalid.")
paths.update(path for path in supported_paths if (target / path).exists() or (target / path).is_symlink())
paths.update(git("ls-tree", "--name-only", head, "--", *supported_paths).stdout.decode().splitlines())
files = []
for relative_path in sorted(paths):
    path = target / relative_path
    if path.is_symlink() or (path.exists() and not path.is_file()):
        fail("dependency path must be a regular file inside the repository.")
    content = path.read_bytes() if path.exists() else None
    tracked = bool(git("ls-tree", head, "--", relative_path).stdout)
    committed = git("show", f"{head}:{relative_path}", required=tracked)
    files.append({
        "path": relative_path,
        "status": "present" if content is not None else "missing",
        "sha256": hashlib.sha256(content).hexdigest() if content is not None else None,
        "head_sha256": hashlib.sha256(committed.stdout).hexdigest() if committed.returncode == 0 else None,
    })

# Reject a checkout that moved while its evidence was being read.
if git("rev-parse", "--verify", "HEAD^{commit}").stdout.decode().strip() != head or git("status", "--porcelain", "--untracked-files=normal").stdout != status:
    fail("checkout changed while evidence was being collected; retry without modifying it.")
if git("remote", "get-url", "--all", "origin").stdout != origin_bytes or git("symbolic-ref", "--quiet", "--short", "HEAD", required=False).stdout.decode().strip() != branch:
    fail("repository identity or selected ref changed while evidence was being collected.")
if Path(sys.argv[5]).read_bytes() != matrix_bytes:
    fail("matrix changed while evidence was being collected.")
for item in files:
    path = target / item["path"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and not path.is_symlink() else None
    if digest != item["sha256"]:
        fail("dependency file changed while evidence was being collected; retry without modifying it.")
print(json.dumps({
    "consumer_repo": consumer_repo,
    "origin": f"QuantStrategyLab/{consumer_repo}",
    "checkout_kind": checkout_kind,
    "requested_ref": requested_ref,
    "selected_ref": branch or head,
    "head_sha": head,
    "worktree_dirty": bool(status),
    "matrix_sha256": hashlib.sha256(matrix_bytes).hexdigest(),
    "dependency_files": files,
}, sort_keys=True))
PY
done

echo "Recorded checkout evidence for ${#consumer_repos[@]} internal dependency consumer repositories." >&2
