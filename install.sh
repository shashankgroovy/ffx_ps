#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_HOST_NAME="shiftr_host"
NATIVE_HOST_SCRIPT="$SCRIPT_DIR/native-host/$NATIVE_HOST_NAME.py"

# Determine the native messaging hosts directory
case "$(uname -s)" in
    Darwin)
        TARGET_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
        ;;
    Linux)
        TARGET_DIR="$HOME/.mozilla/native-messaging-hosts"
        ;;
    *)
        echo "Error: Unsupported OS. This script supports macOS and Linux."
        exit 1
        ;;
esac

echo "=== Shiftr - Native Host Installer ==="
echo ""
echo "Native host script: $NATIVE_HOST_SCRIPT"
echo "Target directory:   $TARGET_DIR"
echo ""

# Ensure script is executable
chmod +x "$NATIVE_HOST_SCRIPT"

# Create target directory
mkdir -p "$TARGET_DIR"

# Generate the manifest with the correct absolute path
cat > "$TARGET_DIR/$NATIVE_HOST_NAME.json" <<EOF
{
  "name": "$NATIVE_HOST_NAME",
  "description": "Native messaging host for Shiftr",
  "path": "$NATIVE_HOST_SCRIPT",
  "type": "stdio",
  "allowed_extensions": ["shiftr@local"]
}
EOF

echo "Installed native messaging host manifest to:"
echo "  $TARGET_DIR/$NATIVE_HOST_NAME.json"
echo ""
echo "Next steps:"
echo "  1. Open Firefox"
echo "  2. Go to about:debugging#/runtime/this-firefox"
echo "  3. Click 'Load Temporary Add-on...'"
echo "  4. Select: $SCRIPT_DIR/extension/manifest.json"
echo ""
echo "Done!"
