import { describe, expect, it } from "vitest";
import { ddbToPlain, itemToPlain, plainToDdb, plainToItem } from "./ddbJson";

describe("ddbToPlain", () => {
  it("converts scalars", () => {
    expect(ddbToPlain({ S: "hi" })).toBe("hi");
    expect(ddbToPlain({ N: "42.5" })).toBe(42.5);
    expect(ddbToPlain({ BOOL: true })).toBe(true);
    expect(ddbToPlain({ NULL: true })).toBe(null);
  });

  it("keeps unsafe integers as strings", () => {
    expect(ddbToPlain({ N: "9007199254740993" })).toBe("9007199254740993");
  });

  it("converts nested L and M", () => {
    expect(ddbToPlain({ M: { a: { L: [{ S: "x" }, { N: "1" }] } } })).toEqual({
      a: ["x", 1],
    });
  });

  it("converts sets to arrays (lossy, display only)", () => {
    expect(ddbToPlain({ SS: ["a", "b"] })).toEqual(["a", "b"]);
    expect(ddbToPlain({ NS: ["1", "2"] })).toEqual([1, 2]);
  });
});

describe("plainToDdb", () => {
  it("converts scalars", () => {
    expect(plainToDdb("hi")).toEqual({ S: "hi" });
    expect(plainToDdb(42.5)).toEqual({ N: "42.5" });
    expect(plainToDdb(false)).toEqual({ BOOL: false });
    expect(plainToDdb(null)).toEqual({ NULL: true });
  });

  it("converts arrays and objects", () => {
    expect(plainToDdb(["x", 1])).toEqual({ L: [{ S: "x" }, { N: "1" }] });
    expect(plainToDdb({ a: 1 })).toEqual({ M: { a: { N: "1" } } });
  });
});

describe("item conversions", () => {
  it("roundtrips a simple item", () => {
    const ddb = { pk: { S: "user#1" }, age: { N: "30" } };
    expect(plainToItem(itemToPlain(ddb))).toEqual(ddb);
  });
});
