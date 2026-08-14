export function getProviderNames(providerIds: string[]) {
  if (import.meta.env.VITE_E2E === "true") {
    const provider = window.localStorage.getItem("cvai:e2eProvider");
    if (provider) return provider.split(",").map((name) => name.trim());
  }

  return providerIds.map((providerId) => {
    if (providerId === "google.com") return "Google";
    if (providerId === "github.com") return "GitHub";
    if (providerId === "password") return "Email / password";
    return providerId;
  });
}
