import Link from "next/link";

import { SHELL } from "@/app/chrome";
import { LiveWall } from "@/app/live-wall";
import { getCurrentSession } from "@/lib/session/current-session";

/**
 * Home.
 *
 * Written in Indonesian, mixing in the German words this audience actually uses
 * daily — Anmeldung, Bürgeramt, Mensa, WG-Zimmer, Pontstraße. That mixture is
 * how the people this is for genuinely speak, and it is doing more work than
 * any amount of styling to say who the site belongs to.
 *
 * Every claim is checked against the code: the 24 hours come from
 * DUDU_TTL_SECONDS, the two-per-room from ROOM_CAPACITY, and the nickname is
 * whatever lib/session/nickname.ts actually issued this visitor.
 */

/** Ink on yellow — a highlighter pass. The only way colour touches type here. */
const MARKER = "bg-yellow box-decoration-clone px-2";

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <>
      {/* ------------------------------------------------------------- hero */}
      <section className={`${SHELL} pt-14 pb-20 sm:pt-20 sm:pb-24`}>
        <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
          mading anonim buat anak indonesia di aachen
        </p>

        <h1
          className="mt-6 max-w-4xl font-display text-[clamp(2.75rem,10.5vw,6rem)] uppercase leading-[0.88] tracking-[-0.03em]"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
        >
          Ada yang masih <span className={MARKER}>bangun</span>.
        </h1>

        {/* Two columns from md up: the pitch reads on the left, the name sits
            beside it. Single column below that. */}
        <div className="mt-10 grid gap-10 md:grid-cols-[1fr_auto] md:items-start md:gap-14">
          <div>
            <p className="max-w-xl text-[1.125rem] leading-relaxed text-ink">
              Tulis apa aja di mading. Hilang sendiri setelah 24 jam. Atau
              langsung video call sama orang yang lagi online — nggak perlu
              kenalan dulu, nggak perlu daftar.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/wall"
                className="border-2 border-ink bg-ink px-6 py-3 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink"
              >
                Buka mading
              </Link>
              <Link
                href="/rooms"
                className="border-2 border-ink px-6 py-3 font-mono text-sm text-ink transition-colors hover:bg-yellow"
              >
                Cari teman ngobrol
              </Link>
            </div>
          </div>

          {/* The name, as a printed label. Real data, not a mockup. */}
          <div className="max-w-sm border-2 border-ink bg-stock px-5 py-4 md:w-72">
            <p className="font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft">
              namamu di sini
            </p>
            <p
              className="mt-1.5 break-words font-display text-2xl leading-none"
              style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
            >
              {session ? session.nickname : "belum dikasih"}
            </p>
            <p className="mt-3 max-w-xs text-[0.8125rem] leading-relaxed text-ink-soft">
              {session ? (
                <>
                  Dikasih otomatis pas kamu buka halaman ini. Bahasa Jerman, ya…
                  soalnya kita emang lagi di Jerman.
                </>
              ) : (
                <>
                  Proxy nggak jalan di path ini, jadi belum ada nama. Cek{" "}
                  <code className="font-mono">matcher</code> di{" "}
                  <code className="font-mono">proxy.ts</code>.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- the board: signature */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            mading
          </p>

          <h2
            className="mt-4 max-w-3xl font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Semua hilang setelah 24 jam.
          </h2>

          <p className="mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-ink">
            Siapa aja yang lagi online bisa nempel. Nggak ada arsip, nggak ada
            undo, nggak bisa diminta balik. Di bawah ini yang paling deket waktu
            habisnya.
          </p>

          <div className="mt-10">
            <LiveWall />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ everything else */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            selain mading
          </p>

          <div className="mt-10 grid grid-cols-1 gap-y-10 sm:gap-x-10 md:grid-cols-3">
            <article className="flex flex-col border-t-2 border-ink pt-5">
              <h3
                className="font-display text-xl leading-tight"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Ruang video
              </h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                Dua orang per ruang. Video sama suaranya jalan langsung dari
                browser ke browser, nggak lewat server kami — jadi di sisi kami
                emang nggak ada apa-apa buat direkam.
              </p>
              <Link
                href="/rooms"
                className={`mt-5 self-start ${MARKER} py-0.5 text-sm`}
              >
                Buka ruang
              </Link>
            </article>

            <article className="flex flex-col border-t-2 border-ink pt-5">
              <h3
                className="font-display text-xl leading-tight"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Cari teman ngobrol
              </h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                Pencet sekali, terus tunggu. Begitu ada orang lain yang juga
                lagi nunggu, kalian berdua langsung dimasukin ke satu ruang.
                Yang duluan nunggu, duluan dapet.
              </p>
              <Link
                href="/rooms"
                className={`mt-5 self-start ${MARKER} py-0.5 text-sm`}
              >
                Cari sekarang
              </Link>
            </article>

            <article className="flex flex-col border-t-2 border-ink pt-5">
              <h3
                className="font-display text-xl leading-tight"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Game
              </h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                Mainnya di dalam ruang, papannya dipegang server. Browser kamu
                cuma bisa minta jalan — nggak pernah bisa nentuin sendiri.
              </p>

              {/* Build state, not decoration. Both labels are true today. */}
              <dl className="mt-5 space-y-1 font-mono text-[0.6875rem]">
                <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
                  <dt>tic-tac-toe</dt>
                  <dd className="text-ink-soft">bisa dimainkan</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
                  <dt>mr. white</dt>
                  <dd className="text-ink-soft">masih digambar</dd>
                </div>
              </dl>
            </article>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the rules */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            aturan
          </p>

          <dl className="mt-10 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2">
            <div>
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Cuma dari Jerman
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                Asal permintaan dicek duluan sebelum apa pun jalan. Dari luar
                Jerman, situs ini nggak jawab sama sekali.
              </dd>
            </div>

            <div>
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Nggak ada yang disimpan
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                Mading nyimpen tulisan 24 jam terus dibuang. Game dihapus begitu
                ruangnya kosong. Video nggak pernah direkam, soalnya emang nggak
                pernah nyampe ke kami.
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Nggak ada akun
              </dt>
              <dd className="mt-2.5 max-w-2xl text-[0.9375rem] leading-relaxed text-ink">
                Nggak ada yang bisa didaftarin, nggak ada juga yang bisa
                dihapus.
                {session ? (
                  <>
                    {" "}
                    Ini doang yang situs ini tau tentang kamu:
                    <span className="mt-3 block break-all border-2 border-ink bg-stock px-3 py-2 font-mono text-[0.8125rem]">
                      {session.sessionId}
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    Cuma cookie bertanda tangan isinya satu id sama satu nama.
                  </>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
