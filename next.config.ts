import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  // La historia de turnos libres lee las fuentes con fs: que entren en la función de Vercel
  outputFileTracingIncludes: {
    "/panel/complejos/[id]/historia/imagen": ["./src/assets/fonts/*.woff"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
