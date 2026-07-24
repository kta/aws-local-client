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
    expect(
      isUnsupportedOperation({
        message: "The action ListDeadLetterSourceQueues is not valid for this endpoint",
      }),
    ).toBe(true);
    // kumo answers an unrouted service with a plain HTTP 404 whose body is
    // surfaced verbatim by the Rust error layer.
    expect(isUnsupportedOperation({ message: "404 page not found" })).toBe(true);
    expect(isUnsupportedOperation({ message: ": 404 page not found\n" })).toBe(true);
    // kumo also answers InvalidAction / UnknownService for some services.
    expect(isUnsupportedOperation({ message: "InvalidAction: The action DisableRule ..." })).toBe(
      true,
    );
    expect(isUnsupportedOperation({ message: "UnknownService" })).toBe(true);
    // localstack:3 Pro gate wording.
    expect(
      isUnsupportedOperation({
        message:
          "The API for service 'kafka' is either not included in your current license plan or has not yet been emulated by LocalStack",
      }),
    ).toBe(true);
  });

  it("does not match ordinary errors", () => {
    expect(isUnsupportedOperation({ message: "ResourceNotFoundException" })).toBe(false);
    // A specific resource that does not exist is NOT an unsupported operation.
    expect(isUnsupportedOperation({ message: "Requested resource not found" })).toBe(false);
  });
});
