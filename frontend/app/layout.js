export const metadata = {
  title: "My App",
  description: "Generated app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
