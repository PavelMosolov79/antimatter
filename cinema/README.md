# Промо-ролик ANTIMATTER (15 с, 1080×1920, 30 к/с, со звуком)

Ролик собирается кадр за кадром из настоящей игры (её мир, её отрисовка) в headless Chrome; звук синтезируется
и привязан к событиям мира. Ничего не идёт в реальном времени, поэтому результат одинаковый на любой машине.

1. Запустить `npm run dev` (порт 5173).
2. `node cinema/stills.mjs` — снимки настоящих экранов дока (`cinema/assets/*.png`); `node cinema/repairshots.mjs` — разбитый корабль и ход ремонта в доке (`repair-*.png`).
3. `node cinema/render.mjs final 0 15` — готовый mp4 в `/tmp/cinema-out/antimatter-promo.mp4`
   (`CINEMA_OUT=папка` меняет место). `preview 0 15` — контактный лист вместо видео, `still 2.4 2.5` — один кадр.
4. `node cinema/sheet.mjs a.png b.png …` — уменьшенный лист из картинок для просмотра.
5. `node cinema/verify.mjs` — проигрывает готовый файл и сохраняет контактный лист + уровни звука.

Что где: `shots.ts` — сцены и надписи (`CAPTIONS`), `audio.ts` — музыка и звуки, `director.ts` — покадровый цикл,
`encode.ts` — H.264 + AAC (WebCodecs), `layouts.ts` — полностью оснащённые корабли для кадров.
