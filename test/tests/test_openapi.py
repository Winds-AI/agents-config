from __future__ import annotations

from agent_api.openapi import search_operations, show_operation


def build_spec() -> dict:
    return {
        "openapi": "3.0.0",
        "paths": {
            "/products": {
                "get": {
                    "operationId": "listProducts",
                    "summary": "List products",
                    "tags": ["products"],
                    "responses": {"200": {"description": "ok"}},
                },
                "post": {
                    "operationId": "createProduct",
                    "summary": "Create product",
                    "tags": ["products"],
                    "requestBody": {"content": {"application/json": {}}},
                    "responses": {"201": {"description": "created"}},
                },
            },
            "/orders": {
                "get": {
                    "operationId": "listOrders",
                    "summary": "List orders",
                    "tags": ["orders"],
                    "responses": {"200": {"description": "ok"}},
                }
            },
        },
    }


def test_search_operations_ranks_relevant_paths() -> None:
    spec = build_spec()
    results = search_operations(spec, "create product")
    assert results
    assert results[0]["method"] == "POST"
    assert results[0]["path"] == "/products"


def test_show_operation_returns_detail_payload() -> None:
    spec = build_spec()
    result = show_operation(spec, "POST", "/products")
    assert result["operationId"] == "createProduct"
    assert "responses" in result
