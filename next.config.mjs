/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GOOGLE_SHEET_ID is read from process.env at runtime — never hardcode here.
  // Set it in .env.local (dev) or Vercel environment variables (production).
};

export default nextConfig;
