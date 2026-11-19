#!/usr/bin/env bash
# Prints the version after the newest v* tag, bumped by patch, minor or major.
# Tags are the only record of released versions; nothing is committed back to the repository.
set -euo pipefail

latest="$(git tag --list 'v[0-9]*' --sort=-v:refname | head -n 1)"
IFS=. read -r major minor patch <<< "${latest:-v0.0.0}"
major="${major#v}"

case "${1:-patch}" in
  major) echo "$((major + 1)).0.0" ;;
  minor) echo "$major.$((minor + 1)).0" ;;
  patch) echo "$major.$minor.$((patch + 1))" ;;
  *) echo "usage: next-version.sh patch|minor|major" >&2; exit 1 ;;
esac
