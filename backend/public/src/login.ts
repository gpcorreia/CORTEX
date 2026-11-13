export {};

const form = document.querySelector<HTMLFormElement>("#login-form");
const status = document.querySelector<HTMLElement>("#login-status");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const values = new FormData(form);
  if (status) {
    status.textContent = "A validar acesso…";
    status.classList.remove("is-error");
  }
  if (submit) submit.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: values.get("email"),
        password: values.get("password"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Não foi possível iniciar sessão.");
    const requested = new URLSearchParams(location.search).get("next");
    const destination =
      requested?.startsWith("/") && !requested.startsWith("//")
        ? requested
        : "/dashboard";
    location.assign(destination);
  } catch (error) {
    if (status) {
      status.textContent = (error as Error).message;
      status.classList.add("is-error");
    }
    if (submit) submit.disabled = false;
  }
});
