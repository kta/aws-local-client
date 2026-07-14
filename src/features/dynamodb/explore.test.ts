import { describe, expect, it } from "vitest";
import type { TableDetail } from "../../api/types";
import { cellText, columnsOf, keyOf, typedValue } from "./explore";

const detail: TableDetail = {
  name: "orders",
  status: "ACTIVE",
  itemCount: 2,
  sizeBytes: 0,
  keys: [
    { name: "pk", keyType: "HASH", attrType: "S" },
    { name: "sk", keyType: "RANGE", attrType: "S" },
  ],
  gsis: [],
  lsis: [],
};

describe("typedValue", () => {
  it("wraps N attribute types as numbers", () => {
    expect(typedValue("N", "42")).toEqual({ N: "42" });
  });
  it("wraps everything else as strings", () => {
    expect(typedValue("S", "user#1")).toEqual({ S: "user#1" });
    expect(typedValue("B", "abc")).toEqual({ S: "abc" });
  });
});

describe("keyOf", () => {
  it("extracts only the table key attributes", () => {
    const item = { pk: { S: "user#1" }, sk: { S: "order#1" }, amount: { N: "10" } };
    expect(keyOf(detail.keys, item)).toEqual({ pk: { S: "user#1" }, sk: { S: "order#1" } });
  });
  it("omits missing key attributes", () => {
    const item = { pk: { S: "user#1" } };
    expect(keyOf(detail.keys, item)).toEqual({ pk: { S: "user#1" } });
  });
});

describe("columnsOf", () => {
  it("lists keys first then discovered attributes", () => {
    const items = [{ pk: { S: "a" }, sk: { S: "b" }, email: { S: "c" } }];
    expect(columnsOf(detail, items)).toEqual(["pk", "sk", "email"]);
  });
  it("caps the column count", () => {
    const wide: Record<string, { S: string }> = { pk: { S: "a" }, sk: { S: "b" } };
    for (let i = 0; i < 20; i++) wide[`attr${i}`] = { S: "x" };
    expect(columnsOf(detail, [wide], 5)).toHaveLength(5);
  });
});

describe("cellText", () => {
  it("stringifies objects and arrays", () => {
    expect(cellText({ items: { L: [{ S: "x" }] } }, "items")).toBe('["x"]');
  });
  it("renders scalars as plain text", () => {
    expect(cellText({ amount: { N: "980" } }, "amount")).toBe("980");
  });
  it("returns empty for missing attributes", () => {
    expect(cellText({}, "nope")).toBe("");
  });
});
