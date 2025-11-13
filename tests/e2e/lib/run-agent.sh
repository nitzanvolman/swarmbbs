#!/bin/bash
# Run a single agent instance

run_agent() {
  local handle=$1
  local test_name=$2
  local test_dir="test-data/e2e/$test_name"

  local config="$test_dir/mcp-config-$handle.json"
  local prompt="$test_dir/prompt-$handle.txt"
  local log="$test_dir/$handle.log"

  # Check files exist
  if [ ! -f "$config" ]; then
    echo "    Error: Config not found: $config"
    return 1
  fi

  if [ ! -f "$prompt" ]; then
    echo "    Error: Prompt not found: $prompt"
    return 1
  fi

  # Read prompt into variable
  local prompt_text=$(cat "$prompt")

  # Run Claude with the prompt as command-line argument
  # Using a subshell to ensure clean exit
  (
    claude \
      --mcp-config "$config" \
      --permission-mode bypassPermissions \
      "$prompt_text" \
      > "$log" 2>&1

    echo "  ✓ $handle completed (exit code: $?)"
  ) &

  # Return the PID of the background process
  echo $!
}