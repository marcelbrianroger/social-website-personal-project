import type { Metadata } from 'next'

import { WallClient } from './wall-client'

export const metadata: Metadata = {
  title: 'Wall · DUDU',
  description: 'A global anonymous wall where every post expires after 24 hours.',
}

export default function WallPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <WallClient />
    </div>
  )
}
