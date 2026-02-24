package agentapi

import (
	"os"
	"path/filepath"
	"testing"
)

func writeRuntimeConfig(t *testing.T, dir string) string {
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

func TestLoadRuntimeContextDefaultToken(t *testing.T) {
	tmp := t.TempDir()
	configPath := writeRuntimeConfig(t, tmp)

	ctx, err := LoadRuntimeContext(configPath, "")
	if err != nil {
		t.Fatalf("LoadRuntimeContext error: %v", err)
	}
	if ctx.TokenName != "dev_superuser" || ctx.TokenValue != "token-a" {
		t.Fatalf("unexpected token context: %+v", ctx)
	}
}

func TestLoadRuntimeContextSessionToken(t *testing.T) {
	tmp := t.TempDir()
	configPath := writeRuntimeConfig(t, tmp)
	if _, err := SetSessionTokenName(tmp, "dev_user"); err != nil {
		t.Fatalf("SetSessionTokenName error: %v", err)
	}

	ctx, err := LoadRuntimeContext(configPath, "")
	if err != nil {
		t.Fatalf("LoadRuntimeContext error: %v", err)
	}
	if ctx.TokenName != "dev_user" || ctx.TokenValue != "token-b" {
		t.Fatalf("unexpected token context: %+v", ctx)
	}
}

func TestLoadRuntimeContextOverrideWins(t *testing.T) {
	tmp := t.TempDir()
	configPath := writeRuntimeConfig(t, tmp)
	if _, err := SetSessionTokenName(tmp, "dev_user"); err != nil {
		t.Fatalf("SetSessionTokenName error: %v", err)
	}

	ctx, err := LoadRuntimeContext(configPath, "dev_superuser")
	if err != nil {
		t.Fatalf("LoadRuntimeContext error: %v", err)
	}
	if ctx.TokenName != "dev_superuser" || ctx.TokenValue != "token-a" {
		t.Fatalf("unexpected token context: %+v", ctx)
	}
}
