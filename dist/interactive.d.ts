/** Prompt for a line of input, or resolve without a value when Escape is pressed. */
export declare function questionOrEscape(question: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream): Promise<string | undefined>;
