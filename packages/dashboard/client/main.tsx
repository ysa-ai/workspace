import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./trpc";
import { App } from "./App";
import { AuthProvider } from "./AuthProvider";
import { getAccessToken, tryRefresh, clearTokens } from "./lib/auth";
import "./index.css";

const basename = window.location.hostname.startsWith("app.") ? "/" : "/app";

async function getValidToken(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (Date.now() > (payload.exp * 1000) - 30_000) {
      const refreshed = await tryRefresh();
      if (refreshed) return refreshed;
      if (Date.now() > payload.exp * 1000) { clearTokens(); window.location.href = `${basename}/signin`; return null; }
    }
    return token;
  } catch {
    return token;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      headers: async () => {
        const token = await getValidToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

document.getElementById("splash")?.classList.add("hidden");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </BrowserRouter>
  </StrictMode>,
);
