"""Deterministically export backend-owned browser contracts."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from deeptutor.app.contracts import TurnRequest

from .turn_protocol import (
    ErrorEnvelope,
    RuntimeStatus,
    SessionDetail,
    SessionSummary,
    TurnProtocolDocument,
)


PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "web" / "contracts" / "schema"
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace"}


def _json_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _merge_model_schema(components: dict[str, Any], model: type[BaseModel]) -> None:
    schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
    definitions = schema.pop("$defs", {})
    components.update(definitions)
    components[model.__name__] = schema


def _deduplicate_operation_ids(openapi: dict[str, Any]) -> None:
    """Make FastAPI GET/HEAD aliases safe for TypeScript code generation."""

    seen: set[str] = set()
    for path_item in openapi.get("paths", {}).values():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if not operation_id or operation_id not in seen:
                if operation_id:
                    seen.add(operation_id)
                continue

            candidate = f"{operation_id}_{method}"
            suffix = 2
            while candidate in seen:
                candidate = f"{operation_id}_{method}_{suffix}"
                suffix += 1
            operation["operationId"] = candidate
            seen.add(candidate)


def render_contracts() -> dict[str, str]:
    from deeptutor.api.main import app

    openapi = deepcopy(app.openapi())
    _deduplicate_operation_ids(openapi)
    schemas = openapi.setdefault("components", {}).setdefault("schemas", {})
    for model in (TurnRequest, RuntimeStatus, SessionSummary, SessionDetail, ErrorEnvelope):
        _merge_model_schema(schemas, model)
    openapi["x-deeptutor-web-protocol-version"] = "2.0"

    protocol = TurnProtocolDocument.model_json_schema()
    return {
        "openapi.json": _json_text(openapi),
        "turn-protocol.json": _json_text(protocol),
    }


def write_contracts(output_dir: Path, *, check: bool = False) -> list[str]:
    rendered = render_contracts()
    changed: list[str] = []
    for filename, content in rendered.items():
        target = output_dir / filename
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current == content:
            continue
        changed.append(filename)
        if not check:
            output_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when artifacts drift")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args(argv)

    changed = write_contracts(args.output_dir, check=args.check)
    if args.check and changed:
        print("Frontend contract drift: " + ", ".join(changed))
        return 1
    if changed:
        print("Updated frontend contracts: " + ", ".join(changed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
