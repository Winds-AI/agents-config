package agentapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

var schemeRE = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`)

type QueryPair struct {
	Key   string
	Value string
}

type HTTPResult struct {
	Status  int
	Headers map[string]string
	Body    []byte
}

func BuildURL(apiBase string, path string, queryPairs []QueryPair) (string, error) {
	if schemeRE.MatchString(path) {
		return "", NewAppError(
			"ERR_BASE_URL_OVERRIDE_BLOCKED",
			"Absolute URL is not allowed. Use a relative path, for example '/products'.",
		)
	}
	if !strings.HasPrefix(path, "/") {
		return "", NewAppError("ERR_BASE_URL_OVERRIDE_BLOCKED", "Path must start with '/'.")
	}

	base := strings.TrimRight(apiBase, "/")
	finalURL := base + path
	if len(queryPairs) > 0 {
		values := url.Values{}
		for _, pair := range queryPairs {
			values.Add(pair.Key, pair.Value)
		}
		finalURL += "?" + values.Encode()
	}
	return finalURL, nil
}

func ParseQueryItems(items []string) ([]QueryPair, error) {
	pairs := make([]QueryPair, 0, len(items))
	for _, raw := range items {
		parts := strings.SplitN(raw, "=", 2)
		if len(parts) != 2 {
			return nil, NewAppError(
				"ERR_CONTEXT_INVALID",
				fmt.Sprintf("Invalid query item '%s'. Expected key=value format.", raw),
			)
		}
		pairs = append(pairs, QueryPair{Key: parts[0], Value: parts[1]})
	}
	return pairs, nil
}

func ParseHeaderItems(items []string) (map[string]string, error) {
	headers := map[string]string{}
	for _, raw := range items {
		parts := strings.SplitN(raw, ":", 2)
		if len(parts) != 2 {
			return nil, NewAppError(
				"ERR_CONTEXT_INVALID",
				fmt.Sprintf("Invalid header '%s'. Expected 'Name: value' format.", raw),
			)
		}
		key := strings.TrimSpace(parts[0])
		if key == "" {
			return nil, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Invalid header key in '%s'.", raw))
		}
		if strings.EqualFold(key, "Authorization") {
			return nil, NewAppError(
				"ERR_BASE_URL_OVERRIDE_BLOCKED",
				"Custom Authorization header is blocked. Use configured tokens instead.",
			)
		}
		headers[key] = strings.TrimSpace(parts[1])
	}
	return headers, nil
}

func EncodeJSONPayload(jsonInline string, jsonFile string) ([]byte, any, error) {
	if strings.TrimSpace(jsonInline) != "" && strings.TrimSpace(jsonFile) != "" {
		return nil, nil, NewAppError("ERR_CONTEXT_INVALID", "Use only one of --json or --json-file.")
	}

	if strings.TrimSpace(jsonInline) == "" && strings.TrimSpace(jsonFile) == "" {
		return nil, nil, nil
	}

	var parsed any
	if strings.TrimSpace(jsonFile) != "" {
		data, err := os.ReadFile(jsonFile)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, nil, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("JSON file not found: %s", jsonFile))
			}
			return nil, nil, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Failed reading JSON file: %v", err))
		}
		if err := json.Unmarshal(data, &parsed); err != nil {
			return nil, nil, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Invalid JSON in file '%s': %v", jsonFile, err))
		}
	} else {
		if err := json.Unmarshal([]byte(jsonInline), &parsed); err != nil {
			return nil, nil, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Invalid JSON for --json: %v", err))
		}
	}

	encoded, err := json.Marshal(parsed)
	if err != nil {
		return nil, nil, NewAppError("ERR_CONTEXT_INVALID", "Failed to encode JSON payload.")
	}
	return encoded, parsed, nil
}

func ExecuteRequest(method string, finalURL string, headers map[string]string, body []byte) (HTTPResult, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(strings.ToUpper(method), finalURL, bodyReader)
	if err != nil {
		return HTTPResult{}, NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Invalid request URL '%s'. Check api_base and path.", finalURL),
		)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	client := http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return HTTPResult{}, NewAppError("ERR_CONTEXT_INVALID", fmt.Sprintf("Network error while calling '%s': %v", finalURL, err))
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return HTTPResult{}, NewAppError("ERR_CONTEXT_INVALID", "Failed reading response body.")
	}

	outHeaders := map[string]string{}
	for key, values := range resp.Header {
		outHeaders[key] = strings.Join(values, ", ")
	}

	return HTTPResult{
		Status:  resp.StatusCode,
		Headers: outHeaders,
		Body:    respBody,
	}, nil
}
