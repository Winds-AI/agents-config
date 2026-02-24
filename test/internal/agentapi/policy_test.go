package agentapi

import "testing"

func TestReadOnlyBlocksWrites(t *testing.T) {
	if err := ValidatePolicy("read-only", "GET", nil, false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	err := ValidatePolicy("read-only", "POST", map[string]any{"x": 1}, false)
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_METHOD_BLOCKED_BY_MODE" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}
}

func TestSafeUpdatesRequiresMarkers(t *testing.T) {
	okPayload := map[string]any{
		"name": "Widget [agent-test]",
		"meta": map[string]any{"description": "desc [agent-test]"},
	}
	if err := ValidatePolicy("safe-updates", "POST", okPayload, false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	badPayload := map[string]any{
		"name": "Widget [agent-test]",
		"meta": map[string]any{"description": "desc"},
	}
	err := ValidatePolicy("safe-updates", "POST", badPayload, false)
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_MARKER_MISSING" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}
}

func TestSafeUpdatesRejectDeleteAndUnmarkable(t *testing.T) {
	errDelete := ValidatePolicy("safe-updates", "DELETE", nil, false)
	if errDelete == nil || errDelete.(*AppError).Code != "ERR_METHOD_BLOCKED_BY_MODE" {
		t.Fatalf("unexpected error: %v", errDelete)
	}

	errUnmarkable := ValidatePolicy("safe-updates", "PATCH", map[string]any{"count": 1}, false)
	if errUnmarkable == nil || errUnmarkable.(*AppError).Code != "ERR_UNMARKABLE_PAYLOAD" {
		t.Fatalf("unexpected error: %v", errUnmarkable)
	}
}

func TestFullAccessDeleteRequiresConfirm(t *testing.T) {
	err := ValidatePolicy("full-access", "DELETE", nil, false)
	if err == nil {
		t.Fatal("expected error")
	}
	if err.(*AppError).Code != "ERR_DELETE_CONFIRMATION_REQUIRED" {
		t.Fatalf("unexpected error code: %s", err.(*AppError).Code)
	}

	if err := ValidatePolicy("full-access", "DELETE", nil, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
