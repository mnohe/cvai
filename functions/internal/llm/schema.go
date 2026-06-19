package llm

import (
	"encoding/json"
	"errors"
	"sort"
)

// DeriveOpenAIStrictSchema adapts the canonical CV JSON Schema for OpenAI's
// strict structured-output dialect. The canonical schema remains the source of
// truth for public validation and Firestore shape. This derived schema exists
// only to make model-side extraction deterministic: every object property is
// listed as required, originally optional properties are allowed to be null, and
// content constraints such as format/pattern/minLength are left to the existing
// local Go validation path. That keeps provider quirks out of the canonical
// schema while still getting strong object-shape guarantees from OpenAI.
func DeriveOpenAIStrictSchema(schema json.RawMessage) (json.RawMessage, error) {
	var root map[string]any
	if err := json.Unmarshal(schema, &root); err != nil {
		return nil, err
	}
	derived, ok := deriveStrictNode(root).(map[string]any)
	if !ok {
		return nil, errors.New("schema root is not an object")
	}
	out, err := json.Marshal(derived)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// NormalizeStructuredOutput removes null object properties from provider output
// before decoding into domain structs. OpenAI strict schemas require optional
// properties to appear, so the derived schema allows them as null; this function
// translates those nulls back into the canonical "property omitted" form.
func NormalizeStructuredOutput(raw json.RawMessage) (json.RawMessage, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	normalized := removeNulls(value)
	out, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func deriveStrictNode(value any) any {
	switch node := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(node))
		for key, child := range node {
			if skipOpenAISchemaKey(key) {
				continue
			}
			out[key] = deriveStrictNode(child)
		}

		if defs, ok := node["$defs"].(map[string]any); ok {
			nextDefs := make(map[string]any, len(defs))
			for key, child := range defs {
				nextDefs[key] = deriveStrictNode(child)
			}
			out["$defs"] = nextDefs
		}

		if properties, ok := node["properties"].(map[string]any); ok {
			originalRequired := stringSet(node["required"])
			nextProps := make(map[string]any, len(properties))
			required := make([]string, 0, len(properties))
			for key, child := range properties {
				required = append(required, key)
				nextChild := deriveStrictNode(child)
				if !originalRequired[key] {
					nextChild = nullableSchema(nextChild)
				}
				nextProps[key] = nextChild
			}
			sort.Strings(required)
			out["type"] = "object"
			out["properties"] = nextProps
			out["required"] = required
			out["additionalProperties"] = false
		}

		if items, ok := node["items"]; ok {
			out["items"] = deriveStrictNode(items)
		}
		return out
	case []any:
		out := make([]any, 0, len(node))
		for _, child := range node {
			out = append(out, deriveStrictNode(child))
		}
		return out
	default:
		return value
	}
}

func skipOpenAISchemaKey(key string) bool {
	switch key {
	case "$schema", "$id", "$comment", "title", "description", "default", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems":
		return true
	default:
		return false
	}
}

func nullableSchema(value any) any {
	node, ok := value.(map[string]any)
	if !ok {
		return value
	}
	if _, ok := node["$ref"]; ok {
		return map[string]any{"anyOf": []any{node, map[string]any{"type": "null"}}}
	}
	if anyOf, ok := node["anyOf"].([]any); ok {
		for _, branch := range anyOf {
			if branchMap, ok := branch.(map[string]any); ok && branchMap["type"] == "null" {
				return node
			}
		}
		next := append([]any{}, anyOf...)
		next = append(next, map[string]any{"type": "null"})
		node["anyOf"] = next
		return node
	}
	switch typ := node["type"].(type) {
	case string:
		if typ != "null" {
			node["type"] = []any{typ, "null"}
		}
	case []any:
		for _, item := range typ {
			if item == "null" {
				return node
			}
		}
		node["type"] = append(typ, "null")
	}
	return node
}

func stringSet(value any) map[string]bool {
	out := map[string]bool{}
	items, ok := value.([]any)
	if !ok {
		return out
	}
	for _, item := range items {
		if text, ok := item.(string); ok {
			out[text] = true
		}
	}
	return out
}

func removeNulls(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			if child == nil {
				continue
			}
			out[key] = removeNulls(child)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, child := range typed {
			if child == nil {
				continue
			}
			out = append(out, removeNulls(child))
		}
		return out
	default:
		return value
	}
}
