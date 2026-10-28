export const metadata = {
  title: 'Homey Dashboard',
  description: 'Live room status and flow overview for your Homey.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#f7f8fa',
          color: '#1c2024',
        }}
      >
        {children}
      </body>
    </html>
  );
}
