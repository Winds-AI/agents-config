#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/sync-upstreams.sh [--manifest FILE] [--force]

Synchronize external reference repositories listed in a TSV manifest.

Manifest format (tab-separated, no quotes):
  name<TAB>repo_url<TAB>branch<TAB>target_dir

Options:
  --manifest FILE   Path to manifest file (default: ./upstreams.tsv)
  --force           Discard local changes in upstream repos before syncing
  -h, --help        Show this help
EOF
}

manifest="./upstreams.tsv"
force=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      manifest="${2:-}"
      shift 2
      ;;
    --force)
      force=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${manifest}" || ! -f "${manifest}" ]]; then
  echo "Manifest not found: ${manifest}" >&2
  exit 1
fi

sync_repo() {
  local name="$1"
  local repo_url="$2"
  local branch="$3"
  local target_dir="$4"

  echo "==> ${name} (${repo_url} @ ${branch})"

  if [[ -d "${target_dir}/.git" ]]; then
    local origin_url
    origin_url="$(git -C "${target_dir}" config --get remote.origin.url || true)"
    if [[ "${origin_url}" != "${repo_url}" ]]; then
      echo "    skip: origin URL mismatch in ${target_dir}" >&2
      echo "          expected: ${repo_url}" >&2
      echo "          found:    ${origin_url}" >&2
      return 0
    fi

    if ! git -C "${target_dir}" diff --quiet || ! git -C "${target_dir}" diff --cached --quiet; then
      if [[ "${force}" == "true" ]]; then
        echo "    dirty repo detected, resetting because --force was provided"
      else
        echo "    skip: dirty repo (commit/stash or rerun with --force)" >&2
        return 0
      fi
    fi

    git -C "${target_dir}" fetch --prune origin "${branch}"
    if [[ "${force}" == "true" ]]; then
      git -C "${target_dir}" checkout -B "${branch}" "origin/${branch}" >/dev/null 2>&1 \
        || git -C "${target_dir}" checkout "${branch}" >/dev/null 2>&1
      git -C "${target_dir}" reset --hard "origin/${branch}"
      git -C "${target_dir}" clean -fd
    else
      git -C "${target_dir}" checkout "${branch}" >/dev/null 2>&1 \
        || git -C "${target_dir}" checkout -b "${branch}" --track "origin/${branch}" >/dev/null 2>&1
      git -C "${target_dir}" merge --ff-only "origin/${branch}"
    fi
  else
    mkdir -p "$(dirname "${target_dir}")"
    git clone --branch "${branch}" --origin origin "${repo_url}" "${target_dir}"
  fi
}

while IFS=$'\t' read -r name repo_url branch target_dir; do
  if [[ -z "${name}" || "${name}" == \#* ]]; then
    continue
  fi

  if [[ -z "${repo_url}" || -z "${branch}" || -z "${target_dir}" ]]; then
    echo "Skipping malformed row in ${manifest}: ${name}${repo_url}${branch}${target_dir}" >&2
    continue
  fi

  sync_repo "${name}" "${repo_url}" "${branch}" "${target_dir}"
done < "${manifest}"

echo "Sync complete."
