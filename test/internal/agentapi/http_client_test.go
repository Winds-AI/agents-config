package agentapi

import "testing"

func TestBuildURLBlocksAbsolutePath(t *testing.T) {
	_, err := BuildURL("https://api.dev.local", "https://evil.local/x", nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_BASE_URL_OVERRIDE_BLOCKED" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}
}

func TestParseQueryItems(t *testing.T) {
	pairs, err := ParseQueryItems([]string{"a=1", "b=hello"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pairs) != 2 || pairs[0].Key != "a" || pairs[1].Value != "hello" {
		t.Fatalf("unexpected pairs: %+v", pairs)
	}

	_, err = ParseQueryItems([]string{"bad"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseHeaderBlocksAuthorization(t *testing.T) {
	_, err := ParseHeaderItems([]string{"Authorization: Bearer custom"})
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_BASE_URL_OVERRIDE_BLOCKED" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}
}

func TestEncodeJSONPayload(t *testing.T) {
	body, parsed, err := EncodeJSONPayload(`{"name":"x"}`, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if body == nil || parsed == nil {
		t.Fatalf("expected payload and parsed object")
	}

	_, _, err = EncodeJSONPayload(`{"name":"x"}`, "payload.json")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestExecuteRequestReportsInvalidURL(t *testing.T) {
	_, err := ExecuteRequest("GET", "not-a-url", map[string]string{}, nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_CONTEXT_INVALID" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}
}
