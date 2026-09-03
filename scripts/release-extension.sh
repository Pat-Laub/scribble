#!/bin/sh
# Publish the extension payload on its own branch, for consumers to vendor with
#   git subtree add --prefix=_extensions/Pat-Laub/scribble <repo> <tag> --squash
#
# `git subtree split` cannot be used here: this repo *contains* another subtree
# (Pat-Laub/slide-stage), and split dies on that subtree's squash commit with
# "no new revisions were found". Building the payload commit directly is both
# simpler and immune to that, and --squash consumers never look at its history.
set -eu

PREFIX=_extensions/Pat-Laub/scribble
BRANCH=dist-scribble
TAG=${1:?usage: release-extension.sh <tag>}

tree=$(git rev-parse "HEAD:$PREFIX")
if parent=$(git rev-parse --verify --quiet "$BRANCH"); then
  [ "$(git rev-parse "$parent^{tree}")" = "$tree" ] && {
    echo "payload unchanged since $BRANCH; nothing to release"; exit 1; }
  commit=$(git commit-tree "$tree" -p "$parent" -m "$TAG")
else
  commit=$(git commit-tree "$tree" -m "$TAG")
fi
git branch -f "$BRANCH" "$commit"
git tag -f "$TAG" "$commit"
echo "$BRANCH -> $commit  ($TAG)"
git ls-tree --name-only "$commit"
