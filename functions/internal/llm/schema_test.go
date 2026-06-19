package llm

import (
	"encoding/json"
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
	if _, ok := profile["anyOf"]; !ok {
		t.Fatalf("optional ref was not wrapped in anyOf: %#v", profile)
	}
	defs := schema["$defs"].(map[string]any)
	profileDef := defs["profile"].(map[string]any)
	profileRequired := profileDef["required"].([]any)
	if len(profileRequired) != 2 {
		t.Fatalf("profile required = %#v", profileRequired)
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
