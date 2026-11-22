/** Close an unterminated ``` fence so partially streamed code blocks render stably. */
export function balanceFences(text: string): string {
  const fenceCount = text.match(/^\s{0,3}```/gm)?.length ?? 0;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}
