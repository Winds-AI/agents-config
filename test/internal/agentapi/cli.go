package agentapi

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type stringSliceFlag []string

func (s *stringSliceFlag) String() string {
	return strings.Join(*s, ",")
}

func (s *stringSliceFlag) Set(value string) error {
	*s = append(*s, value)
	return nil
}

func printJSON(value any) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return NewAppError("ERR_CONTEXT_INVALID", "Failed to encode JSON output.")
	}
	fmt.Println(string(encoded))
	return nil
}

func formatAuthHeader(tokenValue string) string {
	trimmed := strings.TrimSpace(tokenValue)
	if strings.HasPrefix(strings.ToLower(trimmed), "bearer ") {
		return trimmed
	}
	return "Bearer " + trimmed
}

func hasHeaderCaseInsensitive(headers map[string]string, target string) bool {
	for key := range headers {
		if strings.EqualFold(key, target) {
			return true
		}
	}
	return false
}

func parseGlobalFlags(argv []string) (string, []string, error) {
	configPath := ""
	remaining := make([]string, 0, len(argv))

	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		switch arg {
		case "--config":
			if i+1 >= len(argv) {
				return "", nil, NewAppError("ERR_CONTEXT_INVALID", "--config requires a file path.")
			}
			configPath = argv[i+1]
			i++
		default:
			if strings.HasPrefix(arg, "--config=") {
				configPath = strings.TrimPrefix(arg, "--config=")
				continue
			}
			remaining = append(remaining, arg)
		}
	}

	return configPath, remaining, nil
}

func usage() string {
	return `usage: agent-api [--config PATH] {context,token,spec,call} ...

commands:
  context show
  token list
  token use <token_name>
  spec pull [--force]
  spec search "<query>"
  spec show <METHOD> <PATH_TEMPLATE>
  call -X <METHOD> <PATH> [--query k=v] [--json JSON | --json-file FILE] [--header "K: V"] [--token TOKEN] [--confirm-delete]
`
}

func runContext(configPath string, args []string) error {
	if len(args) != 1 || args[0] != "show" {
		return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api context show")
	}

	ctx, err := LoadRuntimeContext(configPath, "")
	if err != nil {
		return err
	}

	availableTokens := make([]string, 0, len(ctx.Config.EnvConfig.Tokens))
	for name := range ctx.Config.EnvConfig.Tokens {
		availableTokens = append(availableTokens, name)
	}
	sort.Strings(availableTokens)

	return printJSON(map[string]any{
		"active_project":   ctx.Config.ActiveProject,
		"active_env":       ctx.Config.ActiveEnv,
		"api_base":         ctx.Config.EnvConfig.APIBase,
		"api_mode":         ctx.Config.EnvConfig.APIMode,
		"openapi_url":      ctx.Config.EnvConfig.OpenAPIURL,
		"active_token":     ctx.TokenName,
		"available_tokens": availableTokens,
		"config_path":      ctx.Config.Path,
	})
}

func runToken(configPath string, args []string) error {
	if len(args) < 1 {
		return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api token {list|use <token_name>}")
	}

	switch args[0] {
	case "list":
		ctx, err := LoadRuntimeContext(configPath, "")
		if err != nil {
			return err
		}
		names := make([]string, 0, len(ctx.Config.EnvConfig.Tokens))
		for name := range ctx.Config.EnvConfig.Tokens {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			marker := " "
			if name == ctx.TokenName {
				marker = "*"
			}
			fmt.Printf("%s %s\n", marker, name)
		}
		return nil

	case "use":
		if len(args) != 2 {
			return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api token use <token_name>")
		}
		config, err := LoadConfig(configPath)
		if err != nil {
			return err
		}
		tokenName := args[1]
		if _, ok := config.EnvConfig.Tokens[tokenName]; !ok {
			return NewAppError(
				"ERR_TOKEN_NOT_FOUND",
				fmt.Sprintf("Token '%s' is not defined for the active environment.", tokenName),
			)
		}
		sessionPath, err := SetSessionTokenName(filepath.Dir(config.Path), tokenName)
		if err != nil {
			return err
		}
		fmt.Printf("Active session token set to '%s' (%s)\n", tokenName, sessionPath)
		return nil
	}

	return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api token {list|use <token_name>}")
}

func runSpec(configPath string, args []string) error {
	if len(args) < 1 {
		return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api spec {pull|search|show}")
	}

	config, err := LoadConfig(configPath)
	if err != nil {
		return err
	}

	switch args[0] {
	case "pull":
		fs := flag.NewFlagSet("spec pull", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		force := fs.Bool("force", false, "")
		if err := fs.Parse(args[1:]); err != nil {
			return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api spec pull [--force]")
		}
		cached, err := LoadOpenAPI(config, *force)
		if err != nil {
			return err
		}
		fmt.Printf(
			"OpenAPI loaded from %s: %s (%s/%s)\n",
			cached.Source,
			cached.CachePath,
			config.ActiveProject,
			config.ActiveEnv,
		)
		return nil

	case "search":
		if len(args) < 2 {
			return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api spec search \"<query>\"")
		}
		query := strings.Join(args[1:], " ")
		cached, err := LoadOpenAPI(config, false)
		if err != nil {
			return err
		}
		results := SearchOperations(cached.Spec, query, 20)
		if len(results) == 0 {
			fmt.Println("No matching operations found.")
			return nil
		}
		fmt.Printf("Results (%d) from %s:\n", len(results), cached.Source)
		for _, item := range results {
			fmt.Printf(
				"%2d  %-7s %-40s %s %s\n",
				item.Score,
				item.Method,
				item.Path,
				item.OperationID,
				item.Summary,
			)
		}
		return nil

	case "show":
		if len(args) != 3 {
			return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api spec show <METHOD> <PATH_TEMPLATE>")
		}
		cached, err := LoadOpenAPI(config, false)
		if err != nil {
			return err
		}
		operation, err := ShowOperation(cached.Spec, args[1], args[2])
		if err != nil {
			return err
		}
		return printJSON(operation)
	}

	return NewAppError("ERR_CONTEXT_INVALID", "Usage: agent-api spec {pull|search|show}")
}

func runCall(configPath string, args []string) error {
	method := ""
	path := ""
	var queries []string
	var headers []string
	jsonInline := ""
	jsonFile := ""
	tokenName := ""
	confirmDelete := false

	readNext := func(i *int, label string) (string, error) {
		*i = *i + 1
		if *i >= len(args) {
			return "", NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("%s requires a value.", label))
		}
		return args[*i], nil
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-X" || arg == "--method":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			method = value

		case strings.HasPrefix(arg, "--method="):
			method = strings.TrimPrefix(arg, "--method=")

		case strings.HasPrefix(arg, "--query="):
			queries = append(queries, strings.TrimPrefix(arg, "--query="))

		case arg == "--query":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			queries = append(queries, value)

		case strings.HasPrefix(arg, "--header="):
			headers = append(headers, strings.TrimPrefix(arg, "--header="))

		case arg == "--header":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			headers = append(headers, value)

		case strings.HasPrefix(arg, "--json="):
			jsonInline = strings.TrimPrefix(arg, "--json=")

		case arg == "--json":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			jsonInline = value

		case strings.HasPrefix(arg, "--json-file="):
			jsonFile = strings.TrimPrefix(arg, "--json-file=")

		case arg == "--json-file":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			jsonFile = value

		case strings.HasPrefix(arg, "--token="):
			tokenName = strings.TrimPrefix(arg, "--token=")

		case arg == "--token":
			value, err := readNext(&i, arg)
			if err != nil {
				return err
			}
			tokenName = value

		case arg == "--confirm-delete":
			confirmDelete = true

		default:
			if strings.HasPrefix(arg, "-") {
				return NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Unknown call option '%s'.", arg))
			}
			if path != "" {
				return NewAppError("ERR_CONTEXT_INVALID", "call requires a single <PATH> argument.")
			}
			path = arg
		}
	}

	method = strings.TrimSpace(method)
	if method == "" {
		return NewAppError("ERR_CONTEXT_INVALID", "call requires -X or --method.")
	}
	if path == "" {
		return NewAppError("ERR_CONTEXT_INVALID", "call requires a single <PATH> argument.")
	}

	ctx, err := LoadRuntimeContext(configPath, strings.TrimSpace(tokenName))
	if err != nil {
		return err
	}

	payloadBytes, payloadObj, err := EncodeJSONPayload(jsonInline, jsonFile)
	if err != nil {
		return err
	}

	if err := ValidatePolicy(ctx.Config.EnvConfig.APIMode, method, payloadObj, confirmDelete); err != nil {
		return err
	}

	queryPairs, err := ParseQueryItems(queries)
	if err != nil {
		return err
	}
	finalURL, err := BuildURL(ctx.Config.EnvConfig.APIBase, path, queryPairs)
	if err != nil {
		return err
	}

	parsedHeaders, err := ParseHeaderItems(headers)
	if err != nil {
		return err
	}
	parsedHeaders["Authorization"] = formatAuthHeader(ctx.TokenValue)
	if payloadBytes != nil && !hasHeaderCaseInsensitive(parsedHeaders, "Content-Type") {
		parsedHeaders["Content-Type"] = "application/json"
	}

	result, err := ExecuteRequest(method, finalURL, parsedHeaders, payloadBytes)
	if err != nil {
		return err
	}

	fmt.Printf("HTTP %d\n", result.Status)
	if len(result.Body) > 0 {
		fmt.Println(string(result.Body))
	}
	return nil
}

func Run(argv []string) int {
	configPath, args, err := parseGlobalFlags(argv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR %s: %s\n", err.(*AppError).Code, err.(*AppError).Message)
		return 2
	}

	if len(args) == 0 {
		fmt.Fprint(os.Stderr, usage())
		return 2
	}

	var runErr error
	switch args[0] {
	case "context":
		runErr = runContext(configPath, args[1:])
	case "token":
		runErr = runToken(configPath, args[1:])
	case "spec":
		runErr = runSpec(configPath, args[1:])
	case "call":
		runErr = runCall(configPath, args[1:])
	case "-h", "--help", "help":
		fmt.Print(usage())
		return 0
	default:
		fmt.Fprint(os.Stderr, usage())
		return 2
	}

	if runErr != nil {
		appErr, ok := runErr.(*AppError)
		if !ok {
			fmt.Fprintf(os.Stderr, "ERROR: %v\n", runErr)
			return 2
		}
		fmt.Fprintf(os.Stderr, "ERROR %s: %s\n", appErr.Code, appErr.Message)
		if appErr.SuggestedFix != "" {
			fmt.Fprintf(os.Stderr, "Suggestion: %s\n", appErr.SuggestedFix)
		}
		return 2
	}

	return 0
}
