import { createInterface } from "node:readline";
/** Prompt for a line of input, or resolve without a value when Escape is pressed. */
export function questionOrEscape(question, input = process.stdin, output = process.stdout) {
    const rl = createInterface({ input, output });
    return new Promise((resolve) => {
        let settled = false;
        const finish = (answer) => {
            if (settled)
                return;
            settled = true;
            input.off("keypress", onKeypress);
            rl.close();
            resolve(answer);
        };
        const onKeypress = (_character, key) => {
            if (key?.name !== "escape")
                return;
            output.write("\n");
            finish();
        };
        input.on("keypress", onKeypress);
        rl.question(question, (answer) => finish(answer));
    });
}
//# sourceMappingURL=interactive.js.map