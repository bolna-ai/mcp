import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bolna MCP Server",
  description:
    "Remote MCP server wrapping the Bolna Voice AI REST API — read and manage agents, place calls, and pull transcripts from any MCP-compatible client.",
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
