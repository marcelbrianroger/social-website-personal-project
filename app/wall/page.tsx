import type { Metadata } from 'next'

import { WallClient } from './wall-client'

export const metadata: Metadata = {
  title: 'DUDU wall · Social Aachen Website',
  description:
    'Say something to everyone online. Every note deletes itself twenty-four hours later.',
}

export default function WallPage() {
  return <WallClient />
}
