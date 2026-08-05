/**
 * The words for 36 Questions. Split from the rules because it is copy, not
 * logic — nothing here decides anything.
 *
 * INDONESIAN, like every other player-facing string in this app. The originals
 * are Aron et al. (1997), adapted rather than translated: a literal rendering
 * of "Would you like to be famous? In what way?" reads like a form, and these
 * have to sound like something you would actually ask someone on a video call
 * at eleven at night.
 *
 * Dare titles stay in English on purpose. Code-mixing is how this audience
 * actually talks, and a short English label is what makes a dare read as a card
 * being dealt rather than an instruction being issued.
 */

/**
 * Three sets of twelve, escalating.
 *
 * The escalation is the entire mechanism of the original study — set one is
 * small talk with a pulse, set three asks you to say something you would
 * normally not. Do not reorder these to "mix it up"; the ramp is the point.
 */
export const QUESTIONS: readonly string[] = [
  // --- Set I ---------------------------------------------------------------
  'Kalau bisa milih siapa aja di dunia, kamu mau makan malam bareng siapa?',
  'Kamu pengin terkenal nggak? Kalau iya, terkenal karena apa?',
  'Sebelum nelepon orang, kamu suka latihan dulu mau ngomong apa? Kenapa?',
  'Menurut kamu, hari yang "sempurna" itu isinya apa aja?',
  'Terakhir kali kamu nyanyi sendirian kapan? Kalau nyanyi buat orang lain?',
  'Kalau kamu bisa hidup sampai 90 tahun, kamu milih badan atau pikiran kamu yang tetap umur 30 selama 60 tahun terakhir?',
  'Kamu punya firasat nggak soal gimana nanti kamu bakal meninggal?',
  'Sebutin tiga hal yang kayaknya kita berdua sama-sama punya.',
  'Apa satu hal dalam hidup kamu yang paling kamu syukuri?',
  'Kalau kamu bisa ngubah satu hal dari cara kamu dibesarkan, kamu mau ubah apa?',
  'Coba ceritain hidup kamu selengkap mungkin, dalam empat menit.',
  'Kalau besok pagi kamu bangun dapat satu kemampuan baru, kamu mau kemampuan apa?',

  // --- Set II --------------------------------------------------------------
  'Kalau ada bola kristal yang bisa jawab apa aja tentang diri kamu, kamu mau tanya apa?',
  'Ada nggak sesuatu yang udah lama banget pengin kamu lakuin? Kenapa belum?',
  'Apa pencapaian yang paling kamu banggain sejauh ini?',
  'Apa yang paling kamu hargai dari sebuah pertemanan?',
  'Apa kenangan yang paling berharga buat kamu?',
  'Apa kenangan yang paling nggak mau kamu ulang?',
  'Kalau kamu tahu setahun lagi kamu bakal meninggal mendadak, ada yang mau kamu ubah dari cara kamu hidup sekarang?',
  'Arti pertemanan buat kamu apa?',
  'Seberapa besar peran cinta dan kasih sayang dalam hidup kamu?',
  'Gantian sebutin satu hal positif tentang lawan bicara kamu, sampai kumpul lima.',
  'Menurut kamu, keluarga kamu hangat dan dekat nggak?',
  'Gimana perasaan kamu soal hubungan kamu sama ibu kamu?',

  // --- Set III -------------------------------------------------------------
  'Bikin tiga kalimat yang mulai pakai "kita", dan harus bener-bener benar. Contoh: "Kita berdua lagi ngerasa..."',
  'Lengkapin kalimat ini: "Aku pengin punya orang yang bisa aku ajak berbagi..."',
  'Kalau kita mau jadi temen deket, satu hal penting apa yang harus dia tahu tentang kamu?',
  'Bilang ke lawan bicara kamu apa yang kamu suka dari dia. Yang jujur, yang biasanya nggak kamu bilang ke orang baru.',
  'Ceritain satu momen paling memalukan dalam hidup kamu.',
  'Kapan terakhir kali kamu nangis di depan orang lain? Kalau nangis sendirian?',
  'Sebutin satu hal dari lawan bicara kamu yang udah kamu suka dari sekarang.',
  'Menurut kamu, hal apa yang terlalu serius buat dibercandain?',
  'Kalau malam ini kamu meninggal tanpa sempat ngomong sama siapa pun, apa yang paling kamu sesali belum sempat dibilang? Kenapa belum kamu bilang?',
  'Rumah kamu kebakaran. Setelah semua orang dan hewan peliharaan selamat, kamu masih sempat balik ambil satu barang. Ambil apa? Kenapa?',
  'Dari semua orang di keluarga kamu, siapa yang kepergiannya paling bikin kamu hancur? Kenapa?',
  'Ceritain satu masalah pribadi kamu, terus tanya lawan bicara kamu dia bakal ngadepinnya gimana. Habis itu minta dia baca balik, menurut dia kamu ngerasa gimana soal masalah itu.',
]

/**
 * Penalty dares, drawn when someone vetoes a question.
 *
 * TWO CONSTRAINTS, both from where this is played. Everything has to work over
 * a video call with nothing but a camera and a voice — no props to fetch, no
 * second device, nothing that needs the other person in the room. And every
 * dare has to have a visible END, because the partner is the one who decides it
 * is finished; "be funnier for a while" gives them nothing to judge.
 */
export const DARES: readonly string[] = [
  'Face Challenge: senyum selebar mungkin sampai gigi keliatan semua, tahan sampai lawan bicara kamu bilang cukup.',
  'Blind Recipe: jelasin cara masak makanan favorit kamu sedetail-detailnya, dari nol, tanpa Googling.',
  'Room Tour: angkat laptop atau HP kamu, tunjukin sudut paling berantakan di kamar kamu sekarang juga.',
  'Vocal Switch: ceritain kegiatan kamu hari ini pakai logat aneh. Bebas logat apa, asal konsisten sampai selesai.',
  'Silent Movie: ceritain gimana pagi kamu tadi tanpa suara sama sekali, cuma gerakan.',
  'Fridge Reveal: buka kulkas kamu, tunjukin isinya, terus jelasin benda yang paling lama nangkring di situ.',
  'Object Show: ambil benda terdekat dari tangan kiri kamu, promosiin benda itu kayak iklan TV.',
  'Gallery Roulette: buka galeri kamu, tunjukin foto paling bawah yang masih aman dilihat orang, ceritain ceritanya.',
  'Compliment Rally: kasih lima pujian ke lawan bicara kamu, nonstop, jeda nggak boleh lebih dari tiga detik.',
  'One Breath: ceritain film favorit kamu dari awal sampai spoiler ending, dalam satu tarikan napas.',
  'Reverse Talk: ngomong tiga kalimat, tapi tiap kalimat urutan katanya dibalik dari belakang.',
  'Frozen Frame: diam total kayak patung, nggak boleh ketawa, sampai lawan bicara kamu nyerah.',
]
