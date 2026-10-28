/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for the Docker/NAS deployment.
  output: 'standalone',
};

module.exports = nextConfig;
