export function startInvitation(document: Document, url: string, clipboard?: Pick<Clipboard, "writeText">) {
  const input = document.querySelector<HTMLInputElement>("#match-link");
  const button = document.querySelector<HTMLButtonElement>("#copy-match-link");
  const status = document.querySelector<HTMLElement>("#copy-link-status");
  if (!input || !button) return;
  input.value = url;
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!clipboard) throw new Error("Clipboard unavailable");
      await clipboard.writeText(url);
      if (status) status.textContent = "Match link copied.";
    } catch {
      input.focus();
      input.select();
      if (status) status.textContent = "Copy unavailable. The match link is selected; copy it manually.";
    } finally {
      button.disabled = false;
    }
  });
}
