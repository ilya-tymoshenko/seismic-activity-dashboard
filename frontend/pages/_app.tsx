import type { AppProps } from "next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <TooltipProvider>
      <Component {...pageProps} />
    </TooltipProvider>
  );
}
