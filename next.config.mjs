/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp có binary native — phải để Next KHÔNG bundle nó vào serverless,
  // nếu không import("sharp") sẽ lỗi trên Vercel → thumbnail "failed".
  experimental: {
    serverComponentsExternalPackages: ["sharp"],
  },
};
export default nextConfig;
