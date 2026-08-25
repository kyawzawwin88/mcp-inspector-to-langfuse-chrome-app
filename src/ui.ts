import { convertInspectorDump } from "./convert.js";

const input = document.getElementById("input");
const output = document.getElementById("output");

if (!(input instanceof HTMLTextAreaElement) || !(output instanceof HTMLTextAreaElement)) {
  throw new Error("Converter textareas were not found");
}

function render(source: HTMLTextAreaElement, target: HTMLTextAreaElement): void {
  const result = convertInspectorDump(source.value);
  if (!result.ok) {
    target.value = result.error;
    return;
  }
  if ("empty" in result) {
    target.value = "";
    return;
  }
  target.value = JSON.stringify(result.config, null, 2);
}

input.addEventListener("input", () => {
  render(input, output);
});
render(input, output);
