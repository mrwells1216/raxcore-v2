import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: __dirname,
  },
  // jspdf and html2canvas bundle Node.js CJS code that breaks SSR.
  // Marking them as server-external prevents them from being included in
  // the SSR bundle; they are only imported dynamically on the client.
  serverExternalPackages: ['jspdf', 'html2canvas'],
};

export default nextConfig;
