from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

from .config import AppConfig, load_config
from .errors import AgentApiError
from .http_client import (
    build_url,
    encode_json_payload,
    execute_request,
    parse_header_items,
    parse_query_items,
)
from .openapi import load_openapi, search_operations, show_operation
from .policy import validate_policy
from .session import get_session_token_name, set_session_token_name


@dataclass(frozen=True)
class RuntimeContext:
    config: AppConfig
    token_name: str
    token_value: str


def _resolve_token_name(
    config: AppConfig,
    *,
    session_token_name: str | None,
    override_token_name: str | None,
) -> str:
    if override_token_name:
        return override_token_name

    if session_token_name and session_token_name in config.env_config.tokens:
        return session_token_name

    return config.default_token


def load_runtime_context(
    config_path: str | Path | None,
    *,
    override_token_name: str | None = None,
) -> RuntimeContext:
    config = load_config(config_path)
    session_token_name = get_session_token_name(config.path.parent)
    token_name = _resolve_token_name(
        config,
        session_token_name=session_token_name,
        override_token_name=override_token_name,
    )

    token_value = config.env_config.tokens.get(token_name)
    if token_value is None:
        raise AgentApiError(
            "ERR_TOKEN_NOT_FOUND",
            f"Token '{token_name}' is not defined for the active environment.",
        )

    return RuntimeContext(config=config, token_name=token_name, token_value=token_value)


def _format_auth_header(token_value: str) -> str:
    stripped = token_value.strip()
    if stripped.lower().startswith("bearer "):
        return stripped
    return f"Bearer {stripped}"


def _write_json(data: Any) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))


def cmd_context_show(args: argparse.Namespace) -> int:
    context = load_runtime_context(args.config)
    env = context.config.env_config
    _write_json(
        {
            "active_project": context.config.active_project,
            "active_env": context.config.active_env,
            "api_base": env.api_base,
            "api_mode": env.api_mode,
            "openapi_url": env.openapi_url,
            "active_token": context.token_name,
            "available_tokens": sorted(env.tokens.keys()),
            "config_path": str(context.config.path),
        }
    )
    return 0


def cmd_token_list(args: argparse.Namespace) -> int:
    context = load_runtime_context(args.config)
    for token_name in sorted(context.config.env_config.tokens.keys()):
        marker = "*" if token_name == context.token_name else " "
        print(f"{marker} {token_name}")
    return 0


def cmd_token_use(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    if args.token_name not in config.env_config.tokens:
        raise AgentApiError(
            "ERR_TOKEN_NOT_FOUND",
            f"Token '{args.token_name}' is not defined for the active environment.",
        )

    session_path = set_session_token_name(config.path.parent, args.token_name)
    print(f"Active session token set to '{args.token_name}' ({session_path})")
    return 0


def cmd_spec_pull(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    cached = load_openapi(config, force_refresh=args.force)
    print(
        f"OpenAPI loaded from {cached.source}: "
        f"{cached.cache_path} ({config.active_project}/{config.active_env})"
    )
    return 0


def cmd_spec_search(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    cached = load_openapi(config)
    results = search_operations(cached.spec, args.query)
    if not results:
        print("No matching operations found.")
        return 0

    print(f"Results ({len(results)}) from {cached.source}:")
    for item in results:
        summary = item.get("summary", "")
        op_id = item.get("operationId", "")
        print(
            f"{item['score']:>2}  {item['method']:<7} {item['path']:<40} "
            f"{op_id} {summary}".strip()
        )
    return 0


def cmd_spec_show(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    cached = load_openapi(config)
    operation = show_operation(cached.spec, args.method, args.path_template)
    _write_json(operation)
    return 0


def cmd_call(args: argparse.Namespace) -> int:
    context = load_runtime_context(args.config, override_token_name=args.token)
    env = context.config.env_config
    method = args.method.upper()

    payload_bytes, payload_obj = encode_json_payload(args.json, args.json_file)
    validate_policy(
        api_mode=env.api_mode,
        method=method,
        json_body=payload_obj,
        confirm_delete=args.confirm_delete,
    )

    query_pairs = parse_query_items(args.query)
    url = build_url(env.api_base, args.path, query_pairs)

    headers = parse_header_items(args.header)
    headers["Authorization"] = _format_auth_header(context.token_value)
    if payload_bytes is not None and "Content-Type" not in headers and "content-type" not in {
        key.lower() for key in headers
    }:
        headers["Content-Type"] = "application/json"

    result = execute_request(
        method=method,
        url=url,
        headers=headers,
        body=payload_bytes,
    )

    print(f"HTTP {result.status}")
    if result.body:
        print(result.body.decode("utf-8", errors="replace"))
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agent-api")
    parser.add_argument(
        "--config",
        help="Path to config TOML (defaults to ./config.toml or ./config.example.toml).",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # context show
    parser_context = subparsers.add_parser("context", help="View active context.")
    context_subparsers = parser_context.add_subparsers(dest="context_command", required=True)
    parser_context_show = context_subparsers.add_parser("show", help="Show active project/env/mode/token.")
    parser_context_show.set_defaults(func=cmd_context_show)

    # token list/use
    parser_token = subparsers.add_parser("token", help="List or switch token profile.")
    token_subparsers = parser_token.add_subparsers(dest="token_command", required=True)
    parser_token_list = token_subparsers.add_parser("list", help="List tokens for active environment.")
    parser_token_list.set_defaults(func=cmd_token_list)
    parser_token_use = token_subparsers.add_parser("use", help="Set session token for active environment.")
    parser_token_use.add_argument("token_name")
    parser_token_use.set_defaults(func=cmd_token_use)

    # spec pull/search/show
    parser_spec = subparsers.add_parser("spec", help="OpenAPI operations.")
    spec_subparsers = parser_spec.add_subparsers(dest="spec_command", required=True)
    parser_spec_pull = spec_subparsers.add_parser("pull", help="Fetch and cache OpenAPI spec.")
    parser_spec_pull.add_argument("--force", action="store_true", help="Force a network refresh.")
    parser_spec_pull.set_defaults(func=cmd_spec_pull)
    parser_spec_search = spec_subparsers.add_parser("search", help="Search API operations.")
    parser_spec_search.add_argument("query")
    parser_spec_search.set_defaults(func=cmd_spec_search)
    parser_spec_show = spec_subparsers.add_parser("show", help="Show an operation from OpenAPI.")
    parser_spec_show.add_argument("method")
    parser_spec_show.add_argument("path_template")
    parser_spec_show.set_defaults(func=cmd_spec_show)

    # call
    parser_call = subparsers.add_parser("call", help="Execute a policy-checked API call.")
    parser_call.add_argument("-X", "--method", required=True, help="HTTP method.")
    parser_call.add_argument("path", help="Relative API path, for example /products.")
    parser_call.add_argument("--query", action="append", help="Query item in key=value format.")
    parser_call.add_argument("--json", help="Inline JSON payload.")
    parser_call.add_argument("--json-file", help="Path to JSON payload file.")
    parser_call.add_argument("--header", action="append", help="Extra request header in 'Name: value' form.")
    parser_call.add_argument("--token", help="Override token name for this request.")
    parser_call.add_argument(
        "--confirm-delete",
        action="store_true",
        help="Required to run DELETE in full-access mode.",
    )
    parser_call.set_defaults(func=cmd_call)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        return int(args.func(args))
    except AgentApiError as exc:
        print(f"ERROR {exc.code}: {exc.message}", file=sys.stderr)
        if exc.suggested_fix:
            print(f"Suggestion: {exc.suggested_fix}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
