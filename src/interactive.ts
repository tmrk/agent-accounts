import { createInterface } from "node:readline";

interface Keypress {
  name?: string;
}

/** Prompt for a line of input, or resolve without a value when Escape is pressed. */
export function questionOrEscape(
  question: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<string | undefined> {
  const rl = createInterface({ input, output });

  return new Promise((resolve) => {
    let settled = false;

    const finish = (answer?: string): void => {
      if (settled) return;
      settled = true;
      input.off("keypress", onKeypress);
      rl.close();
      resolve(answer);
    };

    const onKeypress = (_character: string, key?: Keypress): void => {
      if (key?.name !== "escape") return;

      output.write("\n");
      finish();
    };

    input.on("keypress", onKeypress);
    rl.question(question, (answer) => finish(answer));
  });
}
