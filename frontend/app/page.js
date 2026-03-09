// pages/index.js  (or app/page.js if using App Router — see note below)
//
// If using Next.js App Router (app/), create: app/page.js
// If using Pages Router (pages/), create: pages/index.js
//
// NOTE: This component uses client-side state extensively.
// Wrap with "use client" if using App Router.

"use client";

import dynamic from "next/dynamic";

// Disable SSR — component uses browser APIs (fetch, localStorage APIs, DOM)
const AIProposalGenerator = dynamic(
  () => import("../components/AIProposalGenerator-v2"),
  { ssr: false }
);

export default function Home() {
  return <AIProposalGenerator />;
}
