package agentapi

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

var validModes = map[string]struct{}{
	"read-only":    {},
	"safe-updates": {},
	"full-access":  {},
}

type rawConfig struct {
	ActiveProject string                `toml:"active_project"`
	ActiveEnv     string                `toml:"active_env"`
	DefaultToken  string                `toml:"default_token"`
	Projects      map[string]rawProject `toml:"projects"`
}

type rawProject struct {
	Envs map[string]rawEnv `toml:"envs"`
}

type rawEnv struct {
	APIBase    string            `toml:"api_base"`
	APIMode    string            `toml:"api_mode"`
	OpenAPIURL string            `toml:"openapi_url"`
	Tokens     map[string]string `toml:"tokens"`
}

type EnvConfig struct {
	Project    string
	Env        string
	APIBase    string
	APIMode    string
	OpenAPIURL string
	Tokens     map[string]string
}

type AppConfig struct {
	Path          string
	ActiveProject string
	ActiveEnv     string
	DefaultToken  string
	EnvConfig     EnvConfig
}

func normalizeConfigPath(path string) (string, error) {
	if strings.TrimSpace(path) != "" {
		resolved, err := filepath.Abs(path)
		if err != nil {
			return "", NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Unable to resolve config path '%s'.", path))
		}
		if _, err := os.Stat(resolved); err != nil {
			return "", NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Config file not found: %s", resolved))
		}
		return resolved, nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", NewAppError("ERR_CONTEXT_INVALID", "Unable to determine current working directory.")
	}

	candidates := []string{
		filepath.Join(cwd, "config.toml"),
		filepath.Join(cwd, "config.example.toml"),
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			resolved, err := filepath.Abs(candidate)
			if err != nil {
				return "", NewAppError("ERR_CONTEXT_INVALID", "Unable to resolve config file path.")
			}
			return resolved, nil
		}
	}

	return "", NewAppError(
		"ERR_CONTEXT_INVALID",
		"No config file found. Create config.toml or pass --config.",
	)
}

func requireNonEmpty(value string, field string) error {
	if strings.TrimSpace(value) == "" {
		return NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Missing or invalid '%s' in config.", field))
	}
	return nil
}

func LoadConfig(configPath string) (AppConfig, error) {
	resolvedPath, err := normalizeConfigPath(configPath)
	if err != nil {
		return AppConfig{}, err
	}

	var raw rawConfig
	if _, err := toml.DecodeFile(resolvedPath, &raw); err != nil {
		return AppConfig{}, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Failed to parse config: %v", err))
	}

	if err := requireNonEmpty(raw.ActiveProject, "active_project"); err != nil {
		return AppConfig{}, err
	}
	if err := requireNonEmpty(raw.ActiveEnv, "active_env"); err != nil {
		return AppConfig{}, err
	}
	if err := requireNonEmpty(raw.DefaultToken, "default_token"); err != nil {
		return AppConfig{}, err
	}

	project, ok := raw.Projects[raw.ActiveProject]
	if !ok {
		return AppConfig{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Active project '%s' not found in [projects].", raw.ActiveProject),
		)
	}

	env, ok := project.Envs[raw.ActiveEnv]
	if !ok {
		return AppConfig{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Active env '%s' not found under project '%s'.", raw.ActiveEnv, raw.ActiveProject),
		)
	}

	if err := requireNonEmpty(env.APIBase, "api_base"); err != nil {
		return AppConfig{}, err
	}
	if err := requireNonEmpty(env.APIMode, "api_mode"); err != nil {
		return AppConfig{}, err
	}
	if err := requireNonEmpty(env.OpenAPIURL, "openapi_url"); err != nil {
		return AppConfig{}, err
	}

	if _, ok := validModes[env.APIMode]; !ok {
		return AppConfig{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Invalid api_mode '%s'. Expected read-only, safe-updates, or full-access.", env.APIMode),
		)
	}

	if len(env.Tokens) == 0 {
		return AppConfig{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Missing [projects.%s.envs.%s.tokens] table.", raw.ActiveProject, raw.ActiveEnv),
		)
	}

	normalizedTokens := map[string]string{}
	for name, value := range env.Tokens {
		if strings.TrimSpace(name) == "" || strings.TrimSpace(value) == "" {
			return AppConfig{}, NewAppError(
				"ERR_CONTEXT_INVALID",
				"Token entries must contain non-empty names and values.",
			)
		}
		normalizedTokens[name] = value
	}

	if _, ok := normalizedTokens[raw.DefaultToken]; !ok {
		return AppConfig{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("default_token '%s' is not defined in active env token list.", raw.DefaultToken),
		)
	}

	return AppConfig{
		Path:          resolvedPath,
		ActiveProject: raw.ActiveProject,
		ActiveEnv:     raw.ActiveEnv,
		DefaultToken:  raw.DefaultToken,
		EnvConfig: EnvConfig{
			Project:    raw.ActiveProject,
			Env:        raw.ActiveEnv,
			APIBase:    env.APIBase,
			APIMode:    env.APIMode,
			OpenAPIURL: env.OpenAPIURL,
			Tokens:     normalizedTokens,
		},
	}, nil
}
