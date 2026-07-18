import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, getApiErrorMessage, getFailureReason, setApiErrorHandler } from "./api-errors.ts";

test("extracts structured backend failure reasons", () => {
  assert.equal(getFailureReason({ error: "not enough credits", reason: "insufficient_credits" }), "insufficient_credits");
  assert.equal(getFailureReason({ error: { message: "blocked", code: "llm_disabled" } }), "llm_disabled");
});

test("host app can map commercial error reasons", () => {
  setApiErrorHandler((error) => {
    if (error.reason === "insufficient_credits") return "Buy credits to continue using AI actions.";
    return null;
  });

  assert.equal(
    getApiErrorMessage(new ApiError(402, { error: "not enough credits", reason: "insufficient_credits" }), "fallback"),
    "Buy credits to continue using AI actions.",
  );
  setApiErrorHandler(undefined);
});
