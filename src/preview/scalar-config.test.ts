import { expect, test } from "bun:test";
import { parseScalarConfig } from "./scalar-config";

test("scalars pass", () => {
  expect(parseScalarConfig('{"title":"A","n":2,"on":true}')).toEqual({
    title: "A",
    n: 2,
    on: true,
  });
});

test("a list or object names its field", () => {
  expect(() => parseScalarConfig('{"entityIds":["light.a"]}')).toThrow('"entityIds"');
  expect(() => parseScalarConfig('{"a":{"b":1}}')).toThrow('"a"');
});

test("anything but an object is refused", () => {
  expect(() => parseScalarConfig("[1]")).toThrow("JSON object");
  expect(() => parseScalarConfig("nope")).toThrow("JSON object");
});
