import type { ComparisonInput, EnvironmentVariable } from "../core/types.js";
import { ScanError } from "./discover.ts";
import type { ProjectFiles } from "./discover.ts";

/** Classify bounded dotenv input without extracting or retaining parsed values. */
function readStates(content: string): EnvironmentVariable[] {
  if (content.includes("\0")) throw new ScanError("FORMAT_ERROR");
  const states = new Map<string, "present" | "empty">();
  let position = 0;
  while (position < content.length) {
    const newline = content.indexOf("\n", position);
    const lineEnd = newline === -1 ? content.length : newline;
    const lineStart = position;
    position = lineEnd + 1;

    let first = lineStart;
    while (first < lineEnd && /\s/.test(content[first]!)) first++;
    if (first === lineEnd || content[first] === "#") continue;

    let equals = first;
    while (equals < lineEnd && content[equals] !== "=") equals++;
    if (equals === lineEnd) throw new ScanError("FORMAT_ERROR");
    const name = content.slice(lineStart, equals).trimStart().replace(/^export[ \t]+/, "").trim();
    if (!name || name.includes("#")) throw new ScanError("FORMAT_ERROR");

    let start = equals + 1;
    // Horizontal whitespace must never consume the following declaration.
    while (start < lineEnd && /\s/.test(content[start]!)) start++;
    const quote = content[start];
    if (start < lineEnd && (quote === '"' || quote === "'" || quote === "`")) {
      const end = content.indexOf(quote, start + 1);
      if (end === -1) throw new ScanError("FORMAT_ERROR");
      const nextLine = content.indexOf("\n", end + 1);
      const tailEnd = nextLine === -1 ? content.length : nextLine;
      let tail = end + 1;
      while (tail < tailEnd && /\s/.test(content[tail]!)) tail++;
      if (tail < tailEnd && content[tail] !== "#") {
        throw new ScanError("FORMAT_ERROR");
      }
      states.set(name, end === start + 1 ? "empty" : "present");
      position = tailEnd + 1;
      continue;
    }

    let state: "present" | "empty" = "empty";
    for (let index = start; index < lineEnd && content[index] !== "#"; index++) {
      if (/\S/.test(content[index]!)) {
        state = "present";
        break;
      }
    }
    states.set(name, state);
  }
  return Array.from(states, ([name, state]) => ({ name, state }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

// Parse through the shared session so format errors also stop the audit.
export async function readEnv(
  files: ProjectFiles,
  environmentPath: string,
  examplePath = ".env.example",
): Promise<Pick<ComparisonInput, "documentedNames" | "environment">> {
  const documentedNames = (await files.readEnvironment(examplePath, readStates)).map(({ name }) => name);
  const environment = await files.readEnvironment(environmentPath, readStates);
  return { documentedNames, environment };
}
