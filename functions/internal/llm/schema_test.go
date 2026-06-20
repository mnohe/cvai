package llm

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestDeriveOpenAIStrictSchemaRequiresAllPropertiesAndNullsOptional(t *testing.T) {
	raw := json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","minLength":1},
			"github":{"type":"string","format":"uri","minLength":1},
			"profile":{"$ref":"#/$defs/profile"}
		},
		"required":["name"],
		"additionalProperties":false,
		"$defs":{
			"profile":{
				"type":"object",
				"properties":{"title":{"type":"string"},"subtitle":{"type":"string"}},
				"required":["title"],
				"additionalProperties":false
			}
		}
	}`)

	derived, err := DeriveOpenAIStrictSchema(raw)
	if err != nil {
		t.Fatalf("DeriveOpenAIStrictSchema: %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(derived, &schema); err != nil {
		t.Fatal(err)
	}
	required := schema["required"].([]any)
	if len(required) != 3 {
		t.Fatalf("required = %#v", required)
	}
	props := schema["properties"].(map[string]any)
	github := props["github"].(map[string]any)
	if !hasNullType(github["type"]) {
		t.Fatalf("optional github was not nullable: %#v", github)
	}
	if _, ok := github["format"]; ok {
		t.Fatalf("format was not removed: %#v", github)
	}
	profile := props["profile"].(map[string]any)
	if !hasNullType(profile["type"]) {
		t.Fatalf("optional ref was not nullable: %#v", profile)
	}
	profileRequired := profile["required"].([]any)
	if len(profileRequired) != 2 {
		t.Fatalf("profile required = %#v", profileRequired)
	}
	if _, ok := schema["$defs"]; ok {
		t.Fatalf("$defs should be inlined for OpenAI schema: %#v", schema["$defs"])
	}
}

func TestNormalizeStructuredOutputRemovesNullObjectFields(t *testing.T) {
	raw := json.RawMessage(`{"name":"Ada","github":null,"items":[{"url":null,"name":"Project"},null]}`)
	normalized, err := NormalizeStructuredOutput(raw)
	if err != nil {
		t.Fatalf("NormalizeStructuredOutput: %v", err)
	}
	if string(normalized) != `{"items":[{"name":"Project"}],"name":"Ada"}` {
		t.Fatalf("normalized = %s", normalized)
	}
}

func TestCanonicalCVSchemaDerivesOpenAICompatibleSubset(t *testing.T) {
	raw, err := os.ReadFile("../../../schemas/cv.schema.json")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	derived, err := DeriveOpenAIStrictSchema(raw)
	if err != nil {
		t.Fatalf("DeriveOpenAIStrictSchema: %v", err)
	}
	var schema any
	if err := json.Unmarshal(derived, &schema); err != nil {
		t.Fatal(err)
	}
	if err := validateOpenAISchemaNode(schema, true, "$"); err != nil {
		t.Fatal(err)
	}
}

func hasNullType(value any) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if item == "null" {
			return true
		}
	}
	return false
}

func validateOpenAISchemaNode(value any, root bool, path string) error {
	node, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	for key := range node {
		switch key {
		case "type", "properties", "required", "additionalProperties", "items", "$defs", "$ref", "anyOf", "enum", "description", "pattern", "format", "minimum", "maximum", "multipleOf", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems":
		default:
			return fmt.Errorf("%s has unsupported key %q", path, key)
		}
	}
	if root {
		if _, ok := node["anyOf"]; ok {
			return fmt.Errorf("%s root must not use anyOf", path)
		}
	}
	if typ, ok := node["type"].(string); ok && typ == "array" {
		if _, ok := node["items"]; !ok {
			return fmt.Errorf("%s array missing items", path)
		}
	}
	if types, ok := node["type"].([]any); ok {
		hasArray := false
		for _, typ := range types {
			if typ == "array" {
				hasArray = true
			}
		}
		if hasArray {
			if _, ok := node["items"]; !ok {
				return fmt.Errorf("%s nullable array missing items", path)
			}
		}
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		if ap, ok := node["additionalProperties"].(bool); !ok || ap {
			return fmt.Errorf("%s object missing additionalProperties=false", path)
		}
		required := stringSet(node["required"])
		if len(required) != len(properties) {
			return fmt.Errorf("%s object required count %d does not match properties count %d", path, len(required), len(properties))
		}
		for key, child := range properties {
			if !required[key] {
				return fmt.Errorf("%s property %q is not required", path, key)
			}
			if err := validateOpenAISchemaNode(child, false, path+".properties."+key); err != nil {
				return err
			}
		}
	}
	if defs, ok := node["$defs"].(map[string]any); ok {
		for key, child := range defs {
			if err := validateOpenAISchemaNode(child, false, path+".$defs."+key); err != nil {
				return err
			}
		}
	}
	if items, ok := node["items"]; ok {
		if err := validateOpenAISchemaNode(items, false, path+".items"); err != nil {
			return err
		}
	}
	if anyOf, ok := node["anyOf"].([]any); ok {
		for index, child := range anyOf {
			if err := validateOpenAISchemaNode(child, false, fmt.Sprintf("%s.anyOf[%d]", path, index)); err != nil {
				return err
			}
		}
	}
	return nil
}
