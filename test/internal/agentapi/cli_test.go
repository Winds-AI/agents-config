package agentapi

import (
	"os"
	"path/filepath"
	"testing"
)

func writeCLITestConfig(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "config.toml")
	content := `
active_project = "myproject"
active_env = "dev"
default_token = "dev_superuser"

[projects.myproject.envs.dev]
api_base = "https://api.dev.local"
api_mode = "safe-updates"
openapi_url = "https://api.dev.local/openapi.json"

[projects.myproject.envs.dev.tokens]
dev_superuser = "token-a"
dev_user = "token-b"
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestRunCallParsesFlagsAfterPath(t *testing.T) {
	tmp := t.TempDir()
	configPath := writeCLITestConfig(t, tmp)

	err := runCall(configPath, []string{
		"-X", "POST",
		"/products",
		"--json", `{"name":"plain"}`,
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr := err.(*AppError)
	if appErr.Code != "ERR_MARKER_MISSING" {
		t.Fatalf("unexpected code: %s", appErr.Code)
	}
}

func TestRunCallParsesFlagsBeforePath(t *testing.T) {
	tmp := t.TempDir()
	configPath := writeCLITestConfig(t, tmp)

	err := runCall(configPath, []string{
		"-X", "POST",
		"--json", `{"name":"plain"}`,
		"/products",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	appErr := err.(*AppError)
	if appErr.Code != "ERR_MARKER_MISSING" {
		t.Fatalf("unexpected code: %s", appErr.Code)
	}
}
