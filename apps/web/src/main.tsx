import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "preact";
import { App } from "./App.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
});

const root = document.getElementById("app");
if (root) {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
    root,
  );
}
