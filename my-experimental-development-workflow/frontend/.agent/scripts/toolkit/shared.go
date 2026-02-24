package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	toml "github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"
)

const (
	ExitSuccess         = 0
	ExitUnexpected      = 1
	ExitConfig          = 2
	ExitToken           = 3
	ExitOpenAPIFetch    = 4
	ExitOpenAPIParse    = 5
	ExitNotFound        = 6
	ExitBlockedByMode   = 7
	ExitMarkerMissing   = 8
	ExitRequestBuild    = 9
	ExitHTTPErrorStatus = 10
)

var (
	httpMethods = map[string]struct{}{
		"GET":     {},
		"POST":    {},
		"PUT":     {},
		"PATCH":   {},
		"DELETE":  {},
		"HEAD":    {},
		"OPTIONS": {},
	}
	openapiMethods = map[string]struct{}{
		"get":     {},
		"post":    {},
		"put":     {},
		"patch":   {},
		"delete":  {},
		"head":    {},
		"options": {},
		"trace":   {},
	}
)

const APIHelp = `NAME
  api - OpenAPI discovery and inspection

USAGE
  api find <query> [--method <HTTP_METHOD>]
  api show <operationId|"METHOD /path">`

const ACurlHelp = `NAME
  acurl - Config-aware curl wrapper with mode guardrails

USAGE
  acurl [METHOD] <path> [--token <token_name>] [-d <json_body>] [-H "Key: Value"]

NOTES
  METHOD defaults to GET when omitted.
  Path must start with '/'.
  Outputs backend response as compact JSON when response body is JSON.`

type CliError struct {
	Code    int
	Message string
}

func (e *CliError) Error() string {
	return e.Message
}

func NewCliError(code int, msg string) error {
	return &CliError{Code: code, Message: msg}
}

func ExitCode(err error) int {
	if err == nil {
		return ExitSuccess
	}
	var ce *CliError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ExitUnexpected
}

func ExitMessage(err error) string {
	if err == nil {
		return ""
	}
	var ce *CliError
	if errors.As(err, &ce) {
		return ce.Message
	}
	return fmt.Sprintf("Unexpected error: %v", err)
}

type fileConfig struct {
	ActiveProject string                  `toml:"active_project"`
	ActiveEnv     string                  `toml:"active_env"`
	DefaultToken  string                  `toml:"default_token"`
	AgentMarker   string                  `toml:"agent_marker"`
	Strict        *bool                   `toml:"strict"`
	Projects      map[string]projectEntry `toml:"projects"`
}

type projectEntry struct {
	Envs map[string]envEntry `toml:"envs"`
}

type envEntry struct {
	APIBase    string            `toml:"api_base"`
	APIMode    string            `toml:"api_mode"`
	OpenAPIURL string            `toml:"openapi_url"`
	Tokens     map[string]string `toml:"tokens"`
}

type ResolvedConfig struct {
	ActiveProject    string
	ActiveEnv        string
	DefaultTokenName string
	AgentMarker      string
	Strict           bool
	APIBase          string
	APIMode          string
	OpenAPIURL       string
	Tokens           map[string]string
}

func ResolveConfig(configPath string) (*ResolvedConfig, error) {
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Config file not found: %s", configPath))
	}

	var fc fileConfig
	if err := toml.Unmarshal(raw, &fc); err != nil {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Failed to parse TOML config %s: %v", configPath, err))
	}

	if strings.TrimSpace(fc.ActiveProject) == "" {
		return nil, NewCliError(ExitConfig, "Missing/invalid 'active_project' in config")
	}
	if strings.TrimSpace(fc.ActiveEnv) == "" {
		return nil, NewCliError(ExitConfig, "Missing/invalid 'active_env' in config")
	}
	if strings.TrimSpace(fc.DefaultToken) == "" {
		return nil, NewCliError(ExitConfig, "Missing/invalid 'default_token' in config")
	}
	if strings.TrimSpace(fc.AgentMarker) == "" {
		return nil, NewCliError(ExitConfig, "Missing/invalid 'agent_marker' in config")
	}
	if fc.Strict == nil {
		return nil, NewCliError(ExitConfig, "Missing/invalid 'strict' in config (expected true/false)")
	}

	project, ok := fc.Projects[fc.ActiveProject]
	if !ok {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Active project '%s' not found under [projects]", fc.ActiveProject))
	}
	envCfg, ok := project.Envs[fc.ActiveEnv]
	if !ok {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Active env '%s' not found under project '%s'", fc.ActiveEnv, fc.ActiveProject))
	}

	if strings.TrimSpace(envCfg.APIBase) == "" {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Missing/invalid api_base for %s/%s", fc.ActiveProject, fc.ActiveEnv))
	}
	if strings.TrimSpace(envCfg.OpenAPIURL) == "" {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Missing/invalid openapi_url for %s/%s", fc.ActiveProject, fc.ActiveEnv))
	}
	if envCfg.APIMode != "read-only" && envCfg.APIMode != "safe-updates" && envCfg.APIMode != "full-access" {
		return nil, NewCliError(ExitConfig, fmt.Sprintf("Missing/invalid api_mode for %s/%s (expected read-only|safe-updates|full-access)", fc.ActiveProject, fc.ActiveEnv))
	}

	normalizedTokens := make(map[string]string)
	for k, v := range envCfg.Tokens {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k != "" && v != "" {
			normalizedTokens[k] = v
		}
	}
	if len(normalizedTokens) == 0 {
		return nil, NewCliError(ExitToken, fmt.Sprintf("No usable tokens defined for %s/%s", fc.ActiveProject, fc.ActiveEnv))
	}

	return &ResolvedConfig{
		ActiveProject:    fc.ActiveProject,
		ActiveEnv:        fc.ActiveEnv,
		DefaultTokenName: fc.DefaultToken,
		AgentMarker:      fc.AgentMarker,
		Strict:           *fc.Strict,
		APIBase:          strings.TrimRight(envCfg.APIBase, "/"),
		APIMode:          envCfg.APIMode,
		OpenAPIURL:       envCfg.OpenAPIURL,
		Tokens:           normalizedTokens,
	}, nil
}

func ResolveToken(cfg *ResolvedConfig, tokenNameOverride string) (string, string, error) {
	tokenName := strings.TrimSpace(tokenNameOverride)
	if tokenName == "" {
		tokenName = cfg.DefaultTokenName
	}
	value, ok := cfg.Tokens[tokenName]
	if !ok {
		return "", "", NewCliError(ExitToken, fmt.Sprintf("Token '%s' not found for %s/%s", tokenName, cfg.ActiveProject, cfg.ActiveEnv))
	}
	if strings.TrimSpace(value) == "" {
		return "", "", NewCliError(ExitToken, fmt.Sprintf("Token '%s' is empty", tokenName))
	}
	return tokenName, value, nil
}

func FetchOpenAPISpec(openapiURL string) (map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, openapiURL, nil)
	if err != nil {
		return nil, NewCliError(ExitOpenAPIFetch, fmt.Sprintf("Failed to fetch OpenAPI spec: %v", err))
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, NewCliError(ExitOpenAPIFetch, fmt.Sprintf("Failed to fetch OpenAPI spec: %v", err))
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, NewCliError(ExitOpenAPIFetch, fmt.Sprintf("Failed to fetch OpenAPI spec: %v", err))
	}
	if resp.StatusCode >= 400 {
		return nil, NewCliError(ExitOpenAPIFetch, fmt.Sprintf("Failed to fetch OpenAPI spec: HTTP %d", resp.StatusCode))
	}

	var spec map[string]any
	if err := json.Unmarshal(body, &spec); err != nil {
		if errY := yaml.Unmarshal(body, &spec); errY != nil {
			return nil, NewCliError(ExitOpenAPIParse, fmt.Sprintf("Failed to parse OpenAPI spec as JSON/YAML: %v", errY))
		}
	}
	paths, ok := asMap(spec["paths"])
	if !ok || len(paths) == 0 {
		return nil, NewCliError(ExitOpenAPIParse, "OpenAPI spec is missing a valid 'paths' object")
	}
	return spec, nil
}

type Operation struct {
	Method      string
	Path        string
	OperationID string
	Summary     string
	Description string
	Tags        []string
	Raw         map[string]any
	Score       int
}

func IterOperations(spec map[string]any) []Operation {
	pathsAny, ok := asMap(spec["paths"])
	if !ok {
		return nil
	}
	out := make([]Operation, 0)
	for p, pathItemAny := range pathsAny {
		pathItem, ok := asMap(pathItemAny)
		if !ok {
			continue
		}
		for method, opAny := range pathItem {
			if _, ok := openapiMethods[strings.ToLower(method)]; !ok {
				continue
			}
			op, _ := asMap(opAny)
			tags := make([]string, 0)
			if tagsAny, ok := asSlice(op["tags"]); ok {
				for _, t := range tagsAny {
					if ts, ok := t.(string); ok {
						tags = append(tags, ts)
					}
				}
			}
			out = append(out, Operation{
				Method:      strings.ToUpper(method),
				Path:        p,
				OperationID: asString(op["operationId"]),
				Summary:     asString(op["summary"]),
				Description: asString(op["description"]),
				Tags:        tags,
				Raw:         op,
			})
		}
	}
	return out
}

func termVariants(term string) []string {
	variants := map[string]struct{}{term: {}}
	if strings.HasSuffix(term, "y") && len(term) > 1 {
		variants[term[:len(term)-1]+"ies"] = struct{}{}
	}
	if strings.HasSuffix(term, "ies") && len(term) > 3 {
		variants[term[:len(term)-3]+"y"] = struct{}{}
	}
	if !strings.HasSuffix(term, "s") {
		variants[term+"s"] = struct{}{}
	}
	out := make([]string, 0, len(variants))
	for v := range variants {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func scoreOperation(op Operation, query string) int {
	terms := strings.Fields(strings.ToLower(query))
	if len(terms) == 0 {
		return 0
	}
	hay := []string{
		strings.ToLower(op.Path),
		strings.ToLower(op.OperationID),
		strings.ToLower(op.Summary),
		strings.ToLower(op.Description),
		strings.ToLower(strings.Join(op.Tags, " ")),
	}
	score := 0
	for _, term := range terms {
		vars := termVariants(term)
		for i, h := range hay {
			for _, v := range vars {
				if strings.Contains(h, v) {
					score += 10 - min(i, 4)
					break
				}
			}
		}
	}
	return score
}

func FindOperations(spec map[string]any, query string, methodFilter string) []Operation {
	methodFilter = strings.ToUpper(strings.TrimSpace(methodFilter))
	ops := IterOperations(spec)
	out := make([]Operation, 0)
	for _, op := range ops {
		if methodFilter != "" && op.Method != methodFilter {
			continue
		}
		score := scoreOperation(op, query)
		if score > 0 {
			op.Score = score
			out = append(out, op)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		return out[i].Method < out[j].Method
	})
	return out
}

func FindOperationByRef(spec map[string]any, ref string) (*Operation, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, NewCliError(ExitNotFound, "Empty endpoint reference")
	}
	parts := strings.SplitN(ref, " ", 2)
	if len(parts) == 2 {
		method := strings.ToUpper(strings.TrimSpace(parts[0]))
		path := strings.TrimSpace(parts[1])
		if _, ok := httpMethods[method]; ok && strings.HasPrefix(path, "/") {
			for _, op := range IterOperations(spec) {
				if op.Method == method && op.Path == path {
					cp := op
					return &cp, nil
				}
			}
			return nil, NewCliError(ExitNotFound, fmt.Sprintf("Endpoint not found: %s %s", method, path))
		}
	}
	for _, op := range IterOperations(spec) {
		if op.OperationID == ref {
			cp := op
			return &cp, nil
		}
	}
	return nil, NewCliError(ExitNotFound, fmt.Sprintf("Operation not found for ref: %s", ref))
}

func schemaToText(schemaAny any) string {
	schema, ok := asMap(schemaAny)
	if !ok {
		return "-"
	}
	if ref, ok := schema["$ref"].(string); ok && ref != "" {
		return ref
	}
	t := asString(schema["type"])
	f := asString(schema["format"])
	if t != "" && f != "" {
		return fmt.Sprintf("%s (%s)", t, f)
	}
	if t != "" {
		return t
	}
	b, _ := json.Marshal(schema)
	if len(b) == 0 {
		return "-"
	}
	return string(b)
}

func PrintFindResults(ops []Operation) {
	if len(ops) == 0 {
		fmt.Println("No matching endpoints found.")
		return
	}
	methodW := 6
	pathW := 20
	for _, op := range ops {
		if len(op.Method) > methodW {
			methodW = len(op.Method)
		}
		if len(op.Path) > pathW {
			pathW = len(op.Path)
		}
	}
	if pathW > 80 {
		pathW = 80
	}

	fmt.Printf("%-*s  %-*s  SUMMARY  OPERATION_ID\n", methodW, "METHOD", pathW, "PATH")
	fmt.Printf("%-*s  %-*s  -------  ------------\n", methodW, strings.Repeat("-", methodW), pathW, strings.Repeat("-", pathW))
	for _, op := range ops {
		p := op.Path
		if len(p) > pathW {
			p = p[:pathW-1] + "…"
		}
		fmt.Printf("%-*s  %-*s  %s  %s\n", methodW, op.Method, pathW, p, op.Summary, op.OperationID)
	}
}

func PrintOperationDetails(op *Operation) {
	raw := op.Raw
	fmt.Printf("METHOD: %s\n", op.Method)
	fmt.Printf("PATH: %s\n", op.Path)
	fmt.Printf("OPERATION_ID: %s\n", op.OperationID)
	fmt.Printf("SUMMARY: %s\n", op.Summary)
	fmt.Printf("DESCRIPTION: %s\n", op.Description)
	if len(op.Tags) == 0 {
		fmt.Println("TAGS: -")
	} else {
		fmt.Printf("TAGS: %s\n", strings.Join(op.Tags, ", "))
	}

	fmt.Println("\nPARAMETERS:")
	paramsAny, _ := asSlice(raw["parameters"])
	if len(paramsAny) == 0 {
		fmt.Println("  -")
	} else {
		for _, pAny := range paramsAny {
			p, ok := asMap(pAny)
			if !ok {
				continue
			}
			name := asString(p["name"])
			pin := asString(p["in"])
			required, _ := p["required"].(bool)
			schemaText := schemaToText(p["schema"])
			fmt.Printf("  - %s (%s), required=%t, schema=%s\n", name, pin, required, schemaText)
		}
	}

	fmt.Println("\nREQUEST BODY:")
	rb, ok := asMap(raw["requestBody"])
	if !ok {
		fmt.Println("  -")
	} else {
		required, _ := rb["required"].(bool)
		fmt.Printf("  required=%t\n", required)
		content, _ := asMap(rb["content"])
		if len(content) == 0 {
			fmt.Println("  content: -")
		} else {
			keys := sortedKeys(content)
			for _, ctype := range keys {
				cval, _ := asMap(content[ctype])
				schemaText := schemaToText(cval["schema"])
				fmt.Printf("  - %s: %s\n", ctype, schemaText)
			}
		}
	}

	fmt.Println("\nRESPONSES:")
	responses, _ := asMap(raw["responses"])
	if len(responses) == 0 {
		fmt.Println("  -")
		return
	}
	for _, status := range sortedKeys(responses) {
		respObj, _ := asMap(responses[status])
		desc := asString(respObj["description"])
		fmt.Printf("  %s: %s\n", status, desc)
		content, _ := asMap(respObj["content"])
		for _, ctype := range sortedKeys(content) {
			cval, _ := asMap(content[ctype])
			schemaText := schemaToText(cval["schema"])
			fmt.Printf("    - %s: %s\n", ctype, schemaText)
		}
	}
}

type acurlOptions struct {
	TokenName string
	Data      string
	Headers   []string
}

func normalizeMethodAndPath(args []string) (method string, path string, rest []string, err error) {
	if len(args) == 0 {
		return "", "", nil, NewCliError(ExitRequestBuild, "acurl requires [METHOD] <path>")
	}
	first := strings.TrimSpace(args[0])
	if _, ok := httpMethods[strings.ToUpper(first)]; ok {
		if len(args) < 2 {
			return "", "", nil, NewCliError(ExitRequestBuild, "acurl requires a path after METHOD")
		}
		method = strings.ToUpper(first)
		path = args[1]
		rest = args[2:]
	} else {
		method = "GET"
		path = args[0]
		rest = args[1:]
	}
	if !strings.HasPrefix(path, "/") {
		return "", "", nil, NewCliError(ExitRequestBuild, fmt.Sprintf("Path must start with '/': %s", path))
	}
	return method, path, rest, nil
}

func parseACurlOptions(rest []string) (*acurlOptions, error) {
	opts := &acurlOptions{}
	for i := 0; i < len(rest); i++ {
		a := rest[i]
		switch a {
		case "--token":
			i++
			if i >= len(rest) {
				return nil, NewCliError(ExitRequestBuild, "Missing value for --token")
			}
			opts.TokenName = rest[i]
		case "-d", "--data":
			i++
			if i >= len(rest) {
				return nil, NewCliError(ExitRequestBuild, "Missing value for -d/--data")
			}
			opts.Data = rest[i]
		case "-H", "--header":
			i++
			if i >= len(rest) {
				return nil, NewCliError(ExitRequestBuild, "Missing value for -H/--header")
			}
			opts.Headers = append(opts.Headers, rest[i])
		default:
			return nil, NewCliError(ExitRequestBuild, fmt.Sprintf("Unknown acurl option: %s", a))
		}
	}
	return opts, nil
}

func headersListToMap(items []string) (map[string]string, error) {
	out := make(map[string]string)
	for _, h := range items {
		parts := strings.SplitN(h, ":", 2)
		if len(parts) != 2 {
			return nil, NewCliError(ExitRequestBuild, fmt.Sprintf("Invalid header format (expected 'Key: Value'): %s", h))
		}
		k := strings.TrimSpace(parts[0])
		v := strings.TrimSpace(parts[1])
		if k == "" {
			return nil, NewCliError(ExitRequestBuild, fmt.Sprintf("Invalid header key: %s", h))
		}
		out[k] = v
	}
	return out, nil
}

func enforceMode(cfg *ResolvedConfig, method string, body string) error {
	allowed := map[string]struct{}{}
	switch cfg.APIMode {
	case "read-only":
		allowed["GET"] = struct{}{}
	case "safe-updates":
		allowed["GET"] = struct{}{}
		allowed["POST"] = struct{}{}
		allowed["PUT"] = struct{}{}
		allowed["PATCH"] = struct{}{}
	default: // full-access
		for m := range httpMethods {
			allowed[m] = struct{}{}
		}
	}
	if _, ok := allowed[method]; !ok {
		return NewCliError(ExitBlockedByMode, fmt.Sprintf("Method %s blocked by api_mode=%s", method, cfg.APIMode))
	}
	if cfg.APIMode == "safe-updates" && (method == "POST" || method == "PUT" || method == "PATCH") {
		if body == "" || !strings.Contains(body, cfg.AgentMarker) {
			return NewCliError(ExitMarkerMissing, fmt.Sprintf("Missing required agent_marker '%s' in request body", cfg.AgentMarker))
		}
	}
	return nil
}

func normalizeSegments(path string) []string {
	if path != "/" && strings.HasSuffix(path, "/") {
		path = strings.TrimSuffix(path, "/")
	}
	stripped := strings.Trim(path, "/")
	if stripped == "" {
		return []string{}
	}
	return strings.Split(stripped, "/")
}

func matchOpenAPIPath(templatePath, requestPath string) (map[string]string, bool) {
	tSeg := normalizeSegments(templatePath)
	rSeg := normalizeSegments(requestPath)
	if len(tSeg) != len(rSeg) {
		return nil, false
	}
	params := make(map[string]string)
	for i := range tSeg {
		ts := tSeg[i]
		rs := rSeg[i]
		if strings.HasPrefix(ts, "{") && strings.HasSuffix(ts, "}") && len(ts) > 2 {
			name := strings.TrimSpace(ts[1 : len(ts)-1])
			if name == "" || rs == "" {
				return nil, false
			}
			decoded, err := url.PathUnescape(rs)
			if err != nil {
				return nil, false
			}
			params[name] = decoded
		} else if ts != rs {
			return nil, false
		}
	}
	return params, true
}

func mergeParameters(pathItem map[string]any, op map[string]any) []map[string]any {
	merged := make(map[string]map[string]any)
	for _, source := range []any{pathItem["parameters"], op["parameters"]} {
		items, _ := asSlice(source)
		for _, pAny := range items {
			p, ok := asMap(pAny)
			if !ok {
				continue
			}
			name := asString(p["name"])
			pin := asString(p["in"])
			if name == "" || pin == "" {
				continue
			}
			merged[pin+":"+name] = p
		}
	}
	out := make([]map[string]any, 0, len(merged))
	for _, p := range merged {
		out = append(out, p)
	}
	return out
}

func ValidateAgainstOpenAPI(spec map[string]any, method string, pathWithQuery string) error {
	pathsAny, ok := asMap(spec["paths"])
	if !ok {
		return NewCliError(ExitOpenAPIParse, "OpenAPI spec is missing a valid 'paths' object")
	}
	u, err := url.Parse(pathWithQuery)
	if err != nil {
		return NewCliError(ExitRequestBuild, fmt.Sprintf("Request build error: %v", err))
	}
	requestPath := u.Path
	query := u.Query()

	methodKey := strings.ToLower(method)
	var matchedTemplate string
	var matchedPathItem map[string]any
	var matchedOp map[string]any
	matchedPathParams := map[string]string{}

	for templatePath, pathItemAny := range pathsAny {
		pathItem, ok := asMap(pathItemAny)
		if !ok {
			continue
		}
		opAny, ok := pathItem[methodKey]
		if !ok {
			continue
		}
		op, ok := asMap(opAny)
		if !ok {
			continue
		}
		params, matched := matchOpenAPIPath(templatePath, requestPath)
		if !matched {
			continue
		}
		matchedTemplate = templatePath
		matchedPathItem = pathItem
		matchedOp = op
		matchedPathParams = params
		break
	}
	if matchedTemplate == "" {
		return NewCliError(ExitRequestBuild, fmt.Sprintf("Strict mode: endpoint not found in OpenAPI spec for %s %s", method, requestPath))
	}

	missing := make([]string, 0)
	for _, p := range mergeParameters(matchedPathItem, matchedOp) {
		name := asString(p["name"])
		pin := asString(p["in"])
		required, _ := p["required"].(bool)
		if !required || name == "" || pin == "" {
			continue
		}
		switch pin {
		case "path":
			if strings.TrimSpace(matchedPathParams[name]) == "" {
				missing = append(missing, "path:"+name)
			}
		case "query":
			vals, ok := query[name]
			if !ok || len(vals) == 0 {
				missing = append(missing, "query:"+name)
				continue
			}
			nonEmpty := false
			for _, v := range vals {
				if strings.TrimSpace(v) != "" {
					nonEmpty = true
					break
				}
			}
			if !nonEmpty {
				missing = append(missing, "query:"+name)
			}
		}
	}
	if len(missing) > 0 {
		return NewCliError(ExitRequestBuild, fmt.Sprintf("Strict mode: missing required params: %s", strings.Join(missing, ", ")))
	}
	return nil
}

func emitCompactBackendPayload(raw []byte) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return
	}
	var compact bytes.Buffer
	if json.Compact(&compact, trimmed) == nil {
		_, _ = os.Stdout.Write(compact.Bytes())
		_, _ = os.Stdout.Write([]byte("\n"))
		return
	}
	_, _ = os.Stdout.Write(trimmed)
	_, _ = os.Stdout.Write([]byte("\n"))
}

func RunAPI(configPath string, args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Println(APIHelp)
		return nil
	}

	cfg, err := ResolveConfig(configPath)
	if err != nil {
		return err
	}

	cmd := args[0]
	switch cmd {
	case "find":
		if len(args) < 2 {
			return NewCliError(ExitRequestBuild, "Usage: api find <query> [--method <HTTP_METHOD>]")
		}
		queryParts := make([]string, 0)
		methodFilter := ""
		for i := 1; i < len(args); i++ {
			a := args[i]
			if a == "--method" {
				i++
				if i >= len(args) {
					return NewCliError(ExitRequestBuild, "Missing value for --method")
				}
				m := strings.ToUpper(strings.TrimSpace(args[i]))
				if _, ok := httpMethods[m]; !ok {
					return NewCliError(ExitRequestBuild, fmt.Sprintf("Invalid HTTP method for --method: %s", m))
				}
				methodFilter = m
				continue
			}
			queryParts = append(queryParts, a)
		}
		query := strings.TrimSpace(strings.Join(queryParts, " "))
		if query == "" {
			return NewCliError(ExitRequestBuild, "Query cannot be empty")
		}
		spec, err := FetchOpenAPISpec(cfg.OpenAPIURL)
		if err != nil {
			return err
		}
		ops := FindOperations(spec, query, methodFilter)
		PrintFindResults(ops)
		return nil

	case "show":
		if len(args) < 2 {
			return NewCliError(ExitRequestBuild, `Usage: api show <operationId|"METHOD /path">`)
		}
		ref := strings.TrimSpace(strings.Join(args[1:], " "))
		spec, err := FetchOpenAPISpec(cfg.OpenAPIURL)
		if err != nil {
			return err
		}
		op, err := FindOperationByRef(spec, ref)
		if err != nil {
			return err
		}
		PrintOperationDetails(op)
		return nil
	default:
		return NewCliError(ExitRequestBuild, fmt.Sprintf("Unknown api command: %s", cmd))
	}
}

func RunACurl(configPath string, args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Println(ACurlHelp)
		return nil
	}

	cfg, err := ResolveConfig(configPath)
	if err != nil {
		return err
	}

	method, path, rest, err := normalizeMethodAndPath(args)
	if err != nil {
		return err
	}
	opts, err := parseACurlOptions(rest)
	if err != nil {
		return err
	}

	if err := enforceMode(cfg, method, opts.Data); err != nil {
		return err
	}
	if cfg.Strict {
		spec, err := FetchOpenAPISpec(cfg.OpenAPIURL)
		if err != nil {
			return err
		}
		if err := ValidateAgainstOpenAPI(spec, method, path); err != nil {
			return err
		}
	}

	_, tokenValue, err := ResolveToken(cfg, opts.TokenName)
	if err != nil {
		return err
	}

	headers, err := headersListToMap(opts.Headers)
	if err != nil {
		return err
	}
	if _, ok := headers["Authorization"]; !ok {
		headers["Authorization"] = "Bearer " + tokenValue
	}
	if _, ok := headers["Accept"]; !ok {
		headers["Accept"] = "application/json"
	}

	var body io.Reader
	if opts.Data != "" {
		body = strings.NewReader(opts.Data)
		if _, ok := headers["Content-Type"]; !ok {
			headers["Content-Type"] = "application/json"
		}
	}

	fullURL := cfg.APIBase + path
	req, err := http.NewRequest(method, fullURL, body)
	if err != nil {
		return NewCliError(ExitRequestBuild, fmt.Sprintf("Request build error: %v", err))
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return NewCliError(ExitUnexpected, fmt.Sprintf("HTTP request failed: %v", err))
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return NewCliError(ExitUnexpected, fmt.Sprintf("HTTP request failed: %v", err))
	}
	emitCompactBackendPayload(respBody)

	if resp.StatusCode >= 400 {
		return NewCliError(ExitHTTPErrorStatus, "")
	}
	return nil
}

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	if ok {
		return m, true
	}
	// yaml can produce map[interface{}]interface{} in some cases
	m2, ok := v.(map[any]any)
	if !ok {
		return nil, false
	}
	out := make(map[string]any, len(m2))
	for k, val := range m2 {
		ks, ok := k.(string)
		if !ok {
			continue
		}
		out[ks] = val
	}
	return out, true
}

func asSlice(v any) ([]any, bool) {
	s, ok := v.([]any)
	if ok {
		return s, true
	}
	return nil, false
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
