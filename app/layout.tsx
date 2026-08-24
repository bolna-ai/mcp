import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://mcp.bolna.ai"),
  title: "Bolna MCP Server",
  description:
    "Remote MCP server wrapping the Bolna Voice AI REST API — read and manage agents, place calls, and pull transcripts from any MCP-compatible client.",
  openGraph: {
    siteName: "Bolna MCP Server",
    title: "Bolna MCP Server",
    description:
      "Remote MCP server wrapping the Bolna Voice AI REST API — read and manage agents, place calls, and pull transcripts from any MCP-compatible client.",
    url: "https://mcp.bolna.ai",
    type: "website",
    images: ["/icon.png"],
  },
  twitter: {
    card: "summary",
    title: "Bolna MCP Server",
    description:
      "Remote MCP server wrapping the Bolna Voice AI REST API — read and manage agents, place calls, and pull transcripts from any MCP-compatible client.",
    images: ["/icon.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
