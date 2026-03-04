#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET_ROOT="$PROJECT_ROOT/node_modules"

if [ ! -d "$TARGET_ROOT" ]; then
  echo "Missing target node_modules: $TARGET_ROOT" >&2
  exit 1
fi

if [ -n "${SOURCE_NODE_MODULES:-}" ]; then
  SOURCE_ROOT="$SOURCE_NODE_MODULES"
elif [ -d "$PROJECT_ROOT/../node_modules" ]; then
  SOURCE_ROOT="$PROJECT_ROOT/../node_modules"
elif [ -d "$PROJECT_ROOT/../../node_modules" ]; then
  SOURCE_ROOT="$PROJECT_ROOT/../../node_modules"
else
  echo "No external node_modules source found; nothing to link."
  exit 0
fi

if [ "$SOURCE_ROOT" = "$TARGET_ROOT" ]; then
  echo "Source and target node_modules are the same; nothing to link."
  exit 0
fi

if [ ! -d "$SOURCE_ROOT" ]; then
  echo "Missing source node_modules: $SOURCE_ROOT" >&2
  exit 1
fi

for entry in "$SOURCE_ROOT"/*; do
  name=$(basename "$entry")
  [ "$name" = ".bin" ] && continue

  case "$name" in
    @*)
      mkdir -p "$TARGET_ROOT/$name"
      for scoped in "$entry"/*; do
        [ -e "$scoped" ] || continue
        pkg=$(basename "$scoped")
        if [ ! -e "$TARGET_ROOT/$name/$pkg" ] && [ ! -L "$TARGET_ROOT/$name/$pkg" ]; then
          ln -s "$scoped" "$TARGET_ROOT/$name/$pkg"
        fi
      done
      ;;
    *)
      if [ ! -e "$TARGET_ROOT/$name" ] && [ ! -L "$TARGET_ROOT/$name" ]; then
        ln -s "$entry" "$TARGET_ROOT/$name"
      fi
      ;;
  esac
done

echo "Linked missing packages from $SOURCE_ROOT"
