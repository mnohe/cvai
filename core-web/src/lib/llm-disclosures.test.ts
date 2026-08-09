import assert from "node:assert/strict";
import test from "node:test";
import {
  getLLMOperationDisclosure,
  hasLLMDisclosureAcknowledgement,
  llmOperationIds,
  recordLLMDisclosureAcknowledgement,
  validateLLMDisclosureConfig,
} from "./llm-disclosures.ts";

test("every registered operation has a complete disclosure", () => {
  assert.deepEqual(llmOperationIds, [
    "import_cv",
    "quick_analysis",
    "generate_bundle",
    "reassess_role",
    "generate_gap_tasks",
    "reassess_gap_task",
  ]);

  for (const operation of llmOperationIds) {
    const disclosure = getLLMOperationDisclosure(operation);
    assert.ok(disclosure.title);
    assert.ok(disclosure.purpose);
    assert.ok(disclosure.dataSent.length > 0);
    assert.ok(disclosure.retainedByCVAI.includes("CVAI"));
    assert.ok(disclosure.nonLLMPath);
  }
});

test("acknowledgements are operation-specific and invalidate when disclosed content changes", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  const config = {
    providerName: "Example AI",
    retentionPolicyUrl: "https://provider.example/privacy",
  };

  assert.equal(hasLLMDisclosureAcknowledgement("import_cv", config, storage), false);
  recordLLMDisclosureAcknowledgement("import_cv", config, storage);
  assert.equal(hasLLMDisclosureAcknowledgement("import_cv", config, storage), true);
  assert.equal(hasLLMDisclosureAcknowledgement("quick_analysis", config, storage), false);
  assert.equal(
    hasLLMDisclosureAcknowledgement("import_cv", { ...config, providerName: "Different AI" }, storage),
    false,
  );
  assert.equal(
    hasLLMDisclosureAcknowledgement(
      "import_cv",
      { ...config, retentionPolicyUrl: "https://provider.example/new-policy" },
      storage,
    ),
    false,
  );
});

test("hosted disclosure configuration requires a named provider and HTTPS retention link", () => {
  assert.deepEqual(
    validateLLMDisclosureConfig({
      providerName: " Example AI ",
      retentionPolicyUrl: "https://provider.example/privacy",
    }),
    {
      providerName: "Example AI",
      retentionPolicyUrl: "https://provider.example/privacy",
    },
  );

  assert.throws(
    () => validateLLMDisclosureConfig({ providerName: " ", retentionPolicyUrl: "https://provider.example/privacy" }),
    /providerName is required/,
  );
  assert.throws(
    () => validateLLMDisclosureConfig({ providerName: "Example AI", retentionPolicyUrl: "/privacy" }),
    /absolute HTTPS URL/,
  );
  assert.throws(
    () => validateLLMDisclosureConfig({ providerName: "Example AI", retentionPolicyUrl: "http://provider.example/privacy" }),
    /absolute HTTPS URL/,
  );
});
