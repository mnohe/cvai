import assert from "node:assert/strict";
import test from "node:test";
import { configureProfileArchiveImport, isProfileArchiveImportEnabled } from "./features.ts";

test("profile archive import is disabled unless the host explicitly enables it", () => {
  configureProfileArchiveImport(false);
  assert.equal(isProfileArchiveImportEnabled(), false);

  configureProfileArchiveImport(true);
  assert.equal(isProfileArchiveImportEnabled(), true);

  configureProfileArchiveImport(false);
  assert.equal(isProfileArchiveImportEnabled(), false);
});
