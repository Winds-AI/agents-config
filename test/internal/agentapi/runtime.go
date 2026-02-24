package agentapi

import (
	"fmt"
	"path/filepath"
)

type RuntimeContext struct {
	Config     AppConfig
	TokenName  string
	TokenValue string
}

func resolveTokenName(config AppConfig, sessionTokenName string, overrideTokenName string) string {
	if overrideTokenName != "" {
		return overrideTokenName
	}
	if sessionTokenName != "" {
		if _, ok := config.EnvConfig.Tokens[sessionTokenName]; ok {
			return sessionTokenName
		}
	}
	return config.DefaultToken
}

func LoadRuntimeContext(configPath string, overrideTokenName string) (RuntimeContext, error) {
	config, err := LoadConfig(configPath)
	if err != nil {
		return RuntimeContext{}, err
	}

	configDir := filepath.Dir(config.Path)
	sessionToken := GetSessionTokenName(configDir)
	tokenName := resolveTokenName(config, sessionToken, overrideTokenName)
	tokenValue, ok := config.EnvConfig.Tokens[tokenName]
	if !ok {
		return RuntimeContext{}, NewAppError(
			"ERR_TOKEN_NOT_FOUND",
			fmt.Sprintf("Token '%s' is not defined for the active environment.", tokenName),
		)
	}

	return RuntimeContext{
		Config:     config,
		TokenName:  tokenName,
		TokenValue: tokenValue,
	}, nil
}
