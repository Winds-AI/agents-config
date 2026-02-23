#!/usr/bin/env bash
# Source once: source .agent/api-env.sh
# Sets up environment for API testing with curl wrapper

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# API Configuration (for testing endpoints)
export API_BASE="http://localhost:7071/api"  # Local Azure Functions
export API_TOKENS_FILE="$DIR/tokens.toml"
export API_MODE="safe-updates"  # read-only | safe-updates | full-access

# Add tools to PATH
export PATH="$DIR/bin:$PATH"

echo "Backend dev environment loaded"
echo "  API_BASE: $API_BASE"
echo ""
echo "Usage:"
echo "  API_TOKEN_NAME=dev-admin curl \"\$API_BASE/bandar-admin/...\""
