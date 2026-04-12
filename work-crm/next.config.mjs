/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/work",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
