"use client";

import dynamic from "next/dynamic";

const VenuePinMap = dynamic(() => import("@/components/venue-pin-map"), {
  ssr: false,
});

export default VenuePinMap;
