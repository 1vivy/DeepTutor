"""Canonical message builders for agentic conversations."""

from __future__ import annotations

from typing import Any


def assistant_message_with_tool_calls(
    content: str,
    tool_calls: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the assistant message that precedes tool result messages."""
    serialized: list[dict[str, Any]] = []
    for tool_call in tool_calls:
        entry: dict[str, Any] = {
            "id": tool_call["id"],
            "type": "function",
            "function": {
                "name": tool_call["name"],
                "arguments": tool_call.get("arguments") or "{}",
            },
        }
        # Keep provider markers (e.g. the server_executed flag on a native
        # web_search call) so the Responses converter can replay the call as
        # its native output-item type instead of a client-side function call.
        fields = tool_call.get("provider_specific_fields")
        if isinstance(fields, dict) and fields:
            entry["provider_specific_fields"] = dict(fields)
        serialized.append(entry)
    return {
        "role": "assistant",
        "content": content or None,
        "tool_calls": serialized,
    }


__all__ = ["assistant_message_with_tool_calls"]
