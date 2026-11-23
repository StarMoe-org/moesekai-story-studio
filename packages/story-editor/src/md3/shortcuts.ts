export function isKeyboardEventComposing(event: KeyboardEvent): boolean {
    if (event.isComposing) return true;
    if (event.key === "Process") return true;
    const keyCode = (event as KeyboardEvent & { keyCode?: number }).keyCode;
    return keyCode === 229;
}
