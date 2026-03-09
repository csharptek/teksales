export const metadata = {
  title: "CSharpTek AI Proposal Generator",
  description: "AI-powered sales proposal automation",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
