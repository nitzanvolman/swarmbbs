#!/bin/bash
# Wait for thread to have sufficient messages

wait_for_completion() {
  local test_name=$1
  local timeout=$2
  local test_dir="test-data/e2e/$test_name"
  local root_dir="$test_dir/swarmbbs-data"
  local thread_log="$root_dir/spaces/default/threads/game.log"

  local start_time=$(date +%s)

  # Determine completion criteria based on test type
  local min_messages=2
  local min_agents=2
  case "$test_name" in
    fizzbuzz*)
      min_messages=20  # At least 5 FizzBuzz messages
      min_agents=3    # All 3 agents should participate
      ;;
    smoke*)
      min_messages=2  # At least 2 greetings
      min_agents=2    # At least 2 agents
      ;;
  esac

  echo "Waiting for completion (min messages: $min_messages, min agents: $min_agents)..."

  while true; do
    local current_time=$(date +%s)
    local elapsed=$((current_time - start_time))

    if [ $elapsed -ge $timeout ]; then
      echo "  ⏱️  Timeout reached after ${timeout}s"
      return 1
    fi

    # Check if thread log exists and count messages
    if [ -f "$thread_log" ]; then
      # Count message events
      local msg_count=$(grep '"type":"msg"' "$thread_log" 2>/dev/null | wc -l)

      # Count unique agents
      local agent_count=0
      if [ $msg_count -gt 0 ]; then
        # Use jq if available, otherwise use grep/sed
        if command -v jq &> /dev/null; then
          agent_count=$(grep '"type":"msg"' "$thread_log" | jq -r .from | sort -u | wc -l)
        else
          # Fallback to sed extraction
          agent_count=$(grep '"type":"msg"' "$thread_log" | sed 's/.*"from":"\([^"]*\)".*/\1/' | sort -u | wc -l)
        fi
      fi

      echo "  Progress: $msg_count messages from $agent_count agents (elapsed: ${elapsed}s)"

      # Check completion criteria
      if [ $msg_count -ge $min_messages ] && [ $agent_count -ge $min_agents ]; then
        echo "  ✓ Completion criteria met!"
        return 0
      fi
    else
      echo "  Waiting for thread log to be created..."
    fi

    # Wait before next check
    sleep 2
  done
}

cleanup_agents() {
  local pids=("$@")

  echo "Cleaning up agent processes..."

  # Try to kill processes by PID
  for pid in "${pids[@]}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping process $pid..."
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  # Also kill any lingering claude processes with our test configs
  echo "  Cleaning up any lingering claude processes..."
  pkill -f "claude.*mcp-config.*e2e" 2>/dev/null || true

  # Give processes time to exit gracefully
  sleep 2

  # Force kill if needed
  for pid in "${pids[@]}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  Force stopping process $pid..."
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done

  echo "  ✓ Cleanup complete"
}