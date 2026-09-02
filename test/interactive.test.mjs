import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { questionOrEscape } from "../dist/interactive.js";

test("returns entered selections", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const answerPromise = questionOrEscape("Switch: ", input, output);

  input.end("2\n");

  assert.equal(await answerPromise, "2");
});

test("Escape cancels the prompt on a clean new line", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let displayed = "";
  output.setEncoding("utf8");
  output.on("data", chunk => displayed += chunk);

  const answerPromise = questionOrEscape("Switch: ", input, output);
  input.emit("keypress", "\x1b", { name: "escape" });

  assert.equal(await answerPromise, undefined);
  assert.equal(displayed, "Switch: \n");
});
