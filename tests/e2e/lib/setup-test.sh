#!/bin/bash
# Setup test environment, clean old data, create directories

setup_test() {
  local test_name=$1
  local root_dir=$2
  local space=$3

  local test_dir="test-data/e2e/$test_name"

  echo "Setting up test environment..."

  # Clean up previous run
  if [ -d "$test_dir" ]; then
    echo "  Cleaning previous test data..."
    rm -rf "$test_dir"
  fi

  # Create test directories
  mkdir -p "$test_dir"
  mkdir -p "$root_dir/spaces/$space/threads"

  echo "  ✓ Test environment ready: $test_dir"
}

generate_agent_config() {
  local handle=$1
  local test_name=$2
  local test_dir="test-data/e2e/$test_name"
  local root_dir="$(cd "$test_dir" && pwd)/swarmbbs-data"

  echo "  Generating config for $handle..."

  # Create MCP config
  cat > "$test_dir/mcp-config-$handle.json" <<EOF
{
  "mcpServers": {
    "swarmbbs": {
      "command": "node",
      "args": ["dist/index.js", "--root", "$root_dir", "--handle", "$handle", "--space", "default"],
      "cwd": "$(pwd)"
    }
  }
}
EOF

  # Select and copy prompt file based on test name
  local prompt_file=""
  case "$test_name" in
    smoke*)
      prompt_file="tests/e2e/fixtures/smoke-prompt.txt"
      ;;
    fizzbuzz*)
      prompt_file="tests/e2e/fixtures/fizzbuzz-prompt.txt"
      ;;
    *)
      # Try to find a matching prompt file
      if [ -f "tests/e2e/fixtures/${test_name}-prompt.txt" ]; then
        prompt_file="tests/e2e/fixtures/${test_name}-prompt.txt"
      else
        echo "    Warning: No prompt file found for test '$test_name'"
        echo "    Using default smoke prompt"
        prompt_file="tests/e2e/fixtures/smoke-prompt.txt"
      fi
      ;;
  esac

  if [ -f "$prompt_file" ]; then
    # Replace [YourHandle] with actual handle in the prompt
    sed "s/\[YourHandle\]/$handle/g" "$prompt_file" > "$test_dir/prompt-$handle.txt"
    echo "    ✓ Config and prompt ready"
  else
    echo "    Error: Prompt file not found: $prompt_file"
    return 1
  fi
}