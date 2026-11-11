'use client';

import dynamic from 'next/dynamic';

const VenueMap = dynamic(() => import('@/components/venue-map'), { ssr: false });

export default VenueMap;
