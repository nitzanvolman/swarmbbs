#!/bin/bash
# Basic verification that can be done in shell

verify_thread() {
  local thread_log=$1

  if [ ! -f "$thread_log" ]; then
    echo "❌ Thread log not found: $thread_log"
    return 1
  fi

  echo "📊 Thread Statistics:"

  # Count total events
  local total_events=$(wc -l < "$thread_log")
  echo "  Total events: $total_events"

  # Count event types
  local msg_events=$(grep -c '"type":"msg"' "$thread_log" 2>/dev/null || echo 0)
  local read_events=$(grep -c '"type":"read"' "$thread_log" 2>/dev/null || echo 0)

  echo "  Messages: $msg_events"
  echo "  Read receipts: $read_events"

  # Check for duplicate sequences (basic check using jq if available)
  if command -v jq &> /dev/null; then
    # Extract all sequence numbers
    local all_seqs=$(cat "$thread_log" | jq -r .seq | wc -l)
    local unique_seqs=$(cat "$thread_log" | jq -r .seq | sort -u | wc -l)

    if [ "$all_seqs" -eq "$unique_seqs" ]; then
      echo "  ✓ No sequence collisions ($unique_seqs unique sequences)"
    else
      echo "  ❌ Sequence collisions detected! ($all_seqs total, $unique_seqs unique)"
      return 1
    fi

    # Check for up_to_seq in messages
    local msgs_with_up_to=$(grep '"type":"msg"' "$thread_log" | jq -r 'select(.up_to_seq != null) | .seq' | wc -l)
    if [ "$msgs_with_up_to" -eq "$msg_events" ]; then
      echo "  ✓ All messages have up_to_seq field"
    else
      echo "  ⚠️  Some messages missing up_to_seq field"
    fi
  else
    echo "  Note: Install jq for detailed sequence analysis"
  fi

  # Check for read receipt spam
  if [ "$read_events" = "0" ] || [ -z "$read_events" ]; then
    echo "  ✓ No read receipt spam"
  else
    echo "  ⚠️  Found $read_events read receipts (expected 0)"
  fi

  # Show sample messages
  if [ $msg_events -gt 0 ]; then
    echo ""
    echo "  First few messages:"
    if command -v jq &> /dev/null; then
      grep '"type":"msg"' "$thread_log" | head -5 | while read line; do
        local from=$(echo "$line" | jq -r .from)
        local text=$(echo "$line" | jq -r .text)
        echo "    [$from] $text"
      done
    else
      grep '"type":"msg"' "$thread_log" | head -5 | while read line; do
        # Basic extraction without jq
        local from=$(echo "$line" | sed 's/.*"from":"\([^"]*\)".*/\1/')
        local text=$(echo "$line" | sed 's/.*"text":"\([^"]*\)".*/\1/')
        echo "    [$from] $text"
      done
    fi
  fi

  return 0
}