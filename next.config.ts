import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Native / filesystem-dependent packages must stay external — bundling them
   * breaks their runtime file access.
   *  - maxmind: memory-maps the GeoLite2 .mmdb file
   *  - pg + @prisma/adapter-pg: native-ish Postgres driver used by Prisma 7
   */
  serverExternalPackages: ["maxmind", "pg", "@prisma/adapter-pg"],
};

export default nextConfig;
