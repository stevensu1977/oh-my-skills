#!/bin/bash
set -e

# Configuration
SIGNING_IDENTITY="Developer ID Application: WEI SU (CF686579RY)"
REPO="wsuam/oh-my-skills"  # Change to your repo
APP_NAME="OhMySkills"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== OhMySkills Sign & Release ===${NC}"

# Check gh CLI
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: gh CLI not installed. Run: brew install gh${NC}"
    exit 1
fi

# Check gh auth
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not logged in to GitHub. Run: gh auth login${NC}"
    exit 1
fi

# Get version from tauri.conf.json
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
TAG="v$VERSION"

echo -e "${YELLOW}Version: $VERSION${NC}"
echo -e "${YELLOW}Tag: $TAG${NC}"

# Create work directory
WORK_DIR="./release-tmp"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Download artifacts from latest workflow run
echo -e "${GREEN}Downloading artifacts from GitHub Actions...${NC}"
gh run download -n macos-unsigned -D "$WORK_DIR" || {
    echo -e "${RED}Failed to download artifacts. Make sure the build workflow has completed.${NC}"
    echo -e "${YELLOW}You can also manually download from: https://github.com/$REPO/actions${NC}"
    exit 1
}

# Find the .app
APP_PATH=$(find "$WORK_DIR" -name "*.app" -type d | head -1)
if [ -z "$APP_PATH" ]; then
    echo -e "${RED}Error: .app not found in artifacts${NC}"
    exit 1
fi

echo -e "${GREEN}Found app: $APP_PATH${NC}"

# Sign the app
echo -e "${GREEN}Signing app...${NC}"
codesign --force --deep --sign "$SIGNING_IDENTITY" "$APP_PATH"

# Verify signature
echo -e "${GREEN}Verifying signature...${NC}"
codesign --verify --deep --strict "$APP_PATH"
echo -e "${GREEN}Signature verified!${NC}"

# Create DMG
echo -e "${GREEN}Creating DMG...${NC}"
DMG_NAME="${APP_NAME}_${VERSION}_aarch64.dmg"
DMG_PATH="$WORK_DIR/$DMG_NAME"

# Create DMG using hdiutil
hdiutil create -volname "$APP_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

# Sign DMG
codesign --force --sign "$SIGNING_IDENTITY" "$DMG_PATH"

echo -e "${GREEN}DMG created: $DMG_PATH${NC}"

# Ask for confirmation
echo ""
echo -e "${YELLOW}Ready to create GitHub Release:${NC}"
echo "  Tag: $TAG"
echo "  File: $DMG_PATH"
echo ""
read -p "Create release? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Check if tag exists
    if git rev-parse "$TAG" >/dev/null 2>&1; then
        echo -e "${YELLOW}Tag $TAG already exists${NC}"
    else
        echo -e "${GREEN}Creating tag $TAG...${NC}"
        git tag "$TAG"
        git push origin "$TAG"
    fi

    # Create release
    echo -e "${GREEN}Creating GitHub Release...${NC}"
    gh release create "$TAG" "$DMG_PATH" \
        --title "$APP_NAME $VERSION" \
        --notes "## Download

- **macOS (Apple Silicon)**: ${DMG_NAME}

## Installation

1. Download the DMG file
2. Open the DMG and drag the app to Applications
3. First launch: Right-click > Open (to bypass Gatekeeper)
"

    echo -e "${GREEN}Release created: https://github.com/$REPO/releases/tag/$TAG${NC}"
else
    echo -e "${YELLOW}Release cancelled. DMG saved at: $DMG_PATH${NC}"
fi

# Cleanup option
read -p "Clean up temp files? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$WORK_DIR"
    echo -e "${GREEN}Cleaned up.${NC}"
fi
