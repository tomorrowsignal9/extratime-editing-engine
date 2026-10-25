import "./globals.css";
export const metadata = {
  title: "EXTRATIME STUDIO",
  description: "Your stories. Your edit. Local-first football video studio.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
