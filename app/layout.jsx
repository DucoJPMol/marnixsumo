import "@fontsource/dm-serif-display/400.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "./globals.css";

export const metadata = {
  title: "Sumo pool",
  description: "Voorspel het schema, zet in op je worstelaar, verbrand je MX.",
  icons: { icon: "/crest.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#002C52",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
