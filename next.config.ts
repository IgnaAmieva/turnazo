import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  // Logo del club: hasta 10 MB (el servidor lo achica). En Vercel el pedido
  // igual no puede pasar de 4,5 MB: el navegador baja antes los más pesados.
  experimental: {
    serverActions: { bodySizeLimit: "11mb" },
    // proxy.ts corre en todos los pedidos: su límite (10 MB) también tiene que dejarlo pasar
    proxyClientMaxBodySize: "11mb",
  },
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
