package agentapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const DefaultOpenAPICacheTTL = 300 * time.Second

type CachedSpec struct {
	Spec      map[string]any
	Source    string
	CachePath string
}

type Operation struct {
	Method      string
	Path        string
	OperationID string
	Summary     string
	Tags        []string
	Raw         map[string]any
	Score       int
}

func openAPICachePath(config AppConfig) (string, error) {
	cacheDir := filepath.Join(filepath.Dir(config.Path), ".agent-api", "spec-cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", NewAppError("ERR_OPENAPI_UNAVAILABLE", "Failed to create OpenAPI cache directory.")
	}
	filename := fmt.Sprintf("%s__%s.json", config.ActiveProject, config.ActiveEnv)
	return filepath.Join(cacheDir, filename), nil
}

func loadSpecFromPath(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, NewAppError("ERR_OPENAPI_UNAVAILABLE", fmt.Sprintf("Spec cache not found: %s", path))
	}

	var spec map[string]any
	if err := json.Unmarshal(data, &spec); err != nil {
		return nil, NewAppError("ERR_OPENAPI_UNAVAILABLE", fmt.Sprintf("Invalid OpenAPI JSON in cache: %s", path))
	}

	if _, ok := spec["paths"].(map[string]any); !ok {
		return nil, NewAppError("ERR_OPENAPI_UNAVAILABLE", "OpenAPI document is missing a valid 'paths' object.")
	}
	return spec, nil
}

func isFresh(path string, ttl time.Duration) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return time.Since(info.ModTime()) <= ttl
}

func fetchAndCacheOpenAPI(config AppConfig) (CachedSpec, error) {
	parsedURL, err := url.Parse(config.EnvConfig.OpenAPIURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return CachedSpec{}, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Invalid openapi_url '%s'.", config.EnvConfig.OpenAPIURL),
		)
	}

	req, err := http.NewRequest(http.MethodGet, config.EnvConfig.OpenAPIURL, nil)
	if err != nil {
		return CachedSpec{}, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Invalid openapi_url '%s'.", config.EnvConfig.OpenAPIURL),
		)
	}

	client := http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CachedSpec{}, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Unable to fetch OpenAPI spec from '%s': %v", config.EnvConfig.OpenAPIURL, err),
		)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return CachedSpec{}, NewAppError("ERR_OPENAPI_UNAVAILABLE", "Failed reading OpenAPI response body.")
	}

	var spec map[string]any
	if err := json.Unmarshal(body, &spec); err != nil {
		return CachedSpec{}, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("OpenAPI response from '%s' is not valid JSON.", config.EnvConfig.OpenAPIURL),
		)
	}

	if _, ok := spec["paths"].(map[string]any); !ok {
		return CachedSpec{}, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("OpenAPI JSON from '%s' does not include 'paths'.", config.EnvConfig.OpenAPIURL),
		)
	}

	path, err := openAPICachePath(config)
	if err != nil {
		return CachedSpec{}, err
	}

	encoded, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return CachedSpec{}, NewAppError("ERR_OPENAPI_UNAVAILABLE", "Failed to encode cached OpenAPI JSON.")
	}

	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return CachedSpec{}, NewAppError("ERR_OPENAPI_UNAVAILABLE", "Failed to write OpenAPI cache.")
	}

	return CachedSpec{
		Spec:      spec,
		Source:    "network",
		CachePath: path,
	}, nil
}

func LoadOpenAPI(config AppConfig, forceRefresh bool) (CachedSpec, error) {
	cachePath, err := openAPICachePath(config)
	if err != nil {
		return CachedSpec{}, err
	}

	if !forceRefresh && isFresh(cachePath, DefaultOpenAPICacheTTL) {
		spec, err := loadSpecFromPath(cachePath)
		if err == nil {
			return CachedSpec{
				Spec:      spec,
				Source:    "cache",
				CachePath: cachePath,
			}, nil
		}
	}

	cached, err := fetchAndCacheOpenAPI(config)
	if err == nil {
		return cached, nil
	}

	// Stale cache fallback keeps discovery usable during temporary network failures.
	if _, statErr := os.Stat(cachePath); statErr == nil {
		spec, loadErr := loadSpecFromPath(cachePath)
		if loadErr == nil {
			return CachedSpec{
				Spec:      spec,
				Source:    "stale-cache",
				CachePath: cachePath,
			}, nil
		}
	}

	return CachedSpec{}, err
}

func stringSliceFromAny(value any) []string {
	rawSlice, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(rawSlice))
	for _, item := range rawSlice {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func IterOperations(spec map[string]any) []Operation {
	paths, ok := spec["paths"].(map[string]any)
	if !ok {
		return nil
	}

	allowedMethods := map[string]struct{}{
		"get": {}, "head": {}, "options": {}, "post": {}, "put": {}, "patch": {}, "delete": {},
	}

	operations := []Operation{}
	for path, pathItemRaw := range paths {
		pathItem, ok := pathItemRaw.(map[string]any)
		if !ok {
			continue
		}
		for method, opRaw := range pathItem {
			if _, allowed := allowedMethods[strings.ToLower(method)]; !allowed {
				continue
			}
			opMap, ok := opRaw.(map[string]any)
			if !ok {
				continue
			}
			op := Operation{
				Method:      strings.ToUpper(method),
				Path:        path,
				OperationID: stringFromMap(opMap, "operationId"),
				Summary:     stringFromMap(opMap, "summary"),
				Tags:        stringSliceFromAny(opMap["tags"]),
				Raw:         opMap,
			}
			operations = append(operations, op)
		}
	}
	return operations
}

func SearchOperations(spec map[string]any, query string, limit int) []Operation {
	terms := strings.Fields(strings.ToLower(query))
	if len(terms) == 0 {
		return nil
	}

	results := []Operation{}
	for _, op := range IterOperations(spec) {
		path := strings.ToLower(op.Path)
		opID := strings.ToLower(op.OperationID)
		summary := strings.ToLower(op.Summary)
		method := strings.ToLower(op.Method)
		tags := strings.ToLower(strings.Join(op.Tags, " "))

		score := 0
		for _, term := range terms {
			if strings.Contains(path, term) {
				score += 5
			}
			if strings.Contains(opID, term) {
				score += 4
			}
			if strings.Contains(summary, term) {
				score += 3
			}
			if strings.Contains(tags, term) {
				score += 2
			}
			if term == method {
				score += 2
			}
		}
		if score > 0 {
			op.Score = score
			results = append(results, op)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		if results[i].Path != results[j].Path {
			return results[i].Path < results[j].Path
		}
		return results[i].Method < results[j].Method
	})

	if len(results) > limit {
		return results[:limit]
	}
	return results
}

func stringFromMap(m map[string]any, key string) string {
	value, ok := m[key]
	if !ok {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func ShowOperation(spec map[string]any, method string, pathTemplate string) (map[string]any, error) {
	paths, ok := spec["paths"].(map[string]any)
	if !ok {
		return nil, NewAppError("ERR_OPENAPI_UNAVAILABLE", "OpenAPI document has no paths.")
	}

	pathItemRaw, ok := paths[pathTemplate]
	if !ok {
		return nil, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Path '%s' not found in OpenAPI spec.", pathTemplate),
		)
	}
	pathItem, ok := pathItemRaw.(map[string]any)
	if !ok {
		return nil, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Path '%s' has invalid OpenAPI shape.", pathTemplate),
		)
	}

	methodKey := strings.ToLower(method)
	opRaw, ok := pathItem[methodKey]
	if !ok {
		return nil, NewAppError(
			"ERR_OPENAPI_UNAVAILABLE",
			fmt.Sprintf("Operation '%s %s' not found in OpenAPI spec.", strings.ToUpper(method), pathTemplate),
		)
	}
	op, ok := opRaw.(map[string]any)
	if !ok {
		return nil, NewAppError("ERR_OPENAPI_UNAVAILABLE", "Operation has invalid OpenAPI shape.")
	}

	out := map[string]any{
		"method":      strings.ToUpper(method),
		"path":        pathTemplate,
		"operationId": op["operationId"],
		"summary":     op["summary"],
		"description": op["description"],
		"tags":        op["tags"],
		"parameters":  op["parameters"],
		"requestBody": op["requestBody"],
		"responses":   op["responses"],
	}
	return out, nil
}
