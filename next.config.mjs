/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  serverExternalPackages: ["@langchain/openai", "@langchain/langgraph", "langsmith"],
};

export default nextConfig;
