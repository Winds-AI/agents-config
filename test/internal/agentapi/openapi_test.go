package agentapi

import "testing"

func buildSpec() map[string]any {
	return map[string]any{
		"openapi": "3.0.0",
		"paths": map[string]any{
			"/products": map[string]any{
				"get": map[string]any{
					"operationId": "listProducts",
					"summary":     "List products",
					"tags":        []any{"products"},
					"responses": map[string]any{
						"200": map[string]any{"description": "ok"},
					},
				},
				"post": map[string]any{
					"operationId": "createProduct",
					"summary":     "Create product",
					"tags":        []any{"products"},
					"requestBody": map[string]any{"content": map[string]any{"application/json": map[string]any{}}},
					"responses": map[string]any{
						"201": map[string]any{"description": "created"},
					},
				},
			},
			"/orders": map[string]any{
				"get": map[string]any{
					"operationId": "listOrders",
					"summary":     "List orders",
					"tags":        []any{"orders"},
					"responses": map[string]any{
						"200": map[string]any{"description": "ok"},
					},
				},
			},
		},
	}
}

func TestSearchOperationsRanksRelevantPaths(t *testing.T) {
	results := SearchOperations(buildSpec(), "create product", 20)
	if len(results) == 0 {
		t.Fatal("expected search results")
	}
	if results[0].Method != "POST" || results[0].Path != "/products" {
		t.Fatalf("unexpected top result: %+v", results[0])
	}
}

func TestShowOperationReturnsDetails(t *testing.T) {
	result, err := ShowOperation(buildSpec(), "POST", "/products")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["operationId"] != "createProduct" {
		t.Fatalf("unexpected operationId: %v", result["operationId"])
	}
	if _, ok := result["responses"]; !ok {
		t.Fatal("expected responses field")
	}
}
