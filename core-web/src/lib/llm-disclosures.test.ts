import assert from "node:assert/strict";
import test from "node:test";
import {
  getLLMOperationDisclosure,
  hasLLMDisclosureBeenDisplayed,
  llmOperationIds,
  recordLLMDisclosureDisplayed,
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

test("displayed states are operation-specific and invalidate when disclosed content changes", () => {
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

  assert.equal(hasLLMDisclosureBeenDisplayed("import_cv", config, storage), false);
  recordLLMDisclosureDisplayed("import_cv", config, storage);
  assert.equal(hasLLMDisclosureBeenDisplayed("import_cv", config, storage), true);
  assert.equal(hasLLMDisclosureBeenDisplayed("quick_analysis", config, storage), false);
  assert.equal(
    hasLLMDisclosureBeenDisplayed("import_cv", { ...config, providerName: "Different AI" }, storage),
    false,
  );
  assert.equal(
    hasLLMDisclosureBeenDisplayed(
      "import_cv",
      { ...config, retentionPolicyUrl: "https://provider.example/new-policy" },
      storage,
    ),
    false,
  );
});

test("display-state write is best-effort when browser storage rejects it", () => {
  const config = {
    providerName: "Example AI",
    retentionPolicyUrl: "https://provider.example/privacy",
  };
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("storage unavailable");
    },
  };

  assert.doesNotThrow(() => recordLLMDisclosureDisplayed("import_cv", config, storage));
  assert.equal(hasLLMDisclosureBeenDisplayed("import_cv", config, storage), false);
});

test("display-state recording does not hide invalid disclosure configuration", () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("storage unavailable");
    },
  };

  assert.throws(
    () =>
      recordLLMDisclosureDisplayed(
        "import_cv",
        { providerName: "Example AI", retentionPolicyUrl: "http://provider.example/privacy" },
        storage,
      ),
    /absolute HTTPS URL/,
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
