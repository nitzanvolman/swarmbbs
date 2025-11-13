#!/bin/bash
# Main test runner that coordinates all Claude instances
# Usage: ./runner.sh <test-name> <num-agents> <timeout-seconds>

set -e  # Exit on error

# Parse arguments
TEST_NAME=${1:-smoke-test}
NUM_AGENTS=${2:-3}
TIMEOUT=${3:-180}

# Paths
SCRIPT_DIR="$(dirname "$0")"
TEST_DIR="test-data/e2e/$TEST_NAME"
ROOT_DIR="$TEST_DIR/swarmbbs-data"
SPACE="default"

# Source helper functions
source "$SCRIPT_DIR/lib/setup-test.sh"
source "$SCRIPT_DIR/lib/run-agent.sh"
source "$SCRIPT_DIR/lib/wait-for-messages.sh"
source "$SCRIPT_DIR/lib/verify-thread.sh"

echo "======================================"
echo "E2E Test Runner: $TEST_NAME"
echo "Agents: $NUM_AGENTS"
echo "Timeout: ${TIMEOUT}s"
echo "======================================"

# Setup test environment
setup_test "$TEST_NAME" "$ROOT_DIR" "$SPACE"

# Generate configs and prompts for each agent
for i in $(seq 1 $NUM_AGENTS); do
  # Convert 1,2,3 to A,B,C
  HANDLE="Agent$(echo $i | sed 's/1/A/;s/2/B/;s/3/C/')"
  generate_agent_config "$HANDLE" "$TEST_NAME"
done

# Launch all agents in background
echo ""
echo "Launching agents..."
PIDS=()

# Determine stagger time based on test type
STAGGER_TIME=1
if [[ "$TEST_NAME" == *"fizzbuzz"* ]]; then
  STAGGER_TIME=3  # Longer stagger for FizzBuzz to avoid conflicts
fi

for i in $(seq 1 $NUM_AGENTS); do
  # Convert 1,2,3 to A,B,C
  HANDLE="Agent$(echo $i | sed 's/1/A/;s/2/B/;s/3/C/')"
  run_agent "$HANDLE" "$TEST_NAME" &
  PIDS+=($!)
  echo "  Started $HANDLE (PID: ${PIDS[-1]})"

  # Stagger starts - longer for FizzBuzz
  if [ $i -lt $NUM_AGENTS ]; then
    echo "  Waiting ${STAGGER_TIME}s before starting next agent..."
    sleep $STAGGER_TIME
  fi
done

echo ""
echo "All agents launched. Waiting for completion..."

# Wait for completion or timeout
wait_for_completion "$TEST_NAME" "$TIMEOUT"
RESULT=$?

# Cleanup
echo ""
echo "Cleaning up..."
cleanup_agents "${PIDS[@]}"

# Basic verification
echo ""
THREAD_LOG="$ROOT_DIR/spaces/$SPACE/threads/game.log"
if [ -f "$THREAD_LOG" ]; then
  verify_thread "$THREAD_LOG"
else
  echo "Warning: Thread log not found at $THREAD_LOG"
fi

echo ""
echo "======================================"
if [ $RESULT -eq 0 ]; then
  echo "Test completed successfully!"
else
  echo "Test timed out or failed."
fi
echo "======================================"

exit $RESULT