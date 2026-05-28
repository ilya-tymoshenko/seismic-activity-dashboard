import type { AppProps } from "next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>
        <Component {...pageProps} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
