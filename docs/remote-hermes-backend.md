# Remote Hermes Agent backend

DeepTutor Connected Agents can call a Hermes Agent gateway without installing a
Hermes CLI in the DeepTutor container. The backend kind is `hermes_remote` and
its display name is **Hermes Agent (remote)**.

## Configuration

The per-backend settings live under `backends.hermes_remote` in the normal
`subagent.json` settings document:

- `enabled`: whether chat may delegate to this backend.
- `base_url`: gateway root, for example `http://hermes-uni:8642`.
- `api_key_env`: environment-variable name containing the gateway bearer. It
  defaults to `DEEPTUTOR_HERMES_REMOTE_API_KEY`.
- `profile`: informational deployment/profile label; it is not a credential and
  is not used to construct a URL.
- `model`, `effort`, `system_prompt`, `auto_approve`: the run controls shared
  with local backends.
- `idle_timeout_seconds`: maximum idle interval between SSE frames (default
  `600`). Keepalives from the gateway reset this watchdog.

The API key is environment-only. It is never accepted as an inline settings
field, persisted, or returned by `GET /api/subagents/settings`.

## HTTP contract

The adapter uses an authenticated bearer request (`Authorization: Bearer ...`)
with explicit connect/read/write/pool timeouts. The API server's endpoint list
is documented in `gateway/platforms/api_server.py` lines 4-24 and the machine
capabilities response is at lines 3148-3232.

1. `GET /v1/models` detects availability. A successful response is an OpenAI
   model list (`{"object":"list","data":[...]}`), as implemented at lines
   3063-3109. Detection reports distinct `not_configured`, `key_missing`,
   `unreachable`, `unauthorized`, and `incompatible` details.
2. `POST /v1/runs` starts a run. The request uses `input` for the user prompt,
   `instructions` for the optional first-session system instruction, `model`
   when configured, `model_options.reasoning_effort` when configured, and
   `session_id` when resuming. The server accepts those fields at lines
   6695-6776 and returns HTTP 202 with `{ "run_id": "...", "status":
   "started" }` at lines 7088-7095. A fresh run uses its run id as the session
   id (lines 6768-6770); a resumed run keeps the supplied session id.
   Before a resumed run, the adapter fetches
   `GET /api/sessions/{session_id}/messages`. It keeps only non-empty
   user/assistant rows, excludes tool rows, and sends at most the last 40 rows
   as `conversation_history`. A 404 means the session is gone: the run starts
   fresh without history and applies `system_prompt` again.
3. `GET /v1/runs/{run_id}/events` is an SSE stream. Frames contain JSON in a
   `data:` line (the server serializer is at lines 188-207). The adapter
   consumes these event objects:
   `message.delta` (`delta`), `tool.started` (`tool`, `preview`),
   `tool.completed` (`tool`, `error`), `reasoning.available` (`text`),
   `approval.request`, `run.completed` (`output`), `run.failed` (`error`), and
   `run.cancelled`. Tool lifecycle events become tool/tool-result rows;
   answer deltas become cumulative text under merge id
   `hermes_remote:final`; other lifecycle events become log/error rows. The
   server's run callback emits tool/reasoning events at lines 6588-6679,
   text/completion events at lines 6791-6804 and 6981-6997, and approval events
   at lines 6848-6875.
4. `POST /v1/runs/{run_id}/approval` resolves a pending approval. The body is
   `{ "choice": "once" }` for auto-approve and `{ "choice": "deny" }` when
   `auto_approve` is false. The accepted choices and response are implemented
   at lines 7164-7250. A failed approval response is surfaced and the run is
   stopped instead of waiting indefinitely.
5. `POST /v1/runs/{run_id}/stop` interrupts a run. Cancellation posts this
   request with a shielded, bounded cleanup window, then re-raises cancellation;
   an SSE idle timeout posts it and returns an error. The server's stop behavior
   is at lines 7312-7342.

Session continuity uses both the gateway's documented
`X-Hermes-Session-Id` header and `session_id` request field. The adapter also
sends the compatibility `X-Hermes-Session` header. Custom `system_prompt` is
sent on a fresh session or when the history lookup reports that the session is
gone (404). Every request carries the fixed
`CONSULT_ORIGIN_INSTRUCTION` recursion guard identifying DeepTutor Connected
Agents and telling the gateway agent to answer directly rather than delegate
back to DeepTutor.

The `/v1/runs` API has no image upload field. Image paths are therefore listed
in the prompt, matching the local Hermes backend's fallback behavior; the
remote agent must have a way to read those paths for them to be useful.

## Isolation and security

This backend keeps the Hermes gateway outside the DeepTutor process/container:
tools run on the gateway host, not in DeepTutor. Scope each DeepTutor chat to
its own returned session id; do not share session ids across users or chats.
Keep `API_SERVER_KEY` (the gateway's server-side secret) and
`DEEPTUTOR_HERMES_REMOTE_API_KEY` (the DeepTutor-side env name's value) out of
settings files, logs, event text, and frontend payloads.

Streaming is quiet except for the structured SSE lifecycle exposed by the
adapter. It does not poll or retry `POST /v1/runs`; a caller cancellation or
idle watchdog always attempts a bounded stop.
