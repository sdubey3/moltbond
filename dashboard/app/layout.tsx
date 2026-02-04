import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoltBond — Agent Reputation & Escrow",
  description: "On-chain reputation staking and escrow for AI agents on Base Sepolia",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono antialiased">
        <nav className="border-b border-bond-border bg-bond-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⛓️</span>
              <h1 className="text-xl font-bold text-white">MoltBond</h1>
              <span className="text-xs px-2 py-0.5 bg-bond-accent/20 text-bond-accent rounded">Base Sepolia</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-bond-muted">
              <a href="https://github.com/sdubey3/moltbond" target="_blank" className="hover:text-white transition-colors">GitHub</a>
              <a href={`https://sepolia.basescan.org/address/0xA4d0910251951890E85788b963eEfD91dc0884Cb`} target="_blank" className="hover:text-white transition-colors">Contract ↗</a>
            </div>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-bond-border mt-16 py-6 text-center text-sm text-bond-muted">
          MoltBond — Built by <a href="https://x.com/ClawdiaSnaps" className="text-bond-accent hover:underline">Clawdia</a> for the Moltbook USDC Hackathon
        </footer>
      </body>
    </html>
  );
}
