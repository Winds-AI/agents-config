package agentapi

import (
	"fmt"
	"strings"
)

const Marker = "[agent-test]"

var readMethods = map[string]struct{}{
	"GET":     {},
	"HEAD":    {},
	"OPTIONS": {},
}

var writeMethods = map[string]struct{}{
	"POST":  {},
	"PUT":   {},
	"PATCH": {},
}

var supportedMethods = map[string]struct{}{
	"GET":     {},
	"HEAD":    {},
	"OPTIONS": {},
	"POST":    {},
	"PUT":     {},
	"PATCH":   {},
	"DELETE":  {},
}

func collectStringValues(value any, out *[]string) {
	switch v := value.(type) {
	case string:
		*out = append(*out, v)
	case map[string]any:
		for _, nested := range v {
			collectStringValues(nested, out)
		}
	case []any:
		for _, nested := range v {
			collectStringValues(nested, out)
		}
	}
}

func ValidatePolicy(apiMode string, method string, jsonBody any, confirmDelete bool) error {
	m := strings.ToUpper(strings.TrimSpace(method))
	if _, ok := supportedMethods[m]; !ok {
		return NewAppError(
			"ERR_METHOD_BLOCKED_BY_MODE",
			fmt.Sprintf("HTTP method '%s' is not supported by this tool.", m),
		)
	}

	switch apiMode {
	case "read-only":
		if _, ok := readMethods[m]; !ok {
			return NewAppError(
				"ERR_METHOD_BLOCKED_BY_MODE",
				fmt.Sprintf("'%s' is blocked in read-only mode.", m),
			)
		}
		return nil

	case "safe-updates":
		if m == "DELETE" {
			return NewAppError("ERR_METHOD_BLOCKED_BY_MODE", "DELETE is blocked in safe-updates mode.")
		}
		if _, isWrite := writeMethods[m]; isWrite {
			if jsonBody == nil {
				return NewAppError(
					"ERR_MARKER_MISSING",
					"safe-updates writes require a JSON body with [agent-test] markers.",
				)
			}

			var stringsInPayload []string
			collectStringValues(jsonBody, &stringsInPayload)
			if len(stringsInPayload) == 0 {
				return NewAppError(
					"ERR_UNMARKABLE_PAYLOAD",
					"safe-updates writes require at least one string field containing [agent-test].",
				)
			}

			// This strict rule avoids partially-tagged writes in v1.
			for _, value := range stringsInPayload {
				if !strings.Contains(value, Marker) {
					return NewAppError(
						"ERR_MARKER_MISSING",
						"All string values in safe-updates write payloads must include [agent-test].",
					)
				}
			}
		}
		return nil

	case "full-access":
		if m == "DELETE" && !confirmDelete {
			return NewAppError(
				"ERR_DELETE_CONFIRMATION_REQUIRED",
				"DELETE requires --confirm-delete in full-access mode.",
			)
		}
		return nil

	default:
		return NewAppError(
			"ERR_CONTEXT_INVALID",
			fmt.Sprintf("Unknown api_mode '%s'.", apiMode),
		)
	}
}
