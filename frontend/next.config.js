/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from YouTube thumbnails and Azure Blob Storage
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "*.blob.core.windows.net" },
    ],
  },
  // Expose backend URL to the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};

module.exports = nextConfig;
