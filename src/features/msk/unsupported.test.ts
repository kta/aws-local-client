import { describe, expect, it } from "vitest";
import type { AppError } from "../../api/types";
import { isMskUnsupported } from "./unsupported";

const err = (message: string, kind: AppError["kind"] = "internal"): AppError =>
  ({ kind, message }) as AppError;

describe("isMskUnsupported", () => {
  it("treats standard unsupported-operation signatures as unsupported", () => {
    expect(isMskUnsupported(err("UnknownOperationException"))).toBe(true);
    expect(isMskUnsupported(err("The action ListClusters is not valid"))).toBe(true);
    expect(isMskUnsupported(err("UnknownService: kafka"))).toBe(true);
  });

  it("treats kumo's plain 404 / not-found load failure as unsupported", () => {
    expect(isMskUnsupported(err("404 page not found"))).toBe(true);
    expect(isMskUnsupported(err("gateway returned 404"))).toBe(true);
    expect(isMskUnsupported(err("no clusters here", "not_found"))).toBe(true);
  });

  it("treats ministack-pip's S3-misroute (NoSuchBucket) as unsupported", () => {
    expect(
      isMskUnsupported(
        err(
          '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code>' +
            "<Message>The specified bucket does not exist</Message></Error>",
        ),
      ),
    ).toBe(true);
    expect(isMskUnsupported(err("The specified bucket does not exist"))).toBe(true);
  });

  it("does not misclassify a genuine service/validation error as unsupported", () => {
    expect(isMskUnsupported(err("cluster name already in use"))).toBe(false);
    expect(isMskUnsupported(err("throttled, please retry"))).toBe(false);
  });
});
