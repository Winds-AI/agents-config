package agentapi

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConfig(t *testing.T, path string, mode string, defaultToken string) {
	t.Helper()
	content := `
active_project = "myproject"
active_env = "dev"
default_token = "` + defaultToken + `"

[projects.myproject.envs.dev]
api_base = "https://api.dev.local"
api_mode = "` + mode + `"
openapi_url = "https://api.dev.local/openapi.json"

[projects.myproject.envs.dev.tokens]
dev_superuser = "token-a"
dev_user = "token-b"
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
}

func TestLoadConfigSuccess(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "config.toml")
	writeConfig(t, path, "safe-updates", "dev_superuser")

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig error: %v", err)
	}

	if cfg.ActiveProject != "myproject" || cfg.ActiveEnv != "dev" {
		t.Fatalf("unexpected active context: %+v", cfg)
	}
}

func TestLoadConfigInvalidMode(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "config.toml")
	writeConfig(t, path, "invalid", "dev_superuser")

	_, err := LoadConfig(path)
	if err == nil {
		t.Fatal("expected error")
	}
	appErr := err.(*AppError)
	if appErr.Code != "ERR_CONTEXT_INVALID" {
		t.Fatalf("unexpected code: %s", appErr.Code)
	}
}

func TestLoadConfigMissingDefaultToken(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "config.toml")
	writeConfig(t, path, "safe-updates", "missing")

	_, err := LoadConfig(path)
	if err == nil {
		t.Fatal("expected error")
	}
	appErr := err.(*AppError)
	if appErr.Code != "ERR_CONTEXT_INVALID" {
		t.Fatalf("unexpected code: %s", appErr.Code)
	}
}
