package agentapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type sessionState struct {
	TokenName string `json:"token_name"`
}

func sessionDir(configDir string) string {
	return filepath.Join(configDir, ".agent-api")
}

func sessionFile(configDir string) string {
	return filepath.Join(sessionDir(configDir), "session.json")
}

func GetSessionTokenName(configDir string) string {
	path := sessionFile(configDir)
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	var state sessionState
	if err := json.Unmarshal(data, &state); err != nil {
		return ""
	}

	return strings.TrimSpace(state.TokenName)
}

func SetSessionTokenName(configDir string, tokenName string) (string, error) {
	if strings.TrimSpace(tokenName) == "" {
		return "", NewAppError("ERR_TOKEN_NOT_FOUND", "Token name cannot be empty.")
	}

	dir := sessionDir(configDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", NewAppError("ERR_CONTEXT_INVALID", "Failed to create session directory.")
	}

	path := sessionFile(configDir)
	payload, err := json.MarshalIndent(sessionState{TokenName: tokenName}, "", "  ")
	if err != nil {
		return "", NewAppError("ERR_CONTEXT_INVALID", "Failed to serialize session state.")
	}

	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return "", NewAppError("ERR_CONTEXT_INVALID", "Failed to write session state.")
	}

	return path, nil
}
