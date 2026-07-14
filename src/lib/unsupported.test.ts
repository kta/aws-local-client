import { describe, expect, it } from "vitest";
import { isUnsupportedOperation } from "./unsupported";

describe("isUnsupportedOperation", () => {
  it("matches emulator signatures for unimplemented / pro-only operations", () => {
    expect(isUnsupportedOperation({ message: "UnknownOperationException" })).toBe(true);
    expect(isUnsupportedOperation({ message: "This action is not supported" })).toBe(true);
    expect(
      isUnsupportedOperation({
        message: "API for service 'rds' not yet implemented or pro feature",
      }),
    ).toBe(true);
  });

  it("does not match ordinary errors", () => {
    expect(isUnsupportedOperation({ message: "ResourceNotFoundException" })).toBe(false);
  });
});
